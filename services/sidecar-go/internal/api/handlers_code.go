package api

import (
	"fmt"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"sort"

	"github.com/lynavo/lynavo-drive/services/sidecar-go/internal/events"
)

type setConnectionCodeRequest struct {
	Code string `json:"code"`
}

func isValidConnectionCode(code string) bool {
	if len(code) != 6 {
		return false
	}
	for _, ch := range code {
		if ch < '0' || ch > '9' {
			return false
		}
	}
	return true
}

func (s *Server) handleSetConnectionCode(w http.ResponseWriter, r *http.Request) {
	var req setConnectionCodeRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if !isValidConnectionCode(req.Code) {
		writeError(w, http.StatusBadRequest, "connection code must be 6 digits")
		return
	}

	if err := s.store.RotateConnectionCode(req.Code); err != nil {
		slog.Error("set connection code", "err", err)
		writeError(w, http.StatusInternalServerError, "failed to set connection code")
		return
	}
	connectedClientIDs := s.connectedClientIDs()
	s.disconnectClients(connectedClientIDs, "connection_code_set")
	s.hub.Broadcast(events.Event{Type: "dashboard.updated", Payload: nil})
	slog.Info("connection code set")

	writeJSON(w, http.StatusOK, map[string]string{
		"code": req.Code,
	})
}

func (s *Server) handleRegenerateCode(w http.ResponseWriter, _ *http.Request) {
	code := fmt.Sprintf("%06d", 100000+rand.IntN(900000))

	if err := s.store.RotateConnectionCode(code); err != nil {
		slog.Error("rotate connection code", "err", err)
		writeError(w, http.StatusInternalServerError, "failed to regenerate code")
		return
	}
	connectedClientIDs := s.connectedClientIDs()
	s.disconnectClients(connectedClientIDs, "connection_code_regenerated")
	s.hub.Broadcast(events.Event{Type: "dashboard.updated", Payload: nil})
	slog.Info("connection code regenerated")

	writeJSON(w, http.StatusOK, map[string]string{
		"code": code,
	})
}

func (s *Server) connectedClientIDs() []string {
	if s.clientStates == nil {
		return nil
	}
	states := s.clientStates.ConnectedClientStates()
	clientIDs := make([]string, 0, len(states))
	for clientID := range states {
		clientIDs = append(clientIDs, clientID)
	}
	sort.Strings(clientIDs)
	return clientIDs
}

func (s *Server) disconnectClients(clientIDs []string, reason string) {
	if len(clientIDs) == 0 || s.clientStates == nil {
		return
	}
	disconnecter, ok := s.clientStates.(ClientDisconnectProvider)
	if !ok {
		return
	}
	count := disconnecter.DisconnectClients(clientIDs, reason)
	if count > 0 {
		slog.Info("disconnected clients", "reason", reason, "clients", count)
	}
}
