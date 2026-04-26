/**
 * RootNavigator — SUBSCRIPTION_ENFORCEMENT routing test
 *
 * Focuses on verifying that:
 *   - trial_expired / sub_expired  → routes to SubscriptionScreen
 *   - trialing / subscribed        → does NOT route to paywall
 *
 * All screens are replaced with minimal stubs so the test only exercises
 * routing logic. Native modules and third-party libs are mocked to allow
 * the component tree to mount in a jsdom/React-Native test environment.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
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

// ---------------------------------------------------------------------------
// react-native-localize — must be mocked before any i18n import
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Feature flags — SUBSCRIPTION_ENFORCEMENT on, IAP off
// ---------------------------------------------------------------------------
jest.mock('../../constants/features', () => ({
  FEATURES: {
    SUBSCRIPTION_ENFORCEMENT: true,
    IAP_ENABLED: false,
    IAP_RESTORE_ENABLED: false,
  },
}));

// ---------------------------------------------------------------------------
// Native & 3rd-party module mocks
// ---------------------------------------------------------------------------
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const insets = { top: 0, bottom: 0, left: 0, right: 0 };
  const SafeAreaInsetsContext = React.createContext(insets);
  return {
    SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) =>
      React.createElement(
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
  cancelAllManualUploads: jest.fn(),
  interruptAutoUpload: jest.fn(),
  enableAutoUpload: jest.fn(),
  browseAlbum: jest.fn().mockResolvedValue([]),
  getAlbumStats: jest.fn().mockResolvedValue({
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

// ---------------------------------------------------------------------------
// Screen stubs — test only cares about which screen gets routed to
// ---------------------------------------------------------------------------
jest.mock('../../screens/SubscriptionScreen', () => ({
  SubscriptionScreen: () => {
    const R = require('react');
    const { Text } = require('react-native');
    return R.createElement(
      Text,
      { testID: 'subscription-screen' },
      'Subscription',
    );
  },
}));

jest.mock('../../screens/DeviceDiscoveryScreen', () => ({
  DeviceDiscoveryScreen: () => {
    const R = require('react');
    const { Text } = require('react-native');
    return R.createElement(
      Text,
      { testID: 'device-discovery-screen' },
      'DeviceDiscovery',
    );
  },
}));

jest.mock('../../screens/SyncActivityScreen', () => ({
  SyncActivityScreen: () => {
    const R = require('react');
    const { Text } = require('react-native');
    return R.createElement(
      Text,
      { testID: 'sync-activity-screen' },
      'SyncActivity',
    );
  },
}));

jest.mock('../../screens/LoginScreen', () => ({
  LoginScreen: () => {
    const R = require('react');
    const { Text } = require('react-native');
    return R.createElement(Text, { testID: 'login-screen' }, 'Login');
  },
}));

jest.mock('../../screens/SmsVerifyScreen', () => ({
  SmsVerifyScreen: () => {
    const R = require('react');
    const { Text } = require('react-native');
    return R.createElement(Text, { testID: 'sms-verify-screen' }, 'SmsVerify');
  },
}));

jest.mock('../../screens/CodeVerifyScreen', () => ({
  CodeVerifyScreen: () => {
    const R = require('react');
    const { Text } = require('react-native');
    return R.createElement(
      Text,
      { testID: 'code-verify-screen' },
      'CodeVerify',
    );
  },
}));

jest.mock('../../screens/AlbumWorkbenchScreen', () => ({
  AlbumWorkbenchScreen: () => {
    const R = require('react');
    const { Text } = require('react-native');
    return R.createElement(
      Text,
      { testID: 'album-workbench-screen' },
      'AlbumWorkbench',
    );
  },
}));

jest.mock('../../screens/SharedFilesScreen', () => ({
  SharedFilesScreen: () => {
    const R = require('react');
    const { Text } = require('react-native');
    return R.createElement(
      Text,
      { testID: 'shared-files-screen' },
      'SharedFiles',
    );
  },
}));

jest.mock('../../screens/HistoryScreen', () => ({
  HistoryScreen: () => {
    const R = require('react');
    const { Text } = require('react-native');
    return R.createElement(Text, { testID: 'history-screen' }, 'History');
  },
}));

jest.mock('../../screens/SettingsScreen', () => ({
  SettingsScreen: () => {
    const R = require('react');
    const { Text } = require('react-native');
    return R.createElement(Text, { testID: 'settings-screen' }, 'Settings');
  },
}));

jest.mock('../../screens/HelpScreen', () => ({
  HelpScreen: () => {
    const R = require('react');
    const { Text } = require('react-native');
    return R.createElement(Text, { testID: 'help-screen' }, 'Help');
  },
}));

jest.mock('../../screens/QRScannerScreen', () => ({
  QRScannerScreen: () => {
    const R = require('react');
    const { Text } = require('react-native');
    return R.createElement(Text, { testID: 'qr-scanner-screen' }, 'QRScanner');
  },
}));

// AuthScreenShell used in SignedOutTransitionScreen / ProfileErrorScreen
jest.mock('../../components/auth/AuthScreenShell', () => ({
  AUTH_COLORS: { primary: '#4e8ef7' },
  AuthScreenShell: ({ children }: { children: React.ReactNode }) => children,
}));

// ---------------------------------------------------------------------------
// auth-store mock — useAuth is a jest.fn() so each test can configure it
// ---------------------------------------------------------------------------
jest.mock('../../stores/auth-store', () => {
  const actual = jest.requireActual('../../stores/auth-store');
  return {
    ...actual,
    useAuth: jest.fn(),
  };
});

// ---------------------------------------------------------------------------
// Imports after all mocks are registered
// ---------------------------------------------------------------------------
import { useAuth } from '../../stores/auth-store';
import { NavigationContainer } from '@react-navigation/native';
import { RootNavigator } from '../RootNavigator';
import i18n from '../../i18n';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockAuthForStatus(status: string, subscriptionStatus = status) {
  (useAuth as jest.Mock).mockReturnValue({
    isLoggedIn: true,
    isLoading: false,
    user: { id: 1, status },
    subscription: {
      status: subscriptionStatus,
      plan: '',
      expireAt: null,
      trialEnd: null,
    },
    profileLoading: false,
    profileError: null,
    signedOutTransition: null,
    loadSubscription: jest.fn().mockResolvedValue(undefined),
    retryProfileLoad: jest.fn(),
    clearAuth: jest.fn(),
    setSignedOutTransition: jest.fn(),
  });
}

function renderWith(status: string, subscriptionStatus = status) {
  mockAuthForStatus(status, subscriptionStatus);
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

  // NativeSyncEngine.getBindingState returns null → falls through to DeviceDiscovery
  (NativeModules as Record<string, unknown>).NativeSyncEngine = {
    getBindingState: jest.fn().mockResolvedValue(null),
    addListener: jest.fn(),
    removeListeners: jest.fn(),
  };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RootNavigator — SUBSCRIPTION_ENFORCEMENT', () => {
  test('routes trial_expired user to SubscriptionScreen', async () => {
    renderWith('trial_expired');
    await waitFor(() =>
      expect(screen.getByTestId('subscription-screen')).toBeTruthy(),
    );
  });

  test('routes sub_expired user to SubscriptionScreen', async () => {
    renderWith('sub_expired');
    await waitFor(() =>
      expect(screen.getByTestId('subscription-screen')).toBeTruthy(),
    );
  });

  test('routes trialing user to main app (not paywall)', async () => {
    renderWith('trialing');
    await waitFor(() => {
      expect(screen.queryByTestId('subscription-screen')).toBeNull();
    });
  });

  test('routes subscribed user to main app (not paywall)', async () => {
    renderWith('subscribed');
    await waitFor(() => {
      expect(screen.queryByTestId('subscription-screen')).toBeNull();
    });
  });

  test('prefers active subscription snapshot over stale expired user status', async () => {
    renderWith('trial_expired', 'subscribed');
    await waitFor(() =>
      expect(screen.getByTestId('device-discovery-screen')).toBeTruthy(),
    );
    expect(screen.queryByTestId('subscription-screen')).toBeNull();
  });
});
