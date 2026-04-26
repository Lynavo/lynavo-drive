package server

import (
	"log/slog"
	"net"
	"sync"
	"time"

	"github.com/nicksyncflow/sidecar/internal/config"
	"github.com/nicksyncflow/sidecar/internal/events"
	"github.com/nicksyncflow/sidecar/internal/store"
)

const tcpSocketBufferBytes = 16 * 1024 * 1024

// TCPServer listens for incoming LMUP/2 connections from mobile clients.
type TCPServer struct {
	listener net.Listener
	store    *store.Store
	config   *config.Config
	hub      *events.Hub
	presence PresenceStateProvider

	mu               sync.RWMutex
	connectedClients map[string]string // clientID → state ("authenticated"|"syncing")
}

type PresenceStateProvider interface {
	IsAlive(clientID string, window time.Duration) bool
}

// NewTCPServer creates a new TCPServer backed by the given store, config, and event hub.
func NewTCPServer(s *store.Store, cfg *config.Config, hub *events.Hub) *TCPServer {
	return &TCPServer{store: s, config: cfg, hub: hub, connectedClients: make(map[string]string)}
}

func (s *TCPServer) SetPresenceProvider(presence PresenceStateProvider) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.presence = presence
}

func (s *TCPServer) DisconnectBroadcastStatus(clientID string) string {
	s.mu.RLock()
	presence := s.presence
	s.mu.RUnlock()

	if clientID != "" && presence != nil && presence.IsAlive(clientID, 45*time.Second) {
		return "connected_idle"
	}

	return "offline"
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

// RemoveClient removes a client from the connected map.
func (s *TCPServer) RemoveClient(clientID string) {
	s.mu.Lock()
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
