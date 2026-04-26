/**
 * RootNavigator — Phase-2 owner-guard routing invariant
 *
 * While `bootstrapAuthedSession` is in flight (wipe-in-progress branch
 * or just the awaited sidecar reset / wipe / scoped-storage chain) the
 * auth store has `isLoggedIn=true` but `user=null` and
 * `profileLoading=true`. During this window the navigator MUST render
 * `LoadingScreen` — never `AuthedStack`, never `DeviceDiscovery`, never
 * `SyncActivity`. Flipping the navigator into the authed tree early
 * would let `AuthedStack.useEffect` call `NativeSyncEngine.getBindingState()`
 * and route straight into SyncActivity on whatever stale binding survived
 * the account boundary — the exact leak Phase 2 exists to prevent.
 *
 * Mirror fixture of RootNavigator.profileErrorLogout.test.tsx; only the
 * auth-store state and assertions differ.
 */
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { NativeModules } from 'react-native';

// ---------------------------------------------------------------------------
// react-native-gesture-handler — must be mocked before @react-navigation/stack
// ---------------------------------------------------------------------------
jest.mock('react-native-gesture-handler', () => ({
  GestureHandlerRootView: ({ children }: { children: React.ReactNode }) =>
    children,
  PanGestureHandler: ({ children }: { children: React.ReactNode }) => children,
  GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  State: {},
  Directions: {},
}));

jest.mock('react-native-localize', () => ({
  getLocales: () => [
    {
      languageCode: 'zh',
      scriptCode: 'Hans',
      countryCode: 'CN',
      languageTag: 'zh-Hans-CN',
      isRTL: false,
    },
  ],
}));

jest.mock('../../constants/features', () => ({
  FEATURES: {
    SUBSCRIPTION_ENFORCEMENT: false,
    IAP_ENABLED: false,
    IAP_RESTORE_ENABLED: false,
  },
}));

jest.mock('react-native-safe-area-context', () => {
  const R = require('react');
  const insets = { top: 0, bottom: 0, left: 0, right: 0 };
  const SafeAreaInsetsContext = R.createContext(insets);
  return {
    SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) =>
      R.createElement(
        SafeAreaInsetsContext.Provider,
        { value: insets },
        children,
      ),
    useSafeAreaInsets: () => insets,
    SafeAreaInsetsContext,
    initialWindowMetrics: {
      insets: { top: 0, bottom: 0, left: 0, right: 0 },
      frame: { x: 0, y: 0, width: 390, height: 844 },
    },
  };
});

jest.mock('../../components/Icon', () => ({
  Icon: ({ name }: { name: string }) => {
    const R = require('react');
    const { Text: T } = require('react-native');
    return R.createElement(T, null, name);
  },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn().mockResolvedValue(false),
  setGenericPassword: jest.fn().mockResolvedValue(true),
  resetGenericPassword: jest.fn().mockResolvedValue(true),
  ACCESSIBLE: {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AfterFirstUnlockThisDeviceOnly',
  },
}));

jest.mock('../../services/iap-service', () => ({
  iapService: {
    initialize: jest.fn().mockResolvedValue(undefined),
    teardown: jest.fn().mockResolvedValue(undefined),
    onOrphanPurchaseVerified: jest.fn(() => jest.fn()),
    checkEligibility: jest.fn().mockResolvedValue([]),
    restore: jest.fn().mockResolvedValue([]),
    getProductSummaries: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock('../../services/SyncEngineModule', () => ({
  wipeSyncIdentity: jest.fn(),
  cancelAllManualUploads: jest.fn(),
  interruptAutoUpload: jest.fn(),
  enableAutoUpload: jest.fn(),
  browseAlbum: jest.fn().mockResolvedValue([]),
  getAlbumStats: jest
    .fn()
    .mockResolvedValue({
      totalCount: 0,
      transferredCount: 0,
      queuedCount: 0,
      pendingCount: 0,
    }),
  submitManualUpload: jest.fn(),
  getAutoUploadConfig: jest.fn().mockResolvedValue({
    enabled: false,
    state: 'disabled',
    timeRangeMode: 'all',
    customTimeFrom: null,
  }),
  saveAutoUploadConfig: jest.fn(),
  getPhotoAuthorizationStatus: jest.fn().mockResolvedValue('authorized'),
  presentLimitedPhotoPicker: jest.fn(),
  getAlbumCollections: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../services/sidecar-reset-service', () => ({
  resetCurrentDesktopSidecarIfReachable: jest.fn(),
}));

jest.mock('../../utils/clearUserScopedStorage', () => ({
  clearUserScopedStorage: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Screen stubs — each rendered as unique recognisable text so we can
// assert that the NAVIGATOR routed into the wrong one if it bypasses
// the loading branch.
// ---------------------------------------------------------------------------
jest.mock('../../screens/SubscriptionScreen', () => ({
  SubscriptionScreen: () => null,
}));
jest.mock('../../screens/DeviceDiscoveryScreen', () => {
  const R = require('react');
  const { Text } = require('react-native');
  return {
    DeviceDiscoveryScreen: () =>
      R.createElement(
        Text,
        { testID: 'stub-device-discovery' },
        'DEVICE_DISCOVERY_SENTINEL',
      ),
  };
});
jest.mock('../../screens/SyncActivityScreen', () => {
  const R = require('react');
  const { Text } = require('react-native');
  return {
    SyncActivityScreen: () =>
      R.createElement(
        Text,
        { testID: 'stub-sync-activity' },
        'SYNC_ACTIVITY_SENTINEL',
      ),
  };
});
jest.mock('../../screens/LoginScreen', () => ({ LoginScreen: () => null }));
jest.mock('../../screens/SmsVerifyScreen', () => ({
  SmsVerifyScreen: () => null,
}));
jest.mock('../../screens/CodeVerifyScreen', () => ({
  CodeVerifyScreen: () => null,
}));
jest.mock('../../screens/AlbumWorkbenchScreen', () => ({
  AlbumWorkbenchScreen: () => null,
}));
jest.mock('../../screens/SharedFilesScreen', () => ({
  SharedFilesScreen: () => null,
}));
jest.mock('../../screens/HistoryScreen', () => ({ HistoryScreen: () => null }));
jest.mock('../../screens/SettingsScreen', () => ({
  SettingsScreen: () => null,
}));
jest.mock('../../screens/HelpScreen', () => ({ HelpScreen: () => null }));
jest.mock('../../screens/QRScannerScreen', () => ({
  QRScannerScreen: () => null,
}));

jest.mock('../../components/auth/AuthScreenShell', () => ({
  AUTH_COLORS: { primary: '#4e8ef7' },
  AuthScreenShell: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('../../stores/auth-store', () => {
  const actual = jest.requireActual('../../stores/auth-store');
  return {
    ...actual,
    useAuth: jest.fn(),
  };
});

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------
import { useAuth } from '../../stores/auth-store';
import { NavigationContainer } from '@react-navigation/native';
import { RootNavigator } from '../RootNavigator';
import i18n from '../../i18n';

beforeAll(async () => {
  await i18n.changeLanguage('zh-Hans');
});

beforeEach(() => {
  jest.clearAllMocks();
  (NativeModules as Record<string, unknown>).NativeSyncEngine = {
    getBindingState: jest.fn().mockResolvedValue(null),
    addListener: jest.fn(),
    removeListeners: jest.fn(),
  };
});

function renderWithAuth(overrides: Record<string, unknown>) {
  (useAuth as jest.Mock).mockReturnValue({
    isLoggedIn: true,
    isLoading: false,
    user: null,
    subscription: null,
    profileLoading: true,
    profileError: null,
    signedOutTransition: null,
    loadSubscription: jest.fn(),
    retryProfileLoad: jest.fn(),
    clearAuth: jest.fn(),
    setSignedOutTransition: jest.fn(),
    ...overrides,
  });
  return render(
    <NavigationContainer>
      <RootNavigator />
    </NavigationContainer>,
  );
}

describe('RootNavigator — owner-guard loading window (Phase 2 invariant)', () => {
  test('bootstrap in flight (isLoggedIn=true, user=null, profileLoading=true): LoadingScreen, no authed-stack screens', () => {
    renderWithAuth({});

    // None of the authed-stack sentinel texts may render while bootstrap
    // is still resolving its wipe decision. If these appear the
    // navigator has prematurely routed into `AuthedStack`, defeating
    // the Phase-2 owner guard.
    expect(screen.queryByTestId('stub-device-discovery')).toBeNull();
    expect(screen.queryByTestId('stub-sync-activity')).toBeNull();
    expect(screen.queryByText(/DEVICE_DISCOVERY_SENTINEL/)).toBeNull();
    expect(screen.queryByText(/SYNC_ACTIVITY_SENTINEL/)).toBeNull();

    // ProfileErrorScreen must also not render — profileError is null
    // during in-flight bootstrap.
    expect(screen.queryByText('退出登录')).toBeNull();
  });

  test('profileLoading=false + user=null + no error: still LoadingScreen (between LOGIN and PROFILE_LOAD_START)', () => {
    // Brief window right after LOGIN dispatch where `profileLoading`
    // hasn't flipped to true yet (auto-trigger effect enqueued, not
    // yet run). We still render LoadingScreen — never authed-stack.
    renderWithAuth({ profileLoading: false });

    expect(screen.queryByTestId('stub-device-discovery')).toBeNull();
    expect(screen.queryByTestId('stub-sync-activity')).toBeNull();
    expect(screen.queryByText('退出登录')).toBeNull();
  });

  test('bootstrap completes with user set: authed-stack renders (DeviceDiscovery or SyncActivity)', async () => {
    renderWithAuth({
      user: {
        id: 42,
        primaryIdentity: { type: 'email', display: 'u@example.com' },
        identities: [{ type: 'email', display: 'u@example.com' }],
        status: 'subscribed',
        plan: 'yearly',
        expireAt: '2030-01-01T00:00:00.000Z',
        trialEnd: null,
      },
      profileLoading: false,
    });

    // AuthedStack's initial-route effect resolves asynchronously against
    // `NativeSyncEngine.getBindingState()` — we mocked it to null so the
    // fallback is DeviceDiscovery. Either sentinel appearing is fine —
    // the invariant is just "authed-stack unlocked after user is set".
    await screen.findByTestId('stub-device-discovery');
  });
});
