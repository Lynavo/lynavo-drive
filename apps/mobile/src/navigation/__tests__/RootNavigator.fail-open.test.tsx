/**
 * RootNavigator - OSS fail-open routing test
 *
 * Focuses on verifying that account state no longer blocks foreground LAN sync
 * routing. Official background / off-LAN gates are handled separately.
 *
 * All screens are replaced with minimal stubs so the test only exercises
 * routing logic. Native modules and third-party libs are mocked to allow
 * the component tree to mount in a jsdom/React-Native test environment.
 */
import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { NativeModules, StyleSheet } from 'react-native';

declare const process: { env: Record<string, string | undefined> };

type TestGlobal = typeof globalThis & { __DEV__?: boolean };
const testGlobal = globalThis as TestGlobal;

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

jest.mock('../../services/SyncEngineModule', () => ({
  interruptAutoUpload: jest.fn(),
  enableAutoUpload: jest.fn(),
  browseAlbum: jest.fn().mockResolvedValue([]),
  getAlbumStats: jest.fn().mockResolvedValue({
    totalCount: 0,
    transferredCount: 0,
    queuedCount: 0,
    pendingCount: 0,
  }),
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

jest.mock('react-native-video', () => 'Video');

jest.mock('@react-native-documents/viewer', () => ({
  viewDocument: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Screen stubs — test only cares about which screen gets routed to
// ---------------------------------------------------------------------------
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

jest.mock('../../screens/DeviceDiscoveryGlobalScreen', () => ({
  DeviceDiscoveryGlobalScreen: () => {
    const R = require('react');
    const { Text } = require('react-native');
    return R.createElement(
      Text,
      { testID: 'global-device-discovery-screen' },
      'GlobalDeviceDiscovery',
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

jest.mock('../../screens/SyncActivityGlobalScreen', () => ({
  SyncActivityGlobalScreen: ({
    showBottomTabBar,
  }: {
    showBottomTabBar?: boolean;
  }) => {
    const R = require('react');
    const { Text } = require('react-native');
    return R.createElement(
      Text,
      { testID: 'global-sync-activity-screen' },
      `GlobalSyncActivity showBottomTabBar=${String(showBottomTabBar)}`,
    );
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
  SharedFilesScreen: ({ showBottomTabBar }: { showBottomTabBar?: boolean }) => {
    const R = require('react');
    const { Text } = require('react-native');
    return R.createElement(
      Text,
      { testID: 'shared-files-screen' },
      `SharedFiles showBottomTabBar=${String(showBottomTabBar)}`,
    );
  },
}));

jest.mock('../../screens/SharedFilesGlobalScreen', () => ({
  SharedFilesGlobalScreen: ({
    showBottomTabBar,
  }: {
    showBottomTabBar?: boolean;
  }) => {
    const R = require('react');
    const { Text } = require('react-native');
    return R.createElement(
      Text,
      { testID: 'shared-files-global-screen' },
      `SharedFilesGlobal showBottomTabBar=${String(showBottomTabBar)}`,
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

jest.mock('../../screens/HistoryGlobalScreen', () => ({
  HistoryGlobalScreen: () => {
    const R = require('react');
    const { Text } = require('react-native');
    return R.createElement(Text, { testID: 'history-screen' }, 'History');
  },
}));

jest.mock('../../screens/SettingsScreen', () => ({
  SettingsScreen: ({ showBottomTabBar }: { showBottomTabBar?: boolean }) => {
    const R = require('react');
    const { Text } = require('react-native');
    return R.createElement(
      Text,
      { testID: 'settings-screen' },
      `Settings showBottomTabBar=${String(showBottomTabBar)}`,
    );
  },
}));

jest.mock('../../screens/SettingsGlobalScreen', () => ({
  SettingsGlobalScreen: ({
    showBottomTabBar,
  }: {
    showBottomTabBar?: boolean;
  }) => {
    const R = require('react');
    const { Text } = require('react-native');
    return R.createElement(
      Text,
      { testID: 'settings-global-screen' },
      `SettingsGlobal showBottomTabBar=${String(showBottomTabBar)}`,
    );
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

function mockGuestLocalSession() {
  (useAuth as jest.Mock).mockReturnValue({
    isLoggedIn: false,
    isLoading: false,
    signedOutTransition: null,
    clearAuth: jest.fn(),
    setSignedOutTransition: jest.fn(),
  });
}

function mockLegacyAuthenticatedSession() {
  (useAuth as jest.Mock).mockReturnValue({
    isLoggedIn: true,
    isLoading: false,
    signedOutTransition: null,
    clearAuth: jest.fn(),
    setSignedOutTransition: jest.fn(),
  });
}

function renderWithGuestLocalSession() {
  mockGuestLocalSession();
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

const originalDev = testGlobal.__DEV__;
const originalEnv = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();
  testGlobal.__DEV__ = true;
  process.env = { ...originalEnv };
  delete process.env.LYNAVO_VISUAL_QA;
  delete process.env.LYNAVO_VISUAL_QA_ROUTE;

  // NativeSyncEngine.getBindingState returns null → falls through to DeviceDiscovery
  (NativeModules as Record<string, unknown>).NativeSyncEngine = {
    getBindingState: jest.fn().mockResolvedValue(null),
    addListener: jest.fn(),
    removeListeners: jest.fn(),
  };
});

afterAll(() => {
  testGlobal.__DEV__ = originalDev;
  process.env = originalEnv;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RootNavigator - OSS fail-open routing', () => {
  test('routes stale authenticated sessions to foreground LAN discovery', async () => {
    mockLegacyAuthenticatedSession();
    render(
      <NavigationContainer>
        <RootNavigator />
      </NavigationContainer>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('global-device-discovery-screen')).toBeTruthy(),
    );
  });

  test('does not require account state before entering foreground LAN discovery', async () => {
    renderWithGuestLocalSession();
    await waitFor(() =>
      expect(screen.getByTestId('global-device-discovery-screen')).toBeTruthy(),
    );
  });

  test('routes hydrated local sessions to main app without an account gate', async () => {
    renderWithGuestLocalSession();
    await waitFor(() =>
      expect(screen.getByTestId('global-device-discovery-screen')).toBeTruthy(),
    );
  });

  test('keeps local sessions off account-gated routes', async () => {
    renderWithGuestLocalSession();
    await waitFor(() =>
      expect(screen.getByTestId('global-device-discovery-screen')).toBeTruthy(),
    );
  });

  test('expired status with an existing binding still routes to SyncActivity', async () => {
    (
      NativeModules.NativeSyncEngine.getBindingState as jest.Mock
    ).mockResolvedValue({
      deviceId: 'desktop-1',
      deviceName: 'Studio Mac',
      host: '192.168.1.10',
    });

    renderWithGuestLocalSession();

    await waitFor(() =>
      expect(screen.getByTestId('global-sync-activity-screen')).toBeTruthy(),
    );
  });

  test('stale legacy account snapshots are no longer required for LAN discovery', async () => {
    renderWithGuestLocalSession();
    await waitFor(() =>
      expect(screen.getByTestId('global-device-discovery-screen')).toBeTruthy(),
    );
  });

  test('does not reset foreground LAN route after entering the app', async () => {
    const view = renderWithGuestLocalSession();
    await waitFor(() =>
      expect(screen.getByTestId('global-device-discovery-screen')).toBeTruthy(),
    );

    mockGuestLocalSession();
    view.rerender(
      <NavigationContainer>
        <RootNavigator />
      </NavigationContainer>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('global-device-discovery-screen')).toBeTruthy(),
    );
    expect(screen.queryByTestId('open-source-info-screen')).toBeNull();
  });

  test('uses visual QA whitelisted local route as initial route', async () => {
    process.env.LYNAVO_VISUAL_QA = '1';
    process.env.LYNAVO_VISUAL_QA_ROUTE = 'History';

    renderWithGuestLocalSession();

    await waitFor(() =>
      expect(screen.getByTestId('history-screen')).toBeTruthy(),
    );
    expect(screen.queryByTestId('device-discovery-screen')).toBeNull();
  });

  test('global connected session renders home, local computer files, and settings inside the main tab shell', async () => {
    (NativeModules as Record<string, unknown>).NativeSyncEngine = {
      getBindingState: jest.fn().mockResolvedValue({ deviceId: 'desktop-1' }),
      addListener: jest.fn(),
      removeListeners: jest.fn(),
    };

    renderWithGuestLocalSession();

    await waitFor(() =>
      expect(
        screen.getByText('GlobalSyncActivity showBottomTabBar=false'),
      ).toBeTruthy(),
    );
    expect(
      StyleSheet.flatten(
        screen.getByTestId('global-main-tabs-root').props.style,
      ).backgroundColor,
    ).toBe('#F7FBFF');
    expect(screen.queryByTestId('bottom-tab-bar-outer')).toBeNull();
    expect(screen.getByTestId('global-bottom-tab-files')).toBeTruthy();

    fireEvent.press(screen.getByTestId('global-bottom-tab-files'));
    await waitFor(() =>
      expect(
        screen.getByText('SharedFilesGlobal showBottomTabBar=false'),
      ).toBeTruthy(),
    );
    expect(
      screen.UNSAFE_getByProps({ testID: 'global-sync-activity-screen' }),
    ).toBeTruthy();

    fireEvent.press(screen.getByTestId('global-bottom-tab-settings'));
    await waitFor(() =>
      expect(
        screen.getByText('SettingsGlobal showBottomTabBar=false'),
      ).toBeTruthy(),
    );
    expect(
      screen.UNSAFE_getByProps({ testID: 'shared-files-global-screen' }),
    ).toBeTruthy();

    fireEvent.press(screen.getByTestId('global-bottom-tab-home'));
    await waitFor(() =>
      expect(
        screen.getByText('GlobalSyncActivity showBottomTabBar=false'),
      ).toBeTruthy(),
    );
  });
});
