package api

import (
	"net/http"
	"sync"

	"github.com/nicksyncflow/sidecar/internal/config"
	"github.com/nicksyncflow/sidecar/internal/events"
	"github.com/nicksyncflow/sidecar/internal/protocol"
	"github.com/nicksyncflow/sidecar/internal/store"
)

// ClientStateProvider returns live TCP connection states per clientID.
type ClientStateProvider interface {
	ConnectedClientStates() map[string]string
}

// Server holds the dependencies for the HTTP API handlers.
type Server struct {
	store           *store.Store
	config          *config.Config
	hub             *events.Hub
	clientStates    ClientStateProvider
	presence        *PresenceTracker
	tunnelMu        sync.Mutex
	tunnel          *protocol.P2PManager
	OnDeviceRenamed func(newName string) // called when device name changes, to restart Bonjour
}

func (s *Server) PresenceTracker() *PresenceTracker {
	return s.presence
}

// StopTunnel stops the desktop P2P signaling listener if it is running.
func (s *Server) StopTunnel() {
	s.tunnelMu.Lock()
	defer s.tunnelMu.Unlock()
	if s.tunnel != nil {
		s.tunnel.Stop()
		s.tunnel = nil
	}
}

// NewServer creates a new HTTP handler with all API routes registered.
func NewServer(s *store.Store, cfg *config.Config, hub *events.Hub, csp ClientStateProvider) (*Server, http.Handler) {
	srv := &Server{store: s, config: cfg, hub: hub, clientStates: csp, presence: NewPresenceTracker()}
	mux := http.NewServeMux()

	// Presence (mobile heartbeat)
	mux.HandleFunc("POST /presence/{clientId}", withJSON(srv.handlePresence))
	// Health
	mux.HandleFunc("GET /health", withJSON(srv.handleHealth))
	// Dashboard
	mux.HandleFunc("GET /dashboard/summary", withJSON(srv.handleDashboardSummary))
	mux.HandleFunc("GET /dashboard/devices", withJSON(srv.handleDashboardDevices))
	// Devices
	mux.HandleFunc("GET /devices/{deviceId}", withJSON(srv.handleDeviceDetail))
	mux.HandleFunc("GET /devices/{deviceId}/files", withJSON(srv.handleDeviceFiles))
	mux.HandleFunc("GET /devices/{deviceId}/dates", withJSON(srv.handleDeviceDates))
	mux.HandleFunc("GET /devices/{deviceId}/existing-file-keys", withJSON(srv.handleDeviceExistingFileKeys))
	// Settings
	mux.HandleFunc("GET /settings", withJSON(srv.handleGetSettings))
	mux.HandleFunc("PUT /settings", withJSON(srv.handleUpdateSettings))
	mux.HandleFunc("POST /settings/reset-state", withJSON(srv.handleResetState))
	// Connection code
	mux.HandleFunc("POST /connection-code/regenerate", withJSON(srv.handleRegenerateCode))
	// Share
	mux.HandleFunc("GET /share/status", withJSON(srv.handleShareStatus))
	mux.HandleFunc("POST /share/validate", withJSON(srv.handleShareValidate))
	// Shared files (binary responses — no withJSON wrapper)
	mux.HandleFunc("GET /shared/list", withJSON(srv.handleSharedList))
	mux.HandleFunc("GET /shared/list/{path...}", withJSON(srv.handleSharedListPath))
	mux.HandleFunc("GET /shared/thumbnail/{path...}", srv.handleSharedThumbnail)
	mux.HandleFunc("GET /shared/download/{path...}", srv.handleSharedDownload)
	mux.HandleFunc("GET /shared/stream/{path...}", srv.handleSharedStream)
	// Transfer state
	mux.HandleFunc("GET /transfer/active", withJSON(srv.handleTransferActive))
	// Tunnel credentials sync for desktop P2P signaling.
	mux.HandleFunc("POST /tunnel/credentials", withJSON(srv.handleSyncTunnelCredentials))
	// WebSocket
	mux.HandleFunc("GET /events/stream", srv.handleEventStream)

	return srv, withLogging(mux)
}

// handleEventStream upgrades the connection to a WebSocket for real-time events.
func (s *Server) handleEventStream(w http.ResponseWriter, r *http.Request) {
	s.hub.HandleUpgrade(w, r)
}
