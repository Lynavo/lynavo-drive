import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import {
  applyVisualQaRemotePreviewFlag,
  getDevSkipAuthMockTokens,
  getVisualQaMockTokens,
} from '../dev/visualQa';

applyVisualQaRemotePreviewFlag();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AccountStatus =
  | 'trialing'
  | 'subscribed'
  | 'trial_expired'
  | 'sub_expired';
export type SubscriptionPlan = 'monthly' | 'yearly' | '';

export interface IdentityDescriptor {
  // Legacy commercial identity descriptors are retained only so stale
  // snapshots can be represented without blocking local LAN sync.
  type: string;
  display: string;
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
}

export type SignedOutTransition = 'session_replaced' | null;

export interface AuthState {
  isLoggedIn: boolean;
  isLoading: boolean;
  accessToken: string | null;
  refreshToken: string | null;
  user: UserProfile | null;
  subscription: SubscriptionInfo | null;
  /** Legacy profile-load state retained for compatibility with stale callers.
   *  OSS runtime does not fetch official profiles during startup. */
  profileError: Error | null;
  /** Legacy profile-load state; always false in OSS startup. */
  profileLoading: boolean;
  /** Short-lived exit transition shown before we land on local LAN screens. */
  signedOutTransition: SignedOutTransition;
}

// ---------------------------------------------------------------------------
// Module-level token storage so api.ts can read tokens without React context
// ---------------------------------------------------------------------------

// OSS token location. Community startup only hydrates explicit visual QA/dev
// mock tokens and clears everything else fail-closed.
const KEYCHAIN_SERVICE = 'com.lynavo.drive.auth';
const KEYCHAIN_USER = 'tokens';
const STORAGE_KEY_ACCESS = '@lynavo-drive/auth/access_token';
const STORAGE_KEY_REFRESH = '@lynavo-drive/auth/refresh_token';
const DEV_SANDBOX_ACCESS_TOKEN_PREFIX = 'mock-sandbox-access-token';
const DEV_SANDBOX_REFRESH_TOKEN = 'mock-sandbox-refresh-token';

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

// Persist tokens to the Keychain. Fire-and-forget: in-memory tokens drive the
// current session, the Keychain copy is only consulted on cold start.
function isAllowedOssRuntimeTokenPair(
  access: string,
  refresh: string,
): boolean {
  return (
    access.startsWith(DEV_SANDBOX_ACCESS_TOKEN_PREFIX) &&
    refresh === DEV_SANDBOX_REFRESH_TOKEN
  );
}

function persistTokens(access: string | null, refresh: string | null): void {
  const task =
    access === null ||
    refresh === null ||
    !isAllowedOssRuntimeTokenPair(access, refresh)
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

async function clearPersistedOfficialTokens(): Promise<void> {
  try {
    await Keychain.resetGenericPassword({ service: KEYCHAIN_SERVICE });
  } catch (err) {
    console.warn('[auth-store] keychain official-token cleanup failed', err);
  }

  try {
    await Promise.all([
      AsyncStorage.removeItem(STORAGE_KEY_ACCESS),
      AsyncStorage.removeItem(STORAGE_KEY_REFRESH),
    ]);
  } catch (err) {
    console.warn('[auth-store] legacy official-token cleanup failed', err);
  }
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

type AuthAction =
  | { type: 'HYDRATE'; accessToken: string | null; refreshToken: string | null }
  | { type: 'SET_TOKENS'; accessToken: string; refreshToken: string }
  | { type: 'SET_SIGNED_OUT_TRANSITION'; transition: SignedOutTransition }
  | { type: 'CLEAR' };

// isLoading starts as true so RootNavigator waits for the hydrate pass before
// entering local LAN screens.
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
    case 'SET_TOKENS':
      return {
        ...state,
        accessToken: action.accessToken,
        refreshToken: action.refreshToken,
      };
    case 'SET_SIGNED_OUT_TRANSITION':
      return { ...state, signedOutTransition: action.transition };
    case 'CLEAR':
      // Keep isLoading=false on clear so the navigator routes immediately to
      // LAN screens instead of re-entering the hydrate spinner.
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
  setTokens: (accessToken: string, refreshToken: string) => void;
  setSignedOutTransition: (transition: SignedOutTransition) => void;
  clearAuth: (transition?: SignedOutTransition) => void;
}

type AuthContextValue = AuthState & AuthActions;

const AuthContext = createContext<AuthContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, initialState);

  // Keep module-level tokens in sync whenever state changes. OSS startup does
  // not hydrate commercial entitlements or remote tunnel credentials.
  useEffect(() => {
    syncTokensToModule(state.accessToken, state.refreshToken);
  }, [state.accessToken, state.refreshToken]);

  // Clear stale official-auth tokens on mount before the navigator decides where
  // to go. Only explicit visual QA/dev skip-auth mock tokens may hydrate.
  useEffect(() => {
    let cancelled = false;
    clearPersistedOfficialTokens().then(() => {
      if (cancelled) return;
      const visualQaTokens =
        getDevSkipAuthMockTokens() ?? getVisualQaMockTokens();
      const hydratedAccessToken = visualQaTokens?.accessToken ?? null;
      const hydratedRefreshToken = visualQaTokens?.refreshToken ?? null;
      if (visualQaTokens) {
        persistTokens(visualQaTokens.accessToken, visualQaTokens.refreshToken);
      }
      syncTokensToModule(hydratedAccessToken, hydratedRefreshToken);
      dispatch({
        type: 'HYDRATE',
        accessToken: hydratedAccessToken,
        refreshToken: hydratedRefreshToken,
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setTokens = useCallback((accessToken: string, refreshToken: string) => {
    if (!isAllowedOssRuntimeTokenPair(accessToken, refreshToken)) {
      persistTokens(null, null);
      return;
    }
    dispatch({ type: 'SET_TOKENS', accessToken, refreshToken });
    persistTokens(accessToken, refreshToken);
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
  }, []);

  // Register store actions so the API layer can update tokens or clear stale
  // auth without importing React context directly. Lazy require avoids circular dep.
  useEffect(() => {
    loadAuthService().then(({ registerAuthStoreActions }) =>
      registerAuthStoreActions(
        (access, refresh) => {
          if (!isAllowedOssRuntimeTokenPair(access, refresh)) {
            persistTokens(null, null);
            return;
          }
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
        },
      ),
    );
  }, []);

  const value: AuthContextValue = {
    ...state,
    setTokens,
    setSignedOutTransition,
    clearAuth,
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
