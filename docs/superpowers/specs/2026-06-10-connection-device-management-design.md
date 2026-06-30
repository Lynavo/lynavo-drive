# Connection Device Management Design

## Summary

Vivi Drop should manage local pairing trust per desktop. When a phone enters the correct desktop connection code and finishes pairing, that phone's mobile `clientId` becomes an authorized device for that desktop only. Other desktops keep independent authorization and block state.

The desktop sidecar should also protect the LAN pairing code from repeated wrong-code attempts. A phone is permanently blocked on a specific desktop after 5 wrong connection-code attempts. The block is scoped to `clientId + desktopDeviceId` and can only be cleared from the desktop app.

## Goals

1. Record each successfully paired mobile `clientId` as an authorized device on the current desktop.
2. Keep authorization and block state local to each desktop. Multiple desktops must not affect each other.
3. Count wrong connection-code attempts by `clientId + desktopDeviceId`.
4. Permanently block a phone on the current desktop after 5 wrong attempts.
5. Add desktop-side connection device management for authorized devices, blocked devices, and recent pairing attempts.
6. Preserve the existing pairing-token and HMAC authentication model for already authorized devices.

## Non-Goals

1. Do not sync authorization or block state through a cloud account.
2. Do not automatically authorize every phone under the same user account.
3. Do not delete upload history, received files, queue state, or daily statistics when authorization is revoked.
4. Do not treat pairing-token authentication failures as wrong connection-code attempts.
5. Do not use device name, IP address, or directory name as identity.
6. Do not add a bulk "revoke all devices" action in this scope.

## Existing Context

The current sidecar pairing flow is:

1. Mobile sends `HELLO_REQ`.
2. If the mobile `clientId` is not in `paired_devices`, sidecar replies with `HELLO_RES authRequired=true`.
3. Mobile sends `PAIR_REQ` with the desktop connection code.
4. Sidecar compares the submitted code with the local `connection_code`.
5. On success, sidecar writes `paired_devices`, generates a `pairingToken`, and returns `PAIR_RES`.
6. Returning devices authenticate with HMAC using the stored pairing token hash.

Today, wrong connection-code attempts are received by sidecar, logged, and rejected, but they are not persisted, counted, or surfaced in desktop UI.

## Approach

Use a desktop-local authorization table plus desktop-local block tables.

`paired_devices` remains the authorized device table. New tables record pairing attempts, wrong-code counters, and active or cleared block records. This keeps authorization, attempt history, rate limits, and block audits separate.

This approach matches the existing architecture:

1. Desktop renderer does not access sidecar, SQLite, or filesystem directly.
2. Sidecar owns LMUP pairing, HMAC auth, SQLite persistence, and HTTP API.
3. Shared DTOs live in `@lynavo-drive/contracts`.
4. Device identity remains mobile `clientId`.

## Data Model

### `paired_devices`

Keep the current table as the authorized device table.

Semantics:

1. One active row means the mobile `clientId` is authorized on this desktop.
2. `revoked_at IS NULL` means authorization is active.
3. `revoked_at IS NOT NULL` means the desktop user revoked authorization.
4. Revocation invalidates the old pairing token but keeps upload history and received files intact.
5. Re-pairing with the correct connection code can authorize the same `clientId` again and issue a new pairing token.

### `pairing_attempts`

Records every connection-code pairing attempt and relevant rejection result.

Suggested fields:

```sql
CREATE TABLE pairing_attempts (
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
```

Allowed `result` values:

1. `success`
2. `wrong_code`
3. `blocked`
4. `incompatible`
5. `malformed`
6. `revoked_repair_required`

This table is append-only audit history. Desktop UI can show the most recent 50 records.

### `pairing_rate_limits`

Stores the current wrong-code count for each `clientId + desktopDeviceId`.

Suggested fields:

```sql
CREATE TABLE pairing_rate_limits (
  client_id         TEXT NOT NULL,
  desktop_device_id TEXT NOT NULL,
  failed_count      INTEGER NOT NULL DEFAULT 0,
  first_failed_at   TEXT NOT NULL,
  last_failed_at    TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  PRIMARY KEY (client_id, desktop_device_id)
);
```

Rules:

1. Only `wrong_code` increments `failed_count`.
2. Successful pairing clears the active rate-limit row for that `clientId + desktopDeviceId`.
3. `failed_count >= 5` creates an active block.
4. The `desktop_device_id` is stored explicitly even though each desktop has its own DB, so diagnostics and future migrations remain unambiguous.

### `blocked_pairing_clients`

Stores permanent block records.

Suggested fields:

```sql
CREATE TABLE blocked_pairing_clients (
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
```

Rules:

1. Active block means `cleared_at IS NULL`.
2. `reason` is initially `wrong_connection_code_limit`.
3. Clearing a block sets `cleared_at` and `cleared_by = 'desktop_user'`.
4. Clearing a block does not authorize the phone.
5. The phone must enter the correct connection code again to become authorized.
6. Cleared block rows remain for audit history.

Indexes:

```sql
CREATE UNIQUE INDEX blocked_pairing_clients_active_unique
ON blocked_pairing_clients (client_id, desktop_device_id)
WHERE cleared_at IS NULL;

CREATE INDEX pairing_attempts_recent_idx
ON pairing_attempts (created_at DESC);

CREATE INDEX pairing_attempts_client_desktop_idx
ON pairing_attempts (client_id, desktop_device_id, created_at DESC);
```

The active-block unique index prevents duplicate active blocks while still allowing historical cleared blocks for the same client and desktop.

## Protocol Flow

### `HELLO_REQ`

When sidecar receives `HELLO_REQ`, it should collect:

1. `clientId`
2. `clientName`
3. `deviceAlias`
4. `clientPlatform`
5. `stableDeviceId`
6. `clientIP`
7. local `desktopDeviceId`

Then it checks for an active block for `clientId + desktopDeviceId`.

If blocked:

1. Return `PAIRING_CLIENT_BLOCKED`.
2. Record `pairing_attempts.result = 'blocked'`.
3. Update `blocked_pairing_clients.last_attempt_at` and `last_ip`.
4. Do not proceed to `PAIR_REQ`.
5. Do not allow existing token auth from that client while the block is active.

If not blocked:

1. Continue current paired-device lookup.
2. Active paired devices continue to HMAC auth.
3. New or revoked devices require pairing.

### Returning Authorized Device

If `paired_devices.revoked_at IS NULL`:

1. Use the existing HMAC `AUTH_REQ` flow.
2. On success, update `last_seen_at` and `last_ip`.
3. Do not create a pairing attempt record because this is not a connection-code pairing attempt.

If HMAC fails:

1. Return `PAIR_TOKEN_INVALID`.
2. Do not increment wrong-code rate limits.
3. Mobile should ask the user to re-pair or clear the local binding.

### Revoked Device

If `paired_devices.revoked_at IS NOT NULL`:

1. Do not allow the old pairing token.
2. Require connection-code pairing.
3. Correct code reactivates or replaces the paired device row and issues a new pairing token.
4. Wrong code records a `wrong_code` attempt and increments the rate limit.

### New Device `PAIR_REQ`

When sidecar receives `PAIR_REQ`:

1. Check active block again to handle races between `HELLO_REQ` and `PAIR_REQ`.
2. If blocked, return `PAIRING_CLIENT_BLOCKED` and record `blocked`.
3. Compare submitted connection code with the local code.

If the code is correct:

1. Create or update `paired_devices`.
2. Generate a new `pairingToken`.
3. Record `pairing_attempts.result = 'success'`.
4. Clear active `pairing_rate_limits` for the pair.
5. Leave historical cleared block records intact.

If the code is wrong:

1. Record `pairing_attempts.result = 'wrong_code'`.
2. Increment `pairing_rate_limits.failed_count`.
3. If `failed_count < 5`, return `PAIRING_CODE_INVALID` with attempt metadata.
4. If `failed_count >= 5`, create an active block and return `PAIRING_CLIENT_BLOCKED`.

The wrong-code attempt, rate-limit update, and block creation must happen in one database transaction. This prevents concurrent `PAIR_REQ` calls from racing past the 5-attempt limit.

## Error Codes

Add explicit shared error codes:

1. `PAIRING_CODE_INVALID`
2. `PAIRING_CLIENT_BLOCKED`
3. `PAIR_TOKEN_INVALID`
4. `APP_VERSION_INCOMPATIBLE`

`PAIRING_CODE_INVALID` should include:

1. `failedAttempts`
2. `remainingAttempts`
3. `maxAttempts`

Mobile copy:

1. Wrong code: "連接碼錯誤，還可嘗試 {{remaining}} 次"
2. Blocked: "這台手機已被此電腦封鎖，請在電腦端解除後再試"
3. Token invalid: "連接已失效，請重新輸入電腦端連接碼"

## Desktop UI

Add a settings section named "連接設備".

### Authorized Devices

Source:

```sql
paired_devices WHERE revoked_at IS NULL
```

Display:

1. Display name: `deviceAlias ?? clientName ?? clientId`
2. Platform
3. Last IP
4. Last seen time
5. Authorized time
6. Current state: authorized, connected, or offline
7. Action: revoke authorization

Revoke rules:

1. Confirmation dialog required.
2. Set `revoked_at`.
3. Do not delete upload history.
4. Do not delete received files.
5. Do not change daily statistics.
6. The phone must re-enter the desktop connection code next time.
7. Revocation is not blocking.

### Blocked Devices

Source:

```sql
blocked_pairing_clients WHERE cleared_at IS NULL
```

Display:

1. Display name
2. Platform
3. Last attempted IP
4. Failed attempts
5. Blocked time
6. Last attempt time
7. Block reason
8. Action: clear block

Clear rules:

1. Confirmation dialog required.
2. Set `cleared_at` and `cleared_by`.
3. Clear the active rate-limit row for that pair.
4. Do not authorize the phone automatically.
5. The phone must enter the correct code to become authorized.

### Recent Pairing Attempts

Add a read-only collapsed section showing:

```sql
pairing_attempts ORDER BY created_at DESC LIMIT 50
```

Display:

1. Time
2. Display name
3. Platform
4. IP
5. Result
6. Failure reason

Do not provide delete actions in this list. Deleting history should not be confused with clearing a block.

## Connection Code Regeneration

Change the existing regenerate-code behavior.

New rule:

1. Regenerating the connection code changes only the code used for new pairing.
2. It must not automatically revoke existing authorized devices.
3. Users revoke devices from the Authorized Devices list.

Reason:

Once desktop has explicit device management, regenerating a pairing code should not silently invalidate all phones. Hidden revocation makes recovery and support harder.

## APIs

### Store API

Add store methods:

1. `RecordPairingAttempt(attempt)`
2. `IncrementPairingFailure(clientId, desktopDeviceId, metadata) -> failedCount`
3. `GetActivePairingBlock(clientId, desktopDeviceId)`
4. `BlockPairingClient(clientId, desktopDeviceId, metadata)`
5. `ClearPairingBlock(clientId, desktopDeviceId)`
6. `ListAuthorizedDevices()`
7. `ListBlockedPairingClients()`
8. `ListRecentPairingAttempts(limit)`
9. `RevokeAuthorizedDevice(clientId)`

All SQL must be parameterized.

### HTTP API

Add desktop-management APIs:

1. `GET /api/settings/connection-devices`
2. `POST /api/settings/connection-devices/:clientId/revoke`
3. `POST /api/settings/blocked-clients/:clientId/clear`

The renderer must use preload bridge and main IPC. It must not call sidecar directly.

### Contracts

Add DTOs in `@lynavo-drive/contracts`:

1. `ConnectionDeviceDTO`
2. `BlockedPairingClientDTO`
3. `PairingAttemptDTO`
4. `ConnectionDevicesSettingsDTO`

## Mobile Behavior

Mobile should map new pairing errors:

1. `PAIRING_CODE_INVALID`: show remaining attempts.
2. `PAIRING_CLIENT_BLOCKED`: tell the user to clear the block on desktop.
3. `PAIR_TOKEN_INVALID`: request re-pairing.

Successful pairing still stores the returned `pairingToken` and uses the existing HMAC auth path.

## Tests

### Sidecar Go Tests

1. Wrong code attempts 1 to 4 return `PAIRING_CODE_INVALID` and do not block.
2. The 5th wrong code creates an active block and returns `PAIRING_CLIENT_BLOCKED`.
3. After blocking, `HELLO_REQ` from the same `clientId + desktopDeviceId` is rejected before `PAIR_REQ`.
4. Blocked attempts are recorded in `pairing_attempts`.
5. Clearing the block allows the phone to pair with the correct code.
6. Successful pairing clears the active rate-limit row.
7. Two desktop DBs do not affect each other's block state.
8. Revoked authorization rejects old token auth.
9. Revoked device can re-pair with the correct connection code.
10. Regenerating the connection code does not revoke existing authorized devices.

### Desktop Tests

1. Settings store loads authorized devices, blocked devices, and recent attempts.
2. Revoke authorization calls the correct IPC and updates UI.
3. Clear block calls the correct IPC and updates UI.
4. UI does not expose delete, reorder, skip, upload-history deletion, or queue mutation actions.

### Mobile Tests

1. Wrong-code error displays remaining attempts.
2. Blocked error tells the user to clear the block on desktop.
3. Token invalid error sends the user through re-pairing.

## Acceptance Criteria

1. Phone A enters a wrong code 5 times on Desktop 1 and is blocked only on Desktop 1.
2. Phone A can still pair with Desktop 2.
3. Phone B can still pair with Desktop 1.
4. Desktop 1 shows Phone A in the blocked list.
5. Desktop 1 can clear Phone A's block.
6. After clearing, Phone A still needs the correct connection code to become authorized.
7. Existing authorized devices remain authorized when the connection code is regenerated.
8. Revoking authorization does not delete received files.
9. Revoking authorization does not delete upload history.
10. Revoking authorization does not alter daily statistics.
11. Renderer does not access sidecar, SQLite, or filesystem directly.
12. All shared DTOs and error code names come from `@lynavo-drive/contracts`.

## Risks and Mitigations

### Risk: Blocking a legitimate user too easily

Mitigation: Use 5 attempts, show remaining attempts on mobile, and provide a clear desktop unblock action.

### Risk: Device identity spoofing

Mitigation: This feature protects the LAN pairing code from repeated mistakes or simple brute force. It does not make `clientId` a cryptographic identity before pairing. The actual trusted state still begins only after correct code pairing and token issuance.

### Risk: Confusing revoke with block

Mitigation: Keep UI sections and actions separate:

1. Revoke authorization invalidates an already trusted phone.
2. Clear block allows a previously blocked phone to try pairing again.

### Risk: Regenerate code silently breaks existing devices

Mitigation: Change regenerate-code behavior so it does not revoke existing devices. Revocation becomes an explicit device-management action.

## Implementation Notes

1. Add migrations after `004_stable_device_id.sql`.
2. Update sidecar store tests before changing handler behavior.
3. Update `handleHello` before `handlePair`, because blocked clients should be rejected as early as possible.
4. Keep all DTO additions in `@lynavo-drive/contracts`.
5. Run `pnpm build` after changing contracts.
6. Run Go sidecar tests for pairing, store, and API behavior.
7. Run desktop renderer tests for settings UI and store behavior.
