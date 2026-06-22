package api

import (
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/nicksyncflow/sidecar/internal/config"
	"github.com/nicksyncflow/sidecar/internal/events"
	"github.com/nicksyncflow/sidecar/internal/protocol"
	"github.com/nicksyncflow/sidecar/internal/store"
	"github.com/nicksyncflow/sidecar/internal/wake"
)

// ClientStateProvider returns live TCP connection states per clientID.
type ClientStateProvider interface {
	ConnectedClientStates() map[string]string
}

type WakeProvider interface {
	WakeCapability() *protocol.WakeCapability
}

type WakePacketSender interface {
	SendWakePacket(addr string, packet []byte) error
}

type ProxyWakeTargetProvider interface {
	ProxyWakeTargets(accountID string) []protocol.WakeTarget
}

type defaultWakeProvider struct{}

func (defaultWakeProvider) WakeCapability() *protocol.WakeCapability {
	return wake.Metadata()
}

type udpWakePacketSender struct{}

func (udpWakePacketSender) SendWakePacket(addr string, packet []byte) error {
	conn, err := net.Dial("udp4", addr)
	if err != nil {
		return err
	}
	defer conn.Close()
	_, err = conn.Write(packet)
	return err
}

// Server holds the dependencies for the HTTP API handlers.
type Server struct {
	store                  *store.Store
	config                 *config.Config
	hub                    *events.Hub
	clientStates           ClientStateProvider
	presence               *PresenceTracker
	wakeProvider           WakeProvider
	wakeSender             WakePacketSender
	proxyWakeTargets       ProxyWakeTargetProvider
	power                  *PowerTracker
	thumbnailLimiter       chan struct{}
	videoThumbnailMu       sync.Mutex
	videoThumbnailInflight map[string]*videoThumbnailInflight
	tunnelMu               sync.Mutex
	tunnel                 *protocol.P2PManager
	accountMu              sync.RWMutex
	desktopAccountID       string
	authBaseURL            string
	personalAccessNonceMu  sync.Mutex
	personalAccessNonces   map[string]time.Time
	OnDeviceRenamed        func(newName string) // called when device name changes, to restart Bonjour
	OnShareStatusChanged   func()               // called when share status changes, to restart Bonjour
}

func (s *Server) PresenceTracker() *PresenceTracker {
	return s.presence
}

func (s *Server) SetWakeProvider(provider WakeProvider) {
	s.wakeProvider = provider
}

func (s *Server) SetWakePacketSender(sender WakePacketSender) {
	s.wakeSender = sender
}

func (s *Server) SetProxyWakeTargetProvider(provider ProxyWakeTargetProvider) {
	s.proxyWakeTargets = provider
}

func (s *Server) wakeCapability() *protocol.WakeCapability {
	if s.wakeProvider == nil {
		return nil
	}
	return s.wakeProvider.WakeCapability()
}

func wakeCapabilityLogAttrs(capability *protocol.WakeCapability) []any {
	if capability == nil {
		return []any{
			"wakePresent", false,
			"wakeSupported", false,
			"wakeTargetCount", 0,
			"wakeUsableTargetCount", 0,
			"wakeUpdatedAt", "",
		}
	}
	usableTargetCount := 0
	for _, target := range capability.Targets {
		if target.MACAddress != "" && target.BroadcastAddress != "" && len(target.Ports) > 0 {
			usableTargetCount++
		}
	}
	return []any{
		"wakePresent", true,
		"wakeSupported", capability.Supported,
		"wakeTargetCount", len(capability.Targets),
		"wakeUsableTargetCount", usableTargetCount,
		"wakeUpdatedAt", capability.UpdatedAt,
		"wakeTargets", wakeTargetLogSummary(capability.Targets),
	}
}

func wakeTargetLogSummary(targets []protocol.WakeTarget) string {
	parts := make([]string, 0, len(targets))
	for _, target := range targets {
		parts = append(parts, "interface="+target.InterfaceName+
			" mac="+maskedWakeMACAddress(target.MACAddress)+
			" ipv4="+target.IPv4Address+
			" broadcast="+target.BroadcastAddress+
			" ports="+intListLogSummary(target.Ports))
	}
	return strings.Join(parts, "; ")
}

func maskedWakeMACAddress(macAddress string) string {
	parts := strings.Split(strings.ToLower(strings.ReplaceAll(strings.TrimSpace(macAddress), "-", ":")), ":")
	if len(parts) != 6 {
		return "<invalid>"
	}
	return "**:**:**:**:" + parts[4] + ":" + parts[5]
}

func intListLogSummary(values []int) string {
	if len(values) == 0 {
		return ""
	}
	parts := make([]string, 0, len(values))
	for _, value := range values {
		parts = append(parts, strconv.Itoa(value))
	}
	return strings.Join(parts, ",")
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

func (s *Server) RefreshTunnelPairings(reason string) {
	pairedDevices, err := s.pairedDevicesForSignaling()
	if err != nil {
		slog.Error("failed to refresh paired devices for p2p tunnel", "reason", reason, "err", err)
		return
	}

	s.tunnelMu.Lock()
	tunnel := s.tunnel
	s.tunnelMu.Unlock()

	if tunnel == nil {
		slog.Debug("sync tunnel paired devices refresh skipped; tunnel not running", "reason", reason, "pairedDevices", len(pairedDevices))
		return
	}
	if err := tunnel.UpdatePairedDevices(pairedDevices); err != nil {
		slog.Warn("sync tunnel paired devices refresh failed", "reason", reason, "pairedDevices", len(pairedDevices), "err", err)
		return
	}
	slog.Info("sync tunnel paired devices refreshed", "reason", reason, "pairedDevices", len(pairedDevices))
}

func (s *Server) tunnelSignalingAuthState() protocol.SignalingAuthState {
	s.tunnelMu.Lock()
	tunnel := s.tunnel
	s.tunnelMu.Unlock()
	if tunnel == nil {
		return protocol.SignalingAuthOK
	}
	return tunnel.SignalingAuthState()
}

// NewServer creates a new HTTP handler with all API routes registered.
func NewServer(s *store.Store, cfg *config.Config, hub *events.Hub, csp ClientStateProvider) (*Server, http.Handler) {
	srv := &Server{
		store:                  s,
		config:                 cfg,
		hub:                    hub,
		clientStates:           csp,
		presence:               NewPresenceTracker(),
		wakeProvider:           defaultWakeProvider{},
		wakeSender:             udpWakePacketSender{},
		power:                  NewPowerTracker(),
		thumbnailLimiter:       make(chan struct{}, 2),
		videoThumbnailInflight: make(map[string]*videoThumbnailInflight),
		personalAccessNonces:   make(map[string]time.Time),
	}
	mux := http.NewServeMux()

	// Presence (mobile heartbeat)
	mux.HandleFunc("POST /presence/{clientId}", withJSON(srv.handlePresence))
	mux.HandleFunc("POST /power/state", withJSON(srv.handlePowerState))
	// Health
	mux.HandleFunc("GET /health", withJSON(srv.handleHealth))
	// Dashboard
	mux.HandleFunc("GET /dashboard/summary", withJSON(srv.handleDashboardSummary))
	mux.HandleFunc("GET /dashboard/devices", withJSON(srv.handleDashboardDevices))
	// Local management
	mux.HandleFunc("GET /management/devices", withJSON(srv.handleManagementDevices))
	mux.HandleFunc("POST /management/devices/{clientId}/unblock", withJSON(srv.handleManagementUnblockDevice))
	mux.HandleFunc("POST /management/devices/{clientId}/block", withJSON(srv.handleManagementBlockDevice))
	mux.HandleFunc("GET /management/records/sync", withJSON(srv.handleManagementSyncRecords))
	mux.HandleFunc("GET /management/records/access", withJSON(srv.handleManagementAccessRecords))
	// Shared resource management
	mux.HandleFunc("GET /resources/shared", withJSON(srv.handleResourcesShared))
	mux.HandleFunc("POST /resources/shared", withJSON(srv.handleResourcesAddShared))
	mux.HandleFunc("DELETE /resources/shared/{resourceId}", withJSON(srv.handleResourcesRemoveShared))
	mux.HandleFunc("GET /resources/received", withJSON(srv.handleResourcesReceived))
	mux.HandleFunc("GET /resources/received/thumbnail", srv.handleResourcesReceivedThumbnail)
	mux.HandleFunc("GET /resources/mobile/shared", withJSON(srv.handleMobileSharedResources))
	mux.HandleFunc("GET /resources/mobile/shared/{resourceId}/list", withJSON(srv.handleMobileSharedResourceFolderList))
	mux.HandleFunc("GET /resources/mobile/shared/{resourceId}/list/{path...}", withJSON(srv.handleMobileSharedResourceFolderListPath))
	mux.HandleFunc("GET /resources/mobile/received", withJSON(srv.handleMobileReceivedResources))
	mux.HandleFunc("GET /resources/mobile/received/download", srv.handleMobileReceivedFileDownload)
	mux.HandleFunc("GET /resources/mobile/received/thumbnail", srv.handleMobileReceivedFileThumbnail)
	mux.HandleFunc("GET /resources/mobile/received/preview", srv.handleMobileReceivedFilePreview)
	mux.HandleFunc("GET /resources/mobile/received/stream", srv.handleMobileReceivedFileStream)
	mux.HandleFunc("POST /resources/mobile/view/{resourceId}", withJSON(srv.handleMobileResourceView))
	mux.HandleFunc("GET /resources/mobile/download/{resourceId}", srv.handleMobileResourceDownload)
	// Devices
	mux.HandleFunc("GET /devices/{deviceId}", withJSON(srv.handleDeviceDetail))
	mux.HandleFunc("GET /devices/{deviceId}/files", withJSON(srv.handleDeviceFiles))
	mux.HandleFunc("GET /devices/{deviceId}/dates", withJSON(srv.handleDeviceDates))
	mux.HandleFunc("GET /devices/{deviceId}/existing-file-keys", withJSON(srv.handleDeviceExistingFileKeys))
	// Settings
	mux.HandleFunc("GET /settings", withJSON(srv.handleGetSettings))
	mux.HandleFunc("PUT /settings", withJSON(srv.handleUpdateSettings))
	mux.HandleFunc("POST /settings/reset-state", withJSON(srv.handleResetState))
	mux.HandleFunc("GET /settings/connection-devices", withJSON(srv.handleGetConnectionDevices))
	mux.HandleFunc("POST /settings/connection-devices/{clientId}/revoke", withJSON(srv.handleRevokeConnectionDevice))
	mux.HandleFunc("POST /settings/blocked-clients/{clientId}/clear", withJSON(srv.handleClearBlockedClient))
	// Connection code
	mux.HandleFunc("POST /connection-code", withJSON(srv.handleSetConnectionCode))
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
	// Personal files are account-scoped and require the mobile bearer token to
	// match the desktop account currently synced by the desktop app.
	mux.HandleFunc("GET /personal/list", withJSON(srv.handlePersonalList))
	mux.HandleFunc("GET /personal/list/{path...}", withJSON(srv.handlePersonalListPath))
	mux.HandleFunc("GET /personal/thumbnail/{path...}", srv.handlePersonalThumbnail)
	mux.HandleFunc("GET /personal/download/{path...}", srv.handlePersonalDownload)
	mux.HandleFunc("GET /personal/stream/{path...}", srv.handlePersonalStream)
	mux.HandleFunc("POST /wake/proxy", withJSON(srv.handleProxyWake))
	// Transfer state
	mux.HandleFunc("GET /transfer/active", withJSON(srv.handleTransferActive))
	// Account context sync for LAN personal sharing authorization.
	mux.HandleFunc("POST /account/context", withJSON(srv.handleSyncAccountContext))
	// Tunnel credentials sync for desktop P2P signaling.
	mux.HandleFunc("POST /tunnel/credentials", withJSON(srv.handleSyncTunnelCredentials))
	// WebSocket
	mux.HandleFunc("GET /events/stream", srv.handleEventStream)

	return srv, withLogging(mux)
}

func isLocalRequest(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// handleEventStream upgrades the connection to a WebSocket for real-time events.
func (s *Server) handleEventStream(w http.ResponseWriter, r *http.Request) {
	s.hub.HandleUpgrade(w, r)
}
