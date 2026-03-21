package api

import (
	"net/http"

	"github.com/nicksyncflow/sidecar/internal/config"
	"github.com/nicksyncflow/sidecar/internal/events"
	"github.com/nicksyncflow/sidecar/internal/store"
)

// Server holds the dependencies for the HTTP API handlers.
type Server struct {
	store  *store.Store
	config *config.Config
	hub    *events.Hub
}

// NewServer creates a new HTTP handler with all API routes registered.
func NewServer(s *store.Store, cfg *config.Config, hub *events.Hub) http.Handler {
	srv := &Server{store: s, config: cfg, hub: hub}
	mux := http.NewServeMux()

	// Health
	mux.HandleFunc("GET /health", withJSON(srv.handleHealth))
	// Dashboard
	mux.HandleFunc("GET /dashboard/summary", withJSON(srv.handleDashboardSummary))
	mux.HandleFunc("GET /dashboard/devices", withJSON(srv.handleDashboardDevices))
	// Devices
	mux.HandleFunc("GET /devices/{deviceId}", withJSON(srv.handleDeviceDetail))
	mux.HandleFunc("GET /devices/{deviceId}/files", withJSON(srv.handleDeviceFiles))
	mux.HandleFunc("GET /devices/{deviceId}/dates", withJSON(srv.handleDeviceDates))
	// Settings
	mux.HandleFunc("GET /settings", withJSON(srv.handleGetSettings))
	mux.HandleFunc("PUT /settings", withJSON(srv.handleUpdateSettings))
	// Connection code
	mux.HandleFunc("POST /connection-code/regenerate", withJSON(srv.handleRegenerateCode))
	// Share
	mux.HandleFunc("GET /share/status", withJSON(srv.handleShareStatus))
	mux.HandleFunc("POST /share/validate", withJSON(srv.handleShareValidate))
	// WebSocket
	mux.HandleFunc("GET /events/stream", srv.handleEventStream)

	return withLogging(mux)
}

// handleEventStream upgrades the connection to a WebSocket for real-time events.
func (s *Server) handleEventStream(w http.ResponseWriter, r *http.Request) {
	s.hub.HandleUpgrade(w, r)
}
