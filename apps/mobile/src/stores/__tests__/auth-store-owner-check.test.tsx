/**
 * Phase 2 tests for the owner-mismatch guard that the post-login
 * bootstrap runs BEFORE dispatching `SET_USER`. See
 * account-identity-reset spec §4 Phase 2.
 *
 * Drives `bootstrapAuthedSession` directly (it is a pure function with
 * injected deps) so we can assert exact call counts, ordering, and
 * outcome kinds without spinning up a React tree.
 *
 * The invariant being tested: the navigator must never flip into
 * `AuthedStack` with `state.user` set while the native sync layer still
 * holds another user's binding / queue / history. The mitigation is a
 * wipe gated on `storedOwnerId !== profile.id` — these tests lock down
 * the *presence*, *call count*, and *ordering* of that mitigation, plus
 * the fail-closed outcome when the wipe itself throws.
 */
// Need a bare-bones i18next instance because the orchestrator falls back
// to i18next.t(...) when wrapping non-ApiError throws. Without this mock
// Jest pulls in the full RN i18n initialisation path.
jest.mock('i18next', () => ({
  t: (key: string) => key,
}));

// Importing the auth-store type declarations transitively loads the
// `AuthProvider` implementation, which in turn touches AsyncStorage and
// Keychain at module scope. Mock both to no-ops so the type imports
// don't blow up jest-node.
jest.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn().mockResolvedValue(false),
  setGenericPassword: jest.fn().mockResolvedValue(undefined),
  resetGenericPassword: jest.fn().mockResolvedValue(undefined),
  ACCESSIBLE: { AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'afu' },
}));

import { bootstrapAuthedSession } from '../bootstrapAuthedSession';
import type { BootstrapDeps } from '../bootstrapAuthedSession';
import type { SubscriptionInfo, UserProfile } from '../auth-store';
import { ApiError, ERROR_CODE } from '../../services/api';

const sampleProfile = (id: number): UserProfile => ({
  id,
  primaryIdentity: { type: 'email', display: `u${id}@example.com` },
  identities: [{ type: 'email', display: `u${id}@example.com` }],
  status: 'subscribed',
  plan: 'yearly',
  expireAt: '2030-01-01T00:00:00.000Z',
  trialEnd: null,
});

const sampleSubscription = (): SubscriptionInfo => ({
  status: 'subscribed',
  plan: 'yearly',
  expireAt: '2030-01-01T00:00:00.000Z',
  trialEnd: null,
});

function makeDeps(overrides: Partial<BootstrapDeps> = {}): {
  deps: BootstrapDeps;
  fetchProfile: jest.Mock;
  fetchSubscription: jest.Mock;
  getOwnerUserId: jest.Mock;
  setOwnerUserId: jest.Mock;
  wipeSyncIdentity: jest.Mock;
  resetSidecar: jest.Mock;
  clearUserScopedStorage: jest.Mock;
} {
  const fetchProfile = jest.fn().mockResolvedValue(sampleProfile(42));
  const fetchSubscription = jest.fn().mockResolvedValue(sampleSubscription());
  const getOwnerUserId = jest.fn().mockResolvedValue('42');
  const setOwnerUserId = jest.fn().mockResolvedValue(undefined);
  const wipeSyncIdentity = jest.fn().mockResolvedValue(undefined);
  const resetSidecar = jest.fn().mockResolvedValue(undefined);
  const clearUserScopedStorage = jest.fn().mockResolvedValue(undefined);

  const deps: BootstrapDeps = {
    fetchProfile,
    fetchSubscription,
    getOwnerUserId,
    setOwnerUserId,
    wipeSyncIdentity,
    resetSidecar,
    clearUserScopedStorage,
    ...overrides,
  };
  // Return the post-override refs so per-test assertions run against the
  // mocks that the bootstrap actually called, not the pre-override
  // defaults.
  return {
    deps,
    fetchProfile: deps.fetchProfile as jest.Mock,
    fetchSubscription: deps.fetchSubscription as jest.Mock,
    getOwnerUserId: deps.getOwnerUserId as jest.Mock,
    setOwnerUserId: deps.setOwnerUserId as jest.Mock,
    wipeSyncIdentity: deps.wipeSyncIdentity as jest.Mock,
    resetSidecar: deps.resetSidecar as jest.Mock,
    clearUserScopedStorage: deps.clearUserScopedStorage as jest.Mock,
  };
}

const neverStale = () => false;

describe('bootstrapAuthedSession (Phase 2 owner-mismatch guard)', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test('owner match (A=A): ready without wipe and without clearing reminder-shown', async () => {
    const { deps, getOwnerUserId, wipeSyncIdentity, resetSidecar, clearUserScopedStorage, setOwnerUserId } = makeDeps({
      fetchProfile: jest.fn().mockResolvedValue(sampleProfile(42)),
      getOwnerUserId: jest.fn().mockResolvedValue('42'),
    });

    const outcome = await bootstrapAuthedSession(deps, neverStale);

    expect(outcome).toEqual(
      expect.objectContaining({
        kind: 'ready',
        profile: expect.objectContaining({ id: 42 }),
        wiped: false,
      }),
    );
    expect(getOwnerUserId).toHaveBeenCalledTimes(1);
    expect(wipeSyncIdentity).not.toHaveBeenCalled();
    expect(resetSidecar).not.toHaveBeenCalled();
    expect(clearUserScopedStorage).not.toHaveBeenCalled();
    expect(setOwnerUserId).toHaveBeenCalledWith('42');
  });

  test('owner mismatch (A→B): desktop reset → wipe → scoped storage → setOwner, in order, and reports wiped=true', async () => {
    const callOrder: string[] = [];
    const { deps, wipeSyncIdentity, setOwnerUserId } = makeDeps({
      fetchProfile: jest.fn().mockResolvedValue(sampleProfile(2)),
      getOwnerUserId: jest.fn().mockResolvedValue('1'),
      resetSidecar: jest.fn().mockImplementation(async () => {
        callOrder.push('sidecar');
      }),
      wipeSyncIdentity: jest.fn().mockImplementation(async () => {
        callOrder.push('wipe');
      }),
      clearUserScopedStorage: jest.fn().mockImplementation(async () => {
        callOrder.push('scoped');
      }),
      setOwnerUserId: jest.fn().mockImplementation(async () => {
        callOrder.push('setOwner');
      }),
    });

    const outcome = await bootstrapAuthedSession(deps, neverStale);

    expect(outcome.kind).toBe('ready');
    if (outcome.kind === 'ready') {
      expect(outcome.wiped).toBe(true);
      expect(outcome.profile.id).toBe(2);
    }
    expect(callOrder).toEqual(['sidecar', 'wipe', 'scoped', 'setOwner']);
    expect(wipeSyncIdentity).toHaveBeenCalledTimes(1);
    expect(setOwnerUserId).toHaveBeenCalledWith('2');
  });

  test('no recorded owner (fresh install / post-wipe): records owner without wiping', async () => {
    const { deps, wipeSyncIdentity, clearUserScopedStorage, setOwnerUserId } = makeDeps({
      fetchProfile: jest.fn().mockResolvedValue(sampleProfile(7)),
      getOwnerUserId: jest.fn().mockResolvedValue(null),
    });

    const outcome = await bootstrapAuthedSession(deps, neverStale);

    expect(outcome.kind).toBe('ready');
    if (outcome.kind === 'ready') {
      expect(outcome.wiped).toBe(false);
    }
    expect(wipeSyncIdentity).not.toHaveBeenCalled();
    expect(clearUserScopedStorage).not.toHaveBeenCalled();
    expect(setOwnerUserId).toHaveBeenCalledWith('7');
  });

  test('wipe rejects during mismatch: fail-closed error outcome, no setOwner, no scoped-storage sweep', async () => {
    const { deps, clearUserScopedStorage, setOwnerUserId } = makeDeps({
      fetchProfile: jest.fn().mockResolvedValue(sampleProfile(2)),
      getOwnerUserId: jest.fn().mockResolvedValue('1'),
      wipeSyncIdentity: jest.fn().mockRejectedValue(new Error('wipe failed')),
    });

    const outcome = await bootstrapAuthedSession(deps, neverStale);

    expect(outcome.kind).toBe('error');
    if (outcome.kind === 'error') {
      expect(outcome.error).toBeInstanceOf(ApiError);
    }
    // Post-wipe steps must NOT run once the wipe rejects.
    expect(clearUserScopedStorage).not.toHaveBeenCalled();
    expect(setOwnerUserId).not.toHaveBeenCalled();
  });

  test('profile fetch rejection: error outcome, owner check not attempted', async () => {
    const apiErr = new ApiError(ERROR_CODE.SERVER_ERROR, 'boom');
    const { deps, getOwnerUserId, wipeSyncIdentity } = makeDeps({
      fetchProfile: jest.fn().mockRejectedValue(apiErr),
    });

    const outcome = await bootstrapAuthedSession(deps, neverStale);

    expect(outcome).toEqual({ kind: 'error', error: apiErr });
    expect(getOwnerUserId).not.toHaveBeenCalled();
    expect(wipeSyncIdentity).not.toHaveBeenCalled();
  });

  test('subscription fetch failure is non-fatal: ready outcome, subscription = null', async () => {
    const { deps } = makeDeps({
      fetchProfile: jest.fn().mockResolvedValue(sampleProfile(42)),
      getOwnerUserId: jest.fn().mockResolvedValue('42'),
      fetchSubscription: jest.fn().mockRejectedValue(new Error('sub 500')),
    });

    const outcome = await bootstrapAuthedSession(deps, neverStale);

    expect(outcome.kind).toBe('ready');
    if (outcome.kind === 'ready') {
      expect(outcome.profile.id).toBe(42);
      expect(outcome.subscription).toBeNull();
    }
  });

  test('isStale flips during wipe: cancelled outcome, no error dispatch', async () => {
    let staleFlipped = false;
    const { deps } = makeDeps({
      fetchProfile: jest.fn().mockResolvedValue(sampleProfile(2)),
      getOwnerUserId: jest.fn().mockResolvedValue('1'),
      wipeSyncIdentity: jest.fn().mockImplementation(async () => {
        staleFlipped = true;
      }),
    });

    const outcome = await bootstrapAuthedSession(deps, () => staleFlipped);

    // After wipe resolves, isStale() flips true — the guard short-circuits
    // before setOwnerUserId and the outcome is cancelled, never error.
    expect(outcome.kind).toBe('cancelled');
  });

  test('owner-check getOwnerUserId rejects: treats as no recorded owner (warn + proceed)', async () => {
    const { deps, wipeSyncIdentity, setOwnerUserId } = makeDeps({
      fetchProfile: jest.fn().mockResolvedValue(sampleProfile(42)),
      getOwnerUserId: jest.fn().mockRejectedValue(new Error('bridge invalidated')),
    });

    const outcome = await bootstrapAuthedSession(deps, neverStale);

    expect(outcome.kind).toBe('ready');
    expect(wipeSyncIdentity).not.toHaveBeenCalled();
    expect(setOwnerUserId).toHaveBeenCalledWith('42');
  });

  test('setOwnerUserId rejection: fail-closed error outcome, subscription NOT fetched', async () => {
    // Durable marker flush failing (SharedPreferences.commit() returned
    // false on Android, or UserDefaults.synchronize() on iOS) must
    // propagate as an error outcome — silently resolving 'ready' would
    // leave the next cold start with storedOwnerId=null and bypass the
    // owner-mismatch wipe for any subsequent user.
    const { deps, fetchSubscription } = makeDeps({
      fetchProfile: jest.fn().mockResolvedValue(sampleProfile(42)),
      getOwnerUserId: jest.fn().mockResolvedValue('42'),
      setOwnerUserId: jest.fn().mockRejectedValue(
        new Error('SharedPreferences.commit() returned false'),
      ),
    });

    const outcome = await bootstrapAuthedSession(deps, neverStale);

    expect(outcome.kind).toBe('error');
    if (outcome.kind === 'error') {
      expect(outcome.error).toBeInstanceOf(ApiError);
    }
    // Subscription fetch is step 5 — must not run once step 4 failed.
    expect(fetchSubscription).not.toHaveBeenCalled();
  });

  test('setOwnerUserId rejection after successful wipe (mismatch path): still fail-closed', async () => {
    // Worst case: user B logs in, owner-mismatch detected, sidecar
    // reset + wipe + scoped-storage all run cleanly — then the final
    // owner-marker write fails. We refuse to flip into 'ready'; the
    // device is now clean but unmarked, so pretending B is signed in
    // would let a hypothetical user C next session skip the guard.
    const { deps, clearUserScopedStorage, wipeSyncIdentity } = makeDeps({
      fetchProfile: jest.fn().mockResolvedValue(sampleProfile(2)),
      getOwnerUserId: jest.fn().mockResolvedValue('1'),
      setOwnerUserId: jest.fn().mockRejectedValue(
        new Error('synchronize() returned false'),
      ),
    });

    const outcome = await bootstrapAuthedSession(deps, neverStale);

    expect(outcome.kind).toBe('error');
    // Wipe still ran — the device IS clean, we just couldn't record
    // the new owner. That's acceptable: next retry / cold start will
    // either successfully mark the owner or legitimately detect
    // "fresh install" (no owner recorded) without any leaked state.
    expect(wipeSyncIdentity).toHaveBeenCalledTimes(1);
    expect(clearUserScopedStorage).toHaveBeenCalledTimes(1);
  });
});
