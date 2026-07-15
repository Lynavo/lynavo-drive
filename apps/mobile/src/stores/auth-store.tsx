import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
} from 'react';
import { applyVisualQaSharedFilesPreviewFlag } from '../dev/visualQa';

applyVisualQaSharedFilesPreviewFlag();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SignedOutTransition = 'session_replaced' | null;

export interface AuthState {
  isLoggedIn: boolean;
  isLoading: boolean;
  /** Short-lived exit transition shown before we land on local LAN screens. */
  signedOutTransition: SignedOutTransition;
}

function loadAuthService(): Promise<typeof import('../services/auth-service')> {
  return Promise.resolve(
    require('../services/auth-service') as typeof import('../services/auth-service'),
  );
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

type AuthAction =
  | { type: 'HYDRATE'; isLoggedIn: boolean }
  | { type: 'SET_SIGNED_OUT_TRANSITION'; transition: SignedOutTransition }
  | { type: 'CLEAR' };

// isLoading starts as true so RootNavigator waits for the hydrate pass before
// entering local LAN screens.
const initialState: AuthState = {
  isLoggedIn: false,
  isLoading: true,
  signedOutTransition: null,
};

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'HYDRATE':
      return {
        ...state,
        isLoading: false,
        isLoggedIn: action.isLoggedIn,
        signedOutTransition: null,
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

  // OSS startup always enters the guest LAN session shape. Visual QA may pick
  // a local route, but it must not mint a signed-in session.
  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) {
        return;
      }
      dispatch({ type: 'HYDRATE', isLoggedIn: false });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setSignedOutTransition = useCallback(
    (transition: SignedOutTransition) => {
      dispatch({ type: 'SET_SIGNED_OUT_TRANSITION', transition });
    },
    [],
  );

  const clearAuth = useCallback((transition?: SignedOutTransition) => {
    if (transition !== undefined) {
      dispatch({ type: 'SET_SIGNED_OUT_TRANSITION', transition });
    }
    dispatch({ type: 'CLEAR' });
  }, []);

  // Register a narrow clear callback so API session-replaced responses can
  // return the app to the guest LAN route without importing React context.
  useEffect(() => {
    loadAuthService().then(({ registerSessionClearAction }) =>
      registerSessionClearAction(transition => {
        if (transition !== undefined) {
          dispatch({
            type: 'SET_SIGNED_OUT_TRANSITION',
            transition,
          });
        }
        dispatch({ type: 'CLEAR' });
      }),
    );
  }, []);

  const value: AuthContextValue = {
    ...state,
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
