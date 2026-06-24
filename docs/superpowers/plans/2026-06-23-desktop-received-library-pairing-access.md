# Desktop Received Library Pairing Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `received/` storage device-bucketed by stable mobile device identity while allowing paired phones to browse this desktop's full received library when the desktop setting permits it.

**Architecture:** Keep LAN pairing/session identity as mobile `clientId`, but use mobile `stableDeviceId` for physical-device receive buckets and restricted received-library scope. Add a desktop-wide `allowCrossDeviceReceivedAccess` setting that defaults to `true`: when enabled, any paired phone can list, preview, stream, and download the whole desktop received library; when disabled, a paired phone can only access uploads from the same `stableDeviceId`, falling back to current `clientId` when a stable ID is missing. This project is still in development, so no compatibility migration is required.

**Tech Stack:** TypeScript contracts, Electron desktop renderer/preload/main settings bridge, Go sidecar HTTP API with SQLite store, React Native mobile local desktop service tests, Vitest, Go `testing`.

---

## Product Decisions

- `clientId` remains the LAN protocol, pairing, upload, `fileKey`, and resource access audit identity.
- `stableDeviceId` is the physical mobile-device grouping key for `received/<device-folder>/`.
- Device display name is metadata only. It must not decide whether a new `received/` bucket is created after a stable ID is known.
- Mobile app device name should describe the physical mobile device, not the account session.
- Desktop "device list" can continue showing connection/client rows, but any future physical-device grouping should be explicit and backed by `stableDeviceId`.
- `手機同步空間` uses server authorization. The mobile app does not locally decide whether cross-device received files are visible.
- `remoteAccessEnabled` remains unrelated to LAN received-library access unless a later feature explicitly links them.

## File Structure

- Modify `packages/contracts/src/types.ts`
  - Add `SettingsDTO.allowCrossDeviceReceivedAccess?: boolean`.
- Modify `packages/contracts/src/__tests__/exports.test.ts`
  - Add a fixture assertion so the exported settings shape includes the new optional flag.
- Modify `services/sidecar-go/internal/api/handlers_settings.go`
  - Add the setting to sidecar settings DTOs, update request parsing, persisted setting key, default value, and GET/PUT behavior.
- Modify `services/sidecar-go/internal/api/router_test.go`
  - Cover GET default `true`, PUT `false`, then GET `false`.
- Modify `services/sidecar-go/internal/server/device_dir.go`
  - Correct the previous wrong implementation in this worktree: same `stableDeviceId` must reuse the existing receive directory even if account/client/device display name changes.
- Modify `services/sidecar-go/internal/server/device_dir_test.go`
  - Replace wrong tests that expect a new folder for the same stable device with tests that expect stable-device reuse.
- Modify `services/sidecar-go/internal/store/received_library.go`
  - Add stable-device-scoped list/page methods.
  - Keep existing global and client-scoped methods for desktop UI and explicit diagnostics.
- Modify `services/sidecar-go/internal/store/received_library_test.go`
  - Cover same-stable multi-client visibility, different-stable exclusion, missing-stable fallback to current client, and device stats.
- Modify `services/sidecar-go/internal/api/handlers_resources.go`
  - Add a received-library access policy helper.
  - Apply the policy consistently to mobile list, preview, thumbnail, stream, and download endpoints.
- Modify `services/sidecar-go/internal/api/resources_handlers_test.go`
  - Cover cross-device enabled and disabled access for list and file endpoints.
- Modify `apps/desktop/src/renderer/stores/settings-store.ts`
  - Add default setting value and update handling.
- Modify `apps/desktop/src/renderer/mocks/settings.ts`
  - Add mock setting value.
- Modify `apps/desktop/src/renderer/features/settings/SettingsPage.tsx`
  - Add a desktop switch for cross-device received-library access.
- Modify or create settings page tests under `apps/desktop/src/renderer/features/settings/__tests__/`.
  - Cover rendering and toggling the new switch.
- Modify `apps/mobile/src/services/__tests__/desktop-local-service.test.ts`
  - Keep global received-library mobile requests unscoped and ensure returned preview/download URLs are passed through.

---

### Task 1: Add Contracts Setting Shape

**Files:**
- Modify: `packages/contracts/src/types.ts`
- Modify: `packages/contracts/src/__tests__/exports.test.ts`

- [ ] **Step 1: Write the failing contracts fixture**

Add this assertion to the existing settings DTO export/type fixture test in `packages/contracts/src/__tests__/exports.test.ts`. If the file uses a different test name, keep its existing structure and add the fixture inside the contracts exports suite.

```ts
const settings: SettingsDTO = {
  deviceName: 'Office Mac',
  connectionCode: '123456',
  rootPath: '/Users/alice/ViviDrop',
  receivePath: '/Users/alice/ViviDrop/received',
  personalPath: '/Users/alice',
  sharedPath: '/Users/alice/ViviDrop/shared',
  shareAddress: '',
  shareStatus: 'disabled',
  shareName: 'Office Mac',
  remoteAccessEnabled: true,
  allowCrossDeviceReceivedAccess: true,
};

expect(settings.allowCrossDeviceReceivedAccess).toBe(true);
```

- [ ] **Step 2: Run the contracts test and verify the type failure**

Run:

```bash
pnpm --filter @syncflow/contracts test -- exports
```

Expected before implementation:

```text
Object literal may only specify known properties, and 'allowCrossDeviceReceivedAccess' does not exist in type 'SettingsDTO'.
```

- [ ] **Step 3: Add the optional field to `SettingsDTO`**

In `packages/contracts/src/types.ts`, update `SettingsDTO`:

```ts
export interface SettingsDTO {
  deviceName: string;
  connectionCode: string;
  rootPath: string;
  receivePath: string;
  personalPath: string;
  personalPathMode?: 'path' | 'windowsDrives';
  sharedPath: string;
  shareAddress: string;
  shareStatus: ShareStatus;
  shareName: string;
  remoteAccessEnabled?: boolean;
  allowCrossDeviceReceivedAccess?: boolean;
}
```

- [ ] **Step 4: Run the contracts test**

Run:

```bash
pnpm --filter @syncflow/contracts test -- exports
```

Expected:

```text
PASS
```

- [ ] **Step 5: Build contracts**

Run:

```bash
pnpm --filter @syncflow/contracts build
```

Expected:

```text
@syncflow/contracts build succeeds
```

- [ ] **Step 6: Commit contracts changes**

Run:

```bash
git add packages/contracts/src/types.ts packages/contracts/src/__tests__/exports.test.ts
git commit -m "feat: add received access setting contract"
```

---

### Task 2: Add Sidecar Settings API Support

**Files:**
- Modify: `services/sidecar-go/internal/api/handlers_settings.go`
- Modify: `services/sidecar-go/internal/api/router_test.go`

- [ ] **Step 1: Add failing router tests**

In `services/sidecar-go/internal/api/router_test.go`, add tests that follow the existing settings test helper patterns. Use the existing router/server test setup helpers in the file.

```go
func TestSettingsIncludeCrossDeviceReceivedAccessDefault(t *testing.T) {
	st, cfg, hub := testEnv(t)
	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/settings")
	if err != nil {
		t.Fatalf("GET /settings: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected status 200, got %d", resp.StatusCode)
	}
	var body struct {
		AllowCrossDeviceReceivedAccess bool `json:"allowCrossDeviceReceivedAccess"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode settings: %v", err)
	}
	if !body.AllowCrossDeviceReceivedAccess {
		t.Fatalf("expected allowCrossDeviceReceivedAccess to default true")
	}
}

func TestUpdateSettingsPersistsCrossDeviceReceivedAccess(t *testing.T) {
	st, cfg, hub := testEnv(t)
	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	defer srv.Close()

	req, err := http.NewRequest(
		http.MethodPut,
		srv.URL+"/settings",
		strings.NewReader(`{"allowCrossDeviceReceivedAccess":false}`),
	)
	if err != nil {
		t.Fatalf("NewRequest PUT /settings: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("PUT /settings: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected update status 200, got %d", resp.StatusCode)
	}
	var updateBody struct {
		AllowCrossDeviceReceivedAccess bool `json:"allowCrossDeviceReceivedAccess"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&updateBody); err != nil {
		t.Fatalf("decode update settings: %v", err)
	}
	if updateBody.AllowCrossDeviceReceivedAccess {
		t.Fatalf("expected update response to return false")
	}

	getResp, err := http.Get(srv.URL + "/settings")
	if err != nil {
		t.Fatalf("GET /settings after update: %v", err)
	}
	defer getResp.Body.Close()
	if getResp.StatusCode != http.StatusOK {
		t.Fatalf("expected get status 200, got %d", getResp.StatusCode)
	}
	var getBody struct {
		AllowCrossDeviceReceivedAccess bool `json:"allowCrossDeviceReceivedAccess"`
	}
	if err := json.NewDecoder(getResp.Body).Decode(&getBody); err != nil {
		t.Fatalf("decode get settings: %v", err)
	}
	if getBody.AllowCrossDeviceReceivedAccess {
		t.Fatalf("expected persisted allowCrossDeviceReceivedAccess false")
	}
}
```

- [ ] **Step 2: Run the settings tests and verify failure**

Run:

```bash
cd services/sidecar-go
go test ./internal/api -run 'Test(SettingsIncludeCrossDeviceReceivedAccessDefault|UpdateSettingsPersistsCrossDeviceReceivedAccess)$' -count=1
```

Expected before implementation:

```text
FAIL
expected allowCrossDeviceReceivedAccess to default true
```

- [ ] **Step 3: Add DTO fields and setting key**

In `services/sidecar-go/internal/api/handlers_settings.go`, update the DTO structs and constants:

```go
type settingsDTO struct {
	DeviceName                     string `json:"deviceName"`
	ConnectionCode                 string `json:"connectionCode"`
	RootPath                       string `json:"rootPath"`
	ReceivePath                    string `json:"receivePath"`
	PersonalPath                   string `json:"personalPath"`
	PersonalMode                   string `json:"personalPathMode,omitempty"`
	SharedPath                     string `json:"sharedPath"`
	ShareAddress                   string `json:"shareAddress"`
	ShareStatus                    string `json:"shareStatus"`
	ShareName                      string `json:"shareName"`
	RemoteAccessEnabled            bool   `json:"remoteAccessEnabled"`
	AllowCrossDeviceReceivedAccess bool   `json:"allowCrossDeviceReceivedAccess"`
}

type updateSettingsRequest struct {
	DeviceName                     *string `json:"deviceName,omitempty"`
	RootPath                       *string `json:"rootPath,omitempty"`
	ReceivePath                    *string `json:"receivePath,omitempty"`
	PersonalPath                   *string `json:"personalPath,omitempty"`
	RemoteAccessEnabled            *bool   `json:"remoteAccessEnabled,omitempty"`
	AllowCrossDeviceReceivedAccess *bool   `json:"allowCrossDeviceReceivedAccess,omitempty"`
}

const personalShareRootSettingKey = "personal_share_root"
const remoteAccessEnabledSettingKey = "remote_access_enabled"
const allowCrossDeviceReceivedAccessSettingKey = "allow_cross_device_received_access"
```

- [ ] **Step 4: Persist updates**

In `handleUpdateSettings`, add this block after the existing `RemoteAccessEnabled` block:

```go
if req.AllowCrossDeviceReceivedAccess != nil {
	val := "false"
	if *req.AllowCrossDeviceReceivedAccess {
		val = "true"
	}
	if err := s.store.SetSetting(allowCrossDeviceReceivedAccessSettingKey, val); err != nil {
		slog.Error("update cross-device received access setting", "err", err)
		writeError(w, http.StatusInternalServerError, "failed to update settings")
		return
	}
	slog.Info("cross-device received access setting updated", "enabled", val)
}
```

- [ ] **Step 5: Read default `true` in assembled settings**

In `assembleSettingsDTO`, read the setting after `remoteAccessEnabled`:

```go
allowCrossDeviceReceivedAccess := true
if val, err := s.store.GetSetting(allowCrossDeviceReceivedAccessSettingKey); err == nil {
	allowCrossDeviceReceivedAccess = (val == "true")
} else if !errors.Is(err, sql.ErrNoRows) {
	return nil, err
}
```

Return it in the DTO:

```go
return &settingsDTO{
	DeviceName:                     deviceName,
	ConnectionCode:                 code,
	RootPath:                       pathConfig.RootDir(),
	ReceivePath:                    pathConfig.ReceiveDir,
	PersonalPath:                   pathConfig.PersonalDir(),
	PersonalMode:                   personalMode,
	SharedPath:                     pathConfig.SharedDir(),
	ShareAddress:                   shareConfig.ShareURL,
	ShareStatus:                    shareConfig.ShareStatus,
	ShareName:                      shareConfig.ShareName,
	RemoteAccessEnabled:            remoteAccessEnabled,
	AllowCrossDeviceReceivedAccess: allowCrossDeviceReceivedAccess,
}, nil
```

- [ ] **Step 6: Run sidecar settings tests**

Run:

```bash
cd services/sidecar-go
gofmt -w internal/api/handlers_settings.go internal/api/router_test.go
go test ./internal/api -run 'Test(SettingsIncludeCrossDeviceReceivedAccessDefault|UpdateSettingsPersistsCrossDeviceReceivedAccess)$' -count=1
```

Expected:

```text
ok  	github.com/nicksyncflow/sidecar/internal/api
```

- [ ] **Step 7: Commit settings API changes**

Run:

```bash
git add services/sidecar-go/internal/api/handlers_settings.go services/sidecar-go/internal/api/router_test.go
git commit -m "feat: persist cross-device received access setting"
```

---

### Task 3: Correct Stable Device Receive Folder Allocation

**Files:**
- Modify: `services/sidecar-go/internal/server/device_dir.go`
- Modify: `services/sidecar-go/internal/server/device_dir_test.go`

- [ ] **Step 1: Replace the wrong same-stable different-name test**

Remove the current wrong test named `TestPairDeviceWithDirName_CreatesNewReceiveDirForSameStableDeviceWithDifferentName` and replace it with:

```go
func TestPairDeviceWithDirName_ReusesReceiveDirForSameStableDeviceWithDifferentAccountAndName(t *testing.T) {
	st := newTestStoreForDir(t)
	receiveDir := t.TempDir()
	stableID := "stable-ios-device-001"

	mkDir(t, receiveDir, "Alice iPhone")
	oldDevice := newPairDevice("account-a-client", "Alice iPhone", nil)
	oldDevice.StableDeviceID = &stableID
	if err := st.UpsertPairedDevice(oldDevice); err != nil {
		t.Fatalf("UpsertPairedDevice old: %v", err)
	}
	if err := st.UpdateReceiveDirName("account-a-client", "Alice iPhone"); err != nil {
		t.Fatalf("UpdateReceiveDirName old: %v", err)
	}

	newDevice := newPairDevice("account-b-client", "Bob iPhone", nil)
	newDevice.StableDeviceID = &stableID
	got, err := PairDeviceWithDirName(st, receiveDir, newDevice)
	if err != nil {
		t.Fatalf("PairDeviceWithDirName: %v", err)
	}
	if got != "Alice iPhone" {
		t.Fatalf("expected same stable device to reuse receive dir %q, got %q", "Alice iPhone", got)
	}
	if _, err := os.Stat(filepath.Join(receiveDir, "Alice iPhone")); err != nil {
		t.Fatalf("receive dir should remain: %v", err)
	}
	if _, err := os.Stat(filepath.Join(receiveDir, "Bob iPhone")); !os.IsNotExist(err) {
		t.Fatalf("same stable device must not create Bob iPhone dir, stat err=%v", err)
	}

	stored, err := st.GetPairedDevice("account-b-client")
	if err != nil {
		t.Fatalf("GetPairedDevice new: %v", err)
	}
	if stored.ReceiveDirName == nil || *stored.ReceiveDirName != "Alice iPhone" {
		t.Fatalf("expected persisted reused receive_dir_name, got %v", stored.ReceiveDirName)
	}
}
```

- [ ] **Step 2: Add different-stable same-name uniqueness coverage**

Add this test near the receive-dir tests:

```go
func TestPairDeviceWithDirName_CreatesUniqueReceiveDirForDifferentStableDeviceWithSameName(t *testing.T) {
	st := newTestStoreForDir(t)
	receiveDir := t.TempDir()
	stableA := "stable-ios-device-001"
	stableB := "stable-ios-device-002"

	mkDir(t, receiveDir, "Alice iPhone")
	oldDevice := newPairDevice("client-a", "Alice iPhone", nil)
	oldDevice.StableDeviceID = &stableA
	if err := st.UpsertPairedDevice(oldDevice); err != nil {
		t.Fatalf("UpsertPairedDevice old: %v", err)
	}
	if err := st.UpdateReceiveDirName("client-a", "Alice iPhone"); err != nil {
		t.Fatalf("UpdateReceiveDirName old: %v", err)
	}

	newDevice := newPairDevice("client-b", "Alice iPhone", nil)
	newDevice.StableDeviceID = &stableB
	got, err := PairDeviceWithDirName(st, receiveDir, newDevice)
	if err != nil {
		t.Fatalf("PairDeviceWithDirName: %v", err)
	}
	if got != "Alice iPhone 2" {
		t.Fatalf("expected unique dir %q for different stable device, got %q", "Alice iPhone 2", got)
	}
}
```

- [ ] **Step 3: Run focused server tests and verify the current worktree fails**

Run:

```bash
cd services/sidecar-go
go test ./internal/server -run 'TestPairDeviceWithDirName_(ReusesReceiveDirForSameStableDeviceWithDifferentAccountAndName|CreatesUniqueReceiveDirForDifferentStableDeviceWithSameName)$' -count=1
```

Expected before implementation in this worktree:

```text
FAIL: TestPairDeviceWithDirName_ReusesReceiveDirForSameStableDeviceWithDifferentAccountAndName
expected same stable device to reuse receive dir "Alice iPhone", got "Bob iPhone"
```

- [ ] **Step 4: Remove preferred-name matching from stable reuse**

In `services/sidecar-go/internal/server/device_dir.go`, keep `preferredReceiveDirName` only for new unique name generation, then update `stableDeviceReceiveDirName` so it reuses the first valid same-stable persisted receive dir:

```go
func stableDeviceReceiveDirName(st *store.Store, receiveDir string, device *store.PairedDevice) (string, bool, error) {
	stableID := ""
	if device.StableDeviceID != nil {
		stableID = strings.TrimSpace(*device.StableDeviceID)
	}
	if stableID == "" {
		return "", false, nil
	}

	devices, err := st.ListPairedDevices()
	if err != nil {
		return "", false, fmt.Errorf("list paired devices for stable-device dir reuse: %w", err)
	}

	for _, candidate := range devices {
		if candidate.ClientID == device.ClientID || candidate.ReceiveDirName == nil || *candidate.ReceiveDirName == "" {
			continue
		}
		if candidate.StableDeviceID == nil || strings.TrimSpace(*candidate.StableDeviceID) != stableID {
			continue
		}
		dirName := *candidate.ReceiveDirName
		if !dirExists(receiveDir, dirName) {
			continue
		}
		if receiveDirReservedByDifferentStable(devices, dirName, device.ClientID, stableID) {
			continue
		}
		return dirName, true, nil
	}

	return "", false, nil
}
```

- [ ] **Step 5: Run sidecar server tests**

Run:

```bash
cd services/sidecar-go
gofmt -w internal/server/device_dir.go internal/server/device_dir_test.go
go test ./internal/server -count=1
```

Expected:

```text
ok  	github.com/nicksyncflow/sidecar/internal/server
```

- [ ] **Step 6: Commit receive-dir correction**

Run:

```bash
git add services/sidecar-go/internal/server/device_dir.go services/sidecar-go/internal/server/device_dir_test.go
git commit -m "fix: reuse receive folders by stable device"
```

---

### Task 4: Add Stable-Device Received Library Store Scope

**Files:**
- Modify: `services/sidecar-go/internal/store/received_library.go`
- Modify: `services/sidecar-go/internal/store/received_library_test.go`

- [ ] **Step 1: Add store tests for stable-device scoping**

In `services/sidecar-go/internal/store/received_library_test.go`, add tests using the existing store/upload fixture helpers in the file. The tests must create paired devices with `StableDeviceID` and completed uploads for each client.

Add these imports if they are not already present:

```go
import (
	"reflect"
	"strings"
)
```

```go
func TestListReceivedLibraryPageForStableDeviceIncludesSameStableClients(t *testing.T) {
	st := newTestStore(t)
	desktopID := "desktop-1"
	stableID := "stable-ios-device-001"
	otherStableID := "stable-ios-device-002"

	insertPairedDeviceForReceivedLibrary(t, st, "client-a", "Alice iPhone", stableID, "Alice iPhone")
	insertPairedDeviceForReceivedLibrary(t, st, "client-b", "Alice Work", stableID, "Alice iPhone")
	insertPairedDeviceForReceivedLibrary(t, st, "client-c", "Bob iPhone", otherStableID, "Bob iPhone")
	insertCompletedUploadForReceivedLibrary(t, st, "file-a", "client-a", "a.jpg", "Alice iPhone/a.jpg")
	insertCompletedUploadForReceivedLibrary(t, st, "file-b", "client-b", "b.jpg", "Alice iPhone/b.jpg")
	insertCompletedUploadForReceivedLibrary(t, st, "file-c", "client-c", "c.jpg", "Bob iPhone/c.jpg")

	page, err := st.ListReceivedLibraryPageForStableDeviceWithReceiveDir(desktopID, stableID, "client-a", 1, 30, "")
	if err != nil {
		t.Fatalf("ListReceivedLibraryPageForStableDeviceWithReceiveDir: %v", err)
	}

	got := receivedLibraryFileKeys(page.Items)
	want := []string{"file-b", "file-a"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("file keys mismatch\nwant=%v\n got=%v", want, got)
	}
	if page.TotalItems != 2 {
		t.Fatalf("expected total items 2, got %d", page.TotalItems)
	}
}

func TestListReceivedLibraryPageForStableDeviceFallsBackToClientWhenStableIDMissing(t *testing.T) {
	st := newTestStore(t)
	desktopID := "desktop-1"

	insertPairedDeviceForReceivedLibrary(t, st, "client-a", "Alice iPhone", "", "Alice iPhone")
	insertPairedDeviceForReceivedLibrary(t, st, "client-b", "Alice Work", "", "Alice Work")
	insertCompletedUploadForReceivedLibrary(t, st, "file-a", "client-a", "a.jpg", "Alice iPhone/a.jpg")
	insertCompletedUploadForReceivedLibrary(t, st, "file-b", "client-b", "b.jpg", "Alice Work/b.jpg")

	page, err := st.ListReceivedLibraryPageForStableDeviceWithReceiveDir(desktopID, "", "client-a", 1, 30, "")
	if err != nil {
		t.Fatalf("ListReceivedLibraryPageForStableDeviceWithReceiveDir: %v", err)
	}

	got := receivedLibraryFileKeys(page.Items)
	want := []string{"file-a"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("file keys mismatch\nwant=%v\n got=%v", want, got)
	}
	if page.TotalItems != 1 {
		t.Fatalf("expected total items 1, got %d", page.TotalItems)
	}
}
```

If the file does not already have helpers, add these local helpers:

```go
func insertPairedDeviceForReceivedLibrary(t *testing.T, s *Store, clientID string, clientName string, stableDeviceID string, receiveDirName string) {
	t.Helper()
	now := time.Now().UTC().Format(time.RFC3339)
	device := PairedDevice{
		ClientID:         clientID,
		ClientName:       clientName,
		Platform:         "ios",
		PairingID:        "pair-" + clientID,
		PairingTokenHash: "hash-" + clientID,
		CreatedAt:        now,
		LastSeenAt:       now,
	}
	if strings.TrimSpace(stableDeviceID) != "" {
		device.StableDeviceID = &stableDeviceID
	}
	if strings.TrimSpace(receiveDirName) != "" {
		device.ReceiveDirName = &receiveDirName
	}
	if err := s.UpsertPairedDevice(device); err != nil {
		t.Fatalf("UpsertPairedDevice %s: %v", clientID, err)
	}
}

func insertCompletedUploadForReceivedLibrary(t *testing.T, s *Store, fileKey string, clientID string, filename string, finalPath string) {
	t.Helper()
	now := time.Now().UTC().Format(time.RFC3339)
	upload := sampleUpload(fileKey, clientID)
	upload.OriginalFilename = filename
	upload.MediaType = "image/jpeg"
	upload.FileSize = 1024
	upload.Status = "completed"
	upload.FinalPath = &finalPath
	upload.CommittedBytes = 1024
	upload.CompletedAt = &now
	upload.UpdatedAt = now
	if err := s.UpsertUpload(upload); err != nil {
		t.Fatalf("UpsertUpload %s: %v", fileKey, err)
	}
}

func receivedLibraryFileKeys(items []ReceivedLibraryItem) []string {
	keys := make([]string, 0, len(items))
	for _, item := range items {
		keys = append(keys, item.FileKey)
	}
	return keys
}
```

- [ ] **Step 2: Run store tests and verify missing method failure**

Run:

```bash
cd services/sidecar-go
go test ./internal/store -run 'TestListReceivedLibraryPageForStableDevice' -count=1
```

Expected before implementation:

```text
st.ListReceivedLibraryPageForStableDeviceWithReceiveDir undefined
```

- [ ] **Step 3: Add stable-device scope type**

In `services/sidecar-go/internal/store/received_library.go`, replace the private `clientID *string` plumbing with a private scope struct:

```go
type receivedLibraryScope struct {
	ClientID         *string
	StableDeviceID   *string
	FallbackClientID string
}
```

- [ ] **Step 4: Add public stable-device list methods**

Add these methods near the existing client-scoped methods:

```go
func (s *Store) ListReceivedLibraryForStableDeviceWithReceiveDir(desktopDeviceID string, stableDeviceID string, fallbackClientID string, receiveDir string) ([]ReceivedLibraryItem, error) {
	stableDeviceID = strings.TrimSpace(stableDeviceID)
	fallbackClientID = strings.TrimSpace(fallbackClientID)
	scope := receivedLibraryScope{
		StableDeviceID:   &stableDeviceID,
		FallbackClientID: fallbackClientID,
	}
	return s.listAllReceivedLibrary(desktopDeviceID, scope, receiveDir)
}

func (s *Store) ListReceivedLibraryPageForStableDeviceWithReceiveDir(desktopDeviceID string, stableDeviceID string, fallbackClientID string, page, pageSize int, receiveDir string) (ReceivedLibraryPage, error) {
	stableDeviceID = strings.TrimSpace(stableDeviceID)
	fallbackClientID = strings.TrimSpace(fallbackClientID)
	scope := receivedLibraryScope{
		StableDeviceID:   &stableDeviceID,
		FallbackClientID: fallbackClientID,
	}
	return s.listReceivedLibraryPage(desktopDeviceID, scope, page, pageSize, receiveDir)
}
```

- [ ] **Step 5: Update global and client methods to use scopes**

Keep public method names stable, but pass `receivedLibraryScope{}` for global and `receivedLibraryScope{ClientID: &clientID}` for client scope:

```go
func (s *Store) ListReceivedLibraryWithReceiveDir(desktopDeviceID string, receiveDir string) ([]ReceivedLibraryItem, error) {
	return s.listAllReceivedLibrary(desktopDeviceID, receivedLibraryScope{}, receiveDir)
}

func (s *Store) ListReceivedLibraryForClientWithReceiveDir(desktopDeviceID string, clientID string, receiveDir string) ([]ReceivedLibraryItem, error) {
	return s.listAllReceivedLibrary(desktopDeviceID, receivedLibraryScope{ClientID: &clientID}, receiveDir)
}

func (s *Store) ListReceivedLibraryPageWithReceiveDir(desktopDeviceID string, page, pageSize int, receiveDir string) (ReceivedLibraryPage, error) {
	return s.listReceivedLibraryPage(desktopDeviceID, receivedLibraryScope{}, page, pageSize, receiveDir)
}

func (s *Store) ListReceivedLibraryPageForClientWithReceiveDir(desktopDeviceID string, clientID string, page, pageSize int, receiveDir string) (ReceivedLibraryPage, error) {
	return s.listReceivedLibraryPage(desktopDeviceID, receivedLibraryScope{ClientID: &clientID}, page, pageSize, receiveDir)
}
```

- [ ] **Step 6: Implement scoped SQL where clause**

Replace `receivedLibraryWhere(clientID *string)` with:

```go
func receivedLibraryWhere(scope receivedLibraryScope) (string, []any) {
	clauses := []string{"u.status = 'completed'"}
	args := []any{}
	if scope.ClientID != nil {
		clauses = append(clauses, "u.client_id = ?")
		args = append(args, strings.TrimSpace(*scope.ClientID))
		return strings.Join(clauses, " AND "), args
	}
	if scope.StableDeviceID != nil {
		stableDeviceID := strings.TrimSpace(*scope.StableDeviceID)
		if stableDeviceID == "" {
			clauses = append(clauses, "u.client_id = ?")
			args = append(args, strings.TrimSpace(scope.FallbackClientID))
			return strings.Join(clauses, " AND "), args
		}
		clauses = append(clauses, `EXISTS (
			SELECT 1
			FROM paired_devices p_scope
			WHERE p_scope.client_id = u.client_id
				AND p_scope.stable_device_id = ?
		)`)
		args = append(args, stableDeviceID)
	}
	return strings.Join(clauses, " AND "), args
}
```

- [ ] **Step 7: Update private callers**

Change private signatures:

```go
func (s *Store) listAllReceivedLibrary(desktopDeviceID string, scope receivedLibraryScope, receiveDir string) ([]ReceivedLibraryItem, error)
func (s *Store) listReceivedLibraryPage(desktopDeviceID string, scope receivedLibraryScope, page, pageSize int, receiveDir string) (ReceivedLibraryPage, error)
func (s *Store) listReceivedLibraryDeviceStats(scope receivedLibraryScope) ([]ReceivedLibraryDeviceStat, error)
```

Inside each function, call:

```go
whereSQL, whereArgs := receivedLibraryWhere(scope)
```

- [ ] **Step 8: Run store tests**

Run:

```bash
cd services/sidecar-go
gofmt -w internal/store/received_library.go internal/store/received_library_test.go
go test ./internal/store -run 'TestListReceivedLibrary(Page|PageForStableDevice|ForClient|WithReceiveDir)' -count=1
```

Expected:

```text
ok  	github.com/nicksyncflow/sidecar/internal/store
```

- [ ] **Step 9: Commit store scope changes**

Run:

```bash
git add services/sidecar-go/internal/store/received_library.go services/sidecar-go/internal/store/received_library_test.go
git commit -m "feat: scope received library by stable device"
```

---

### Task 5: Apply Mobile Received Access Policy

**Files:**
- Modify: `services/sidecar-go/internal/api/handlers_resources.go`
- Modify: `services/sidecar-go/internal/api/resources_handlers_test.go`

- [ ] **Step 1: Add API test helpers**

Add these helpers to `services/sidecar-go/internal/api/resources_handlers_test.go` near the other resource test helpers:

Add this import if it is not already present:

```go
import (
	"reflect"
)
```

```go
type resourcesTestServer struct {
	store      *store.Store
	receiveDir string
	handler    http.Handler
}

func newResourcesTestServer(t *testing.T) *resourcesTestServer {
	t.Helper()
	st, cfg, hub := testEnv(t)
	_, handler := api.NewServer(st, cfg, hub, nil)
	return &resourcesTestServer{
		store:      st,
		receiveDir: cfg.ReceiveDir,
		handler:    handler,
	}
}

func (s *resourcesTestServer) router() http.Handler {
	return s.handler
}

func insertCompletedReceivedUploadForResources(t *testing.T, srv *resourcesTestServer, fileKey string, clientID string, filename string, finalPath string) {
	t.Helper()
	absPath := filepath.Join(srv.receiveDir, finalPath)
	if err := os.MkdirAll(filepath.Dir(absPath), 0o755); err != nil {
		t.Fatalf("mkdir received path: %v", err)
	}
	if err := os.WriteFile(absPath, []byte("received fixture"), 0o644); err != nil {
		t.Fatalf("write received fixture: %v", err)
	}
	info, err := os.Stat(absPath)
	if err != nil {
		t.Fatalf("stat received fixture: %v", err)
	}
	completedAt := "2026-06-14T09:00:00Z"
	if err := srv.store.UpsertUpload(store.Upload{
		FileKey:              fileKey,
		ClientID:             clientID,
		OriginalFilename:     filename,
		MediaType:            "image/jpeg",
		FileSize:             info.Size(),
		Status:               "completed",
		FinalPath:            &finalPath,
		CommittedBytes:       info.Size(),
		ActiveTransmissionMs: 250,
		CompletedAt:          &completedAt,
		UpdatedAt:            completedAt,
	}); err != nil {
		t.Fatalf("UpsertUpload %s: %v", fileKey, err)
	}
}
```

- [ ] **Step 2: Add API tests for enabled cross-device access**

In `services/sidecar-go/internal/api/resources_handlers_test.go`, add a test using the existing test server and upload fixture helpers:

```go
func TestMobileReceivedResourcesAllowsAllPairedClientsWhenCrossDeviceAccessEnabled(t *testing.T) {
	srv := newResourcesTestServer(t)
	insertPairedDeviceWithStableID(t, srv.store, "client-a", "Alice iPhone", "Alice iPhone", "stable-001", "2026-06-14T08:00:00Z")
	insertPairedDeviceWithStableID(t, srv.store, "client-b", "Bob iPhone", "Bob iPhone", "stable-002", "2026-06-14T08:00:00Z")
	insertCompletedReceivedUploadForResources(t, srv, "file-a", "client-a", "a.jpg", "Alice iPhone/a.jpg")
	insertCompletedReceivedUploadForResources(t, srv, "file-b", "client-b", "b.jpg", "Bob iPhone/b.jpg")

	req := httptest.NewRequest(http.MethodGet, "/resources/mobile/received?clientId=client-a&clientName=Alice%20iPhone&page=1&pageSize=20", nil)
	rec := httptest.NewRecorder()
	srv.router().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var page store.ReceivedLibraryPage
	if err := json.Unmarshal(rec.Body.Bytes(), &page); err != nil {
		t.Fatalf("decode page: %v", err)
	}
	got := receivedLibraryFileKeys(page.Items)
	want := []string{"file-b", "file-a"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("file keys mismatch\nwant=%v\n got=%v", want, got)
	}
	for _, item := range page.Items {
		if strings.TrimSpace(item.PreviewURL) == "" {
			t.Fatalf("expected preview URL for %s", item.FileKey)
		}
	}
}
```

- [ ] **Step 3: Add API tests for disabled cross-device access**

Add a test that disables the setting and verifies same-stable access only:

```go
func TestMobileReceivedResourcesRestrictsToStableDeviceWhenCrossDeviceAccessDisabled(t *testing.T) {
	srv := newResourcesTestServer(t)
	if err := srv.store.SetSetting(allowCrossDeviceReceivedAccessSettingKey, "false"); err != nil {
		t.Fatalf("SetSetting: %v", err)
	}
	insertPairedDeviceWithStableID(t, srv.store, "client-a", "Alice Personal", "Alice iPhone", "stable-001", "2026-06-14T08:00:00Z")
	insertPairedDeviceWithStableID(t, srv.store, "client-b", "Alice Work", "Alice iPhone", "stable-001", "2026-06-14T08:01:00Z")
	insertPairedDeviceWithStableID(t, srv.store, "client-c", "Bob iPhone", "Bob iPhone", "stable-002", "2026-06-14T08:02:00Z")
	insertCompletedReceivedUploadForResources(t, srv, "file-a", "client-a", "a.jpg", "Alice iPhone/a.jpg")
	insertCompletedReceivedUploadForResources(t, srv, "file-b", "client-b", "b.jpg", "Alice iPhone/b.jpg")
	insertCompletedReceivedUploadForResources(t, srv, "file-c", "client-c", "c.jpg", "Bob iPhone/c.jpg")

	req := httptest.NewRequest(http.MethodGet, "/resources/mobile/received?clientId=client-a&clientName=Alice%20Personal&page=1&pageSize=20", nil)
	rec := httptest.NewRecorder()
	srv.router().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var page store.ReceivedLibraryPage
	if err := json.Unmarshal(rec.Body.Bytes(), &page); err != nil {
		t.Fatalf("decode page: %v", err)
	}
	got := receivedLibraryFileKeys(page.Items)
	want := []string{"file-b", "file-a"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("file keys mismatch\nwant=%v\n got=%v", want, got)
	}
}
```

- [ ] **Step 4: Add API tests for disabled file endpoint denial**

Add a test that expects `403` when a paired requester tries to download a different stable device's file while cross-device access is disabled:

```go
func TestMobileReceivedDownloadRejectsDifferentStableDeviceWhenCrossDeviceAccessDisabled(t *testing.T) {
	srv := newResourcesTestServer(t)
	if err := srv.store.SetSetting(allowCrossDeviceReceivedAccessSettingKey, "false"); err != nil {
		t.Fatalf("SetSetting: %v", err)
	}
	insertPairedDeviceWithStableID(t, srv.store, "client-a", "Alice iPhone", "Alice iPhone", "stable-001", "2026-06-14T08:00:00Z")
	insertPairedDeviceWithStableID(t, srv.store, "client-c", "Bob iPhone", "Bob iPhone", "stable-002", "2026-06-14T08:01:00Z")
	insertCompletedReceivedUploadForResources(t, srv, "file-c", "client-c", "c.jpg", "Bob iPhone/c.jpg")

	req := httptest.NewRequest(http.MethodGet, "/resources/mobile/received/download?clientId=client-a&clientName=Alice%20iPhone&fileKey=file-c", nil)
	rec := httptest.NewRecorder()
	srv.router().ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected status 403, got %d body=%s", rec.Code, rec.Body.String())
	}
}
```

- [ ] **Step 5: Run API tests and verify current policy failure**

Run:

```bash
cd services/sidecar-go
go test ./internal/api -run 'TestMobileReceived(ResourcesAllowsAllPairedClientsWhenCrossDeviceAccessEnabled|ResourcesRestrictsToStableDeviceWhenCrossDeviceAccessDisabled|DownloadRejectsDifferentStableDeviceWhenCrossDeviceAccessDisabled)$' -count=1
```

Expected before implementation:

```text
FAIL
```

The enabled-list test fails because global items lack preview URLs. The disabled tests fail because the endpoint still lists or resolves files outside the requester's stable device.

- [ ] **Step 6: Add access policy helpers**

In `services/sidecar-go/internal/api/handlers_resources.go`, add:

```go
type mobileReceivedAccessPolicy struct {
	Client                         mobileAccessClient
	AllowCrossDeviceReceivedAccess bool
	StableDeviceID                 string
}

func (s *Server) mobileReceivedAccessPolicy(client mobileAccessClient) (mobileReceivedAccessPolicy, error) {
	allowCrossDeviceReceivedAccess := true
	if val, err := s.store.GetSetting(allowCrossDeviceReceivedAccessSettingKey); err == nil {
		allowCrossDeviceReceivedAccess = (val == "true")
	} else if !errors.Is(err, sql.ErrNoRows) {
		return mobileReceivedAccessPolicy{}, err
	}

	stableDeviceID := ""
	if device, err := s.store.GetPairedDevice(client.ClientID); err == nil && device.StableDeviceID != nil {
		stableDeviceID = strings.TrimSpace(*device.StableDeviceID)
	} else if err != nil {
		return mobileReceivedAccessPolicy{}, err
	}

	return mobileReceivedAccessPolicy{
		Client:                         client,
		AllowCrossDeviceReceivedAccess: allowCrossDeviceReceivedAccess,
		StableDeviceID:                 stableDeviceID,
	}, nil
}
```

Add imports if they are not already present:

```go
import (
	"database/sql"
)
```

- [ ] **Step 7: Apply policy to mobile list endpoint**

In `handleMobileReceivedResources`, after loading `desktopDeviceID`, add:

```go
policy, err := s.mobileReceivedAccessPolicy(client)
if err != nil {
	writeError(w, http.StatusInternalServerError, "failed to resolve received access policy")
	return
}
```

For paged results, replace the non-client branch:

```go
if scopedToClient {
	result, err = s.store.ListReceivedLibraryPageForClientWithReceiveDir(desktopDeviceID, client.ClientID, page, pageSize, s.config.ReceiveDir)
} else if policy.AllowCrossDeviceReceivedAccess {
	result, err = s.store.ListReceivedLibraryPageWithReceiveDir(desktopDeviceID, page, pageSize, s.config.ReceiveDir)
} else {
	result, err = s.store.ListReceivedLibraryPageForStableDeviceWithReceiveDir(desktopDeviceID, policy.StableDeviceID, client.ClientID, page, pageSize, s.config.ReceiveDir)
}
```

For non-paged results, replace the non-client branch:

```go
if scopedToClient {
	items, err = s.store.ListReceivedLibraryForClientWithReceiveDir(desktopDeviceID, client.ClientID, s.config.ReceiveDir)
} else if policy.AllowCrossDeviceReceivedAccess {
	items, err = s.store.ListReceivedLibraryWithReceiveDir(desktopDeviceID, s.config.ReceiveDir)
} else {
	items, err = s.store.ListReceivedLibraryForStableDeviceWithReceiveDir(desktopDeviceID, policy.StableDeviceID, client.ClientID, s.config.ReceiveDir)
}
```

Call URL enrichment for all authorized results:

```go
enrichMobileReceivedPreviewURLs(result.Items, client)
```

and:

```go
enrichMobileReceivedPreviewURLs(items, client)
```

- [ ] **Step 8: Remove same-client filtering from preview URL enrichment**

Replace the start of `enrichMobileReceivedPreviewURLs`:

```go
if items[i].ClientID != client.ClientID || strings.TrimSpace(items[i].FileKey) == "" {
	continue
}
```

with:

```go
if strings.TrimSpace(items[i].FileKey) == "" {
	continue
}
```

The caller now passes only authorized items.

- [ ] **Step 9: Apply policy to file resolution**

In `resolveMobileReceivedUploadWithClient`, after the completed-status check and before resolving the path, add:

```go
policy, err := s.mobileReceivedAccessPolicy(client)
if err != nil {
	slog.Warn("resolveMobileReceivedUpload: access policy failed", "clientID", client.ClientID, "err", err)
	writeError(w, http.StatusInternalServerError, "failed to resolve received access policy")
	return mobileAccessClient{}, nil, "", nil, false
}
if !policy.AllowCrossDeviceReceivedAccess {
	allowed, err := s.mobileReceivedUploadAllowedForPolicy(policy, upload)
	if err != nil {
		slog.Warn("resolveMobileReceivedUpload: authorization failed", "clientID", client.ClientID, "fileKey", upload.FileKey, "err", err)
		writeError(w, http.StatusInternalServerError, "failed to authorize received file")
		return mobileAccessClient{}, nil, "", nil, false
	}
	if !allowed {
		desktopDeviceID, err := s.store.GetDeviceID()
		if err == nil {
			_, _ = s.recordResourceAccess(desktopDeviceID, client, upload.FileKey, "received_file", upload.OriginalFilename, "view", "denied")
		}
		writeError(w, http.StatusForbidden, "received file not authorized")
		return mobileAccessClient{}, nil, "", nil, false
	}
}
```

Add this helper:

```go
func (s *Server) mobileReceivedUploadAllowedForPolicy(policy mobileReceivedAccessPolicy, upload *store.Upload) (bool, error) {
	if upload.ClientID == policy.Client.ClientID {
		return true, nil
	}
	if strings.TrimSpace(policy.StableDeviceID) == "" {
		return false, nil
	}
	owner, err := s.store.GetPairedDevice(upload.ClientID)
	if err != nil {
		if errors.Is(err, store.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	if owner.StableDeviceID == nil {
		return false, nil
	}
	return strings.TrimSpace(*owner.StableDeviceID) == policy.StableDeviceID, nil
}
```

- [ ] **Step 10: Run API tests**

Run:

```bash
cd services/sidecar-go
gofmt -w internal/api/handlers_resources.go internal/api/resources_handlers_test.go
go test ./internal/api -run 'TestMobileReceived(ResourcesAllowsAllPairedClientsWhenCrossDeviceAccessEnabled|ResourcesRestrictsToStableDeviceWhenCrossDeviceAccessDisabled|DownloadRejectsDifferentStableDeviceWhenCrossDeviceAccessDisabled)$' -count=1
```

Expected:

```text
ok  	github.com/nicksyncflow/sidecar/internal/api
```

- [ ] **Step 11: Commit API policy changes**

Run:

```bash
git add services/sidecar-go/internal/api/handlers_resources.go services/sidecar-go/internal/api/resources_handlers_test.go
git commit -m "feat: authorize mobile received library access"
```

---

### Task 6: Add Desktop Settings Switch

**Files:**
- Modify: `apps/desktop/src/renderer/stores/settings-store.ts`
- Modify: `apps/desktop/src/renderer/mocks/settings.ts`
- Modify: `apps/desktop/src/renderer/features/settings/SettingsPage.tsx`
- Modify or create: `apps/desktop/src/renderer/features/settings/__tests__/SettingsPage.test.tsx`

- [ ] **Step 1: Add settings store default**

In `apps/desktop/src/renderer/stores/settings-store.ts`, update `initialSettings`:

```ts
const initialSettings: SettingsDTO = {
  deviceName: '',
  connectionCode: '',
  rootPath: '',
  receivePath: '',
  personalPath: '',
  sharedPath: '',
  shareAddress: '',
  shareStatus: 'disabled',
  shareName: '',
  remoteAccessEnabled: true,
  allowCrossDeviceReceivedAccess: true,
};
```

- [ ] **Step 2: Add mock setting value**

In `apps/desktop/src/renderer/mocks/settings.ts`, add:

```ts
allowCrossDeviceReceivedAccess: true,
```

to the mock `SettingsDTO` object.

- [ ] **Step 3: Add failing UI test**

In `apps/desktop/src/renderer/features/settings/__tests__/SettingsPage.test.tsx`, add a test matching the existing setup pattern:

```tsx
it('toggles cross-device received library access', async () => {
  const user = userEvent.setup();
  const updateSettings = vi.fn().mockResolvedValue({
    ...mockSettings,
    allowCrossDeviceReceivedAccess: false,
  });
  window.electronAPI.sidecar.updateSettings = updateSettings;
  useSettingsStore.getState().updateSettings({
    ...mockSettings,
    allowCrossDeviceReceivedAccess: true,
  });

  render(<SettingsPage />);

  const toggle = screen.getByRole('switch', {
    name: '允許已配對手機瀏覽所有已接收檔案',
  });
  await user.click(toggle);

  expect(updateSettings).toHaveBeenCalledWith({
    allowCrossDeviceReceivedAccess: false,
  });
});
```

- [ ] **Step 4: Run the settings page test and verify missing switch failure**

Run:

```bash
pnpm --filter @syncflow/desktop test -- SettingsPage
```

Expected before implementation:

```text
Unable to find role="switch" and name "允許已配對手機瀏覽所有已接收檔案"
```

- [ ] **Step 5: Add toggle handler**

In `SettingsPage.tsx`, add a handler near the existing settings toggle handlers:

```tsx
const handleToggleCrossDeviceReceivedAccess = async (next: boolean) => {
  const updated = await window.electronAPI.sidecar.updateSettings({
    allowCrossDeviceReceivedAccess: next,
  });
  useSettingsStore.getState().updateSettings(updated);
};
```

- [ ] **Step 6: Add switch row in the general settings card**

Add a settings row near the existing remote/local access settings:

```tsx
<div className="flex items-center justify-between gap-4">
  <div className="space-y-1">
    <Label htmlFor="cross-device-received-access">允許已配對手機瀏覽所有已接收檔案</Label>
    <p className="text-sm text-muted-foreground">
      {settings.allowCrossDeviceReceivedAccess !== false
        ? '已配對手機可瀏覽與下載這台電腦的全部 received 內容'
        : '手機只能瀏覽同一實體設備同步到這台電腦的檔案'}
    </p>
  </div>
  <Switch
    id="cross-device-received-access"
    checked={settings.allowCrossDeviceReceivedAccess !== false}
    onCheckedChange={handleToggleCrossDeviceReceivedAccess}
    aria-label="允許已配對手機瀏覽所有已接收檔案"
  />
</div>
```

Use the existing `Switch` and `Label` imports. If this file uses a local row component, pass the same label, caption, checked state, and handler through that component.

- [ ] **Step 7: Run desktop settings tests**

Run:

```bash
pnpm --filter @syncflow/desktop test -- SettingsPage
```

Expected:

```text
PASS
```

- [ ] **Step 8: Commit desktop settings changes**

Run:

```bash
git add apps/desktop/src/renderer/stores/settings-store.ts apps/desktop/src/renderer/mocks/settings.ts apps/desktop/src/renderer/features/settings/SettingsPage.tsx apps/desktop/src/renderer/features/settings/__tests__/SettingsPage.test.tsx
git commit -m "feat: add received library access setting"
```

---

### Task 7: Keep Mobile Received Library Requests Server-Scoped

**Files:**
- Modify: `apps/mobile/src/services/__tests__/desktop-local-service.test.ts`
- Read-only: `apps/mobile/src/services/desktop-local-service.ts`

- [ ] **Step 1: Add or update the global page request regression test**

Keep the existing global received-library page request unscoped. The assertion should expect no `scope=client` query parameter:

```ts
expect(fetch).toHaveBeenCalledWith(
  'http://192.168.10.20:39394/resources/mobile/received?clientId=client-001&clientName=Alice%20iPhone&page=2&pageSize=20',
  expect.objectContaining({ method: 'GET' }),
);
```

- [ ] **Step 2: Add URL pass-through regression test**

Add or update a test so server-generated URLs for cross-device items are preserved:

```ts
expect(result.items[0]).toEqual(
  expect.objectContaining({
    fileKey: 'file-from-other-device',
    previewUrl:
      '/resources/mobile/received/preview?clientId=client-001&clientName=Alice%20iPhone&fileKey=file-from-other-device',
    thumbnailUrl:
      '/resources/mobile/received/thumbnail?clientId=client-001&clientName=Alice%20iPhone&fileKey=file-from-other-device',
    streamUrl:
      '/resources/mobile/received/stream?clientId=client-001&clientName=Alice%20iPhone&fileKey=file-from-other-device',
  }),
);
```

- [ ] **Step 3: Run mobile service tests**

Run:

```bash
pnpm --filter @syncflow/mobile test -- desktop-local-service
```

Expected:

```text
PASS
```

- [ ] **Step 4: Commit mobile regression tests**

Run:

```bash
git add apps/mobile/src/services/__tests__/desktop-local-service.test.ts
git commit -m "test: keep mobile received library server scoped"
```

---

### Task 8: Run Integrated Verification

**Files:**
- Verify only unless tests expose a regression.

- [ ] **Step 1: Run contracts verification**

Run:

```bash
pnpm --filter @syncflow/contracts test
pnpm --filter @syncflow/contracts build
```

Expected:

```text
@syncflow/contracts test succeeds
@syncflow/contracts build succeeds
```

- [ ] **Step 2: Run sidecar verification**

Run:

```bash
cd services/sidecar-go
go test ./internal/server ./internal/store ./internal/api -count=1
```

Expected:

```text
ok  	github.com/nicksyncflow/sidecar/internal/server
ok  	github.com/nicksyncflow/sidecar/internal/store
ok  	github.com/nicksyncflow/sidecar/internal/api
```

- [ ] **Step 3: Run desktop and mobile focused verification**

Run:

```bash
pnpm --filter @syncflow/desktop test -- SettingsPage
pnpm --filter @syncflow/mobile test -- desktop-local-service
```

Expected:

```text
@syncflow/desktop SettingsPage tests pass
@syncflow/mobile desktop-local-service tests pass
```

- [ ] **Step 4: Run monorepo typecheck**

Run:

```bash
pnpm typecheck
```

Expected:

```text
typecheck succeeds
```

- [ ] **Step 5: Inspect changed files**

Run:

```bash
git status --short
git diff --stat HEAD
```

Expected:

```text
Only files listed in this plan are changed.
```

- [ ] **Step 6: Commit verification fixes if needed**

If verification required small fixes, commit only those files:

```bash
git add <verified-files>
git commit -m "fix: stabilize received library access"
```

---

## Self-Review Checklist

- [ ] Same `stableDeviceId` with different account/client/device display name reuses the same `received/` folder.
- [ ] Different `stableDeviceId` with the same display name receives a unique folder.
- [ ] `clientId` remains the pairing/session/upload/audit identity.
- [ ] Desktop setting defaults to `allowCrossDeviceReceivedAccess: true`.
- [ ] When enabled, any paired phone can list and open all completed received files on this desktop.
- [ ] When disabled, a paired phone can list and open same-stable-device files; missing stable ID falls back to current `clientId`.
- [ ] `scope=client` remains a current-client diagnostic/legacy scope.
- [ ] Mobile global received-library requests do not add `scope=client`.
- [ ] Preview, thumbnail, stream, and download URLs are only added to already-authorized list items.
- [ ] Direct file endpoints return `403` for unauthorized cross-stable access when the setting is disabled.
- [ ] Remote resources and shared-folder access paths are not changed by this plan.
- [ ] No release packaging or build-number changes are part of this plan.
