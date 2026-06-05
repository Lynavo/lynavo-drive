package mobiletunnel

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/hashicorp/yamux"
	"github.com/nicksyncflow/sidecar/internal/protocol"
	"github.com/nicksyncflow/sidecar/internal/wsdial"
	"github.com/pion/webrtc/v4"
)

type Tunnel struct {
	cancel     context.CancelFunc
	ctx        context.Context
	iceServers []webrtc.ICEServer
	listener   net.Listener
	pc         *webrtc.PeerConnection
	yamuxSess  *yamux.Session
	localPort  int
	readyChan  chan int
	mu         sync.Mutex
	isClosed   bool
	readyOnce  sync.Once
}

var (
	activeTunnel *Tunnel
	activeMu     sync.Mutex

	selectedICERouteMu      sync.Mutex
	currentSelectedICERoute string
)

const defaultSTUNServer = "stun:stun.cloudflare.com:3478"
const tunnelStartupTimeout = 20 * time.Second

const (
	writeWait  = 10 * time.Second
	pongWait   = 60 * time.Second
	pingPeriod = (pongWait * 9) / 10
)
const nat64LookupTimeout = 800 * time.Millisecond
const nat64DialTimeout = 5 * time.Second

var nat64PrefixLengths = []int{96, 64, 56, 48, 40, 32}

type iceServerPayload struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username"`
	Credential string   `json:"credential"`
}

type nat64Prefix struct {
	IP     net.IP
	Length int
}

func parseICEServersJSON(raw string) []webrtc.ICEServer {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return defaultICEServers()
	}

	var payloads []iceServerPayload
	if err := json.Unmarshal([]byte(trimmed), &payloads); err != nil {
		tunnelWarn("failed to parse ICE servers JSON, using default STUN", "err", err)
		return defaultICEServers()
	}

	servers := make([]webrtc.ICEServer, 0, len(payloads))
	for _, payload := range payloads {
		urls := make([]string, 0, len(payload.URLs))
		for _, rawURL := range payload.URLs {
			if url := strings.TrimSpace(rawURL); url != "" {
				urls = append(urls, url)
			}
		}
		if len(urls) == 0 {
			continue
		}
		servers = append(servers, webrtc.ICEServer{
			URLs:       urls,
			Username:   payload.Username,
			Credential: payload.Credential,
		})
	}

	if len(servers) == 0 {
		return defaultICEServers()
	}
	return servers
}

func defaultICEServers() []webrtc.ICEServer {
	return []webrtc.ICEServer{{URLs: []string{defaultSTUNServer}}}
}

func summarizeICEServers(servers []webrtc.ICEServer) ([]string, bool, bool) {
	urls := make([]string, 0)
	hasTurn := false
	hasStun := false
	for _, server := range servers {
		for _, rawURL := range server.URLs {
			url := sanitizeICEURL(rawURL)
			if url == "" {
				continue
			}
			lower := strings.ToLower(url)
			hasTurn = hasTurn || strings.HasPrefix(lower, "turn:")
			hasStun = hasStun || strings.HasPrefix(lower, "stun:")
			urls = append(urls, url)
		}
	}
	return urls, hasTurn, hasStun
}

func sanitizeICEURL(rawURL string) string {
	url := strings.TrimSpace(rawURL)
	if url == "" {
		return ""
	}
	if idx := strings.Index(url, "?"); idx >= 0 {
		url = url[:idx]
	}
	if schemeEnd := strings.Index(url, ":"); schemeEnd >= 0 {
		scheme := url[:schemeEnd+1]
		rest := url[schemeEnd+1:]
		if at := strings.LastIndex(rest, "@"); at >= 0 {
			url = scheme + rest[at+1:]
		}
	}
	return url
}

func registerICELogging(pc *webrtc.PeerConnection, component string, peerKey string, peerID string, iceServers []webrtc.ICEServer) {
	urls, hasTurn, hasStun := summarizeICEServers(iceServers)
	tunnelInfo(component+" ICE config",
		peerKey, peerID,
		"iceServerCount", len(iceServers),
		"iceURLCount", len(urls),
		"iceURLs", strings.Join(urls, ","),
		"hasTurn", hasTurn,
		"hasStun", hasStun,
	)

	pc.OnICEConnectionStateChange(func(state webrtc.ICEConnectionState) {
		tunnelInfo(component+" ICE connection state changed", peerKey, peerID, "state", state.String())
	})
	pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		tunnelInfo(component+" peer connection state changed", peerKey, peerID, "state", state.String())
	})
	pc.OnICEGatheringStateChange(func(state webrtc.ICEGatheringState) {
		tunnelInfo(component+" ICE gathering state changed", peerKey, peerID, "state", state.String())
	})

	transport := peerConnectionICETransport(pc)
	if transport == nil {
		tunnelWarn(component+" ICE transport unavailable for selected pair logging", peerKey, peerID)
		return
	}
	transport.OnSelectedCandidatePairChange(func(pair *webrtc.ICECandidatePair) {
		logSelectedICECandidatePair(component+" ICE selected candidate pair changed", pair, peerKey, peerID, "reason", "selected_pair_change")
	})
}

func peerConnectionICETransport(pc *webrtc.PeerConnection) *webrtc.ICETransport {
	if pc == nil || pc.SCTP() == nil || pc.SCTP().Transport() == nil {
		return nil
	}
	return pc.SCTP().Transport().ICETransport()
}

func logCurrentSelectedICECandidatePair(pc *webrtc.PeerConnection, component string, peerKey string, peerID string, reason string) {
	transport := peerConnectionICETransport(pc)
	if transport == nil {
		tunnelWarn(component+" ICE selected candidate pair unavailable", peerKey, peerID, "reason", reason, "err", "ice transport unavailable")
		return
	}
	pair, err := transport.GetSelectedCandidatePair()
	if err != nil {
		tunnelWarn(component+" ICE selected candidate pair unavailable", peerKey, peerID, "reason", reason, "err", err)
		return
	}
	logSelectedICECandidatePair(component+" ICE selected candidate pair", pair, peerKey, peerID, "reason", reason)
}

func logSelectedICECandidatePair(message string, pair *webrtc.ICECandidatePair, baseArgs ...any) {
	route := selectedICERoute(pair)
	setCurrentSelectedICERoute(route)
	args := append([]any{}, baseArgs...)
	args = append(args,
		"route", route,
		"localType", iceCandidateType(pairLocal(pair)),
		"localProtocol", iceCandidateProtocol(pairLocal(pair)),
		"localAddress", iceCandidateAddress(pairLocal(pair)),
		"localPort", iceCandidatePort(pairLocal(pair)),
		"localRelatedAddress", iceCandidateRelatedAddress(pairLocal(pair)),
		"localRelatedPort", iceCandidateRelatedPort(pairLocal(pair)),
		"remoteType", iceCandidateType(pairRemote(pair)),
		"remoteProtocol", iceCandidateProtocol(pairRemote(pair)),
		"remoteAddress", iceCandidateAddress(pairRemote(pair)),
		"remotePort", iceCandidatePort(pairRemote(pair)),
		"remoteRelatedAddress", iceCandidateRelatedAddress(pairRemote(pair)),
		"remoteRelatedPort", iceCandidateRelatedPort(pairRemote(pair)),
	)
	tunnelInfo(message, args...)
}

// CurrentSelectedICERoute returns the active tunnel's selected ICE route.
// It returns an empty string until the tunnel has selected a candidate pair.
func CurrentSelectedICERoute() string {
	selectedICERouteMu.Lock()
	defer selectedICERouteMu.Unlock()
	return currentSelectedICERoute
}

func setCurrentSelectedICERoute(route string) {
	selectedICERouteMu.Lock()
	defer selectedICERouteMu.Unlock()
	currentSelectedICERoute = route
}

func resetCurrentSelectedICERoute() {
	setCurrentSelectedICERoute("")
}

func selectedICERoute(pair *webrtc.ICECandidatePair) string {
	local := pairLocal(pair)
	remote := pairRemote(pair)
	if local == nil || remote == nil {
		return "unknown"
	}
	if local.Typ == webrtc.ICECandidateTypeRelay || remote.Typ == webrtc.ICECandidateTypeRelay {
		return "turn_relay"
	}
	if local.Typ == webrtc.ICECandidateTypeHost && remote.Typ == webrtc.ICECandidateTypeHost {
		return "direct_host"
	}
	return "direct_reflexive"
}

func pairLocal(pair *webrtc.ICECandidatePair) *webrtc.ICECandidate {
	if pair == nil {
		return nil
	}
	return pair.Local
}

func pairRemote(pair *webrtc.ICECandidatePair) *webrtc.ICECandidate {
	if pair == nil {
		return nil
	}
	return pair.Remote
}

func iceCandidateType(candidate *webrtc.ICECandidate) string {
	if candidate == nil {
		return ""
	}
	return candidate.Typ.String()
}

func iceCandidateProtocol(candidate *webrtc.ICECandidate) string {
	if candidate == nil {
		return ""
	}
	return candidate.Protocol.String()
}

func iceCandidateAddress(candidate *webrtc.ICECandidate) string {
	if candidate == nil {
		return ""
	}
	return candidate.Address
}

func iceCandidatePort(candidate *webrtc.ICECandidate) uint16 {
	if candidate == nil {
		return 0
	}
	return candidate.Port
}

func iceCandidateRelatedAddress(candidate *webrtc.ICECandidate) string {
	if candidate == nil {
		return ""
	}
	return candidate.RelatedAddress
}

func iceCandidateRelatedPort(candidate *webrtc.ICECandidate) uint16 {
	if candidate == nil {
		return 0
	}
	return candidate.RelatedPort
}

func logLocalICECandidate(component string, peerKey string, peerID string, candidate *webrtc.ICECandidate) {
	tunnelInfo(component+" local ICE candidate gathered",
		peerKey, peerID,
		"candidateType", iceCandidateType(candidate),
		"protocol", iceCandidateProtocol(candidate),
		"address", iceCandidateAddress(candidate),
		"port", iceCandidatePort(candidate),
		"relatedAddress", iceCandidateRelatedAddress(candidate),
		"relatedPort", iceCandidateRelatedPort(candidate),
	)
}

func logRemoteICECandidate(component string, peerKey string, peerID string, candidate webrtc.ICECandidateInit) {
	candidateType, protocol, address, port, relatedAddress, relatedPort := summarizeICECandidateInit(candidate)
	tunnelInfo(component+" remote ICE candidate received",
		peerKey, peerID,
		"candidateType", candidateType,
		"protocol", protocol,
		"address", address,
		"port", port,
		"relatedAddress", relatedAddress,
		"relatedPort", relatedPort,
		"sdpMid", candidate.SDPMid,
		"sdpMLineIndex", candidate.SDPMLineIndex,
	)
}

func summarizeICECandidateInit(candidate webrtc.ICECandidateInit) (string, string, string, string, string, string) {
	fields := strings.Fields(candidate.Candidate)
	if len(fields) < 8 {
		return "", "", "", "", "", ""
	}

	protocol := strings.ToLower(fields[2])
	address := fields[4]
	port := fields[5]
	candidateType := ""
	relatedAddress := ""
	relatedPort := ""
	for i := 6; i < len(fields)-1; i += 2 {
		switch fields[i] {
		case "typ":
			candidateType = fields[i+1]
		case "raddr":
			relatedAddress = fields[i+1]
		case "rport":
			relatedPort = fields[i+1]
		}
	}
	return candidateType, protocol, address, port, relatedAddress, relatedPort
}

// StartTunnel runs the WebRTC + Yamux tunnel and returns the local TCP port it listens on.
// If it fails, it returns -1.
func StartTunnel(signalingURL, clientID, targetClientID, token, pairingToken, iceServersJSON string) int {
	activeMu.Lock()
	defer activeMu.Unlock()

	resetCurrentSelectedICERoute()
	if activeTunnel != nil {
		activeTunnel.Stop()
	}

	ctx, cancel := context.WithCancel(context.Background())
	t := &Tunnel{
		ctx:        ctx,
		cancel:     cancel,
		iceServers: parseICEServersJSON(iceServersJSON),
		readyChan:  make(chan int, 1),
	}
	activeTunnel = t

	port, err := t.start(signalingURL, clientID, targetClientID, token, pairingToken)
	if err != nil {
		tunnelError("failed to start mobile tunnel", "err", err)
		t.Stop()
		return -1
	}

	return port
}

// StopTunnel stops the currently running P2P tunnel.
func StopTunnel() {
	activeMu.Lock()
	defer activeMu.Unlock()

	if activeTunnel != nil {
		activeTunnel.Stop()
		activeTunnel = nil
	}
	resetCurrentSelectedICERoute()
}

func (t *Tunnel) Stop() {
	t.mu.Lock()
	if t.isClosed {
		t.mu.Unlock()
		return
	}
	t.isClosed = true
	t.mu.Unlock()

	t.cancel()

	if t.listener != nil {
		t.listener.Close()
	}
	if t.yamuxSess != nil {
		t.yamuxSess.Close()
	}
	if t.pc != nil {
		t.pc.Close()
	}
}

func (t *Tunnel) start(signalingURL, clientID, targetClientID, token, pairingToken string) (int, error) {
	// 1. Start local TCP loopback listener
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return -1, err
	}
	t.listener = listener
	t.localPort = listener.Addr().(*net.TCPAddr).Port

	// 2. Start background thread to handle signaling and connection
	go t.runSignalingAndBridge(signalingURL, clientID, targetClientID, token, pairingToken)

	select {
	case port := <-t.readyChan:
		return port, nil
	case <-time.After(tunnelStartupTimeout):
		return -1, fmt.Errorf("tunnel startup timed out after %s", tunnelStartupTimeout)
	case <-t.ctx.Done():
		return -1, context.Canceled
	}
}

func (t *Tunnel) runSignalingAndBridge(signalingURL, clientID, targetClientID, token, pairingToken string) {
	wsURL := signalingURL
	if strings.HasPrefix(wsURL, "https://") {
		wsURL = "wss://" + strings.TrimPrefix(wsURL, "https://")
	} else if strings.HasPrefix(wsURL, "http://") {
		wsURL = "ws://" + strings.TrimPrefix(wsURL, "http://")
	}

	url := wsURL + "/api/v1/tunnel/signaling?role=mobile&clientId=" + clientID + "&targetClientId=" + targetClientID + "&pairingToken=" + pairingToken + "&token=" + token

	dialer := websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
		NetDialContext:   dialSignalingContext,
	}

	for {
		select {
		case <-t.ctx.Done():
			return
		default:
		}

		conn, resp, err := dialer.Dial(url, nil)
		if err != nil {
			tunnelWarn("mobile signaling dial failed, retrying in 5s", "err", wsdial.DescribeDialFailure(err, resp))
			select {
			case <-time.After(5 * time.Second):
				continue
			case <-t.ctx.Done():
				return
			}
		}

		t.mu.Lock()
		if t.isClosed {
			conn.Close()
			t.mu.Unlock()
			return
		}
		t.mu.Unlock()

		err = t.establishWebRTCTunnel(conn, clientID, targetClientID)
		conn.Close()

		if err != nil {
			tunnelError("WebRTC tunnel disconnected with error, reconnecting in 5s", "err", err)
			select {
			case <-time.After(5 * time.Second):
				continue
			case <-t.ctx.Done():
				return
			}
		}
	}
}

func dialSignalingContext(ctx context.Context, network, addr string) (net.Conn, error) {
	host, port, splitErr := net.SplitHostPort(addr)
	if splitErr == nil {
		if conn, err := dialNAT64Context(ctx, host, port); err == nil {
			return conn, nil
		} else if !errors.Is(err, errNoNAT64Prefix) {
			tunnelWarn("mobile signaling NAT64 fallback failed", "host", host, "err", err)
		}
	}

	var dialer net.Dialer
	return dialer.DialContext(ctx, network, addr)
}

var errNoNAT64Prefix = errors.New("NAT64 prefix unavailable")

func dialNAT64Context(ctx context.Context, host, port string) (net.Conn, error) {
	prefix, err := lookupNAT64Prefix(ctx)
	if err != nil {
		return nil, err
	}

	targets, err := nat64DialTargets(ctx, host, port, prefix)
	if err != nil {
		return nil, err
	}

	var errs []string
	for _, target := range targets {
		dialCtx, cancel := context.WithTimeout(ctx, nat64DialTimeout)
		var dialer net.Dialer
		conn, dialErr := dialer.DialContext(dialCtx, "tcp6", target)
		cancel()
		if dialErr == nil {
			tunnelInfo("mobile signaling connected through NAT64", "target", target)
			return conn, nil
		}
		errs = append(errs, dialErr.Error())
	}

	if len(errs) == 0 {
		return nil, fmt.Errorf("no NAT64 dial targets for host %s", host)
	}
	return nil, fmt.Errorf("NAT64 dial attempts failed: %s", strings.Join(errs, "; "))
}

func lookupNAT64Prefix(ctx context.Context) (*nat64Prefix, error) {
	lookupCtx, cancel := context.WithTimeout(ctx, nat64LookupTimeout)
	defer cancel()

	records, err := net.DefaultResolver.LookupIPAddr(lookupCtx, "ipv4only.arpa")
	if err != nil {
		return nil, errNoNAT64Prefix
	}

	prefix := nat64PrefixFromIPv4OnlyArpa(records)
	if prefix == nil {
		return nil, errNoNAT64Prefix
	}
	return prefix, nil
}

func nat64DialTargets(ctx context.Context, host, port string, prefix *nat64Prefix) ([]string, error) {
	var ips []net.IPAddr
	if parsed := net.ParseIP(host); parsed != nil {
		ips = []net.IPAddr{{IP: parsed}}
	} else {
		resolved, err := net.DefaultResolver.LookupIPAddr(ctx, host)
		if err != nil {
			return nil, err
		}
		ips = resolved
	}

	targets := make([]string, 0, len(ips))
	seen := make(map[string]struct{})
	appendTarget := func(ip net.IP) {
		if ip == nil {
			return
		}
		target := net.JoinHostPort(ip.String(), port)
		if _, ok := seen[target]; ok {
			return
		}
		seen[target] = struct{}{}
		targets = append(targets, target)
	}

	for _, addr := range ips {
		if ipv4 := addr.IP.To4(); ipv4 != nil {
			appendTarget(synthesizeNAT64Address(prefix, ipv4))
			continue
		}
		if ipv6 := addr.IP.To16(); ipv6 != nil {
			appendTarget(ipv6)
		}
	}

	return targets, nil
}

func nat64PrefixFromIPv4OnlyArpa(records []net.IPAddr) *nat64Prefix {
	for _, record := range records {
		ip := record.IP.To16()
		if ip == nil || record.IP.To4() != nil {
			continue
		}

		for _, length := range nat64PrefixLengths {
			prefix := nat64PrefixFromSynthesizedAddress(ip, length)
			if prefix == nil {
				continue
			}
			return prefix
		}
	}
	return nil
}

func nat64PrefixFromSynthesizedAddress(ip net.IP, length int) *nat64Prefix {
	prefixBytes := length / 8
	prefix := make(net.IP, net.IPv6len)
	copy(prefix, ip[:prefixBytes])

	candidatePrefix := &nat64Prefix{IP: prefix, Length: length}
	for _, marker := range []net.IP{net.IPv4(192, 0, 0, 170), net.IPv4(192, 0, 0, 171)} {
		if synthesized := synthesizeNAT64Address(candidatePrefix, marker); synthesized != nil && synthesized.Equal(ip) {
			return candidatePrefix
		}
	}
	return nil
}

func synthesizeNAT64Address(prefix *nat64Prefix, ipv4 net.IP) net.IP {
	if prefix == nil {
		return nil
	}

	prefix16 := prefix.IP.To16()
	ipv4Bytes := ipv4.To4()
	if prefix16 == nil || ipv4Bytes == nil {
		return nil
	}

	ipv4Offset, ok := nat64IPv4Offset(prefix.Length)
	if !ok {
		return nil
	}

	ip := make(net.IP, net.IPv6len)
	copy(ip, prefix16[:prefix.Length/8])
	copy(ip[ipv4Offset:], ipv4Bytes)
	return ip
}

func nat64IPv4Offset(prefixLength int) (int, bool) {
	switch prefixLength {
	case 32, 40, 48, 56:
		return prefixLength / 8, true
	case 64:
		return 9, true
	case 96:
		return 12, true
	default:
		return 0, false
	}
}

func (t *Tunnel) establishWebRTCTunnel(wsConn *websocket.Conn, clientID, targetClientID string) error {
	sConn := &safeWriteConn{conn: wsConn}

	// Configure ping/pong keepalive
	wsConn.SetReadDeadline(time.Now().Add(pongWait))
	wsConn.SetPongHandler(func(string) error {
		wsConn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	tickerCtx, tickerCancel := context.WithCancel(t.ctx)
	defer tickerCancel()

	go func() {
		ticker := time.NewTicker(pingPeriod)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				if err := sConn.WriteControl(websocket.PingMessage, []byte{}, time.Now().Add(writeWait)); err != nil {
					tunnelWarn("mobile signaling write ping failed, closing connection", "err", err)
					wsConn.Close()
					return
				}
			case <-tickerCtx.Done():
				return
			}
		}
	}()

	config := webrtc.Configuration{
		ICEServers: t.iceServers,
	}

	pc, err := webrtc.NewPeerConnection(config)
	if err != nil {
		return err
	}
	t.pc = pc
	defer pc.Close()
	registerICELogging(pc, "mobile tunnel", "targetClientId", targetClientID, t.iceServers)

	// Handle ICE candidates from desktop
	pc.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c == nil {
			return
		}
		logLocalICECandidate("mobile tunnel", "targetClientId", targetClientID, c)
		candBytes, err := json.Marshal(c.ToJSON())
		if err != nil {
			return
		}
		msg, _ := json.Marshal(map[string]string{
			"type":       "candidate",
			"payload":    string(candBytes),
			"senderId":   clientID,
			"receiverId": targetClientID,
		})
		sConn.WriteMessage(websocket.TextMessage, msg)
	})

	ordered := true
	dc, err := pc.CreateDataChannel("yamux-tunnel", &webrtc.DataChannelInit{
		Ordered: &ordered,
	})
	if err != nil {
		return err
	}

	offer, err := pc.CreateOffer(nil)
	if err != nil {
		return err
	}

	err = pc.SetLocalDescription(offer)
	if err != nil {
		return err
	}

	offerMsg, _ := json.Marshal(map[string]string{
		"type":       "offer",
		"payload":    offer.SDP,
		"senderId":   clientID,
		"receiverId": targetClientID,
	})
	err = sConn.WriteMessage(websocket.TextMessage, offerMsg)
	if err != nil {
		return err
	}

	// Channel to signal tunnel completion or failure
	tunnelErrChan := make(chan error, 1)

	dc.OnOpen(func() {
		logCurrentSelectedICECandidatePair(pc, "mobile tunnel", "targetClientId", targetClientID, "data_channel_open")
		wrapper := protocol.NewDataChannelWrapper(dc)
		session, err := yamux.Client(wrapper, nil)
		if err != nil {
			tunnelErrChan <- err
			return
		}
		t.mu.Lock()
		t.yamuxSess = session
		t.mu.Unlock()
		t.signalReady()

		go func() {
			err := t.bridgeTCPToYamux(session)
			tunnelErrChan <- err
		}()
	})

	// Read loop for signaling messages (Answer & candidates)
	go func() {
		for {
			_, msgBytes, err := wsConn.ReadMessage()
			if err != nil {
				tunnelErrChan <- err
				return
			}
			var signal map[string]interface{}
			if err := json.Unmarshal(msgBytes, &signal); err != nil {
				continue
			}
			msgType, _ := signal["type"].(string)
			payload, _ := signal["payload"].(string)

			if msgType == "answer" {
				err = pc.SetRemoteDescription(webrtc.SessionDescription{
					Type: webrtc.SDPTypeAnswer,
					SDP:  payload,
				})
				if err != nil {
					tunnelErrChan <- err
					return
				}
			} else if msgType == "candidate" {
				var cand webrtc.ICECandidateInit
				if err := json.Unmarshal([]byte(payload), &cand); err == nil {
					logRemoteICECandidate("mobile tunnel", "targetClientId", targetClientID, cand)
					if err := pc.AddICECandidate(cand); err != nil {
						tunnelError("mobile tunnel failed to add remote ICE candidate", "targetClientId", targetClientID, "err", err)
					}
				}
			}
		}
	}()

	select {
	case <-t.ctx.Done():
		return nil
	case err := <-tunnelErrChan:
		return err
	}
}

func (t *Tunnel) signalReady() {
	t.readyOnce.Do(func() {
		select {
		case t.readyChan <- t.localPort:
		default:
		}
	})
}

func (t *Tunnel) bridgeTCPToYamux(session *yamux.Session) error {
	defer session.Close()

	for {
		localConn, err := t.listener.Accept()
		if err != nil {
			return err
		}

		select {
		case <-t.ctx.Done():
			localConn.Close()
			return nil
		default:
		}

		go func(tcpConn net.Conn) {
			defer tcpConn.Close()

			stream, err := session.Open()
			if err != nil {
				tunnelError("failed to open Yamux stream", "err", err)
				return
			}
			defer stream.Close()

			var wg sync.WaitGroup
			wg.Add(2)

			go func() {
				defer wg.Done()
				io.Copy(stream, tcpConn)
				stream.Close()
				tcpConn.Close()
			}()

			go func() {
				defer wg.Done()
				io.Copy(tcpConn, stream)
				stream.Close()
				tcpConn.Close()
			}()

			wg.Wait()
		}(localConn)
	}
}

type safeWriteConn struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

func (s *safeWriteConn) WriteMessage(messageType int, data []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.conn.WriteMessage(messageType, data)
}

func (s *safeWriteConn) WriteControl(messageType int, data []byte, deadline time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.conn.WriteControl(messageType, data, deadline)
}
