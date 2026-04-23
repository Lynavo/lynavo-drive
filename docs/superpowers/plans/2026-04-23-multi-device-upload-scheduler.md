# Multi-Device Upload Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement PRD 10.3 so one desktop can accept multiple connected mobile devices while sidecar automatically schedules upload sessions by queue arrival time, with first-connect order as the deterministic fallback.

**Architecture:** The Go sidecar owns cross-device scheduling because it is the only process that sees all mobile TCP upload sessions. Mobile keeps its existing per-device local queue and single-file serial upload behavior. Desktop renderer remains read-only and continues displaying device state from sidecar without queue mutation controls.

**Tech Stack:** Go sidecar (`net`, `sync`, `context`, `time`, SQLite through existing `store.Store`), LMUP/2 protocol handlers, existing React/Electron dashboard state, existing Vitest and Go test suites.

---

## Requirement Mapping

- PRD 10.3 "按任务进入队列的先后顺序自动调度": sidecar captures `enqueuedAt` when it receives `SYNC_BEGIN_REQ`.
- PRD 10.3 "进入时间相同或无法区分先后": scheduler comparator treats equal `enqueuedAt` as indistinguishable.
- PRD 10.3 "按设备首次连接该电脑的先后顺序兜底排序": scheduler reads `paired_devices.created_at` for each `clientId`.
- PRD 10.3 "用户只能查看状态": no renderer controls for delete, reorder, skip, or manual file selection are added.
- PRD 10.3 "并发调度异常回退到固定兜底顺序": scheduler falls back to `sequence ASC`, then `clientId ASC`, and logs the fallback reason.

## File Structure

- Create: `services/sidecar-go/internal/server/upload_scheduler.go`
  - Owns the in-memory cross-device upload session scheduler.
  - Exposes `Acquire(ctx, SchedulerRequest)` and `SchedulerGrant.Release()`.
  - Implements deterministic ordering by `enqueuedAt`, `firstConnectedAt`, `sequence`, and `clientId`.
- Create: `services/sidecar-go/internal/server/upload_scheduler_test.go`
  - Unit tests scheduler ordering, release behavior, cancellation removal, and fixed fallback.
- Modify: `services/sidecar-go/internal/server/listener.go`
  - Adds `uploadScheduler *UploadScheduler` to `TCPServer`.
  - Initializes the scheduler in `NewTCPServer`.
- Modify: `services/sidecar-go/internal/server/connection.go`
  - Adds a scheduler grant field to each connection.
  - Releases active grants during disconnect cleanup.
  - Adds helper methods to pause and resume ping while waiting for the scheduler.
- Modify: `services/sidecar-go/internal/server/handler_sync.go`
  - Captures the upload session queue arrival time.
  - Waits for scheduler authorization before creating a transferring session and sending `SYNC_BEGIN_RES`.
  - Releases the grant on `SYNC_END_REQ`.
- Modify: `services/sidecar-go/internal/server/connection_test.go`
  - Adds test helpers for distinct client IDs and paired-device creation times.
- Create: `services/sidecar-go/internal/server/connection_scheduler_test.go`
  - Integration-style tests for two simultaneous mobile sessions.

## Design Decisions

- Scheduling is session-level, not file-level. Once a device is granted, it uploads its current round serially as it already does today. This avoids changing the LMUP file protocol and preserves the mobile pending queue source of truth.
- `SYNC_BEGIN_REQ` is the cross-device "task entered sidecar queue" event. Mobile-local queue insertion time is intentionally not added to the protocol in this iteration because PRD 10.3 describes PC-side multi-device access scheduling.
- While a connection waits for scheduler authorization, sidecar must stop its ping timer. Existing iOS `ProtocolSession.sendAndReceive()` expects the next frame to be the response to the sent request; an unsolicited `PING` during `SYNC_BEGIN_REQ` waiting would be interpreted as the wrong response.
- A queued device remains connected but not transferring. The dashboard can continue deriving `connected_idle` until the scheduler grants and `device.state.changed` emits `transferring`.
- The scheduler is in-memory. On sidecar restart all TCP sessions disconnect and mobile reconnects, which recreates the queue in a deterministic order from new `SYNC_BEGIN_REQ` arrival plus `created_at` fallback.

---

### Task 1: Add Scheduler Unit Tests

**Files:**
- Create: `services/sidecar-go/internal/server/upload_scheduler_test.go`

- [ ] **Step 1: Write failing tests for ordering and release**

Create `services/sidecar-go/internal/server/upload_scheduler_test.go`:

```go
package server

import (
	"context"
	"testing"
	"time"
)

func TestUploadSchedulerGrantsByEnqueueTime(t *testing.T) {
	s := NewUploadScheduler()
	base := time.Date(2026, 4, 23, 10, 0, 0, 0, time.UTC)

	first, err := s.Acquire(context.Background(), SchedulerRequest{
		ClientID:            "client-a",
		SessionID:           "session-a",
		EnqueuedAt:          base,
		FirstConnectedAt:    base.Add(10 * time.Minute),
		HasFirstConnectedAt: true,
	})
	if err != nil {
		t.Fatalf("first acquire: %v", err)
	}

	secondReady := make(chan *SchedulerGrant, 1)
	go func() {
		grant, err := s.Acquire(context.Background(), SchedulerRequest{
			ClientID:            "client-b",
			SessionID:           "session-b",
			EnqueuedAt:          base.Add(1 * time.Second),
			FirstConnectedAt:    base,
			HasFirstConnectedAt: true,
		})
		if err != nil {
			t.Errorf("second acquire: %v", err)
			return
		}
		secondReady <- grant
	}()

	assertNoGrant(t, secondReady)
	first.Release()
	second := assertGrant(t, secondReady)
	second.Release()
}

func TestUploadSchedulerUsesFirstConnectedAtWhenEnqueueTimeTies(t *testing.T) {
	s := NewUploadScheduler()
	enqueuedAt := time.Date(2026, 4, 23, 10, 0, 0, 0, time.UTC)
	firstConnected := enqueuedAt.Add(-2 * time.Hour)
	secondConnected := enqueuedAt.Add(-1 * time.Hour)

	active, err := s.Acquire(context.Background(), SchedulerRequest{
		ClientID:            "active",
		SessionID:           "session-active",
		EnqueuedAt:          enqueuedAt.Add(-1 * time.Second),
		FirstConnectedAt:    enqueuedAt,
		HasFirstConnectedAt: true,
	})
	if err != nil {
		t.Fatalf("active acquire: %v", err)
	}

	olderReady := make(chan *SchedulerGrant, 1)
	newerReady := make(chan *SchedulerGrant, 1)
	go acquireForTest(t, s, olderReady, SchedulerRequest{
		ClientID:            "older-device",
		SessionID:           "session-older",
		EnqueuedAt:          enqueuedAt,
		FirstConnectedAt:    firstConnected,
		HasFirstConnectedAt: true,
	})
	go acquireForTest(t, s, newerReady, SchedulerRequest{
		ClientID:            "newer-device",
		SessionID:           "session-newer",
		EnqueuedAt:          enqueuedAt,
		FirstConnectedAt:    secondConnected,
		HasFirstConnectedAt: true,
	})

	active.Release()
	older := assertGrant(t, olderReady)
	assertNoGrant(t, newerReady)
	older.Release()
	newer := assertGrant(t, newerReady)
	newer.Release()
}

func TestUploadSchedulerFallsBackToStableOrderWhenFirstConnectedAtMissing(t *testing.T) {
	s := NewUploadScheduler()
	enqueuedAt := time.Date(2026, 4, 23, 10, 0, 0, 0, time.UTC)

	active, err := s.Acquire(context.Background(), SchedulerRequest{
		ClientID:   "active",
		SessionID:  "session-active",
		EnqueuedAt: enqueuedAt.Add(-1 * time.Second),
	})
	if err != nil {
		t.Fatalf("active acquire: %v", err)
	}

	clientBReady := make(chan *SchedulerGrant, 1)
	clientAReady := make(chan *SchedulerGrant, 1)
	go acquireForTest(t, s, clientBReady, SchedulerRequest{
		ClientID:   "client-b",
		SessionID:  "session-b",
		EnqueuedAt: enqueuedAt,
	})
	go acquireForTest(t, s, clientAReady, SchedulerRequest{
		ClientID:   "client-a",
		SessionID:  "session-a",
		EnqueuedAt: enqueuedAt,
	})

	active.Release()
	first := assertGrantEither(t, clientAReady, clientBReady)
	if first.ClientID() != "client-a" {
		t.Fatalf("first fallback grant clientID=%q, want client-a", first.ClientID())
	}
	first.Release()
	second := assertGrant(t, clientBReady)
	second.Release()
}

func TestUploadSchedulerRemovesCanceledWaiter(t *testing.T) {
	s := NewUploadScheduler()
	enqueuedAt := time.Date(2026, 4, 23, 10, 0, 0, 0, time.UTC)

	active, err := s.Acquire(context.Background(), SchedulerRequest{
		ClientID:   "active",
		SessionID:  "session-active",
		EnqueuedAt: enqueuedAt,
	})
	if err != nil {
		t.Fatalf("active acquire: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	canceledErr := make(chan error, 1)
	go func() {
		_, err := s.Acquire(ctx, SchedulerRequest{
			ClientID:   "cancelled",
			SessionID:  "session-cancelled",
			EnqueuedAt: enqueuedAt.Add(time.Second),
		})
		canceledErr <- err
	}()

	cancel()
	if err := <-canceledErr; err == nil {
		t.Fatal("expected canceled waiter to return an error")
	}

	nextReady := make(chan *SchedulerGrant, 1)
	go acquireForTest(t, s, nextReady, SchedulerRequest{
		ClientID:   "next",
		SessionID:  "session-next",
		EnqueuedAt: enqueuedAt.Add(2 * time.Second),
	})

	active.Release()
	next := assertGrant(t, nextReady)
	next.Release()
}

func acquireForTest(t *testing.T, s *UploadScheduler, ready chan<- *SchedulerGrant, req SchedulerRequest) func() {
	t.Helper()
	return func() {
		grant, err := s.Acquire(context.Background(), req)
		if err != nil {
			t.Errorf("acquire %s: %v", req.ClientID, err)
			return
		}
		ready <- grant
	}
}

func assertNoGrant(t *testing.T, ready <-chan *SchedulerGrant) {
	t.Helper()
	select {
	case grant := <-ready:
		grant.Release()
		t.Fatal("received grant before active session released")
	case <-time.After(50 * time.Millisecond):
	}
}

func assertGrant(t *testing.T, ready <-chan *SchedulerGrant) *SchedulerGrant {
	t.Helper()
	select {
	case grant := <-ready:
		return grant
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for scheduler grant")
		return nil
	}
}

func assertGrantEither(t *testing.T, a, b <-chan *SchedulerGrant) *SchedulerGrant {
	t.Helper()
	select {
	case grant := <-a:
		return grant
	case grant := <-b:
		return grant
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for scheduler grant")
		return nil
	}
}
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
go test ./internal/server -run UploadScheduler -count=1
```

Expected:

```text
undefined: NewUploadScheduler
undefined: SchedulerRequest
undefined: SchedulerGrant
```

---

### Task 2: Implement UploadScheduler

**Files:**
- Create: `services/sidecar-go/internal/server/upload_scheduler.go`
- Test: `services/sidecar-go/internal/server/upload_scheduler_test.go`

- [ ] **Step 1: Add scheduler implementation**

Create `services/sidecar-go/internal/server/upload_scheduler.go`:

```go
package server

import (
	"context"
	"errors"
	"log/slog"
	"sort"
	"sync"
	"time"
)

type SchedulerRequest struct {
	ClientID            string
	SessionID           string
	EnqueuedAt          time.Time
	FirstConnectedAt    time.Time
	HasFirstConnectedAt bool
}

type UploadScheduler struct {
	mu       sync.Mutex
	active   *schedulerWaiter
	waiters  []*schedulerWaiter
	sequence int64
}

type SchedulerGrant struct {
	scheduler *UploadScheduler
	clientID  string
	sessionID string
	released  bool
	mu        sync.Mutex
}

type schedulerWaiter struct {
	SchedulerRequest
	sequence int64
	grantCh  chan *SchedulerGrant
}

func NewUploadScheduler() *UploadScheduler {
	return &UploadScheduler{}
}

func (s *UploadScheduler) Acquire(ctx context.Context, req SchedulerRequest) (*SchedulerGrant, error) {
	if req.ClientID == "" {
		return nil, errors.New("scheduler request missing clientID")
	}
	if req.SessionID == "" {
		return nil, errors.New("scheduler request missing sessionID")
	}
	if req.EnqueuedAt.IsZero() {
		req.EnqueuedAt = time.Now().UTC()
	}

	waiter := &schedulerWaiter{
		SchedulerRequest: req,
		grantCh:          make(chan *SchedulerGrant, 1),
	}

	s.mu.Lock()
	s.sequence++
	waiter.sequence = s.sequence
	if s.active == nil && len(s.waiters) == 0 {
		s.active = waiter
		grant := s.newGrantLocked(waiter)
		s.mu.Unlock()
		return grant, nil
	}
	s.waiters = append(s.waiters, waiter)
	s.sortWaitersLocked()
	s.mu.Unlock()

	select {
	case grant := <-waiter.grantCh:
		return grant, nil
	case <-ctx.Done():
		s.removeWaiter(waiter)
		return nil, ctx.Err()
	}
}

func (g *SchedulerGrant) ClientID() string {
	return g.clientID
}

func (g *SchedulerGrant) SessionID() string {
	return g.sessionID
}

func (g *SchedulerGrant) Release() {
	if g == nil || g.scheduler == nil {
		return
	}

	g.mu.Lock()
	if g.released {
		g.mu.Unlock()
		return
	}
	g.released = true
	g.mu.Unlock()

	g.scheduler.release(g)
}

func (s *UploadScheduler) release(grant *SchedulerGrant) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.active == nil {
		return
	}
	if s.active.ClientID != grant.clientID || s.active.SessionID != grant.sessionID {
		slog.Warn("upload scheduler release ignored for non-active grant",
			"clientID", grant.clientID,
			"sessionID", grant.sessionID,
			"activeClientID", s.active.ClientID,
			"activeSessionID", s.active.SessionID,
		)
		return
	}

	s.active = nil
	s.grantNextLocked()
}

func (s *UploadScheduler) removeWaiter(waiter *schedulerWaiter) {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i, existing := range s.waiters {
		if existing == waiter {
			s.waiters = append(s.waiters[:i], s.waiters[i+1:]...)
			return
		}
	}
}

func (s *UploadScheduler) grantNextLocked() {
	if len(s.waiters) == 0 {
		return
	}
	s.sortWaitersLocked()
	next := s.waiters[0]
	s.waiters = s.waiters[1:]
	s.active = next
	next.grantCh <- s.newGrantLocked(next)
}

func (s *UploadScheduler) newGrantLocked(waiter *schedulerWaiter) *SchedulerGrant {
	return &SchedulerGrant{
		scheduler: s,
		clientID:  waiter.ClientID,
		sessionID: waiter.SessionID,
	}
}

func (s *UploadScheduler) sortWaitersLocked() {
	sort.SliceStable(s.waiters, func(i, j int) bool {
		return schedulerWaiterLess(s.waiters[i], s.waiters[j])
	})
}

func schedulerWaiterLess(a, b *schedulerWaiter) bool {
	if !a.EnqueuedAt.Equal(b.EnqueuedAt) {
		return a.EnqueuedAt.Before(b.EnqueuedAt)
	}

	if a.HasFirstConnectedAt && b.HasFirstConnectedAt && !a.FirstConnectedAt.Equal(b.FirstConnectedAt) {
		return a.FirstConnectedAt.Before(b.FirstConnectedAt)
	}

	if a.ClientID != b.ClientID {
		return a.ClientID < b.ClientID
	}

	return a.sequence < b.sequence
}
```

- [ ] **Step 2: Run scheduler tests**

Run:

```bash
go test ./internal/server -run UploadScheduler -count=1
```

Expected:

```text
ok  	github.com/nicksyncflow/sidecar/internal/server
```

- [ ] **Step 3: Commit scheduler**

Run:

```bash
git add services/sidecar-go/internal/server/upload_scheduler.go services/sidecar-go/internal/server/upload_scheduler_test.go
git commit -m "feat(sidecar): add upload scheduler"
```

---

### Task 3: Wire Scheduler Into TCPServer

**Files:**
- Modify: `services/sidecar-go/internal/server/listener.go`
- Test: `services/sidecar-go/internal/server/upload_scheduler_test.go`

- [ ] **Step 1: Add scheduler field and constructor initialization**

In `services/sidecar-go/internal/server/listener.go`, update `TCPServer`:

```go
type TCPServer struct {
	listener net.Listener
	store    *store.Store
	config   *config.Config
	hub      *events.Hub
	presence PresenceStateProvider

	uploadScheduler *UploadScheduler

	mu               sync.RWMutex
	connectedClients map[string]string // clientID -> state ("authenticated"|"syncing")
}
```

Update `NewTCPServer`:

```go
func NewTCPServer(s *store.Store, cfg *config.Config, hub *events.Hub) *TCPServer {
	return &TCPServer{
		store:            s,
		config:           cfg,
		hub:              hub,
		uploadScheduler:  NewUploadScheduler(),
		connectedClients: make(map[string]string),
	}
}
```

- [ ] **Step 2: Run server package tests**

Run:

```bash
go test ./internal/server -count=1
```

Expected:

```text
ok  	github.com/nicksyncflow/sidecar/internal/server
```

- [ ] **Step 3: Commit TCPServer wiring**

Run:

```bash
git add services/sidecar-go/internal/server/listener.go
git commit -m "feat(sidecar): initialize upload scheduler"
```

---

### Task 4: Add Connection Grant Lifecycle

**Files:**
- Modify: `services/sidecar-go/internal/server/connection.go`
- Test: `services/sidecar-go/internal/server/connection_test.go`

- [ ] **Step 1: Add grant field to connection**

In `services/sidecar-go/internal/server/connection.go`, add this field to `connection`:

```go
	schedulerGrant *SchedulerGrant
```

- [ ] **Step 2: Release grant during connection cleanup**

In `connection.handle()` deferred cleanup, before `c.conn.Close()`, add:

```go
		if c.schedulerGrant != nil {
			c.schedulerGrant.Release()
			c.schedulerGrant = nil
		}
```

The cleanup block should still close `fileWriter`, stop ping timer, stop ACK timer, and remove the connected client as it does today.

- [ ] **Step 3: Add helper methods for scheduler wait ping safety**

In `services/sidecar-go/internal/server/connection.go`, below `stopPingTimer()`, add:

```go
func (c *connection) pausePingForSchedulerWait() func() {
	c.stopPingTimer()
	return func() {
		c.startPingTimer()
	}
}
```

This helper prevents sidecar from sending `PING` while a mobile client is waiting for `SYNC_BEGIN_RES`.

- [ ] **Step 4: Run connection tests**

Run:

```bash
go test ./internal/server -run 'Connection|FullPairing|Resume' -count=1
```

Expected:

```text
ok  	github.com/nicksyncflow/sidecar/internal/server
```

- [ ] **Step 5: Commit grant lifecycle**

Run:

```bash
git add services/sidecar-go/internal/server/connection.go
git commit -m "feat(sidecar): release upload scheduler grants on disconnect"
```

---

### Task 5: Gate SYNC_BEGIN Through Scheduler

**Files:**
- Modify: `services/sidecar-go/internal/server/handler_sync.go`
- Modify: `services/sidecar-go/internal/server/connection.go`
- Test: `services/sidecar-go/internal/server/connection_scheduler_test.go`

- [ ] **Step 1: Add first-connect helper**

In `services/sidecar-go/internal/server/connection.go`, add:

```go
func (c *connection) firstConnectedAtForScheduler() (time.Time, bool) {
	if c.store == nil || c.clientID == "" {
		return time.Time{}, false
	}
	dev, err := c.store.GetPairedDevice(c.clientID)
	if err != nil || dev == nil || dev.CreatedAt == "" {
		slog.Warn("upload scheduler falling back without first-connected timestamp",
			"clientID", c.clientID,
			"err", err,
		)
		return time.Time{}, false
	}
	parsed, err := time.Parse(time.RFC3339, dev.CreatedAt)
	if err != nil {
		slog.Warn("upload scheduler could not parse first-connected timestamp",
			"clientID", c.clientID,
			"createdAt", dev.CreatedAt,
			"err", err,
		)
		return time.Time{}, false
	}
	return parsed, true
}
```

- [ ] **Step 2: Acquire scheduler grant in handleSyncBegin**

In `services/sidecar-go/internal/server/handler_sync.go`, update imports to include `context`.

At the start of `handleSyncBegin`, after parsing `SyncBeginReq` and before creating the `store.Session`, add:

```go
	enqueuedAt := time.Now().UTC()
	firstConnectedAt, hasFirstConnectedAt := c.firstConnectedAtForScheduler()
	if c.server != nil && c.server.uploadScheduler != nil {
		resumePing := c.pausePingForSchedulerWait()
		grant, err := c.server.uploadScheduler.Acquire(context.Background(), SchedulerRequest{
			ClientID:            c.clientID,
			SessionID:           req.SessionID,
			EnqueuedAt:          enqueuedAt,
			FirstConnectedAt:    firstConnectedAt,
			HasFirstConnectedAt: hasFirstConnectedAt,
		})
		resumePing()
		if err != nil {
			return fmt.Errorf("acquire upload scheduler grant: %w", err)
		}
		c.schedulerGrant = grant
		slog.Info("upload scheduler granted session",
			"clientID", c.clientID,
			"sessionID", req.SessionID,
			"enqueuedAt", enqueuedAt.Format(time.RFC3339Nano),
			"hasFirstConnectedAt", hasFirstConnectedAt,
		)
	}
```

Keep the existing session creation, `device.state.changed` broadcast, `SYNC_BEGIN_RES`, and `SetClientState(..., "syncing")` after this block.

- [ ] **Step 3: Release scheduler grant on sync end**

In `handleSyncEnd`, after successfully updating the session state and before setting the TCP state back to connected, add:

```go
	if c.schedulerGrant != nil {
		c.schedulerGrant.Release()
		c.schedulerGrant = nil
	}
```

- [ ] **Step 4: Release grant if SYNC_BEGIN response fails**

In `handleSyncBegin`, replace the current `sendJSON(TypeSyncBeginRes, ...)` error return with:

```go
	if err := c.sendJSON(protocol.TypeSyncBeginRes, protocol.SyncBeginRes{OK: true}); err != nil {
		if c.schedulerGrant != nil {
			c.schedulerGrant.Release()
			c.schedulerGrant = nil
		}
		return err
	}
```

- [ ] **Step 5: Run sync handler tests**

Run:

```bash
go test ./internal/server -run 'FullPairingAndFileTransfer|ResumeAfterDisconnect|UploadScheduler' -count=1
```

Expected:

```text
ok  	github.com/nicksyncflow/sidecar/internal/server
```

- [ ] **Step 6: Commit sync gating**

Run:

```bash
git add services/sidecar-go/internal/server/connection.go services/sidecar-go/internal/server/handler_sync.go
git commit -m "feat(sidecar): gate sync begin by upload scheduler"
```

---

### Task 6: Add Multi-Device Connection Tests

**Files:**
- Modify: `services/sidecar-go/internal/server/connection_test.go`
- Create: `services/sidecar-go/internal/server/connection_scheduler_test.go`

- [ ] **Step 1: Add parameterized pairing helper**

In `services/sidecar-go/internal/server/connection_test.go`, add:

```go
func doPairingForClient(t *testing.T, client net.Conn, clientID, clientName string) string {
	t.Helper()

	sendJSON(t, client, protocol.TypeHelloReq, protocol.HelloReq{
		ClientID:       clientID,
		ClientName:     clientName,
		ClientPlatform: "ios",
		AppVersion:     "1.0.0",
		AppState:       "active",
	})

	var helloRes protocol.HelloRes
	recvJSON(t, client, protocol.TypeHelloRes, &helloRes)
	if !helloRes.AuthRequired {
		t.Fatal("expected authRequired=true for new device")
	}

	sendJSON(t, client, protocol.TypePairReq, protocol.PairReq{
		ClientID:       clientID,
		ClientName:     clientName,
		ConnectionCode: testConnCode,
	})

	var pairRes protocol.PairRes
	recvJSON(t, client, protocol.TypePairRes, &pairRes)
	if !pairRes.OK {
		t.Fatalf("pairing failed for %s: PairRes.OK=false", clientID)
	}
	if pairRes.PairingToken == "" {
		t.Fatalf("pairing token is empty for %s", clientID)
	}
	return pairRes.PairingToken
}
```

- [ ] **Step 2: Add shared TCPServer test setup**

In `services/sidecar-go/internal/server/connection_test.go`, add:

```go
func setupTestTCPServer(t *testing.T) (*TCPServer, *store.Store, *config.Config, func()) {
	t.Helper()
	tmpDir := t.TempDir()
	cfg := &config.Config{
		HTTPPort:              39394,
		TCPPort:               39393,
		DataDir:               tmpDir,
		ReceiveDir:            filepath.Join(tmpDir, "received"),
		DeviceName:            "test-mac",
		LowDiskThresholdBytes: 500 * 1024 * 1024,
	}
	if err := os.MkdirAll(cfg.ReceiveDir, 0o755); err != nil {
		t.Fatalf("create receive dir: %v", err)
	}
	if err := os.MkdirAll(cfg.StagingDir(), 0o755); err != nil {
		t.Fatalf("create staging dir: %v", err)
	}

	st, err := store.New(filepath.Join(tmpDir, "test.db"))
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}
	if err := st.SetConnectionCode(testConnCode); err != nil {
		t.Fatalf("SetConnectionCode: %v", err)
	}
	if err := st.SetDeviceName("test-mac"); err != nil {
		t.Fatalf("SetDeviceName: %v", err)
	}

	srv := NewTCPServer(st, cfg, events.NewHub())
	return srv, st, cfg, func() {
		st.Close()
	}
}

func openTestServerConnection(t *testing.T, srv *TCPServer) (net.Conn, func()) {
	t.Helper()
	client, server := net.Pipe()
	conn := newConnection(server, srv.store, srv.config, srv.hub, srv)
	go conn.handle()
	return client, func() { client.Close() }
}
```

- [ ] **Step 3: Write integration test for queued second device**

Create `services/sidecar-go/internal/server/connection_scheduler_test.go`:

```go
package server

import (
	"testing"
	"time"

	"github.com/nicksyncflow/sidecar/internal/protocol"
)

func TestMultiDeviceSchedulerQueuesSecondSyncBeginUntilFirstEnds(t *testing.T) {
	srv, _, _, cleanup := setupTestTCPServer(t)
	defer cleanup()

	firstClient, closeFirst := openTestServerConnection(t, srv)
	defer closeFirst()
	secondClient, closeSecond := openTestServerConnection(t, srv)
	defer closeSecond()

	doPairingForClient(t, firstClient, "client-first", "First iPhone")
	doPairingForClient(t, secondClient, "client-second", "Second iPhone")

	doSyncBegin(t, firstClient, "session-first", 1, 1)

	secondResult := make(chan protocol.SyncBeginRes, 1)
	go func() {
		sendJSON(t, secondClient, protocol.TypeSyncBeginReq, protocol.SyncBeginReq{
			SessionID:       "session-second",
			QueueTotalCount: 1,
			QueueTotalBytes: 1,
		})
		var res protocol.SyncBeginRes
		recvJSON(t, secondClient, protocol.TypeSyncBeginRes, &res)
		secondResult <- res
	}()

	select {
	case res := <-secondResult:
		t.Fatalf("second device was granted before first ended: %+v", res)
	case <-time.After(100 * time.Millisecond):
	}

	sendJSON(t, firstClient, protocol.TypeSyncEndReq, struct{}{})
	var syncEndRes protocol.SyncEndRes
	recvJSON(t, firstClient, protocol.TypeSyncEndRes, &syncEndRes)
	if !syncEndRes.OK {
		t.Fatal("first SyncEndRes.OK=false")
	}

	select {
	case res := <-secondResult:
		if !res.OK {
			t.Fatal("second SyncBeginRes.OK=false")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("second device did not receive scheduler grant after first ended")
	}
}
```

- [ ] **Step 4: Run multi-device scheduler tests**

Run:

```bash
go test ./internal/server -run MultiDeviceScheduler -count=1
```

Expected:

```text
ok  	github.com/nicksyncflow/sidecar/internal/server
```

- [ ] **Step 5: Commit integration tests**

Run:

```bash
git add services/sidecar-go/internal/server/connection_test.go services/sidecar-go/internal/server/connection_scheduler_test.go
git commit -m "test(sidecar): cover multi-device upload scheduling"
```

---

### Task 7: Preserve Read-Only UI Behavior

**Files:**
- Modify: `apps/desktop/src/renderer/stores/__tests__/dashboard-store.test.ts`
- Inspect only: `apps/desktop/src/renderer/stores/dashboard-store.ts`
- Inspect only: `apps/desktop/src/renderer/features/dashboard/DeviceCard.tsx`

- [ ] **Step 1: Add regression test that dashboard still exposes no queue mutation action**

Append to `apps/desktop/src/renderer/stores/__tests__/dashboard-store.test.ts`:

```ts
it('keeps dashboard device updates read-only without queue mutation actions', () => {
  const state = useDashboardStore.getState();
  expect('deleteQueueItem' in state).toBe(false);
  expect('reorderQueueItem' in state).toBe(false);
  expect('skipQueueItem' in state).toBe(false);
});
```

- [ ] **Step 2: Run dashboard store test**

Run:

```bash
pnpm --filter @syncflow/desktop test -- dashboard-store.test.ts
```

Expected:

```text
PASS src/renderer/stores/__tests__/dashboard-store.test.ts
```

- [ ] **Step 3: Commit read-only regression**

Run:

```bash
git add apps/desktop/src/renderer/stores/__tests__/dashboard-store.test.ts
git commit -m "test(desktop): preserve read-only dashboard scheduling state"
```

---

### Task 8: Full Verification

**Files:**
- No source edits.

- [ ] **Step 1: Run sidecar full test suite**

Run:

```bash
go test ./...
```

Expected:

```text
ok  	github.com/nicksyncflow/sidecar/...
```

- [ ] **Step 2: Run contracts and desktop build**

Run:

```bash
pnpm build
```

Expected:

```text
@syncflow/contracts build completes
@syncflow/design-tokens build completes
@syncflow/desktop build completes
```

- [ ] **Step 3: Run desktop typecheck**

Run:

```bash
pnpm typecheck
```

Expected:

```text
typecheck completes with no TypeScript errors
```

- [ ] **Step 4: Run mobile TypeScript check**

Run:

```bash
pnpm --filter @syncflow/mobile exec tsc --noEmit
```

Expected:

```text
tsc exits with code 0
```

- [ ] **Step 5: Run manual two-device smoke test**

Manual smoke:

```text
1. Start desktop dev app.
2. Connect iPhone A and iPhone B to the same desktop.
3. Start uploads from both phones.
4. Verify only one phone reaches transferring at a time in desktop dashboard.
5. Verify second phone remains connected and begins transferring after first phone sends SYNC_END.
6. Verify no desktop UI allows deleting, reordering, or skipping queue items.
7. Verify sidecar logs include scheduler grant lines for both session IDs.
```

- [ ] **Step 6: Commit verification note if docs are updated**

If a release checklist or beta test matrix is updated, run:

```bash
git add docs/testing/beta-test-matrix.md docs/release/release-playbook.md
git commit -m "docs: add multi-device scheduler verification"
```

If no docs are updated, skip this commit.

---

## Risks And Mitigations

- **Risk:** A queued mobile client receives sidecar `PING` while waiting for `SYNC_BEGIN_RES`.
  - **Mitigation:** `pausePingForSchedulerWait()` stops the ping timer before `Acquire()` and restarts it immediately after grant.
- **Risk:** A disconnected queued client is only discovered when sidecar tries to send `SYNC_BEGIN_RES`.
  - **Mitigation:** send failure releases the grant immediately, and connection cleanup releases any remaining grant.
- **Risk:** A scheduler bug blocks future uploads.
  - **Mitigation:** scheduler state is in-memory, deterministic, and covered by release/cancellation tests; sidecar restart clears stale state.
- **Risk:** Renderer ordering is mistaken for scheduling behavior.
  - **Mitigation:** scheduling is enforced only by sidecar. Renderer remains a read-only observer of device status.

## Self-Review

- Spec coverage: PRD 10.3 ordering, first-connect fallback, read-only UI, and logged non-user-facing fallback are covered by Tasks 1 through 7.
- Placeholder scan: This plan contains no deferred-detail markers, no unexpanded "write tests", and no undefined task references.
- Type consistency: Go symbols are consistent across tasks: `UploadScheduler`, `SchedulerRequest`, `SchedulerGrant`, `Acquire`, `Release`, `ClientID`, `SessionID`.
