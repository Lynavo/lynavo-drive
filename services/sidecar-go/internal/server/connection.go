package server

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"time"

	"github.com/nicksyncflow/sidecar/internal/config"
	"github.com/nicksyncflow/sidecar/internal/events"
	"github.com/nicksyncflow/sidecar/internal/protocol"
	"github.com/nicksyncflow/sidecar/internal/store"
)

const (
	readDeadline  = 45 * time.Second
	pingInterval  = 15 * time.Second
)

// connState tracks the protocol state machine for a single connection.
type connState int

const (
	stateWaitHello connState = iota
	stateWaitAuth  // waiting for AUTH_REQ (nonce-HMAC) from returning device
	stateWaitPair  // waiting for PAIR_REQ from new device
	stateAuthenticated
	stateSyncing
)

// connection represents a single LMUP/2 client connection and its state machine.
type connection struct {
	conn       net.Conn
	store      *store.Store
	config     *config.Config
	hub        *events.Hub
	state      connState
	clientID   string
	sessionID  string
	nonce      string      // generated on HELLO_RES for HMAC auth
	fileWriter *FileWriter // current .part file being written
	pingTimer  *time.Timer // 15s inactivity -> send PING
}

func newConnection(conn net.Conn, s *store.Store, cfg *config.Config, hub *events.Hub) *connection {
	return &connection{
		conn:   conn,
		store:  s,
		config: cfg,
		hub:    hub,
		state:  stateWaitHello,
	}
}

// handle runs the main read loop for this connection. It reads frames,
// resets deadlines, and dispatches to the appropriate handler.
func (c *connection) handle() {
	defer func() {
		if c.fileWriter != nil {
			c.fileWriter.Close()
			// Leave .part for resume; only remove on SHA256 mismatch (in handleFileEnd)
		}
		c.stopPingTimer()
		c.conn.Close()
		slog.Info("tcp client disconnected", "remote", c.conn.RemoteAddr(), "clientID", c.clientID)
	}()

	c.resetDeadline()
	c.startPingTimer()

	for {
		hdr, body, err := protocol.ReadFrame(c.conn)
		if err != nil {
			slog.Info("connection closed", "remote", c.conn.RemoteAddr(), "err", err)
			return
		}
		c.resetDeadline()
		c.resetPingTimer()
		if err := c.dispatch(hdr, body); err != nil {
			slog.Warn("dispatch error, closing connection",
				"remote", c.conn.RemoteAddr(),
				"type", fmt.Sprintf("0x%04x", hdr.Type),
				"err", err,
			)
			_ = c.sendError("PROTOCOL_ERROR", err.Error())
			return
		}
	}
}

// dispatch routes an incoming frame to the appropriate handler method.
func (c *connection) dispatch(hdr *protocol.FrameHeader, body []byte) error {
	switch hdr.Type {
	case protocol.TypeHelloReq:
		return c.handleHello(body)
	case protocol.TypeAuthReq:
		return c.handleAuth(body)
	case protocol.TypePairReq:
		return c.handlePair(body)
	case protocol.TypeSyncBeginReq:
		return c.handleSyncBegin(body)
	case protocol.TypeFileInitReq:
		return c.handleFileInit(body)
	case protocol.TypeFileData:
		return c.handleFileData(hdr, body)
	case protocol.TypeFileEndReq:
		return c.handleFileEnd(body)
	case protocol.TypeSyncEndReq:
		return c.handleSyncEnd(body)
	case protocol.TypePing:
		return c.handlePing()
	case protocol.TypePong:
		return nil // reset deadline already done above
	default:
		return fmt.Errorf("unknown message type: 0x%04x", hdr.Type)
	}
}

// --- Deadline and ping timer management ---

func (c *connection) resetDeadline() {
	c.conn.SetReadDeadline(time.Now().Add(readDeadline))
}

func (c *connection) startPingTimer() {
	c.pingTimer = time.AfterFunc(pingInterval, func() {
		if err := protocol.WriteFrame(c.conn, protocol.TypePing, nil); err != nil {
			slog.Debug("failed to send ping", "remote", c.conn.RemoteAddr(), "err", err)
			return
		}
		// Restart timer for the next interval
		c.startPingTimer()
	})
}

func (c *connection) resetPingTimer() {
	if c.pingTimer != nil {
		c.pingTimer.Reset(pingInterval)
	}
}

func (c *connection) stopPingTimer() {
	if c.pingTimer != nil {
		c.pingTimer.Stop()
	}
}

// --- Helpers ---

// sendJSON marshals v to JSON and writes it as an LMUP/2 frame.
func (c *connection) sendJSON(typ uint16, v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return fmt.Errorf("marshal response: %w", err)
	}
	return protocol.WriteFrame(c.conn, typ, data)
}

// sendError sends a TypeError frame with the given code and message.
func (c *connection) sendError(code, msg string) error {
	return c.sendJSON(protocol.TypeError, protocol.ErrorMsg{
		Code:    code,
		Message: msg,
	})
}

