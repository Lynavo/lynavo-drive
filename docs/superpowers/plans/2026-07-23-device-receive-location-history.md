# Device Receive Location History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users open every persisted receive folder used by a selected mobile device while keeping the one-click path for exactly one available folder.

**Architecture:** The Go sidecar owns a per-`clientId` receive-location index. It backfills that index from completed upload paths once, records future locations at upload completion, and exposes a local authenticated read-only endpoint. Electron forwards the endpoint through main/preload, and the Sync Records renderer opens a sole available location directly or presents an accessible location dialog.

**Tech Stack:** TypeScript, `@lynavo-drive/contracts`, Go `net/http`/SQLite/`filepath`, Electron IPC/contextBridge, React 18, Radix UI, lucide-react, Vitest/Testing Library, Go testing.

---

## File Map

- `packages/contracts/src/types.ts`: define `DeviceReceiveLocationDTO`.
- `packages/contracts/src/__tests__/exports.test.ts`: prove the DTO is part of the public contracts export.
- `services/sidecar-go/internal/store/migrations/007_device_receive_locations.sql`: create the location index and one-time backfill marker.
- `services/sidecar-go/internal/store/db.go`: embed and apply migration 007.
- `services/sidecar-go/internal/store/models.go`: define stored location and completed-upload location records.
- `services/sidecar-go/internal/store/uploads.go`: add completed-location lookup and absolute-path preservation before receive-root changes.
- `services/sidecar-go/internal/store/uploads_completed.go`: add location-index read, backfill, and recording methods.
- `services/sidecar-go/internal/store/uploads_test.go`: cover location persistence and absolute-path conversion.
- `services/sidecar-go/internal/api/handlers_receive_locations.go`: derive, classify, sort, backfill, and render locations.
- `services/sidecar-go/internal/api/handlers_receive_locations_test.go`: cover derivation, endpoint authorization, backfill persistence, and path safety.
- `services/sidecar-go/internal/api/handlers_settings.go`: absolutize completed relative paths before committing a receive-root change.
- `services/sidecar-go/internal/api/router.go`: register the authenticated location endpoint.
- `services/sidecar-go/internal/api/router_test.go`: prove root changes preserve online and offline historical upload paths.
- `services/sidecar-go/internal/server/handler_file.go`: record the device folder after a successful upload-store completion.
- `services/sidecar-go/internal/server/device_dir.go`: keep historical `receiveDirName` reuse compatible with absolute completed paths.
- `services/sidecar-go/internal/server/device_dir_test.go`: cover historical folder reuse from an absolute path below the current root.
- `apps/desktop/src/main/sidecar-client.ts`: call the URL-encoded receive-location endpoint.
- `apps/desktop/src/main/ipc-handlers.ts`: register the receive-location IPC channel and handler.
- `apps/desktop/src/preload/index.ts`: expose the new renderer bridge method.
- `apps/desktop/src/preload/api.d.ts`: type the bridge method with the shared DTO.
- `apps/desktop/src/main/__tests__/sidecar-client.test.ts`: verify URL encoding and response forwarding.
- `apps/desktop/src/main/__tests__/ipc-handlers.test.ts`: verify IPC forwarding.
- `apps/desktop/src/preload/__tests__/index.test.ts`: verify contextBridge exposure.
- `apps/desktop/src/renderer/hooks/use-electron-api.ts`: keep browser/test fallback API shape compatible.
- `apps/desktop/src/renderer/features/library/DeviceReceiveLocationDialog.tsx`: render current, historical, unavailable, open, and copy rows.
- `apps/desktop/src/renderer/features/library/ReceivedLibraryPage.tsx`: query locations and own direct-open/dialog/error state.
- `apps/desktop/src/renderer/features/library/__tests__/ReceivedLibraryPage.test.tsx`: cover all location-opening interactions.
- `apps/desktop/src/renderer/i18n/locales/{en,zh-Hans,zh-Hant}/directory.json`: add localized dialog labels and errors.

## Task 1: Shared Contract

**Files:**

- Modify: `packages/contracts/src/types.ts`
- Modify: `packages/contracts/src/__tests__/exports.test.ts`

- [ ] **Step 1: Add the failing export assertion**

Import `DeviceReceiveLocationDTO` in `exports.test.ts`, include it in the type-export assertion helper, and instantiate the exact public shape:

```ts
const location: DeviceReceiveLocationDTO = {
  path: '/Volumes/Archive/received/My iPhone',
  available: true,
  isCurrent: false,
  lastUsedAt: '2026-07-20T08:30:00Z',
};
expect(location.path).toContain('/received/');
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `pnpm --filter @lynavo-drive/contracts exec vitest run src/__tests__/exports.test.ts`

Expected: FAIL because `DeviceReceiveLocationDTO` is not exported.

- [ ] **Step 3: Add the DTO next to the other desktop/library DTOs**

Add exactly:

```ts
export interface DeviceReceiveLocationDTO {
  path: string;
  available: boolean;
  isCurrent: boolean;
  lastUsedAt: string;
}
```

- [ ] **Step 4: Verify and build the contracts package**

Run: `pnpm --filter @lynavo-drive/contracts exec vitest run src/__tests__/exports.test.ts && pnpm --filter @lynavo-drive/contracts build`

Expected: the export test passes and `dist` is regenerated.

- [ ] **Step 5: Commit the contract**

```bash
git add packages/contracts/src/types.ts packages/contracts/src/__tests__/exports.test.ts
git commit -m "feat(contracts): add device receive location DTO"
```

## Task 2: Sidecar Location Persistence And Root-Switch Preservation

**Files:**

- Create: `services/sidecar-go/internal/store/migrations/007_device_receive_locations.sql`
- Modify: `services/sidecar-go/internal/store/db.go`
- Modify: `services/sidecar-go/internal/store/models.go`
- Modify: `services/sidecar-go/internal/store/uploads.go`
- Modify: `services/sidecar-go/internal/store/uploads_completed.go`
- Modify: `services/sidecar-go/internal/store/uploads_test.go`
- Modify: `services/sidecar-go/internal/api/handlers_settings.go`
- Modify: `services/sidecar-go/internal/api/router_test.go`
- Modify: `services/sidecar-go/internal/server/handler_file.go`
- Modify: `services/sidecar-go/internal/server/device_dir.go`
- Modify: `services/sidecar-go/internal/server/device_dir_test.go`

- [ ] **Step 1: Write failing store tests for migration and index persistence**

In `uploads_test.go`, use `newTestStore(t)` and assert:

```go
func TestDeviceReceiveLocationPersistence(t *testing.T) {
	store := newTestStore(t)
	if err := store.CacheDeviceReceiveLocations("client-1", []DeviceReceiveLocation{{
		Path: "/old/received/Phone", LastUsedAt: "2026-07-18T10:00:00Z",
	}}); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordDeviceReceiveLocation("client-1", "/old/received/Phone", "2026-07-19T10:00:00Z"); err != nil {
		t.Fatal(err)
	}
	locations, backfilled, err := store.ListDeviceReceiveLocations("client-1")
	if err != nil || !backfilled || len(locations) != 1 || locations[0].LastUsedAt != "2026-07-19T10:00:00Z" {
		t.Fatalf("locations=%#v backfilled=%v err=%v", locations, backfilled, err)
	}
}
```

Add a second test that inserts a completed upload with `final_path = "Phone/2026-07-18/photo.jpg"`, calls `AbsolutizeCompletedUploadFinalPaths(receiveDir, true)`, and asserts the stored path becomes `filepath.Join(receiveDir, "Phone/2026-07-18/photo.jpg")`; already-absolute paths must remain unchanged.

- [ ] **Step 2: Run the store tests and confirm RED**

Run: `cd services/sidecar-go && go test ./internal/store -run 'DeviceReceiveLocation|AbsolutizeCompleted' -count=1`

Expected: FAIL because migration 007 and the store methods do not exist.

- [ ] **Step 3: Add migration 007 and embedded execution**

Create `007_device_receive_locations.sql` with the completed-upload index plus these tables:

```sql
CREATE INDEX IF NOT EXISTS uploads_client_status_completed_idx
ON uploads (client_id, status);

CREATE TABLE IF NOT EXISTS device_receive_locations (
  client_id TEXT NOT NULL,
  path TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  PRIMARY KEY (client_id, path)
);

CREATE TABLE IF NOT EXISTS device_receive_location_backfills (
  client_id TEXT PRIMARY KEY
);
```

Embed it in `db.go` as `migration007SQL` and execute it after migration 006, returning an error if migration 007 fails.

- [ ] **Step 4: Add storage models and index operations**

Add:

```go
type DeviceReceiveLocation struct {
	Path       string
	LastUsedAt string
}

type CompletedUploadLocation struct {
	FinalPath   *string
	CompletedAt *string
	UpdatedAt   string
}
```

Implement `ListDeviceReceiveLocations(clientID) ([]DeviceReceiveLocation, bool, error)`, `CacheDeviceReceiveLocations(clientID, locations) error`, `RecordDeviceReceiveLocation(clientID, path, lastUsedAt) error`, and `ListCompletedUploadLocationsByDevice(clientID) ([]CompletedUploadLocation, error)`. The cache method must insert/update paths in one transaction and mark the backfill only after all entries are written. The record method must update `last_used_at` on conflict.

- [ ] **Step 5: Preserve completed paths before settings changes**

Add `AbsolutizeCompletedUploadFinalPaths(receiveDir string, preserveUnavailablePaths bool) error` in `uploads.go`. Query only completed rows with non-empty `final_path`; for each relative path, resolve it under `receiveDir` and update it only when either the resolved path exists or `preserveUnavailablePaths` is true. Keep absolute paths unchanged. Call this method in `handleUpdateSettings` after transfer-active validation and before `UpdateShareConfig`, using the currently configured receive root and preserving unavailable paths when the persisted receive root matches the current configuration.

Update `ListCompletedUploadRootDirs` to accept `receiveDir`. Relative paths keep their existing first-segment behavior; absolute paths are accepted only when `filepath.Rel(receiveDir, finalPath)` remains below the current root. Update `historicalUploadDirName` to pass `receiveDir`, and add a device-dir test proving a paired device reuses its historical folder when a completed upload now stores an absolute path below the current root.

Add API tests in `router_test.go` for changing `rootPath`: one with an existing old file and one with the old receive volume unavailable but persisted as `ShareConfig.ReceiveRoot`. Both must assert the completed upload keeps an absolute path below the old receive root after the settings update. A mismatched/untrusted previous root must not freeze a broken relative path.

- [ ] **Step 6: Record the device folder after upload completion**

In `handler_file.go`, keep the existing `CompleteUpload` call and, only when it succeeds, call:

```go
absoluteFinalPath := filepath.Join(c.config.ReceiveDir, relativePath)
if err := c.store.RecordDeviceReceiveLocation(
	c.clientID,
	filepath.Dir(filepath.Dir(absoluteFinalPath)),
	time.Now().UTC().Format(time.RFC3339),
); err != nil {
	slog.Warn("failed to record device receive location", "fileKey", req.FileKey, "err", err)
}
```

The index failure is non-fatal to the completed upload. Use the same path layout already used by the file writer and keep the existing completion response unchanged.

- [ ] **Step 7: Run store tests and commit persistence**

Run: `cd services/sidecar-go && gofmt -w internal/store/db.go internal/store/models.go internal/store/uploads.go internal/store/uploads_completed.go internal/store/uploads_test.go internal/api/handlers_settings.go internal/api/router_test.go internal/server/handler_file.go internal/server/device_dir.go internal/server/device_dir_test.go && go test ./internal/store ./internal/server ./internal/api -count=1`

Expected: all selected Go tests pass.

```bash
git add services/sidecar-go/internal/store/migrations/007_device_receive_locations.sql services/sidecar-go/internal/store/db.go services/sidecar-go/internal/store/models.go services/sidecar-go/internal/store/uploads.go services/sidecar-go/internal/store/uploads_completed.go services/sidecar-go/internal/store/uploads_test.go services/sidecar-go/internal/api/handlers_settings.go services/sidecar-go/internal/api/router_test.go services/sidecar-go/internal/server/handler_file.go services/sidecar-go/internal/server/device_dir.go services/sidecar-go/internal/server/device_dir_test.go
git commit -m "feat(sidecar): persist device receive locations"
```

## Task 3: Sidecar Receive-Location API

**Files:**

- Create: `services/sidecar-go/internal/api/handlers_receive_locations.go`
- Create: `services/sidecar-go/internal/api/handlers_receive_locations_test.go`
- Modify: `services/sidecar-go/internal/api/router.go`

- [ ] **Step 1: Write failing derivation and endpoint tests**

Cover one client with two files in the current folder, an absolute historical folder, a missing folder, and invalid layouts. Assert current first, then newest historical, then missing; same folders de-duplicate using the newest `completed_at` or `updated_at`. Add tests that another client is excluded, unauthenticated requests return `401`, an empty client returns `[]`, and a second request still returns cached locations after deleting the source upload rows.

Use fixtures shaped like:

```go
uploads := []store.CompletedUploadLocation{
	{FinalPath: stringPtr(filepath.Join("Current Phone", "2026-07-19", "new.jpg")), CompletedAt: stringPtr("2026-07-19T09:00:00Z"), UpdatedAt: "2026-07-19T09:01:00Z"},
	{FinalPath: stringPtr(filepath.Join(oldRoot, "Historical Phone", "2026-07-18", "old.jpg")), CompletedAt: stringPtr("2026-07-18T09:00:00Z"), UpdatedAt: "2026-07-18T09:01:00Z"},
	{FinalPath: stringPtr(filepath.Join(missingRoot, "Missing Phone", "2026-07-17", "missing.jpg")), CompletedAt: stringPtr("2026-07-17T09:00:00Z"), UpdatedAt: "2026-07-17T09:00:00Z"},
}
```

- [ ] **Step 2: Run the API tests and confirm RED**

Run: `cd services/sidecar-go && go test ./internal/api -run 'ReceiveLocations' -count=1`

Expected: FAIL because the handler and derivation functions do not exist.

- [ ] **Step 3: Implement safe derivation and rendering**

Define the private JSON shape:

```go
type deviceReceiveLocation struct {
	Path       string `json:"path"`
	Available  bool   `json:"available"`
	IsCurrent  bool   `json:"isCurrent"`
	LastUsedAt string `json:"lastUsedAt"`
}
```

Implement `deriveDeviceReceiveLocations(receiveDir string, uploads []store.CompletedUploadLocation) []deviceReceiveLocation` using `uploadfs.ResolveFinalPath`, accepting only `<device>/<YYYY-MM-DD>/<file>`, rejecting traversal and root-level paths, deriving the device directory two parents above the file, and using `filepath.Clean`. Use `COALESCE(completed_at, updated_at)` semantics, `os.Stat` directory checks, `filepath.Rel` containment checks, Windows case-insensitive keys, and stable sorting by current status, latest time, and path.

Implement `renderDeviceReceiveLocations(receiveDir string, stored []store.DeviceReceiveLocation)` with the same availability/current/sorting rules and skip invalid RFC 3339 timestamps.

- [ ] **Step 4: Implement one-time backfill in the handler**

`handleDeviceReceiveLocations` must first call `ListDeviceReceiveLocations`. If the client is already marked backfilled, render only stored entries. Otherwise list completed upload locations, derive them, cache their paths/timestamps, and return the derived response. A cache failure is logged but does not hide a successful derived response.

- [ ] **Step 5: Register the authenticated route**

Add next to the existing device routes:

```go
mux.HandleFunc("GET /devices/{deviceId}/receive-locations", withJSON(requireLocalRequest(srv.handleDeviceReceiveLocations)))
```

Use the existing local-control authentication wrapper used by `/devices/{deviceId}` and `/devices/{deviceId}/files`; do not create a second authentication mechanism.

- [ ] **Step 6: Verify and commit the API**

Run: `cd services/sidecar-go && gofmt -w internal/api/handlers_receive_locations.go internal/api/handlers_receive_locations_test.go internal/api/router.go && go test ./internal/api ./internal/store ./internal/uploadfs -count=1`

Expected: all selected API, store, and path-resolution tests pass.

```bash
git add services/sidecar-go/internal/api/handlers_receive_locations.go services/sidecar-go/internal/api/handlers_receive_locations_test.go services/sidecar-go/internal/api/router.go
git commit -m "feat(sidecar): expose device receive locations"
```

## Task 4: Electron Main/Preload Bridge

**Files:**

- Modify: `apps/desktop/src/main/sidecar-client.ts`
- Modify: `apps/desktop/src/main/ipc-handlers.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/preload/api.d.ts`
- Modify: `apps/desktop/src/renderer/hooks/use-electron-api.ts`
- Modify: `apps/desktop/src/main/__tests__/sidecar-client.test.ts`
- Modify: `apps/desktop/src/main/__tests__/ipc-handlers.test.ts`
- Modify: `apps/desktop/src/preload/__tests__/index.test.ts`

- [ ] **Step 1: Write failing bridge tests**

Assert that `getDeviceReceiveLocations('phone/a b')` requests `/devices/phone%2Fa%20b/receive-locations`, that the IPC handler forwards `client-1` to the sidecar client, and that the preload method invokes `sidecar:device-receive-locations` with the same argument.

- [ ] **Step 2: Run bridge tests and confirm RED**

Run: `pnpm --filter @lynavo-drive/desktop exec vitest run src/main/__tests__/sidecar-client.test.ts src/main/__tests__/ipc-handlers.test.ts src/preload/__tests__/index.test.ts`

Expected: FAIL because the method and IPC channel do not exist.

- [ ] **Step 3: Add typed client and IPC channel**

Import `DeviceReceiveLocationDTO` and add:

```ts
getDeviceReceiveLocations(clientId: string): Promise<DeviceReceiveLocationDTO[]> {
  return request<DeviceReceiveLocationDTO[]>(
    'GET',
    `/devices/${encodeURIComponent(clientId)}/receive-locations`,
  );
}
```

Add `SIDECAR_DEVICE_RECEIVE_LOCATIONS: 'sidecar:device-receive-locations'` to the shared IPC constant, register `ipcMain.handle` to call the sidecar client, expose `getDeviceReceiveLocations` from `contextBridge`, and declare it in `api.d.ts`. The `use-electron-api.ts` fallback returns `[]`.

- [ ] **Step 4: Verify and commit the bridge**

Run: `pnpm --filter @lynavo-drive/desktop exec vitest run src/main/__tests__/sidecar-client.test.ts src/main/__tests__/ipc-handlers.test.ts src/preload/__tests__/index.test.ts && pnpm --filter @lynavo-drive/desktop typecheck`

Expected: focused bridge tests and both desktop TypeScript projects pass.

```bash
git add apps/desktop/src/main/sidecar-client.ts apps/desktop/src/main/ipc-handlers.ts apps/desktop/src/preload/index.ts apps/desktop/src/preload/api.d.ts apps/desktop/src/renderer/hooks/use-electron-api.ts apps/desktop/src/main/__tests__/sidecar-client.test.ts apps/desktop/src/main/__tests__/ipc-handlers.test.ts apps/desktop/src/preload/__tests__/index.test.ts
git commit -m "feat(desktop): bridge device receive locations"
```

## Task 5: Renderer Location Dialog And Interaction

**Files:**

- Create: `apps/desktop/src/renderer/features/library/DeviceReceiveLocationDialog.tsx`
- Modify: `apps/desktop/src/renderer/features/library/ReceivedLibraryPage.tsx`
- Modify: `apps/desktop/src/renderer/features/library/__tests__/ReceivedLibraryPage.test.tsx`
- Modify: `apps/desktop/src/renderer/i18n/locales/en/directory.json`
- Modify: `apps/desktop/src/renderer/i18n/locales/zh-Hans/directory.json`
- Modify: `apps/desktop/src/renderer/i18n/locales/zh-Hant/directory.json`

- [ ] **Step 1: Add failing UI tests**

Extend the existing `ReceivedLibraryPage` fixture so `getDeviceReceiveLocations` can resolve per test. Cover:

```tsx
it('opens the only available location directly', async () => {
  mockLocations([
    {
      path: '/current/Phone',
      available: true,
      isCurrent: true,
      lastUsedAt: '2026-07-20T00:00:00Z',
    },
  ]);
  render(<ReceivedLibraryPage />);
  fireEvent.click(await screen.findByTitle('Open folder'));
  await waitFor(() =>
    expect(window.electronAPI.files.openFolder).toHaveBeenCalledWith('/current/Phone'),
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
```

Also test multiple locations render in current-first order with the device name, a single unavailable location still renders the dialog, unavailable rows cannot call `openFolder` but can copy their exact path, an empty result shows the no-location toast, query rejection shows the query error, and open rejection keeps the dialog visible while marking the row unavailable.

- [ ] **Step 2: Run the renderer test and confirm RED**

Run: `pnpm --filter @lynavo-drive/desktop exec vitest run src/renderer/features/library/__tests__/ReceivedLibraryPage.test.tsx`

Expected: FAIL because the page still opens `device.devicePath` directly and no location dialog exists.

- [ ] **Step 3: Create `DeviceReceiveLocationDialog`**

Use existing Radix `Dialog` components and lucide `FolderOpen`, `Copy`, and `X` icons. Props are `open`, `deviceName`, `locations`, `returnFocusElement`, `onOpenChange`, and `onOpenLocation`. Render one row per location; available rows invoke `onOpenLocation`, unavailable rows are non-interactive, and every row has an icon-only copy button calling the existing preload clipboard API. Use `title={location.path}` for full-path hover access, `truncate` for long paths, localized status text, and a scrollable list body. Preserve dialog focus restoration through `onCloseAutoFocus`.

- [ ] **Step 4: Replace direct device-path opening**

In `ReceivedLibraryPage`, the folder button must request locations by the device's `clientId`. State must include the selected device name, selected locations, invoking button element, dialog-open state, and the set of paths that failed to open in the current dialog. Apply this exact branch:

```ts
if (locations.length === 0) {
  toast.error(t('directory.library.toasts.noReceiveLocations'));
} else if (locations.length === 1 && locations[0].available) {
  await openFolder(locations[0].path);
} else {
  setLocationDialogState({ deviceName, locations, returnFocusElement: event.currentTarget });
}
```

Opening a dialog row calls the file bridge with that row's path, closes only after success, and on rejection updates that row to `available: false` and shows the localized missing-path toast. Never fall back to `devicePath` or the receive root.

- [ ] **Step 5: Add all locale keys**

Under `directory.library`, add equivalent keys in all three locale files for `locationDialog.title`, `locationDialog.current`, `locationDialog.history`, `locationDialog.unavailable`, `locationDialog.copyPath`, `locationDialog.close`, `toasts.noReceiveLocations`, and `toasts.receiveLocationsUnavailable`. Taiwan Traditional Chinese values must use `同步資料夾`, `目前位置`, `歷史位置`, `目前無法存取`, and `找不到可用的同步目錄`.

- [ ] **Step 6: Verify the renderer and commit**

Run: `pnpm --filter @lynavo-drive/desktop exec vitest run src/renderer/features/library/__tests__/ReceivedLibraryPage.test.tsx src/renderer/i18n/__tests__/resources.test.ts && pnpm --filter @lynavo-drive/desktop typecheck && pnpm --filter @lynavo-drive/desktop build`

Expected: all focused UI/i18n tests, desktop type checks, and Electron build pass.

```bash
git add apps/desktop/src/renderer/features/library/DeviceReceiveLocationDialog.tsx apps/desktop/src/renderer/features/library/ReceivedLibraryPage.tsx apps/desktop/src/renderer/features/library/__tests__/ReceivedLibraryPage.test.tsx apps/desktop/src/renderer/i18n/locales/en/directory.json apps/desktop/src/renderer/i18n/locales/zh-Hans/directory.json apps/desktop/src/renderer/i18n/locales/zh-Hant/directory.json
git commit -m "feat(desktop): select historical receive folders"
```

## Task 6: Integration Validation And Self-Review

**Files:** Review every file changed by Tasks 1-5; no new feature files are introduced in this task.

- [ ] **Step 1: Build shared packages before desktop checks**

Run: `pnpm build`

Expected: contracts and design-tokens build successfully.

- [ ] **Step 2: Run directly affected suites**

Run: `pnpm --filter @lynavo-drive/contracts test && pnpm --filter @lynavo-drive/desktop test && (cd services/sidecar-go && go test ./...)`

Expected: all contracts, desktop, and sidecar tests pass.

- [ ] **Step 3: Run static and formatting checks**

Run: `pnpm --filter @lynavo-drive/contracts typecheck && pnpm --filter @lynavo-drive/desktop typecheck && pnpm format:check && git diff --check`

Expected: no type, formatting, or whitespace errors.

- [ ] **Step 4: Review contamination boundaries**

Confirm the call chain is renderer -> preload -> main -> sidecar; the endpoint only reads and indexes completed uploads for the requested `clientId`; root-switch preservation happens before settings commit; index-write failures do not fail uploads; unavailable paths remain visible and copyable; no mobile queue, sync state machine, file-selection path, statistics, entitlement, account gate, or `receiveDirName` logic changed.

- [ ] **Step 5: Inspect the final diff and branch state**

Run: `git diff main...HEAD --stat && git status --short --branch`

Expected: only the approved design/plan documents and feature files are present, with no generated build output or unrelated user changes.
