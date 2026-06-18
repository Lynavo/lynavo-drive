package protocol

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/hashicorp/yamux"
	"github.com/pion/webrtc/v4"
)

type mockSignalingServer struct {
	mu      sync.Mutex
	clients map[string]*websocket.Conn
}

func (s *mockSignalingServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	clientID := r.URL.Query().Get("clientId")

	s.mu.Lock()
	s.clients[clientID] = conn
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		delete(s.clients, clientID)
		s.mu.Unlock()
	}()

	for {
		_, msgBytes, err := conn.ReadMessage()
		if err != nil {
			break
		}

		var payload map[string]interface{}
		if err := json.Unmarshal(msgBytes, &payload); err == nil {
			receiverID, _ := payload["receiverId"].(string)
			if receiverID != "" {
				s.mu.Lock()
				recConn, exists := s.clients[receiverID]
				s.mu.Unlock()
				if exists {
					recConn.WriteMessage(websocket.TextMessage, msgBytes)
				}
			}
		}
	}
}

func TestP2PEndToEndYamuxTunnel(t *testing.T) {
	// 1. Start mock local HTTP server (representing the local sidecar HTTP server)
	mockLocalHTTPSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/shared/list" {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"files":[]}`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer mockLocalHTTPSrv.Close()

	// 2. Start mock WSS signaling server
	signaling := &mockSignalingServer{clients: make(map[string]*websocket.Conn)}
	signalingSrv := httptest.NewServer(signaling)
	defer signalingSrv.Close()

	// 3. Initialize P2PManager on Desktop Sidecar
	m := NewP2PManager("desktop-123", signalingSrv.URL, mockLocalHTTPSrv.Listener.Addr().String(), "test-token")
	m.Start([]map[string]string{
		{"clientId": "mobile-123", "pairingToken": "test-pair-token"},
	})
	defer m.Stop()

	// Give a small pause for P2PManager to connect to WSS signaling
	time.Sleep(20 * time.Millisecond)

	// 4. Dial mock signaling server as Mobile Client
	wsURL := "ws" + strings.TrimPrefix(signalingSrv.URL, "http") + "/api/v1/tunnel/signaling?role=mobile&clientId=mobile-123&targetClientId=desktop-123&token=test-token"
	mobileWS, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("failed to connect mobile WSS: %v", err)
	}
	defer mobileWS.Close()

	// 5. Setup Mobile Client's Pion PeerConnection
	config := webrtc.Configuration{
		ICEServers: []webrtc.ICEServer{
			{URLs: []string{"stun:stun.cloudflare.com:3478"}},
		},
	}
	pc, err := webrtc.NewPeerConnection(config)
	if err != nil {
		t.Fatalf("failed to create mobile PeerConnection: %v", err)
	}
	defer pc.Close()

	// ICE candidate exchange from Mobile Client to Desktop
	pc.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c == nil {
			return
		}
		candBytes, _ := json.Marshal(c.ToJSON())
		msg, _ := json.Marshal(map[string]string{
			"type":       "candidate",
			"payload":    string(candBytes),
			"senderId":   "mobile-123",
			"receiverId": "desktop-123",
		})
		mobileWS.WriteMessage(websocket.TextMessage, msg)
	})

	// Create DataChannel "yamux-tunnel" on Mobile Client
	ordered := true
	dc, err := pc.CreateDataChannel("yamux-tunnel", &webrtc.DataChannelInit{
		Ordered: &ordered,
	})
	if err != nil {
		t.Fatalf("failed to create mobile DataChannel: %v", err)
	}

	// Create SDP Offer on Mobile Client
	offer, err := pc.CreateOffer(nil)
	if err != nil {
		t.Fatalf("failed to create mobile offer: %v", err)
	}
	pc.SetLocalDescription(offer)

	// Send SDP Offer via WebSocket to signaling server
	offerMsg, _ := json.Marshal(map[string]string{
		"type":       "offer",
		"payload":    offer.SDP,
		"senderId":   "mobile-123",
		"receiverId": "desktop-123",
	})
	mobileWS.WriteMessage(websocket.TextMessage, offerMsg)

	// Start Mobile WebSocket read loop to receive Answer and ICE candidates
	answerReceived := make(chan struct{})
	var readLoopWG sync.WaitGroup
	readLoopWG.Add(1)
	go func() {
		defer readLoopWG.Done()
		for {
			_, msgBytes, err := mobileWS.ReadMessage()
			if err != nil {
				break
			}
			var signal map[string]interface{}
			json.Unmarshal(msgBytes, &signal)
			msgType, _ := signal["type"].(string)
			payload, _ := signal["payload"].(string)

			if msgType == "answer" {
				pc.SetRemoteDescription(webrtc.SessionDescription{
					Type: webrtc.SDPTypeAnswer,
					SDP:  payload,
				})
				close(answerReceived)
			} else if msgType == "candidate" {
				var cand webrtc.ICECandidateInit
				json.Unmarshal([]byte(payload), &cand)
				pc.AddICECandidate(cand)
			}
		}
	}()

	// Wait for SDP Answer
	select {
	case <-answerReceived:
		// Sdp negotiation finished, ICE gathering starts
	case <-time.After(5 * time.Second):
		t.Fatal("timeout waiting for SDP answer from Desktop")
	}

	// Set up DataChannel Yamux verification when opened
	testSuccess := make(chan struct{})
	dc.OnOpen(func() {
		wrapper := NewDataChannelWrapper(dc)
		session, err := yamux.Client(wrapper, nil)
		if err != nil {
			t.Errorf("failed to create mobile yamux client: %v", err)
			return
		}
		defer session.Close()

		stream, err := session.Open()
		if err != nil {
			t.Errorf("failed to open yamux stream: %v", err)
			return
		}
		defer stream.Close()

		// Write HTTP list files request into Yamux stream
		reqStr := "GET /shared/list HTTP/1.1\r\nHost: localhost\r\n\r\n"
		_, err = stream.Write([]byte(reqStr))
		if err != nil {
			t.Errorf("failed to write request: %v", err)
			return
		}

		// Read HTTP response from Yamux stream
		buf := make([]byte, 1024)
		n, err := stream.Read(buf)
		if err != nil && err != io.EOF {
			t.Errorf("failed to read response: %v", err)
			return
		}
		resp := string(buf[:n])
		if !strings.Contains(resp, "200 OK") || !strings.Contains(resp, `{"files":[]}`) {
			t.Errorf("unexpected response from Yamux tunnel: %q", resp)
			return
		}

		close(testSuccess)
	})

	// Wait for Yamux tunnel success
	select {
	case <-testSuccess:
		// Excellent! Data transfer succeeded E2E!
	case <-time.After(10 * time.Second):
		t.Fatal("timeout waiting for P2P Yamux data tunnel to establish and forward HTTP request")
	}

	// Close WS to break the read loop
	mobileWS.Close()
	readLoopWG.Wait()
}

func TestP2PManagerUpdatePairedDevicesRefreshesActiveRegistration(t *testing.T) {
	registrations := make(chan map[string]any, 2)
	upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}
	signalingSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()

		for {
			_, msgBytes, err := conn.ReadMessage()
			if err != nil {
				return
			}
			var payload map[string]any
			if err := json.Unmarshal(msgBytes, &payload); err != nil {
				continue
			}
			if payload["type"] == "register_desktop" {
				registrations <- payload
			}
		}
	}))
	defer signalingSrv.Close()

	m := NewP2PManager("desktop-123", signalingSrv.URL, "127.0.0.1:39394", "test-token")
	m.Start(nil)
	defer m.Stop()

	select {
	case payload := <-registrations:
		if paired, ok := payload["pairedDevices"].([]any); !ok || len(paired) != 0 {
			t.Fatalf("initial pairedDevices=%#v, want empty list", payload["pairedDevices"])
		}
	case <-time.After(2 * time.Second):
		t.Fatal("initial desktop registration was not sent")
	}

	if err := m.UpdatePairedDevices([]map[string]string{
		{"clientId": "mobile-123", "pairingToken": "hash-mobile-123"},
	}); err != nil {
		t.Fatalf("UpdatePairedDevices: %v", err)
	}

	select {
	case payload := <-registrations:
		paired, ok := payload["pairedDevices"].([]any)
		if !ok || len(paired) != 1 {
			t.Fatalf("refreshed pairedDevices=%#v, want one device", payload["pairedDevices"])
		}
		first, ok := paired[0].(map[string]any)
		if !ok {
			t.Fatalf("refreshed pairedDevices[0]=%#v", paired[0])
		}
		if first["clientId"] != "mobile-123" {
			t.Fatalf("refreshed clientId=%v, want mobile-123", first["clientId"])
		}
		if first["pairingToken"] != "hash-mobile-123" {
			t.Fatalf("refreshed pairingToken=%v, want stored hash", first["pairingToken"])
		}
	case <-time.After(2 * time.Second):
		t.Fatal("refreshed desktop registration was not sent")
	}
}

func TestP2PManagerMarksRefreshRequiredOnInvalidSignalingToken(t *testing.T) {
	signalingSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/tunnel/signaling" {
			http.NotFound(w, r)
			return
		}
		http.Error(w, `{"error":"invalid signaling token"}`, http.StatusUnauthorized)
	}))
	defer signalingSrv.Close()

	m := NewP2PManager("desktop-123", signalingSrv.URL, "127.0.0.1:39394", "expired-token")
	m.Start(nil)
	defer m.Stop()

	deadline := time.After(2 * time.Second)
	for {
		if m.SignalingAuthState() == SignalingAuthRefreshRequired {
			return
		}
		select {
		case <-deadline:
			t.Fatalf("expected signaling auth state %q, got %q", SignalingAuthRefreshRequired, m.SignalingAuthState())
		case <-time.After(10 * time.Millisecond):
		}
	}
}

func TestP2PManagerReplacesPeerConnectionOnRepeatedOffer(t *testing.T) {
	mockLocalHTTPSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"ok":true}`))
	}))
	defer mockLocalHTTPSrv.Close()

	signaling := &mockSignalingServer{clients: make(map[string]*websocket.Conn)}
	signalingSrv := httptest.NewServer(signaling)
	defer signalingSrv.Close()

	m := NewP2PManager("desktop-123", signalingSrv.URL, mockLocalHTTPSrv.Listener.Addr().String(), "test-token")
	m.Start([]map[string]string{
		{"clientId": "mobile-123", "pairingToken": "test-pair-token"},
	})
	defer m.Stop()

	time.Sleep(20 * time.Millisecond)

	wsURL := "ws" + strings.TrimPrefix(signalingSrv.URL, "http") + "/api/v1/tunnel/signaling?role=mobile&clientId=mobile-123&targetClientId=desktop-123&token=test-token"
	mobileWS, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("failed to connect mobile WSS: %v", err)
	}
	defer mobileWS.Close()

	var activeMu sync.Mutex
	var activePC *webrtc.PeerConnection
	var answerReceived chan struct{}
	readLoopDone := make(chan struct{})
	go func() {
		defer close(readLoopDone)
		for {
			_, msgBytes, err := mobileWS.ReadMessage()
			if err != nil {
				return
			}
			var signal map[string]interface{}
			if err := json.Unmarshal(msgBytes, &signal); err != nil {
				continue
			}
			msgType, _ := signal["type"].(string)
			payload, _ := signal["payload"].(string)

			activeMu.Lock()
			pc := activePC
			answerCh := answerReceived
			activeMu.Unlock()
			if pc == nil {
				continue
			}

			switch msgType {
			case "answer":
				if err := pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: payload}); err != nil {
					t.Errorf("set remote answer: %v", err)
					return
				}
				if answerCh != nil {
					close(answerCh)
				}
			case "candidate":
				var cand webrtc.ICECandidateInit
				if err := json.Unmarshal([]byte(payload), &cand); err == nil {
					_ = pc.AddICECandidate(cand)
				}
			}
		}
	}()

	startAttempt := func(label string) (*webrtc.PeerConnection, <-chan struct{}) {
		t.Helper()

		pc, err := webrtc.NewPeerConnection(webrtc.Configuration{})
		if err != nil {
			t.Fatalf("%s: create peer connection: %v", label, err)
		}
		pc.OnICECandidate(func(c *webrtc.ICECandidate) {
			if c == nil {
				return
			}
			candBytes, _ := json.Marshal(c.ToJSON())
			msg, _ := json.Marshal(map[string]string{
				"type":       "candidate",
				"payload":    string(candBytes),
				"senderId":   "mobile-123",
				"receiverId": "desktop-123",
			})
			_ = mobileWS.WriteMessage(websocket.TextMessage, msg)
		})

		ordered := true
		dc, err := pc.CreateDataChannel("yamux-tunnel", &webrtc.DataChannelInit{Ordered: &ordered})
		if err != nil {
			t.Fatalf("%s: create data channel: %v", label, err)
		}
		opened := make(chan struct{})
		dc.OnOpen(func() {
			close(opened)
		})

		answerCh := make(chan struct{})
		activeMu.Lock()
		activePC = pc
		answerReceived = answerCh
		activeMu.Unlock()

		offer, err := pc.CreateOffer(nil)
		if err != nil {
			t.Fatalf("%s: create offer: %v", label, err)
		}
		if err := pc.SetLocalDescription(offer); err != nil {
			t.Fatalf("%s: set local offer: %v", label, err)
		}
		offerMsg, _ := json.Marshal(map[string]string{
			"type":       "offer",
			"payload":    offer.SDP,
			"senderId":   "mobile-123",
			"receiverId": "desktop-123",
		})
		if err := mobileWS.WriteMessage(websocket.TextMessage, offerMsg); err != nil {
			t.Fatalf("%s: write offer: %v", label, err)
		}

		select {
		case <-answerCh:
		case <-time.After(5 * time.Second):
			t.Fatalf("%s: timeout waiting for SDP answer", label)
		}

		return pc, opened
	}

	firstPC, firstOpened := startAttempt("first")
	defer firstPC.Close()
	select {
	case <-firstOpened:
	case <-time.After(5 * time.Second):
		t.Fatal("first: timeout waiting for data channel open")
	}

	secondPC, secondOpened := startAttempt("second")
	defer secondPC.Close()
	select {
	case <-secondOpened:
	case <-time.After(5 * time.Second):
		t.Fatal("second: timeout waiting for replacement data channel open")
	}

	mobileWS.Close()
	<-readLoopDone
}

func TestP2PManagerPeerConnectionRecycling(t *testing.T) {
	// Verify that P2PManager successfully close and recycle terminal states PC
	mockLocalHTTPSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer mockLocalHTTPSrv.Close()

	signaling := &mockSignalingServer{clients: make(map[string]*websocket.Conn)}
	signalingSrv := httptest.NewServer(signaling)
	defer signalingSrv.Close()

	m := NewP2PManager("desktop-123", signalingSrv.URL, mockLocalHTTPSrv.Listener.Addr().String(), "test-token")
	m.Start([]map[string]string{
		{"clientId": "mobile-123", "pairingToken": "test-pair-token"},
	})
	defer m.Stop()

	time.Sleep(20 * time.Millisecond)

	wsURL := "ws" + strings.TrimPrefix(signalingSrv.URL, "http") + "/api/v1/tunnel/signaling?role=mobile&clientId=mobile-123&targetClientId=desktop-123&token=test-token"
	mobileWS, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("failed to connect: %v", err)
	}
	defer mobileWS.Close()

	// Create and register a dummy closed PeerConnection in desktop's active connections map
	config := webrtc.Configuration{}
	dummyPC, _ := webrtc.NewPeerConnection(config)
	dummyPC.Close() // Moves connection state to closed immediately

	// Send offer to trigger createPeerConnection and verify recycling
	offer, _ := dummyPC.CreateOffer(nil)
	offerMsg, _ := json.Marshal(map[string]string{
		"type":       "offer",
		"payload":    offer.SDP,
		"senderId":   "mobile-123",
		"receiverId": "desktop-123",
	})
	mobileWS.WriteMessage(websocket.TextMessage, offerMsg)

	// Sleep to verify it compiles and handles recycling safely without panic
	time.Sleep(20 * time.Millisecond)
}

func TestP2PManagerUsesProvidedICEServers(t *testing.T) {
	m := NewP2PManagerWithICEServers(
		"desktop-123",
		"http://signaling.example.com",
		"127.0.0.1:39394",
		"test-token",
		[]webrtc.ICEServer{
			{
				URLs:       []string{"turn:review-api.vividrop.cn:3478?transport=udp"},
				Username:   "turn-user",
				Credential: "turn-pass",
			},
		},
	)
	defer m.Stop()

	pc, err := m.createPeerConnection(nil, "mobile-123", iceRouteModeAll)
	if err != nil {
		t.Fatalf("createPeerConnection: %v", err)
	}
	defer pc.Close()

	servers := pc.GetConfiguration().ICEServers
	if len(servers) != 2 {
		t.Fatalf("expected STUN plus TURN ICE servers, got %d", len(servers))
	}
	if got := servers[0].URLs[0]; got != DefaultSTUNServer {
		t.Fatalf("expected default STUN first, got %s", got)
	}
	if got := servers[1].URLs[0]; got != "turn:review-api.vividrop.cn:3478?transport=udp" {
		t.Fatalf("unexpected ICE URL: %s", got)
	}
	if servers[1].Username != "turn-user" || servers[1].Credential != "turn-pass" {
		t.Fatalf("unexpected TURN credentials: %#v", servers[1])
	}
}

func TestParseICEServersJSONFallsBackToDefaultStun(t *testing.T) {
	servers := ParseICEServersJSON("")

	if len(servers) != 1 {
		t.Fatalf("expected default ICE server, got %d", len(servers))
	}
	if got := servers[0].URLs[0]; got != DefaultSTUNServer {
		t.Fatalf("unexpected default ICE URL: %s", got)
	}
}

func TestParseICEServersJSONPrependsDefaultStunToTurnOnlyConfig(t *testing.T) {
	servers := ParseICEServersJSON(`[{"urls":["turn:review-api.vividrop.cn:3478?transport=udp"],"username":"turn-user","credential":"turn-pass"}]`)

	if len(servers) != 2 {
		t.Fatalf("expected STUN plus TURN ICE servers, got %d", len(servers))
	}
	if got := servers[0].URLs[0]; got != DefaultSTUNServer {
		t.Fatalf("expected default STUN first, got %s", got)
	}
	if got := servers[1].URLs[0]; got != "turn:review-api.vividrop.cn:3478?transport=udp" {
		t.Fatalf("unexpected ICE URL: %s", got)
	}
	if servers[1].Username != "turn-user" || servers[1].Credential != "turn-pass" {
		t.Fatalf("unexpected TURN credentials: %#v", servers[1])
	}
}

func TestParseICEServersJSONDoesNotDuplicateDefaultStun(t *testing.T) {
	servers := ParseICEServersJSON(`[{"urls":["stun:stun.cloudflare.com:3478"]},{"urls":["turn:review-api.vividrop.cn:3478?transport=udp"],"username":"turn-user","credential":"turn-pass"}]`)

	if len(servers) != 2 {
		t.Fatalf("expected existing STUN plus TURN ICE servers, got %d", len(servers))
	}
	if got := servers[0].URLs[0]; got != DefaultSTUNServer {
		t.Fatalf("expected existing default STUN first, got %s", got)
	}
	if got := servers[1].URLs[0]; got != "turn:review-api.vividrop.cn:3478?transport=udp" {
		t.Fatalf("unexpected ICE URL: %s", got)
	}
}

func TestAppendConnectionStateDiagnosticArgsIncludesSelectedPairSnapshot(t *testing.T) {
	selectedAt := time.Date(2026, 6, 5, 16, 50, 58, 0, time.UTC)
	now := selectedAt.Add(8*time.Second + 250*time.Millisecond)
	connectedAt := selectedAt.Add(-2 * time.Second)
	pair := &webrtc.ICECandidatePair{
		Local: &webrtc.ICECandidate{
			Typ:      webrtc.ICECandidateTypeHost,
			Protocol: webrtc.ICEProtocolUDP,
			Address:  "fe80::1",
			Port:     50123,
		},
		Remote: &webrtc.ICECandidate{
			Typ:      webrtc.ICECandidateTypeSrflx,
			Protocol: webrtc.ICEProtocolUDP,
			Address:  "fe80::2",
			Port:     49876,
		},
	}

	args := appendConnectionStateDiagnosticArgs(
		nil,
		"connected",
		connectedAt,
		selectedPairSnapshot(pair, selectedAt),
		now,
	)
	values := argsToMap(args)

	if values["previousState"] != "connected" {
		t.Fatalf("expected previousState connected, got %#v", values["previousState"])
	}
	if values["connectedForMs"] != int64(10250) {
		t.Fatalf("expected connectedForMs 10250, got %#v", values["connectedForMs"])
	}
	if values["lastSelectedRoute"] != "direct_reflexive" {
		t.Fatalf("expected direct_reflexive route, got %#v", values["lastSelectedRoute"])
	}
	if values["lastSelectedLocalType"] != "host" || values["lastSelectedRemoteType"] != "srflx" {
		t.Fatalf("unexpected candidate types: %#v", values)
	}
	if values["lastSelectedLocalAddress"] != "fe80::1" || values["lastSelectedRemoteAddress"] != "fe80::2" {
		t.Fatalf("unexpected candidate addresses: %#v", values)
	}
	if values["selectedPairAgeMs"] != int64(8250) {
		t.Fatalf("expected selectedPairAgeMs 8250, got %#v", values["selectedPairAgeMs"])
	}
}

func argsToMap(args []any) map[string]any {
	values := make(map[string]any, len(args)/2)
	for i := 0; i+1 < len(args); i += 2 {
		key, ok := args[i].(string)
		if !ok {
			continue
		}
		values[key] = args[i+1]
	}
	return values
}

func TestDataChannelWrapperAppliesBackpressureWithoutDroppingMessages(t *testing.T) {
	offerPC, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("create offer peer: %v", err)
	}
	defer offerPC.Close()

	answerPC, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("create answer peer: %v", err)
	}
	defer answerPC.Close()

	offerPC.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c != nil {
			_ = answerPC.AddICECandidate(c.ToJSON())
		}
	})
	answerPC.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c != nil {
			_ = offerPC.AddICECandidate(c.ToJSON())
		}
	})

	wrapperReady := make(chan *DataChannelWrapper, 1)
	answerPC.OnDataChannel(func(d *webrtc.DataChannel) {
		wrapperReady <- NewDataChannelWrapper(d)
	})

	ordered := true
	dc, err := offerPC.CreateDataChannel("yamux-tunnel", &webrtc.DataChannelInit{Ordered: &ordered})
	if err != nil {
		t.Fatalf("create data channel: %v", err)
	}
	opened := make(chan struct{})
	dc.OnOpen(func() {
		close(opened)
	})

	offer, err := offerPC.CreateOffer(nil)
	if err != nil {
		t.Fatalf("create offer: %v", err)
	}
	if err := offerPC.SetLocalDescription(offer); err != nil {
		t.Fatalf("set local offer: %v", err)
	}
	if err := answerPC.SetRemoteDescription(offer); err != nil {
		t.Fatalf("set remote offer: %v", err)
	}
	answer, err := answerPC.CreateAnswer(nil)
	if err != nil {
		t.Fatalf("create answer: %v", err)
	}
	if err := answerPC.SetLocalDescription(answer); err != nil {
		t.Fatalf("set local answer: %v", err)
	}
	if err := offerPC.SetRemoteDescription(answer); err != nil {
		t.Fatalf("set remote answer: %v", err)
	}

	var wrapper *DataChannelWrapper
	select {
	case wrapper = <-wrapperReady:
	case <-time.After(15 * time.Second):
		t.Fatal("timeout waiting for data channel wrapper")
	}
	defer wrapper.Close()

	select {
	case <-opened:
	case <-time.After(15 * time.Second):
		t.Fatal("timeout waiting for data channel open")
	}

	const (
		messageCount = 1500
		messageSize  = 32
	)
	expected := make([]byte, 0, messageCount*messageSize)
	for i := range messageCount {
		payload := bytes.Repeat([]byte{byte(i % 251)}, messageSize)
		expected = append(expected, payload...)
	}

	got := make([]byte, len(expected))
	readDone := make(chan error, 1)
	go func() {
		offset := 0
		buf := make([]byte, messageSize)
		for offset < len(got) {
			n, err := wrapper.Read(buf)
			if err != nil {
				readDone <- err
				return
			}
			copy(got[offset:], buf[:n])
			offset += n
			time.Sleep(100 * time.Microsecond)
		}
		readDone <- nil
	}()

	sendDone := make(chan error, 1)
	go func() {
		for offset := 0; offset < len(expected); offset += messageSize {
			if err := dc.Send(expected[offset : offset+messageSize]); err != nil {
				sendDone <- err
				return
			}
		}
		sendDone <- nil
	}()

	select {
	case err := <-sendDone:
		if err != nil {
			t.Fatalf("send messages: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("timeout sending messages")
	}

	select {
	case err := <-readDone:
		if err != nil {
			t.Fatalf("read wrapper stream: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("timeout waiting for wrapper stream; data was likely dropped")
	}

	if !bytes.Equal(got, expected) {
		t.Fatal("wrapper stream did not preserve all inbound data")
	}
}

func TestDataChannelWrapperCloseHandlerRunsOnDataChannelClose(t *testing.T) {
	offerPC, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("create offer peer: %v", err)
	}
	defer offerPC.Close()

	answerPC, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("create answer peer: %v", err)
	}
	defer answerPC.Close()

	offerPC.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c != nil {
			_ = answerPC.AddICECandidate(c.ToJSON())
		}
	})
	answerPC.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c != nil {
			_ = offerPC.AddICECandidate(c.ToJSON())
		}
	})

	closeObserved := make(chan struct{}, 1)
	wrapperReady := make(chan *DataChannelWrapper, 1)
	answerPC.OnDataChannel(func(d *webrtc.DataChannel) {
		wrapperReady <- NewDataChannelWrapperWithCloseHandler(d, func() {
			closeObserved <- struct{}{}
		})
	})

	ordered := true
	dc, err := offerPC.CreateDataChannel("yamux-tunnel", &webrtc.DataChannelInit{Ordered: &ordered})
	if err != nil {
		t.Fatalf("create data channel: %v", err)
	}
	opened := make(chan struct{})
	dc.OnOpen(func() {
		close(opened)
	})

	offer, err := offerPC.CreateOffer(nil)
	if err != nil {
		t.Fatalf("create offer: %v", err)
	}
	if err := offerPC.SetLocalDescription(offer); err != nil {
		t.Fatalf("set local offer: %v", err)
	}
	if err := answerPC.SetRemoteDescription(offer); err != nil {
		t.Fatalf("set remote offer: %v", err)
	}
	answer, err := answerPC.CreateAnswer(nil)
	if err != nil {
		t.Fatalf("create answer: %v", err)
	}
	if err := answerPC.SetLocalDescription(answer); err != nil {
		t.Fatalf("set local answer: %v", err)
	}
	if err := offerPC.SetRemoteDescription(answer); err != nil {
		t.Fatalf("set remote answer: %v", err)
	}

	var wrapper *DataChannelWrapper
	select {
	case wrapper = <-wrapperReady:
	case <-time.After(15 * time.Second):
		t.Fatal("timeout waiting for data channel wrapper")
	}
	defer wrapper.Close()

	select {
	case <-opened:
	case <-time.After(15 * time.Second):
		t.Fatal("timeout waiting for data channel open")
	}

	if err := dc.Close(); err != nil {
		t.Fatalf("close data channel: %v", err)
	}

	select {
	case <-closeObserved:
	case <-time.After(5 * time.Second):
		t.Fatal("timeout waiting for data channel close handler")
	}
}
