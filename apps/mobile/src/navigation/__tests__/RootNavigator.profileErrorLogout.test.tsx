/**
 * RootNavigator — ProfileErrorScreen "logout" escape-hatch test
 *
 * Verifies that when the user taps "登出" on the fail-closed
 * ProfileErrorScreen (reached when bootstrapAuthedSession errored out),
 * the navigator runs the same cleanup sequence as SettingsScreen logout
 * before calling auth.clearAuth():
 *
 *   1. resetCurrentDesktopSidecarIfReachable (best-effort)
 *   2. wipeSyncIdentity (retry — may succeed if earlier failure was transient)
 *   3. clearUserScopedStorage (best-effort)
 *   4. auth.clearAuth() — ALWAYS, even if the above reject
 *
 * Unlike SettingsScreen.handleLogout, this path MUST fail-open. The user
 * is already stuck on an error screen and has no other way out; the
 * sentinel + owner-guard are the real backstops.
 */
import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
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

// ---------------------------------------------------------------------------
// Cleanup function mocks — this is what the test actually inspects
// ---------------------------------------------------------------------------
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
// Screen stubs (we only ever render ProfileErrorScreen, but the stack still
// imports all screens eagerly).
// ---------------------------------------------------------------------------
jest.mock('../../screens/SubscriptionScreen', () => ({
  SubscriptionScreen: () => null,
}));
jest.mock('../../screens/DeviceDiscoveryScreen', () => ({
  DeviceDiscoveryScreen: () => null,
}));
jest.mock('../../screens/SyncActivityScreen', () => ({
  SyncActivityScreen: () => null,
}));
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
import { wipeSyncIdentity } from '../../services/SyncEngineModule';
import { resetCurrentDesktopSidecarIfReachable } from '../../services/sidecar-reset-service';
import { clearUserScopedStorage } from '../../utils/clearUserScopedStorage';
import i18n from '../../i18n';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderProfileError(clearAuth: jest.Mock) {
  (useAuth as jest.Mock).mockReturnValue({
    isLoggedIn: true,
    isLoading: false,
    user: null,
    subscription: null,
    profileLoading: false,
    profileError: { message: 'boom' },
    signedOutTransition: null,
    loadSubscription: jest.fn(),
    retryProfileLoad: jest.fn(),
    clearAuth,
    setSignedOutTransition: jest.fn(),
  });
  return render(
    <NavigationContainer>
      <RootNavigator />
    </NavigationContainer>,
  );
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RootNavigator — ProfileErrorScreen logout escape hatch', () => {
  test('happy path: runs sidecar reset + wipe + scoped storage clear, then clearAuth', async () => {
    (resetCurrentDesktopSidecarIfReachable as jest.Mock).mockResolvedValue(
      undefined,
    );
    (wipeSyncIdentity as jest.Mock).mockResolvedValue(undefined);
    (clearUserScopedStorage as jest.Mock).mockResolvedValue(undefined);
    const clearAuth = jest.fn();

    renderProfileError(clearAuth);

    // i18n is configured to zh-Hans in this test suite, so the logout
    // label renders as "退出登录" (settings.actions.logout).
    const logoutBtn = await screen.findByText('退出登录');
    fireEvent.press(logoutBtn);

    await waitFor(() => {
      expect(clearAuth).toHaveBeenCalledTimes(1);
    });

    expect(resetCurrentDesktopSidecarIfReachable).toHaveBeenCalledTimes(1);
    expect(wipeSyncIdentity).toHaveBeenCalledTimes(1);
    expect(clearUserScopedStorage).toHaveBeenCalledTimes(1);
  });

  test('fail-open: wipe rejection still results in clearAuth', async () => {
    (resetCurrentDesktopSidecarIfReachable as jest.Mock).mockResolvedValue(
      undefined,
    );
    (wipeSyncIdentity as jest.Mock).mockRejectedValue(new Error('wipe boom'));
    (clearUserScopedStorage as jest.Mock).mockResolvedValue(undefined);
    const clearAuth = jest.fn();
    // Silence the console.warn the handler emits on rejection so the
    // test output stays clean.
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    renderProfileError(clearAuth);

    const logoutBtn = await screen.findByText('退出登录');
    fireEvent.press(logoutBtn);

    await waitFor(() => {
      expect(clearAuth).toHaveBeenCalledTimes(1);
    });
    expect(wipeSyncIdentity).toHaveBeenCalledTimes(1);
    // scoped storage clear must still run despite the wipe failure
    expect(clearUserScopedStorage).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });

  test('fail-open: all three cleanup steps rejecting still results in clearAuth', async () => {
    (resetCurrentDesktopSidecarIfReachable as jest.Mock).mockRejectedValue(
      new Error('sidecar boom'),
    );
    (wipeSyncIdentity as jest.Mock).mockRejectedValue(new Error('wipe boom'));
    (clearUserScopedStorage as jest.Mock).mockRejectedValue(
      new Error('storage boom'),
    );
    const clearAuth = jest.fn();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    renderProfileError(clearAuth);

    const logoutBtn = await screen.findByText('退出登录');
    fireEvent.press(logoutBtn);

    await waitFor(() => {
      expect(clearAuth).toHaveBeenCalledTimes(1);
    });

    warnSpy.mockRestore();
  });
});
