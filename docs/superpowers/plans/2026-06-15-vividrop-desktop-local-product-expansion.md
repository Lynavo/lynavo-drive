# Vivi Drop Desktop-Local Product Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Vivi Drop desktop and mobile into the approved desktop-local management product, absorbing both reference projects while keeping management, records, authorization, blocking, shared files, and access history local to each desktop.

**Architecture:** `@lynavo-drive/contracts` defines all new DTOs and API shapes. Go sidecar owns SQLite persistence, pairing/blocking, shared/public registries, received library, sync records, and access records. Desktop reaches these through main/preload IPC and renders the new management console; mobile reaches only the currently connected desktop and stores recent-desktop convenience state locally.

**Tech Stack:** TypeScript contracts, Electron main/preload/React renderer, Zustand stores, Vitest, React Native navigation/screens/i18n, Go sidecar with embedded SQLite migrations and `go test`.

---

## File Structure Map

### Contracts

- Modify: `packages/contracts/src/types.ts`
  - Add DTOs for desktop-local device management, block state, connection attempts, records, shared resources, received library, recent desktop metadata, and mobile LAN resource responses.
- Modify: `packages/contracts/src/events.ts`
  - Add dot-notation event constants for management updates where needed.
- Modify: `packages/contracts/src/index.ts`
  - Export new types/events if current barrel does not already export all source files.
- Modify or add tests under `packages/contracts/src/__tests__/`
  - Verify new exports are visible.

### Sidecar

- Add: `services/sidecar-go/internal/store/migrations/005_desktop_local_management.sql`
  - Add tables/indexes for local device blocks, connection attempts, access records, and shared resources. Implement received-library support as a query adapter over completed uploads unless existing schema inspection proves a view is necessary.
- Modify: `services/sidecar-go/internal/store/models.go`
  - Add Go models matching new local management DTOs.
- Add: `services/sidecar-go/internal/store/device_management.go`
  - Device authorization/block/connection-attempt queries and commands.
- Add: `services/sidecar-go/internal/store/shared_resources.go`
  - Shared/public registry queries and path whitelist helpers.
- Add: `services/sidecar-go/internal/store/access_records.go`
  - Access record writes and queries.
- Add: `services/sidecar-go/internal/store/received_library.go`
  - Adapter over completed uploads for received library.
- Modify: `services/sidecar-go/internal/server/handler_hello.go`
  - Enforce block state in `HELLO_REQ`/`PAIR_REQ`, record wrong code attempts, permanently block at 5 attempts, clear attempt count on successful pair.
- Modify: `services/sidecar-go/internal/protocol/messages.go`
  - Add backward-compatible pair failure details such as remaining attempts and blocked state.
- Add: `services/sidecar-go/internal/api/handlers_management.go`
  - Desktop management APIs for devices, unblock, attempts, records.
- Add: `services/sidecar-go/internal/api/handlers_resources.go`
  - Shared resource and received library APIs using resource ids.
- Modify: `services/sidecar-go/internal/api/router.go`
  - Register new `/management/*`, `/resources/*`, or similarly scoped routes.
- Modify: `services/sidecar-go/internal/api/handlers_shared.go`
  - If existing shared file browsing remains path-based, keep it for compatibility but use new registry/resource-id APIs for new product surfaces.
- Add or update tests:
  - `services/sidecar-go/internal/store/device_management_test.go`
  - `services/sidecar-go/internal/store/shared_resources_test.go`
  - `services/sidecar-go/internal/store/access_records_test.go`
  - `services/sidecar-go/internal/store/received_library_test.go`
  - `services/sidecar-go/internal/server/connection_pairing_block_test.go`
  - `services/sidecar-go/internal/api/management_handlers_test.go`
  - `services/sidecar-go/internal/api/resources_handlers_test.go`

### Desktop Main And Preload

- Modify: `apps/desktop/src/main/sidecar-client.ts`
  - Add typed sidecar client methods for management/resources APIs.
- Modify: `apps/desktop/src/main/ipc-handlers.ts`
  - Add IPC constants and handlers for devices, records, shared resources, received library, unblock, and resource management.
- Modify: `apps/desktop/src/preload/index.ts`
  - Expose new `electronAPI.sidecar` methods.
- Modify: `apps/desktop/src/preload/api.d.ts`
  - Type new preload methods with contracts DTOs.
- Update tests:
  - `apps/desktop/src/main/__tests__/sidecar-client.test.ts`
  - `apps/desktop/src/main/__tests__/ipc-handlers.test.ts`
  - `apps/desktop/src/preload/__tests__/index.test.ts`

### Desktop Renderer

- Modify: `apps/desktop/src/renderer/features/layout/Sidebar.tsx`
  - Replace navigation with new IA: Dashboard, Devices, Shared/Public Files, Library/Received, Records, Settings, Help/About.
- Modify: `apps/desktop/src/renderer/features/layout/AppShell.tsx`
  - Render new view keys and remove user-reachable old entries not in the new IA.
- Modify: `apps/desktop/src/renderer/stores/app-store.ts`
  - Add new view state keys.
- Add: `apps/desktop/src/renderer/stores/management-store.ts`
  - Load devices, block state, records, and actions.
- Add: `apps/desktop/src/renderer/stores/resources-store.ts`
  - Load shared resources and received library.
- Modify: `apps/desktop/src/renderer/stores/dashboard-store.ts`
  - Consume new summary/records where needed without fake data.
- Replace or add feature modules:
  - `apps/desktop/src/renderer/features/dashboard/Dashboard.tsx`
  - `apps/desktop/src/renderer/features/devices/DevicesPage.tsx`
  - `apps/desktop/src/renderer/features/devices/DeviceManagementTable.tsx`
  - `apps/desktop/src/renderer/features/devices/DeviceDetailPanel.tsx`
  - `apps/desktop/src/renderer/features/shared/SharedResourcesPage.tsx`
  - `apps/desktop/src/renderer/features/shared/SharedResourceTable.tsx`
  - `apps/desktop/src/renderer/features/library/ReceivedLibraryPage.tsx`
  - `apps/desktop/src/renderer/features/records/RecordsPage.tsx`
  - `apps/desktop/src/renderer/features/settings/SettingsPage.tsx`
  - `apps/desktop/src/renderer/features/help/HelpPage.tsx`
- Add shared UI primitives only when at least two feature pages need the same component:
  - `apps/desktop/src/renderer/components/shared/MetricTile.tsx`
  - `apps/desktop/src/renderer/components/shared/StatusPill.tsx`
  - `apps/desktop/src/renderer/components/shared/EmptyState.tsx`
- Update desktop tests under colocated `__tests__/`.

### Mobile

- Add: `apps/mobile/src/services/desktop-local-service.ts`
  - LAN calls for current desktop metadata, resource list/download, access-scoped history, and pairing status if exposed via HTTP.
- Add: `apps/mobile/src/stores/recent-desktops-store.ts`
  - Local recent desktop persistence and helpers.
- Modify: `apps/mobile/src/services/SyncEngineModule.ts`
  - Surface pair failure details in JS.
- Modify native bridge files only if the Step 4 JS test proves iOS/Android drops pair failure details:
  - `apps/mobile/ios/...`
  - `apps/mobile/android/...`
- Modify: `apps/mobile/src/navigation/RootNavigator.tsx`
  - Keep existing route names where possible; update presentation flow for recent desktops and hidden old entries.
- Update screens:
  - `apps/mobile/src/screens/DeviceDiscoveryScreen.tsx`
  - `apps/mobile/src/screens/CodeVerifyScreen.tsx`
  - `apps/mobile/src/screens/SyncActivityScreen.tsx`
  - `apps/mobile/src/screens/SharedFilesScreen.tsx`
  - `apps/mobile/src/screens/HistoryScreen.tsx`
  - `apps/mobile/src/screens/AlbumWorkbenchScreen.tsx`
  - `apps/mobile/src/screens/SettingsScreen.tsx`
  - `apps/mobile/src/screens/HelpScreen.tsx`
- Update i18n:
  - `apps/mobile/src/i18n/locales/zh-Hant/*.json`
  - `apps/mobile/src/i18n/locales/zh-Hans/*.json`
  - `apps/mobile/src/i18n/locales/en/*.json`
- Update mobile tests under `apps/mobile/src/screens/__tests__/`, `apps/mobile/src/services/__tests__/`, and `apps/mobile/src/stores/__tests__/`.

---

## Task 1: Contracts For Desktop-Local Product Surface

**Files:**
- Modify: `packages/contracts/src/types.ts`
- Modify: `packages/contracts/src/events.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/__tests__/exports.test.ts`

- [ ] **Step 1: Add failing contract export assertions**

Add assertions that import the new names from `../index`. Use type-only imports for DTOs and runtime assertions for event constants.

```ts
import {
  SIDECAR_EVENT_TYPES,
  type DesktopManagedDeviceDTO,
  type DesktopSharedResourceDTO,
  type DesktopAccessRecordDTO,
  type DesktopSyncRecordDTO,
  type ReceivedLibraryItemDTO,
  type RecentDesktopDTO,
} from '../index';

describe('desktop-local product exports', () => {
  it('exports management event constants', () => {
    expect(SIDECAR_EVENT_TYPES.DEVICE_MANAGEMENT_UPDATED).toBe('device.management.updated');
    expect(SIDECAR_EVENT_TYPES.SHARED_RESOURCES_UPDATED).toBe('shared.resources.updated');
    expect(SIDECAR_EVENT_TYPES.ACCESS_RECORDS_UPDATED).toBe('access.records.updated');
  });
});

function assertTypeExports(
  _device: DesktopManagedDeviceDTO,
  _shared: DesktopSharedResourceDTO,
  _access: DesktopAccessRecordDTO,
  _sync: DesktopSyncRecordDTO,
  _library: ReceivedLibraryItemDTO,
  _recent: RecentDesktopDTO,
) {
  return true;
}
```

- [ ] **Step 2: Run contracts test and confirm it fails**

Run:

```bash
pnpm --filter @lynavo-drive/contracts test -- exports
```

Expected: TypeScript/Vitest fails because the new exports do not exist.

- [ ] **Step 3: Add DTOs to `types.ts`**

Add DTOs near the existing desktop/mobile groups. Keep names explicit and source-of-truth neutral:

```ts
export type DesktopDeviceAuthorizationStatus = 'authorized' | 'revoked';
export type DesktopDeviceBlockStatus = 'active' | 'none';
export type DesktopResourceKind = 'shared_file' | 'shared_folder' | 'received_file';
export type DesktopResourceStatus = 'available' | 'missing' | 'removed';
export type DesktopAccessAction = 'list' | 'view' | 'download' | 'error';
export type DesktopRecordResult = 'ok' | 'denied' | 'missing' | 'error';

export interface DesktopManagedDeviceDTO {
  desktopDeviceId: string;
  clientId: string;
  clientIdShort: string;
  displayName: string;
  platform: string;
  stableDeviceId?: string;
  lastIp?: string;
  authorizedAt?: string;
  lastSeenAt?: string;
  authorizationStatus: DesktopDeviceAuthorizationStatus;
  blockStatus: DesktopDeviceBlockStatus;
  failedAttemptCount: number;
  blockedAt?: string;
  blockReason?: string;
  todayFileCount: number;
  todayBytes: number;
  totalFileCount: number;
  totalBytes: number;
}

export interface DesktopConnectionAttemptDTO {
  desktopDeviceId: string;
  clientId: string;
  displayName?: string;
  result: 'success' | 'wrong_code' | 'blocked';
  failureReason?: string;
  attemptedAt: string;
  remainingAttempts?: number;
}

export interface DesktopBlockStateDTO {
  desktopDeviceId: string;
  clientId: string;
  blocked: boolean;
  failedAttemptCount: number;
  remainingAttempts: number;
  blockedAt?: string;
  reason?: string;
}

export interface DesktopSyncRecordDTO {
  recordId: string;
  desktopDeviceId: string;
  clientId: string;
  displayName: string;
  fileKey: string;
  filename: string;
  mediaType: string;
  fileSize: number;
  status: 'completed' | 'failed';
  completedAt?: string;
  failedAt?: string;
  errorSummary?: string;
}

export interface DesktopAccessRecordDTO {
  recordId: string;
  desktopDeviceId: string;
  clientId: string;
  displayName: string;
  resourceId: string;
  resourceKind: DesktopResourceKind;
  resourceName: string;
  action: DesktopAccessAction;
  result: DesktopRecordResult;
  accessedAt: string;
}

export interface DesktopSharedResourceDTO {
  resourceId: string;
  desktopDeviceId: string;
  kind: DesktopResourceKind;
  displayName: string;
  status: DesktopResourceStatus;
  fileSize?: number;
  mediaType?: string;
  addedAt: string;
  removedAt?: string;
  lastAccessedAt?: string;
  downloadCount: number;
}

export interface ReceivedLibraryItemDTO {
  resourceId: string;
  desktopDeviceId: string;
  clientId: string;
  displayName: string;
  fileKey: string;
  filename: string;
  mediaType: string;
  fileSize: number;
  completedAt: string;
  shareStatus: 'not_shared' | 'shared' | 'missing';
}

export interface RecentDesktopDTO {
  desktopDeviceId: string;
  desktopName: string;
  host: string;
  port: number;
  lastConnectedAt: string;
  authorizationStatus?: 'unknown' | 'authorized' | 'requires_code' | 'blocked';
}

export interface PairingFailureDTO {
  code: 'wrong_code' | 'blocked' | 'version_incompatible' | 'unknown';
  message: string;
  remainingAttempts?: number;
  blocked?: boolean;
}
```

- [ ] **Step 4: Add dot-notation event constants**

If `events.ts` already has an event object, extend it. If it exports types only, add a constant object while preserving existing exports:

```ts
export const SIDECAR_EVENT_TYPES = {
  DEVICE_STATE_CHANGED: 'device.state.changed',
  DASHBOARD_UPDATED: 'dashboard.updated',
  DEVICE_MANAGEMENT_UPDATED: 'device.management.updated',
  SHARED_RESOURCES_UPDATED: 'shared.resources.updated',
  ACCESS_RECORDS_UPDATED: 'access.records.updated',
} as const;
```

Ensure this does not break existing `SidecarEvent` typing.

- [ ] **Step 5: Export from barrel**

Confirm `packages/contracts/src/index.ts` exports `types.ts` and `events.ts`. Add missing exports only.

- [ ] **Step 6: Run contracts tests**

Run:

```bash
pnpm --filter @lynavo-drive/contracts test -- exports
pnpm --filter @lynavo-drive/contracts build
```

Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/types.ts packages/contracts/src/events.ts packages/contracts/src/index.ts packages/contracts/src/__tests__/exports.test.ts
git commit -m "feat(contracts): add desktop-local management DTOs"
```

---

## Task 2: Sidecar Persistence For Devices, Blocks, Records, And Resources

**Files:**
- Create: `services/sidecar-go/internal/store/migrations/005_desktop_local_management.sql`
- Modify: `services/sidecar-go/internal/store/models.go`
- Create: `services/sidecar-go/internal/store/device_management.go`
- Create: `services/sidecar-go/internal/store/shared_resources.go`
- Create: `services/sidecar-go/internal/store/access_records.go`
- Create: `services/sidecar-go/internal/store/received_library.go`
- Test: `services/sidecar-go/internal/store/device_management_test.go`
- Test: `services/sidecar-go/internal/store/shared_resources_test.go`
- Test: `services/sidecar-go/internal/store/access_records_test.go`
- Test: `services/sidecar-go/internal/store/received_library_test.go`

- [ ] **Step 1: Write migration tests first**

In `device_management_test.go`, create tests that open the store through existing test helpers and verify:

```go
func TestDeviceBlockLifecycle(t *testing.T) {
	s := newTestStore(t)
	state, err := s.RecordConnectionAttempt(store.ConnectionAttempt{
		DesktopDeviceID: "desktop-1",
		ClientID:        "client-1",
		ClientName:      "iPhone",
		Result:          "wrong_code",
		FailureReason:   "wrong_code",
	})
	require.NoError(t, err)
	require.False(t, state.Blocked)
	require.Equal(t, 4, state.RemainingAttempts)

	for i := 0; i < 4; i++ {
		state, err = s.RecordConnectionAttempt(store.ConnectionAttempt{
			DesktopDeviceID: "desktop-1",
			ClientID:        "client-1",
			Result:          "wrong_code",
			FailureReason:   "wrong_code",
		})
		require.NoError(t, err)
	}
	require.True(t, state.Blocked)
	require.Equal(t, 0, state.RemainingAttempts)

	blocked, err := s.GetDeviceBlockState("desktop-1", "client-1")
	require.NoError(t, err)
	require.True(t, blocked.Blocked)

	require.NoError(t, s.UnblockDevice("desktop-1", "client-1"))
	unblocked, err := s.GetDeviceBlockState("desktop-1", "client-1")
	require.NoError(t, err)
	require.False(t, unblocked.Blocked)
}
```

Add a second test proving desktop isolation: five failures on `desktop-1` do not block `desktop-2`.

- [ ] **Step 2: Write shared resource tests first**

In `shared_resources_test.go`, verify:

```go
func TestSharedResourceRegistryRejectsTraversal(t *testing.T) {
	s := newTestStore(t)
	_, err := s.AddSharedResource(store.SharedResourceInput{
		DesktopDeviceID: "desktop-1",
		DisplayName:     "bad",
		Kind:            "shared_file",
		LocalPath:       "../secret.txt",
	})
	require.Error(t, err)
}

func TestSharedResourceLifecycle(t *testing.T) {
	s := newTestStore(t)
	resource, err := s.AddSharedResource(store.SharedResourceInput{
		DesktopDeviceID: "desktop-1",
		DisplayName:     "photo.jpg",
		Kind:            "shared_file",
		LocalPath:       filepath.Join(t.TempDir(), "photo.jpg"),
	})
	require.NoError(t, err)
	require.NotEmpty(t, resource.ResourceID)

	items, err := s.ListSharedResources("desktop-1")
	require.NoError(t, err)
	require.Len(t, items, 1)

	require.NoError(t, s.RemoveSharedResource("desktop-1", resource.ResourceID))
	items, err = s.ListSharedResources("desktop-1")
	require.NoError(t, err)
	require.Len(t, items, 0)
}
```

- [ ] **Step 3: Write access and received-library tests first**

Add tests that:

- insert a completed upload using existing upload helpers
- verify `ListReceivedLibrary("desktop-1")` returns it as `not_shared`
- record `list`, `view`, and `download` access events
- verify records are scoped by `desktopDeviceID`

- [ ] **Step 4: Run store tests and confirm failure**

Run:

```bash
cd services/sidecar-go && go test ./internal/store
```

Expected: fails because migration and store methods do not exist.

- [ ] **Step 5: Add migration**

Create `005_desktop_local_management.sql` with parameterized-friendly schema:

```sql
CREATE TABLE IF NOT EXISTS device_blocks (
  desktop_device_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  failed_attempt_count INTEGER NOT NULL DEFAULT 0,
  blocked_at TEXT,
  manually_unblocked_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (desktop_device_id, client_id)
);

CREATE TABLE IF NOT EXISTS connection_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  desktop_device_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_name TEXT,
  result TEXT NOT NULL,
  failure_reason TEXT,
  attempted_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_connection_attempts_device_client
  ON connection_attempts(desktop_device_id, client_id, attempted_at DESC);

CREATE TABLE IF NOT EXISTS shared_resources (
  resource_id TEXT PRIMARY KEY,
  desktop_device_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  display_name TEXT NOT NULL,
  local_path TEXT,
  received_file_key TEXT,
  file_size INTEGER,
  media_type TEXT,
  status TEXT NOT NULL,
  added_at TEXT NOT NULL,
  removed_at TEXT,
  last_accessed_at TEXT,
  download_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_shared_resources_desktop_status
  ON shared_resources(desktop_device_id, status, added_at DESC);

CREATE TABLE IF NOT EXISTS access_records (
  record_id TEXT PRIMARY KEY,
  desktop_device_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_name TEXT,
  resource_id TEXT NOT NULL,
  resource_kind TEXT NOT NULL,
  resource_name TEXT NOT NULL,
  action TEXT NOT NULL,
  result TEXT NOT NULL,
  accessed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_access_records_desktop_accessed
  ON access_records(desktop_device_id, accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_records_client_accessed
  ON access_records(desktop_device_id, client_id, accessed_at DESC);
```

- [ ] **Step 6: Add Go models**

Add structs to `models.go`:

```go
type DeviceBlockState struct {
	DesktopDeviceID    string  `json:"desktopDeviceId"`
	ClientID           string  `json:"clientId"`
	Blocked            bool    `json:"blocked"`
	FailedAttemptCount int     `json:"failedAttemptCount"`
	RemainingAttempts  int     `json:"remainingAttempts"`
	BlockedAt          *string `json:"blockedAt,omitempty"`
	Reason             *string `json:"reason,omitempty"`
}

type ConnectionAttempt struct {
	DesktopDeviceID string `json:"desktopDeviceId"`
	ClientID        string `json:"clientId"`
	ClientName      string `json:"clientName,omitempty"`
	Result          string `json:"result"`
	FailureReason   string `json:"failureReason,omitempty"`
	AttemptedAt     string `json:"attemptedAt,omitempty"`
}

type SharedResource struct {
	ResourceID      string  `json:"resourceId"`
	DesktopDeviceID string  `json:"desktopDeviceId"`
	Kind            string  `json:"kind"`
	DisplayName     string  `json:"displayName"`
	LocalPath       *string `json:"-"`
	ReceivedFileKey *string `json:"receivedFileKey,omitempty"`
	FileSize        *int64  `json:"fileSize,omitempty"`
	MediaType       *string `json:"mediaType,omitempty"`
	Status          string  `json:"status"`
	AddedAt         string  `json:"addedAt"`
	RemovedAt       *string `json:"removedAt,omitempty"`
	LastAccessedAt  *string `json:"lastAccessedAt,omitempty"`
	DownloadCount   int     `json:"downloadCount"`
}

type SharedResourceInput struct {
	DesktopDeviceID string
	DisplayName     string
	Kind            string
	LocalPath       string
	ReceivedFileKey string
	FileSize        *int64
	MediaType       *string
}

type AccessRecord struct {
	RecordID        string `json:"recordId"`
	DesktopDeviceID string `json:"desktopDeviceId"`
	ClientID        string `json:"clientId"`
	ClientName      string `json:"displayName"`
	ResourceID      string `json:"resourceId"`
	ResourceKind    string `json:"resourceKind"`
	ResourceName    string `json:"resourceName"`
	Action          string `json:"action"`
	Result          string `json:"result"`
	AccessedAt      string `json:"accessedAt"`
}

type ReceivedLibraryItem struct {
	ResourceID       string `json:"resourceId"`
	DesktopDeviceID string `json:"desktopDeviceId"`
	ClientID        string `json:"clientId"`
	DisplayName     string `json:"displayName"`
	FileKey         string `json:"fileKey"`
	Filename        string `json:"filename"`
	MediaType       string `json:"mediaType"`
	FileSize        int64  `json:"fileSize"`
	CompletedAt     string `json:"completedAt"`
	ShareStatus     string `json:"shareStatus"`
}
```

- [ ] **Step 7: Implement store methods**

Implement with parameterized SQL only:

- `RecordConnectionAttempt`
- `GetDeviceBlockState`
- `UnblockDevice`
- `ClearConnectionAttempts`
- `ListManagedDevices`
- `AddSharedResource`
- `RemoveSharedResource`
- `ListSharedResources`
- `ResolveSharedResource`
- `RecordAccess`
- `ListAccessRecords`
- `ListSyncRecords`
- `ListReceivedLibrary`

Use constants:

```go
const maxConnectionCodeAttempts = 5
```

Use `crypto/rand` or existing UUID helper for ids. Do not use local filesystem path as resource id.

- [ ] **Step 8: Run store tests**

Run:

```bash
cd services/sidecar-go && go test ./internal/store
```

Expected: pass.

- [ ] **Step 9: Commit**

```bash
git add services/sidecar-go/internal/store
git commit -m "feat(sidecar): persist desktop-local management state"
```

---

## Task 3: Sidecar Pairing Enforcement And Management APIs

**Files:**
- Modify: `services/sidecar-go/internal/server/handler_hello.go`
- Modify: `services/sidecar-go/internal/protocol/messages.go`
- Create: `services/sidecar-go/internal/api/handlers_management.go`
- Create: `services/sidecar-go/internal/api/handlers_resources.go`
- Modify: `services/sidecar-go/internal/api/router.go`
- Test: `services/sidecar-go/internal/server/connection_pairing_block_test.go`
- Test: `services/sidecar-go/internal/api/management_handlers_test.go`
- Test: `services/sidecar-go/internal/api/resources_handlers_test.go`

- [ ] **Step 1: Write pairing block tests first**

Test the TCP pairing flow or the smallest existing connection helper:

- new mobile sends `HELLO_REQ` with `clientId`
- sends wrong `PAIR_REQ` 5 times
- receives structured failure with remaining attempts before block
- receives blocked failure at/after limit
- after `UnblockDevice`, pairing can proceed with the correct code

Expected assertion shape:

```go
require.False(t, pairRes.OK)
require.Equal(t, "wrong_code", pairRes.ErrorCode)
require.Equal(t, 4, pairRes.RemainingAttempts)
```

- [ ] **Step 2: Extend protocol failure fields**

In `PairRes`, keep existing fields and add optional fields:

```go
type PairRes struct {
	OK                bool       `json:"ok"`
	Error             string     `json:"error,omitempty"`
	ErrorCode         string     `json:"errorCode,omitempty"`
	RemainingAttempts int        `json:"remainingAttempts,omitempty"`
	Blocked           bool       `json:"blocked,omitempty"`
	PairingID         string     `json:"pairingId"`
	PairingToken      string     `json:"pairingToken"`
	ServerInfo         ServerInfo `json:"serverInfo"`
}
```

Older clients can ignore the new fields.

- [ ] **Step 3: Enforce block state in `handleHello` and `handlePair`**

Use `serverID` from `GetDeviceID()` as `desktopDeviceID`.

In `handleHello`, after `c.clientID = req.ClientID`, check `GetDeviceBlockState(serverID, req.ClientID)`. If blocked, send a protocol error or `HELLO_RES` state that existing clients can handle. Prefer a clear error:

```go
return c.rejectWithError("DEVICE_BLOCKED", "此手機已被此電腦封鎖，請在電腦端手動解除")
```

In `handlePair`, before code validation, check block state again. On wrong code:

```go
state, err := c.store.RecordConnectionAttempt(store.ConnectionAttempt{
	DesktopDeviceID: serverID,
	ClientID:        req.ClientID,
	ClientName:      req.ClientName,
	Result:          "wrong_code",
	FailureReason:   "wrong_code",
})
```

Return:

```go
protocol.PairRes{
	OK: false,
	Error: errorMessage,
	ErrorCode: errorCode,
	RemainingAttempts: state.RemainingAttempts,
	Blocked: state.Blocked,
}
```

On successful pairing, call `ClearConnectionAttempts(serverID, req.ClientID)`.

- [ ] **Step 4: Write management API tests first**

Cover:

- `GET /management/devices`
- `POST /management/devices/{clientId}/unblock`
- `GET /management/records/sync`
- `GET /management/records/access`

Use local request semantics and existing handler test helpers.

- [ ] **Step 5: Implement management handlers**

Create handlers that:

- load `desktopDeviceID` from store
- call store methods
- return JSON DTO-compatible shapes
- reject invalid client/resource ids with `400`
- return `404` for missing resources where appropriate

Register routes in `router.go`.

- [ ] **Step 6: Write resource API tests first**

Cover:

- desktop list/add/remove shared resources
- received library list
- resource download rejects unknown ids
- access record created on mobile list/view/download

- [ ] **Step 7: Implement resource handlers**

Use resource ids instead of arbitrary path segments:

- `GET /resources/shared`
- `POST /resources/shared`
- `DELETE /resources/shared/{resourceId}`
- `GET /resources/received`
- `GET /resources/mobile/shared`
- `GET /resources/mobile/received`
- `GET /resources/mobile/download/{resourceId}`

Keep old `/shared/list/{path...}` endpoints for compatibility but do not use them in new UI.

- [ ] **Step 8: Run sidecar tests**

Run:

```bash
cd services/sidecar-go && go test ./internal/server ./internal/api ./internal/store
```

Expected: pass.

- [ ] **Step 9: Commit**

```bash
git add services/sidecar-go/internal/server services/sidecar-go/internal/protocol services/sidecar-go/internal/api
git commit -m "feat(sidecar): enforce pairing blocks and expose management APIs"
```

---

## Task 4: Desktop Main/Preload Bridge For Management APIs

**Files:**
- Modify: `apps/desktop/src/main/sidecar-client.ts`
- Modify: `apps/desktop/src/main/ipc-handlers.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/preload/api.d.ts`
- Test: `apps/desktop/src/main/__tests__/sidecar-client.test.ts`
- Test: `apps/desktop/src/main/__tests__/ipc-handlers.test.ts`
- Test: `apps/desktop/src/preload/__tests__/index.test.ts`

- [ ] **Step 1: Write failing sidecar client tests**

Add tests that mock sidecar HTTP responses for:

- `getManagedDevices()`
- `unblockDevice(clientId)`
- `getSyncRecords()`
- `getAccessRecords()`
- `getSharedResources()`
- `addSharedResource(payload)`
- `removeSharedResource(resourceId)`
- `getReceivedLibrary()`

Assert paths and methods match Task 3 routes.

- [ ] **Step 2: Implement sidecar client methods**

Import contract DTO types and add methods with typed return values. Ensure errors are surfaced instead of converted into fake empty arrays.

- [ ] **Step 3: Write IPC/preload tests**

Assert:

- new IPC constants exist
- handlers call sidecar client
- preload exposes methods under `electronAPI.sidecar`
- renderer-facing types match contracts DTOs

- [ ] **Step 4: Implement IPC constants and handlers**

Add constants such as:

```ts
SIDECAR_MANAGED_DEVICES: 'sidecar:managed-devices',
SIDECAR_UNBLOCK_DEVICE: 'sidecar:unblock-device',
SIDECAR_SYNC_RECORDS: 'sidecar:sync-records',
SIDECAR_ACCESS_RECORDS: 'sidecar:access-records',
SIDECAR_SHARED_RESOURCES: 'sidecar:shared-resources',
SIDECAR_ADD_SHARED_RESOURCE: 'sidecar:add-shared-resource',
SIDECAR_REMOVE_SHARED_RESOURCE: 'sidecar:remove-shared-resource',
SIDECAR_RECEIVED_LIBRARY: 'sidecar:received-library',
```

Expose matching preload methods.

- [ ] **Step 5: Run desktop bridge tests**

Run:

```bash
pnpm --filter @lynavo-drive/desktop test -- sidecar-client ipc-handlers preload
pnpm --filter @lynavo-drive/desktop typecheck
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/sidecar-client.ts apps/desktop/src/main/ipc-handlers.ts apps/desktop/src/preload/index.ts apps/desktop/src/preload/api.d.ts apps/desktop/src/main/__tests__ apps/desktop/src/preload/__tests__
git commit -m "feat(desktop): bridge desktop-local management APIs"
```

---

## Task 5: Desktop New IA Shell And Legacy Entry Hiding

**Files:**
- Modify: `apps/desktop/src/renderer/stores/app-store.ts`
- Modify: `apps/desktop/src/renderer/features/layout/Sidebar.tsx`
- Modify: `apps/desktop/src/renderer/features/layout/AppShell.tsx`
- Modify: `apps/desktop/src/renderer/features/settings/SettingsPage.tsx`
- Test: `apps/desktop/src/renderer/stores/__tests__/app-store.test.ts`
- Test: `apps/desktop/src/renderer/features/layout/__tests__/Sidebar.test.tsx`
- Test: `apps/desktop/src/renderer/features/settings/__tests__/SettingsPage.test.tsx`

- [ ] **Step 1: Write failing IA tests**

Assert sidebar contains:

- Dashboard
- Devices
- Shared
- Library
- Records
- Settings
- Help

Assert sidebar does not expose old entries not represented in the new IA. Use current old labels from the existing tests as explicit negative assertions.

- [ ] **Step 2: Update app-store view union**

Add view keys:

```ts
type AppView = 'dashboard' | 'devices' | 'shared' | 'library' | 'records' | 'settings' | 'help';
```

Keep compatibility helpers only if existing components still need them during migration.

- [ ] **Step 3: Update Sidebar**

Use reference-inspired labels and icons, but keep React/Electron code native to this app. No mock rows.

- [ ] **Step 4: Update AppShell routing**

Render placeholder real pages if later tasks have not implemented them yet. Placeholders must be honest empty states such as "尚無資料" or "正在載入", not fake metrics.

- [ ] **Step 5: Hide legacy settings entries**

Remove user-reachable entries from `SettingsPage` that are not in the approved new IA. Do not delete underlying IPC/store logic in this task.

- [ ] **Step 6: Run IA tests**

Run:

```bash
pnpm --filter @lynavo-drive/desktop test -- Sidebar SettingsPage app-store
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/stores/app-store.ts apps/desktop/src/renderer/features/layout apps/desktop/src/renderer/features/settings
git commit -m "feat(desktop): introduce desktop-local navigation shell"
```

---

## Task 6: Desktop Devices And Records Pages

**Files:**
- Create: `apps/desktop/src/renderer/stores/management-store.ts`
- Create: `apps/desktop/src/renderer/stores/__tests__/management-store.test.ts`
- Create: `apps/desktop/src/renderer/features/devices/DevicesPage.tsx`
- Create: `apps/desktop/src/renderer/features/devices/DeviceManagementTable.tsx`
- Create: `apps/desktop/src/renderer/features/devices/DeviceDetailPanel.tsx`
- Create: `apps/desktop/src/renderer/features/devices/__tests__/DevicesPage.test.tsx`
- Create: `apps/desktop/src/renderer/features/records/RecordsPage.tsx`
- Create: `apps/desktop/src/renderer/features/records/__tests__/RecordsPage.test.tsx`
- Modify: `apps/desktop/src/renderer/features/layout/AppShell.tsx`

- [ ] **Step 1: Write management-store tests**

Mock `window.electronAPI.sidecar` and assert:

- `loadDevices` sets loading then devices
- failed load sets error, not fake empty success
- `unblockDevice` calls bridge then reloads devices
- `loadRecords` scopes sync/access records

- [ ] **Step 2: Implement management-store**

Use Zustand, matching existing store style. Keep methods small:

```ts
loadDevices()
unblockDevice(clientId: string)
loadSyncRecords(filters?: RecordFilters)
loadAccessRecords(filters?: RecordFilters)
```

- [ ] **Step 3: Write DevicesPage tests**

Assert:

- displays authorized device
- displays blocked device with manual unblock action
- masks long `clientId`
- empty state is real
- clicking unblock calls store action

- [ ] **Step 4: Implement DevicesPage components**

Use reference visual hierarchy, but no copied prototype state. The table/detail panel receives DTOs from store.

- [ ] **Step 5: Write RecordsPage tests**

Assert:

- sync and access tabs or segmented controls render
- records display real DTO fields
- empty and error states render
- no delete/ledger mutation buttons exist

- [ ] **Step 6: Implement RecordsPage**

Use `DesktopSyncRecordDTO` and `DesktopAccessRecordDTO`. Filtering can be local initially if API returns manageable data; if adding server filters, keep query params typed.

- [ ] **Step 7: Wire AppShell**

Render `DevicesPage` and `RecordsPage`.

- [ ] **Step 8: Run desktop tests**

Run:

```bash
pnpm --filter @lynavo-drive/desktop test -- management-store DevicesPage RecordsPage
pnpm --filter @lynavo-drive/desktop typecheck
```

Expected: pass.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/renderer/stores/management-store.ts apps/desktop/src/renderer/features/devices apps/desktop/src/renderer/features/records apps/desktop/src/renderer/features/layout/AppShell.tsx
git commit -m "feat(desktop): add device management and records pages"
```

---

## Task 7: Desktop Shared Resources And Received Library Pages

**Files:**
- Create: `apps/desktop/src/renderer/stores/resources-store.ts`
- Create: `apps/desktop/src/renderer/stores/__tests__/resources-store.test.ts`
- Create: `apps/desktop/src/renderer/features/shared/SharedResourcesPage.tsx`
- Create: `apps/desktop/src/renderer/features/shared/SharedResourceTable.tsx`
- Create: `apps/desktop/src/renderer/features/shared/__tests__/SharedResourcesPage.test.tsx`
- Create: `apps/desktop/src/renderer/features/library/ReceivedLibraryPage.tsx`
- Create: `apps/desktop/src/renderer/features/library/__tests__/ReceivedLibraryPage.test.tsx`
- Modify: `apps/desktop/src/renderer/features/layout/AppShell.tsx`

- [ ] **Step 1: Write resources-store tests**

Assert:

- load shared resources
- add desktop-managed resource through bridge
- remove resource through bridge
- load received library
- errors remain visible

- [ ] **Step 2: Implement resources-store**

Methods:

```ts
loadSharedResources()
addSharedResource(input)
removeSharedResource(resourceId)
loadReceivedLibrary()
shareReceivedItem(fileKey)
```

`shareReceivedItem(fileKey)` must call a real sidecar API that creates a shared resource from an existing received upload. If Task 3 did not add that endpoint, extend Task 3 with `POST /resources/shared/from-received` and extend Task 4 with the matching preload bridge before implementing this store method.

- [ ] **Step 3: Write SharedResourcesPage tests**

Assert:

- desktop-only add/remove controls exist
- mobile management wording does not appear
- missing resource state is visible
- download counts and last access render

- [ ] **Step 4: Implement SharedResourcesPage**

Use only preload capabilities for file/folder selection. Before implementing the page, inspect `apps/desktop/src/preload/api.d.ts`:

- If a file picker method exists, use it.
- If only `files.selectFolder()` exists, add `FILES_SELECT_FILE`, `files.selectFile()`, and tests to Task 4 before this task starts.

Renderer code must not access Node filesystem APIs or sidecar paths directly.

- [ ] **Step 5: Write ReceivedLibraryPage tests**

Assert:

- displays received items
- shows source mobile and completed date
- add-to-shared action appears only on desktop
- no queue delete/reorder/skip buttons

- [ ] **Step 6: Implement ReceivedLibraryPage**

Use completed uploads via received-library API. Empty state must be true empty, not mock.

- [ ] **Step 7: Wire AppShell**

Render shared and library pages.

- [ ] **Step 8: Run desktop tests**

Run:

```bash
pnpm --filter @lynavo-drive/desktop test -- resources-store SharedResourcesPage ReceivedLibraryPage
pnpm --filter @lynavo-drive/desktop typecheck
```

Expected: pass.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/renderer/stores/resources-store.ts apps/desktop/src/renderer/features/shared apps/desktop/src/renderer/features/library apps/desktop/src/renderer/features/layout/AppShell.tsx
git commit -m "feat(desktop): add shared resources and received library"
```

---

## Task 8: Desktop Dashboard, Settings, And Help Visual Completion

**Files:**
- Modify: `apps/desktop/src/renderer/features/dashboard/Dashboard.tsx`
- Modify: `apps/desktop/src/renderer/features/dashboard/DeviceCard.tsx`
- Modify: `apps/desktop/src/renderer/features/dashboard/StatCard.tsx`
- Modify: `apps/desktop/src/renderer/features/settings/SettingsPage.tsx`
- Modify: `apps/desktop/src/renderer/features/help/HelpPage.tsx`
- Create only if at least two feature pages need the same primitive: `apps/desktop/src/renderer/components/shared/MetricTile.tsx`
- Create only if at least two feature pages need the same primitive: `apps/desktop/src/renderer/components/shared/StatusPill.tsx`
- Create only if at least two feature pages need the same primitive: `apps/desktop/src/renderer/components/shared/EmptyState.tsx`
- Tests under existing colocated `__tests__/`

- [ ] **Step 1: Update dashboard tests**

Assert dashboard shows:

- sidecar status
- connection code
- online devices
- recent sync summary
- recent error state if supplied
- no fake rows when APIs return empty arrays

- [ ] **Step 2: Implement dashboard visual update**

Use reference cards and hierarchy. Pull real state from existing dashboard store plus new management/resource store where needed.

- [ ] **Step 3: Update settings/help tests**

Assert settings keeps:

- device name
- storage path
- connection code/security
- language
- support/diagnostics
- sidecar/runtime status

Assert hidden old entries are not rendered.

- [ ] **Step 4: Implement settings/help update**

Use Taiwan-standard Traditional Chinese for new zh-Hant copy. Keep existing i18n pattern.

- [ ] **Step 5: Run desktop visual surface tests**

Run:

```bash
pnpm --filter @lynavo-drive/desktop test -- Dashboard SettingsPage HelpPage
pnpm --filter @lynavo-drive/desktop typecheck
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/features/dashboard apps/desktop/src/renderer/features/settings apps/desktop/src/renderer/features/help apps/desktop/src/renderer/components/shared
git commit -m "feat(desktop): complete new management console UI"
```

---

## Task 9: Mobile Recent Desktops And Code Verification

**Files:**
- Create: `apps/mobile/src/stores/recent-desktops-store.ts`
- Create: `apps/mobile/src/stores/__tests__/recent-desktops-store.test.ts`
- Modify: `apps/mobile/src/services/SyncEngineModule.ts`
- Modify: native bridge files only when Step 4 proves pair failure details are dropped before reaching JS
- Modify: `apps/mobile/src/screens/DeviceDiscoveryScreen.tsx`
- Modify: `apps/mobile/src/screens/CodeVerifyScreen.tsx`
- Modify: `apps/mobile/src/navigation/RootNavigator.tsx`
- Modify: mobile i18n JSON files for `deviceDiscovery` and `codeVerify`
- Tests:
  - `apps/mobile/src/screens/__tests__/DeviceDiscoveryScreen.pairingOptions.test.tsx`
  - `apps/mobile/src/screens/__tests__/DeviceDiscoveryScreen.switchMode.test.tsx`
  - `apps/mobile/src/screens/__tests__/CodeVerifyScreen.test.tsx`

- [ ] **Step 1: Write recent-desktops store tests**

Assert:

- adding desktop dedupes by `desktopDeviceId`
- most recent sorts first
- forgetting removes only that desktop
- authorization status can update to `authorized`, `requires_code`, or `blocked`

- [ ] **Step 2: Implement recent-desktops store**

Use the app's existing storage pattern. Store only:

```ts
desktopDeviceId
desktopName
host
port
lastConnectedAt
authorizationStatus
```

Do not store management records or shared resource lists.

- [ ] **Step 3: Write CodeVerify tests for pairing failures**

Mock sync engine pairing response:

- wrong code with `remainingAttempts: 4`
- blocked with `blocked: true`

Assert UI shows remaining attempts and desktop manual unblock instruction.

- [ ] **Step 4: Surface pairing failure details**

First add a failing JS test around the current `SyncEngineModule` wrapper:

```ts
it('maps native pairing failure details to PairingFailureDTO', async () => {
  mockNativeConnect.mockRejectedValueOnce({
    code: 'wrong_code',
    message: '連接碼錯誤',
    remainingAttempts: 4,
    blocked: false,
  });

  await expect(connectWithCode(input)).rejects.toMatchObject({
    code: 'wrong_code',
    remainingAttempts: 4,
    blocked: false,
  });
});
```

If this can be implemented entirely in TypeScript, do not touch native files. If the test proves iOS/Android native modules discard `remainingAttempts` or `blocked`, extend only the native error payload fields needed for `PairingFailureDTO`.

- [ ] **Step 5: Update DeviceDiscoveryScreen**

Show:

- LAN discovered desktops
- recent desktops
- direct reconnect action
- fallback to code verify

No fake devices.

- [ ] **Step 6: Update CodeVerifyScreen**

Show:

- wrong code count/remaining attempts
- blocked state
- desktop manual unblock instruction

- [ ] **Step 7: Run mobile tests**

Run:

```bash
pnpm --filter @lynavo-drive/mobile test -- recent-desktops CodeVerifyScreen DeviceDiscoveryScreen
pnpm --filter @lynavo-drive/mobile exec tsc --noEmit
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/stores apps/mobile/src/services/SyncEngineModule.ts apps/mobile/src/screens/DeviceDiscoveryScreen.tsx apps/mobile/src/screens/CodeVerifyScreen.tsx apps/mobile/src/navigation/RootNavigator.tsx apps/mobile/src/i18n
git commit -m "feat(mobile): add recent desktops and pairing block states"
```

---

## Task 10: Mobile Shared Files, History, Sync Activity, Settings, And Album Repositioning

**Files:**
- Create: `apps/mobile/src/services/desktop-local-service.ts`
- Create: `apps/mobile/src/services/__tests__/desktop-local-service.test.ts`
- Modify: `apps/mobile/src/screens/SyncActivityScreen.tsx`
- Modify: `apps/mobile/src/screens/SharedFilesScreen.tsx`
- Modify: `apps/mobile/src/screens/HistoryScreen.tsx`
- Modify: `apps/mobile/src/screens/AlbumWorkbenchScreen.tsx`
- Modify: `apps/mobile/src/screens/SettingsScreen.tsx`
- Modify: `apps/mobile/src/screens/HelpScreen.tsx`
- Modify: mobile i18n JSON files for shared files, history, sync activity, album, settings, help
- Tests under `apps/mobile/src/screens/__tests__/`

- [ ] **Step 1: Write desktop-local-service tests**

Mock fetch or existing LAN request helper and assert:

- lists shared resources from current desktop
- lists received-library resources from current desktop
- downloads by `resourceId`
- rejects path-based arbitrary download calls
- returns errors to callers instead of fake empty arrays

- [ ] **Step 2: Implement desktop-local-service**

Use current desktop host/port from binding/session state. API functions:

```ts
listSharedResources(currentDesktop)
listReceivedLibrary(currentDesktop)
downloadResource(currentDesktop, resourceId)
listHistory(currentDesktop)
```

- [ ] **Step 3: Update SharedFilesScreen tests**

Assert:

- list renders shared resources
- received-library section renders
- download calls resource-id API
- no add/remove controls exist
- error state is visible

- [ ] **Step 4: Implement SharedFilesScreen**

Use reference visual style but real service data.

- [ ] **Step 5: Update HistoryScreen tests**

Assert:

- history is scoped to current desktop
- switching desktop changes scope
- empty state is real

- [ ] **Step 6: Implement HistoryScreen**

Use desktop-local records where available. If offline, show cached session summary only with explicit offline state.

- [ ] **Step 7: Update SyncActivityScreen tests**

Assert:

- automatic sync state remains
- queue summary renders
- no delete/reorder/skip queue actions
- current desktop status shown

- [ ] **Step 8: Implement SyncActivityScreen visual update**

Keep NativeSyncEngine data flow. Do not create fake transfer timers.

- [ ] **Step 9: Update AlbumWorkbenchScreen tests**

Assert:

- album is presented as pending/synced automatic sync summary
- manual upload entry points from old UI are hidden if not part of approved IA
- no production manual file-picking CTA appears

- [ ] **Step 10: Implement AlbumWorkbenchScreen repositioning**

Preserve native scan/export behavior. Do not add reference manual selection as production upload behavior.

- [ ] **Step 11: Update Settings/Help tests**

Assert:

- current desktop information appears
- forget recent desktop appears
- diagnostics remains if current product supports it
- old non-reference entries are hidden

- [ ] **Step 12: Implement Settings/Help visual update**

Use Taiwan-standard Traditional Chinese for zh-Hant copy and keep existing market/account gates.

- [ ] **Step 13: Run mobile tests**

Run:

```bash
pnpm --filter @lynavo-drive/mobile test -- desktop-local-service SharedFilesScreen HistoryScreen SyncActivityScreen AlbumWorkbenchScreen SettingsScreen HelpScreen
pnpm --filter @lynavo-drive/mobile exec tsc --noEmit
```

Expected: pass.

- [ ] **Step 14: Commit**

```bash
git add apps/mobile/src/services/desktop-local-service.ts apps/mobile/src/screens apps/mobile/src/i18n apps/mobile/src/services/__tests__ apps/mobile/src/screens/__tests__
git commit -m "feat(mobile): add desktop-local shared files and history UI"
```

---

## Task 11: Cross-Surface Legacy Entry Audit

**Files:**
- Modify tests as needed across desktop/mobile
- Modify only UI entry files needed to hide old routes/actions
- Create: `docs/testing/desktop-local-product-expansion-regression.md`

- [ ] **Step 1: Search for legacy/manual/destructive entry labels**

Run:

```bash
rg -n "delete|remove|skip|reorder|manual|手動|删除|刪除|跳過|重排|mock|fake" apps/desktop/src/renderer apps/mobile/src
```

Classify results:

- allowed internal logic
- hidden old UI entry
- test text that must be updated
- prohibited user-reachable action

- [ ] **Step 2: Add negative tests for prohibited actions**

Desktop:

- queue destructive actions not visible
- old settings entries hidden
- renderer does not import sidecar/sqlite/fs directly

Mobile:

- no queue delete/reorder/skip controls
- no manual file-picking upload CTA
- no mobile add/remove shared resource controls

- [ ] **Step 3: Fix UI leaks**

Remove or hide only user-reachable entries. Do not delete compatibility logic unless tests prove it is only old UI code.

- [ ] **Step 4: Document regression matrix**

If the update changes enough workflows, add a short regression doc with:

- pairing wrong-code block
- desktop unblock
- multi-desktop isolation
- desktop shared resource add/remove
- mobile shared resource download
- access record creation
- sync activity queue read-only

- [ ] **Step 5: Run targeted audits**

Run:

```bash
pnpm --filter @lynavo-drive/desktop test -- Sidebar SettingsPage Dashboard DevicesPage RecordsPage SharedResourcesPage ReceivedLibraryPage
pnpm --filter @lynavo-drive/mobile test -- DeviceDiscoveryScreen CodeVerifyScreen SyncActivityScreen SharedFilesScreen HistoryScreen AlbumWorkbenchScreen SettingsScreen
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src apps/mobile/src docs/testing
git commit -m "test: audit desktop-local product entry points"
```

---

## Task 12: Final Integration Verification And Self-Review

**Files:**
- No planned source changes unless verification exposes defects.

- [ ] **Step 1: Check worktree cleanliness and untracked references**

Run:

```bash
git status --short --branch
```

Expected:

- implementation files are committed or intentionally staged for final fix
- reference directories remain untracked unless explicitly ignored by user
- unrelated pre-existing changes are not reverted

- [ ] **Step 2: Run contracts build**

Run:

```bash
pnpm --filter @lynavo-drive/contracts build
```

Expected: pass.

- [ ] **Step 3: Run sidecar tests**

Run:

```bash
cd services/sidecar-go && go test ./...
```

Expected: pass.

- [ ] **Step 4: Run desktop checks**

Run:

```bash
pnpm --filter @lynavo-drive/desktop typecheck
pnpm --filter @lynavo-drive/desktop test
```

Expected: pass.

- [ ] **Step 5: Run mobile checks**

Run:

```bash
pnpm --filter @lynavo-drive/mobile exec tsc --noEmit
pnpm --filter @lynavo-drive/mobile test
```

Expected: pass.

- [ ] **Step 6: Run root build if feasible**

Run:

```bash
pnpm build
```

Expected: pass. If this is too slow or blocked by local signing/native environment, record exact failure and the narrower successful commands.

- [ ] **Step 7: Self-review against AGENTS.md**

Prepare final review notes covering:

- direct modules changed
- call chains changed
- user-visible behavior
- affected platforms
- pollution check for DTO/protocol, persistence, queue semantics, sync state machine, permissions/subscription gates, history statistics
- verification commands and results

- [ ] **Step 8: Final commit if verification fixes were needed**

If fixes were made:

```bash
git add <changed files>
git commit -m "fix: stabilize desktop-local product expansion"
```

Expected: no uncommitted implementation changes remain except user-owned unrelated changes.
