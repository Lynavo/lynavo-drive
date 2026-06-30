# Connection Device Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add desktop-local connection device management so successful mobile pairings become authorized devices, wrong connection-code attempts are counted per `clientId + desktopDeviceId`, and a phone is permanently blocked on that desktop after 5 wrong attempts until the desktop user clears it.

**Architecture:** `@lynavo-drive/contracts` defines the shared DTOs and stable error codes. The Go sidecar owns SQLite persistence, LMUP pairing decisions, block enforcement, and HTTP management APIs; Electron main/preload bridges those APIs to the renderer; the renderer adds a settings section for authorized devices, blocked clients, and recent attempts. Mobile native layers propagate structured pairing error codes and metadata to React Native, where `CodeVerifyScreen` displays the correct localized message.

**Tech Stack:** TypeScript, Electron IPC/preload bridge, React 18.3, Zustand, Vitest, Go `net/http`, Go SQLite via `mattn/go-sqlite3`, React Native, Swift, Kotlin

---

## Source References

- Approved design: `docs/superpowers/specs/2026-06-10-connection-device-management-design.md`
- Current pairing flow: `services/sidecar-go/internal/server/handler_hello.go`
- Current device store: `services/sidecar-go/internal/store/devices.go`
- Current code regeneration endpoint: `services/sidecar-go/internal/api/handlers_code.go`
- Current desktop bridge: `apps/desktop/src/main/ipc-handlers.ts`, `apps/desktop/src/preload/index.ts`, `apps/desktop/src/preload/api.d.ts`
- Current settings page: `apps/desktop/src/renderer/features/settings/SettingsPage.tsx`
- Current mobile pairing screen: `apps/mobile/src/screens/CodeVerifyScreen.tsx`

## File Map

**Contracts**

- Modify `packages/contracts/src/errors.ts`: add stable pairing error code constants.
- Modify `packages/contracts/src/types.ts`: add desktop connection-device DTOs and pairing error metadata DTO.
- Modify `packages/contracts/src/__tests__/exports.test.ts`: verify new DTO and error exports are reachable through package root.

**Sidecar Store**

- Create `services/sidecar-go/internal/store/migrations/005_pairing_device_management.sql`: create `pairing_attempts`, `pairing_rate_limits`, `blocked_pairing_clients`, and indexes.
- Modify `services/sidecar-go/internal/store/db.go`: embed and run migration 005.
- Modify `services/sidecar-go/internal/store/models.go`: add Go models for attempts, active blocks, and management views.
- Create `services/sidecar-go/internal/store/pairing_security.go`: add attempt, rate-limit, block, revoke, and management-list methods.
- Create `services/sidecar-go/internal/store/pairing_security_test.go`: cover migration, transaction behavior, scoped blocks, clearing, and management lists.
- Modify `services/sidecar-go/internal/store/devices.go`: keep existing device methods unchanged; `ListAuthorizedDevices` lives in `pairing_security.go` and filters `revoked_at IS NULL`.

**Sidecar Protocol and API**

- Modify `services/sidecar-go/internal/protocol/messages.go`: add `PairError` metadata to `PairRes` and `ErrorMsg`.
- Modify `services/sidecar-go/internal/server/handler_hello.go`: enforce active blocks in `HELLO_REQ`, `PAIR_REQ`, and `AUTH_REQ`; record pairing attempts; return structured error codes.
- Modify `services/sidecar-go/internal/server/connection_test.go`: add protocol tests for wrong-code attempts, blocking, desktop isolation, clearing, revocation, and re-pairing.
- Modify `services/sidecar-go/internal/api/router.go`: register desktop-management HTTP routes.
- Create `services/sidecar-go/internal/api/handlers_connection_devices.go`: implement list, revoke, and clear endpoints.
- Modify `services/sidecar-go/internal/api/handlers_code.go`: regenerate the connection code without revoking authorized devices.
- Modify `services/sidecar-go/internal/api/router_test.go`: add HTTP API and code-regeneration regression tests.

**Desktop Bridge and Renderer**

- Modify `apps/desktop/src/main/sidecar-client.ts`: add client methods for management HTTP APIs and update health capability naming.
- Modify `apps/desktop/src/main/ipc-handlers.ts`: add IPC channels and handlers.
- Modify `apps/desktop/src/main/__tests__/sidecar-client.test.ts`: assert sidecar-client paths and methods.
- Modify `apps/desktop/src/main/__tests__/ipc-handlers.test.ts`: assert IPC channels call sidecar-client methods.
- Modify `apps/desktop/src/preload/index.ts`: expose methods under `window.electronAPI.sidecar`.
- Modify `apps/desktop/src/preload/api.d.ts`: add typed preload methods.
- Modify `apps/desktop/src/preload/__tests__/index.test.ts`: assert preload maps to IPC.
- Create `apps/desktop/src/renderer/stores/connection-devices-store.ts`: Zustand store for loading, revoke, clear, and local refresh state.
- Create `apps/desktop/src/renderer/stores/__tests__/connection-devices-store.test.ts`: cover store actions.
- Create `apps/desktop/src/renderer/features/settings/ConnectionDevicesSection.tsx`: authorized devices, blocked clients, and recent attempt UI.
- Create `apps/desktop/src/renderer/features/settings/__tests__/ConnectionDevicesSection.test.tsx`: cover rendering and actions.
- Modify `apps/desktop/src/renderer/features/settings/SettingsPage.tsx`: insert the new section after the connection-code section.
- Modify `apps/desktop/src/renderer/features/settings/__tests__/SettingsPage.test.tsx`: assert the new section exists.
- Modify desktop settings i18n files:
  - `apps/desktop/src/renderer/i18n/locales/zh-Hant/settings.json`
  - `apps/desktop/src/renderer/i18n/locales/zh-Hans/settings.json`
  - `apps/desktop/src/renderer/i18n/locales/en/settings.json`

**Mobile**

- Modify `apps/mobile/ios/SyncEngine/SyncEngineManager.swift`: parse `PAIR_RES.errorCode`, `PAIR_RES.errorMeta`, and protocol `ERROR` metadata.
- Modify `apps/mobile/ios/SyncEngine/RNBridge.swift`: reject pair failures with the native error code when available.
- Modify `apps/mobile/android/app/src/main/java/com/vividrop/mobile/china/sync/NativeSyncEngineModule.kt`: parse structured pairing errors and reject with stable code.
- Modify `apps/mobile/src/screens/CodeVerifyScreen.tsx`: map stable codes to localized copy and remaining-attempts text.
- Modify mobile i18n files:
  - `apps/mobile/src/i18n/locales/zh-Hant/errors.json`
  - `apps/mobile/src/i18n/locales/zh-Hans/errors.json`
  - `apps/mobile/src/i18n/locales/en/errors.json`
- Modify `apps/mobile/src/screens/__tests__/CodeVerifyScreen.test.tsx`: cover wrong-code remaining attempts, blocked client, and token invalid flows.

## Invariants

- Device identity is mobile `clientId`; device name, IP, directory name, and `stableDeviceId` are metadata only.
- Authorization and block state stay desktop-local; no cloud sync is introduced.
- Active block scope is exactly `clientId + desktopDeviceId`.
- Wrong connection-code attempt limit is `5`.
- Active block means `cleared_at IS NULL`.
- Clearing a block does not authorize the phone.
- Revoking authorization sets `revoked_at`; it does not delete files, upload history, queue state, or statistics.
- Regenerating the connection code changes only the code for new pairing.
- Renderer uses preload/main IPC; it never calls sidecar HTTP, SQLite, or filesystem directly.

---

### Task 1: Contracts for Management DTOs and Pairing Errors

**Files:**
- Modify: `packages/contracts/src/errors.ts`
- Modify: `packages/contracts/src/types.ts`
- Modify: `packages/contracts/src/__tests__/exports.test.ts`

- [ ] **Step 1: Write failing export tests**

Add these assertions to `packages/contracts/src/__tests__/exports.test.ts`:

```typescript
import {
  ErrorCode,
  type BlockedPairingClientDTO,
  type ConnectionDeviceDTO,
  type ConnectionDevicesSettingsDTO,
  type PairingAttemptDTO,
  type PairingErrorMetadataDTO,
} from '../index';

it('exports connection device management DTOs and pairing error codes', () => {
  const device: ConnectionDeviceDTO = {
    clientId: 'phone-a',
    displayName: 'Nick iPhone',
    clientName: 'Nick iPhone',
    platform: 'ios',
    ip: '192.168.1.20',
    status: 'authorized',
    authorizedAt: '2026-06-10T01:00:00Z',
    lastSeenAt: '2026-06-10T01:10:00Z',
  };
  const blocked: BlockedPairingClientDTO = {
    clientId: 'phone-a',
    displayName: 'Nick iPhone',
    clientName: 'Nick iPhone',
    platform: 'ios',
    lastIp: '192.168.1.20',
    failedAttempts: 5,
    blockedAt: '2026-06-10T01:11:00Z',
    lastAttemptAt: '2026-06-10T01:11:00Z',
    reason: 'wrong_connection_code_limit',
  };
  const attempt: PairingAttemptDTO = {
    id: 1,
    clientId: 'phone-a',
    displayName: 'Nick iPhone',
    clientName: 'Nick iPhone',
    platform: 'ios',
    ip: '192.168.1.20',
    result: 'wrong_code',
    failureReason: 'PAIRING_CODE_INVALID',
    createdAt: '2026-06-10T01:11:00Z',
  };
  const meta: PairingErrorMetadataDTO = {
    failedAttempts: 4,
    remainingAttempts: 1,
    maxAttempts: 5,
  };
  const settings: ConnectionDevicesSettingsDTO = {
    authorizedDevices: [device],
    blockedClients: [blocked],
    recentAttempts: [attempt],
  };

  expect(settings.authorizedDevices[0]?.clientId).toBe('phone-a');
  expect(meta.remainingAttempts).toBe(1);
  expect(ErrorCode.PAIRING_CODE_INVALID).toBe('PAIRING_CODE_INVALID');
  expect(ErrorCode.PAIRING_CLIENT_BLOCKED).toBe('PAIRING_CLIENT_BLOCKED');
  expect(ErrorCode.PAIR_TOKEN_INVALID).toBe('PAIR_TOKEN_INVALID');
  expect(ErrorCode.APP_VERSION_INCOMPATIBLE).toBe('APP_VERSION_INCOMPATIBLE');
});
```

- [ ] **Step 2: Run the focused contracts test and confirm failure**

Run:

```bash
pnpm --filter @lynavo-drive/contracts test -- exports
```

Expected: FAIL because `ConnectionDeviceDTO`, `BlockedPairingClientDTO`, `PairingAttemptDTO`, `ConnectionDevicesSettingsDTO`, `PairingErrorMetadataDTO`, `PAIRING_CODE_INVALID`, and `PAIRING_CLIENT_BLOCKED` are not exported yet.

- [ ] **Step 3: Add error constants**

Update `packages/contracts/src/errors.ts` so `ErrorCode` includes the new canonical names and keeps the existing legacy spelling during migration:

```typescript
export const ErrorCode = {
  PAIR_CODE_INVALID: 'PAIR_CODE_INVALID',
  PAIRING_CODE_INVALID: 'PAIRING_CODE_INVALID',
  PAIRING_CLIENT_BLOCKED: 'PAIRING_CLIENT_BLOCKED',
  PAIR_TOKEN_INVALID: 'PAIR_TOKEN_INVALID',
  PROTO_VERSION_UNSUPPORTED: 'PROTO_VERSION_UNSUPPORTED',
  APP_VERSION_INCOMPATIBLE: 'APP_VERSION_INCOMPATIBLE',
  FILE_ALREADY_EXISTS: 'FILE_ALREADY_EXISTS',
  LOW_DISK_PAUSED: 'LOW_DISK_PAUSED',
  RECEIVE_ROOT_MISSING: 'RECEIVE_ROOT_MISSING',
  LOCAL_NETWORK_DENIED: 'LOCAL_NETWORK_DENIED',
  PHOTO_PERMISSION_DENIED: 'PHOTO_PERMISSION_DENIED',
  TARGET_NOT_FOUND: 'TARGET_NOT_FOUND',
  SOCKET_DISCONNECTED: 'SOCKET_DISCONNECTED',
  RESUME_NOT_AVAILABLE: 'RESUME_NOT_AVAILABLE',
  SHARE_NOT_READY: 'SHARE_NOT_READY',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
```

- [ ] **Step 4: Add DTOs**

Append these definitions to the Desktop Settings section of `packages/contracts/src/types.ts`:

```typescript
export type ConnectionDeviceStatus = 'authorized' | 'connected' | 'offline';

export type PairingAttemptResult =
  | 'success'
  | 'wrong_code'
  | 'blocked'
  | 'incompatible'
  | 'malformed'
  | 'revoked_repair_required';

export interface PairingErrorMetadataDTO {
  failedAttempts?: number;
  remainingAttempts?: number;
  maxAttempts?: number;
}

export interface ConnectionDeviceDTO {
  clientId: string;
  stableDeviceId?: string;
  displayName: string;
  clientName: string;
  deviceAlias?: string;
  platform: string;
  ip?: string;
  status: ConnectionDeviceStatus;
  authorizedAt: string;
  lastSeenAt: string;
  revokedAt?: string;
}

export interface BlockedPairingClientDTO {
  clientId: string;
  stableDeviceId?: string;
  displayName: string;
  clientName?: string;
  deviceAlias?: string;
  platform?: string;
  lastIp?: string;
  failedAttempts: number;
  blockedAt: string;
  lastAttemptAt: string;
  reason: 'wrong_connection_code_limit';
}

export interface PairingAttemptDTO {
  id: number;
  clientId: string;
  stableDeviceId?: string;
  displayName: string;
  clientName?: string;
  deviceAlias?: string;
  platform?: string;
  ip?: string;
  result: PairingAttemptResult;
  failureReason?: string;
  createdAt: string;
}

export interface ConnectionDevicesSettingsDTO {
  authorizedDevices: ConnectionDeviceDTO[];
  blockedClients: BlockedPairingClientDTO[];
  recentAttempts: PairingAttemptDTO[];
}
```

- [ ] **Step 5: Run contracts tests and build**

Run:

```bash
pnpm --filter @lynavo-drive/contracts test -- exports
pnpm --filter @lynavo-drive/contracts build
```

Expected: PASS. The build should emit updated type declarations.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/errors.ts packages/contracts/src/types.ts packages/contracts/src/__tests__/exports.test.ts
git commit -m "feat: add connection device management contracts"
```

---

### Task 2: Sidecar Migration and Store Models

**Files:**
- Create: `services/sidecar-go/internal/store/migrations/005_pairing_device_management.sql`
- Modify: `services/sidecar-go/internal/store/db.go`
- Modify: `services/sidecar-go/internal/store/models.go`
- Create: `services/sidecar-go/internal/store/pairing_security_test.go`

- [ ] **Step 1: Write a failing migration test**

Create `services/sidecar-go/internal/store/pairing_security_test.go` with:

```go
package store_test

import (
	"path/filepath"
	"testing"

	"github.com/nicksyncflow/sidecar/internal/store"
)

func newPairingSecurityStore(t *testing.T) *store.Store {
	t.Helper()
	st, err := store.New(filepath.Join(t.TempDir(), "sidecar.db"))
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return st
}

func TestPairingSecurityMigrationCreatesTablesAndIndexes(t *testing.T) {
	st := newPairingSecurityStore(t)

	for _, tableName := range []string{"pairing_attempts", "pairing_rate_limits", "blocked_pairing_clients"} {
		var count int
		if err := st.DB().QueryRow(
			"SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = ?",
			tableName,
		).Scan(&count); err != nil {
			t.Fatalf("query table %s: %v", tableName, err)
		}
		if count != 1 {
			t.Fatalf("expected table %s to exist", tableName)
		}
	}

	for _, indexName := range []string{
		"blocked_pairing_clients_active_unique",
		"pairing_attempts_recent_idx",
		"pairing_attempts_client_desktop_idx",
	} {
		var count int
		if err := st.DB().QueryRow(
			"SELECT count(*) FROM sqlite_master WHERE type = 'index' AND name = ?",
			indexName,
		).Scan(&count); err != nil {
			t.Fatalf("query index %s: %v", indexName, err)
		}
		if count != 1 {
			t.Fatalf("expected index %s to exist", indexName)
		}
	}
}
```

- [ ] **Step 2: Run the focused store test and confirm failure**

Run:

```bash
cd services/sidecar-go && go test ./internal/store -run TestPairingSecurityMigrationCreatesTablesAndIndexes -count=1
```

Expected: FAIL because migration 005 is not present.

- [ ] **Step 3: Add migration 005**

Create `services/sidecar-go/internal/store/migrations/005_pairing_device_management.sql`:

```sql
CREATE TABLE IF NOT EXISTS pairing_attempts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id         TEXT NOT NULL,
  desktop_device_id TEXT NOT NULL,
  client_name       TEXT,
  device_alias      TEXT,
  platform          TEXT,
  stable_device_id  TEXT,
  ip                TEXT,
  result            TEXT NOT NULL,
  failure_reason    TEXT,
  created_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pairing_rate_limits (
  client_id         TEXT NOT NULL,
  desktop_device_id TEXT NOT NULL,
  failed_count      INTEGER NOT NULL DEFAULT 0,
  first_failed_at   TEXT NOT NULL,
  last_failed_at    TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  PRIMARY KEY (client_id, desktop_device_id)
);

CREATE TABLE IF NOT EXISTS blocked_pairing_clients (
  client_id          TEXT NOT NULL,
  desktop_device_id  TEXT NOT NULL,
  client_name        TEXT,
  device_alias       TEXT,
  platform           TEXT,
  stable_device_id   TEXT,
  last_ip            TEXT,
  failed_attempts    INTEGER NOT NULL,
  blocked_at         TEXT NOT NULL,
  last_attempt_at    TEXT NOT NULL,
  reason             TEXT NOT NULL,
  cleared_at         TEXT,
  cleared_by         TEXT,
  PRIMARY KEY (client_id, desktop_device_id, blocked_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS blocked_pairing_clients_active_unique
ON blocked_pairing_clients (client_id, desktop_device_id)
WHERE cleared_at IS NULL;

CREATE INDEX IF NOT EXISTS pairing_attempts_recent_idx
ON pairing_attempts (created_at DESC);

CREATE INDEX IF NOT EXISTS pairing_attempts_client_desktop_idx
ON pairing_attempts (client_id, desktop_device_id, created_at DESC);
```

- [ ] **Step 4: Embed and run migration 005**

Modify `services/sidecar-go/internal/store/db.go`:

```go
//go:embed migrations/005_pairing_device_management.sql
var migration005SQL string
```

Then update `migrate()`:

```go
	// Migration 005: add local pairing attempt, rate-limit, and block tables.
	_, _ = s.db.Exec(migration005SQL)
```

- [ ] **Step 5: Add store models**

Append to `services/sidecar-go/internal/store/models.go`:

```go
type PairingAttemptResult string

const (
	PairingAttemptSuccess               PairingAttemptResult = "success"
	PairingAttemptWrongCode             PairingAttemptResult = "wrong_code"
	PairingAttemptBlocked               PairingAttemptResult = "blocked"
	PairingAttemptIncompatible          PairingAttemptResult = "incompatible"
	PairingAttemptMalformed             PairingAttemptResult = "malformed"
	PairingAttemptRevokedRepairRequired PairingAttemptResult = "revoked_repair_required"
)

type PairingClientMetadata struct {
	ClientID        string
	DesktopDeviceID string
	ClientName      string
	DeviceAlias     string
	Platform        string
	StableDeviceID  string
	IP              string
}

type PairingAttempt struct {
	ID              int64                `json:"id"`
	ClientID        string               `json:"clientId"`
	DesktopDeviceID string               `json:"desktopDeviceId"`
	ClientName      *string              `json:"clientName,omitempty"`
	DeviceAlias     *string              `json:"deviceAlias,omitempty"`
	Platform        *string              `json:"platform,omitempty"`
	StableDeviceID  *string              `json:"stableDeviceId,omitempty"`
	IP              *string              `json:"ip,omitempty"`
	Result          PairingAttemptResult `json:"result"`
	FailureReason   *string              `json:"failureReason,omitempty"`
	CreatedAt       string               `json:"createdAt"`
}

type PairingFailureResult struct {
	FailedAttempts   int
	RemainingAttempts int
	MaxAttempts      int
	Blocked          bool
}

type BlockedPairingClient struct {
	ClientID        string  `json:"clientId"`
	DesktopDeviceID string  `json:"desktopDeviceId"`
	ClientName      *string `json:"clientName,omitempty"`
	DeviceAlias     *string `json:"deviceAlias,omitempty"`
	Platform        *string `json:"platform,omitempty"`
	StableDeviceID  *string `json:"stableDeviceId,omitempty"`
	LastIP          *string `json:"lastIp,omitempty"`
	FailedAttempts  int     `json:"failedAttempts"`
	BlockedAt       string  `json:"blockedAt"`
	LastAttemptAt    string  `json:"lastAttemptAt"`
	Reason          string  `json:"reason"`
	ClearedAt        *string `json:"clearedAt,omitempty"`
	ClearedBy        *string `json:"clearedBy,omitempty"`
}
```

- [ ] **Step 6: Run the migration test**

Run:

```bash
cd services/sidecar-go && go test ./internal/store -run TestPairingSecurityMigrationCreatesTablesAndIndexes -count=1
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add services/sidecar-go/internal/store/migrations/005_pairing_device_management.sql services/sidecar-go/internal/store/db.go services/sidecar-go/internal/store/models.go services/sidecar-go/internal/store/pairing_security_test.go
git commit -m "feat: add pairing security database schema"
```

---

### Task 3: Store Methods for Attempts, Rate Limits, Blocks, and Management Lists

**Files:**
- Create: `services/sidecar-go/internal/store/pairing_security.go`
- Modify: `services/sidecar-go/internal/store/pairing_security_test.go`

- [ ] **Step 1: Add failing store behavior tests**

Append these tests to `services/sidecar-go/internal/store/pairing_security_test.go`:

```go
func TestRecordPairingFailureBlocksOnFifthWrongCode(t *testing.T) {
	st := newPairingSecurityStore(t)
	meta := store.PairingClientMetadata{
		ClientID:        "phone-a",
		DesktopDeviceID: "desktop-1",
		ClientName:      "Nick iPhone",
		Platform:        "ios",
		IP:              "192.168.1.20",
	}

	for attempt := 1; attempt <= 4; attempt++ {
		result, err := st.RecordPairingFailure(meta, 5)
		if err != nil {
			t.Fatalf("RecordPairingFailure attempt %d: %v", attempt, err)
		}
		if result.Blocked {
			t.Fatalf("attempt %d should not block", attempt)
		}
		if result.FailedAttempts != attempt {
			t.Fatalf("attempt %d failed count = %d", attempt, result.FailedAttempts)
		}
		if result.RemainingAttempts != 5-attempt {
			t.Fatalf("attempt %d remaining = %d", attempt, result.RemainingAttempts)
		}
	}

	result, err := st.RecordPairingFailure(meta, 5)
	if err != nil {
		t.Fatalf("RecordPairingFailure fifth: %v", err)
	}
	if !result.Blocked || result.FailedAttempts != 5 || result.RemainingAttempts != 0 {
		t.Fatalf("unexpected fifth result: %+v", result)
	}

	block, err := st.GetActivePairingBlock("phone-a", "desktop-1")
	if err != nil {
		t.Fatalf("GetActivePairingBlock: %v", err)
	}
	if block == nil || block.FailedAttempts != 5 || block.Reason != "wrong_connection_code_limit" {
		t.Fatalf("unexpected block: %+v", block)
	}
}

func TestPairingBlockScopeIsClientAndDesktop(t *testing.T) {
	st := newPairingSecurityStore(t)
	for i := 0; i < 5; i++ {
		_, err := st.RecordPairingFailure(store.PairingClientMetadata{
			ClientID:        "phone-a",
			DesktopDeviceID: "desktop-1",
			ClientName:      "Nick iPhone",
			Platform:        "ios",
		}, 5)
		if err != nil {
			t.Fatalf("RecordPairingFailure: %v", err)
		}
	}

	if block, _ := st.GetActivePairingBlock("phone-a", "desktop-1"); block == nil {
		t.Fatal("expected phone-a to be blocked on desktop-1")
	}
	if block, _ := st.GetActivePairingBlock("phone-a", "desktop-2"); block != nil {
		t.Fatal("did not expect phone-a to be blocked on desktop-2")
	}
	if block, _ := st.GetActivePairingBlock("phone-b", "desktop-1"); block != nil {
		t.Fatal("did not expect phone-b to be blocked on desktop-1")
	}
}

func TestClearPairingBlockClearsRateLimitButDoesNotAuthorize(t *testing.T) {
	st := newPairingSecurityStore(t)
	meta := store.PairingClientMetadata{ClientID: "phone-a", DesktopDeviceID: "desktop-1", ClientName: "Nick iPhone"}
	for i := 0; i < 5; i++ {
		if _, err := st.RecordPairingFailure(meta, 5); err != nil {
			t.Fatalf("RecordPairingFailure: %v", err)
		}
	}

	if err := st.ClearPairingBlock("phone-a", "desktop-1"); err != nil {
		t.Fatalf("ClearPairingBlock: %v", err)
	}
	if block, _ := st.GetActivePairingBlock("phone-a", "desktop-1"); block != nil {
		t.Fatal("expected active block to be cleared")
	}

	result, err := st.RecordPairingFailure(meta, 5)
	if err != nil {
		t.Fatalf("RecordPairingFailure after clear: %v", err)
	}
	if result.FailedAttempts != 1 || result.Blocked {
		t.Fatalf("expected rate limit to restart after clear, got %+v", result)
	}

	if _, err := st.GetPairedDevice("phone-a"); err == nil {
		t.Fatal("clearing a block must not authorize a device")
	}
}

func TestPairingManagementListsActiveRowsAndRecentAttempts(t *testing.T) {
	st := newPairingSecurityStore(t)
	now := "2026-06-10T01:00:00Z"
	if err := st.UpsertPairedDevice(store.PairedDevice{
		ClientID:         "phone-a",
		ClientName:       "Nick iPhone",
		Platform:         "ios",
		PairingID:        "pairing-a",
		PairingTokenHash: "hash-a",
		CreatedAt:        now,
		LastSeenAt:       now,
	}); err != nil {
		t.Fatalf("UpsertPairedDevice: %v", err)
	}
	if err := st.RecordPairingAttempt(store.PairingClientMetadata{
		ClientID:        "phone-b",
		DesktopDeviceID: "desktop-1",
		ClientName:      "Blocked Phone",
		Platform:        "android",
		IP:              "192.168.1.30",
	}, store.PairingAttemptBlocked, "PAIRING_CLIENT_BLOCKED"); err != nil {
		t.Fatalf("RecordPairingAttempt: %v", err)
	}
	for i := 0; i < 5; i++ {
		if _, err := st.RecordPairingFailure(store.PairingClientMetadata{
			ClientID:        "phone-b",
			DesktopDeviceID: "desktop-1",
			ClientName:      "Blocked Phone",
			Platform:        "android",
			IP:              "192.168.1.30",
		}, 5); err != nil {
			t.Fatalf("RecordPairingFailure: %v", err)
		}
	}

	authorized, err := st.ListAuthorizedDevices()
	if err != nil {
		t.Fatalf("ListAuthorizedDevices: %v", err)
	}
	if len(authorized) != 1 || authorized[0].ClientID != "phone-a" {
		t.Fatalf("unexpected authorized list: %+v", authorized)
	}

	blocked, err := st.ListBlockedPairingClients()
	if err != nil {
		t.Fatalf("ListBlockedPairingClients: %v", err)
	}
	if len(blocked) != 1 || blocked[0].ClientID != "phone-b" {
		t.Fatalf("unexpected blocked list: %+v", blocked)
	}

	attempts, err := st.ListRecentPairingAttempts(50)
	if err != nil {
		t.Fatalf("ListRecentPairingAttempts: %v", err)
	}
	if len(attempts) == 0 || attempts[0].ClientID == "" {
		t.Fatalf("expected recent attempts, got %+v", attempts)
	}
}
```

- [ ] **Step 2: Run the focused store tests and confirm failure**

Run:

```bash
cd services/sidecar-go && go test ./internal/store -run 'TestRecordPairingFailure|TestPairingBlockScope|TestClearPairingBlock|TestPairingManagementLists' -count=1
```

Expected: FAIL because the store methods do not exist.

- [ ] **Step 3: Implement store methods**

Create `services/sidecar-go/internal/store/pairing_security.go`:

```go
package store

import (
	"database/sql"
	"errors"
	"fmt"
	"time"
)

const pairingBlockReasonWrongCodeLimit = "wrong_connection_code_limit"

func nullString(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func scanNullableString(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}

func (s *Store) RecordPairingAttempt(meta PairingClientMetadata, result PairingAttemptResult, failureReason string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := s.db.Exec(`
		INSERT INTO pairing_attempts (
			client_id, desktop_device_id, client_name, device_alias, platform,
			stable_device_id, ip, result, failure_reason, created_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		meta.ClientID,
		meta.DesktopDeviceID,
		nullString(meta.ClientName),
		nullString(meta.DeviceAlias),
		nullString(meta.Platform),
		nullString(meta.StableDeviceID),
		nullString(meta.IP),
		string(result),
		nullString(failureReason),
		now,
	)
	if err != nil {
		return fmt.Errorf("record pairing attempt %q/%q: %w", meta.ClientID, meta.DesktopDeviceID, err)
	}
	return nil
}

func (s *Store) RecordPairingFailure(meta PairingClientMetadata, maxAttempts int) (PairingFailureResult, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return PairingFailureResult{}, fmt.Errorf("begin pairing failure transaction: %w", err)
	}
	defer tx.Rollback()

	now := time.Now().UTC().Format(time.RFC3339)
	if _, err := tx.Exec(`
		INSERT INTO pairing_attempts (
			client_id, desktop_device_id, client_name, device_alias, platform,
			stable_device_id, ip, result, failure_reason, created_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		meta.ClientID, meta.DesktopDeviceID, nullString(meta.ClientName), nullString(meta.DeviceAlias),
		nullString(meta.Platform), nullString(meta.StableDeviceID), nullString(meta.IP),
		string(PairingAttemptWrongCode), "PAIRING_CODE_INVALID", now,
	); err != nil {
		return PairingFailureResult{}, fmt.Errorf("insert wrong-code attempt: %w", err)
	}

	if _, err := tx.Exec(`
		INSERT INTO pairing_rate_limits (client_id, desktop_device_id, failed_count, first_failed_at, last_failed_at, updated_at)
		VALUES (?, ?, 1, ?, ?, ?)
		ON CONFLICT(client_id, desktop_device_id) DO UPDATE SET
			failed_count = pairing_rate_limits.failed_count + 1,
			last_failed_at = excluded.last_failed_at,
			updated_at = excluded.updated_at`,
		meta.ClientID, meta.DesktopDeviceID, now, now, now,
	); err != nil {
		return PairingFailureResult{}, fmt.Errorf("upsert pairing rate limit: %w", err)
	}

	var failedCount int
	if err := tx.QueryRow(`
		SELECT failed_count
		FROM pairing_rate_limits
		WHERE client_id = ? AND desktop_device_id = ?`,
		meta.ClientID,
		meta.DesktopDeviceID,
	).Scan(&failedCount); err != nil {
		return PairingFailureResult{}, fmt.Errorf("read pairing rate limit: %w", err)
	}

	blocked := failedCount >= maxAttempts
	if blocked {
		if _, err := tx.Exec(`
			INSERT INTO blocked_pairing_clients (
				client_id, desktop_device_id, client_name, device_alias, platform,
				stable_device_id, last_ip, failed_attempts, blocked_at, last_attempt_at, reason
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(client_id, desktop_device_id) WHERE cleared_at IS NULL DO UPDATE SET
				client_name = excluded.client_name,
				device_alias = excluded.device_alias,
				platform = excluded.platform,
				stable_device_id = excluded.stable_device_id,
				last_ip = excluded.last_ip,
				failed_attempts = excluded.failed_attempts,
				last_attempt_at = excluded.last_attempt_at`,
			meta.ClientID, meta.DesktopDeviceID, nullString(meta.ClientName), nullString(meta.DeviceAlias),
			nullString(meta.Platform), nullString(meta.StableDeviceID), nullString(meta.IP),
			failedCount, now, now, pairingBlockReasonWrongCodeLimit,
		); err != nil {
			return PairingFailureResult{}, fmt.Errorf("upsert active pairing block: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return PairingFailureResult{}, fmt.Errorf("commit pairing failure transaction: %w", err)
	}

	remaining := maxAttempts - failedCount
	if remaining < 0 {
		remaining = 0
	}
	return PairingFailureResult{
		FailedAttempts: failedCount,
		RemainingAttempts: remaining,
		MaxAttempts: maxAttempts,
		Blocked: blocked,
	}, nil
}

func (s *Store) ClearPairingFailures(clientID, desktopDeviceID string) error {
	_, err := s.db.Exec(
		"DELETE FROM pairing_rate_limits WHERE client_id = ? AND desktop_device_id = ?",
		clientID,
		desktopDeviceID,
	)
	if err != nil {
		return fmt.Errorf("clear pairing failures %q/%q: %w", clientID, desktopDeviceID, err)
	}
	return nil
}

func (s *Store) GetActivePairingBlock(clientID, desktopDeviceID string) (*BlockedPairingClient, error) {
	row := s.db.QueryRow(`
		SELECT client_id, desktop_device_id, client_name, device_alias, platform,
		       stable_device_id, last_ip, failed_attempts, blocked_at, last_attempt_at,
		       reason, cleared_at, cleared_by
		FROM blocked_pairing_clients
		WHERE client_id = ? AND desktop_device_id = ? AND cleared_at IS NULL`,
		clientID,
		desktopDeviceID,
	)
	block, err := scanBlockedPairingClient(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get active pairing block %q/%q: %w", clientID, desktopDeviceID, err)
	}
	return block, nil
}

func (s *Store) TouchActivePairingBlock(meta PairingClientMetadata) error {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := s.db.Exec(`
		UPDATE blocked_pairing_clients
		SET last_attempt_at = ?, last_ip = COALESCE(?, last_ip)
		WHERE client_id = ? AND desktop_device_id = ? AND cleared_at IS NULL`,
		now,
		nullString(meta.IP),
		meta.ClientID,
		meta.DesktopDeviceID,
	)
	if err != nil {
		return fmt.Errorf("touch active pairing block %q/%q: %w", meta.ClientID, meta.DesktopDeviceID, err)
	}
	return nil
}

func (s *Store) ClearPairingBlock(clientID, desktopDeviceID string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin clear pairing block transaction: %w", err)
	}
	defer tx.Rollback()

	now := time.Now().UTC().Format(time.RFC3339)
	result, err := tx.Exec(`
		UPDATE blocked_pairing_clients
		SET cleared_at = ?, cleared_by = 'desktop_user'
		WHERE client_id = ? AND desktop_device_id = ? AND cleared_at IS NULL`,
		now,
		clientID,
		desktopDeviceID,
	)
	if err != nil {
		return fmt.Errorf("clear pairing block %q/%q: %w", clientID, desktopDeviceID, err)
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		return fmt.Errorf("clear pairing block %q/%q: %w", clientID, desktopDeviceID, ErrNoRows)
	}
	if _, err := tx.Exec(
		"DELETE FROM pairing_rate_limits WHERE client_id = ? AND desktop_device_id = ?",
		clientID,
		desktopDeviceID,
	); err != nil {
		return fmt.Errorf("clear pairing rate limit %q/%q: %w", clientID, desktopDeviceID, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit clear pairing block transaction: %w", err)
	}
	return nil
}
```

Continue the same file with list helpers:

```go
func displayName(deviceAlias, clientName *string, clientID string) string {
	if deviceAlias != nil && *deviceAlias != "" {
		return *deviceAlias
	}
	if clientName != nil && *clientName != "" {
		return *clientName
	}
	return clientID
}

func scanBlockedPairingClient(scanner interface {
	Scan(dest ...any) error
}) (*BlockedPairingClient, error) {
	var block BlockedPairingClient
	var clientName, deviceAlias, platform, stableDeviceID, lastIP, clearedAt, clearedBy sql.NullString
	err := scanner.Scan(
		&block.ClientID,
		&block.DesktopDeviceID,
		&clientName,
		&deviceAlias,
		&platform,
		&stableDeviceID,
		&lastIP,
		&block.FailedAttempts,
		&block.BlockedAt,
		&block.LastAttemptAt,
		&block.Reason,
		&clearedAt,
		&clearedBy,
	)
	if err != nil {
		return nil, err
	}
	block.ClientName = scanNullableString(clientName)
	block.DeviceAlias = scanNullableString(deviceAlias)
	block.Platform = scanNullableString(platform)
	block.StableDeviceID = scanNullableString(stableDeviceID)
	block.LastIP = scanNullableString(lastIP)
	block.ClearedAt = scanNullableString(clearedAt)
	block.ClearedBy = scanNullableString(clearedBy)
	return &block, nil
}

func (s *Store) ListAuthorizedDevices() ([]PairedDevice, error) {
	rows, err := s.db.Query(`
		SELECT client_id, client_name, device_alias, last_ip, platform, pairing_id,
		       pairing_token_hash, created_at, last_seen_at, revoked_at, receive_dir_name, stable_device_id
		FROM paired_devices
		WHERE revoked_at IS NULL
		ORDER BY last_seen_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("list authorized devices: %w", err)
	}
	defer rows.Close()

	var devices []PairedDevice
	for rows.Next() {
		var d PairedDevice
		if err := rows.Scan(
			&d.ClientID, &d.ClientName, &d.DeviceAlias, &d.LastIP, &d.Platform,
			&d.PairingID, &d.PairingTokenHash, &d.CreatedAt, &d.LastSeenAt, &d.RevokedAt,
			&d.ReceiveDirName, &d.StableDeviceID,
		); err != nil {
			return nil, fmt.Errorf("scan authorized device: %w", err)
		}
		devices = append(devices, d)
	}
	return devices, rows.Err()
}

func (s *Store) ListBlockedPairingClients() ([]BlockedPairingClient, error) {
	rows, err := s.db.Query(`
		SELECT client_id, desktop_device_id, client_name, device_alias, platform,
		       stable_device_id, last_ip, failed_attempts, blocked_at, last_attempt_at,
		       reason, cleared_at, cleared_by
		FROM blocked_pairing_clients
		WHERE cleared_at IS NULL
		ORDER BY blocked_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("list blocked pairing clients: %w", err)
	}
	defer rows.Close()

	var blocks []BlockedPairingClient
	for rows.Next() {
		block, err := scanBlockedPairingClient(rows)
		if err != nil {
			return nil, fmt.Errorf("scan blocked pairing client: %w", err)
		}
		blocks = append(blocks, *block)
	}
	return blocks, rows.Err()
}

func (s *Store) ListRecentPairingAttempts(limit int) ([]PairingAttempt, error) {
	if limit <= 0 || limit > 50 {
		limit = 50
	}
	rows, err := s.db.Query(`
		SELECT id, client_id, desktop_device_id, client_name, device_alias, platform,
		       stable_device_id, ip, result, failure_reason, created_at
		FROM pairing_attempts
		ORDER BY created_at DESC, id DESC
		LIMIT ?`, limit)
	if err != nil {
		return nil, fmt.Errorf("list recent pairing attempts: %w", err)
	}
	defer rows.Close()

	var attempts []PairingAttempt
	for rows.Next() {
		var attempt PairingAttempt
		var clientName, deviceAlias, platform, stableDeviceID, ip, failureReason sql.NullString
		var result string
		if err := rows.Scan(
			&attempt.ID,
			&attempt.ClientID,
			&attempt.DesktopDeviceID,
			&clientName,
			&deviceAlias,
			&platform,
			&stableDeviceID,
			&ip,
			&result,
			&failureReason,
			&attempt.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan pairing attempt: %w", err)
		}
		attempt.ClientName = scanNullableString(clientName)
		attempt.DeviceAlias = scanNullableString(deviceAlias)
		attempt.Platform = scanNullableString(platform)
		attempt.StableDeviceID = scanNullableString(stableDeviceID)
		attempt.IP = scanNullableString(ip)
		attempt.Result = PairingAttemptResult(result)
		attempt.FailureReason = scanNullableString(failureReason)
		attempts = append(attempts, attempt)
	}
	return attempts, rows.Err()
}
```

- [ ] **Step 4: Run store tests**

Run:

```bash
cd services/sidecar-go && go test ./internal/store -count=1
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/sidecar-go/internal/store/pairing_security.go services/sidecar-go/internal/store/pairing_security_test.go
git commit -m "feat: add pairing security store operations"
```

---

### Task 4: Sidecar Pairing Flow Enforcement

**Files:**
- Modify: `services/sidecar-go/internal/protocol/messages.go`
- Modify: `services/sidecar-go/internal/server/handler_hello.go`
- Modify: `services/sidecar-go/internal/server/connection_test.go`

- [ ] **Step 1: Add protocol metadata fields**

Modify `services/sidecar-go/internal/protocol/messages.go`:

```go
type PairingErrorMetadata struct {
	FailedAttempts   int `json:"failedAttempts,omitempty"`
	RemainingAttempts int `json:"remainingAttempts,omitempty"`
	MaxAttempts      int `json:"maxAttempts,omitempty"`
}

type PairRes struct {
	OK           bool                 `json:"ok"`
	Error        string               `json:"error,omitempty"`
	ErrorCode    string               `json:"errorCode,omitempty"`
	ErrorMeta    *PairingErrorMetadata `json:"errorMeta,omitempty"`
	PairingID    string               `json:"pairingId"`
	PairingToken string               `json:"pairingToken"`
	ServerInfo   ServerInfo           `json:"serverInfo"`
}

type ErrorMsg struct {
	Code    string               `json:"code"`
	Message string               `json:"message"`
	Meta    *PairingErrorMetadata `json:"meta,omitempty"`
}
```

- [ ] **Step 2: Add failing pairing flow tests**

Add these helpers and tests to `services/sidecar-go/internal/server/connection_test.go`:

```go
func sendPairingHello(t *testing.T, client net.Conn, clientID string) protocol.HelloRes {
	t.Helper()
	sendJSON(t, client, protocol.TypeHelloReq, protocol.HelloReq{
		ClientID:                clientID,
		ClientName:              testClientName,
		ClientPlatform:          "ios",
		AppVersion:              "1.0.0",
		AppCompatibilityVersion: protocol.AppCompatibilityVersion,
		AppState:                "active",
		DeviceAlias:             "Nick iPhone",
		StableDeviceID:          clientID + "-stable",
	})

	var helloRes protocol.HelloRes
	recvJSON(t, client, protocol.TypeHelloRes, &helloRes)
	if !helloRes.AuthRequired {
		t.Fatalf("expected authRequired=true for %s", clientID)
	}
	return helloRes
}

func sendPairRequest(t *testing.T, client net.Conn, clientID, code string) protocol.PairRes {
	t.Helper()
	sendJSON(t, client, protocol.TypePairReq, protocol.PairReq{
		ClientID:       clientID,
		ClientName:     testClientName,
		ConnectionCode: code,
		DeviceAlias:    "Nick iPhone",
		StableDeviceID: clientID + "-stable",
	})

	var pairRes protocol.PairRes
	recvJSON(t, client, protocol.TypePairRes, &pairRes)
	return pairRes
}

func pairClientWithCode(t *testing.T, client net.Conn, clientID, code string) protocol.PairRes {
	t.Helper()
	sendPairingHello(t, client, clientID)
	return sendPairRequest(t, client, clientID, code)
}

func pairingTestMeta(clientID, desktopID string) store.PairingClientMetadata {
	return store.PairingClientMetadata{
		ClientID:        clientID,
		DesktopDeviceID: desktopID,
		ClientName:      testClientName,
		DeviceAlias:     "Nick iPhone",
		Platform:        "ios",
		StableDeviceID:  clientID + "-stable",
		IP:              "127.0.0.1",
	}
}

func TestWrongConnectionCodeBlocksOnFifthAttempt(t *testing.T) {
	client, st, cfg, cleanup := setupTestConnection(t)
	defer cleanup()
	if err := st.SetSetting("device_id", "desktop-1"); err != nil {
		t.Fatalf("SetSetting device_id: %v", err)
	}

	for attempt := 1; attempt <= 5; attempt++ {
		if attempt > 1 {
			var cleanupAttempt func()
			client, cleanupAttempt = setupTestConnectionWithStore(t, st, cfg)
			defer cleanupAttempt()
		}

		pairRes := pairClientWithCode(t, client, "phone-a", "000000")
		if pairRes.OK {
			t.Fatalf("attempt %d expected failed pairing", attempt)
		}
		if pairRes.ErrorMeta == nil {
			t.Fatalf("attempt %d missing errorMeta", attempt)
		}
		if pairRes.ErrorMeta.FailedAttempts != attempt {
			t.Fatalf("attempt %d failedAttempts=%d", attempt, pairRes.ErrorMeta.FailedAttempts)
		}
		if pairRes.ErrorMeta.MaxAttempts != 5 {
			t.Fatalf("attempt %d maxAttempts=%d", attempt, pairRes.ErrorMeta.MaxAttempts)
		}

		if attempt < 5 {
			if pairRes.ErrorCode != "PAIRING_CODE_INVALID" {
				t.Fatalf("attempt %d errorCode=%q", attempt, pairRes.ErrorCode)
			}
			wantRemaining := 5 - attempt
			if pairRes.ErrorMeta.RemainingAttempts != wantRemaining {
				t.Fatalf("attempt %d remainingAttempts=%d want %d", attempt, pairRes.ErrorMeta.RemainingAttempts, wantRemaining)
			}
			client.Close()
			time.Sleep(50 * time.Millisecond)
			continue
		}

		if pairRes.ErrorCode != "PAIRING_CLIENT_BLOCKED" {
			t.Fatalf("attempt 5 errorCode=%q", pairRes.ErrorCode)
		}
		if pairRes.ErrorMeta.RemainingAttempts != 0 {
			t.Fatalf("attempt 5 remainingAttempts=%d", pairRes.ErrorMeta.RemainingAttempts)
		}
	}

	block, err := st.GetActivePairingBlock("phone-a", "desktop-1")
	if err != nil {
		t.Fatalf("GetActivePairingBlock: %v", err)
	}
	if block == nil {
		t.Fatal("expected active block for phone-a on desktop-1")
	}
}

func TestBlockedClientRejectedAtHelloBeforePairReq(t *testing.T) {
	client, st, _, cleanup := setupTestConnection(t)
	defer cleanup()
	if err := st.SetSetting("device_id", "desktop-1"); err != nil {
		t.Fatalf("SetSetting device_id: %v", err)
	}
	meta := pairingTestMeta("phone-a", "desktop-1")
	for i := 0; i < 5; i++ {
		if _, err := st.RecordPairingFailure(meta, 5); err != nil {
			t.Fatalf("RecordPairingFailure %d: %v", i+1, err)
		}
	}

	sendJSON(t, client, protocol.TypeHelloReq, protocol.HelloReq{
		ClientID:                "phone-a",
		ClientName:              testClientName,
		ClientPlatform:          "ios",
		AppVersion:              "1.0.0",
		AppCompatibilityVersion: protocol.AppCompatibilityVersion,
		AppState:                "active",
	})
	var errMsg protocol.ErrorMsg
	recvJSON(t, client, protocol.TypeError, &errMsg)
	if errMsg.Code != "PAIRING_CLIENT_BLOCKED" {
		t.Fatalf("error code=%q", errMsg.Code)
	}

	attempts, err := st.ListRecentPairingAttempts(1)
	if err != nil {
		t.Fatalf("ListRecentPairingAttempts: %v", err)
	}
	if len(attempts) != 1 || attempts[0].Result != store.PairingAttemptBlocked {
		t.Fatalf("latest attempt=%+v", attempts)
	}
}

func TestPairingBlockDoesNotAffectOtherDesktopOrClient(t *testing.T) {
	client1, st1, cfg1, cleanup1 := setupTestConnection(t)
	defer cleanup1()
	client1.Close()
	if err := st1.SetSetting("device_id", "desktop-1"); err != nil {
		t.Fatalf("SetSetting desktop-1: %v", err)
	}
	meta := pairingTestMeta("phone-a", "desktop-1")
	for i := 0; i < 5; i++ {
		if _, err := st1.RecordPairingFailure(meta, 5); err != nil {
			t.Fatalf("RecordPairingFailure desktop-1 %d: %v", i+1, err)
		}
	}

	client2, st2, _, cleanup2 := setupTestConnection(t)
	defer cleanup2()
	if err := st2.SetSetting("device_id", "desktop-2"); err != nil {
		t.Fatalf("SetSetting desktop-2: %v", err)
	}
	pairOnDesktop2 := pairClientWithCode(t, client2, "phone-a", testConnCode)
	if !pairOnDesktop2.OK {
		t.Fatalf("phone-a should pair on desktop-2: %+v", pairOnDesktop2)
	}

	clientB, cleanupB := setupTestConnectionWithStore(t, st1, cfg1)
	defer cleanupB()
	pairPhoneB := pairClientWithCode(t, clientB, "phone-b", testConnCode)
	if !pairPhoneB.OK {
		t.Fatalf("phone-b should pair on desktop-1: %+v", pairPhoneB)
	}
}

func TestRevokedDeviceCannotUseOldTokenButCanRepairWithCorrectCode(t *testing.T) {
	client, st, cfg, cleanup := setupTestConnection(t)
	defer cleanup()
	pairingToken := doPairing(t, client)
	client.Close()
	if err := st.RevokePairedDevice(testClientID); err != nil {
		t.Fatalf("RevokePairedDevice: %v", err)
	}

	client2, cleanup2 := setupTestConnectionWithStore(t, st, cfg)
	defer cleanup2()
	sendJSON(t, client2, protocol.TypeHelloReq, protocol.HelloReq{
		ClientID:                testClientID,
		ClientName:              testClientName,
		ClientPlatform:          "ios",
		AppVersion:              "1.0.0",
		AppCompatibilityVersion: protocol.AppCompatibilityVersion,
		PairingToken:            pairingToken,
		AppState:                "active",
	})

	var helloRes protocol.HelloRes
	recvJSON(t, client2, protocol.TypeHelloRes, &helloRes)
	if !helloRes.AuthRequired {
		t.Fatal("expected revoked device to require pairing")
	}
	if helloRes.Bound {
		t.Fatal("expected revoked device to be unbound")
	}

	pairRes := sendPairRequest(t, client2, testClientID, testConnCode)
	if !pairRes.OK {
		t.Fatalf("repair failed: %+v", pairRes)
	}
	if pairRes.PairingToken == "" {
		t.Fatal("new pairing token is empty")
	}
	if pairRes.PairingToken == pairingToken {
		t.Fatal("expected a new pairing token after repair")
	}
}
```

- [ ] **Step 3: Run the focused server tests and confirm failure**

Run:

```bash
cd services/sidecar-go && go test ./internal/server -run 'TestWrongConnectionCodeBlocks|TestBlockedClientRejected|TestPairingBlockDoesNotAffect|TestRevokedDeviceCannotUseOldToken' -count=1
```

Expected: FAIL because handler behavior is not implemented.

- [ ] **Step 4: Add pairing constants and metadata helpers**

In `services/sidecar-go/internal/server/handler_hello.go`, add constants near the top:

```go
const (
	pairingMaxWrongCodeAttempts = 5
	errorPairingCodeInvalid     = "PAIRING_CODE_INVALID"
	errorPairingClientBlocked   = "PAIRING_CLIENT_BLOCKED"
	errorPairTokenInvalid       = "PAIR_TOKEN_INVALID"
	errorAppVersionIncompatible = "APP_VERSION_INCOMPATIBLE"
)
```

Add helper methods:

```go
func (c *connection) pairingClientMetadata(clientID, clientName, deviceAlias, stableDeviceID string) store.PairingClientMetadata {
	desktopDeviceID, _ := c.store.GetDeviceID()
	serverName, _ := c.store.GetDeviceName()
	return store.PairingClientMetadata{
		ClientID:        clientID,
		DesktopDeviceID: desktopDeviceID,
		ClientName:      clientName,
		DeviceAlias:     normalizeClientDeviceAlias(deviceAlias, serverName),
		Platform:        c.clientPlatform,
		StableDeviceID:  stableDeviceID,
		IP:              c.clientIP,
	}
}

func pairingErrorMeta(result store.PairingFailureResult) *protocol.PairingErrorMetadata {
	return &protocol.PairingErrorMetadata{
		FailedAttempts:   result.FailedAttempts,
		RemainingAttempts: result.RemainingAttempts,
		MaxAttempts:      result.MaxAttempts,
	}
}

func (c *connection) rejectPairingBlocked(meta store.PairingClientMetadata) error {
	_ = c.store.RecordPairingAttempt(meta, store.PairingAttemptBlocked, errorPairingClientBlocked)
	_ = c.store.TouchActivePairingBlock(meta)
	return c.rejectWithError(errorPairingClientBlocked, "This mobile client is blocked on this desktop")
}
```

- [ ] **Step 5: Enforce block in `handleHello`**

In `handleHello`, after `c.clientID`, `c.clientIP`, and `c.clientPlatform` are set and after `serverID` is known, add:

```go
	meta := c.pairingClientMetadata(req.ClientID, req.ClientName, req.DeviceAlias, req.StableDeviceID)
	if block, err := c.store.GetActivePairingBlock(meta.ClientID, meta.DesktopDeviceID); err != nil {
		return fmt.Errorf("check active pairing block: %w", err)
	} else if block != nil {
		return c.rejectPairingBlocked(meta)
	}
```

For incompatible app versions, change the string literal code to `errorAppVersionIncompatible` and call `RecordPairingAttempt` only after `desktopDeviceId` can be read:

```go
_ = c.store.RecordPairingAttempt(
	store.PairingClientMetadata{
		ClientID:        req.ClientID,
		DesktopDeviceID: serverID,
		ClientName:      req.ClientName,
		DeviceAlias:     req.DeviceAlias,
		Platform:        req.ClientPlatform,
		StableDeviceID:  req.StableDeviceID,
		IP:              preferredClientIP(req.ClientIP, c.conn),
	},
	store.PairingAttemptIncompatible,
	errorAppVersionIncompatible,
)
```

- [ ] **Step 6: Enforce block and wrong-code tracking in `handlePair`**

At the start of `handlePair`, after decoding `protocol.PairReq`, set metadata:

```go
c.clientID = req.ClientID
c.clientIP = preferredClientIP(req.ClientIP, c.conn)
meta := c.pairingClientMetadata(req.ClientID, req.ClientName, req.DeviceAlias, req.StableDeviceID)
if block, err := c.store.GetActivePairingBlock(meta.ClientID, meta.DesktopDeviceID); err != nil {
	return fmt.Errorf("check active pairing block before pair: %w", err)
} else if block != nil {
	_ = c.store.RecordPairingAttempt(meta, store.PairingAttemptBlocked, errorPairingClientBlocked)
	_ = c.store.TouchActivePairingBlock(meta)
	_ = c.sendJSON(protocol.TypePairRes, protocol.PairRes{
		OK:        false,
		Error:     "client blocked",
		ErrorCode: errorPairingClientBlocked,
		ErrorMeta: &protocol.PairingErrorMetadata{
			FailedAttempts:   block.FailedAttempts,
			RemainingAttempts: 0,
			MaxAttempts:      pairingMaxWrongCodeAttempts,
		},
	})
	return fmt.Errorf("blocked pairing client %s", req.ClientID)
}
```

Replace the existing wrong-code branch with:

```go
if req.ConnectionCode != expectedCode {
	slog.Warn("pair rejected: wrong connection code", "clientID", req.ClientID)
	result, recordErr := c.store.RecordPairingFailure(meta, pairingMaxWrongCodeAttempts)
	if recordErr != nil {
		return fmt.Errorf("record pairing failure: %w", recordErr)
	}
	code := errorPairingCodeInvalid
	message := "connection code invalid"
	if result.Blocked {
		code = errorPairingClientBlocked
		message = "client blocked"
	}
	_ = c.sendJSON(protocol.TypePairRes, protocol.PairRes{
		OK:        false,
		Error:     message,
		ErrorCode: code,
		ErrorMeta: pairingErrorMeta(result),
	})
	return fmt.Errorf("invalid connection code from %s", req.ClientID)
}
```

After successful `PairDeviceWithDirName`, record success and clear the active rate-limit row:

```go
if err := c.store.RecordPairingAttempt(meta, store.PairingAttemptSuccess, ""); err != nil {
	slog.Warn("failed to record successful pairing attempt", "clientID", req.ClientID, "err", err)
}
if err := c.store.ClearPairingFailures(meta.ClientID, meta.DesktopDeviceID); err != nil {
	slog.Warn("failed to clear pairing failures after success", "clientID", req.ClientID, "err", err)
}
```

- [ ] **Step 7: Use canonical token-invalid error code**

At the start of `handleAuth`, after `GetPairedDevice(c.clientID)` succeeds and before HMAC comparison, add a race-closing active-block check:

```go
desktopDeviceID, _ := c.store.GetDeviceID()
if block, err := c.store.GetActivePairingBlock(c.clientID, desktopDeviceID); err != nil {
	return fmt.Errorf("check active pairing block before auth: %w", err)
} else if block != nil {
	meta := store.PairingClientMetadata{
		ClientID:        c.clientID,
		DesktopDeviceID: desktopDeviceID,
		ClientName:      device.ClientName,
		Platform:        device.Platform,
		IP:              c.clientIP,
	}
	if device.DeviceAlias != nil {
		meta.DeviceAlias = *device.DeviceAlias
	}
	if device.StableDeviceID != nil {
		meta.StableDeviceID = *device.StableDeviceID
	}
	_ = c.store.RecordPairingAttempt(meta, store.PairingAttemptBlocked, errorPairingClientBlocked)
	_ = c.store.TouchActivePairingBlock(meta)
	_ = c.sendError(errorPairingClientBlocked, "This mobile client is blocked on this desktop")
	return fmt.Errorf("blocked client attempted auth %s failedAttempts=%d", c.clientID, block.FailedAttempts)
}
```

Then replace the token-invalid string literal:

```go
_ = c.sendError(errorPairTokenInvalid, "HMAC verification failed")
```

- [ ] **Step 8: Run server tests**

Run:

```bash
cd services/sidecar-go && go test ./internal/server -count=1
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add services/sidecar-go/internal/protocol/messages.go services/sidecar-go/internal/server/handler_hello.go services/sidecar-go/internal/server/connection_test.go
git commit -m "feat: enforce local pairing block rules"
```

---

### Task 5: Sidecar HTTP Management API and Code Regeneration Semantics

**Files:**
- Modify: `services/sidecar-go/internal/api/router.go`
- Create: `services/sidecar-go/internal/api/handlers_connection_devices.go`
- Modify: `services/sidecar-go/internal/api/handlers_code.go`
- Modify: `services/sidecar-go/internal/api/router_test.go`

- [ ] **Step 1: Add failing HTTP API tests**

Append to `services/sidecar-go/internal/api/router_test.go`:

```go
func TestConnectionDevicesEndpointReturnsAuthorizedBlockedAndRecentAttempts(t *testing.T) {
	st, cfg, hub := testEnv(t)
	now := time.Now().UTC().Format(time.RFC3339)
	insertPairedDeviceWithStableID(t, st, "phone-a", "Nick iPhone", "phone-a", "stable-a", now)
	for i := 0; i < 5; i++ {
		if _, err := st.RecordPairingFailure(store.PairingClientMetadata{
			ClientID:        "phone-b",
			DesktopDeviceID: "desktop-1",
			ClientName:      "Blocked Phone",
			Platform:        "android",
			IP:              "192.168.1.30",
		}, 5); err != nil {
			t.Fatalf("RecordPairingFailure: %v", err)
		}
	}

	_, handler := api.NewServer(st, cfg, hub, fakeClientStates{"phone-a": "connected"})
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/settings/connection-devices")
	if err != nil {
		t.Fatalf("GET connection devices: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	var body struct {
		AuthorizedDevices []map[string]any `json:"authorizedDevices"`
		BlockedClients    []map[string]any `json:"blockedClients"`
		RecentAttempts    []map[string]any `json:"recentAttempts"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body.AuthorizedDevices) != 1 || body.AuthorizedDevices[0]["clientId"] != "phone-a" {
		t.Fatalf("unexpected authorized devices: %+v", body.AuthorizedDevices)
	}
	if body.AuthorizedDevices[0]["status"] != "connected" {
		t.Fatalf("expected connected status, got %+v", body.AuthorizedDevices[0])
	}
	if len(body.BlockedClients) != 1 || body.BlockedClients[0]["clientId"] != "phone-b" {
		t.Fatalf("unexpected blocked clients: %+v", body.BlockedClients)
	}
	if len(body.RecentAttempts) == 0 {
		t.Fatal("expected recent attempts")
	}
}

func TestRevokeAuthorizedDeviceEndpointDoesNotDeleteHistory(t *testing.T) {
	st, cfg, hub := testEnv(t)
	now := time.Now().UTC().Format(time.RFC3339)
	insertPairedDeviceWithStableID(t, st, "phone-a", "Nick iPhone", "phone-a", "stable-a", now)
	if _, err := st.DB().Exec(`
		INSERT INTO daily_stats (stat_date, client_id, client_name_snapshot, client_ip_snapshot, file_count, total_bytes, active_transmission_ms, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		"2026-06-10", "phone-a", "Nick iPhone", "192.168.1.20", 2, 100, 50, now,
	); err != nil {
		t.Fatalf("insert daily stats: %v", err)
	}

	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/settings/connection-devices/phone-a/revoke", "application/json", strings.NewReader("{}"))
	if err != nil {
		t.Fatalf("POST revoke: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	device, err := st.GetPairedDevice("phone-a")
	if err != nil {
		t.Fatalf("GetPairedDevice: %v", err)
	}
	if device.RevokedAt == nil {
		t.Fatal("expected revoked_at to be set")
	}
	var statsCount int
	if err := st.DB().QueryRow("SELECT count(*) FROM daily_stats WHERE client_id = ?", "phone-a").Scan(&statsCount); err != nil {
		t.Fatalf("count daily stats: %v", err)
	}
	if statsCount != 1 {
		t.Fatalf("expected daily stats to remain, got %d", statsCount)
	}
}

func TestClearBlockedClientEndpointClearsBlockOnly(t *testing.T) {
	st, cfg, hub := testEnv(t)
	for i := 0; i < 5; i++ {
		if _, err := st.RecordPairingFailure(store.PairingClientMetadata{ClientID: "phone-a", DesktopDeviceID: "desktop-1"}, 5); err != nil {
			t.Fatalf("RecordPairingFailure: %v", err)
		}
	}

	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/settings/blocked-clients/phone-a/clear?desktopDeviceId=desktop-1", "application/json", strings.NewReader("{}"))
	if err != nil {
		t.Fatalf("POST clear block: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	if block, _ := st.GetActivePairingBlock("phone-a", "desktop-1"); block != nil {
		t.Fatal("expected active block to be cleared")
	}
	if _, err := st.GetPairedDevice("phone-a"); err == nil {
		t.Fatal("clearing block must not authorize device")
	}
}

func TestRegenerateConnectionCodeDoesNotRevokeAuthorizedDevices(t *testing.T) {
	st, cfg, hub := testEnv(t)
	now := time.Now().UTC().Format(time.RFC3339)
	insertPairedDeviceWithStableID(t, st, "phone-a", "Nick iPhone", "phone-a", "stable-a", now)

	_, handler := api.NewServer(st, cfg, hub, nil)
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/connection-code/regenerate", "application/json", strings.NewReader("{}"))
	if err != nil {
		t.Fatalf("POST regenerate: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	device, err := st.GetPairedDevice("phone-a")
	if err != nil {
		t.Fatalf("GetPairedDevice: %v", err)
	}
	if device.RevokedAt != nil {
		t.Fatal("regenerating connection code must not revoke authorized devices")
	}
}
```

- [ ] **Step 2: Run focused API tests and confirm failure**

Run:

```bash
cd services/sidecar-go && go test ./internal/api -run 'TestConnectionDevicesEndpoint|TestRevokeAuthorizedDevice|TestClearBlockedClient|TestRegenerateConnectionCodeDoesNotRevoke' -count=1
```

Expected: FAIL because routes and new regeneration behavior are missing.

- [ ] **Step 3: Register HTTP routes**

In `services/sidecar-go/internal/api/router.go`, under the Settings routes, add:

```go
	mux.HandleFunc("GET /settings/connection-devices", withJSON(srv.handleGetConnectionDevices))
	mux.HandleFunc("POST /settings/connection-devices/{clientId}/revoke", withJSON(srv.handleRevokeConnectionDevice))
	mux.HandleFunc("POST /settings/blocked-clients/{clientId}/clear", withJSON(srv.handleClearBlockedClient))
```

- [ ] **Step 4: Implement connection device handlers**

Create `services/sidecar-go/internal/api/handlers_connection_devices.go`:

```go
package api

import (
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"strings"
)

type connectionDeviceDTO struct {
	ClientID       string  `json:"clientId"`
	StableDeviceID *string `json:"stableDeviceId,omitempty"`
	DisplayName    string  `json:"displayName"`
	ClientName     string  `json:"clientName"`
	DeviceAlias    *string `json:"deviceAlias,omitempty"`
	Platform       string  `json:"platform"`
	IP             *string `json:"ip,omitempty"`
	Status         string  `json:"status"`
	AuthorizedAt   string  `json:"authorizedAt"`
	LastSeenAt      string  `json:"lastSeenAt"`
	RevokedAt      *string `json:"revokedAt,omitempty"`
}

type blockedPairingClientDTO struct {
	ClientID       string  `json:"clientId"`
	StableDeviceID *string `json:"stableDeviceId,omitempty"`
	DisplayName    string  `json:"displayName"`
	ClientName     *string `json:"clientName,omitempty"`
	DeviceAlias    *string `json:"deviceAlias,omitempty"`
	Platform       *string `json:"platform,omitempty"`
	LastIP         *string `json:"lastIp,omitempty"`
	FailedAttempts int     `json:"failedAttempts"`
	BlockedAt      string  `json:"blockedAt"`
	LastAttemptAt   string  `json:"lastAttemptAt"`
	Reason         string  `json:"reason"`
}

type pairingAttemptDTO struct {
	ID             int64   `json:"id"`
	ClientID       string  `json:"clientId"`
	StableDeviceID *string `json:"stableDeviceId,omitempty"`
	DisplayName    string  `json:"displayName"`
	ClientName     *string `json:"clientName,omitempty"`
	DeviceAlias    *string `json:"deviceAlias,omitempty"`
	Platform       *string `json:"platform,omitempty"`
	IP             *string `json:"ip,omitempty"`
	Result         string  `json:"result"`
	FailureReason  *string `json:"failureReason,omitempty"`
	CreatedAt      string  `json:"createdAt"`
}

type connectionDevicesSettingsDTO struct {
	AuthorizedDevices []connectionDeviceDTO      `json:"authorizedDevices"`
	BlockedClients    []blockedPairingClientDTO `json:"blockedClients"`
	RecentAttempts    []pairingAttemptDTO       `json:"recentAttempts"`
}

func resolveDisplayName(deviceAlias *string, clientName *string, clientID string) string {
	if deviceAlias != nil && strings.TrimSpace(*deviceAlias) != "" {
		return *deviceAlias
	}
	if clientName != nil && strings.TrimSpace(*clientName) != "" {
		return *clientName
	}
	return clientID
}

func (s *Server) handleGetConnectionDevices(w http.ResponseWriter, _ *http.Request) {
	devices, err := s.store.ListAuthorizedDevices()
	if err != nil {
		slog.Error("list authorized devices", "err", err)
		writeError(w, http.StatusInternalServerError, "failed to list authorized devices")
		return
	}
	blocks, err := s.store.ListBlockedPairingClients()
	if err != nil {
		slog.Error("list blocked pairing clients", "err", err)
		writeError(w, http.StatusInternalServerError, "failed to list blocked clients")
		return
	}
	attempts, err := s.store.ListRecentPairingAttempts(50)
	if err != nil {
		slog.Error("list recent pairing attempts", "err", err)
		writeError(w, http.StatusInternalServerError, "failed to list pairing attempts")
		return
	}

	states := map[string]string{}
	if s.clientStates != nil {
		states = s.clientStates.ConnectedClientStates()
	}

	resp := connectionDevicesSettingsDTO{
		AuthorizedDevices: make([]connectionDeviceDTO, 0, len(devices)),
		BlockedClients:    make([]blockedPairingClientDTO, 0, len(blocks)),
		RecentAttempts:    make([]pairingAttemptDTO, 0, len(attempts)),
	}

	for _, d := range devices {
		status := "authorized"
		if state, ok := states[d.ClientID]; ok && strings.TrimSpace(state) != "" {
			status = "connected"
		}
		clientName := d.ClientName
		resp.AuthorizedDevices = append(resp.AuthorizedDevices, connectionDeviceDTO{
			ClientID:       d.ClientID,
			StableDeviceID: d.StableDeviceID,
			DisplayName:    resolveDisplayName(d.DeviceAlias, &clientName, d.ClientID),
			ClientName:     d.ClientName,
			DeviceAlias:    d.DeviceAlias,
			Platform:       d.Platform,
			IP:             d.LastIP,
			Status:         status,
			AuthorizedAt:   d.CreatedAt,
			LastSeenAt:      d.LastSeenAt,
			RevokedAt:      d.RevokedAt,
		})
	}
	for _, b := range blocks {
		resp.BlockedClients = append(resp.BlockedClients, blockedPairingClientDTO{
			ClientID:       b.ClientID,
			StableDeviceID: b.StableDeviceID,
			DisplayName:    resolveDisplayName(b.DeviceAlias, b.ClientName, b.ClientID),
			ClientName:     b.ClientName,
			DeviceAlias:    b.DeviceAlias,
			Platform:       b.Platform,
			LastIP:         b.LastIP,
			FailedAttempts: b.FailedAttempts,
			BlockedAt:      b.BlockedAt,
			LastAttemptAt:   b.LastAttemptAt,
			Reason:         b.Reason,
		})
	}
	for _, a := range attempts {
		resp.RecentAttempts = append(resp.RecentAttempts, pairingAttemptDTO{
			ID:             a.ID,
			ClientID:       a.ClientID,
			StableDeviceID: a.StableDeviceID,
			DisplayName:    resolveDisplayName(a.DeviceAlias, a.ClientName, a.ClientID),
			ClientName:     a.ClientName,
			DeviceAlias:    a.DeviceAlias,
			Platform:       a.Platform,
			IP:             a.IP,
			Result:         string(a.Result),
			FailureReason:  a.FailureReason,
			CreatedAt:      a.CreatedAt,
		})
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleRevokeConnectionDevice(w http.ResponseWriter, r *http.Request) {
	clientID := r.PathValue("clientId")
	if strings.TrimSpace(clientID) == "" {
		writeError(w, http.StatusBadRequest, "clientId is required")
		return
	}
	if err := s.store.RevokePairedDevice(clientID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "device not found")
			return
		}
		slog.Error("revoke connection device", "clientID", clientID, "err", err)
		writeError(w, http.StatusInternalServerError, "failed to revoke device")
		return
	}
	s.RefreshTunnelPairings("connection_device_revoked")
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleClearBlockedClient(w http.ResponseWriter, r *http.Request) {
	clientID := r.PathValue("clientId")
	desktopDeviceID := r.URL.Query().Get("desktopDeviceId")
	if strings.TrimSpace(desktopDeviceID) == "" {
		var err error
		desktopDeviceID, err = s.store.GetDeviceID()
		if err != nil {
			slog.Error("get desktop device id for clear block", "err", err)
			writeError(w, http.StatusInternalServerError, "failed to resolve desktop device id")
			return
		}
	}
	if err := s.store.ClearPairingBlock(clientID, desktopDeviceID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "active block not found")
			return
		}
		slog.Error("clear blocked client", "clientID", clientID, "desktopDeviceID", desktopDeviceID, "err", err)
		writeError(w, http.StatusInternalServerError, "failed to clear block")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
```

- [ ] **Step 5: Change code regeneration to avoid revocation**

In `services/sidecar-go/internal/api/handlers_code.go`, replace `SetConnectionCodeAndRevokePairedDevices` usage with:

```go
	if err := s.store.SetConnectionCode(code); err != nil {
		slog.Error("rotate connection code", "err", err)
		writeError(w, http.StatusInternalServerError, "failed to regenerate code")
		return
	}
	slog.Info("connection code regenerated")
```

- [ ] **Step 6: Run API tests**

Run:

```bash
cd services/sidecar-go && go test ./internal/api -count=1
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add services/sidecar-go/internal/api/router.go services/sidecar-go/internal/api/handlers_connection_devices.go services/sidecar-go/internal/api/handlers_code.go services/sidecar-go/internal/api/router_test.go
git commit -m "feat: expose connection device management api"
```

---

### Task 6: Desktop Main IPC and Preload Bridge

**Files:**
- Modify: `apps/desktop/src/main/sidecar-client.ts`
- Modify: `apps/desktop/src/main/ipc-handlers.ts`
- Modify: `apps/desktop/src/main/__tests__/sidecar-client.test.ts`
- Modify: `apps/desktop/src/main/__tests__/ipc-handlers.test.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/preload/api.d.ts`
- Modify: `apps/desktop/src/preload/__tests__/index.test.ts`

- [ ] **Step 1: Add failing sidecar-client and IPC tests**

In `apps/desktop/src/main/__tests__/sidecar-client.test.ts`, add tests that start the existing mock HTTP server and assert:

```typescript
it('calls connection device management endpoints', async () => {
  await expect(sidecarClient.getConnectionDevices()).resolves.toEqual({
    authorizedDevices: [],
    blockedClients: [],
    recentAttempts: [],
  });
  await expect(sidecarClient.revokeConnectionDevice('phone-a')).resolves.toEqual({ ok: true });
  await expect(sidecarClient.clearBlockedClient('phone-a')).resolves.toEqual({ ok: true });

  expect(requests.map((request) => `${request.method} ${request.url}`)).toContain(
    'GET /settings/connection-devices',
  );
  expect(requests.map((request) => `${request.method} ${request.url}`)).toContain(
    'POST /settings/connection-devices/phone-a/revoke',
  );
  expect(requests.map((request) => `${request.method} ${request.url}`)).toContain(
    'POST /settings/blocked-clients/phone-a/clear',
  );
});
```

In `apps/desktop/src/main/__tests__/ipc-handlers.test.ts`, assert the handlers call the client:

```typescript
it('registers connection device management IPC handlers', async () => {
  sidecarClient.getConnectionDevices = vi.fn().mockResolvedValue({
    authorizedDevices: [],
    blockedClients: [],
    recentAttempts: [],
  });
  sidecarClient.revokeConnectionDevice = vi.fn().mockResolvedValue({ ok: true });
  sidecarClient.clearBlockedClient = vi.fn().mockResolvedValue({ ok: true });

  registerIpcHandlers(mockSidecarManager);

  await invoke('sidecar:connection-devices');
  await invoke('sidecar:revoke-connection-device', 'phone-a');
  await invoke('sidecar:clear-blocked-client', 'phone-a');

  expect(sidecarClient.getConnectionDevices).toHaveBeenCalled();
  expect(sidecarClient.revokeConnectionDevice).toHaveBeenCalledWith('phone-a');
  expect(sidecarClient.clearBlockedClient).toHaveBeenCalledWith('phone-a');
});
```

In `apps/desktop/src/preload/__tests__/index.test.ts`, add:

```typescript
it('maps connection device management calls to IPC channels', async () => {
  await exposed.api?.sidecar.getConnectionDevices();
  await exposed.api?.sidecar.revokeConnectionDevice('phone-a');
  await exposed.api?.sidecar.clearBlockedClient('phone-a');

  expect(ipcRenderer.invoke).toHaveBeenCalledWith('sidecar:connection-devices');
  expect(ipcRenderer.invoke).toHaveBeenCalledWith('sidecar:revoke-connection-device', 'phone-a');
  expect(ipcRenderer.invoke).toHaveBeenCalledWith('sidecar:clear-blocked-client', 'phone-a');
});
```

- [ ] **Step 2: Run focused desktop bridge tests and confirm failure**

Run:

```bash
pnpm --filter @lynavo-drive/desktop test -- sidecar-client ipc-handlers preload
```

Expected: FAIL because methods and IPC channels do not exist.

- [ ] **Step 3: Add sidecar-client methods**

Modify `apps/desktop/src/main/sidecar-client.ts` imports:

```typescript
import type {
  ConnectionDevicesSettingsDTO,
  DeviceFileLedgerPageDTO,
  DeviceFileSortField,
  SortDirection,
} from '@lynavo-drive/contracts';
```

Add methods in `sidecarClient`:

```typescript
  getConnectionDevices: () =>
    request<ConnectionDevicesSettingsDTO>('GET', '/settings/connection-devices'),
  revokeConnectionDevice: (clientId: string) =>
    request<{ ok: boolean }>(
      'POST',
      `/settings/connection-devices/${encodeURIComponent(clientId)}/revoke`,
      {},
    ),
  clearBlockedClient: (clientId: string) =>
    request<{ ok: boolean }>(
      'POST',
      `/settings/blocked-clients/${encodeURIComponent(clientId)}/clear`,
      {},
    ),
```

Update `supportsPairingRevocationOnCodeRotation` and `regenerateConnectionCodeSafely` in the next task that removes old code-rotation revocation probing. In this task, leave health recovery logic compiling.

- [ ] **Step 4: Add IPC channels and handlers**

In both `apps/desktop/src/main/ipc-handlers.ts` and `apps/desktop/src/preload/index.ts`, add constants:

```typescript
  SIDECAR_CONNECTION_DEVICES: 'sidecar:connection-devices',
  SIDECAR_REVOKE_CONNECTION_DEVICE: 'sidecar:revoke-connection-device',
  SIDECAR_CLEAR_BLOCKED_CLIENT: 'sidecar:clear-blocked-client',
```

In `registerIpcHandlers`, add:

```typescript
  ipcMain.handle(IPC.SIDECAR_CONNECTION_DEVICES, () => sidecarClient.getConnectionDevices());
  ipcMain.handle(IPC.SIDECAR_REVOKE_CONNECTION_DEVICE, (_e, clientId: string) =>
    sidecarClient.revokeConnectionDevice(clientId),
  );
  ipcMain.handle(IPC.SIDECAR_CLEAR_BLOCKED_CLIENT, (_e, clientId: string) =>
    sidecarClient.clearBlockedClient(clientId),
  );
```

- [ ] **Step 5: Expose preload methods and types**

In `apps/desktop/src/preload/index.ts`, add under `sidecar`:

```typescript
    getConnectionDevices: () => ipcRenderer.invoke(IPC.SIDECAR_CONNECTION_DEVICES),
    revokeConnectionDevice: (clientId: string) =>
      ipcRenderer.invoke(IPC.SIDECAR_REVOKE_CONNECTION_DEVICE, clientId),
    clearBlockedClient: (clientId: string) =>
      ipcRenderer.invoke(IPC.SIDECAR_CLEAR_BLOCKED_CLIENT, clientId),
```

In `apps/desktop/src/preload/api.d.ts`, import `ConnectionDevicesSettingsDTO` and add:

```typescript
    getConnectionDevices(): Promise<ConnectionDevicesSettingsDTO>;
    revokeConnectionDevice(clientId: string): Promise<{ ok: boolean }>;
    clearBlockedClient(clientId: string): Promise<{ ok: boolean }>;
```

- [ ] **Step 6: Run desktop bridge tests**

Run:

```bash
pnpm --filter @lynavo-drive/desktop test -- sidecar-client ipc-handlers preload
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main/sidecar-client.ts apps/desktop/src/main/ipc-handlers.ts apps/desktop/src/main/__tests__/sidecar-client.test.ts apps/desktop/src/main/__tests__/ipc-handlers.test.ts apps/desktop/src/preload/index.ts apps/desktop/src/preload/api.d.ts apps/desktop/src/preload/__tests__/index.test.ts
git commit -m "feat: bridge connection device management to renderer"
```

---

### Task 7: Desktop Renderer Store

**Files:**
- Create: `apps/desktop/src/renderer/stores/connection-devices-store.ts`
- Create: `apps/desktop/src/renderer/stores/__tests__/connection-devices-store.test.ts`

- [ ] **Step 1: Write failing store tests**

Create `apps/desktop/src/renderer/stores/__tests__/connection-devices-store.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionDevicesSettingsDTO } from '@lynavo-drive/contracts';
import { useConnectionDevicesStore } from '../connection-devices-store';

const fixture: ConnectionDevicesSettingsDTO = {
  authorizedDevices: [
    {
      clientId: 'phone-a',
      displayName: 'Nick iPhone',
      clientName: 'Nick iPhone',
      platform: 'ios',
      status: 'authorized',
      authorizedAt: '2026-06-10T01:00:00Z',
      lastSeenAt: '2026-06-10T01:10:00Z',
    },
  ],
  blockedClients: [
    {
      clientId: 'phone-b',
      displayName: 'Blocked Phone',
      failedAttempts: 5,
      blockedAt: '2026-06-10T01:15:00Z',
      lastAttemptAt: '2026-06-10T01:15:00Z',
      reason: 'wrong_connection_code_limit',
    },
  ],
  recentAttempts: [
    {
      id: 1,
      clientId: 'phone-b',
      displayName: 'Blocked Phone',
      result: 'wrong_code',
      failureReason: 'PAIRING_CODE_INVALID',
      createdAt: '2026-06-10T01:14:00Z',
    },
  ],
};

describe('connection devices store', () => {
  beforeEach(() => {
    useConnectionDevicesStore.setState({
      data: { authorizedDevices: [], blockedClients: [], recentAttempts: [] },
      loading: false,
      error: null,
      busyClientId: null,
    });
    window.electronAPI = {
      ...window.electronAPI,
      sidecar: {
        ...window.electronAPI?.sidecar,
        getConnectionDevices: vi.fn().mockResolvedValue(fixture),
        revokeConnectionDevice: vi.fn().mockResolvedValue({ ok: true }),
        clearBlockedClient: vi.fn().mockResolvedValue({ ok: true }),
      },
    } as typeof window.electronAPI;
  });

  it('loads connection devices from preload API', async () => {
    await useConnectionDevicesStore.getState().fetchConnectionDevices();
    expect(useConnectionDevicesStore.getState().data).toEqual(fixture);
    expect(useConnectionDevicesStore.getState().loading).toBe(false);
  });

  it('revokes a device then refreshes data', async () => {
    await useConnectionDevicesStore.getState().revokeDevice('phone-a');
    expect(window.electronAPI?.sidecar.revokeConnectionDevice).toHaveBeenCalledWith('phone-a');
    expect(window.electronAPI?.sidecar.getConnectionDevices).toHaveBeenCalled();
  });

  it('clears a blocked client then refreshes data', async () => {
    await useConnectionDevicesStore.getState().clearBlock('phone-b');
    expect(window.electronAPI?.sidecar.clearBlockedClient).toHaveBeenCalledWith('phone-b');
    expect(window.electronAPI?.sidecar.getConnectionDevices).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run focused renderer store test and confirm failure**

Run:

```bash
pnpm --filter @lynavo-drive/desktop test -- connection-devices-store
```

Expected: FAIL because the store does not exist.

- [ ] **Step 3: Implement the store**

Create `apps/desktop/src/renderer/stores/connection-devices-store.ts`:

```typescript
import { create } from 'zustand';
import type { ConnectionDevicesSettingsDTO } from '@lynavo-drive/contracts';

const emptyConnectionDevices: ConnectionDevicesSettingsDTO = {
  authorizedDevices: [],
  blockedClients: [],
  recentAttempts: [],
};

export interface ConnectionDevicesState {
  data: ConnectionDevicesSettingsDTO;
  loading: boolean;
  error: string | null;
  busyClientId: string | null;
  fetchConnectionDevices(): Promise<void>;
  revokeDevice(clientId: string): Promise<void>;
  clearBlock(clientId: string): Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useConnectionDevicesStore = create<ConnectionDevicesState>((set, get) => ({
  data: emptyConnectionDevices,
  loading: false,
  error: null,
  busyClientId: null,

  fetchConnectionDevices: async () => {
    const api = window.electronAPI;
    if (!api) return;
    set({ loading: true, error: null });
    try {
      const data = await api.sidecar.getConnectionDevices();
      set({ data, loading: false });
    } catch (error) {
      set({ loading: false, error: errorMessage(error) });
    }
  },

  revokeDevice: async (clientId) => {
    const api = window.electronAPI;
    if (!api) return;
    set({ busyClientId: clientId, error: null });
    try {
      await api.sidecar.revokeConnectionDevice(clientId);
      await get().fetchConnectionDevices();
    } catch (error) {
      set({ error: errorMessage(error) });
    } finally {
      set({ busyClientId: null });
    }
  },

  clearBlock: async (clientId) => {
    const api = window.electronAPI;
    if (!api) return;
    set({ busyClientId: clientId, error: null });
    try {
      await api.sidecar.clearBlockedClient(clientId);
      await get().fetchConnectionDevices();
    } catch (error) {
      set({ error: errorMessage(error) });
    } finally {
      set({ busyClientId: null });
    }
  },
}));
```

- [ ] **Step 4: Run store test**

Run:

```bash
pnpm --filter @lynavo-drive/desktop test -- connection-devices-store
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/stores/connection-devices-store.ts apps/desktop/src/renderer/stores/__tests__/connection-devices-store.test.ts
git commit -m "feat: add connection devices renderer store"
```

---

### Task 8: Desktop Settings UI and I18n

**Files:**
- Create: `apps/desktop/src/renderer/features/settings/ConnectionDevicesSection.tsx`
- Create: `apps/desktop/src/renderer/features/settings/__tests__/ConnectionDevicesSection.test.tsx`
- Modify: `apps/desktop/src/renderer/features/settings/SettingsPage.tsx`
- Modify: `apps/desktop/src/renderer/features/settings/__tests__/SettingsPage.test.tsx`
- Modify: `apps/desktop/src/renderer/i18n/locales/zh-Hant/settings.json`
- Modify: `apps/desktop/src/renderer/i18n/locales/zh-Hans/settings.json`
- Modify: `apps/desktop/src/renderer/i18n/locales/en/settings.json`

- [ ] **Step 1: Add failing UI tests**

Create `apps/desktop/src/renderer/features/settings/__tests__/ConnectionDevicesSection.test.tsx`:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConnectionDevicesSection } from '../ConnectionDevicesSection';
import { useConnectionDevicesStore } from '@renderer/stores/connection-devices-store';

describe('ConnectionDevicesSection', () => {
  beforeEach(() => {
    useConnectionDevicesStore.setState({
      data: {
        authorizedDevices: [
          {
            clientId: 'phone-a',
            displayName: 'Nick iPhone',
            clientName: 'Nick iPhone',
            platform: 'ios',
            ip: '192.168.1.20',
            status: 'authorized',
            authorizedAt: '2026-06-10T01:00:00Z',
            lastSeenAt: '2026-06-10T01:10:00Z',
          },
        ],
        blockedClients: [
          {
            clientId: 'phone-b',
            displayName: 'Blocked Phone',
            platform: 'android',
            lastIp: '192.168.1.30',
            failedAttempts: 5,
            blockedAt: '2026-06-10T01:11:00Z',
            lastAttemptAt: '2026-06-10T01:11:00Z',
            reason: 'wrong_connection_code_limit',
          },
        ],
        recentAttempts: [
          {
            id: 1,
            clientId: 'phone-b',
            displayName: 'Blocked Phone',
            result: 'wrong_code',
            failureReason: 'PAIRING_CODE_INVALID',
            createdAt: '2026-06-10T01:10:00Z',
          },
        ],
      },
      loading: false,
      error: null,
      busyClientId: null,
      fetchConnectionDevices: vi.fn(),
      revokeDevice: vi.fn(),
      clearBlock: vi.fn(),
    });
  });

  it('renders authorized devices, blocked clients, and read-only attempts', () => {
    render(<ConnectionDevicesSection />);
    expect(screen.getByText('Nick iPhone')).toBeInTheDocument();
    expect(screen.getByText('Blocked Phone')).toBeInTheDocument();
    expect(screen.getByText('PAIRING_CODE_INVALID')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete|刪除|删除/i })).not.toBeInTheDocument();
  });

  it('confirms before revoking authorization', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ConnectionDevicesSection />);
    await user.click(screen.getByRole('button', { name: /撤銷授權|Revoke/i }));
    expect(useConnectionDevicesStore.getState().revokeDevice).toHaveBeenCalledWith('phone-a');
  });

  it('confirms before clearing a block', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ConnectionDevicesSection />);
    await user.click(screen.getByRole('button', { name: /解除封鎖|Clear/i }));
    expect(useConnectionDevicesStore.getState().clearBlock).toHaveBeenCalledWith('phone-b');
  });
});
```

Add to `SettingsPage.test.tsx`:

```typescript
it('shows the connection devices settings section', () => {
  render(<SettingsPage />);
  expect(screen.getByText('連接設備')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run focused UI tests and confirm failure**

Run:

```bash
pnpm --filter @lynavo-drive/desktop test -- ConnectionDevicesSection SettingsPage
```

Expected: FAIL because the section and translation keys do not exist.

- [ ] **Step 3: Add i18n keys**

Add this object under the `settings` namespace in `apps/desktop/src/renderer/i18n/locales/zh-Hant/settings.json`:

```json
"connectionDevices": {
  "title": "連接設備",
  "description": "管理已授權手機、被封鎖的配對請求與近期連接碼嘗試。",
  "authorized": "已授權設備",
  "blocked": "已封鎖設備",
  "recentAttempts": "近期配對嘗試",
  "emptyAuthorized": "尚無已授權設備",
  "emptyBlocked": "尚無被封鎖設備",
  "emptyAttempts": "尚無配對嘗試",
  "revoke": "撤銷授權",
  "clearBlock": "解除封鎖",
  "confirmRevoke": "撤銷後，這台手機下次必須重新輸入電腦端連接碼。確定要撤銷？",
  "confirmClearBlock": "解除封鎖不會自動授權手機，手機仍需輸入正確連接碼。確定要解除？",
  "authorizedAt": "授權時間",
  "lastSeenAt": "最後連線",
  "lastAttemptAt": "最後嘗試",
  "blockedAt": "封鎖時間",
  "failedAttempts": "錯誤次數",
  "status": "狀態",
  "ip": "IP",
  "platform": "平台",
  "result": "結果",
  "failureReason": "原因",
  "loadFailed": "無法載入連接設備",
  "authorizedStatus": "已授權",
  "connectedStatus": "連線中",
  "offlineStatus": "離線"
}
```

Add equivalent keys to `zh-Hans/settings.json` using Simplified Chinese, and to `en/settings.json` using English.

- [ ] **Step 4: Implement `ConnectionDevicesSection`**

Create `apps/desktop/src/renderer/features/settings/ConnectionDevicesSection.tsx`:

```typescript
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCcw, ShieldOff, Unlock } from 'lucide-react';
import { Button } from '@renderer/components/ui/button';
import { useConnectionDevicesStore } from '@renderer/stores/connection-devices-store';

function formatDate(value?: string): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function ConnectionDevicesSection() {
  const { t } = useTranslation();
  const [attemptsOpen, setAttemptsOpen] = useState(false);
  const { data, loading, error, busyClientId, fetchConnectionDevices, revokeDevice, clearBlock } =
    useConnectionDevicesStore();

  useEffect(() => {
    void fetchConnectionDevices();
  }, [fetchConnectionDevices]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {t('settings.connectionDevices.description')}
        </p>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={t('common.refresh', { defaultValue: '重新整理' })}
          onClick={() => void fetchConnectionDevices()}
          disabled={loading}
        >
          <RefreshCcw className="h-4 w-4" />
        </Button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <section className="space-y-2">
        <h3 className="text-xs font-semibold text-foreground">
          {t('settings.connectionDevices.authorized')}
        </h3>
        {data.authorizedDevices.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t('settings.connectionDevices.emptyAuthorized')}
          </p>
        ) : (
          <div className="space-y-2">
            {data.authorizedDevices.map((device) => (
              <div key={device.clientId} className="rounded-md border border-border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{device.displayName}</p>
                    <p className="text-xs text-muted-foreground">
                      {device.platform} · {device.ip ?? '-'} · {t(`settings.connectionDevices.${device.status}Status`)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t('settings.connectionDevices.authorizedAt')}: {formatDate(device.authorizedAt)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t('settings.connectionDevices.lastSeenAt')}: {formatDate(device.lastSeenAt)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (window.confirm(t('settings.connectionDevices.confirmRevoke'))) {
                        void revokeDevice(device.clientId);
                      }
                    }}
                    disabled={busyClientId === device.clientId}
                  >
                    <ShieldOff className="mr-2 h-4 w-4" />
                    {t('settings.connectionDevices.revoke')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold text-foreground">
          {t('settings.connectionDevices.blocked')}
        </h3>
        {data.blockedClients.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t('settings.connectionDevices.emptyBlocked')}
          </p>
        ) : (
          <div className="space-y-2">
            {data.blockedClients.map((client) => (
              <div key={client.clientId} className="rounded-md border border-border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{client.displayName}</p>
                    <p className="text-xs text-muted-foreground">
                      {client.platform ?? '-'} · {client.lastIp ?? '-'} · {t('settings.connectionDevices.failedAttempts')}: {client.failedAttempts}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t('settings.connectionDevices.blockedAt')}: {formatDate(client.blockedAt)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t('settings.connectionDevices.lastAttemptAt')}: {formatDate(client.lastAttemptAt)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (window.confirm(t('settings.connectionDevices.confirmClearBlock'))) {
                        void clearBlock(client.clientId);
                      }
                    }}
                    disabled={busyClientId === client.clientId}
                  >
                    <Unlock className="mr-2 h-4 w-4" />
                    {t('settings.connectionDevices.clearBlock')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <button
          type="button"
          className="text-xs font-semibold text-foreground"
          onClick={() => setAttemptsOpen((open) => !open)}
        >
          {t('settings.connectionDevices.recentAttempts')}
        </button>
        {attemptsOpen && (
          <div className="space-y-2">
            {data.recentAttempts.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t('settings.connectionDevices.emptyAttempts')}
              </p>
            ) : (
              data.recentAttempts.map((attempt) => (
                <div key={attempt.id} className="rounded-md border border-border p-3">
                  <p className="truncate text-sm font-medium text-foreground">{attempt.displayName}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(attempt.createdAt)} · {attempt.platform ?? '-'} · {attempt.ip ?? '-'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {attempt.result}
                    {attempt.failureReason ? ` · ${attempt.failureReason}` : ''}
                  </p>
                </div>
              ))
            )}
          </div>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 5: Add the section to SettingsPage**

Modify `apps/desktop/src/renderer/features/settings/SettingsPage.tsx`:

```typescript
import { ConnectionDevicesSection } from './ConnectionDevicesSection';
```

Insert after the connection-code section:

```tsx
        <section className="mb-8">
          <h2 className="mb-1 text-sm font-semibold text-foreground">
            {t('settings.connectionDevices.title')}
          </h2>
          <ConnectionDevicesSection />
        </section>
```

- [ ] **Step 6: Run UI tests**

Run:

```bash
pnpm --filter @lynavo-drive/desktop test -- ConnectionDevicesSection SettingsPage
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/features/settings/ConnectionDevicesSection.tsx apps/desktop/src/renderer/features/settings/__tests__/ConnectionDevicesSection.test.tsx apps/desktop/src/renderer/features/settings/SettingsPage.tsx apps/desktop/src/renderer/features/settings/__tests__/SettingsPage.test.tsx apps/desktop/src/renderer/i18n/locales/zh-Hant/settings.json apps/desktop/src/renderer/i18n/locales/zh-Hans/settings.json apps/desktop/src/renderer/i18n/locales/en/settings.json
git commit -m "feat: add connection devices settings ui"
```

---

### Task 9: Mobile Pairing Error Mapping

**Files:**
- Modify: `apps/mobile/ios/SyncEngine/SyncEngineManager.swift`
- Modify: `apps/mobile/ios/SyncEngine/RNBridge.swift`
- Modify: `apps/mobile/android/app/src/main/java/com/vividrop/mobile/china/sync/NativeSyncEngineModule.kt`
- Modify: `apps/mobile/src/screens/CodeVerifyScreen.tsx`
- Modify: `apps/mobile/src/i18n/locales/zh-Hant/errors.json`
- Modify: `apps/mobile/src/i18n/locales/zh-Hans/errors.json`
- Modify: `apps/mobile/src/i18n/locales/en/errors.json`
- Modify: `apps/mobile/src/screens/__tests__/CodeVerifyScreen.test.tsx`

- [ ] **Step 1: Add failing React Native screen tests**

In `apps/mobile/src/screens/__tests__/CodeVerifyScreen.test.tsx`, add tests that mock `NativeModules.NativeSyncEngine.pairDevice` rejections:

```typescript
it('shows remaining attempts for PAIRING_CODE_INVALID', async () => {
  const { NativeModules } = require('react-native');
  NativeModules.NativeSyncEngine.pairDevice = jest.fn().mockRejectedValueOnce({
    code: 'PAIRING_CODE_INVALID',
    message: 'connection code invalid',
    userInfo: { failedAttempts: 3, remainingAttempts: 2, maxAttempts: 5 },
  });

  render(<CodeVerifyScreen />);
  await enterCode('000000');

  expect(await screen.findByText('連接碼錯誤，還可嘗試 2 次')).toBeTruthy();
});

it('shows blocked message for PAIRING_CLIENT_BLOCKED', async () => {
  const { NativeModules } = require('react-native');
  NativeModules.NativeSyncEngine.pairDevice = jest.fn().mockRejectedValueOnce({
    code: 'PAIRING_CLIENT_BLOCKED',
    message: 'client blocked',
  });

  render(<CodeVerifyScreen />);
  await enterCode('000000');

  expect(await screen.findByText('這台手機已被此電腦封鎖，請在電腦端解除後再試')).toBeTruthy();
});

it('shows re-pairing message for PAIR_TOKEN_INVALID', async () => {
  const { NativeModules } = require('react-native');
  NativeModules.NativeSyncEngine.pairDevice = jest.fn().mockRejectedValueOnce({
    code: 'PAIR_TOKEN_INVALID',
    message: 'token invalid',
  });

  render(<CodeVerifyScreen />);
  await enterCode('000000');

  expect(await screen.findByText('連接已失效，請重新輸入電腦端連接碼')).toBeTruthy();
});
```

If `enterCode` is not present, add this helper in the test file:

```typescript
async function enterCode(code: string) {
  const user = userEvent.setup();
  const inputs = screen.getAllByRole('textbox');
  for (let index = 0; index < code.length; index += 1) {
    await user.type(inputs[index], code[index]);
  }
}
```

- [ ] **Step 2: Run focused mobile screen tests and confirm failure**

Run:

```bash
pnpm --filter @lynavo-drive/mobile test -- CodeVerifyScreen
```

Expected: FAIL because stable pairing error mapping is missing.

- [ ] **Step 3: Add mobile i18n keys**

Add to `apps/mobile/src/i18n/locales/zh-Hant/errors.json`:

```json
"pairingWrongCodeWithRemaining": "連接碼錯誤，還可嘗試 {{remaining}} 次",
"pairingClientBlocked": "這台手機已被此電腦封鎖，請在電腦端解除後再試",
"pairingTokenInvalid": "連接已失效，請重新輸入電腦端連接碼"
```

Add equivalent keys to `zh-Hans/errors.json` and `en/errors.json`.

- [ ] **Step 4: Update `CodeVerifyScreen` error mapping**

In `apps/mobile/src/screens/CodeVerifyScreen.tsx`, add helper functions above `CodeVerifyScreen`:

```typescript
type PairingNativeError = {
  code?: string;
  message?: string;
  userInfo?: {
    failedAttempts?: number;
    remainingAttempts?: number;
    maxAttempts?: number;
  };
};

function getNativeErrorCode(error: PairingNativeError): string {
  return error.code || '';
}

function getRemainingAttempts(error: PairingNativeError): number | undefined {
  const remaining = error.userInfo?.remainingAttempts;
  return typeof remaining === 'number' && Number.isFinite(remaining) ? remaining : undefined;
}
```

Replace the catch block message selection with:

```typescript
        const nativeError = e as PairingNativeError;
        const code = getNativeErrorCode(nativeError);
        const msg = nativeError.message || '';
        if (code === 'PAIRING_CODE_INVALID') {
          setErrorMsg(
            t('errors.pairingWrongCodeWithRemaining', {
              remaining: getRemainingAttempts(nativeError) ?? 0,
            }),
          );
        } else if (code === 'PAIRING_CLIENT_BLOCKED') {
          setErrorMsg(t('errors.pairingClientBlocked'));
        } else if (code === 'PAIR_TOKEN_INVALID') {
          setErrorMsg(t('errors.pairingTokenInvalid'));
        } else if (
          code === 'APP_VERSION_INCOMPATIBLE' ||
          msg.includes('版本不相容') ||
          msg.includes('APP_VERSION_INCOMPATIBLE') ||
          msg.includes('版本不兼容')
        ) {
          Alert.alert(
            t('errors.pairingVersionMismatchTitle'),
            t('errors.pairingVersionMismatchMessage'),
            [{ text: t('common.ok') }],
          );
          setErrorMsg(t('errors.pairingVersionMismatchMessage'));
        } else if (msg.includes('Pairing rejected')) {
          setErrorMsg(t('errors.pairingWrongCode'));
        } else {
          setErrorMsg(t('errors.pairingConnectFailed', { msg }));
        }
```

- [ ] **Step 5: Update Android native pairing error propagation**

In `apps/mobile/android/app/src/main/java/com/vividrop/mobile/china/sync/NativeSyncEngineModule.kt`, replace the `PAIR_RES rejected` branch:

```kotlin
      if (!pairResponse.optBoolean("ok", false)) {
        val errorCode = pairResponse.optString("errorCode").ifBlank { "PAIR_ERROR" }
        val errorMessage = pairResponse.optString("error").ifBlank { "Pairing rejected" }
        val meta = pairResponse.optJSONObject("errorMeta")
        val exception = NativeBridgeException(errorCode, errorMessage)
        meta?.let {
          exception.userInfo = Arguments.createMap().apply {
            putInt("failedAttempts", it.optInt("failedAttempts", 0))
            putInt("remainingAttempts", it.optInt("remainingAttempts", 0))
            putInt("maxAttempts", it.optInt("maxAttempts", 0))
          }
        }
        recordNativeLog("Pairing", "PAIR_RES rejected code=$errorCode error=$errorMessage", Log.WARN)
        throw exception
      }
```

If `NativeBridgeException` does not support `userInfo`, add a small subclass for pairing failures and map it in the bridge rejection block:

```kotlin
private class PairingNativeException(
  val nativeCode: String,
  override val message: String,
  val userInfo: WritableMap? = null,
) : Exception(message)
```

Then in `pairDevice`, reject it with:

```kotlin
      } catch (error: PairingNativeException) {
        promise.reject(error.nativeCode, error.message, error, error.userInfo)
```

- [ ] **Step 6: Update iOS native pairing error propagation**

In `apps/mobile/ios/SyncEngine/SyncEngineManager.swift`, define:

```swift
struct PairingNativeError: LocalizedError {
    let code: String
    let message: String
    let userInfo: [String: Any]

    var errorDescription: String? { message }
}
```

When parsing `PAIR_RES`, replace the failure branch with:

```swift
        if ok == false {
            let code = pairJson["errorCode"] as? String ?? "PAIR_ERROR"
            let message = pairJson["error"] as? String ?? "Pairing rejected"
            let meta = pairJson["errorMeta"] as? [String: Any] ?? [:]
            throw PairingNativeError(code: code, message: message, userInfo: meta)
        }
```

In `apps/mobile/ios/SyncEngine/RNBridge.swift`, update `pairDevice` catch handling:

```swift
            } catch let error as PairingNativeError {
                reject(error.code, error.localizedDescription, NSError(
                    domain: "ViviDrop.Pairing",
                    code: 1,
                    userInfo: error.userInfo
                ))
            } catch {
                reject("PAIR_ERROR", error.localizedDescription, error)
            }
```

- [ ] **Step 7: Run mobile tests and typecheck**

Run:

```bash
pnpm --filter @lynavo-drive/mobile test -- CodeVerifyScreen
pnpm --filter @lynavo-drive/mobile exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/ios/SyncEngine/SyncEngineManager.swift apps/mobile/ios/SyncEngine/RNBridge.swift apps/mobile/android/app/src/main/java/com/vividrop/mobile/china/sync/NativeSyncEngineModule.kt apps/mobile/src/screens/CodeVerifyScreen.tsx apps/mobile/src/i18n/locales/zh-Hant/errors.json apps/mobile/src/i18n/locales/zh-Hans/errors.json apps/mobile/src/i18n/locales/en/errors.json apps/mobile/src/screens/__tests__/CodeVerifyScreen.test.tsx
git commit -m "feat: show structured mobile pairing errors"
```

---

### Task 10: Remove Old Code-Rotation Revocation Recovery Path

**Files:**
- Modify: `apps/desktop/src/main/sidecar-client.ts`
- Modify: `apps/desktop/src/main/ipc-handlers.ts`
- Modify: `apps/desktop/src/main/__tests__/ipc-handlers.test.ts`
- Modify: `services/sidecar-go/internal/api/handlers_health.go`
- Modify: `services/sidecar-go/internal/api/router_test.go`

- [ ] **Step 1: Add failing tests for new code-rotation capability**

In `apps/desktop/src/main/__tests__/ipc-handlers.test.ts`, add:

```typescript
it('regenerates connection code without revocation compatibility restart', async () => {
  sidecarClient.regenerateConnectionCode = vi.fn().mockResolvedValue({ code: '654321' });
  mockSidecarManager.retryStart = vi.fn();

  registerIpcHandlers(mockSidecarManager);
  await invoke('sidecar:regenerate-code');

  expect(sidecarClient.regenerateConnectionCode).toHaveBeenCalled();
  expect(mockSidecarManager.retryStart).not.toHaveBeenCalled();
});
```

In `services/sidecar-go/internal/api/router_test.go`, update the health capability assertion:

```go
capabilities := body["capabilities"].(map[string]any)
if capabilities["revokesPairingsOnCodeRotation"] == true {
	t.Fatal("health must not advertise revocation on code rotation")
}
if capabilities["connectionDeviceManagement"] != true {
	t.Fatal("health must advertise connection device management")
}
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run:

```bash
pnpm --filter @lynavo-drive/desktop test -- ipc-handlers
cd services/sidecar-go && go test ./internal/api -run TestHealthEndpoint -count=1
```

Expected: FAIL while old restart/capability behavior remains.

- [ ] **Step 3: Simplify desktop regenerate logic**

In `apps/desktop/src/main/ipc-handlers.ts`, replace `regenerateConnectionCodeSafely` with:

```typescript
async function regenerateConnectionCodeSafely(): Promise<{ code: string }> {
  return sidecarClient.regenerateConnectionCode();
}
```

Update the handler registration:

```typescript
  ipcMain.handle(IPC.SIDECAR_REGENERATE_CODE, () => regenerateConnectionCodeSafely());
```

Remove unused `supportsPairingRevocationOnCodeRotation` imports and tests.

- [ ] **Step 4: Update health capability**

In `services/sidecar-go/internal/api/handlers_health.go`, expose:

```go
"capabilities": map[string]any{
	"connectionDeviceManagement": true,
},
```

Do not include `revokesPairingsOnCodeRotation`.

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm --filter @lynavo-drive/desktop test -- ipc-handlers
cd services/sidecar-go && go test ./internal/api -run TestHealthEndpoint -count=1
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/sidecar-client.ts apps/desktop/src/main/ipc-handlers.ts apps/desktop/src/main/__tests__/ipc-handlers.test.ts services/sidecar-go/internal/api/handlers_health.go services/sidecar-go/internal/api/router_test.go
git commit -m "fix: stop treating code rotation as device revocation"
```

---

### Task 11: Cross-Module Verification

**Files:**
- No source edits unless a verification failure points to a defect in the preceding tasks.

- [ ] **Step 1: Run sidecar focused tests**

Run:

```bash
cd services/sidecar-go && go test ./internal/store ./internal/server ./internal/api -count=1
```

Expected: PASS.

- [ ] **Step 2: Build contracts**

Run:

```bash
pnpm --filter @lynavo-drive/contracts build
```

Expected: PASS.

- [ ] **Step 3: Run desktop tests and typecheck**

Run:

```bash
pnpm --filter @lynavo-drive/desktop test
pnpm --filter @lynavo-drive/desktop typecheck
```

Expected: PASS.

- [ ] **Step 4: Run mobile TypeScript verification**

Run:

```bash
pnpm --filter @lynavo-drive/mobile exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Run full monorepo verification**

Run:

```bash
pnpm build
pnpm typecheck
pnpm test
```

Expected: PASS. If the full suite exposes unrelated pre-existing failures, record the failing command, the exact failing test names, and the reason they are outside this feature branch before delivery.

- [ ] **Step 6: Manual acceptance pass**

Use two separate desktop data directories or two temp DBs:

```bash
SYNCFLOW_DATA_DIR=/tmp/syncflow-desktop-1 pnpm --filter @lynavo-drive/desktop dev
SYNCFLOW_DATA_DIR=/tmp/syncflow-desktop-2 pnpm --filter @lynavo-drive/desktop dev
```

Verify:

- Phone A enters the wrong code 5 times on Desktop 1 and is blocked only on Desktop 1.
- Phone A can still pair with Desktop 2.
- Phone B can still pair with Desktop 1.
- Desktop 1 shows Phone A in the blocked list.
- Clearing Phone A's block on Desktop 1 allows another pairing attempt but does not authorize it automatically.
- Regenerating Desktop 1's connection code does not revoke existing authorized devices.
- Revoking Phone B on Desktop 1 does not remove received files, upload history, daily statistics, or queue rows.

- [ ] **Step 7: Self-review before final delivery**

Check:

- `git diff --stat` contains only files in this plan plus generated contract declarations if the package build creates them.
- No renderer code calls `fetch`, sidecar HTTP, SQLite, `fs`, or `path` for this feature.
- SQL uses parameterized queries.
- No UI exposes delete, reorder, skip, upload-history deletion, queue mutation, or bulk revoke actions.
- `PAIRING_CODE_INVALID`, `PAIRING_CLIENT_BLOCKED`, `PAIR_TOKEN_INVALID`, and `APP_VERSION_INCOMPATIBLE` all come from shared naming and are spelled consistently.
- Wrong-code attempt, rate-limit update, and active-block creation are in one transaction.

- [ ] **Step 8: Commit verification fixes if any**

If verification required code changes:

```bash
git add <changed-files>
git commit -m "test: verify connection device management"
```

If no code changes were required, do not create an empty commit.
