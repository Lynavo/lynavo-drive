package protocol

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/hashicorp/yamux"
	"github.com/nicksyncflow/sidecar/internal/wsdial"
	"github.com/pion/logging"
	"github.com/pion/webrtc/v4"
)

type P2PManager struct {
	desktopID    string
	serverURL    string
	localAddress string
	authToken    string
	iceServers   []webrtc.ICEServer
	signalingCtx context.Context
	cancel       context.CancelFunc

	mu            sync.Mutex
	pairedDevices []map[string]string
	signalingConn *safeWriteConn
	authState     SignalingAuthState
}

const DefaultSTUNServer = "stun:stun.cloudflare.com:3478"

type SignalingAuthState string

const (
	SignalingAuthOK              SignalingAuthState = "ok"
	SignalingAuthRefreshRequired SignalingAuthState = "refresh_required"
)

const (
	writeWait  = 10 * time.Second
	pongWait   = 60 * time.Second
	pingPeriod = (pongWait * 9) / 10
)

type iceServerPayload struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username"`
	Credential string   `json:"credential"`
}

type iceRouteMode string

const (
	iceRouteModeAll   iceRouteMode = "all"
	iceRouteModeWAN   iceRouteMode = "wan"
	iceRouteModeRelay iceRouteMode = "relay"
)

var (
	iceURLUserInfoPattern     = regexp.MustCompile(`(?i)\b(turns?:)(//)?[^\s@]+@`)
	iceCredentialFieldPattern = regexp.MustCompile(`(?i)\b(username|credential|password)=([^\s,;]+)`)
)

type peerConnectionState struct {
	pc        *webrtc.PeerConnection
	routeMode iceRouteMode
}

func normalizeICERouteMode(raw string) iceRouteMode {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case string(iceRouteModeWAN):
		return iceRouteModeWAN
	case string(iceRouteModeRelay):
		return iceRouteModeRelay
	default:
		return iceRouteModeAll
	}
}

func NewP2PManager(desktopID, serverURL, localAddress, authToken string) *P2PManager {
	return NewP2PManagerWithICEServers(desktopID, serverURL, localAddress, authToken, defaultICEServers())
}

func NewP2PManagerWithICEServers(desktopID, serverURL, localAddress, authToken string, iceServers []webrtc.ICEServer) *P2PManager {
	ctx, cancel := context.WithCancel(context.Background())
	iceServers = withDefaultSTUNServer(iceServers)
	return &P2PManager{
		desktopID:    desktopID,
		serverURL:    serverURL,
		localAddress: localAddress,
		authToken:    authToken,
		iceServers:   cloneICEServers(iceServers),
		signalingCtx: ctx,
		cancel:       cancel,
		authState:    SignalingAuthOK,
	}
}

func (m *P2PManager) SignalingAuthState() SignalingAuthState {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.authState
}

func (m *P2PManager) setSignalingAuthState(state SignalingAuthState) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.authState = state
}

func isInvalidSignalingTokenResponse(resp *http.Response) bool {
	if resp == nil || resp.StatusCode != http.StatusUnauthorized {
		return false
	}
	bodyBytes, err := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if err != nil {
		return false
	}
	resp.Body = io.NopCloser(strings.NewReader(string(bodyBytes)))
	body := strings.ToLower(string(bodyBytes))
	return strings.Contains(body, "invalid signaling token")
}

func ParseICEServersJSON(raw string) []webrtc.ICEServer {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || trimmed == "null" {
		return defaultICEServers()
	}

	var payloads []iceServerPayload
	if err := json.Unmarshal([]byte(trimmed), &payloads); err != nil {
		slog.Warn("failed to parse ICE servers JSON, using default STUN", "err", err)
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
	return withDefaultSTUNServer(servers)
}

func defaultICEServers() []webrtc.ICEServer {
	return []webrtc.ICEServer{{URLs: []string{DefaultSTUNServer}}}
}

func withDefaultSTUNServer(servers []webrtc.ICEServer) []webrtc.ICEServer {
	if len(servers) == 0 {
		return defaultICEServers()
	}
	if hasSTUNServer(servers) {
		return servers
	}
	return append(defaultICEServers(), servers...)
}

func hasSTUNServer(servers []webrtc.ICEServer) bool {
	for _, server := range servers {
		for _, rawURL := range server.URLs {
			if strings.HasPrefix(strings.ToLower(strings.TrimSpace(rawURL)), "stun:") {
				return true
			}
		}
	}
	return false
}

func cloneICEServers(servers []webrtc.ICEServer) []webrtc.ICEServer {
	cloned := make([]webrtc.ICEServer, 0, len(servers))
	for _, server := range servers {
		urls := append([]string(nil), server.URLs...)
		cloned = append(cloned, webrtc.ICEServer{
			URLs:           urls,
			Username:       server.Username,
			Credential:     server.Credential,
			CredentialType: server.CredentialType,
		})
	}
	return cloned
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

func sanitizePionICELogMessage(msg string) string {
	sanitized := strings.TrimSpace(msg)
	if sanitized == "" {
		return ""
	}
	sanitized = iceURLUserInfoPattern.ReplaceAllString(sanitized, `${1}${2}`)
	sanitized = iceCredentialFieldPattern.ReplaceAllString(sanitized, `${1}=<redacted>`)
	return sanitized
}

func summarizeTURNEndpoints(servers []webrtc.ICEServer) []string {
	endpoints := make([]string, 0)
	for _, server := range servers {
		for _, rawURL := range server.URLs {
			endpoint, ok := summarizeTURNEndpoint(rawURL)
			if ok {
				endpoints = append(endpoints, endpoint)
			}
		}
	}
	return endpoints
}

func summarizeTURNEndpoint(rawURL string) (string, bool) {
	trimmed := strings.TrimSpace(rawURL)
	schemeEnd := strings.Index(trimmed, ":")
	if schemeEnd <= 0 {
		return "", false
	}
	scheme := strings.ToLower(trimmed[:schemeEnd])
	if scheme != "turn" && scheme != "turns" {
		return "", false
	}

	addressAndQuery := strings.TrimPrefix(trimmed[schemeEnd+1:], "//")
	address, query, _ := strings.Cut(addressAndQuery, "?")
	if at := strings.LastIndex(address, "@"); at >= 0 {
		address = address[at+1:]
	}

	host, port := splitICEHostPort(address)
	if host == "" {
		return "", false
	}
	transport := parseICETransport(query)
	if transport == "" {
		transport = "udp"
		if scheme == "turns" {
			transport = "tcp"
		}
	}

	return fmt.Sprintf(
		"scheme=%s host=%s port=%s transport=%s literalIP=%t",
		scheme,
		host,
		port,
		transport,
		net.ParseIP(host) != nil,
	), true
}

func splitICEHostPort(address string) (string, string) {
	host, port, err := net.SplitHostPort(address)
	if err == nil {
		return strings.Trim(host, "[]"), port
	}
	if strings.HasPrefix(address, "[") {
		if end := strings.Index(address, "]"); end >= 0 {
			return strings.Trim(address[:end+1], "[]"), ""
		}
	}
	if host, port, ok := strings.Cut(address, ":"); ok && !strings.Contains(host, ":") {
		return strings.Trim(host, "[]"), port
	}
	return strings.Trim(address, "[]"), ""
}

func parseICETransport(query string) string {
	for _, pair := range strings.Split(query, "&") {
		key, value, ok := strings.Cut(pair, "=")
		if !ok {
			continue
		}
		if strings.EqualFold(key, "transport") {
			return strings.ToLower(strings.TrimSpace(value))
		}
	}
	return ""
}

type pionICELoggerFactory struct {
	component      string
	peerKey        string
	peerID         string
	routeMode      iceRouteMode
	hasTurn        bool
	hasStun        bool
	candidateStats *iceCandidateGatheringStats
}

func (f pionICELoggerFactory) NewLogger(scope string) logging.LeveledLogger {
	return pionICELogger{factory: f, scope: scope}
}

type pionICELogger struct {
	factory pionICELoggerFactory
	scope   string
}

func (l pionICELogger) Trace(string)          {}
func (l pionICELogger) Tracef(string, ...any) {}
func (l pionICELogger) Debug(string)          {}
func (l pionICELogger) Debugf(string, ...any) {}
func (l pionICELogger) Info(string)           {}
func (l pionICELogger) Infof(string, ...any)  {}

func (l pionICELogger) Warn(msg string) {
	l.log("warn", msg)
}

func (l pionICELogger) Warnf(format string, args ...any) {
	l.Warn(fmt.Sprintf(format, args...))
}

func (l pionICELogger) Error(msg string) {
	l.log("error", msg)
}

func (l pionICELogger) Errorf(format string, args ...any) {
	l.Error(fmt.Sprintf(format, args...))
}

func (l pionICELogger) log(level string, msg string) {
	message := sanitizePionICELogMessage(msg)
	if message == "" {
		return
	}
	if l.factory.candidateStats != nil {
		l.factory.candidateStats.recordPionICELog(level, l.scope, message)
	}
	args := []any{
		l.factory.peerKey, l.factory.peerID,
		"scope", l.scope,
		"routeMode", l.factory.routeMode,
		"hasTurn", l.factory.hasTurn,
		"hasStun", l.factory.hasStun,
		"pionLogLevel", level,
		"pionMessage", message,
	}
	if l.factory.candidateStats != nil {
		args = l.factory.candidateStats.snapshot().appendDiagnosticArgs(args)
	}
	if level == "error" {
		slog.Error(l.factory.component+" Pion ICE error", args...)
		return
	}
	slog.Warn(l.factory.component+" Pion ICE warning", args...)
}

func newPeerConnectionWithICELogger(config webrtc.Configuration, component string, peerKey string, peerID string, routeMode iceRouteMode) (*webrtc.PeerConnection, *iceCandidateGatheringStats, error) {
	_, hasTurn, hasStun := summarizeICEServers(config.ICEServers)
	candidateStats := &iceCandidateGatheringStats{}
	api := webrtc.NewAPI(webrtc.WithSettingEngine(webrtc.SettingEngine{
		LoggerFactory: pionICELoggerFactory{
			component:      component,
			peerKey:        peerKey,
			peerID:         peerID,
			routeMode:      routeMode,
			hasTurn:        hasTurn,
			hasStun:        hasStun,
			candidateStats: candidateStats,
		},
	}))
	pc, err := api.NewPeerConnection(config)
	if err != nil {
		return nil, nil, err
	}
	return pc, candidateStats, nil
}

func registerICELogging(pc *webrtc.PeerConnection, component string, peerKey string, peerID string, iceServers []webrtc.ICEServer, routeMode iceRouteMode, candidateStats *iceCandidateGatheringStats) *iceCandidateGatheringStats {
	urls, hasTurn, hasStun := summarizeICEServers(iceServers)
	turnEndpoints := summarizeTURNEndpoints(iceServers)
	slog.Info(component+" ICE config",
		peerKey, peerID,
		"iceServerCount", len(iceServers),
		"iceURLCount", len(urls),
		"iceURLs", strings.Join(urls, ","),
		"turnEndpointCount", len(turnEndpoints),
		"turnEndpoints", strings.Join(turnEndpoints, ";"),
		"hasTurn", hasTurn,
		"hasStun", hasStun,
		"routeMode", routeMode,
	)

	var mu sync.Mutex
	lastICEState := webrtc.ICEConnectionStateNew
	lastPeerState := webrtc.PeerConnectionStateNew
	var iceConnectedAt time.Time
	var peerConnectedAt time.Time
	lastSelectedPair := selectedPairSnapshot(nil, time.Time{})
	if candidateStats == nil {
		candidateStats = &iceCandidateGatheringStats{}
	}

	pc.OnICEConnectionStateChange(func(state webrtc.ICEConnectionState) {
		now := time.Now()
		mu.Lock()
		args := appendConnectionStateDiagnosticArgs(
			[]any{peerKey, peerID, "state", state.String()},
			lastICEState.String(),
			iceConnectedAt,
			lastSelectedPair,
			now,
		)
		if state == webrtc.ICEConnectionStateConnected {
			iceConnectedAt = now
		}
		lastICEState = state
		mu.Unlock()
		slog.Info(component+" ICE connection state changed", args...)
	})
	pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		now := time.Now()
		mu.Lock()
		args := appendConnectionStateDiagnosticArgs(
			[]any{peerKey, peerID, "state", state.String()},
			lastPeerState.String(),
			peerConnectedAt,
			lastSelectedPair,
			now,
		)
		if state == webrtc.PeerConnectionStateConnected {
			peerConnectedAt = now
		}
		lastPeerState = state
		mu.Unlock()
		slog.Info(component+" peer connection state changed", args...)
	})
	pc.OnICEGatheringStateChange(func(state webrtc.ICEGatheringState) {
		stats := candidateStats.snapshot()
		args := stats.appendDiagnosticArgs([]any{
			peerKey, peerID,
			"state", state.String(),
			"routeMode", routeMode,
			"hasTurn", hasTurn,
			"hasStun", hasStun,
		})
		slog.Info(component+" ICE gathering state changed", args...)
		if state == webrtc.ICEGatheringStateComplete && stats.missingRelayCandidate(routeMode, hasTurn) {
			slog.Warn(component+" relay ICE gathering completed without relay candidates", args...)
		}
	})

	transport := peerConnectionICETransport(pc)
	if transport == nil {
		slog.Warn(component+" ICE transport unavailable for selected pair logging", peerKey, peerID)
		return candidateStats
	}
	transport.OnSelectedCandidatePairChange(func(pair *webrtc.ICECandidatePair) {
		now := time.Now()
		mu.Lock()
		lastSelectedPair = selectedPairSnapshot(pair, now)
		mu.Unlock()
		logSelectedICECandidatePair(component+" ICE selected candidate pair changed", pair, peerKey, peerID, "reason", "selected_pair_change")
	})
	return candidateStats
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
		slog.Warn(component+" ICE selected candidate pair unavailable", peerKey, peerID, "reason", reason, "err", "ice transport unavailable")
		return
	}
	pair, err := transport.GetSelectedCandidatePair()
	if err != nil {
		slog.Warn(component+" ICE selected candidate pair unavailable", peerKey, peerID, "reason", reason, "err", err)
		return
	}
	logSelectedICECandidatePair(component+" ICE selected candidate pair", pair, peerKey, peerID, "reason", reason)
}

func logSelectedICECandidatePair(message string, pair *webrtc.ICECandidatePair, baseArgs ...any) {
	args := append([]any{}, baseArgs...)
	args = append(args,
		"route", selectedICERoute(pair),
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
	slog.Info(message, args...)
}

type icePairSnapshot struct {
	route          string
	localType      string
	localProtocol  string
	localAddress   string
	localPort      uint16
	remoteType     string
	remoteProtocol string
	remoteAddress  string
	remotePort     uint16
	selectedAt     time.Time
}

func selectedPairSnapshot(pair *webrtc.ICECandidatePair, selectedAt time.Time) icePairSnapshot {
	return icePairSnapshot{
		route:          selectedICERoute(pair),
		localType:      iceCandidateType(pairLocal(pair)),
		localProtocol:  iceCandidateProtocol(pairLocal(pair)),
		localAddress:   iceCandidateAddress(pairLocal(pair)),
		localPort:      iceCandidatePort(pairLocal(pair)),
		remoteType:     iceCandidateType(pairRemote(pair)),
		remoteProtocol: iceCandidateProtocol(pairRemote(pair)),
		remoteAddress:  iceCandidateAddress(pairRemote(pair)),
		remotePort:     iceCandidatePort(pairRemote(pair)),
		selectedAt:     selectedAt,
	}
}

func appendConnectionStateDiagnosticArgs(args []any, previousState string, connectedAt time.Time, pair icePairSnapshot, now time.Time) []any {
	args = append(args,
		"previousState", previousState,
		"connectedForMs", elapsedMilliseconds(connectedAt, now),
	)
	return appendSelectedPairSnapshotArgs(args, pair, now)
}

func appendSelectedPairSnapshotArgs(args []any, pair icePairSnapshot, now time.Time) []any {
	return append(args,
		"lastSelectedRoute", pair.route,
		"lastSelectedLocalType", pair.localType,
		"lastSelectedLocalProtocol", pair.localProtocol,
		"lastSelectedLocalAddress", pair.localAddress,
		"lastSelectedLocalPort", pair.localPort,
		"lastSelectedRemoteType", pair.remoteType,
		"lastSelectedRemoteProtocol", pair.remoteProtocol,
		"lastSelectedRemoteAddress", pair.remoteAddress,
		"lastSelectedRemotePort", pair.remotePort,
		"selectedPairAgeMs", elapsedMilliseconds(pair.selectedAt, now),
	)
}

func elapsedMilliseconds(start time.Time, now time.Time) int64 {
	if start.IsZero() || now.Before(start) {
		return -1
	}
	return now.Sub(start).Milliseconds()
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
		return selectedHostICERoute(local.Address, remote.Address)
	}
	return "direct_reflexive"
}

func selectedHostICERoute(localAddress string, remoteAddress string) string {
	localIP := net.ParseIP(localAddress)
	remoteIP := net.ParseIP(remoteAddress)
	if localIP == nil || remoteIP == nil {
		return "direct_host"
	}
	if isLinkLocalIP(localIP) || isLinkLocalIP(remoteIP) {
		return "link_local_direct"
	}
	if isPrivateIPv4(localIP) && isPrivateIPv4(remoteIP) {
		return "lan_direct"
	}
	if isPublicIPv6(localIP) && isPublicIPv6(remoteIP) {
		return "ipv6_direct"
	}
	if isPublicIPv4(localIP) && isPublicIPv4(remoteIP) {
		return "public_ipv4_direct"
	}
	return "direct_host"
}

func isPrivateIPv4(ip net.IP) bool {
	return ip.To4() != nil && ip.IsPrivate()
}

func isPublicIPv6(ip net.IP) bool {
	return ip.To4() == nil && ip.IsGlobalUnicast() && !ip.IsPrivate() && !ip.IsLinkLocalUnicast()
}

func isPublicIPv4(ip net.IP) bool {
	return ip.To4() != nil && ip.IsGlobalUnicast() && !ip.IsPrivate() && !ip.IsLinkLocalUnicast() && !ip.IsLoopback()
}

func isLinkLocalIP(ip net.IP) bool {
	return ip.IsLinkLocalUnicast()
}

func isPublicRoutableIP(ip net.IP) bool {
	if ip == nil {
		return false
	}
	return isPublicIPv4(ip) || isPublicIPv6(ip)
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
	slog.Info(component+" local ICE candidate gathered",
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
	slog.Info(component+" remote ICE candidate received",
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

type iceCandidateGatheringStats struct {
	mu sync.Mutex

	localCandidateCount           int
	localHostCandidateCount       int
	localSrflxCandidateCount      int
	localPrflxCandidateCount      int
	localRelayCandidateCount      int
	localSuppressedCandidateCount int
	pionICEWarnCount              int
	pionICEErrorCount             int
	lastPionICELogLevel           string
	lastPionICELogScope           string
	lastPionICELogMessage         string
}

type iceCandidateGatheringStatsSnapshot struct {
	localCandidateCount           int
	localHostCandidateCount       int
	localSrflxCandidateCount      int
	localPrflxCandidateCount      int
	localRelayCandidateCount      int
	localSuppressedCandidateCount int
	pionICEWarnCount              int
	pionICEErrorCount             int
	lastPionICELogLevel           string
	lastPionICELogScope           string
	lastPionICELogMessage         string
}

func (s *iceCandidateGatheringStats) recordLocalCandidate(candidate *webrtc.ICECandidate, signaled bool) {
	if s == nil || candidate == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	s.localCandidateCount++
	switch candidate.Typ {
	case webrtc.ICECandidateTypeHost:
		s.localHostCandidateCount++
	case webrtc.ICECandidateTypeSrflx:
		s.localSrflxCandidateCount++
	case webrtc.ICECandidateTypePrflx:
		s.localPrflxCandidateCount++
	case webrtc.ICECandidateTypeRelay:
		s.localRelayCandidateCount++
	}
	if !signaled {
		s.localSuppressedCandidateCount++
	}
}

func (s *iceCandidateGatheringStats) recordPionICELog(level string, scope string, message string) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	switch level {
	case "error":
		s.pionICEErrorCount++
	default:
		s.pionICEWarnCount++
	}
	s.lastPionICELogLevel = level
	s.lastPionICELogScope = scope
	s.lastPionICELogMessage = message
}

func (s *iceCandidateGatheringStats) snapshot() iceCandidateGatheringStatsSnapshot {
	if s == nil {
		return iceCandidateGatheringStatsSnapshot{}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return iceCandidateGatheringStatsSnapshot{
		localCandidateCount:           s.localCandidateCount,
		localHostCandidateCount:       s.localHostCandidateCount,
		localSrflxCandidateCount:      s.localSrflxCandidateCount,
		localPrflxCandidateCount:      s.localPrflxCandidateCount,
		localRelayCandidateCount:      s.localRelayCandidateCount,
		localSuppressedCandidateCount: s.localSuppressedCandidateCount,
		pionICEWarnCount:              s.pionICEWarnCount,
		pionICEErrorCount:             s.pionICEErrorCount,
		lastPionICELogLevel:           s.lastPionICELogLevel,
		lastPionICELogScope:           s.lastPionICELogScope,
		lastPionICELogMessage:         s.lastPionICELogMessage,
	}
}

func (s *iceCandidateGatheringStats) missingRelayCandidate(routeMode iceRouteMode, hasTurn bool) bool {
	if s == nil {
		return false
	}
	return s.snapshot().missingRelayCandidate(routeMode, hasTurn)
}

func (s iceCandidateGatheringStatsSnapshot) missingRelayCandidate(routeMode iceRouteMode, hasTurn bool) bool {
	return routeMode == iceRouteModeRelay && hasTurn && s.localRelayCandidateCount == 0
}

func (s iceCandidateGatheringStatsSnapshot) appendDiagnosticArgs(args []any) []any {
	return append(args,
		"localCandidateCount", s.localCandidateCount,
		"localHostCandidateCount", s.localHostCandidateCount,
		"localSrflxCandidateCount", s.localSrflxCandidateCount,
		"localPrflxCandidateCount", s.localPrflxCandidateCount,
		"localRelayCandidateCount", s.localRelayCandidateCount,
		"localSuppressedCandidateCount", s.localSuppressedCandidateCount,
		"pionICEWarnCount", s.pionICEWarnCount,
		"pionICEErrorCount", s.pionICEErrorCount,
		"lastPionICELogLevel", s.lastPionICELogLevel,
		"lastPionICELogScope", s.lastPionICELogScope,
		"lastPionICELogMessage", s.lastPionICELogMessage,
	)
}

func shouldSignalICECandidate(routeMode iceRouteMode, candidate *webrtc.ICECandidate) bool {
	if candidate == nil || routeMode == iceRouteModeAll {
		return true
	}
	if routeMode == iceRouteModeRelay {
		return candidate.Typ == webrtc.ICECandidateTypeRelay
	}
	if candidate.Typ != webrtc.ICECandidateTypeHost {
		return true
	}
	return isPublicRoutableIP(net.ParseIP(candidate.Address))
}

func shouldAcceptRemoteICECandidate(routeMode iceRouteMode, candidate webrtc.ICECandidateInit) bool {
	if routeMode == iceRouteModeAll {
		return true
	}
	candidateType, _, address, _, _, _ := summarizeICECandidateInit(candidate)
	if routeMode == iceRouteModeRelay {
		return candidateType == "relay"
	}
	if candidateType != "host" {
		return true
	}
	return isPublicRoutableIP(net.ParseIP(address))
}

func webrtcConfigurationForRouteMode(iceServers []webrtc.ICEServer, routeMode iceRouteMode) webrtc.Configuration {
	config := webrtc.Configuration{
		ICEServers: iceServers,
	}
	if routeMode == iceRouteModeRelay {
		config.ICETransportPolicy = webrtc.ICETransportPolicyRelay
	}
	return config
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

func (m *P2PManager) Start(pairedDevices []map[string]string) {
	m.mu.Lock()
	m.pairedDevices = clonePairedDevices(pairedDevices)
	m.mu.Unlock()
	go m.connectSignaling()
}

func (m *P2PManager) Stop() {
	m.cancel()
}

func (m *P2PManager) UpdatePairedDevices(pairedDevices []map[string]string) error {
	paired := clonePairedDevices(pairedDevices)

	m.mu.Lock()
	m.pairedDevices = paired
	conn := m.signalingConn
	m.mu.Unlock()

	if conn == nil {
		return nil
	}
	if err := m.sendDesktopRegistration(conn, paired); err != nil {
		slog.Warn("failed to refresh desktop signaling paired devices", "pairedDevices", len(paired), "err", err)
		return err
	}
	slog.Info("desktop signaling paired devices refreshed", "pairedDevices", len(paired))
	return nil
}

func (m *P2PManager) connectSignaling() {
	slog.Info("connectSignaling entry point reached", "serverURL", m.serverURL, "desktopID", m.desktopID)
	dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second}

	wsURL := m.serverURL
	if strings.HasPrefix(wsURL, "https://") {
		wsURL = "wss://" + strings.TrimPrefix(wsURL, "https://")
	} else if strings.HasPrefix(wsURL, "http://") {
		wsURL = "ws://" + strings.TrimPrefix(wsURL, "http://")
	}
	url := wsURL + "/api/v1/tunnel/signaling?role=desktop&clientId=" + m.desktopID + "&token=" + m.authToken
	slog.Info("connectSignaling constructed dial URL", "serverURL", wsURL, "clientId", m.desktopID, "hasToken", m.authToken != "")

	backoff := time.Second
	const maxBackoff = 60 * time.Second

	for {
		select {
		case <-m.signalingCtx.Done():
			slog.Info("connectSignaling context cancelled, exiting loop")
			return
		default:
		}

		slog.Info("connectSignaling calling dialer.Dial")
		conn, resp, err := dialer.Dial(url, nil)
		invalidSignalingToken := isInvalidSignalingTokenResponse(resp)
		dialErr := wsdial.DescribeDialFailure(err, resp)
		slog.Info("connectSignaling dialer.Dial completed", "err", dialErr)
		if err != nil {
			if invalidSignalingToken {
				m.setSignalingAuthState(SignalingAuthRefreshRequired)
			}
			slog.Warn("signaling dial failed, retrying", "backoff", backoff, "err", dialErr)
			select {
			case <-time.After(backoff):
			case <-m.signalingCtx.Done():
				return
			}
			backoff = min(backoff*2, maxBackoff)
			continue
		}
		m.setSignalingAuthState(SignalingAuthOK)
		backoff = time.Second // reset on successful connect

		sConn := &safeWriteConn{conn: conn}
		m.setActiveSignalingConn(sConn)

		if err := m.sendDesktopRegistration(sConn, m.currentPairedDevices()); err != nil {
			slog.Warn("failed to register desktop signaling session", "err", err)
			conn.Close()
			m.clearActiveSignalingConn(sConn)
			continue
		}

		m.handleSignalingSession(sConn)
		m.clearActiveSignalingConn(sConn)
		conn.Close()

		// Brief pause before reconnecting after a clean session end
		select {
		case <-time.After(2 * time.Second):
		case <-m.signalingCtx.Done():
			return
		}
	}
}

func (m *P2PManager) currentPairedDevices() []map[string]string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return clonePairedDevices(m.pairedDevices)
}

func (m *P2PManager) setActiveSignalingConn(conn *safeWriteConn) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.signalingConn = conn
}

func (m *P2PManager) clearActiveSignalingConn(conn *safeWriteConn) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.signalingConn == conn {
		m.signalingConn = nil
	}
}

func (m *P2PManager) sendDesktopRegistration(conn *safeWriteConn, paired []map[string]string) error {
	regPayload := map[string]interface{}{
		"type":          "register_desktop",
		"clientId":      m.desktopID,
		"pairedDevices": paired,
	}
	regBytes, err := json.Marshal(regPayload)
	if err != nil {
		return err
	}
	return conn.WriteMessage(websocket.TextMessage, regBytes)
}

func clonePairedDevices(devices []map[string]string) []map[string]string {
	cloned := make([]map[string]string, 0, len(devices))
	for _, device := range devices {
		next := make(map[string]string, len(device))
		for key, value := range device {
			next[key] = value
		}
		cloned = append(cloned, next)
	}
	return cloned
}

func (m *P2PManager) handleSignalingSession(sConn *safeWriteConn) {
	peerConnections := make(map[string]peerConnectionState)
	var mu sync.Mutex

	// Configure ping/pong keepalive
	sConn.conn.SetReadDeadline(time.Now().Add(pongWait))
	sConn.conn.SetPongHandler(func(string) error {
		sConn.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	tickerCtx, tickerCancel := context.WithCancel(m.signalingCtx)
	defer tickerCancel()

	go func() {
		ticker := time.NewTicker(pingPeriod)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				if err := sConn.WriteControl(websocket.PingMessage, []byte{}, time.Now().Add(writeWait)); err != nil {
					slog.Warn("signaling write ping failed, closing connection", "err", err)
					sConn.conn.Close()
					return
				}
			case <-tickerCtx.Done():
				return
			}
		}
	}()

	// M1: Clean up all PeerConnections when the signaling session ends
	defer func() {
		mu.Lock()
		for id, state := range peerConnections {
			slog.Info("closing peer connection on session end", "mobileId", id)
			state.pc.Close()
		}
		mu.Unlock()
	}()

	for {
		_, msgBytes, err := sConn.ReadMessage()
		if err != nil {
			break
		}

		var signal map[string]interface{}
		if err := json.Unmarshal(msgBytes, &signal); err != nil {
			continue
		}

		senderID, _ := signal["senderId"].(string)
		msgType, _ := signal["type"].(string)
		payload, _ := signal["payload"].(string)
		routeMode := normalizeICERouteMode("")
		if msgType == "offer" {
			if rawRouteMode, _ := signal["routeMode"].(string); rawRouteMode != "" {
				routeMode = normalizeICERouteMode(rawRouteMode)
			}
		}

		mu.Lock()
		state, exists := peerConnections[senderID]
		if msgType == "offer" && exists {
			slog.Info("replacing existing peer connection for new tunnel offer",
				"mobileId", senderID,
				"connectionState", state.pc.ConnectionState().String(),
				"signalingState", state.pc.SignalingState().String(),
				"previousRouteMode", state.routeMode,
				"nextRouteMode", routeMode,
			)
			state.pc.Close()
			delete(peerConnections, senderID)
			exists = false
		}
		if exists && (state.pc.ConnectionState() == webrtc.PeerConnectionStateClosed || state.pc.ConnectionState() == webrtc.PeerConnectionStateFailed) {
			slog.Info("discarding closed or failed peer connection", "mobileId", senderID, "state", state.pc.ConnectionState().String(), "routeMode", state.routeMode)
			state.pc.Close()
			delete(peerConnections, senderID)
			exists = false
		}
		if !exists {
			pc, err := m.createPeerConnection(sConn, senderID, routeMode)
			if err != nil {
				mu.Unlock()
				continue
			}
			state = peerConnectionState{
				pc:        pc,
				routeMode: routeMode,
			}
			peerConnections[senderID] = state
		}
		pc := state.pc
		routeMode = state.routeMode
		mu.Unlock()

		if msgType == "offer" {
			err := pc.SetRemoteDescription(webrtc.SessionDescription{
				Type: webrtc.SDPTypeOffer,
				SDP:  payload,
			})
			if err != nil {
				slog.Error("failed to set remote description", "err", err, "mobileId", senderID)
				continue
			}
			answer, err := pc.CreateAnswer(nil)
			if err != nil {
				slog.Error("failed to create answer", "err", err, "mobileId", senderID)
				continue
			}
			err = pc.SetLocalDescription(answer)
			if err != nil {
				slog.Error("failed to set local description", "err", err, "mobileId", senderID)
				continue
			}

			ansMsg, _ := json.Marshal(map[string]string{
				"type":       "answer",
				"payload":    answer.SDP,
				"senderId":   m.desktopID,
				"receiverId": senderID,
				"routeMode":  string(routeMode),
			})
			sConn.WriteMessage(websocket.TextMessage, ansMsg)
		} else if msgType == "candidate" {
			var cand webrtc.ICECandidateInit
			err := json.Unmarshal([]byte(payload), &cand)
			if err != nil {
				slog.Error("failed to unmarshal ice candidate", "err", err, "mobileId", senderID)
				continue
			}
			logRemoteICECandidate("desktop tunnel", "mobileId", senderID, cand)
			if !shouldAcceptRemoteICECandidate(routeMode, cand) {
				candidateType, _, address, _, _, _ := summarizeICECandidateInit(cand)
				slog.Info("desktop tunnel remote ICE candidate suppressed",
					"mobileId", senderID,
					"routeMode", routeMode,
					"candidateType", candidateType,
					"address", address,
				)
				continue
			}
			err = pc.AddICECandidate(cand)
			if err != nil {
				slog.Error("failed to add ice candidate", "err", err, "mobileId", senderID)
				continue
			}
		}
	}
}

func (m *P2PManager) createPeerConnection(signalingConn *safeWriteConn, mobileID string, routeMode iceRouteMode) (*webrtc.PeerConnection, error) {
	config := webrtcConfigurationForRouteMode(cloneICEServers(m.iceServers), routeMode)

	pc, candidateStats, err := newPeerConnectionWithICELogger(config, "desktop tunnel", "mobileId", mobileID, routeMode)
	if err != nil {
		return nil, err
	}
	candidateStats = registerICELogging(pc, "desktop tunnel", "mobileId", mobileID, config.ICEServers, routeMode, candidateStats)

	pc.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c == nil {
			return
		}
		logLocalICECandidate("desktop tunnel", "mobileId", mobileID, c)
		signaled := shouldSignalICECandidate(routeMode, c)
		candidateStats.recordLocalCandidate(c, signaled)
		if !signaled {
			slog.Info("desktop tunnel local ICE candidate suppressed",
				"mobileId", mobileID,
				"routeMode", routeMode,
				"candidateType", iceCandidateType(c),
				"address", iceCandidateAddress(c),
			)
			return
		}
		candBytes, err := json.Marshal(c.ToJSON())
		if err != nil {
			slog.Error("failed to marshal candidate payload", "err", err, "mobileId", mobileID)
			return
		}
		msg, err := json.Marshal(map[string]string{
			"type":       "candidate",
			"payload":    string(candBytes),
			"senderId":   m.desktopID,
			"receiverId": mobileID,
		})
		if err != nil {
			slog.Error("failed to marshal candidate signaling envelope", "err", err, "mobileId", mobileID)
			return
		}
		err = signalingConn.WriteMessage(websocket.TextMessage, msg)
		if err != nil {
			slog.Error("failed to send candidate to mobile client", "err", err, "mobileId", mobileID)
		}
	})

	pc.OnDataChannel(func(d *webrtc.DataChannel) {
		if d.Label() == "yamux-tunnel" {
			slog.Info("desktop tunnel data channel received", "mobileId", mobileID, "label", d.Label(), "ordered", d.Ordered())
			logCurrentSelectedICECandidatePair(pc, "desktop tunnel", "mobileId", mobileID, "data_channel_received")
			d.OnOpen(func() {
				logCurrentSelectedICECandidatePair(pc, "desktop tunnel", "mobileId", mobileID, "data_channel_open")
			})
			d.OnError(func(err error) {
				slog.Error("desktop tunnel data channel error", "mobileId", mobileID, "label", d.Label(), "err", err)
				logCurrentSelectedICECandidatePair(pc, "desktop tunnel", "mobileId", mobileID, "data_channel_error")
			})
			// M4: Yamux requires TCP semantics (ordered + reliable)
			if !d.Ordered() {
				slog.Warn("yamux-tunnel DataChannel is not ordered, closing", "mobileId", mobileID)
				d.Close()
				return
			}
			// Directly start Yamux Server on receipt of incoming DataChannel since it is already open
			wrapper := NewDataChannelWrapperWithCloseHandler(d, func() {
				slog.Info("desktop tunnel data channel closed", "mobileId", mobileID, "label", d.Label())
				logCurrentSelectedICECandidatePair(pc, "desktop tunnel", "mobileId", mobileID, "data_channel_close")
			})
			session, err := yamux.Server(wrapper, nil)
			if err != nil {
				slog.Error("yamux server creation failed", "err", err, "mobileId", mobileID)
				return
			}
			go m.acceptYamuxStreams(session)
		}
	})

	return pc, nil
}

func (m *P2PManager) acceptYamuxStreams(session *yamux.Session) {
	defer session.Close()
	for {
		stream, err := session.Accept()
		if err != nil {
			break
		}
		go m.handleForwardStream(stream)
	}
}

func (m *P2PManager) handleForwardStream(stream net.Conn) {
	localConn, err := net.DialTimeout("tcp", m.localAddress, 5*time.Second)
	if err != nil {
		slog.Error("failed to connect to local sidecar HTTP server", "err", err)
		stream.Close()
		return
	}

	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		io.Copy(localConn, stream)
		localConn.Close()
		stream.Close()
	}()
	go func() {
		defer wg.Done()
		io.Copy(stream, localConn)
		localConn.Close()
		stream.Close()
	}()
	wg.Wait()
}

// DataChannelWrapper adapters webrtc.DataChannel to net.Conn interface
type DataChannelWrapper struct {
	d         *webrtc.DataChannel
	reader    *io.PipeReader
	writer    *io.PipeWriter
	writeChan chan []byte
	closedCh  chan struct{}
	closeOnce sync.Once
	mu        sync.Mutex
	closed    bool
}

func NewDataChannelWrapper(d *webrtc.DataChannel) *DataChannelWrapper {
	return NewDataChannelWrapperWithCloseHandler(d, nil)
}

func NewDataChannelWrapperWithCloseHandler(d *webrtc.DataChannel, onClose func()) *DataChannelWrapper {
	r, w := io.Pipe()
	writeChan := make(chan []byte, 1024)
	wrapper := &DataChannelWrapper{
		d:         d,
		reader:    r,
		writer:    w,
		writeChan: writeChan,
		closedCh:  make(chan struct{}),
	}

	go func() {
		for {
			select {
			case data := <-writeChan:
				if _, err := w.Write(data); err != nil {
					return
				}
			case <-wrapper.closedCh:
				return
			}
		}
	}()

	d.OnMessage(func(msg webrtc.DataChannelMessage) {
		// Copy msg.Data to prevent referencing internal memory buffers asynchronously.
		data := make([]byte, len(msg.Data))
		copy(data, msg.Data)

		wrapper.mu.Lock()
		if wrapper.closed {
			wrapper.mu.Unlock()
			return
		}
		wrapper.mu.Unlock()

		select {
		case writeChan <- data:
		case <-wrapper.closedCh:
		}
	})

	d.OnClose(func() {
		wrapper.Close()
		if onClose != nil {
			onClose()
		}
	})

	return wrapper
}

func (w *DataChannelWrapper) Read(b []byte) (int, error) { return w.reader.Read(b) }

// H2 fix: Write must send data to the remote peer via DataChannel.Send(),
// NOT into the local pipe (which would echo back to our own Read).
func (w *DataChannelWrapper) Write(b []byte) (int, error) {
	err := w.d.Send(b)
	if err != nil {
		return 0, err
	}
	return len(b), nil
}

func (w *DataChannelWrapper) Close() error {
	w.closeOnce.Do(func() {
		w.mu.Lock()
		w.closed = true
		w.mu.Unlock()

		close(w.closedCh)
		w.d.Close()
		w.reader.Close()
		w.writer.Close()
	})
	return nil
}
func (w *DataChannelWrapper) LocalAddr() net.Addr                { return &net.IPAddr{IP: net.IPv6loopback} }
func (w *DataChannelWrapper) RemoteAddr() net.Addr               { return &net.IPAddr{IP: net.IPv6loopback} }
func (w *DataChannelWrapper) SetDeadline(t time.Time) error      { return nil }
func (w *DataChannelWrapper) SetReadDeadline(t time.Time) error  { return nil }
func (w *DataChannelWrapper) SetWriteDeadline(t time.Time) error { return nil }

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

func (s *safeWriteConn) ReadMessage() (int, []byte, error) {
	// Read operations in gorilla/websocket do not require synchronization
	// if called from a single reader goroutine.
	return s.conn.ReadMessage()
}
