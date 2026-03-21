# Phase 4: LMUP/2 TCP Protocol + File Receive — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the LMUP/2 binary TCP protocol in the Go sidecar so it can accept connections from iPhones, perform pairing handshake, and receive files with resume support.

**Architecture:** TCP listener on port 39393 using `net.Listener`. Each client connection is handled in a goroutine with a state machine (hello → auth → sync → idle). Binary frame parser reads 12-byte headers + JSON/binary bodies. File data is streamed to `.part` staging files, then atomically renamed to final paths on completion. Events broadcast to Desktop via WebSocket hub.

**Tech Stack:** Go 1.26, net (stdlib), crypto/hmac + crypto/sha256, io/fs, SQLite (existing store)

**Spec:** `docs/superpowers/specs/2026-03-21-syncflow-v2-spec.md` — Sections 7 (Protocol), 6.5-6.6 (File Storage)

**Depends on:** Phase 2 (Go Sidecar Core)

---

## Team Execution Strategy

```
T4.0 🔁 Frame parser (encode/decode)
T4.1 🔁 Connection handler state machine
T4.2 🔁 HELLO + PAIR handshake
T4.3 🔁 SYNC_BEGIN + FILE_INIT logic
T4.4 🔁 FILE_DATA streaming + .part files
T4.5 🔁 FILE_END + finalize + daily stats
T4.6 🔁 Heartbeat (PING/PONG) + resume
T4.7 🔁 Wire TCP server into main.go + events
T4.8 🔁 Integration test + review
```

Sequential — each task builds on the previous. The protocol layers must be correct bottom-up.

---

## File Structure

```
services/sidecar-go/internal/
  protocol/
    frame.go              NEW — FrameHeader encode/decode, magic/version constants
    frame_test.go         NEW
    messages.go           NEW — JSON message structs (HelloReq, PairReq, etc.)
    messages_test.go      NEW
  server/
    listener.go           NEW — TCP listener, accept loop
    connection.go         NEW — Per-connection state machine + message dispatch
    connection_test.go    NEW
    handler_hello.go      NEW — HELLO_REQ/RES + PAIR_REQ/RES
    handler_sync.go       NEW — SYNC_BEGIN, FILE_INIT
    handler_file.go       NEW — FILE_DATA, FILE_ACK, FILE_END
    handler_heartbeat.go  NEW — PING/PONG
    file_writer.go        NEW — .part file staging + finalize
    file_writer_test.go   NEW
  store/
    uploads.go            MODIFY — add UpdateSessionActiveFile
    sessions.go           MODIFY — add resume query
```

---

## Task 4.0 🔁 Frame Parser

**Files:**
- Create: `internal/protocol/frame.go`, `frame_test.go`
- Create: `internal/protocol/messages.go`, `messages_test.go`

- [ ] **Step 1: Create `protocol/frame.go`**

Frame header: 12 bytes big-endian (magic "LMUP", version uint16, type uint16, length uint32).

```go
package protocol

import (
	"encoding/binary"
	"fmt"
	"io"
)

const (
	MagicBytes = "LMUP"
	Version    = 2
	HeaderSize = 12
	MaxBodyLen = 16 * 1024 * 1024 // 16 MiB max frame body
)

// Message type constants matching @syncflow/contracts
const (
	TypeHelloReq     uint16 = 0x0001
	TypeHelloRes     uint16 = 0x0002
	TypePairReq      uint16 = 0x0003
	TypePairRes      uint16 = 0x0004
	TypeSyncBeginReq uint16 = 0x0005
	TypeSyncBeginRes uint16 = 0x0006
	TypeFileInitReq  uint16 = 0x0007
	TypeFileInitRes  uint16 = 0x0008
	TypeFileData     uint16 = 0x0009
	TypeFileAck      uint16 = 0x000A
	TypeFileEndReq   uint16 = 0x000B
	TypeFileEndRes   uint16 = 0x000C
	TypeSyncEndReq   uint16 = 0x000D
	TypeSyncEndRes   uint16 = 0x000E
	TypePing         uint16 = 0x000F
	TypePong         uint16 = 0x0010
	TypeError        uint16 = 0x0011
	TypeAuthReq      uint16 = 0x0012 // nonce-HMAC auth response from client
)

type FrameHeader struct {
	Type   uint16
	Length uint32
}

func ReadFrame(r io.Reader) (*FrameHeader, []byte, error) {
	var hdr [HeaderSize]byte
	if _, err := io.ReadFull(r, hdr[:]); err != nil {
		return nil, nil, err
	}
	if string(hdr[0:4]) != MagicBytes {
		return nil, nil, fmt.Errorf("invalid magic: %q", hdr[0:4])
	}
	ver := binary.BigEndian.Uint16(hdr[4:6])
	if ver != Version {
		return nil, nil, fmt.Errorf("unsupported version: %d", ver)
	}
	typ := binary.BigEndian.Uint16(hdr[6:8])
	length := binary.BigEndian.Uint32(hdr[8:12])
	if length > MaxBodyLen {
		return nil, nil, fmt.Errorf("frame too large: %d bytes", length)
	}
	body := make([]byte, length)
	if length > 0 {
		if _, err := io.ReadFull(r, body); err != nil {
			return nil, nil, err
		}
	}
	return &FrameHeader{Type: typ, Length: length}, body, nil
}

func WriteFrame(w io.Writer, typ uint16, body []byte) error {
	var hdr [HeaderSize]byte
	copy(hdr[0:4], MagicBytes)
	binary.BigEndian.PutUint16(hdr[4:6], Version)
	binary.BigEndian.PutUint16(hdr[6:8], typ)
	binary.BigEndian.PutUint32(hdr[8:12], uint32(len(body)))
	if _, err := w.Write(hdr[:]); err != nil {
		return err
	}
	if len(body) > 0 {
		if _, err := w.Write(body); err != nil {
			return err
		}
	}
	return nil
}
```

- [ ] **Step 2: Create `protocol/messages.go`**

All JSON message structs matching spec Section 7.8. Use `encoding/json` tags.

```go
package protocol

type HelloReq struct {
	ClientID          string `json:"clientId"`
	ClientName        string `json:"clientName"`
	ClientPlatform    string `json:"clientPlatform"`
	AppVersion        string `json:"appVersion"`
	PairingToken      string `json:"pairingToken,omitempty"`
	PreviousSessionID string `json:"previousSessionId,omitempty"`
	AppState          string `json:"appState"`
	DeviceAlias       string `json:"deviceAlias,omitempty"`
}

type HelloRes struct {
	ServerID           string              `json:"serverId"`
	ServerName         string              `json:"serverName"`
	ServerType         string              `json:"serverType"`
	ProtoVersion       int                 `json:"protoVersion"`
	AuthRequired       bool                `json:"authRequired"`
	Bound              bool                `json:"bound"`
	Resume             *ResumeInfo         `json:"resume"`
	ServerCapabilities ServerCapabilities  `json:"serverCapabilities"`
	Nonce              string              `json:"nonce"`
}

type ResumeInfo struct {
	Accepted      bool   `json:"accepted"`
	SessionID     string `json:"sessionId"`
	ActiveFileKey string `json:"activeFileKey,omitempty"`
	ResumeOffset  int64  `json:"resumeOffset"`
}

type ServerCapabilities struct {
	ShareEnabled       bool   `json:"shareEnabled"`
	ShareName          string `json:"shareName"`
	LowDiskPauseEnabled bool  `json:"lowDiskPauseEnabled"`
}

type PairReq struct {
	ClientID       string `json:"clientId"`
	ClientName     string `json:"clientName"`
	ConnectionCode string `json:"connectionCode"`
	DeviceAlias    string `json:"deviceAlias,omitempty"`
}

type PairRes struct {
	OK         bool       `json:"ok"`
	PairingID  string     `json:"pairingId"`
	PairingToken string   `json:"pairingToken"`
	ServerInfo ServerInfo `json:"serverInfo"`
}

type ServerInfo struct {
	ServerID   string `json:"serverId"`
	ServerName string `json:"serverName"`
	ShareName  string `json:"shareName"`
}

type SyncBeginReq struct {
	SessionID       string `json:"sessionId"`
	QueueTotalCount int    `json:"queueTotalCount"`
	QueueTotalBytes int64  `json:"queueTotalBytes"`
}

type SyncBeginRes struct {
	OK bool `json:"ok"`
}

type SyncEndRes struct {
	OK bool `json:"ok"`
}

// AUTH_REQ — sent by client after HELLO_RES with nonce (for returning devices)
type AuthReq struct {
	ClientID string `json:"clientId"`
	Auth     string `json:"auth"` // HMAC-SHA256(pairingToken, nonce)
}

type FileInitReq struct {
	SessionID       string `json:"sessionId"`
	FileKey         string `json:"fileKey"`
	OriginalFilename string `json:"originalFilename"`
	MediaType       string `json:"mediaType"`
	MimeType        string `json:"mimeType"`
	FileSize        int64  `json:"fileSize"`
	CreatedAt       string `json:"createdAt"`
	ModifiedAt      string `json:"modifiedAt"`
	QueueIndex      int    `json:"queueIndex"`
	QueueTotalCount int    `json:"queueTotalCount"`
}

type FileInitRes struct {
	Action       string `json:"action"` // UPLOAD, RESUME, SKIP, REJECT
	ResumeOffset int64  `json:"resumeOffset,omitempty"`
	Reason       string `json:"reason,omitempty"`
}

type FileAck struct {
	FileKey         string `json:"fileKey"`
	CommittedOffset int64  `json:"committedOffset"`
}

type FileEndReq struct {
	FileKey  string `json:"fileKey"`
	FileSize int64  `json:"fileSize"`
	SHA256   string `json:"sha256"`
}

type FileEndRes struct {
	OK                   bool   `json:"ok"`
	FileKey              string `json:"fileKey"`
	RelativePath         string `json:"relativePath"`
	StoredBytes          int64  `json:"storedBytes"`
	ActiveTransmissionMs int64  `json:"activeTransmissionMs"`
}

type ErrorMsg struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}
```

- [ ] **Step 3: Write tests**

`frame_test.go`: test ReadFrame/WriteFrame roundtrip with known bytes. Test invalid magic rejection. Test version mismatch.

`messages_test.go`: test JSON marshal/unmarshal for HelloReq, FileInitReq, FileAck.

- [ ] **Step 4: Run tests**

```bash
go test ./internal/protocol/ -v
```

- [ ] **Step 5: Commit**

```
feat(sidecar): LMUP/2 frame parser + message types
```

---

## Task 4.1 🔁 Connection Handler State Machine

**Files:**
- Create: `internal/server/listener.go`, `internal/server/connection.go`

- [ ] **Step 1: Create `server/listener.go`**

TCP listener that accepts connections and spawns goroutines:

```go
package server

import (
	"log/slog"
	"net"
	"github.com/nicksyncflow/sidecar/internal/config"
	"github.com/nicksyncflow/sidecar/internal/events"
	"github.com/nicksyncflow/sidecar/internal/store"
)

type TCPServer struct {
	listener net.Listener
	store    *store.Store
	config   *config.Config
	hub      *events.Hub
}

func NewTCPServer(s *store.Store, cfg *config.Config, hub *events.Hub) *TCPServer {
	return &TCPServer{store: s, config: cfg, hub: hub}
}

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
		slog.Info("tcp client connected", "remote", conn.RemoteAddr())
		go newConnection(conn, s.store, s.config, s.hub).handle()
	}
}
```

- [ ] **Step 2: Create `server/connection.go`**

Per-connection state machine:

```go
type connState int
const (
	stateWaitHello connState = iota
	stateWaitAuth  // waiting for AUTH_REQ (nonce-HMAC) from returning device
	stateWaitPair  // waiting for PAIR_REQ from new device
	stateAuthenticated
	stateSyncing
)

type connection struct {
	conn       net.Conn
	store      *store.Store
	config     *config.Config
	hub        *events.Hub
	state      connState
	clientID   string
	sessionID  string
	nonce      string             // generated on HELLO_RES for HMAC auth
	fileWriter *FileWriter        // current .part file being written
	pingTimer  *time.Timer        // 15s inactivity → send PING
	// ... session tracking fields
}

func (c *connection) handle() {
	defer func() {
		// Cleanup .part file if transfer was interrupted
		if c.fileWriter != nil {
			c.fileWriter.Close()
			// Leave .part for resume; only remove on SHA256 mismatch (in handleFileEnd)
		}
		c.stopPingTimer()
		c.conn.Close()
	}()

	c.resetDeadline() // 45s read deadline
	c.startPingTimer() // 15s inactivity → send PING

	for {
		hdr, body, err := protocol.ReadFrame(c.conn)
		if err != nil { return }
		c.resetDeadline()
		c.resetPingTimer()
		if err := c.dispatch(hdr, body); err != nil {
			c.sendError(err.Error())
			return
		}
	}
}

func (c *connection) resetDeadline() {
	c.conn.SetReadDeadline(time.Now().Add(45 * time.Second))
}

func (c *connection) startPingTimer() {
	c.pingTimer = time.AfterFunc(15*time.Second, func() {
		protocol.WriteFrame(c.conn, protocol.TypePing, nil)
		c.startPingTimer() // restart for next interval
	})
}

func (c *connection) resetPingTimer() {
	if c.pingTimer != nil { c.pingTimer.Reset(15 * time.Second) }
}

func (c *connection) stopPingTimer() {
	if c.pingTimer != nil { c.pingTimer.Stop() }
}

func (c *connection) dispatch(hdr *protocol.FrameHeader, body []byte) error {
	switch hdr.Type {
	case protocol.TypeHelloReq:    return c.handleHello(body)
	case protocol.TypeAuthReq:     return c.handleAuth(body) // nonce-HMAC verification
	case protocol.TypePairReq:     return c.handlePair(body)
	case protocol.TypeSyncBeginReq: return c.handleSyncBegin(body)
	case protocol.TypeFileInitReq: return c.handleFileInit(body)
	case protocol.TypeFileData:    return c.handleFileData(hdr, body)
	case protocol.TypeFileEndReq:  return c.handleFileEnd(body)
	case protocol.TypeSyncEndReq:  return c.handleSyncEnd(body)
	case protocol.TypePing:        return c.handlePing()
	case protocol.TypePong:        return nil // reset deadline already done
	default: return fmt.Errorf("unknown message type: 0x%04x", hdr.Type)
	}
}
```

- [ ] **Step 3: Commit**

```
feat(sidecar): TCP server + connection state machine
```

---

## Task 4.2 🔁 HELLO + PAIR Handshake

**Files:**
- Create: `internal/server/handler_hello.go`

- [ ] **Step 1: Implement handleHello**

- Parse HelloReq JSON
- Check if clientID is already paired (`store.GetPairedDevice`)
- If paired:
  - Generate random nonce (32 bytes hex)
  - Store nonce in connection state
  - Check for resume (if `previousSessionId` provided, query active session)
  - Send HelloRes with `authRequired: false`, `bound: true`, nonce, resume info
  - Transition state → `stateWaitAuth` (wait for AUTH_REQ)
- If not paired:
  - Send HelloRes with `authRequired: true`, `bound: false`
  - Transition state → `stateWaitPair` (wait for PAIR_REQ)
- Update `device_alias` if provided in HelloReq

- [ ] **Step 2: Implement handleAuth (nonce-HMAC verification)**

- Only valid in `stateWaitAuth`
- Parse AuthReq JSON (`clientId`, `auth`)
- Retrieve stored `pairing_token_hash` from `paired_devices`
- Compute expected: `HMAC-SHA256(storedTokenHash, nonce)`
- Compare with received `auth` using `hmac.Equal` (constant-time)
- If match: transition → `stateAuthenticated`
- If mismatch: send ERROR with `PAIR_TOKEN_INVALID`, close connection
- Uses `crypto/hmac` + `crypto/sha256`

- [ ] **Step 3: Implement handlePair**

- Only valid in `stateWaitPair`
- Parse PairReq JSON
- Verify connectionCode against `store.GetConnectionCode()`
- If invalid: send PairRes{ok:false}, return error
- Generate pairingId (UUID) + pairingToken (random 32 bytes hex)
- Hash token with SHA256, store in `paired_devices`
- Send PairRes with token + server info
- Transition state → `stateAuthenticated`

- [ ] **Step 4: Write test**

`connection_test.go`:
1. First-time pairing: HELLO_REQ → HELLO_RES (authRequired) → PAIR_REQ → PairRes{ok:true}
2. Returning device: HELLO_REQ (with pairingToken) → HELLO_RES (nonce) → AUTH_REQ (HMAC) → authenticated
3. Wrong HMAC → ERROR response

- [ ] **Step 5: Commit**

```
feat(sidecar): HELLO + PAIR + HMAC auth handshake
```

---

## Task 4.3 🔁 SYNC_BEGIN + FILE_INIT

**Files:**
- Create: `internal/server/handler_sync.go`

- [ ] **Step 1: Implement handleSyncBegin**

- Parse SyncBeginReq
- Create session in store (UpsertSession)
- Emit `device.state.changed` event (status: transferring)
- Send SyncBeginRes{ok:true}

- [ ] **Step 2: Implement handleFileInit**

- Parse FileInitReq
- Check disk space (disk.IsLow) → action=REJECT if low
- Check if fileKey already completed → action=SKIP
- Check if fileKey has partial upload → action=RESUME with offset
- Otherwise → action=UPLOAD
- Create/update upload record in store
- Send FileInitRes

- [ ] **Step 3: Commit**

```
feat(sidecar): SYNC_BEGIN + FILE_INIT with resume/skip/reject logic
```

---

## Task 4.4 🔁 FILE_DATA Streaming + .part Files

**Files:**
- Create: `internal/server/file_writer.go`, `file_writer_test.go`
- Create: `internal/server/handler_file.go`

- [ ] **Step 1: Create `file_writer.go`**

Manages .part file I/O:

```go
type FileWriter struct {
	file       *os.File
	partPath   string
	offset     int64
	startTime  time.Time
}

func NewFileWriter(stagingDir, clientID, fileKey string) (*FileWriter, error)
func (fw *FileWriter) WriteAt(data []byte, offset int64) (int64, error)
func (fw *FileWriter) Sync() error
func (fw *FileWriter) CommittedOffset() int64
func (fw *FileWriter) Close() error
func (fw *FileWriter) Finalize(receivePath, deviceAlias, date, filename, fileKey string) (string, error)
```

`Finalize`: rename .part → final path. Handle filename conflicts (append `_<hash>` suffix). Create date directory. Return relative path.

- [ ] **Step 2: Implement handleFileData**

Parse binary body with bounds checking:
```go
func (c *connection) handleFileData(hdr *protocol.FrameHeader, body []byte) error {
    if len(body) < 2 {
        return fmt.Errorf("FILE_DATA too short for fileKeyLen")
    }
    fileKeyLen := int(binary.BigEndian.Uint16(body[0:2]))
    if len(body) < 2 + fileKeyLen + 8 {
        return fmt.Errorf("FILE_DATA too short for fileKey + offset")
    }
    fileKey := string(body[2 : 2+fileKeyLen])
    offset := int64(binary.BigEndian.Uint64(body[2+fileKeyLen : 2+fileKeyLen+8]))
    data := body[2+fileKeyLen+8:]

    // Write to .part file
    committedOffset, err := c.fileWriter.WriteAt(data, offset)
    if err != nil { return err }
    c.fileWriter.Sync()

    // ACK
    protocol.WriteFrame(c.conn, protocol.TypeFileAck, marshal(FileAck{FileKey: fileKey, CommittedOffset: committedOffset}))

    // Update store: both upload progress AND session active file
    c.store.UpdateUploadProgress(fileKey, committedOffset)
    c.store.UpdateSessionActiveFile(c.sessionID, fileKey, committedOffset)

    // Emit progress event
    progress := int(float64(committedOffset) / float64(c.fileWriter.expectedSize) * 100)
    c.hub.Broadcast(events.Event{Type: "upload.progress", Payload: map[string]any{
        "deviceId": c.clientID, "fileKey": fileKey, "progress": progress,
    }})
    return nil
}
```

- [ ] **Step 3: Write file_writer_test.go**

Test: create .part, write chunks, verify offsets, finalize to final path, verify file content matches. Test filename conflict resolution.

- [ ] **Step 4: Commit**

```
feat(sidecar): FILE_DATA streaming with .part staging files
```

---

## Task 4.5 🔁 FILE_END + Finalize + Daily Stats

**Files:**
- Modify: `internal/server/handler_file.go`

- [ ] **Step 1: Implement handleFileEnd**

- Parse FileEndReq (fileKey, fileSize, sha256)
- Verify file size matches .part file size
- Compute SHA256 hash of .part file and compare with client-provided hash
- **If SHA256 mismatch**: delete .part file (`os.Remove`), update upload status to `failed`, emit `upload.failed` event, send FileEndRes{ok:false}
- If match: call FileWriter.Finalize (rename .part → final path)
- `NewFileWriter` must call `os.MkdirAll(filepath.Join(stagingDir, clientID), 0o750)` before opening .part
- Calculate activeTransmissionMs = time since first FILE_DATA for this file
- Update store: CompleteUpload(fileKey, finalPath, sha256, transmissionMs)
- Update daily stats: UpsertDailyStats
- Emit `upload.completed`, `dashboard.updated`, `history.updated` events
- Send FileEndRes{ok:true, relativePath, storedBytes, activeTransmissionMs}

- [ ] **Step 2: Implement handleSyncEnd**

- Update session state to "completed"
- Emit `device.state.changed` (status: connected_idle)
- Send SyncEndRes{ok:true}

- [ ] **Step 3: Commit**

```
feat(sidecar): FILE_END with SHA256 verify, finalize, daily stats
```

---

## Task 4.6 🔁 Heartbeat + Resume

**Files:**
- Create: `internal/server/handler_heartbeat.go`
- Modify: `internal/server/connection.go`

- [ ] **Step 1: Implement PING/PONG**

```go
func (c *connection) handlePing() error {
	return protocol.WriteFrame(c.conn, protocol.TypePong, nil)
}
```

Add read deadline to connection: reset to 45s after each message.

- [ ] **Step 2: Add resume logic to handleHello**

When HelloReq contains `previousSessionId`:
- Look up session in store
- If found with active_file_key: return resume info with committed offset
- Client can then continue from that offset

- [ ] **Step 3: Modify store for resume**

Add to `sessions.go`:
```go
func (s *Store) UpdateSessionActiveFile(sessionID, fileKey string, offset int64) error
```

- [ ] **Step 4: Commit**

```
feat(sidecar): heartbeat PING/PONG + session resume support
```

---

## Task 4.7 🔁 Wire TCP Server into main.go + Events

**Files:**
- Modify: `cmd/syncflow-sidecar/main.go`

- [ ] **Step 1: Wire TCPServer**

```go
// After HTTP server setup:
tcpSrv := server.NewTCPServer(st, cfg, hub)
if err := tcpSrv.Start(fmt.Sprintf(":%d", cfg.TCPPort)); err != nil {
	slog.Error("tcp server failed", "err", err)
	os.Exit(1)
}
defer tcpSrv.Stop()
```

- [ ] **Step 2: Verify sidecar starts both servers**

```bash
go run ./cmd/syncflow-sidecar/
```

Expected logs:
```
http server listening addr=:39394
tcp server listening addr=:39393
```

- [ ] **Step 3: Commit**

```
feat(sidecar): wire TCP server on port 39393 into main
```

---

## Task 4.8 🔁 Integration Test + Review

- [ ] **Step 1: Write integration test**

`internal/server/connection_test.go`: Three integration tests using in-memory TCP (`net.Pipe`):

**Test 1: Full first-time pairing + file transfer (happy path)**
1. HELLO_REQ → HELLO_RES (authRequired=true)
2. PAIR_REQ (correct code) → PairRes (ok, pairingToken)
3. SYNC_BEGIN_REQ → SyncBeginRes
4. FILE_INIT_REQ → FileInitRes (action=UPLOAD)
5. FILE_DATA (1KB test payload) → FILE_ACK
6. FILE_END_REQ (correct SHA256) → FileEndRes (ok=true)
7. Verify .part renamed to final path, file content matches
8. SYNC_END_REQ → SyncEndRes

**Test 2: Returning device with HMAC auth + resume**
1. First: complete Test 1 to pair and partially upload a file (send FILE_DATA but NOT FILE_END)
2. Disconnect, reconnect with new TCP pipe
3. HELLO_REQ (with pairingToken + previousSessionId) → HELLO_RES (nonce, resume info)
4. AUTH_REQ (HMAC-SHA256(pairingToken, nonce)) → authenticated
5. FILE_INIT_REQ (same fileKey) → FileInitRes (action=RESUME, resumeOffset=previous offset)
6. Continue FILE_DATA from resumeOffset → FILE_ACK → FILE_END → verify

**Test 3: Error paths**
1. Wrong connection code → PairRes{ok:false}
2. Wrong HMAC → ERROR response
3. FILE_END with wrong SHA256 → FileEndRes{ok:false}, .part deleted
4. FILE_INIT when disk is "low" → FileInitRes{action:REJECT}

- [ ] **Step 2: Run all Go tests**

```bash
CGO_ENABLED=1 go test ./... -v
```

All packages pass.

- [ ] **Step 3: Manual smoke test**

```bash
go run ./cmd/syncflow-sidecar/ &
# Verify both ports listening
lsof -i :39393 -i :39394
kill %1
```

- [ ] **Step 4: Dispatch code reviewer**

Review scope: `internal/protocol/` + `internal/server/`. Criteria:
- Frame parser handles edge cases (partial reads, oversized frames)
- No buffer overflows in FILE_DATA parsing
- .part files cleaned up on error
- SHA256 verification is correct
- Atomic file rename (no partial final files)
- Connection properly closed on protocol errors
- Concurrent connections don't interfere
- Store operations have proper error handling

- [ ] **Step 5: Fix review findings**

- [ ] **Step 6: Commit**

```
chore: Phase 4 complete — LMUP/2 TCP protocol with file receive
```

---

## Verification Summary

### Phase 4 Gate

```bash
# All Go tests pass (including protocol + server)
CGO_ENABLED=1 go test ./... -v

# Sidecar builds
go build ./cmd/syncflow-sidecar/

# Both ports listen
./syncflow-sidecar &
curl -sf http://127.0.0.1:39394/health  # HTTP OK
lsof -i :39393                            # TCP listening
kill %1

# Integration test passes end-to-end protocol flow
go test ./internal/server/ -run TestFullProtocolFlow -v
```
