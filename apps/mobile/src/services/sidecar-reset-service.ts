import { NativeModules } from 'react-native';
import { SIDECAR_HTTP_PORT } from '@syncflow/contracts';

interface BindingShape {
  host?: string | null;
}

/**
 * Default network budget for the best-effort sidecar reset call. Short on
 * purpose: the mobile logout UI is already showing a spinner and we do NOT
 * want a slow / unreachable desktop to hold the wipe flow.
 */
const DEFAULT_TIMEOUT_MS = 3_000;

/**
 * Ask the currently-bound desktop sidecar to drop every runtime table
 * (paired_devices, uploads, sessions, daily stats) and its receive / staging
 * directories via `POST /settings/reset-state`. Used during account
 * boundary events so the desktop does not continue to display the previous
 * user's paired device and history.
 *
 * **Best-effort semantics.** Any failure — no binding, unreachable host,
 * non-2xx response, timeout, native bridge error — resolves silently with a
 * `console.warn`. The mobile-side wipe is the primary defense; desktop
 * reset is a nice-to-have that must never block logout.
 *
 * Rationale: same LAN assumption as the rest of Vivi Drop. When the phone
 * is off the home network the user will re-pair next time they reconnect,
 * and the desktop can be reset manually via the "重置測試狀態" Settings
 * entry on the desktop app itself (Phase 4).
 */
export async function resetCurrentDesktopSidecarIfReachable(
  options: { timeoutMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const binding = await readBindingQuietly();
  const host = binding?.host;
  if (!host) {
    // Not an error — simply no desktop to reset.
    return;
  }

  const url = `http://${host}:${SIDECAR_HTTP_PORT}/settings/reset-state`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      console.warn(
        `[sidecar-reset] ${url} responded ${response.status} — continuing`,
      );
    }
  } catch (err) {
    console.warn('[sidecar-reset] desktop reset failed (ignored):', err);
  } finally {
    clearTimeout(timer);
  }
}

async function readBindingQuietly(): Promise<BindingShape | null> {
  // NativeSyncEngine may be undefined on Android shell at cold start (bridge
  // teardown during invalidate). Treat either as "no binding known".
  const { NativeSyncEngine } = NativeModules;
  if (!NativeSyncEngine || typeof NativeSyncEngine.getBindingState !== 'function') {
    return null;
  }
  try {
    const result = (await NativeSyncEngine.getBindingState()) as BindingShape | null;
    return result ?? null;
  } catch (err) {
    console.warn('[sidecar-reset] getBindingState failed — skipping desktop reset:', err);
    return null;
  }
}
