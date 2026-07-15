# Lynavo Drive System Overview

This document helps new contributors understand current system boundaries,
responsibilities, and the main flow. It is not a product spec; behavior follows
the current code and `@lynavo-drive/contracts`.

## 1. Goals

Lynavo Drive currently has a focused scope:

1. Automatically or semi-automatically bind one mobile device to one desktop.
2. Incrementally sync photo library media to the desktop over local LAN.
3. Recover as automatically as possible from foreground LAN interruption,
   reconnect, foreground return, and short platform-allowed recovery windows.
4. Provide queue, history, storage, diagnostics, and release-verification views
   on desktop.

The current scope is explicitly limited to:

- Supporting the `iOS / Android -> Desktop` sync path.
- Local-LAN transfer only.
- No OSS-baseline commitment for remote access or silent background
  continuation.
- No user-driven manual selection, deletion, skipping, or queue reordering in
  the UI.
- One phone uploads only one file at a time.

## 2. Runtime Components

### 2.1 Electron Desktop

Responsibilities:

1. Provide desktop UI and settings.
2. Start, monitor, and package the sidecar.
3. Expose IPC APIs to the renderer through the preload bridge.
4. Aggregate diagnostics and export the desktop diagnostics package.

Constraints:

- The renderer does not directly access the sidecar, filesystem, or SQLite.
- All access is routed through main / preload.

Key directories:

- `apps/desktop/src/main`
- `apps/desktop/src/preload`
- `apps/desktop/src/renderer`

### 2.2 Go Sidecar

Responsibilities:

1. Provide the TCP file-receive protocol service.
2. Provide HTTP API, WebSocket, sharing detection, and dashboard aggregation.
3. Manage receive directories, resumable `.part` files, and SQLite persistence.
4. Broadcast Bonjour/mDNS for mobile discovery.

Key ports:

- TCP/LMUP: `39593`
- HTTP API: `39594`

Key directories:

- `services/sidecar-go/internal/server`
- `services/sidecar-go/internal/api`
- `services/sidecar-go/internal/store`
- `services/sidecar-go/internal/mdns`

### 2.3 React Native Mobile UI

Responsibilities:

1. Show discovery, sync status, history, and settings.
2. Call platform capabilities through the native bridge.
3. Call the iOS / Android `SyncEngine` capability through the native bridge.
4. Host UI only; real transfer is handled by native sync.

Key directories:

- `apps/mobile/src/screens`
- `apps/mobile/src/navigation`
- `apps/mobile/specs`

### 2.4 Mobile Native SyncEngine

Responsibilities:

1. Discover the desktop and maintain binding state, heartbeat, and short probes.
2. Scan the photo library, export media, and maintain the local upload queue.
3. Establish TCP protocol sessions and perform file transfer, resume, and
   reconnect.
4. Emit binding, queue, sync state, and diagnostics events to RN.

Key directories:

- `apps/mobile/ios/SyncEngine`
- `apps/mobile/android/app/src/main/java/com/lynavo/drive/mobile/sync`

## 3. Key Data Flows

## 3.1 Discovery

1. The sidecar broadcasts `_lynavodrive._tcp` through Bonjour.
2. macOS / Windows prefer native `dns-sd` broadcast. On Windows, missing
   Bonjour falls back to a zeroconf-compatible broadcaster.
3. iOS browses local services with `Network.framework`. Android browses
   `_lynavodrive._tcp` with `NsdManager` and falls back to manual IP entry when
   no device is discovered.
4. The current implementation prefers the IPv4 information advertised by the
   sidecar to avoid misclassifying `fe80::` link-local IPv6 addresses.
5. The discovery list shows devices that can be probed and connected, not
   merely devices with broadcasts.

## 3.2 Pairing

1. The desktop generates a connection code and shows it in settings.
2. Mobile enters the connection code and sends `PAIR_REQ` to the sidecar.
3. The sidecar stores `paired_devices`.
4. Mobile stores `pairingToken` and `clientId` locally (Keychain + SQLite).

Device identity constraints:

- The desktop identifies a phone by `clientId`.
- It does not use device name, IP, or directory name for identity.

## 3.3 Upload

Standard path:

1. Mobile scans media from the platform photo library and writes it to the
   local upload queue.
2. The main upload round builds the real upload set from the local pending
   queue.
3. `SyncEngine` opens a TCP session and sends
   `HELLO_REQ / AUTH_REQ / SYNC_BEGIN_REQ`.
4. The sidecar processes `FILE_INIT_REQ / FILE_DATA / FILE_END_REQ` per file.
5. The sidecar writes the file and returns the final result plus `ledgerDate` in
   `FILE_END_RES`.
6. Mobile updates local history and queue state.
7. Desktop reads aggregated results through sidecar HTTP / WebSocket.

Key constraints:

- The upload set must come from the local pending queue, not only assets newly
  scanned in the current round.
- Otherwise the state machine can show many queued items while `queueCount=1`
  or `0`.

## 3.4 Resume And Reconnect

1. When transfer is interrupted, the app enters short reconnect and backoff.
2. The sidecar supports resume through `uploads.committed_bytes` plus `.part`
   files.
3. After recovery, the next `FILE_INIT_REQ` uses `RESUME`.
4. For users, short automatic recovery should read as reconnecting, not final
   failure.

## 3.5 History And Statistics

The current rule is unified around the sidecar/desktop completion day:

1. The sidecar writes `uploads.completed_at` when a file completes.
2. The sidecar buckets `device_daily_stats` by the desktop local day.
3. Mobile prefers the sidecar-returned `ledgerDate` from `FILE_END_RES`.
4. Desktop detail/history also use sidecar data.

## 4. Source of Truth

Current development and troubleshooting use this priority order:

1. Current committed code
2. `@lynavo-drive/contracts`
3. The OSS verification matrix in `docs/testing/oss-verification-matrix.md`

Do not rely on deleted historical spec files.

## 5. Current Project Structure

```text
apps/desktop      Electron desktop
apps/mobile       React Native iOS/Android + platform-native SyncEngine
packages/contracts Shared DTOs, constants, ports, event names
packages/design-tokens Shared design tokens
services/sidecar-go Go sidecar
scripts/ios       Device upload regression scripts
scripts/release   OSS build profile / release gate scripts
```

## 6. Onboarding

New contributors should read in this order:

1. This document
2. `docs/architecture/sync-state-machine.md`
3. `docs/architecture/data-model.md`
4. `docs/operations/troubleshooting.md` for specific issues
5. `docs/release/release-playbook.md` for release work
