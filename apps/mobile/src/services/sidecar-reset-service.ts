/**
 * Historical compatibility shim for mobile account-boundary cleanup.
 *
 * Earlier builds called the desktop sidecar's `POST /settings/reset-state`
 * here. That endpoint is destructive by design: it clears desktop sync DB
 * rows and the `received/` directory. Mobile logout / account switching must
 * only wipe the phone's local identity, because desktop received files and
 * paired-device history belong to the desktop.
 *
 * Keep this exported function as a no-op so existing logout flows retain
 * their awaited sequencing without contacting the desktop or deleting data.
 */
export async function resetCurrentDesktopSidecarIfReachable(
  _options: { timeoutMs?: number } = {},
): Promise<void> {
  return;
}
