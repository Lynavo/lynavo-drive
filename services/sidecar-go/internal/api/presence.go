package api

import (
	"net/http"
	"sync"
	"time"

	"github.com/nicksyncflow/sidecar/internal/events"
)

// PresenceTracker tracks lightweight heartbeats from mobile clients.
// Used to show "connected_idle" on the dashboard when the client is
// alive but not actively transferring (no TCP connection).
type PresenceTracker struct {
	mu    sync.RWMutex
	times map[string]time.Time // clientID → last heartbeat
}

func NewPresenceTracker() *PresenceTracker {
	return &PresenceTracker{times: make(map[string]time.Time)}
}

func (p *PresenceTracker) Touch(clientID string) {
	p.mu.Lock()
	p.times[clientID] = time.Now()
	p.mu.Unlock()
}

// IsAlive returns true if the client sent a heartbeat within the given window.
func (p *PresenceTracker) IsAlive(clientID string, window time.Duration) bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	t, ok := p.times[clientID]
	return ok && time.Since(t) < window
}

func (s *Server) handlePresence(w http.ResponseWriter, r *http.Request) {
	clientID := r.PathValue("clientId")
	if clientID == "" {
		writeError(w, http.StatusBadRequest, "missing clientId")
		return
	}
	s.presence.Touch(clientID)
	if s.hub != nil {
		s.hub.Broadcast(events.Event{
			Type: "device.state.changed",
			Payload: map[string]string{
				"deviceId": clientID,
				"status":   "connected_idle",
			},
		})
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
