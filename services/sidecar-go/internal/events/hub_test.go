package events

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestNewHub_ZeroClients(t *testing.T) {
	hub := NewHub()
	if hub.ClientCount() != 0 {
		t.Fatalf("expected 0 clients, got %d", hub.ClientCount())
	}
}

func dialHub(t *testing.T, hub *Hub) (*websocket.Conn, *httptest.Server) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(hub.HandleUpgrade))
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial failed: %v", err)
	}
	// give the server goroutine a moment to register the client
	time.Sleep(50 * time.Millisecond)
	return conn, srv
}

func TestHub_ConnectIncrementsClientCount(t *testing.T) {
	hub := NewHub()
	conn, srv := dialHub(t, hub)
	defer srv.Close()
	defer conn.Close()

	if hub.ClientCount() != 1 {
		t.Fatalf("expected 1 client, got %d", hub.ClientCount())
	}
}

func TestHub_BroadcastDeliversEvent(t *testing.T) {
	hub := NewHub()
	conn, srv := dialHub(t, hub)
	defer srv.Close()
	defer conn.Close()

	hub.Broadcast(Event{
		Type:    "test",
		Payload: map[string]string{"foo": "bar"},
	})

	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, msg, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read failed: %v", err)
	}

	var got Event
	if err := json.Unmarshal(msg, &got); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}
	if got.Type != "test" {
		t.Errorf("expected type 'test', got %q", got.Type)
	}

	// verify payload round-trips correctly
	payloadBytes, _ := json.Marshal(got.Payload)
	var payloadMap map[string]string
	json.Unmarshal(payloadBytes, &payloadMap)
	if payloadMap["foo"] != "bar" {
		t.Errorf("expected payload foo=bar, got %v", payloadMap)
	}
}

func TestHub_DisconnectDecrementsClientCount(t *testing.T) {
	hub := NewHub()
	conn, srv := dialHub(t, hub)
	defer srv.Close()

	conn.Close()
	// give the server goroutine a moment to detect the disconnect
	time.Sleep(100 * time.Millisecond)

	if hub.ClientCount() != 0 {
		t.Fatalf("expected 0 clients after disconnect, got %d", hub.ClientCount())
	}
}

func TestHub_BroadcastToEmptyHub(t *testing.T) {
	hub := NewHub()
	// should not panic
	hub.Broadcast(Event{Type: "noop", Payload: nil})
}
