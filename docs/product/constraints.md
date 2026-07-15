# Lynavo Drive Product Constraints And Non-Goals

This document expresses the current project's core product constraints in
product terms, so handoffs use the same boundaries.

## 1. Current Product Boundaries

Lynavo Drive V2 currently does two things:

- Local-LAN incremental sync from `Mobile (iOS / Android) -> Desktop (macOS /
Windows)` through automatic scanning plus the pending queue.
- Desktop shared files that mobile can browse and download.

Explicitly out of current scope:

1. Cloud relay / cloud backup.
2. Multi-file concurrent upload.
3. Manual file selection as a substitute for automatic incremental sync.

Additional notes:

- macOS / Windows are both in current desktop scope, and iOS / Android are both
  in current mobile scope.
- Auxiliary capabilities do not need exact cross-platform parity. Platform
  differences follow the current implementation; for example, Windows sharing
  addresses are mainly manually configured.
- Linux desktop keeps local build / package verification paths only. Functional
  coverage follows current code and the test matrix.

## 2. OSS Capability Boundaries

This repository is a single OSS baseline. It does not maintain multi-market
distribution paths and does not include official account / remote-access
runtime.

The OSS version must keep:

1. Guest local LAN mode: users without sign-in or account-service state can
   still discover the desktop, pair, and sync automatically in foreground LAN
   scenarios.
2. Foreground LAN automatic sync: the upload set comes from the mobile local
   pending queue.
3. Desktop local `received` / `shared` directory browsing and download.
4. Read-only queue and single-file serial upload.
5. Local diagnostics export without relying on an official remote upload
   service.

The OSS version does not provide:

1. Market branches, market switching, dedicated release profiles, or dual-market
   regression matrices.
2. Official accounts, server-side capability, server-side account recovery, or
   social-login runtime.
3. Remote access outside local LAN, relay, tunnel credentials, or
   cloud-assisted routes.
4. Background silent continuation / background upload beyond foreground LAN
   recovery.
5. Manual file selection, manual current-round upload selection, or manual
   pending queue adjustment.
6. Apple Bonjour for Windows binary redistribution. Windows native Bonjour only
   relies on the user's local installation or locally permitted configured
   sources; when missing from the source package, it uses the
   zeroconf-compatible fallback.

Failure strategy:

1. Foreground LAN fail-open: sign-in state, account-service state, missing
   server-side capability, or missing non-OSS modules must not block foreground
   LAN automatic sync.
2. Remote/background fail-closed: remote access, tunnel, relay, and silent
   background continuation must be disabled without official capability and
   valid server-side capability.
3. Missing, expired, unconfirmed, or malformed server-side capability is treated
   as unavailable.
4. Remote/background check failure must not clear LAN pairing, sync identity, or
   pending queue.

Migration boundaries:

1. package scope rename
2. mDNS service type and sidecar health service rename
3. Legacy data-dir, keychain, shared-preference migration
4. iOS bundle id, Android application id, native package namespace rename
5. Existing public-distribution continuity decisions

These migrations are not part of OSS baseline documentation cleanup. Handle them
only with an independent plan and rollback strategy.

## 3. Product Constraints To Preserve

### 3.1 Upload Model: Automatic Scan + Pending Queue

The system keeps only one upload source:

1. **Automatic upload (auto)**: scan the photo library, identify unsynced media,
   automatically queue, resume, and recover. Media type filters and time range
   are configurable.

The real upload set must come from the mobile local pending queue after scanning.
The product does not provide alternate paths for manual file selection, manual
photo picking, or manual batch upload submission.

### 3.2 Queue Controls

User queue controls:

- **Allowed**: turn automatic upload on/off.
- **Not allowed**: delete individual queue items, skip individual items,
  manually reorder, or manually mark as complete.

Queue ordering is determined by enqueue/update time in the local pending queue.
After each file completes, the head is fetched again; the whole queue is not
prefetched.

### 3.3 Single-File Serial Upload

The same phone may upload only one file at a time.

Reasons:

1. Simpler state machine and resume logic.
2. Lower complexity in background and reconnect scenarios.
3. More explainable history statistics and error recovery.

### 3.4 Completion-Based History Statistics

The key semantic for history and dashboard statistics is:

- "How much synced today" is calculated by **desktop sidecar completed write**.

Not by:

- Capture date
- Asset creation date
- Mobile local UTC date

### 3.5 Renderer Isolation

The desktop renderer does not directly access:

1. SQLite
2. sidecar HTTP
3. Filesystem

This is not just engineering neatness; it is a product stability constraint:

- Diagnostics, permissions, packaging, and sidecar lifecycle must remain
  controlled.

## 4. Current User Promise

The actual user promise is:

1. Automatically discover and bind desktop devices.
2. Automatically perform incremental sync.
3. Recover automatically where possible after interruption.
4. Turn automatic upload on/off.
5. Show progress, history, storage location, and diagnostics export on desktop.
6. Let mobile browse files in the desktop shared directory.

Not promised:

1. Unified cloud media management.
2. Linux desktop user coverage.

## 5. Experience Priorities

Current priorities:

1. **Correctness**: do not lose files, corrupt history, or rewrite files badly.
2. **Recovery**: continue after network loss, restart, and foreground return.
3. **Explainability**: readable status prompts, diagnostics export, and history
   statistics.
4. **Performance**: as fast as possible after the above.

This means:

- Do not sacrifice ACK or transfer stability just to make the UI feel smoother.

## 6. Current Advanced Feature Positioning

### 6.1 Shared Directory

The desktop `shared/` directory is next to `received/` and is created at
startup. Mobile browses, previews, and downloads shared files through sidecar
HTTP endpoints.

Current platform differences:

- macOS: can combine with system file sharing for automatic detection.
- Windows: mainly manual sharing configuration, with quick UI entry points and
  recommended addresses.

### 6.2 Diagnostics Export

Diagnostics export is a local troubleshooting tool. The user decides whether to
share it. Before public sharing, redact paths, device names, IP addresses,
filenames, and local database content.

## 7. Evaluation Principles For Future Extensions

For new requirements, ask first:

1. Would it bypass automatic scanning and the pending queue by adding a manual
   file-selection path?
2. Would it introduce concurrent upload and break the single-file serial
   constraint?
3. Would it make history and state semantics harder to explain?
4. Would it let the renderer bypass the main/preload/sidecar boundary?

If any answer is yes, evaluate carefully before implementing.
