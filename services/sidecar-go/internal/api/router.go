package api

import (
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/lynavo/lynavo-drive/services/sidecar-go/internal/config"
	"github.com/lynavo/lynavo-drive/services/sidecar-go/internal/events"
	"github.com/lynavo/lynavo-drive/services/sidecar-go/internal/protocol"
	"github.com/lynavo/lynavo-drive/services/sidecar-go/internal/store"
	"github.com/lynavo/lynavo-drive/services/sidecar-go/internal/wake"
)

// ClientStateProvider returns live TCP connection states per clientID.
type ClientStateProvider interface {
	ConnectedClientStates() map[string]string
}

type ClientDisconnectProvider interface {
	DisconnectClients(clientIDs []string, reason string) int
}

type WakeProvider interface {
	WakeCapability() *protocol.WakeCapability
}

type defaultWakeProvider struct{}

func (defaultWakeProvider) WakeCapability() *protocol.WakeCapability {
	return wake.Metadata()
}

// Server holds the dependencies for the HTTP API handlers.
type Server struct {
	store                  *store.Store
	config                 *config.Config
	hub                    *events.Hub
	clientStates           ClientStateProvider
	presence               *PresenceTracker
	wakeProvider           WakeProvider
	power                  *PowerTracker
	thumbnailLimiter       chan struct{}
	videoThumbnailMu       sync.Mutex
	videoThumbnailInflight map[string]*videoThumbnailInflight
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

// NewServer creates a new HTTP handler with all API routes registered.
func NewServer(s *store.Store, cfg *config.Config, hub *events.Hub, csp ClientStateProvider) (*Server, http.Handler) {
	srv := &Server{
		store:                  s,
		config:                 cfg,
		hub:                    hub,
		clientStates:           csp,
		presence:               NewPresenceTracker(),
		wakeProvider:           defaultWakeProvider{},
		power:                  NewPowerTracker(),
		thumbnailLimiter:       make(chan struct{}, 2),
		videoThumbnailInflight: make(map[string]*videoThumbnailInflight),
		personalAccessNonces:   make(map[string]time.Time),
	}
	mux := http.NewServeMux()

	// Presence (mobile heartbeat)
	mux.HandleFunc("POST /presence/{clientId}", withJSON(requireLocalNetworkRequest(srv.handlePresence)))
	mux.HandleFunc("POST /power/state", withJSON(srv.handlePowerState))
	// Health
	mux.HandleFunc("GET /health", withJSON(requireLocalNetworkRequest(srv.handleHealth)))
	// Dashboard
	mux.HandleFunc("GET /dashboard/summary", withJSON(requireLocalRequest(srv.handleDashboardSummary)))
	mux.HandleFunc("GET /dashboard/devices", withJSON(requireLocalRequest(srv.handleDashboardDevices)))
	// Local management
	mux.HandleFunc("GET /management/devices", withJSON(requireLocalRequest(srv.handleManagementDevices)))
	mux.HandleFunc("POST /management/devices/{clientId}/unblock", withJSON(requireLocalRequest(srv.handleManagementUnblockDevice)))
	mux.HandleFunc("POST /management/devices/{clientId}/block", withJSON(requireLocalRequest(srv.handleManagementBlockDevice)))
	mux.HandleFunc("GET /management/records/sync", withJSON(requireLocalNetworkRequest(srv.handleManagementSyncRecords)))
	mux.HandleFunc("GET /management/records/access", withJSON(requireLocalRequest(srv.handleManagementAccessRecords)))
	// Shared resource management
	mux.HandleFunc("GET /resources/shared", withJSON(requireLocalRequest(srv.handleResourcesShared)))
	mux.HandleFunc("POST /resources/shared", withJSON(requireLocalRequest(srv.handleResourcesAddShared)))
	mux.HandleFunc("DELETE /resources/shared/{resourceId}", withJSON(requireLocalRequest(srv.handleResourcesRemoveShared)))
	mux.HandleFunc("GET /resources/received", withJSON(requireLocalRequest(srv.handleResourcesReceived)))
	mux.HandleFunc("GET /resources/received/thumbnail", requireLocalRequest(srv.handleResourcesReceivedThumbnail))
	mux.HandleFunc("GET /resources/mobile/shared", withJSON(requireLocalNetworkRequest(srv.handleMobileSharedResources)))
	mux.HandleFunc("GET /resources/mobile/shared/{resourceId}/list", withJSON(requireLocalNetworkRequest(srv.handleMobileSharedResourceFolderList)))
	mux.HandleFunc("GET /resources/mobile/shared/{resourceId}/list/{path...}", withJSON(requireLocalNetworkRequest(srv.handleMobileSharedResourceFolderListPath)))
	mux.HandleFunc("GET /resources/mobile/received", withJSON(requireLocalNetworkRequest(srv.handleMobileReceivedResources)))
	mux.HandleFunc("GET /resources/mobile/received/download", requireLocalNetworkRequest(srv.handleMobileReceivedFileDownload))
	mux.HandleFunc("GET /resources/mobile/received/thumbnail", requireLocalNetworkRequest(srv.handleMobileReceivedFileThumbnail))
	mux.HandleFunc("GET /resources/mobile/received/preview", requireLocalNetworkRequest(srv.handleMobileReceivedFilePreview))
	mux.HandleFunc("GET /resources/mobile/received/stream", requireLocalNetworkRequest(srv.handleMobileReceivedFileStream))
	mux.HandleFunc("POST /resources/mobile/view/{resourceId}", withJSON(requireLocalNetworkRequest(srv.handleMobileResourceView)))
	mux.HandleFunc("GET /resources/mobile/download/{resourceId}", requireLocalNetworkRequest(srv.handleMobileResourceDownload))
	// Devices
	mux.HandleFunc("GET /devices/{deviceId}", withJSON(requireLocalRequest(srv.handleDeviceDetail)))
	mux.HandleFunc("GET /devices/{deviceId}/files", withJSON(requireLocalRequest(srv.handleDeviceFiles)))
	mux.HandleFunc("GET /devices/{deviceId}/dates", withJSON(requireLocalRequest(srv.handleDeviceDates)))
	mux.HandleFunc("GET /devices/{deviceId}/receive-locations", withJSON(requireLocalRequest(srv.handleDeviceReceiveLocations)))
	mux.HandleFunc("GET /devices/{deviceId}/existing-file-keys", withJSON(requireLocalNetworkRequest(srv.handleDeviceExistingFileKeys)))
	// Settings
	mux.HandleFunc("GET /settings", withJSON(requireLocalRequest(srv.handleGetSettings)))
	mux.HandleFunc("PUT /settings", withJSON(requireLocalRequest(srv.handleUpdateSettings)))
	mux.HandleFunc("GET /settings/connection-devices", withJSON(requireLocalRequest(srv.handleGetConnectionDevices)))
	mux.HandleFunc("POST /settings/connection-devices/{clientId}/revoke", withJSON(requireLocalRequest(srv.handleRevokeConnectionDevice)))
	mux.HandleFunc("POST /settings/blocked-clients/{clientId}/clear", withJSON(requireLocalRequest(srv.handleClearBlockedClient)))
	// Connection code
	mux.HandleFunc("POST /connection-code", withJSON(requireLocalRequest(srv.handleSetConnectionCode)))
	mux.HandleFunc("POST /connection-code/regenerate", withJSON(requireLocalRequest(srv.handleRegenerateCode)))
	// Share
	mux.HandleFunc("GET /share/status", withJSON(requireLocalRequest(srv.handleShareStatus)))
	mux.HandleFunc("POST /share/validate", withJSON(requireLocalRequest(srv.handleShareValidate)))
	// Shared files (binary responses — no withJSON wrapper)
	mux.HandleFunc("GET /shared/list", withJSON(requireLocalNetworkRequest(srv.handleSharedList)))
	mux.HandleFunc("GET /shared/list/{path...}", withJSON(requireLocalNetworkRequest(srv.handleSharedListPath)))
	mux.HandleFunc("GET /shared/thumbnail/{path...}", requireLocalNetworkRequest(srv.handleSharedThumbnail))
	mux.HandleFunc("GET /shared/download/{path...}", requireLocalNetworkRequest(srv.handleSharedDownload))
	mux.HandleFunc("GET /shared/stream/{path...}", requireLocalNetworkRequest(srv.handleSharedStream))
	// Personal files use paired-device HMAC access in the OSS runtime.
	mux.HandleFunc("GET /personal/list", withJSON(requireLocalNetworkRequest(srv.handlePersonalList)))
	mux.HandleFunc("GET /personal/list/{path...}", withJSON(requireLocalNetworkRequest(srv.handlePersonalListPath)))
	mux.HandleFunc("GET /personal/thumbnail/{path...}", requireLocalNetworkRequest(srv.handlePersonalThumbnail))
	mux.HandleFunc("GET /personal/download/{path...}", requireLocalNetworkRequest(srv.handlePersonalDownload))
	mux.HandleFunc("GET /personal/stream/{path...}", requireLocalNetworkRequest(srv.handlePersonalStream))
	// Transfer state
	mux.HandleFunc("GET /transfer/active", withJSON(requireLocalRequest(srv.handleTransferActive)))
	// WebSocket
	mux.HandleFunc("GET /events/stream", requireLocalRequest(srv.handleEventStream))

	return srv, withLogging(mux)
}

func isLocalRequest(r *http.Request) bool {
	ip := remoteIP(r)
	return ip != nil && ip.IsLoopback()
}

func isLocalNetworkRequest(r *http.Request) bool {
	ip := remoteIP(r)
	return ip != nil && (ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast())
}

func remoteIP(r *http.Request) net.IP {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	host = strings.Trim(host, "[]")
	return net.ParseIP(host)
}

func requireLocalRequest(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !isLocalRequest(r) {
			writeError(w, http.StatusForbidden, "local access required")
			return
		}
		next(w, r)
	}
}

func requireLocalNetworkRequest(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !isLocalNetworkRequest(r) {
			writeError(w, http.StatusForbidden, "local network access required")
			return
		}
		next(w, r)
	}
}

// handleEventStream upgrades the connection to a WebSocket for real-time events.
func (s *Server) handleEventStream(w http.ResponseWriter, r *http.Request) {
	s.hub.HandleUpgrade(w, r)
}
