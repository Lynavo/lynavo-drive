package protocol

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net"
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
	signalingCtx context.Context
	cancel       context.CancelFunc
}

func NewP2PManager(desktopID, serverURL, localAddress string) *P2PManager {
	ctx, cancel := context.WithCancel(context.Background())
	return &P2PManager{
		desktopID:    desktopID,
		serverURL:    serverURL,
		localAddress: localAddress,
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
	url := m.serverURL + "/api/v1/tunnel/signaling?role=desktop&clientId=" + m.desktopID

	for {
		select {
		case <-m.signalingCtx.Done():
			return
		default:
		}

		conn, _, err := dialer.Dial(url, nil)
		if err != nil {
			time.Sleep(5 * time.Second)
			continue
		}

		// Report pairing list
		regPayload := map[string]interface{}{
			"type":          "register_desktop",
			"clientId":      m.desktopID,
			"pairedDevices": paired,
		}
		regBytes, _ := json.Marshal(regPayload)
		conn.WriteMessage(websocket.TextMessage, regBytes)

		m.handleSignalingSession(conn)
		conn.Close()
		time.Sleep(2 * time.Second)
	}
}

func (m *P2PManager) handleSignalingSession(conn *websocket.Conn) {
	peerConnections := make(map[string]*webrtc.PeerConnection)
	var mu sync.Mutex

	for {
		_, msgBytes, err := conn.ReadMessage()
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
		if !exists {
			var err error
			pc, err = m.createPeerConnection(conn, senderID)
			if err != nil {
				mu.Unlock()
				continue
			}
			peerConnections[senderID] = pc
		}
		mu.Unlock()

		if msgType == "offer" {
			pc.SetRemoteDescription(webrtc.SessionDescription{
				Type: webrtc.SDPTypeOffer,
				SDP:  payload,
			})
			answer, _ := pc.CreateAnswer(nil)
			pc.SetLocalDescription(answer)

			ansMsg, _ := json.Marshal(map[string]string{
				"type":       "answer",
				"payload":    answer.SDP,
				"senderId":   m.desktopID,
				"receiverId": senderID,
			})
			conn.WriteMessage(websocket.TextMessage, ansMsg)
		} else if msgType == "candidate" {
			var cand webrtc.ICECandidateInit
			json.Unmarshal([]byte(payload), &cand)
			pc.AddICECandidate(cand)
		}
	}
}

func (m *P2PManager) createPeerConnection(signalingConn *websocket.Conn, mobileID string) (*webrtc.PeerConnection, error) {
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
		candBytes, _ := json.Marshal(c.ToJSON())
		msg, _ := json.Marshal(map[string]string{
			"type":       "candidate",
			"payload":    string(candBytes),
			"senderId":   m.desktopID,
			"receiverId": mobileID,
		})
		signalingConn.WriteMessage(websocket.TextMessage, msg)
	})

	pc.OnDataChannel(func(d *webrtc.DataChannel) {
		if d.Label() == "yamux-tunnel" {
			d.OnOpen(func() {
				wrapper := NewDataChannelWrapper(d)
				session, err := yamux.Server(wrapper, nil)
				if err != nil {
					return
				}
				go m.acceptYamuxStreams(session)
			})
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
	defer stream.Close()
	localConn, err := net.Dial("tcp", m.localAddress)
	if err != nil {
		slog.Error("failed to connect to local sidecar HTTP server", "err", err)
		return
	}
	defer localConn.Close()

	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		io.Copy(localConn, stream)
		wg.Done()
	}()
	go func() {
		io.Copy(stream, localConn)
		wg.Done()
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
		w.Write(msg.Data)
	})
	d.OnClose(func() {
		r.Close()
		w.Close()
	})
	return &DataChannelWrapper{d: d, reader: r, writer: w}
}

func (w *DataChannelWrapper) Read(b []byte) (int, error)  { return w.reader.Read(b) }
func (w *DataChannelWrapper) Write(b []byte) (int, error) { return w.writer.Write(b) }
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
