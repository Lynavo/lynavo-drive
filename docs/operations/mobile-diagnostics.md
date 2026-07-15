# Mobile Diagnostics Package

This document explains what the mobile diagnostics export currently contains,
how to read it, and what its limits are.

## 1. Export Format

The mobile diagnostics package exports as a zip file with a name like:

- `Lynavo Drive-Mobile-Diagnostics-20260325-214928.zip`

Export entry points:

- App settings page
- `Support & Diagnostics -> Export Diagnostics Package`

After export, the system share sheet opens. The user decides whether to share it
with maintainers. Do not upload an unredacted diagnostics package to a public
issue.

Privacy principles:

1. The diagnostics package is a local file. The OSS runtime does not
   automatically upload it to a remote service.
2. Before sharing, inspect and redact local paths, device names, IP addresses,
   filenames, and error context as needed.
3. `lynavo-drive.db` / `*-wal` / `*-shm` are highly sensitive. Include or share
   them only when the user explicitly opts in and troubleshooting truly needs a
   database snapshot.
4. For normal troubleshooting, prefer redacted snippets from `diagnostics.json`,
   `queue.json`, and `engine.log`.

## 2. Current Files

### 2.1 `diagnostics.json`

Core runtime snapshot, including:

1. `generatedAt`
2. `app`
   - App name
   - Version
   - build number
3. `device`
   - Mobile device information
4. `client`
   - `clientId`
   - Current display name
   - Whether a pairing token exists
   - Current preferred IPv4
5. `runtime`
   - `applicationState`
   - `bindingState`
   - `syncOverview`
   - `queueCount`
   - `photoAuthorization`
   - `sidecarHost`
   - `activeSession`
   - `recentRetry`
   - `recentError`
6. `thermal` (inside `syncOverview`)
   - `thermalState`: current thermal state (`nominal / fair / serious / critical`)
   - `activeTuningProfile`: profile label from `resolvedUploadTuning()` (`normal / background / background_thermal / active_capture / thermal_serious / thermal_critical / low_power / windows_safe`, including combinations)
   - `isThermalLimited`: whether upload is being slowed down
   - `performanceHint`: UI hint type (`none / thermal_limited`)

   Note: a mid-transfer thermal critical pause does not change
   `activeTuningProfile`; it appears through `THERMAL_PAUSE` / `THERMAL_RESUME`
   events in the diagnostics log.

### 2.2 `queue.json`

Current read-only pending queue snapshot.

Each item contains at least:

- `fileKey`
- `filename`
- `fileSize`
- `mediaType`
- `status`
- `isCloudAsset`

Use it to check:

1. Whether many pending items really remain.
2. Whether there is currently an `uploading / preparing / cloud_downloading`
   item.
3. Whether the issue involves iCloud assets.

### 2.3 `history.json`

Current mobile history snapshot, used to check:

1. Whether history has records.
2. Whether buckets are correct.
3. Whether device name/IP are mismatched.

### 2.4 `engine.log`

Native log ring-buffer snapshot.

Important modules:

- `SyncEngine`
- `DiscoveryService`
- `SyncPipeline`
- `SyncUpload`
- `Diagnostics`

### 2.5 `lynavo-drive.db`

Mobile local SQLite snapshot.

If present, these files are included too:

- `lynavo-drive.db-wal`
- `lynavo-drive.db-shm`

The database snapshot may contain local queues, paths, filenames, device
identifiers, and history. Include or share it only when the user explicitly opts
in; do not upload the full database to a public issue.

## 3. Key Field Notes

### 3.1 `runtime.bindingState`

Use this for current binding and connection-layer state.

Most important fields:

- `deviceId`
- `deviceName`
- `deviceAlias`
- `host`
- `port`
- `connectionState`
- `wake` (iOS / JS binding payload may contain full paired wake metadata)
- `wakeSupported` / `wakeTargetCount` (Android diagnostics expose a summary to
  avoid over-reliance on full targets in troubleshooting packages)

Wake-on-LAN interpretation:

1. `wake.supported=true` with usable targets means mobile previously received
   cacheable LAN wake metadata while the desktop was awake.
2. `wakeSupported=false` or `wakeTargetCount=0` means no usable wake metadata is
   currently available. Opening `My Computer` or pressing `Reconnect` should
   still return to the existing offline/reconnect flow.
3. Metadata can expire when the desktop changes networks, DHCP changes, the
   network adapter changes, or the router changes. Do not treat field presence
   alone as proof that wake will succeed.
4. This metadata only represents same-LAN WoL capability. OSS builds do not
   provide public Wake-on-WAN, router helpers, or relay wake; VPN is only a
   fallback.

### 3.2 `runtime.syncOverview`

Use this for the sync overview currently seen by the UI.

Most important fields:

- `currentDeviceId`
- `currentDeviceName`
- `currentSpeedMbps`
- `transferredBytes`
- `totalBytes`
- `progressPercent`
- `uploadState`
- `performanceHint`
- `performanceMessage`
- `thermalState`
- `activeTuningProfile`
- `isThermalLimited`

### 3.3 `runtime.activeSession`

Use this to determine whether the app is actually in an active sync round.

It includes:

- Current `sessionId`
- Current `state`
- Current active queue item
- `persistedSession`, if the local DB has an active persisted session

### 3.4 `runtime.recentRetry` / `runtime.recentError`

Use this to determine the most recent:

- Retry time
- Retry reason
- Error

This is important for connection failure prompts that recover seconds later,
frequent reconnects, and upload rounds that suddenly stop.

### 3.5 Thermal Signals

Use these to decide whether a slowdown is caused by thermal throttling rather
than network or sidecar problems.

Check first:

- `runtime.syncOverview.performanceHint`
- `runtime.syncOverview.performanceMessage`
- `runtime.syncOverview.thermalState`
- `runtime.syncOverview.activeTuningProfile`
- `runtime.syncOverview.isThermalLimited`

Current semantics:

- `performanceHint = thermal_limited`
  - Mobile has actively reduced load.
- `activeTuningProfile = background_thermal / thermal_serious / thermal_critical`
  - Current throttling comes from thermal state or background thermal protection.
- `THERMAL_PAUSE / THERMAL_RESUME`
  - Mid-transfer pause under critical thermal state. This is a log event and is
    not written to `activeTuningProfile`.

If `isThermalLimited = true` and `engine.log` also contains these keywords, the
issue is likely thermal control rather than transfer failure:

- `thermal state changed`
- `profile changed`
- `THERMAL_THROTTLE`
- `THERMAL_PAUSE`
- `THERMAL_RESUME`

### 3.6 Wake-on-LAN Signals

When checking whether wake was attempted after opening `My Computer` or pressing
`Reconnect`, start with `engine.log`:

- `wake skipped reason=<reason> metadata_missing_or_unusable`: the user opened
  `My Computer` or pressed `Reconnect`, but the bound desktop has no cached wake
  targets or the targets were judged unusable.
- `wake packets sent packets=<n>`: mobile sent `<n>` magic packets to directed /
  limited broadcast destinations.
- `wake packets sent`: older or summary-style log meaning mobile sent a magic
  packet.
- `wake LAN reachable host=<ip>` / `wake recovered LAN host`: during wake
  polling, `/health` became reachable from that LAN host.
- `wake polling exhausted` / `wake probe timed out`: after sending a wake packet,
  the sidecar did not recover within the bounded polling window.
- `retryLanReconnect LAN host unavailable; wake disabled`: the user pressed
  `Reconnect`, but this call did not allow wake or had no usable LAN host.
- `retryLanReconnect wake did not recover LAN host`: `Reconnect` attempted LAN
  wake retry but did not recover.

These wake diagnostics only represent shared-files route selection or explicit
LAN reconnect recovery. They do not mean the upload queue was modified,
reordered, or cleared.

Behavior boundaries:

1. App launch, foreground return, or simply showing offline should not produce
   `wake packets sent`.
2. `Reconnect` is LAN / VPN-LAN retry, not public Wake-on-WAN.
3. OSS builds do not provide router helpers, third-party wake helpers, public
   relay wake, or peer proxy wake.
4. If the phone is on an external network with no VPN-LAN fallback, wake failure
   is a capability boundary and should not be treated as an upload queue or sync
   state-machine error.

## 4. Current Size Controls

There is no hard limit today, but there are soft controls:

1. `engine.log` is a ring buffer.
2. `diagnostics.json / history.json` are snapshots.
3. `queue.json` is currently the full pending queue.
4. `lynavo-drive.db` is a full database copy.

The least predictable sizes are usually:

1. `queue.json`
2. `lynavo-drive.db`

If the exported package includes a database snapshot, preserve database
integrity during troubleshooting. For public sharing, prefer deleting the
database or providing only redacted key fields.

## 5. Suitable Issues

The package is currently enough to locate these issue types:

1. Whether the app is the latest build.
2. Whether many pending items really exist.
3. Whether the queue is large but no real `uploading` is happening.
4. The current actual sidecar address.
5. Whether iCloud assets are involved.
6. The most recent error/retry.
7. Whether the app is really in an active session.
8. Whether current slowdown or short pause is thermal-driven.

## 6. Current Limits

Known limits:

1. Logs are a ring buffer and may not cover full older history.
2. The package has no sidecar-side information; pair it with desktop
   diagnostics.
3. If an old history bucketing issue is already persisted in local aggregate
   tables, the package can only show the current result and cannot correct it.

## 7. Recommended Companion Material

When troubleshooting, prepare these together when possible:

1. Mobile diagnostics package
2. Desktop diagnostics package
3. Version numbers at the time
4. Short reproduction description

If only mobile material is available, priority order is:

1. `diagnostics.json`
2. `queue.json`
3. `engine.log`
4. `lynavo-drive.db` (only when the user explicitly opts in)
