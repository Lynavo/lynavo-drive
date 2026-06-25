# Mobile Pairing Invalidation Design

## Context

When the desktop pairing code is reset, existing mobile clients keep an old pairing token. That condition is different from a normal offline state: the desktop is explicitly rejecting the previous pairing relationship, so the mobile app should guide the user back to pairing instead of leaving them on the sync home screen.

This design focuses on the global mobile app. CN-specific UI and copy are out of scope for this pass.

## Goal

If a previously paired mobile app receives an explicit signal that its pairing is no longer valid, the app should reset to the device pairing flow in both foreground and cold-start scenarios.

Normal reachability failures must remain ordinary offline states. The app must not send users to pairing just because the desktop is temporarily unavailable.

## Definitions

- `offline`: The desktop cannot currently be reached, or the app is reconnecting. This can be caused by network changes, desktop sleep, app lifecycle transitions, or tunnel disruption.
- `pairing_invalidated`: The desktop or native sync engine has explicit evidence that the stored pairing token is no longer accepted.
- `binding lost`: The native layer has no usable active binding for the current account and emits no binding state to JavaScript.

## Invalidation Sources

The native sync engine should treat these as `pairing_invalidated`:

- An authenticated LMUP connection receives a desktop `PAIRING_INVALIDATED` control frame.
- `/presence` returns `paired:false` for the current binding.
- The sidecar rejects a request with a clear pairing-token/auth invalid response.
- The native layer detects a missing pairing token while a persisted binding exists.
- A reconnect or resume path receives an explicit token-invalid response from the current desktop.

These cases should not be treated as `pairing_invalidated` by themselves:

- LAN `/health` timeout or connection refusal.
- Tunnel unavailable.
- Desktop app not running.
- Phone network transition.
- Desktop sleep without an explicit unpaired/token-invalid response.

## Native Behavior

Add one native helper per platform for the invalidation path, for example `invalidateCurrentPairing(reason)`.

The helper should:

- Stop sync, heartbeat, reconnect probes, and P2P/tunnel work for the stale binding.
- Clear or quarantine the active binding and stale pairing token for the current desktop.
- Persist enough state for cold start to route the user back to pairing after login.
- Emit a binding update that JavaScript can interpret as pairing invalidated.
- Write diagnostic logs with a stable reason such as `pairing_invalidated`.

The helper must be called only after explicit invalidation evidence, not after generic offline/reconnect failures.

## Desktop Active Invalidation

Resetting or setting the desktop pairing code invalidates every existing pairing created with the old code. The sidecar should therefore notify active authenticated LMUP clients before it closes their TCP sockets.

Add LMUP message type `PAIRING_INVALIDATED` (`0x0014`). The payload is JSON with a stable reason, for example `{ "reason": "connection_code_regenerated" }` or `{ "reason": "connection_code_set" }`.

When desktop calls `DisconnectClients` from the pairing-code reset/set path, the sidecar should send `PAIRING_INVALIDATED` through the normal serialized connection writer, then close the socket. Using the connection writer is required because reset can happen while FILE_ACK, PING, or other control frames are also being sent.

Mobile treats this frame as explicit invalidation evidence for the current binding and calls the same native `invalidateCurrentPairing(...)` helper used by `/presence paired:false` and token auth rejection. The active protocol session should abort after invalidation; it should not continue as a normal offline/retry failure.

To avoid waiting for the next `/presence` interval while the app is online but idle, mobile keeps a lightweight authenticated LMUP control session whenever the current binding is `connected` and no upload session is active. The session performs `HELLO / AUTH`, then waits for desktop-pushed control frames. It does not mark the binding offline on ordinary socket drops; it logs the drop and retries after a short delay while the same binding identity is still current. During an upload round, the upload TCP session is the active invalidation receiver and the idle control session is stopped.

The existing `/presence paired:false` path remains the fallback for older clients/desktops, control-session setup failures, or rare frame delivery failures.

## JavaScript Navigation Behavior

Global mobile should handle pairing invalidation centrally instead of relying on a specific screen being mounted.

When JavaScript receives an invalidated binding signal:

- Reset navigation to `DeviceDiscovery`.
- Pass `reason: 'pairing_invalidated'`.
- Prevent duplicate resets if multiple native events arrive during the same transition.

Existing offline UI remains unchanged for ordinary reconnectable failures.

## Device Discovery UI

`DeviceDiscoveryGlobalScreen` should support `reason: 'pairing_invalidated'`.

For that reason, the screen should show a concise one-time message explaining that the desktop pairing code changed and the user needs to pair again.

Suggested English copy:

> This desktop changed its pairing code. Pair again to continue.

The screen should keep the existing pairing choices available, including QR scan, manual IP pairing, and recent desktop reconnect where applicable. If recent desktop reconnect fails with token invalidation, it should remain in the pairing flow instead of returning to the sync home.

## Cold Start Behavior

On app launch after login:

- If native has persisted `pairing_invalidated`, route directly to `DeviceDiscovery` with `reason: 'pairing_invalidated'`.
- If native only has an old binding and no explicit invalidation yet, keep the existing startup behavior and run presence validation.
- If presence validation later returns `paired:false`, run the invalidation path and reset to `DeviceDiscovery`.

This avoids falsely treating normal offline starts as pairing resets.

## Testing

Native tests should cover:

- Desktop reset/set pairing code sends `PAIRING_INVALIDATED` before disconnecting authenticated TCP clients.
- Mobile native recognizes `PAIRING_INVALIDATED` as explicit invalidation evidence.
- `paired:false` from presence invalidates pairing and does not preserve `connected`.
- Token-invalid/auth-invalid responses invalidate pairing.
- Generic offline reachability failures do not invalidate pairing.

React Native tests should cover:

- A central global listener resets navigation to `DeviceDiscovery` when pairing is invalidated.
- Ordinary `offline` binding updates do not reset navigation.
- `DeviceDiscoveryGlobalScreen` renders the invalidation message for `reason: 'pairing_invalidated'`.

## Out of Scope

- CN-specific UI changes.
- Sync history deletion.
- Queue deletion or manual queue management.
