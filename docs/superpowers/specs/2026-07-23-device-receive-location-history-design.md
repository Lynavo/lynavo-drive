# Device Receive Location History Design

Date: 2026-07-23

## Background

When the desktop receive root changes, files that were already received remain
at the old location while later uploads are written below the new root. The Sync
Records page currently exposes only the device folder below the current receive
root, and relative completed-upload paths are not yet preserved before the root
switch. A device that has used more than one receive root therefore has no clear
desktop entry point to its historical folders.

## Goals

- Expose every device folder in which a selected `clientId` has successfully
  completed an upload.
- Distinguish the current location, historical locations, and unavailable
  locations.
- Preserve the existing one-click behavior when exactly one usable location
  exists.
- Retain location history independently of later completed-upload cleanup.
- Keep the feature read-only and isolated from sync, queue, and file movement
  behavior.

## Non-Goals

- Do not include receive roots that never received a completed upload from the
  device.
- Do not let users add, remove, reorder, or edit historical locations.
- Do not move files between receive roots.
- Do not mount, repair, or delete unavailable external-drive or network paths.
- Do not change device identity, `receiveDirName`, upload completion, or history
  statistics semantics.

## Chosen Approach

The sidecar owns a persistent receive-location index. It is populated through
two paths:

1. On the first location query for a `clientId`, completed uploads are inspected
   and valid device folders are inserted into the index. A per-client backfill
   marker makes this operation one-time.
2. After every future upload completion, the sidecar records the actual device
   folder and latest use time directly in the index.

This preserves legacy locations after completed-upload records are removed while
keeping `uploads.final_path` as the source of truth for the initial backfill.
Renderer-local caching is rejected because receive paths belong to sidecar
persistence and must survive desktop UI state resets.

## Data Model

Add an idempotent migration containing:

```sql
CREATE TABLE IF NOT EXISTS device_receive_locations (
  client_id    TEXT NOT NULL,
  path         TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  PRIMARY KEY (client_id, path)
);

CREATE TABLE IF NOT EXISTS device_receive_location_backfills (
  client_id TEXT PRIMARY KEY
);
```

An index on `(client_id, status)` supports the one-time completed-upload lookup.

Location upserts retain the latest RFC 3339 `last_used_at`. Path identity uses
`filepath.Clean`; Windows derivation and de-duplication are case-insensitive.

## Backfill And Recording Rules

Only uploads with `status = 'completed'` and a non-empty `final_path` are
eligible for backfill. Existing final-path resolution rules apply:

- relative paths resolve below the current `ReceiveDir`;
- absolute paths retain their original location;
- only `<device folder>/<YYYY-MM-DD>/<file>` layouts are accepted;
- malformed, traversing, or root-level paths are ignored;
- the device folder is two levels above the completed file path.

Before a receive-root change, completed relative paths must be converted to
absolute paths by the settings workflow. This allows a later backfill to recover
the old device folder accurately after `ReceiveDir` points somewhere else.

After a successful upload completion, the sidecar records the absolute device
folder only when the upload store update succeeds. A failure to update the
location index is logged and does not turn an otherwise successful file upload
into a failed transfer.

## Contract And API

Add the shared contract to `@lynavo-drive/contracts`:

```ts
export interface DeviceReceiveLocationDTO {
  path: string;
  available: boolean;
  isCurrent: boolean;
  lastUsedAt: string;
}
```

Expose a local, authenticated, read-only sidecar endpoint:

```text
GET /devices/:clientId/receive-locations
```

The Electron sidecar client URL-encodes `clientId`. Renderer access remains
strictly behind the existing main/preload bridge:

```text
ReceivedLibraryPage
  -> preload bridge
  -> Electron main IPC
  -> sidecar client
  -> sidecar receive-locations API
  -> SQLite index / initial upload backfill
```

Every query re-evaluates filesystem availability and current-root membership:

- `available` is true only when the path exists and is a directory;
- `isCurrent` is true only when the path is within the current `ReceiveDir`;
- current locations sort first;
- remaining locations sort by `lastUsedAt` from newest to oldest.

## Desktop Interaction

When the user clicks a device folder button on Sync Records:

1. Query receive locations for that device's `clientId`.
2. If exactly one location exists and is available, open it directly.
3. If multiple locations exist, show the location dialog.
4. If the only location is unavailable, show the dialog so its path remains
   visible and copyable.
5. If no valid locations exist, show a localized unavailable-location toast.

The dialog shows the device display name and one row per location. Rows label
current, historical, and unavailable states. Available rows open the folder;
all rows allow copying the path. Long paths truncate visually while retaining a
full-value tooltip, and only the list body scrolls when the result is long.

The dialog supports Escape and backdrop closing, focus trapping, focus return
to the invoking button, keyboard activation, and reduced-motion behavior. If an
open operation fails, the dialog stays open, the affected row becomes
unavailable for the current view, and a localized error toast is shown.

## Error Handling

- A sidecar query failure produces a localized receive-location query error.
- An unavailable row cannot invoke the folder-opening bridge.
- A folder-opening failure does not fall back to the receive root.
- Unavailable paths remain persisted and can become available again after an
  external disk or network location reconnects.
- Invalid persisted timestamps or paths are skipped instead of exposing an
  unsafe or misleading parent directory.

## Scope And Contamination Boundaries

Directly affected areas:

- shared contracts;
- Go sidecar migration, store, upload-completion hook, and local API;
- Electron main/preload bridge;
- Sync Records renderer UI and localization;
- focused Go and TypeScript tests.

The implementation must not change:

- the mobile pending queue or single-file serial upload rule;
- sync state transitions, resume, reconnect, or completion-day grouping;
- upload selection or completed-file statistics;
- stable-device and `clientId` identity semantics;
- `receiveDirName` allocation or reconciliation;
- permission, account-service, remote capability, or background gates;
- files on disk or current receive-root configuration behavior.

## Validation Strategy

### Sidecar

- Backfill relative and absolute completed paths.
- Reject traversal, malformed layouts, and paths without a device segment.
- De-duplicate folders and retain the latest use time.
- Keep current locations first and sort historical locations by recency.
- Re-evaluate available and current status on every query.
- Restrict results to the requested `clientId` and require local control
  authentication.
- Persist backfilled locations after source upload rows are deleted.
- Record new locations at upload completion.
- Cover Windows case-insensitive de-duplication.

### Contracts And Electron Bridge

- Export the DTO from the contracts package.
- Forward encoded `clientId` and API results through main and preload.
- Preserve sidecar HTTP failures for renderer handling.

### Renderer

- Open one available location without showing the dialog.
- Show the dialog for multiple locations or one unavailable location.
- Render status, ordering, device name, long paths, and scrolling behavior.
- Open available rows, copy every row, and disable opening unavailable rows.
- Keep the dialog open and mark a row unavailable after an open failure.
- Show localized errors for query, empty-result, and open failures.
- Restore focus to the original folder button when the dialog closes.

## Completion Criteria

- A user can reach every retained receive folder used by a selected device.
- The common single-folder case remains one click.
- Historical and unavailable paths remain visible without changing files or
  sync behavior.
- Location history survives cleanup of completed upload records.
- Focused tests and repository checks pass for every modified layer.
