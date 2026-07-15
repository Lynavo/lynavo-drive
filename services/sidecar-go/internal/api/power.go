package api

import (
	"encoding/json"
	"net/http"
	"sync"
)

type PowerEventSnapshot struct {
	Event         string `json:"event"`
	State         string `json:"state"`
	LastSuspendAt string `json:"lastSuspendAt,omitempty"`
	LastResumeAt  string `json:"lastResumeAt,omitempty"`
	LastLockAt    string `json:"lastLockAt,omitempty"`
	LastUnlockAt  string `json:"lastUnlockAt,omitempty"`
	UpdatedAt     string `json:"updatedAt"`
}

type PowerTracker struct {
	mu       sync.RWMutex
	snapshot *PowerEventSnapshot
}

func NewPowerTracker() *PowerTracker {
	return &PowerTracker{}
}

func (p *PowerTracker) Update(snapshot PowerEventSnapshot) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.snapshot = &snapshot
}

func (p *PowerTracker) Snapshot() *PowerEventSnapshot {
	p.mu.RLock()
	defer p.mu.RUnlock()
	if p.snapshot == nil {
		return nil
	}
	snapshot := *p.snapshot
	return &snapshot
}

func (s *Server) UpdatePowerSnapshot(snapshot PowerEventSnapshot) {
	s.power.Update(snapshot)
}

func (s *Server) handlePowerState(w http.ResponseWriter, r *http.Request) {
	if !isLocalRequest(r) {
		writeError(w, http.StatusForbidden, "power state updates are local only")
		return
	}
	var snapshot PowerEventSnapshot
	if err := json.NewDecoder(r.Body).Decode(&snapshot); err != nil {
		writeError(w, http.StatusBadRequest, "invalid power snapshot")
		return
	}
	if snapshot.Event == "" || snapshot.State == "" || snapshot.UpdatedAt == "" {
		writeError(w, http.StatusBadRequest, "missing power snapshot fields")
		return
	}
	s.UpdatePowerSnapshot(snapshot)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
