package api

import (
	"net/http"

	"github.com/nicksyncflow/sidecar/internal/protocol"
)

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	wakeSupported := false
	if capability := s.wakeCapability(); capability != nil {
		wakeSupported = capability.Supported
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":                      true,
		"service":                 "syncflow-sidecar",
		"version":                 "0.1.0",
		"appCompatibilityVersion": protocol.AppCompatibilityVersion,
		"capabilities": map[string]any{
			"revokesPairingsOnCodeRotation": true,
			"wakeOnLanSupported":            wakeSupported,
		},
	})
}
