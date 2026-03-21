package api

import "net/http"

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"service": "syncflow-sidecar",
		"version": "0.1.0",
	})
}
