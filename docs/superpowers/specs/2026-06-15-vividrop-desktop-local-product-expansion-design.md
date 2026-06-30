# Vivi Drop Desktop-Local Product Expansion Design

## Goal

Deliver a major Vivi Drop UI and product update using both reference directories as inputs:

- `/Volumes/T7/Dev/Web/SyncFlow/desktop-vividrop-clean-source`
- `/Volumes/T7/Dev/Web/SyncFlow/vividrop-ui-mobile`

This is not a conservative skin refresh. The new desktop and mobile UI should fully move toward the reference product shape, add missing product capabilities, and hide all user-reachable legacy entry points that are not represented in the new product direction.

## Approved Direction

Use **Desktop-local product expansion**.

Both reference projects are feature sources. If a capability appears in either reference and is missing from the current production app, implement it as a real local capability unless it is clearly fake/mock, technically impossible in the current LAN product, or conflicts with the explicit product constraints below.

The source of truth for management, records, authorization, blocking, shared files, and access history is the current desktop machine. No new remote server storage is introduced for those domains.

## Product Constraints

- Desktop is the management center.
- Mobile is an operation client for the currently connected desktop, not the authority for management data.
- Multiple desktops are independent. Their devices, authorization, blocking, records, shared files, and history do not leak into each other.
- Device identity uses mobile `clientId`; do not use display name, IP address, or directory name as identity.
- Authorization and blocking keys use `desktop deviceId + mobile clientId`.
- Wrong connection-code attempts are limited to 5 per `desktop deviceId + mobile clientId`.
- After 5 wrong attempts, the mobile is permanently blocked on that desktop until desktop manually unblocks it.
- All exposed new UI must use real local state, real sidecar state, or real native/mobile state. Do not ship mock data, fake timers, fake QR state, fake downloads, fake subscription state, or fake state machines.
- Preserve queue semantics: no delete, reorder, skip, or manual queue mutation UI.
- Preserve automatic incremental sync. Do not turn the production mobile album flow into manual file picking.
- Preserve single-file serial upload per phone.
- Keep all shared DTOs and protocol constants in `@lynavo-drive/contracts`.
- Desktop renderer must not directly access sidecar, filesystem, or SQLite; it must go through preload/main bridges.

## Reference Handling

Use `vividrop-ui-mobile` as a major reference for both PC and mobile product surfaces, including dashboard, settings, directory, device detail, discovery, code verification, sync activity, shared files, album, history, and help patterns.

Use `desktop-vividrop-clean-source` as a feature and information-architecture reference for management concepts such as shared management, device management, sync records, access records, and account/about surfaces.

Do not directly copy prototype-only implementation details:

- hard-coded mock rows
- fake request delays
- fake pairing state
- fake QR scanner behavior
- fake download/player behavior
- fake subscription state
- manual mobile album file selection as a production upload path
- cloud wording or server-backed behavior where the approved design says desktop-local

## Information Architecture

### Desktop

Desktop becomes a full local management console:

- `Dashboard`
  - Current sidecar and sync status
  - Connection code
  - Online mobile devices
  - Today/recent sync volume
  - Recent errors
  - Disk, permission, and runtime warnings

- `Devices`
  - Connected device records
  - Authorization status
  - Blocking status
  - Recent connection time
  - Failed pairing count
  - Sync volume
  - Manual unblock
  - Local record removal where it does not mutate sync queue or ledger semantics
  - Device-scoped sync and access record drilldown

- `Shared / Public Files`
  - Desktop-managed public/shared file registry
  - Add/remove shared file or folder entries from desktop only
  - Resource type, size, visibility, recent access, and download count
  - No mobile-side add/remove management

- `Library / Received`
  - Browse received/synced material on desktop
  - Show metadata, source mobile, completion date, and containing location
  - Allow desktop to add eligible received items to shared/public registry
  - Do not expose queue-destructive actions

- `Records`
  - Sync records
  - Access records
  - Filtering and empty states
  - No destructive ledger editing

- `Settings`
  - New-version settings only
  - Device name
  - Storage path
  - Connection code/security
  - Language
  - Support/diagnostics
  - Sidecar/runtime status
  - Hide old settings entries that are not represented in the new reference product

- `Help / About`
  - Consolidated new help/about entry
  - Hide scattered legacy help entry points not represented in the new IA

### Mobile

Mobile works against the currently connected desktop and stores only convenience state locally:

- `Discovery / Recent Desktops`
  - LAN desktop discovery
  - Recently connected desktops
  - Direct reconnect when online and authorized
  - Fall back to code verification when required

- `Code Verify`
  - Connection-code input
  - Wrong attempt feedback
  - Blocked state after desktop-side permanent block
  - Instruction that desktop must manually unblock

- `Sync Activity`
  - Current desktop connection state
  - Automatic incremental sync progress
  - Pending, active, completed, and error summaries
  - No queue delete/reorder/skip UI

- `Shared Files`
  - Browse current desktop public/shared resources
  - Browse allowed received-library resources exposed by current desktop
  - Download/open resources
  - Write desktop access records for list/view/download
  - No add/remove shared resource management

- `History`
  - Current desktop-scoped sync, download, and error history
  - Scope changes when switching desktop

- `Album`
  - If retained in new IA, show pending/synced summary and automatic sync state
  - Do not provide production manual file-picking upload behavior

- `Settings`
  - Mobile local settings
  - Current desktop connection information
  - Reconnect/forget recent desktop
  - Diagnostics
  - Existing account/subscription gates only where still valid
  - Hide old entries not represented in the new reference product

## Data Ownership

### Sidecar SQLite

Sidecar SQLite is the source of truth for runtime, protocol, and local management data:

- desktop device identity
- device authorization records
- device block records
- connection-code attempt records
- sync records
- access records
- shared/public file registry
- received-library index or adapter over existing ledger data

### Desktop Main

Desktop main stores desktop-only UI preferences:

- window preference
- theme or view preference where applicable
- other UI-only local settings that are not protocol/runtime authority

Desktop main exposes new renderer capabilities through IPC/preload bridges and forwards to sidecar/local services as needed.

### Mobile Local State

Mobile local state stores convenience and session data:

- recent desktops
- current desktop session
- minimal cached labels needed for user-friendly reconnect

Mobile local state is not authority for another desktop's device management, block state, shared files, or access records.

### Remote Server

No new server storage is introduced for:

- device management
- authorization
- blocking
- sync records
- access records
- public/shared files
- LAN shared-library browsing

Existing login, account, and subscription behavior remains only where current production already uses it.

## Data Model

Add or extend local sidecar persistence with these concepts. Exact table names can follow existing migration conventions.

### Desktop Device Identity

Stores the local desktop identity used to scope local authorization and block records.

Required fields:

- desktop device id
- created at
- updated at

### Device Authorizations

Records mobile devices authorized to access this desktop.

Required fields:

- desktop device id
- mobile client id
- mobile display name
- first authorized at
- last connected at
- authorization status
- metadata needed by desktop UI

### Device Blocks

Records permanently blocked mobile clients.

Required fields:

- desktop device id
- mobile client id
- reason
- failed attempt count
- blocked at
- manually unblocked at, if applicable

Block records are permanent until desktop explicitly unblocks.

### Connection Attempts

Records pairing/code-verification attempts that desktop can observe.

Required fields:

- desktop device id
- mobile client id
- attempt result
- failure reason
- attempted at

If the current handshake cannot identify `clientId` before code verification, update the handshake so sidecar can identify requester before validating the code.

### Sync Records

Records completed or failed sync activity.

Required fields:

- desktop device id
- mobile client id
- file/resource identifier
- file name
- size
- MIME/type where available
- status
- completed or failed at
- error summary where applicable

The historical "day" for synced material follows sidecar/desktop completion date.

### Access Records

Records mobile access to desktop resources.

Required fields:

- desktop device id
- mobile client id
- resource id
- resource kind
- access action: list, view, download, or error
- accessed at
- result

Do not expose sensitive full desktop paths to mobile.

### Shared Files

Stores desktop-managed public/shared registry entries.

Required fields:

- resource id
- desktop device id
- display name
- resource kind
- allowed local path or existing received resource id
- size/type metadata
- added at
- removed at, if applicable
- visibility/status

Mobile downloads must use resource ids. Sidecar resolves resource ids through this whitelist registry.

### Received Library Index

Provides browseable received/synced material.

Prefer an adapter over existing ledger/received file data if the same information already exists. Avoid duplicating large data unless needed for query performance.

## APIs And Protocol

### Desktop Management API

Expose sidecar-backed management functions to desktop renderer through main/preload:

- list devices
- get device detail
- unblock device
- remove local device record where allowed
- list sync records
- list access records
- list shared files
- add shared file/folder entry
- remove shared entry
- list received library
- add received item to shared registry

Renderer never calls sidecar or SQLite directly.

### LAN / Mobile API

Expose authorized LAN operations to mobile:

- get current desktop metadata
- get authorization/block state
- verify connection code
- list public/shared files
- list allowed received-library resources
- download resource by resource id
- record or implicitly produce access events for list/view/download

Every mobile resource operation checks authorization and block state first.

## Connection-Code Security

Pairing and verification must allow desktop/sidecar to identify requester before code validation:

- mobile sends `clientId`
- mobile sends display name
- desktop identity is known from discovery/handshake or response context
- sidecar validates block status before accepting code attempts
- sidecar records failed attempts
- 5 failed attempts permanently block `desktop deviceId + mobile clientId`
- successful verification creates or updates authorization record
- desktop manual unblock clears active block state

If wrong-code requests currently cannot reach desktop reliably, protocol work is mandatory before UI exposes remaining-attempt or permanent-block behavior.

## Shared And Library Access

Mobile can browse and download only resources exposed by the current desktop.

Rules:

- Desktop manages public/shared registry.
- Mobile cannot add or remove registry entries.
- Mobile uses resource ids, not filesystem paths.
- Sidecar rejects path traversal and non-registry paths.
- Removing a shared entry prevents future list/download access.
- Files already downloaded to mobile are not reclaimed.
- Missing local files return explicit errors and produce records where useful.

## Legacy Entry Hiding

Hide all user-reachable old feature entry points that are not represented by the new reference product:

- primary navigation
- secondary buttons
- menus
- settings rows
- empty-state CTAs
- help/about links
- modal launchers

Do not delete underlying compatibility logic by default. Keep existing stores, bridges, native modules, and tests where needed for compatibility, unless a specific old UI artifact blocks the new architecture.

## Error Handling

- Sidecar unavailable: desktop shows runtime banner; mobile shows the current desktop unavailable.
- DB migration failure: desktop shows blocking management error instead of fake empty state.
- Authorization expired or blocked: mobile exits or freezes current desktop session into a blocked state.
- Wrong code under limit: mobile shows failure and remaining attempts where available.
- Wrong code at limit: mobile shows permanent blocked state and desktop-unblock instruction.
- Shared file missing: desktop marks resource invalid; mobile download returns explicit error.
- Records API failure: show retry state; do not silently show fake empty data.
- Old data migration: preserve existing queue, ledger, and sync state machine behavior.

## Security And Privacy

- Desktop UI displays shortened `clientId` where possible.
- Mobile never receives arbitrary desktop filesystem paths.
- Download endpoints resolve only registered resource ids.
- Access records store necessary metadata, not sensitive path details for mobile.
- Recent desktop data on mobile is convenience metadata only.
- New events follow existing dot-notation naming conventions.

## Testing Strategy

### Contracts

- Build contracts before desktop/mobile consumers.
- Add or update type tests where this repo already has contract tests.
- Ensure desktop/mobile import shared DTOs from `@lynavo-drive/contracts`.

### Sidecar

Add Go tests for:

- migrations from existing DB
- authorization creation/update
- failed attempts and permanent block after 5 wrong codes
- manual unblock
- desktop-local isolation
- shared registry whitelist
- missing shared file
- path traversal rejection
- sync/access record writes

### Desktop

Add or update tests for:

- preload/main IPC bridge coverage
- devices page states and actions
- shared/public files management
- received library browsing
- records filtering and empty states
- settings entry hiding
- no direct renderer sidecar/SQLite access

### Mobile

Add or update tests for:

- recent desktop list and reconnect
- code verification failure and blocked state
- sync activity without queue-destructive actions
- shared files list/download states
- history scoped to current desktop
- settings and album entry hiding/new positioning

### Verification Commands

Expected final verification includes:

- `pnpm build`
- `pnpm typecheck`
- targeted desktop renderer tests
- targeted mobile tests
- mobile TypeScript check
- sidecar `go test ./...`

If full commands are too slow or blocked by local environment, document exact failures and run narrower equivalents.

## Migration Strategy

- Add tables/indexes/views; do not delete existing data.
- Do not mutate queue semantics.
- Do not infer old device authorizations from weak identifiers.
- Start device records from first new-version connection when strong identity is available.
- Shared files initial state is empty.
- Received library should derive from existing completed-receive data when possible.
- Keep rollback risk low by hiding legacy UI entries before deleting any compatibility code.

## Rollout Plan

Implementation should be staged:

1. Contracts and sidecar persistence/API skeleton.
2. Desktop preload/main bridges and new IA shell.
3. Desktop devices, shared files, records, and library pages.
4. Mobile recent desktops, discovery, code verification, and sync activity.
5. Mobile shared files, history, settings, and album repositioning.
6. Legacy entry hiding audit.
7. Tests, docs, and final self-review.

Use an isolated worktree for implementation. Subagents may be used after the implementation plan is written, but file ownership must be separated so agents do not overwrite each other's changes.

## Open Implementation Risks

- Current handshake may not expose mobile `clientId` before wrong-code validation. If not, protocol work is required before code-attempt counting can be correct.
- The reference projects include UI concepts with cloud wording. Product copy must be rewritten for desktop-local LAN semantics.
- This update touches contracts, sidecar, desktop, and mobile. The implementation plan must split work into verifiable tasks and avoid a single large unreviewable change.
- Existing sidecar ledger schemas may already contain part of received-library data. The implementation should inspect current schema before creating redundant tables.

