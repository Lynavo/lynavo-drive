# Lynavo Drive Sync State Machine

This document records the main state machines, state meanings, and UI semantics
in the current system. The key distinction is short liveness probes versus real
sync sessions.

## 1. Why This Document Exists

Several real issues came from confused state semantics:

1. The app showed connection failure even though it recovered within seconds and
   continued uploading.
2. The UI showed connected too early after a short probe succeeded.
3. The header kept showing the previous file at `100%` while no file was
   currently transferring.
4. The UI had many queued items while the actual session had `queueCount=1`.

For handoff, separate the state layers first.

## 2. Four State Layers

There are at least four state layers. Do not merge them:

1. **Binding / Connection state**
   - Device discovery, binding, liveness probes, and heartbeat connectivity.
2. **Upload state**
   - Coarse stage of the current sync round.
3. **SyncEngine internal state**
   - Finer native-engine internal state machine.
4. **Queue item state**
   - State of one file in the local queue.

## 3. Binding / Connection State

The contract is defined in `@lynavo-drive/contracts`:

- `discovering`
- `bound`
- `connecting`
- `connected`
- `offline`

Usage:

1. Device status on the discovery page.
2. Coarse connection status on the settings page.
3. One input to the home page top-level connected/offline prompt.

Semantics:

- `discovering`: browsing Bonjour services.
- `bound`: local binding exists, but no live link is currently confirmed.
- `connecting`: probing, heartbeating, or connecting a sync link.
- `connected`: the last heartbeat or sync link confirmation succeeded.
- `offline`: the last connection or heartbeat failed.

Notes:

- `connected` does not mean a long TCP session is currently transferring.
- In idle state, the app does short probes and HTTP `/presence` heartbeats.
- Therefore `connected` only means this desktop is currently reachable and the
  binding is valid.

## 4. Upload State

`@lynavo-drive/contracts` defines coarse states:

- `idle`
- `scanning`
- `queued`
- `uploading`
- `paused`
- `retrying`
- `completed`
- `failed`

The mobile UI currently consumes finer native runtime strings, including:

- `idle`
- `scanning`
- `preparing`
- `uploading`
- `reconnecting`
- `completed`
- `paused_no_permission`

This is the current implementation. Future cleanup should align coarse state and
runtime state before adding more strings.

## 5. SyncEngine Internal State

The internal state enum is `SyncEngineState` in `@lynavo-drive/contracts`:

- `idle`
- `discovering`
- `scanning`
- `preparing`
- `syncing_foreground`
- `backoff_waiting`
- `paused_no_target`
- `paused_no_permission`
- `stopped`

These states are mainly for native-layer scheduling, not direct end-user UI.

## 6. Queue Item State

A single file currently moves through these states:

- `discovered`
- `queued`
- `preparing`
- `ready`
- `cloud_downloading`
- `uploading`
- `completed`
- `failed`

Key notes:

1. `cloud_downloading` appears only during iCloud asset export.
2. `completed / failed` files do not stay in the read-only pending queue.
3. Desktop does not directly consume these native states; it reads sidecar
   aggregated upload records.

## 7. Standard Sync Round

### 7.1 Normal Foreground Sync

1. `bindingState = connecting`
2. `uploadState = scanning`
3. Photo library scan finishes and new assets are queued.
4. The upload set is built from the local pending queue.
5. `uploadState = preparing`
6. `HELLO_REQ / AUTH_REQ / SYNC_BEGIN_REQ`
7. `uploadState = uploading`
8. Each file moves through `preparing -> cloud_downloading? -> uploading -> completed`.
9. After all files finish, `uploadState = completed`.
10. Idle polling returns to `idle`.

### 7.2 Idle Liveness Probe

When idle, the app:

1. Opens a short TCP connection to resolve the sidecar host.
2. Actively closes the short connection after authentication.
3. Maintains the connected heartbeat through HTTP `/presence`.

Therefore:

- Seeing EOF immediately after successful `HELLO / AUTH` can be normal.
- This is not a bug by itself.
- It is a state-machine problem only when the flow should enter `SYNC_BEGIN`
  but does not.

## 8. Reconnect Semantics

For a short `FILE_ACK timeout` or network fluctuation, the current intended
interpretation is:

1. The transport layer had a real short interruption.
2. The app automatically enters `backoff_waiting`.
3. It may recover within seconds and continue uploading.

Product display guidance:

- Automatic recovery within seconds: `Network fluctuated, reconnecting`.
- No recovery past the threshold: `Connection failed` or `Waiting for network`.

Do not present an auto-recoverable short fluctuation as final failure.

## 9. Known Pitfalls

1. **Short probes are not real sync connections.**
2. **Header progress must not retain the previous file's 100% state.**
3. **Queue UI and the real upload set must both be based on the pending queue.**
4. **Connection failure must be separated from short automatic reconnect.**
5. **Cold start should not flash a disconnected/reconnecting banner.**

## 10. Handoff Guidance

When troubleshooting sync, ask these three questions first:

1. Is the current flow a short probe, real sync, or reconnect recovery?
2. Does the UI queue match the real `queueCount`?
3. Is the issue in the binding, upload, or single-file state layer?
