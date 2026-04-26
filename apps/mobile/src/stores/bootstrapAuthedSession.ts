import i18next from 'i18next';
import { ApiError, ERROR_CODE } from '../services/api';
import type { SubscriptionInfo, UserProfile } from './auth-store';

/**
 * Phase 2 post-login orchestrator for the account-identity-reset spec.
 *
 * Lives as a pure function (no React, no dynamic imports) so it can be
 * unit-tested end-to-end by injecting fakes for every async dependency.
 * The provider in `auth-store.tsx` wires this into the reducer: it calls
 * `bootstrapAuthedSession(...)`, receives a `BootstrapOutcome`, and then
 * dispatches according to the outcome kind.
 *
 * The invariant: the returned outcome is the *only* path that says "it's
 * safe to set `state.user`". Every failure mode short-circuits to either
 * `error` (show ProfileErrorScreen) or `cancelled` (caller must not
 * dispatch anything — auth state was torn down mid-bootstrap).
 */
export interface BootstrapDeps {
  /** Fetch the fresh user profile from the API (may throw ApiError). */
  fetchProfile: () => Promise<UserProfile>;
  /** Fetch subscription status. Non-fatal failures are tolerated. */
  fetchSubscription: () => Promise<SubscriptionInfo>;
  /** Read the native-side "last bound owner" id. `null` = none recorded.
   *  Returned as a string so backend ids above 2^53 compare exactly —
   *  the native bridge stringifies to avoid `Double` precision loss. */
  getOwnerUserId: () => Promise<string | null>;
  /** Persist the freshly-bound owner id to native storage. Accepts a
   *  string to preserve full precision across the JS/native bridge. */
  setOwnerUserId: (id: string) => Promise<void>;
  /** Full native-state wipe. MUST succeed on owner mismatch — fail-closed. */
  wipeSyncIdentity: () => Promise<void>;
  /** Best-effort desktop sidecar reset. Internal errors are swallowed. */
  resetSidecar: () => Promise<void>;
  /** Clear user-scoped AsyncStorage keys (reminder-shown flags, etc). */
  clearUserScopedStorage: () => Promise<void>;
}

export type BootstrapOutcome =
  | {
      kind: 'ready';
      profile: UserProfile;
      /** null when subscription fetch failed — UI renders without it. */
      subscription: SubscriptionInfo | null;
      /** true iff the owner-mismatch path ran and wiped native state. */
      wiped: boolean;
    }
  | { kind: 'error'; error: ApiError }
  | { kind: 'cancelled' };

/**
 * Orchestrate the post-login bootstrap. See `auth-store.tsx` for the
 * callsite that maps this outcome to reducer dispatches.
 *
 * `isStale` is polled after every await. The caller (auth-store) passes
 * a function that returns true if the access token has changed or
 * `CLEAR` has been dispatched — in that case the outcome is 'cancelled'
 * and no further dispatches should happen.
 */
export async function bootstrapAuthedSession(
  deps: BootstrapDeps,
  isStale: () => boolean,
): Promise<BootstrapOutcome> {
  // 1. Profile is the anchor — no profile, no session.
  let profile: UserProfile;
  try {
    profile = await deps.fetchProfile();
  } catch (err) {
    if (isStale()) return { kind: 'cancelled' };
    return { kind: 'error', error: toApiError(err) };
  }
  if (isStale()) return { kind: 'cancelled' };

  // 2. Compare against the device's last bound owner. Failure to read the
  // marker is benign (we treat it as "no owner recorded" and trust the
  // login) — this is strictly a best-effort optimisation path.
  //
  // Comparison is string-vs-string so backend ids above 2^53 stay exact —
  // see SyncEngineModule.getOwnerUserId for the bridge-layer rationale.
  let storedOwnerId: string | null;
  try {
    storedOwnerId = await deps.getOwnerUserId();
  } catch (err) {
    console.warn('[bootstrap] getOwnerUserId failed — treating as no owner', err);
    storedOwnerId = null;
  }
  if (isStale()) return { kind: 'cancelled' };

  const mismatch = storedOwnerId !== null && storedOwnerId !== String(profile.id);

  // 3. On mismatch, run the cleanup sequence. Fail-closed on wipe: a
  // failed wipe means the device still holds another user's state, and
  // we MUST NOT flip the navigator into AuthedStack.
  if (mismatch) {
    try {
      await deps.resetSidecar();
    } catch (err) {
      console.warn('[bootstrap] desktop sidecar reset threw (ignored)', err);
    }
    if (isStale()) return { kind: 'cancelled' };

    try {
      await deps.wipeSyncIdentity();
    } catch (err) {
      if (isStale()) return { kind: 'cancelled' };
      return { kind: 'error', error: toApiError(err) };
    }
    if (isStale()) return { kind: 'cancelled' };

    try {
      await deps.clearUserScopedStorage();
    } catch (err) {
      console.warn('[bootstrap] clearUserScopedStorage failed (ignored)', err);
    }
    if (isStale()) return { kind: 'cancelled' };
  }

  // 4. Record the current owner so the next bootstrap compares against a
  // fresh value. Stringified to keep the native bridge from demoting
  // through Double.
  //
  // FAIL-CLOSED: if the native layer can't durably flush this marker
  // (SharedPreferences.commit() returns false on Android, or
  // UserDefaults.synchronize() returns false on iOS), we MUST NOT
  // proceed to `ready`. Next cold start would read storedOwnerId=null,
  // the owner-mismatch guard would treat user B as "fresh install",
  // and skip the wipe — the exact leak Phase 2 exists to prevent.
  // Surface an error outcome instead so RootNavigator renders
  // ProfileErrorScreen with retry / logout affordances.
  try {
    await deps.setOwnerUserId(String(profile.id));
  } catch (err) {
    if (isStale()) return { kind: 'cancelled' };
    console.warn('[bootstrap] setOwnerUserId failed (fail-closed)', err);
    return { kind: 'error', error: toApiError(err) };
  }
  if (isStale()) return { kind: 'cancelled' };

  // 5. Subscription is non-fatal — UI can render without it. We capture
  // the failure only as `subscription: null` on the outcome so the
  // caller keeps `profileError` clean.
  let subscription: SubscriptionInfo | null;
  try {
    subscription = await deps.fetchSubscription();
  } catch (err) {
    console.warn('[bootstrap] subscription load failed (non-fatal)', err);
    subscription = null;
  }
  if (isStale()) return { kind: 'cancelled' };

  return { kind: 'ready', profile, subscription, wiped: mismatch };
}

function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  return new ApiError(
    ERROR_CODE.SERVER_ERROR,
    i18next.t('errors.profileLoadFailed'),
  );
}
