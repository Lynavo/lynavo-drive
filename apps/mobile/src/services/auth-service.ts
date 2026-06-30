import type { SignedOutTransition } from '../stores/auth-store';

// ---------------------------------------------------------------------------
// Module-level reference to auth store actions.
// Set once by AuthProvider on mount so we can update tokens / clear auth
// from the API layer without importing React context directly.
// ---------------------------------------------------------------------------

let _storeSetTokens: ((access: string, refresh: string) => void) | null = null;
let _storeClearAuth: ((transition?: SignedOutTransition) => void) | null = null;

/**
 * Called by AuthProvider to wire up store actions that the API layer can invoke
 * during token refresh or forced auth clear.
 */
export function registerAuthStoreActions(
  setTokens: (access: string, refresh: string) => void,
  clearAuth: (transition?: SignedOutTransition) => void,
) {
  _storeSetTokens = setTokens;
  _storeClearAuth = clearAuth;
}

/** @internal — used by api.ts during token refresh */
export function _setTokensFromApi(accessToken: string, refreshToken: string) {
  _storeSetTokens?.(accessToken, refreshToken);
}

/** @internal — used by api.ts when refresh fails */
export function _clearAuthFromApi(transition?: SignedOutTransition) {
  _storeClearAuth?.(transition);
}

// Official login/profile/account endpoint helpers are intentionally absent in
// the OSS runtime. Local LAN pairing and HMAC access do not require them.
