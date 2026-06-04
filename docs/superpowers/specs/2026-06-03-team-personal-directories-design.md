# Team Shared, Receive, And Personal Shared Directories Design

## Background

Vivi Drop currently treats the desktop `shared/` directory as the only browseable directory for mobile clients. The intended product model is different:

- Team shared directory: visible to all connected local-network users/devices.
- Receive directory: the local-network mobile-to-desktop upload destination.
- Personal shared directory: visible only when the mobile and desktop are signed in to the same account.

The current implementation already fits the team-shared meaning for `shared/`: sidecar exposes `/shared/*`, desktop displays the shared path, and mobile browses/downloads shared files through direct LAN or P2P routes. The receive directory should remain a root-derived LAN upload destination, while the personal shared directory is independently configured and account-gated.

## Goals

1. Preserve the existing `shared/` directory as the team shared directory.
2. Preserve the receive directory as a root-derived upload destination.
3. Add a personal shared directory that is account-scoped and independent from the root path.
4. Prevent personal directory access unless mobile and desktop belong to the same server account.
5. Keep existing upload queue semantics unchanged: read-only queue, automatic incremental sync, and one-file-at-a-time upload per phone.
6. Keep renderer access mediated through preload/main/sidecar; renderer must not touch sidecar, filesystem, or SQLite directly.

## Non-Goals

- Do not add manual file selection for uploads.
- Do not add user-controlled queue deletion, reordering, or skipping.
- Do not make team shared files account-private.
- Do not implement cloud storage or server-hosted file transfer for personal files.
- Do not require remote server build or deployment in this task.

## Directory Model

For a root path `<root>`, the effective root-bound layout becomes:

```text
<root>/
  received/            # Receive directory for LAN mobile uploads
  shared/              # Team shared directory for LAN users/devices
  staging/             # Runtime staging directory

<personalPath>/        # Personal shared directory, independently configured
```

`shared/` remains the path behind the existing shared-file behavior. It is intentionally not account-gated by sidecar because its product meaning is team/local-network sharing.

`received/` remains the root-derived upload destination used by uploads, dashboard history, device details, and file existence checks. It is not automatically included in the personal shared directory.

`personalPath` is a new private browseable root. It may point to a whole disk or volume root, such as `C:\`, `D:\`, or `Macintosh HD`, when the desktop app has permission. It is not affected by `rootPath` changes.

## Migration Strategy

For new installs or when the user changes the root path:

- `receivePath` is derived as `<root>/received`.
- `sharedPath` stays `<root>/shared`.
- `personalPath` keeps its existing independently configured value.

For existing installs:

1. Keep `<root>/received` as the managed receive directory.
2. Create `<root>/received` and `<root>/shared` when needed.
3. Do not move received files into the personal shared directory.
4. When the user changes `rootPath`, update only root-derived paths (`receivePath` and `sharedPath`).
5. When the user changes `personalPath`, update only the personal shared directory path.

## Contracts

Add fields and types in `@syncflow/contracts`:

- `SettingsDTO.personalPath: string`
- Directory scope type: `DirectoryScope = 'team' | 'personal'`
- Reuse the file listing shape where possible:
  - `DirectoryFileDTO` or compatible shared/personal file DTO
  - `DirectoryListingDTO` with `scope`, `path`, `files`, `totalCount`

Compatibility rule:

- Existing `SharedFileDTO` and `SharedDirectoryDTO` can remain as aliases or retained exports for current `/shared/*` consumers.
- New mobile/desktop code should use scoped directory DTO names when it needs to distinguish team vs personal.

## Client Sidecar API

Existing team shared routes remain:

- `GET /shared/list`
- `GET /shared/list/{path...}`
- `GET /shared/thumbnail/{path...}`
- `GET /shared/download/{path...}`
- `GET /shared/stream/{path...}`

Add account-gated personal routes:

- `GET /personal/list`
- `GET /personal/list/{path...}`
- `GET /personal/thumbnail/{path...}`
- `GET /personal/download/{path...}`
- `GET /personal/stream/{path...}`

Personal routes must:

- Resolve paths only inside `config.PersonalDir()`.
- Reject absolute paths, traversal, Windows volume prefixes, and symlink escapes.
- Require a bearer token or equivalent account proof from mobile.
- Verify the token belongs to the same server account as the desktop session currently synced to sidecar.
- Return `401` when no valid mobile account token is present.
- Return `403` when mobile is authenticated but not the same account as the desktop.

Team shared routes keep their current local-network behavior and should not require the personal auth token.

## Desktop Client

Desktop sidecar settings should return:

- `rootPath`
- `sharedPath`
- `personalPath`
- `receivePath`

Desktop UI changes:

- Rename visible "shared directory" copy to "team shared directory".
- Add a personal directory row/card in path settings.
- Show receive directory, team shared directory, and personal shared directory as separate path concepts.
- Directory page tabs should become:
  - Received
  - Team Shared
  - Personal

Renderer continues to call preload/main APIs. Main process forwards sidecar calls. Renderer does not call the filesystem, SQLite, or sidecar directly.

Desktop auth changes:

- The main process already stores the desktop auth session and syncs tunnel credentials to sidecar.
- Extend that sync so sidecar knows the desktop account identity needed for personal-route authorization.
- Sidecar must clear the desktop identity on logout or credential clearing.

## Mobile Client

Mobile should distinguish directory scope:

- Team shared browsing uses existing `/shared/*` behavior and can continue over LAN/P2P.
- Personal browsing uses `/personal/*` and must attach the mobile access token.

JS service changes:

- Add scoped APIs such as `browseDirectory(scope, path)`, `downloadDirectoryFile(scope, path)`, and `getDirectoryFileStreamUrl(scope, path)`.
- Keep existing shared wrappers for compatibility where useful.

Native iOS/Android changes:

- Replace hard-coded shared endpoints with scoped endpoint builders.
- Add Authorization headers for personal routes only.
- Preserve existing shared route policy: prefer reachable LAN, use P2P when needed, and keep existing reachability telemetry.

UI changes:

- The current shared files screen can become a two-tab file browser: Team Shared and Personal.
- Download subscription gates stay in place.
- Completed download tracking should include scope in the storage key or completed-download id to avoid collisions between identical paths in team and personal roots.

## Server

Server currently validates same-account ownership only during WebSocket signaling for a known `targetClientId`. It does not expose a persistent same-account desktop inventory. Add minimal server support:

1. Add `desktop_devices` table with:
   - `id`
   - `user_id`
   - `client_id`
   - `display_name`
   - `platform`
   - `capabilities`
   - `last_seen_at`
   - `revoked_at`
2. Add authenticated desktop register/heartbeat endpoint.
3. Add authenticated mobile discovery endpoint that returns only desktops owned by the current `user_id`.
4. Keep signaling same-account checks, and prefer validating target ownership against the registry when available.

This server layer establishes the account boundary used by personal directory discovery and tunnel setup. The actual file bytes still flow between mobile and desktop over LAN/P2P sidecar routes.

## Error Handling

- Personal route without mobile token: `401 auth required`.
- Personal route with wrong account: `403 account mismatch`.
- Desktop has no synced account identity: personal route returns `401 desktop account required`.
- Path traversal or symlink escape: `400`.
- Missing directory/file: `404`.
- Storage path unavailable: existing storage-unavailable error path.
- Personal path unavailable or permission denied: report the existing storage-unavailable style error without changing root-derived receive/team paths.

## Testing

Client:

- Contracts type tests/build for new DTO fields.
- Go sidecar tests for:
  - `PersonalDir()` and `SharedDir()` layout.
  - settings derivation.
  - `rootPath` updates change receive/team paths but not personal path.
  - `personalPath` updates change only personal path.
  - personal path traversal and symlink escape rejection.
  - personal route `401`/`403`/success.
  - shared route remains accessible.
- Desktop renderer/store tests for new paths and tabs.
- Desktop main/preload tests for new sidecar methods.
- Mobile TypeScript tests for scoped API wrappers and UI tabs.
- iOS/Android native tests or focused build/type validation for scoped endpoint construction and personal auth header behavior.

Server:

- Migration/repository tests for `desktop_devices`.
- Authenticated register/heartbeat tests.
- Mobile discovery returns only same-account desktops.
- Signaling ownership checks continue to reject cross-account target desktop.

## Rollout Notes

- Existing `/shared/*` remains stable for older clients.
- New personal routes require updated desktop sidecar and mobile app.
- If mobile does not support personal scope, it continues to browse team shared files only.
- Migration should run locally on desktop only; no build or migration work is performed on remote servers.
