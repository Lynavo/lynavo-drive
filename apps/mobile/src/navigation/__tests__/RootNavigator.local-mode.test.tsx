/**
 * RootNavigator — guest local LAN mode
 *
 * Guest users with no persisted auth token should land in the foreground LAN
 * sync surfaces, not the login screen. The initial route is still driven by
 * the native binding snapshot: bound devices go to SyncActivity, fresh local
 * installs go to DeviceDiscovery.
 */
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { NativeEventEmitter, NativeModules } from 'react-native';

type NativeListener = (payload: unknown) => void;

let nativeListeners: Record<string, NativeListener> = {};

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
      insets,
      frame: { x: 0, y: 0, width: 390, height: 844 },
    },
  };
});

jest.mock('../../components/Icon', () => ({
  Icon: ({ name }: { name: string }) => {
    const R = require('react');
    const { Text } = require('react-native');
    return R.createElement(Text, null, name);
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
  PAIRING_INVALIDATED_EVENT: 'onPairingInvalidated',
  PAIRING_INVALIDATED_ROUTE_REASON: 'pairing_invalidated',
  isPairingInvalidatedEvent: (payload: unknown) => {
    if (payload === null || payload === undefined) return true;
    if (typeof payload !== 'object' || Array.isArray(payload)) return false;
    const prototype = Object.getPrototypeOf(payload);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const reason = (payload as { reason?: unknown }).reason;
    return reason === undefined || typeof reason === 'string';
  },
  wipeSyncIdentity: jest.fn(),
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

jest.mock('../../screens/DeviceDiscoveryGlobalScreen', () => ({
  DeviceDiscoveryGlobalScreen: ({
    route,
  }: {
    route?: { params?: { reason?: string } };
  }) => {
    const R = require('react');
    const { Text } = require('react-native');
    return R.createElement(
      Text,
      { testID: 'global-device-discovery-screen' },
      `GlobalDeviceDiscovery reason=${String(route?.params?.reason)}`,
    );
  },
}));

jest.mock('../../screens/SyncActivityGlobalScreen', () => ({
  SyncActivityGlobalScreen: () => {
    const R = require('react');
    const { Text } = require('react-native');
    return R.createElement(
      Text,
      { testID: 'global-sync-activity-screen' },
      'GlobalSyncActivity',
    );
  },
}));

jest.mock('../../screens/SharedFilesGlobalScreen', () => ({
  SharedFilesGlobalScreen: () => null,
}));
jest.mock('../../screens/PhoneSyncSpaceGlobalScreen', () => ({
  PhoneSyncSpaceGlobalScreen: () => null,
}));
jest.mock('../../screens/LocalComputerGlobalScreen', () => ({
  LocalComputerGlobalScreen: () => null,
}));
jest.mock('../../screens/DownloadRecordsGlobalScreen', () => ({
  DownloadRecordsGlobalScreen: () => null,
}));
jest.mock('../../screens/HistoryGlobalScreen', () => ({
  HistoryGlobalScreen: () => null,
}));
jest.mock('../../screens/SettingsGlobalScreen', () => ({
  SettingsGlobalScreen: () => null,
}));
jest.mock('../../screens/HelpGlobalScreen', () => ({
  HelpGlobalScreen: () => null,
}));
jest.mock('../../screens/OpenSourceInfoScreen', () => ({
  OpenSourceInfoScreen: () => null,
}));
jest.mock('../../screens/AutoUploadSettingsGlobalScreen', () => ({
  AutoUploadSettingsGlobalScreen: () => null,
}));
jest.mock('../../components/GlobalBottomTabBar', () => ({
  GlobalBottomTabBar: () => null,
}));

jest.mock('../../screens/DeviceDiscoveryScreen', () => ({
  DeviceDiscoveryScreen: () => null,
}));
jest.mock('../../screens/CodeVerifyScreen', () => ({
  CodeVerifyScreen: () => null,
}));
jest.mock('../../screens/ConnectionTutorialScreen', () => ({
  ConnectionTutorialScreen: () => null,
}));
jest.mock('../../screens/SyncActivityScreen', () => ({
  SyncActivityScreen: () => null,
}));
jest.mock('../../screens/AlbumWorkbenchScreen', () => ({
  AlbumWorkbenchScreen: () => null,
}));
jest.mock('../../screens/SharedFilesScreen', () => ({
  SharedFilesScreen: () => null,
}));
jest.mock('../../screens/PhoneSyncSpaceScreen', () => ({
  PhoneSyncSpaceScreen: () => null,
}));
jest.mock('../../screens/LocalComputerScreen', () => ({
  LocalComputerScreen: () => null,
}));
jest.mock('../../screens/HistoryScreen', () => ({ HistoryScreen: () => null }));
jest.mock('../../screens/SettingsScreen', () => ({
  SettingsScreen: () => null,
}));
jest.mock('../../screens/HelpScreen', () => ({ HelpScreen: () => null }));
jest.mock('../../screens/QRScannerScreen', () => ({
  QRScannerScreen: () => null,
}));
jest.mock('../../screens/AutoUploadSettingsScreen', () => ({
  AutoUploadSettingsScreen: () => null,
}));

jest.mock('../../stores/auth-store', () => {
  const actual = jest.requireActual('../../stores/auth-store');
  return {
    ...actual,
    useAuth: jest.fn(),
  };
});

import { NavigationContainer } from '@react-navigation/native';
import { useAuth } from '../../stores/auth-store';
import { wipeSyncIdentity } from '../../services/SyncEngineModule';
import { RootNavigator } from '../RootNavigator';
import i18n from '../../i18n';

beforeAll(async () => {
  await i18n.changeLanguage('zh-Hans');
});

beforeEach(() => {
  jest.clearAllMocks();
  nativeListeners = {};
  (NativeModules as Record<string, unknown>).NativeSyncEngine = {
    getBindingState: jest.fn().mockResolvedValue(null),
    getBindingInvalidationState: jest.fn().mockResolvedValue(null),
    addListener: jest.fn(),
    removeListeners: jest.fn(),
  };
  jest
    .spyOn(NativeEventEmitter.prototype, 'addListener')
    .mockImplementation((eventName: string, listener: NativeListener) => {
      nativeListeners[eventName] = listener;
      return { remove: jest.fn() } as never;
    });
  (useAuth as jest.Mock).mockReturnValue({
    isLoggedIn: false,
    isLoading: false,
    accessToken: null,
    refreshToken: null,
    signedOutTransition: null,
    clearAuth: jest.fn(),
    setSignedOutTransition: jest.fn(),
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function renderRootNavigator() {
  return render(
    <NavigationContainer>
      <RootNavigator />
    </NavigationContainer>,
  );
}

describe('RootNavigator — guest local LAN mode', () => {
  test('guest without native binding routes to DeviceDiscovery, not Login', async () => {
    renderRootNavigator();

    await waitFor(() =>
      expect(screen.getByTestId('global-device-discovery-screen')).toBeTruthy(),
    );
    expect(screen.queryByTestId('global-login-screen')).toBeNull();
    expect(NativeModules.NativeSyncEngine.getBindingState).toHaveBeenCalled();
    expect(wipeSyncIdentity).not.toHaveBeenCalled();
  });

  test('guest with native binding routes to SyncActivity, not Login', async () => {
    (
      NativeModules.NativeSyncEngine.getBindingState as jest.Mock
    ).mockResolvedValue({
      deviceId: 'desktop-1',
      deviceName: 'Studio Mac',
      host: '192.168.1.10',
    });

    renderRootNavigator();

    await waitFor(() =>
      expect(screen.getByTestId('global-sync-activity-screen')).toBeTruthy(),
    );
    expect(screen.queryByTestId('global-login-screen')).toBeNull();
    expect(wipeSyncIdentity).not.toHaveBeenCalled();
  });

  test('guest local stack keeps pairing invalidation watcher active', async () => {
    (
      NativeModules.NativeSyncEngine.getBindingState as jest.Mock
    ).mockResolvedValue({
      deviceId: 'desktop-1',
      deviceName: 'Studio Mac',
      host: '192.168.1.10',
    });

    renderRootNavigator();

    await waitFor(() =>
      expect(screen.getByTestId('global-sync-activity-screen')).toBeTruthy(),
    );
    expect(nativeListeners.onPairingInvalidated).toBeDefined();

    await act(async () => {
      nativeListeners.onPairingInvalidated?.({
        reason: 'desktop_reset_code',
      });
    });

    await waitFor(() =>
      expect(screen.getByTestId('global-device-discovery-screen')).toBeTruthy(),
    );
    expect(screen.getByText(/reason=pairing_invalidated/)).toBeTruthy();
  });

  test('persisted official tokens without a profile still fail open to local LAN', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      isLoggedIn: true,
      isLoading: false,
      accessToken: 'stale-access-token',
      refreshToken: 'stale-refresh-token',
      signedOutTransition: null,
      clearAuth: jest.fn(),
      setSignedOutTransition: jest.fn(),
    });

    renderRootNavigator();

    await waitFor(() =>
      expect(screen.getByTestId('global-device-discovery-screen')).toBeTruthy(),
    );
    expect(wipeSyncIdentity).not.toHaveBeenCalled();
  });

  test('profile load errors from stale commercial sessions do not block LAN screens', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      isLoggedIn: true,
      isLoading: false,
      accessToken: 'stale-access-token',
      refreshToken: 'stale-refresh-token',
      signedOutTransition: null,
      clearAuth: jest.fn(),
      setSignedOutTransition: jest.fn(),
    });

    renderRootNavigator();

    await waitFor(() =>
      expect(screen.getByTestId('global-device-discovery-screen')).toBeTruthy(),
    );
    expect(screen.queryByText('profile server unavailable')).toBeNull();
    expect(wipeSyncIdentity).not.toHaveBeenCalled();
  });
});
