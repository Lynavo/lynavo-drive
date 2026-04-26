# Multi-Device Concurrent Upload Ordering Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align multi-device behavior with the current codebase and AGENTS constraints: multiple connected phones may upload to the same desktop concurrently. Implement deterministic multi-device ordering for dashboard presentation and status updates without introducing a global sidecar upload queue or changing LMUP request/response flow.

**Architecture:** Keep the Go sidecar TCP/LMUP upload path unchanged. `handleSyncBegin()` continues to start each device session immediately, and each phone remains single-file serial on its own. The ordering rule is applied where the desktop actually surfaces multi-device state: `GetDashboardDevices()` returns devices in a deterministic order, and the renderer preserves that order within each status bucket (`transferring > connected_idle > offline`).

**Tech Stack:** Go sidecar store/API, React 18 + Zustand desktop renderer, existing Go test suite, Vitest, `docs/testing/beta-test-matrix.md`.

---

## Decision Update

- The previous revision assumed PRD 10.3 required a global upload scheduler. That does **not** match the current repository shape.
- `AGENTS.md` only constrains uploads **per phone**: one phone uploads one file at a time. It does **not** require one-phone-at-a-time across the whole desktop.
- Current sidecar code already accepts multiple `SYNC_BEGIN_REQ` sessions without a global gate:
  - `services/sidecar-go/internal/server/handler_sync.go`
  - `services/sidecar-go/internal/server/listener.go`
- The historical PRD wording about "entering the queue" is therefore interpreted here as a **deterministic ordering rule for multi-device state**, not as a transport-layer mutex.
- This plan intentionally removes the prior `UploadScheduler`, connection parking, ping suppression, grant/release lifecycle, and wait-timeout design.

## Requirement Mapping

- PRD 2.6 / 10.3 "multiple phones connect to one desktop": multiple devices may be `transferring` at the same time.
- PRD "按任务进入队列的先后顺序自动调度": because the current system has no explicit cross-device queue record, map this to the earliest active transfer session `started_at`.
- PRD "按设备首次连接该电脑的先后顺序进行兜底排序": fallback to `paired_devices.created_at ASC`.
- PRD "用户只能查看状态": no renderer controls for delete, reorder, skip, or manual selection are added.
- PRD "并发调度异常...回退到固定兜底顺序": final stable fallback is `client_id ASC`; abnormal data only logs internally.

## Out of Scope

- No global one-device-at-a-time scheduler in sidecar.
- No LMUP protocol changes (`SYNC_BEGIN_REQ`, `SYNC_BEGIN_RES`, `FILE_INIT`, `FILE_DATA` stay as-is).
- No mobile local queue schema changes and no new `queuedAt` field.
- No queue-management UI in desktop.
- No changes to per-device single-file serial upload behavior.

## Ordering Contract

1. Multiple devices may appear as `transferring` simultaneously.
2. Dashboard still groups by status priority:
   - `transferring`
   - `connected_idle`
   - `offline`
3. Within the `transferring` group, order by:
   - latest active session `started_at ASC`
   - `paired_devices.created_at ASC`
   - `client_id ASC`
4. Within non-transferring groups, keep the current recency bias:
   - `last_seen_at DESC`
   - `created_at ASC`
   - `client_id ASC`
5. Desktop must preserve the incoming order for devices with the same status instead of relying on undocumented incidental behavior.

## File Map

| File | Change |
|---|---|
| `services/sidecar-go/internal/store/uploads.go` | Reorder `GetDashboardDevices()` SQL for deterministic multi-device ordering |
| `services/sidecar-go/internal/store/uploads_test.go` | Add store tests for concurrent-transfer ordering and fallbacks |
| `services/sidecar-go/internal/api/router_test.go` | Add HTTP regression test that `/dashboard/devices` preserves the intended order |
| `apps/desktop/src/renderer/stores/dashboard-store.ts` | Make same-status ordering explicit and preserve incoming order |
| `apps/desktop/src/renderer/stores/__tests__/dashboard-store.test.ts` | Add renderer tests for same-status stability and concurrent transfer promotion |
| `docs/testing/beta-test-matrix.md` | Add multi-device concurrent-upload smoke coverage |

---

## Task 1: Sidecar store — make dashboard ordering deterministic

**Files:**
- Modify: `services/sidecar-go/internal/store/uploads.go`
- Modify: `services/sidecar-go/internal/store/uploads_test.go`

- [ ] **Step 1: Add failing store tests for concurrent transfer ordering**

Add targeted tests to `services/sidecar-go/internal/store/uploads_test.go`:

- `TestGetDashboardDevices_OrdersTransferringDevicesBySessionStart`
  - create two paired devices
  - give both active `transferring` sessions with different `started_at`
  - assert earlier `started_at` comes first
- `TestGetDashboardDevices_UsesCreatedAtFallbackWhenSessionStartTies`
  - same `started_at`
  - different `paired_devices.created_at`
  - assert older paired device comes first
- `TestGetDashboardDevices_UsesClientIDAsFinalFallback`
  - same `started_at`
  - same `created_at`
  - assert lexical `client_id ASC`
- `TestGetDashboardDevices_KeepsNonTransferringDevicesOnLastSeenOrder`
  - no active sessions
  - different `last_seen_at`
  - assert newest `last_seen_at` remains first

Use the existing helpers already present in the store package:

- `sampleUpload(...)`
- `sampleSession(...)`
- `UpsertPairedDevice(...)`
- `UpsertDailyStats(...)`

- [ ] **Step 2: Rework `GetDashboardDevices()` ordering**

In `services/sidecar-go/internal/store/uploads.go`:

- extend the `latest_sess` subquery so it can drive ordering by active transfer start time
- keep the current join that pulls `u.original_filename` for the current file
- update the `ORDER BY` so it matches the contract above

Implementation target:

```sql
ORDER BY
  CASE WHEN latest_sess.state = 'transferring' THEN 0 ELSE 1 END ASC,
  CASE
    WHEN latest_sess.state = 'transferring' THEN latest_sess.started_at
  END ASC,
  CASE
    WHEN latest_sess.state = 'transferring' THEN pd.created_at
  END ASC,
  CASE
    WHEN latest_sess.state = 'transferring' THEN pd.client_id
  END ASC,
  CASE
    WHEN latest_sess.state = 'transferring' THEN NULL
    ELSE pd.last_seen_at
  END DESC,
  pd.created_at ASC,
  pd.client_id ASC
```

Use the repo's existing SQLite-compatible style; the exact SQL can differ if needed, but the resulting behavior must match the ordering contract.

- [ ] **Step 3: Run sidecar store tests**

```bash
cd /Volumes/T7/Dev/Web/SyncFlow/services/sidecar-go
go test ./internal/store
```

Expected: PASS, including the new dashboard-ordering tests.

- [ ] **Step 4: Commit**

```bash
git add services/sidecar-go/internal/store/uploads.go \
        services/sidecar-go/internal/store/uploads_test.go
git commit -m "feat(sidecar): order dashboard devices for concurrent transfers"
```

---

## Task 2: Sidecar HTTP API — lock the order at the `/dashboard/devices` boundary

**Files:**
- Modify: `services/sidecar-go/internal/api/router_test.go`

- [ ] **Step 1: Add failing HTTP regression test**

Add `TestDashboardDevices_PreservesConcurrentTransferOrder` to `services/sidecar-go/internal/api/router_test.go`:

- seed two paired devices with valid `receive_dir_name`
- seed two active transferring sessions with different `started_at`
- call `GET /dashboard/devices`
- decode the JSON array
- assert both devices are returned with `status == "transferring"`
- assert array order matches the store rule (`started_at`, then `created_at`, then `client_id`)

This test should exercise the real API path, including:

- `GetDashboardDevices(today)`
- live status derivation in `handleDashboardDevices`
- JSON array order returned to desktop

- [ ] **Step 2: Run sidecar API tests**

```bash
cd /Volumes/T7/Dev/Web/SyncFlow/services/sidecar-go
go test ./internal/api
```

Expected: PASS, including the new `/dashboard/devices` ordering regression.

- [ ] **Step 3: Commit**

```bash
git add services/sidecar-go/internal/api/router_test.go
git commit -m "test(sidecar): cover concurrent dashboard device ordering"
```

---

## Task 3: Desktop store — preserve same-status input order explicitly

**Files:**
- Modify: `apps/desktop/src/renderer/stores/dashboard-store.ts`
- Modify: `apps/desktop/src/renderer/stores/__tests__/dashboard-store.test.ts`

- [ ] **Step 1: Add failing renderer tests**

Add focused tests to `apps/desktop/src/renderer/stores/__tests__/dashboard-store.test.ts`:

- `updateDevices preserves incoming order among transferring devices`
  - pass in two `transferring` devices already sorted by sidecar
  - assert output order is identical
- `updateDeviceStatus preserves transfer-start order when a second device becomes transferring`
  - start with one `transferring` device and one `connected_idle` device
  - promote the second device to `transferring`
  - assert the existing active device stays first and the newly promoted device is appended inside the transferring bucket
- `fetchDashboard keeps same-status order from sidecar snapshot`
  - mock `getDashboardDevices()` with two same-status devices in a specific order
  - assert store state preserves that order after fetch

- [ ] **Step 2: Make `sortDevices()` stable by construction**

In `apps/desktop/src/renderer/stores/dashboard-store.ts`, replace the current comparator-only sort with an explicit decorate/sort/undecorate pattern:

```ts
function sortDevices(devices: DashboardDeviceDTO[]): DashboardDeviceDTO[] {
  return devices
    .map((device, index) => ({ device, index }))
    .sort((a, b) => {
      const priorityDelta = STATUS_PRIORITY[a.device.status] - STATUS_PRIORITY[b.device.status];
      return priorityDelta !== 0 ? priorityDelta : a.index - b.index;
    })
    .map(({ device }) => device);
}
```

That makes the same-status order an intentional guarantee instead of an implicit reliance on runtime sort stability.

- [ ] **Step 3: Run desktop store tests**

```bash
cd /Volumes/T7/Dev/Web/SyncFlow/apps/desktop
pnpm test src/renderer/stores/__tests__/dashboard-store.test.ts
```

Expected: PASS, including the new same-status ordering cases.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/stores/dashboard-store.ts \
        apps/desktop/src/renderer/stores/__tests__/dashboard-store.test.ts
git commit -m "feat(desktop): preserve concurrent device order in dashboard"
```

---

## Task 4: Beta matrix — add concurrent multi-device smoke coverage

**Files:**
- Modify: `docs/testing/beta-test-matrix.md`

- [ ] **Step 1: Add a dedicated manual smoke scenario**

Update `docs/testing/beta-test-matrix.md` with one new manual scenario under the hand-smoke section:

`4.x Multi-device concurrent upload`

Suggested acceptance steps:

1. Pair two phones to the same desktop.
2. Trigger real uploads from both devices close together.
3. Confirm both devices can show `transferring` without one waiting for the other.
4. Confirm the dashboard order is deterministic across refresh/poll/reconnect.
5. Confirm the UI still exposes status only and no queue mutation controls.

- [ ] **Step 2: Add release-gate guidance**

In the release-threshold section, add one note:

- if a change touches multi-device dashboard ordering, complete the manual two-device concurrent-upload smoke once before beta shipping

- [ ] **Step 3: Commit**

```bash
git add docs/testing/beta-test-matrix.md
git commit -m "docs(testing): add multi-device concurrent upload smoke coverage"
```

---

## Verification

Run after all tasks are complete:

```bash
cd /Volumes/T7/Dev/Web/SyncFlow/services/sidecar-go
go test ./internal/store ./internal/api

cd /Volumes/T7/Dev/Web/SyncFlow/apps/desktop
pnpm test src/renderer/stores/__tests__/dashboard-store.test.ts
```

Then run the manual smoke from `docs/testing/beta-test-matrix.md` with two phones connected to one desktop.

## Expected Outcome

- Two phones can upload to the same desktop concurrently.
- No sidecar global scheduler or LMUP handshake delay is introduced.
- `/dashboard/devices` returns a deterministic order for multi-device activity.
- Desktop keeps sidecar-provided order inside each status bucket.
- UI remains read-only and only exposes connection / transfer state.
