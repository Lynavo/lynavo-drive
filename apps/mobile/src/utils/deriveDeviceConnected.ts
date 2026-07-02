/**
 * Map a native BindingConnectionState string to the UI's boolean
 * "is the device online?" flag.
 *
 * Native emits five states (see SyncEngineManager.swift BindingConnectionState):
 *   - discovering: searching for a paired device, not yet bound
 *   - bound: paired + last presence heartbeat succeeded
 *   - connecting: transient — TCP handshake, presence recovery, or the start
 *     of an upload round. Usually lasts a few hundred milliseconds.
 *   - connected: full TCP session authenticated and active
 *   - offline: presence confirmed unreachable
 *
 * `connecting` is sticky with respect to the previous value: flipping to
 * "offline" during this transient would flash the "device disconnected" badge every
 * time sync kicks off (e.g. `connected -> connecting (connect_and_upload_started)`
 * -> connected). Preserving the previous value avoids that flash while still
 * treating a real `connected -> offline` transition as an immediate disconnect.
 */
export function deriveDeviceConnected(
  connectionState: string,
  previous: boolean,
): boolean {
  if (connectionState === 'connected') {
    return true;
  }
  if (connectionState === 'connecting') {
    return previous;
  }
  return false;
}
