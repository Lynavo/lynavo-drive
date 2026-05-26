package protocol

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/hashicorp/yamux"
	"github.com/pion/webrtc/v4"
)

type P2PManager struct {
	desktopID    string
	serverURL    string
	localAddress string
	authToken    string
	signalingCtx context.Context
	cancel       context.CancelFunc
}

func NewP2PManager(desktopID, serverURL, localAddress, authToken string) *P2PManager {
	ctx, cancel := context.WithCancel(context.Background())
	return &P2PManager{
		desktopID:    desktopID,
		serverURL:    serverURL,
		localAddress: localAddress,
		authToken:    authToken,
		signalingCtx: ctx,
		cancel:       cancel,
	}
}

func (m *P2PManager) Start(pairedDevices []map[string]string) {
	go m.connectSignaling(pairedDevices)
}

func (m *P2PManager) Stop() {
	m.cancel()
}

func (m *P2PManager) connectSignaling(paired []map[string]string) {
	dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second}

	wsURL := m.serverURL
	if strings.HasPrefix(wsURL, "https://") {
		wsURL = "wss://" + strings.TrimPrefix(wsURL, "https://")
	} else if strings.HasPrefix(wsURL, "http://") {
		wsURL = "ws://" + strings.TrimPrefix(wsURL, "http://")
	}
	url := wsURL + "/api/v1/tunnel/signaling?role=desktop&clientId=" + m.desktopID + "&token=" + m.authToken

	backoff := time.Second
	const maxBackoff = 60 * time.Second

	for {
		select {
		case <-m.signalingCtx.Done():
			return
		default:
		}

		conn, _, err := dialer.Dial(url, nil)
		if err != nil {
			slog.Warn("signaling dial failed, retrying", "backoff", backoff, "err", err)
			select {
			case <-time.After(backoff):
			case <-m.signalingCtx.Done():
				return
			}
			backoff = min(backoff*2, maxBackoff)
			continue
		}
		backoff = time.Second // reset on successful connect

		sConn := &safeWriteConn{conn: conn}

		// Report pairing list
		regPayload := map[string]interface{}{
			"type":          "register_desktop",
			"clientId":      m.desktopID,
			"pairedDevices": paired,
		}
		regBytes, _ := json.Marshal(regPayload)
		sConn.WriteMessage(websocket.TextMessage, regBytes)

		m.handleSignalingSession(sConn)
		conn.Close()

		// Brief pause before reconnecting after a clean session end
		select {
		case <-time.After(2 * time.Second):
		case <-m.signalingCtx.Done():
			return
		}
	}
}

func (m *P2PManager) handleSignalingSession(sConn *safeWriteConn) {
	peerConnections := make(map[string]*webrtc.PeerConnection)
	var mu sync.Mutex

	// M1: Clean up all PeerConnections when the signaling session ends
	defer func() {
		mu.Lock()
		for id, pc := range peerConnections {
			slog.Info("closing peer connection on session end", "mobileId", id)
			pc.Close()
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

		mu.Lock()
		pc, exists := peerConnections[senderID]
		if exists && (pc.ConnectionState() == webrtc.PeerConnectionStateClosed || pc.ConnectionState() == webrtc.PeerConnectionStateFailed) {
			slog.Info("discarding closed or failed peer connection", "mobileId", senderID, "state", pc.ConnectionState().String())
			pc.Close()
			exists = false
		}
		if !exists {
			var err error
			pc, err = m.createPeerConnection(sConn, senderID)
			if err != nil {
				mu.Unlock()
				continue
			}
			peerConnections[senderID] = pc
		}
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
			})
			sConn.WriteMessage(websocket.TextMessage, ansMsg)
		} else if msgType == "candidate" {
			var cand webrtc.ICECandidateInit
			err := json.Unmarshal([]byte(payload), &cand)
			if err != nil {
				slog.Error("failed to unmarshal ice candidate", "err", err, "mobileId", senderID)
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

func (m *P2PManager) createPeerConnection(signalingConn *safeWriteConn, mobileID string) (*webrtc.PeerConnection, error) {
	config := webrtc.Configuration{
		ICEServers: []webrtc.ICEServer{
			{URLs: []string{"stun:stun.cloudflare.com:3478"}},
		},
	}

	pc, err := webrtc.NewPeerConnection(config)
	if err != nil {
		return nil, err
	}

	pc.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c == nil {
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
			// M4: Yamux requires TCP semantics (ordered + reliable)
			if !d.Ordered() {
				slog.Warn("yamux-tunnel DataChannel is not ordered, closing", "mobileId", mobileID)
				d.Close()
				return
			}
			// Directly start Yamux Server on receipt of incoming DataChannel since it is already open
			wrapper := NewDataChannelWrapper(d)
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
	d      *webrtc.DataChannel
	reader *io.PipeReader
	writer *io.PipeWriter
}

func NewDataChannelWrapper(d *webrtc.DataChannel) *DataChannelWrapper {
	r, w := io.Pipe()
	d.OnMessage(func(msg webrtc.DataChannelMessage) {
		// Copy msg.Data to prevent referencing internal memory buffers asynchronously.
		// Write to PipeWriter asynchronously to prevent blocking Pion's event/read loop.
		data := make([]byte, len(msg.Data))
		copy(data, msg.Data)
		go func() {
			w.Write(data)
		}()
	})
	d.OnClose(func() {
		r.Close()
		w.Close()
	})
	return &DataChannelWrapper{d: d, reader: r, writer: w}
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
	w.d.Close()
	w.reader.Close()
	w.writer.Close()
	return nil
}
func (w *DataChannelWrapper) LocalAddr() net.Addr            { return &net.IPAddr{IP: net.IPv6loopback} }
func (w *DataChannelWrapper) RemoteAddr() net.Addr           { return &net.IPAddr{IP: net.IPv6loopback} }
func (w *DataChannelWrapper) SetDeadline(t time.Time) error  { return nil }
func (w *DataChannelWrapper) SetReadDeadline(t time.Time) error { return nil }
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

func (s *safeWriteConn) ReadMessage() (int, []byte, error) {
	// Read operations in gorilla/websocket do not require synchronization
	// if called from a single reader goroutine.
	return s.conn.ReadMessage()
}
