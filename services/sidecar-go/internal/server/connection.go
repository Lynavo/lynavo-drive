package server

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"sync"
	"time"

	"github.com/nicksyncflow/sidecar/internal/config"
	"github.com/nicksyncflow/sidecar/internal/events"
	"github.com/nicksyncflow/sidecar/internal/protocol"
	"github.com/nicksyncflow/sidecar/internal/store"
)

const (
	readDeadline                = 45 * time.Second
	pingInterval                = 15 * time.Second
	progressFlushBytes    int64 = 64 * 1024 * 1024 // 64 MiB
	progressFlushInterval       = 2 * time.Second
	ackFlushBytes         int64 = 16 * 1024 * 1024 // send FILE_ACK at least every 16 MiB
	ackFlushInterval            = 250 * time.Millisecond
)

// connState tracks the protocol state machine for a single connection.
type connState int

const (
	stateWaitHello connState = iota
	stateWaitAuth            // waiting for AUTH_REQ (nonce-HMAC) from returning device
	stateWaitPair            // waiting for PAIR_REQ from new device
	stateAuthenticated
	stateSyncing
)

// connection represents a single LMUP/2 client connection and its state machine.
type connection struct {
	conn       net.Conn
	store      *store.Store
	config     *config.Config
	hub        *events.Hub
	server     *TCPServer // for tracking connected clients
	state      connState
	clientID   string
	sessionID  string
	nonce      string      // generated on HELLO_RES for HMAC auth
	fileWriter *FileWriter // current .part file being written
	clientIP   string
	pingTimer  *time.Timer // 15s inactivity -> send PING
	writeMu    sync.Mutex
	ackMu      sync.Mutex

	// Active file transfer timing, measured from FILE_INIT accepted to FILE_END.
	activeTransferFileKey string
	activeTransferStartAt time.Time

	// Upload progress persistence is throttled to reduce SQLite write pressure.
	progressFileKey         string
	lastProgressFlushOffset int64
	lastProgressFlushAt     time.Time

	// FILE_ACK coalescing state to reduce control-frame overhead.
	ackFileKey    string
	lastAckOffset int64
	lastAckAt     time.Time
	ackTimer      *time.Timer
	pendingAckKey string
	pendingAckPos int64
}

func newConnection(conn net.Conn, s *store.Store, cfg *config.Config, hub *events.Hub, srv *TCPServer) *connection {
	return &connection{
		conn:   conn,
		store:  s,
		config: cfg,
		hub:    hub,
		server: srv,
		state:  stateWaitHello,
	}
}

// handle runs the main read loop for this connection. It reads frames,
// resets deadlines, and dispatches to the appropriate handler.
func (c *connection) handle() {
	defer func() {
		if c.fileWriter != nil {
			c.fileWriter.Close()
		}
		c.stopPingTimer()
		c.stopAckTimer()
		c.conn.Close()
		if c.clientID != "" && c.server != nil {
			c.server.RemoveClient(c.clientID)

			// Broadcast offline event so desktop UI updates immediately
			// (without this, the UI stays stuck on "transferring" until
			// the next REST poll because no WebSocket push is sent).
			c.hub.Broadcast(events.Event{
				Type: "device.state.changed",
				Payload: map[string]any{
					"deviceId": c.clientID,
					"status":   "offline",
				},
			})
			c.hub.Broadcast(events.Event{Type: "dashboard.updated", Payload: nil})

			// Clean up stale session state — if the client disconnected
			// without sending SYNC_END_REQ, the session row is stuck in
			// "transferring" forever. Mark it as interrupted.
			if c.sessionID != "" {
				if err := c.store.UpdateSessionState(c.sessionID, "interrupted"); err != nil {
					slog.Warn("failed to mark session interrupted on disconnect",
						"sessionID", c.sessionID, "err", err)
				}
			}
		}
		slog.Info("tcp client disconnected", "remote", c.conn.RemoteAddr(), "clientID", c.clientID)
	}()

	c.resetDeadline()
	c.startPingTimer()

	for {
		hdr, body, release, err := protocol.ReadFrameBorrowed(c.conn)
		if err != nil {
			slog.Info("connection closed", "remote", c.conn.RemoteAddr(), "err", err)
			return
		}
		c.resetDeadline()
		c.resetPingTimer()
		if err := c.dispatch(hdr, body); err != nil {
			if release != nil {
				release()
			}
			slog.Warn("dispatch error, closing connection",
				"remote", c.conn.RemoteAddr(),
				"type", fmt.Sprintf("0x%04x", hdr.Type),
				"err", err,
			)
			_ = c.sendError("PROTOCOL_ERROR", err.Error())
			return
		}
		if release != nil {
			release()
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
		if err := c.sendFrame(protocol.TypePing, nil); err != nil {
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

func (c *connection) resetProgressFlush(fileKey string, offset int64) {
	c.progressFileKey = fileKey
	c.lastProgressFlushOffset = offset
	c.lastProgressFlushAt = time.Now()
}

func (c *connection) maybeFlushProgress(fileKey string, offset int64) error {
	if fileKey == "" {
		return nil
	}
	if c.progressFileKey != fileKey {
		c.resetProgressFlush(fileKey, offset)
		return nil
	}
	if offset < c.lastProgressFlushOffset {
		c.resetProgressFlush(fileKey, offset)
		return nil
	}
	if offset-c.lastProgressFlushOffset < progressFlushBytes &&
		time.Since(c.lastProgressFlushAt) < progressFlushInterval {
		return nil
	}
	return c.flushProgress(fileKey, offset)
}

func (c *connection) flushProgress(fileKey string, offset int64) error {
	if fileKey == "" {
		return nil
	}
	if err := c.store.UpdateUploadProgress(fileKey, offset); err != nil {
		return err
	}
	if err := c.store.UpdateSessionActiveFile(c.sessionID, fileKey, offset); err != nil {
		return err
	}
	c.lastProgressFlushOffset = offset
	c.lastProgressFlushAt = time.Now()
	return nil
}

func (c *connection) startTransferTimer(fileKey string) {
	if fileKey == "" {
		c.activeTransferFileKey = ""
		c.activeTransferStartAt = time.Time{}
		return
	}
	c.activeTransferFileKey = fileKey
	c.activeTransferStartAt = time.Now()
}

func (c *connection) clearTransferTimer(fileKey string) {
	if fileKey != "" && c.activeTransferFileKey != fileKey {
		return
	}
	c.activeTransferFileKey = ""
	c.activeTransferStartAt = time.Time{}
}

func (c *connection) transferElapsedMs(fileKey string) int64 {
	if fileKey == "" || c.activeTransferFileKey != fileKey || c.activeTransferStartAt.IsZero() {
		return 0
	}
	return time.Since(c.activeTransferStartAt).Milliseconds()
}

func (c *connection) resetAckState(fileKey string, offset int64) {
	c.ackMu.Lock()
	defer c.ackMu.Unlock()
	c.resetAckStateLocked(fileKey, offset)
}

func (c *connection) resetAckStateLocked(fileKey string, offset int64) {
	c.ackFileKey = fileKey
	c.lastAckOffset = offset
	c.lastAckAt = time.Time{}
	c.clearAckTimerLocked("")
}

func (c *connection) clearAckState(fileKey string) {
	c.ackMu.Lock()
	defer c.ackMu.Unlock()
	c.clearAckStateLocked(fileKey)
}

func (c *connection) clearAckStateLocked(fileKey string) {
	if fileKey != "" && c.ackFileKey != fileKey {
		return
	}
	c.ackFileKey = ""
	c.lastAckOffset = 0
	c.lastAckAt = time.Time{}
	c.clearAckTimerLocked("")
}

func (c *connection) shouldSendAck(fileKey string, committedOffset int64) bool {
	c.ackMu.Lock()
	defer c.ackMu.Unlock()
	return c.shouldSendAckLocked(fileKey, committedOffset)
}

func (c *connection) shouldSendAckLocked(fileKey string, committedOffset int64) bool {
	if fileKey == "" {
		return true
	}
	if c.ackFileKey != fileKey {
		c.resetAckStateLocked(fileKey, committedOffset)
		return true
	}
	// Always emit the first ACK for a file to unblock the sender quickly.
	if c.lastAckAt.IsZero() {
		return true
	}
	// Ensure file tail is always ACKed even when coalescing is enabled.
	if c.fileWriter != nil && c.fileWriter.expectedSize > 0 && committedOffset >= c.fileWriter.expectedSize {
		return true
	}
	if committedOffset-c.lastAckOffset >= ackFlushBytes {
		return true
	}
	if time.Since(c.lastAckAt) >= ackFlushInterval {
		return true
	}
	return false
}

func (c *connection) markAckSent(fileKey string, committedOffset int64) {
	c.ackMu.Lock()
	defer c.ackMu.Unlock()
	c.markAckSentLocked(fileKey, committedOffset)
}

func (c *connection) markAckSentLocked(fileKey string, committedOffset int64) {
	c.ackFileKey = fileKey
	c.lastAckOffset = committedOffset
	c.lastAckAt = time.Now()
	c.clearAckTimerLocked(fileKey)
}

func (c *connection) scheduleAckFlush(fileKey string, committedOffset int64) {
	if fileKey == "" {
		return
	}

	c.ackMu.Lock()
	defer c.ackMu.Unlock()

	if c.ackFileKey != "" && c.ackFileKey != fileKey {
		c.resetAckStateLocked(fileKey, committedOffset)
		return
	}
	if committedOffset <= c.lastAckOffset {
		return
	}

	c.clearAckTimerLocked(fileKey)
	c.pendingAckKey = fileKey
	if committedOffset > c.pendingAckPos {
		c.pendingAckPos = committedOffset
	}

	delay := ackFlushInterval - time.Since(c.lastAckAt)
	if c.lastAckAt.IsZero() || delay < 0 {
		delay = 0
	}

	c.ackTimer = time.AfterFunc(delay, c.flushScheduledAck)
}

func (c *connection) flushScheduledAck() {
	c.ackMu.Lock()
	fileKey := c.pendingAckKey
	committedOffset := c.pendingAckPos
	c.ackTimer = nil
	c.pendingAckKey = ""
	c.pendingAckPos = 0
	if fileKey == "" || (c.ackFileKey == fileKey && committedOffset <= c.lastAckOffset) {
		c.ackMu.Unlock()
		return
	}
	c.ackMu.Unlock()

	ack := protocol.FileAck{
		FileKey:         fileKey,
		CommittedOffset: committedOffset,
	}
	if err := c.sendJSON(protocol.TypeFileAck, ack); err != nil {
		slog.Debug("failed to send scheduled FILE_ACK", "clientID", c.clientID, "fileKey", fileKey, "offset", committedOffset, "err", err)
		return
	}
	c.markAckSent(fileKey, committedOffset)
}

func (c *connection) stopAckTimer() {
	c.ackMu.Lock()
	defer c.ackMu.Unlock()
	c.clearAckTimerLocked("")
}

func (c *connection) clearAckTimer(fileKey string) {
	c.ackMu.Lock()
	defer c.ackMu.Unlock()
	c.clearAckTimerLocked(fileKey)
}

func (c *connection) clearAckTimerLocked(fileKey string) {
	if fileKey != "" && c.pendingAckKey != "" && c.pendingAckKey != fileKey {
		return
	}
	if c.ackTimer != nil {
		c.ackTimer.Stop()
		c.ackTimer = nil
	}
	c.pendingAckKey = ""
	c.pendingAckPos = 0
}

// --- Helpers ---

func (c *connection) sendFrame(typ uint16, data []byte) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	return protocol.WriteFrame(c.conn, typ, data)
}

// sendJSON marshals v to JSON and writes it as an LMUP/2 frame.
func (c *connection) sendJSON(typ uint16, v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return fmt.Errorf("marshal response: %w", err)
	}
	return c.sendFrame(typ, data)
}

// sendError sends a TypeError frame with the given code and message.
func (c *connection) sendError(code, msg string) error {
	return c.sendJSON(protocol.TypeError, protocol.ErrorMsg{
		Code:    code,
		Message: msg,
	})
}
