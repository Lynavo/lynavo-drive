import type { SignedOutTransition } from '../stores/auth-store';

// ---------------------------------------------------------------------------
// Module-level reference to auth store actions.
// Set once by AuthProvider on mount so API error handling can clear the local
// dev session without importing React context directly.
// ---------------------------------------------------------------------------

let _storeClearAuth: ((transition?: SignedOutTransition) => void) | null = null;

/**
 * Called by AuthProvider to wire up the clear action that the API layer can
 * invoke when a server reports the current local dev session was replaced.
 */
export function registerSessionClearAction(
  clearAuth: (transition?: SignedOutTransition) => void,
) {
  _storeClearAuth = clearAuth;
}

/** @internal — used by api.ts when the local dev session must be cleared. */
export function _clearAuthFromApi(transition?: SignedOutTransition) {
  _storeClearAuth?.(transition);
}

// Official login/profile/account endpoint helpers are intentionally absent in
// the OSS runtime. Local LAN pairing and HMAC access do not require them.
