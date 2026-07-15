package events

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

type Event struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
}

type Hub struct {
	mu       sync.Mutex
	clients  map[*websocket.Conn]struct{}
	upgrader websocket.Upgrader
}

func NewHub() *Hub {
	return &Hub{
		clients: make(map[*websocket.Conn]struct{}),
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
	}
}

func (h *Hub) HandleUpgrade(w http.ResponseWriter, r *http.Request) {
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("ws upgrade failed", "err", err)
		return
	}
	h.mu.Lock()
	h.clients[conn] = struct{}{}
	h.mu.Unlock()

	slog.Debug("ws client connected", "remote", conn.RemoteAddr())

	go func() {
		defer func() {
			h.mu.Lock()
			delete(h.clients, conn)
			h.mu.Unlock()
			conn.Close()
			slog.Debug("ws client disconnected", "remote", conn.RemoteAddr())
		}()
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				break
			}
		}
	}()
}

func (h *Hub) Broadcast(event Event) {
	data, err := json.Marshal(event)
	if err != nil {
		slog.Error("event marshal error", "err", err)
		return
	}

	h.mu.Lock()
	defer h.mu.Unlock()

	var dead []*websocket.Conn
	for conn := range h.clients {
		if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
			slog.Warn("ws write error, removing client", "err", err)
			dead = append(dead, conn)
		}
	}
	for _, conn := range dead {
		conn.Close()
		delete(h.clients, conn)
	}
}

func (h *Hub) ClientCount() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.clients)
}
