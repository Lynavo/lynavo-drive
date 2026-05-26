import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import i18next from 'i18next';
import { ApiError, ERROR_CODE } from '../services/api';
import { clearSessionBaseUrl, loadSessionBaseUrl } from '../services/config';
import { useIapLifecycle } from '../hooks/useIapLifecycle';
import {
  getOwnerUserId as nativeGetOwnerUserId,
  setOwnerUserId as nativeSetOwnerUserId,
  wipeSyncIdentity as nativeWipeSyncIdentity,
} from '../services/SyncEngineModule';
import { resetCurrentDesktopSidecarIfReachable } from '../services/sidecar-reset-service';
import { clearUserScopedStorage } from '../utils/clearUserScopedStorage';
import { bootstrapAuthedSession } from './bootstrapAuthedSession';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AccountStatus =
  | 'trialing'
  | 'subscribed'
  | 'trial_expired'
  | 'sub_expired';
export type SubscriptionPlan = 'monthly' | 'yearly' | '';
export type SubscriptionPaymentProvider =
  | 'apple'
  | 'mainland'
  | 'gift_card'
  | '';
export type SubscriptionRenewalState =
  | 'auto_renewing'
  | 'cancelled'
  | 'prepaid'
  | '';

export interface IdentityDescriptor {
  type: string; // 'phone_cn' | 'email' | 'apple' | 'google'
  display: string; // server-side masked
  // Raw identifier, currently only populated for 'phone_cn' on the
  // authenticated user's own profile. Used by SettingsScreen to power
  // a user-triggered "reveal full phone" toggle. Treat as PII.
  identifier?: string;
}

export interface UserProfile {
  id: number;
  primaryIdentity: IdentityDescriptor | null;
  identities: IdentityDescriptor[];
  status: AccountStatus;
  plan: SubscriptionPlan;
  expireAt: string | null;
  trialEnd: string | null;
}

export interface SubscriptionInfo {
  status: AccountStatus;
  plan: SubscriptionPlan;
  expireAt: string | null;
  trialEnd: string | null;
  /** Backend origin for the currently-effective entitlement. `gift_card`
   *  grants access without Apple auto-renewal, so UI must not treat its
   *  autoRenewing=false shape as an App Store cancellation. */
  source?: string | null;
  /** Whether Apple will auto-renew at expireAt. Undefined / null when
   *  server hasn't populated the field (legacy status shape, status !=
   *  subscribed, or old test fixtures). When status === 'subscribed'
   *  and autoRenewing === false, the user cancelled but still has
   *  access until expireAt — UI should surface that state explicitly
   *  instead of rendering plain "Subscribed". */
  autoRenewing?: boolean | null;
  paymentProvider?: SubscriptionPaymentProvider | null;
  renewalState?: SubscriptionRenewalState | null;
  entitlementExpireAt?: string | null;
  entitlementSource?: string | null;
}

export type SignedOutTransition =
  | 'account_deleted'
  | 'logout'
  | 'session_replaced'
  | null;

export interface AuthState {
  isLoggedIn: boolean;
  isLoading: boolean;
  accessToken: string | null;
  refreshToken: string | null;
  user: UserProfile | null;
  subscription: SubscriptionInfo | null;
  /** Last error from the post-login profile load. Set when the auto-load
   *  effect fails so the UI can surface a retry instead of an infinite
   *  spinner. Cleared on retry attempt and on successful profile fetch. */
  profileError: ApiError | null;
  /** True while the post-login profile auto-load is in flight. */
  profileLoading: boolean;
  /** Short-lived exit transition shown before we land on Login. */
  signedOutTransition: SignedOutTransition;
}

// ---------------------------------------------------------------------------
// Module-level token storage so api.ts can read tokens without React context
// ---------------------------------------------------------------------------

// Tokens are persisted in the OS Keychain (iOS Keychain Services / Android
// EncryptedSharedPreferences via react-native-keychain). The single Keychain
// item stores both tokens as a JSON blob to keep the wrapping atomic.
const KEYCHAIN_SERVICE = 'cn.vividrop.auth';
const KEYCHAIN_USER = 'tokens';

// Legacy AsyncStorage keys — read once during hydrate to migrate any prior
// installs into the Keychain, then erased so cleartext copies don't linger.
const LEGACY_STORAGE_KEY_ACCESS = '@vividrop/auth/access_token';
const LEGACY_STORAGE_KEY_REFRESH = '@vividrop/auth/refresh_token';

let _accessToken: string | null = null;
let _refreshToken: string | null = null;
let _authSessionGeneration = 0;

export function getAccessToken(): string | null {
  return _accessToken;
}

export function getRefreshToken(): string | null {
  return _refreshToken;
}

function syncTokensToModule(access: string | null, refresh: string | null) {
  _accessToken = access;
  _refreshToken = refresh;
}

function bumpAuthSessionGeneration() {
  _authSessionGeneration += 1;
}

function loadAuthService(): Promise<typeof import('../services/auth-service')> {
  return Promise.resolve(
    require('../services/auth-service') as typeof import('../services/auth-service'),
  );
}

function loadSubscriptionService(): Promise<
  typeof import('../services/subscription-service')
> {
  return Promise.resolve(
    require('../services/subscription-service') as typeof import('../services/subscription-service'),
  );
}

// Persist tokens to the Keychain. Fire-and-forget: in-memory tokens drive the
// current session, the Keychain copy is only consulted on cold start.
function persistTokens(access: string | null, refresh: string | null): void {
  const task =
    access === null || refresh === null
      ? Keychain.resetGenericPassword({ service: KEYCHAIN_SERVICE })
      : Keychain.setGenericPassword(
          KEYCHAIN_USER,
          JSON.stringify({ access, refresh }),
          {
            service: KEYCHAIN_SERVICE,
            // Tokens accessible after first device unlock, never synced to
            // iCloud, never restored to a different device via backup.
            accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
          },
        );
  task.catch((err: unknown) => {
    console.warn('[auth-store] failed to persist tokens to keychain', err);
  });
}

async function loadPersistedTokens(): Promise<{
  accessToken: string | null;
  refreshToken: string | null;
}> {
  await loadSessionBaseUrl();

  // 1. Try the Keychain first.
  try {
    const cred = await Keychain.getGenericPassword({
      service: KEYCHAIN_SERVICE,
    });
    if (cred && cred.password) {
      const parsed = JSON.parse(cred.password) as {
        access?: string;
        refresh?: string;
      };
      if (parsed.access && parsed.refresh) {
        return { accessToken: parsed.access, refreshToken: parsed.refresh };
      }
    }
  } catch (err) {
    console.warn('[auth-store] keychain read failed', err);
  }

  // 2. Migrate from legacy AsyncStorage entries written by earlier builds,
  //    then delete the cleartext copies so they no longer sit in plaintext.
  try {
    const [access, refresh] = await Promise.all([
      AsyncStorage.getItem(LEGACY_STORAGE_KEY_ACCESS),
      AsyncStorage.getItem(LEGACY_STORAGE_KEY_REFRESH),
    ]);
    if (access && refresh) {
      persistTokens(access, refresh);
      await Promise.all([
        AsyncStorage.removeItem(LEGACY_STORAGE_KEY_ACCESS),
        AsyncStorage.removeItem(LEGACY_STORAGE_KEY_REFRESH),
      ]);
      return { accessToken: access, refreshToken: refresh };
    }
  } catch (err) {
    console.warn('[auth-store] legacy AsyncStorage migration failed', err);
  }

  await clearSessionBaseUrl();
  return { accessToken: null, refreshToken: null };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

type AuthAction =
  | { type: 'HYDRATE'; accessToken: string | null; refreshToken: string | null }
  | { type: 'LOGIN'; accessToken: string; refreshToken: string }
  | { type: 'SET_TOKENS'; accessToken: string; refreshToken: string }
  | { type: 'SET_USER'; user: UserProfile }
  | { type: 'SET_SUBSCRIPTION'; subscription: SubscriptionInfo }
  | { type: 'SET_LOADING'; isLoading: boolean }
  | { type: 'PROFILE_LOAD_START' }
  | { type: 'PROFILE_LOAD_SUCCESS' }
  | { type: 'PROFILE_LOAD_FAILURE'; error: ApiError }
  | { type: 'SET_SIGNED_OUT_TRANSITION'; transition: SignedOutTransition }
  | { type: 'CLEAR' };

// isLoading starts as true so RootNavigator waits for the hydrate pass to
// finish before deciding between Login and the post-login screens.
const initialState: AuthState = {
  isLoggedIn: false,
  isLoading: true,
  accessToken: null,
  refreshToken: null,
  user: null,
  subscription: null,
  profileError: null,
  profileLoading: false,
  signedOutTransition: null,
};

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'HYDRATE':
      return {
        ...state,
        isLoading: false,
        isLoggedIn: Boolean(action.accessToken && action.refreshToken),
        accessToken: action.accessToken,
        refreshToken: action.refreshToken,
        signedOutTransition: null,
      };
    case 'LOGIN':
      return {
        ...state,
        isLoggedIn: true,
        accessToken: action.accessToken,
        refreshToken: action.refreshToken,
        signedOutTransition: null,
      };
    case 'SET_TOKENS':
      return {
        ...state,
        accessToken: action.accessToken,
        refreshToken: action.refreshToken,
      };
    case 'SET_USER':
      return { ...state, user: action.user };
    case 'SET_SUBSCRIPTION':
      return { ...state, subscription: action.subscription };
    case 'SET_LOADING':
      return { ...state, isLoading: action.isLoading };
    case 'PROFILE_LOAD_START':
      return { ...state, profileLoading: true, profileError: null };
    case 'PROFILE_LOAD_SUCCESS':
      return { ...state, profileLoading: false, profileError: null };
    case 'PROFILE_LOAD_FAILURE':
      return { ...state, profileLoading: false, profileError: action.error };
    case 'SET_SIGNED_OUT_TRANSITION':
      return { ...state, signedOutTransition: action.transition };
    case 'CLEAR':
      // Keep isLoading=false on logout so the navigator routes immediately to
      // Login instead of re-entering the hydrate spinner.
      return {
        ...initialState,
        isLoading: false,
        signedOutTransition: state.signedOutTransition,
      };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface AuthActions {
  login: (accessToken: string, refreshToken: string) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  setUser: (profile: UserProfile) => void;
  setSubscription: (info: SubscriptionInfo) => void;
  setSignedOutTransition: (transition: SignedOutTransition) => void;
  clearAuth: (transition?: SignedOutTransition) => void;
  loadProfile: () => Promise<void>;
  /** Fetches the latest subscription from the server and commits it to the
   *  store. Returns the freshly-fetched value so callers that need to react
   *  to the updated expireAt / plan inside the same async flow don't have to
   *  wait for React to re-render with the new context value. Rejects if the
   *  fetch fails — callers should wrap in try/catch if they can proceed
   *  without the fresh snapshot. */
  loadSubscription: (options?: {
    showGlobalLoading?: boolean;
  }) => Promise<SubscriptionInfo>;
  /** Manually retry the post-login profile auto-load. Surface this from the
   *  RootNavigator's profile-error screen so a transient network failure
   *  doesn't strand the user on a permanent spinner. */
  retryProfileLoad: () => Promise<void>;
}

type AuthContextValue = AuthState & AuthActions;

const AuthContext = createContext<AuthContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, initialState);

  // Keep module-level tokens in sync whenever state changes
  useEffect(() => {
    syncTokensToModule(state.accessToken, state.refreshToken);
  }, [state.accessToken, state.refreshToken]);

  // Hydrate persisted tokens on mount before the navigator decides where to go.
  useEffect(() => {
    let cancelled = false;
    loadPersistedTokens().then(({ accessToken, refreshToken }) => {
      if (cancelled) return;
      syncTokensToModule(accessToken, refreshToken);
      dispatch({ type: 'HYDRATE', accessToken, refreshToken });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback((accessToken: string, refreshToken: string) => {
    bumpAuthSessionGeneration();
    dispatch({ type: 'LOGIN', accessToken, refreshToken });
    persistTokens(accessToken, refreshToken);
  }, []);

  const setTokens = useCallback((accessToken: string, refreshToken: string) => {
    dispatch({ type: 'SET_TOKENS', accessToken, refreshToken });
    persistTokens(accessToken, refreshToken);
  }, []);

  const setUser = useCallback((profile: UserProfile) => {
    dispatch({ type: 'SET_USER', user: profile });
  }, []);

  const setSubscription = useCallback((info: SubscriptionInfo) => {
    dispatch({ type: 'SET_SUBSCRIPTION', subscription: info });
  }, []);

  const setSignedOutTransition = useCallback(
    (transition: SignedOutTransition) => {
      dispatch({ type: 'SET_SIGNED_OUT_TRANSITION', transition });
    },
    [],
  );

  const clearAuth = useCallback((transition?: SignedOutTransition) => {
    bumpAuthSessionGeneration();
    if (transition !== undefined) {
      dispatch({ type: 'SET_SIGNED_OUT_TRANSITION', transition });
    }
    dispatch({ type: 'CLEAR' });
    syncTokensToModule(null, null);
    persistTokens(null, null);
    void clearSessionBaseUrl();
  }, []);

  // Register store actions so the API layer can update tokens / force logout
  // without importing React context directly. Lazy require avoids circular dep.
  useEffect(() => {
    loadAuthService().then(({ registerAuthStoreActions }) =>
      registerAuthStoreActions(
        (access, refresh) => {
          dispatch({
            type: 'SET_TOKENS',
            accessToken: access,
            refreshToken: refresh,
          });
          syncTokensToModule(access, refresh);
          persistTokens(access, refresh);
        },
        transition => {
          bumpAuthSessionGeneration();
          if (transition !== undefined) {
            dispatch({
              type: 'SET_SIGNED_OUT_TRANSITION',
              transition,
            });
          }
          dispatch({ type: 'CLEAR' });
          syncTokensToModule(null, null);
          persistTokens(null, null);
          void clearSessionBaseUrl();
        },
      ),
    );
  }, []);

  const loadProfile = useCallback(async () => {
    // Lazy require to avoid circular dependency (api -> auth-store -> auth-service -> api)
    const { getUserProfile } = await loadAuthService();
    dispatch({ type: 'SET_LOADING', isLoading: true });
    try {
      const profile = await getUserProfile();
      dispatch({ type: 'SET_USER', user: profile });
    } finally {
      dispatch({ type: 'SET_LOADING', isLoading: false });
    }
  }, []);

  const loadSubscription = useCallback(
    async (options?: {
      showGlobalLoading?: boolean;
    }): Promise<SubscriptionInfo> => {
      const { getSubscriptionStatus } = await loadSubscriptionService();
      const showGlobalLoading = options?.showGlobalLoading === true;
      if (showGlobalLoading) {
        dispatch({ type: 'SET_LOADING', isLoading: true });
      }
      try {
        const info = await getSubscriptionStatus();
        dispatch({ type: 'SET_SUBSCRIPTION', subscription: info });
        return info;
      } finally {
        if (showGlobalLoading) {
          dispatch({ type: 'SET_LOADING', isLoading: false });
        }
      }
    },
    [],
  );

  const iapLifecycleReady =
    state.isLoggedIn &&
    state.user != null &&
    state.profileError == null;
  useIapLifecycle({ isLoggedIn: iapLifecycleReady, loadSubscription });

  // Single profile-load orchestrator. Delegates the Phase-2 owner-guard
  // cleanup sequence to `bootstrapAuthedSession` (a pure function,
  // exhaustively unit-tested) and maps its outcome to reducer dispatches.
  //
  // Cancellation: capture the auth session generation at entry and poll it
  // between each step. A silent refresh rotates tokens during normal
  // bootstrap and must not strand the profile loader as "cancelled". External
  // logout, refresh-token failure, and racing login all bump the generation
  // and suppress further dispatches from the old run.
  const ensureProfileLoaded = useCallback(async () => {
    const capturedAuthSessionGeneration = _authSessionGeneration;
    const isStale = () =>
      _authSessionGeneration !== capturedAuthSessionGeneration;

    dispatch({ type: 'PROFILE_LOAD_START' });

    try {
      const { getUserProfile } = await loadAuthService();
      const { getSubscriptionStatus } = await loadSubscriptionService();

      const outcome = await bootstrapAuthedSession(
        {
          fetchProfile: getUserProfile,
          fetchSubscription: getSubscriptionStatus,
          getOwnerUserId: nativeGetOwnerUserId,
          setOwnerUserId: nativeSetOwnerUserId,
          wipeSyncIdentity: nativeWipeSyncIdentity,
          resetSidecar: resetCurrentDesktopSidecarIfReachable,
          clearUserScopedStorage,
        },
        isStale,
      );

      if (isStale()) return;

      switch (outcome.kind) {
        case 'ready':
          dispatch({ type: 'SET_USER', user: outcome.profile });
          if (outcome.subscription) {
            dispatch({
              type: 'SET_SUBSCRIPTION',
              subscription: outcome.subscription,
            });
          }
          dispatch({ type: 'PROFILE_LOAD_SUCCESS' });
          return;
        case 'error':
          dispatch({ type: 'PROFILE_LOAD_FAILURE', error: outcome.error });
          return;
        case 'cancelled':
          // Auth was torn down mid-bootstrap (CLEAR, LOGIN race, etc.).
          // The reducer already moved on — don't dispatch anything.
          return;
      }
    } catch (err) {
      if (isStale()) return;
      dispatch({
        type: 'PROFILE_LOAD_FAILURE',
        error:
          err instanceof ApiError
            ? err
            : new ApiError(
                ERROR_CODE.SERVER_ERROR,
                i18next.t('errors.profileLoadFailed'),
              ),
      });
    }
  }, []);

  const retryProfileLoad = useCallback(async () => {
    await ensureProfileLoaded();
  }, [ensureProfileLoaded]);

  // Auto-trigger on transition to logged-in-without-profile. The guard set
  // ensures we don't loop on failure: once profileError is set we wait for
  // the user to retry (or for state.user to be non-null). Re-fires correctly
  // after retryProfileLoad() because that action clears profileError first.
  useEffect(() => {
    if (
      !state.isLoggedIn ||
      state.user ||
      state.profileLoading ||
      state.profileError
    ) {
      return;
    }
    ensureProfileLoaded();
  }, [
    state.isLoggedIn,
    state.user,
    state.profileLoading,
    state.profileError,
    ensureProfileLoaded,
  ]);

  const value: AuthContextValue = {
    ...state,
    login,
    setTokens,
    setUser,
    setSubscription,
    setSignedOutTransition,
    clearAuth,
    loadProfile,
    loadSubscription,
    retryProfileLoad,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when the user status grants access to core features
 * (uploading, auto-upload, shared files). DENY-BY-DEFAULT: an unknown /
 * not-yet-loaded status returns false so an expired account can never slip
 * past the gate while the profile is in flight. Callers that want to avoid
 * a paywall flash on cold start should also gate on `auth.user !== null`
 * (or rely on RootNavigator to do so).
 */
export function isFeatureAccessAllowed(
  status: AccountStatus | undefined | null,
): boolean {
  return status === 'trialing' || status === 'subscribed';
}

/**
 * Returns the number of whole days remaining in a trial period.
 * Returns 0 if the user is not trialing or the trial has ended.
 */
export function getTrialRemainingDays(
  user: UserProfile | null | undefined,
): number {
  if (!user?.trialEnd) return 0;
  const end = new Date(user.trialEnd).getTime();
  const now = Date.now();
  const diff = end - now;
  if (diff <= 0) return 0;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}
