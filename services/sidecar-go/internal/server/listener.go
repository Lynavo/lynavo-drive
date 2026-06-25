package server

import (
	"database/sql"
	"errors"
	"log/slog"
	"net"
	"sync"
	"time"

	"github.com/nicksyncflow/sidecar/internal/config"
	"github.com/nicksyncflow/sidecar/internal/events"
	"github.com/nicksyncflow/sidecar/internal/protocol"
	"github.com/nicksyncflow/sidecar/internal/store"
	"github.com/nicksyncflow/sidecar/internal/wake"
)

const (
	tcpSocketBufferBytes          = 16 * 1024 * 1024
	disconnectPresenceGraceWindow = 75 * time.Second
	pairingInvalidationWriteWait  = 500 * time.Millisecond
)

// TCPServer listens for incoming LMUP/2 connections from mobile clients.
type TCPServer struct {
	listener net.Listener
	store    *store.Store
	config   *config.Config
	hub      *events.Hub
	presence PresenceStateProvider
	wake     WakeProvider

	mu               sync.RWMutex
	connectedClients map[string]string // clientID → state ("authenticated"|"syncing")
	activeConns      map[string]map[*connection]struct{}

	OnPairedDevicesChanged func(reason string)
}

type PresenceStateProvider interface {
	IsAlive(clientID string, window time.Duration) bool
}

type WakeProvider interface {
	WakeCapability() *protocol.WakeCapability
}

type defaultWakeProvider struct{}

func (defaultWakeProvider) WakeCapability() *protocol.WakeCapability {
	return wake.Metadata()
}

// NewTCPServer creates a new TCPServer backed by the given store, config, and event hub.
func NewTCPServer(s *store.Store, cfg *config.Config, hub *events.Hub) *TCPServer {
	return &TCPServer{
		store:            s,
		config:           cfg,
		hub:              hub,
		wake:             defaultWakeProvider{},
		connectedClients: make(map[string]string),
		activeConns:      make(map[string]map[*connection]struct{}),
	}
}

func (s *TCPServer) SetPresenceProvider(presence PresenceStateProvider) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.presence = presence
}

func (s *TCPServer) SetWakeProvider(provider WakeProvider) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.wake = provider
}

func (s *TCPServer) WakeCapability() *protocol.WakeCapability {
	s.mu.RLock()
	provider := s.wake
	s.mu.RUnlock()
	if provider == nil {
		return nil
	}
	return provider.WakeCapability()
}

func (s *TCPServer) DisconnectBroadcastStatus(clientID string) string {
	s.mu.RLock()
	presence := s.presence
	s.mu.RUnlock()

	if !s.clientCanUsePresence(clientID) {
		return "offline"
	}
	if clientID != "" && presence != nil && presence.IsAlive(clientID, disconnectPresenceGraceWindow) {
		return "connected_idle"
	}

	return "offline"
}

func (s *TCPServer) clientCanUsePresence(clientID string) bool {
	if clientID == "" || s.store == nil {
		return true
	}
	device, err := s.store.GetPairedDevice(clientID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false
		}
		slog.Warn("failed to check paired device before disconnect status", "clientID", clientID, "err", err)
		return false
	}
	return device.RevokedAt == nil
}

// SetClientState marks a client as connected with the given state.
func (s *TCPServer) SetClientState(clientID, state string) {
	s.mu.Lock()
	wasGlobalActive := s.anyClientSyncingLocked()
	s.connectedClients[clientID] = state
	isGlobalActive := s.anyClientSyncingLocked()
	s.mu.Unlock()

	if wasGlobalActive != isGlobalActive {
		s.hub.Broadcast(events.Event{
			Type: "transfer.active.changed",
			Payload: map[string]any{
				"isActive": isGlobalActive,
			},
		})
	}
}

func (s *TCPServer) RegisterClientConnection(clientID string, conn *connection) {
	if clientID == "" || conn == nil {
		return
	}
	s.mu.Lock()
	if s.activeConns == nil {
		s.activeConns = make(map[string]map[*connection]struct{})
	}
	if s.activeConns[clientID] == nil {
		s.activeConns[clientID] = make(map[*connection]struct{})
	}
	s.activeConns[clientID][conn] = struct{}{}
	s.mu.Unlock()
}

func (s *TCPServer) UnregisterClientConnection(clientID string, conn *connection) bool {
	if clientID == "" || conn == nil {
		return false
	}
	s.mu.Lock()
	hasActiveConnections := false
	if conns := s.activeConns[clientID]; conns != nil {
		delete(conns, conn)
		if len(conns) == 0 {
			delete(s.activeConns, clientID)
		} else {
			hasActiveConnections = true
		}
	}
	s.mu.Unlock()
	return hasActiveConnections
}

// RemoveClient removes a client from the connected map.
func (s *TCPServer) RemoveClient(clientID string) {
	s.mu.Lock()
	if len(s.activeConns[clientID]) > 0 {
		s.mu.Unlock()
		return
	}
	wasGlobalActive := s.anyClientSyncingLocked()
	delete(s.connectedClients, clientID)
	isGlobalActive := s.anyClientSyncingLocked()
	s.mu.Unlock()

	if wasGlobalActive != isGlobalActive {
		s.hub.Broadcast(events.Event{
			Type: "transfer.active.changed",
			Payload: map[string]any{
				"isActive": isGlobalActive,
			},
		})
	}
}

func (s *TCPServer) DisconnectClients(clientIDs []string, reason string) int {
	if len(clientIDs) == 0 {
		return 0
	}

	conns := make([]*connection, 0, len(clientIDs))
	s.mu.RLock()
	for _, clientID := range clientIDs {
		for conn := range s.activeConns[clientID] {
			conns = append(conns, conn)
		}
	}
	s.mu.RUnlock()

	for _, conn := range conns {
		if shouldSendPairingInvalidated(reason) {
			if err := conn.conn.SetWriteDeadline(time.Now().Add(pairingInvalidationWriteWait)); err != nil {
				slog.Debug("failed to set pairing invalidation write deadline", "reason", reason, "remote", conn.conn.RemoteAddr(), "err", err)
			}
			if err := conn.sendPairingInvalidated(reason); err != nil {
				slog.Debug("failed to send pairing invalidation", "reason", reason, "remote", conn.conn.RemoteAddr(), "err", err)
			}
			if err := conn.conn.SetWriteDeadline(time.Time{}); err != nil {
				slog.Debug("failed to clear pairing invalidation write deadline", "reason", reason, "remote", conn.conn.RemoteAddr(), "err", err)
			}
		}
		if err := conn.conn.Close(); err != nil {
			slog.Debug("failed to close client connection", "reason", reason, "remote", conn.conn.RemoteAddr(), "err", err)
		}
	}
	return len(conns)
}

func shouldSendPairingInvalidated(reason string) bool {
	switch reason {
	case "connection_code_regenerated", "connection_code_set":
		return true
	default:
		return false
	}
}

// anyClientSyncingLocked checks if any connected client is in syncing state.
// Caller must hold s.mu.
func (s *TCPServer) anyClientSyncingLocked() bool {
	for _, st := range s.connectedClients {
		if st == "syncing" {
			return true
		}
	}
	return false
}

// GetClientState returns the connection state for a client, or empty string if offline.
func (s *TCPServer) GetClientState(clientID string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.connectedClients[clientID]
}

// ConnectedClientStates returns a snapshot of all connected client states.
func (s *TCPServer) ConnectedClientStates() map[string]string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	m := make(map[string]string, len(s.connectedClients))
	for k, v := range s.connectedClients {
		m[k] = v
	}
	return m
}

// Start begins listening on addr and accepting connections in a background goroutine.
func (s *TCPServer) Start(addr string) error {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	s.listener = ln
	slog.Info("tcp server listening", "addr", addr)
	go s.acceptLoop()
	return nil
}

// Stop closes the listener, causing the accept loop to exit.
func (s *TCPServer) Stop() {
	if s.listener != nil {
		s.listener.Close()
	}
}

func (s *TCPServer) acceptLoop() {
	for {
		conn, err := s.listener.Accept()
		if err != nil {
			slog.Debug("tcp accept stopped", "err", err)
			return
		}
		tuneTCPConnection(conn)
		slog.Info("tcp client connected", "remote", conn.RemoteAddr())
		go newConnection(conn, s.store, s.config, s.hub, s).handle()
	}
}

func tuneTCPConnection(conn net.Conn) {
	tcpConn, ok := conn.(*net.TCPConn)
	if !ok {
		return
	}
	if err := tcpConn.SetNoDelay(true); err != nil {
		slog.Debug("failed to set TCP_NODELAY", "remote", conn.RemoteAddr(), "err", err)
	}
	if err := tcpConn.SetReadBuffer(tcpSocketBufferBytes); err != nil {
		slog.Debug("failed to set TCP read buffer", "remote", conn.RemoteAddr(), "err", err)
	}
	if err := tcpConn.SetWriteBuffer(tcpSocketBufferBytes); err != nil {
		slog.Debug("failed to set TCP write buffer", "remote", conn.RemoteAddr(), "err", err)
	}
}
