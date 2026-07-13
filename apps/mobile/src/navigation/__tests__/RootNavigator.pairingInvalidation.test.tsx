/**
 * RootNavigator — global pairing invalidation routing
 *
 * Verifies the global build invariant:
 *   - native pairing invalidation resets any active local route to pairing
 *   - ordinary offline binding state remains an in-app update, not a pairing reset
 *   - cold-start persisted invalidation opens pairing with an explicit reason
 */
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { NativeEventEmitter, NativeModules } from 'react-native';

type NativeListener = (payload: unknown) => void;

let nativeListeners: Record<string, NativeListener> = {};

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

jest.mock('../../services/SyncEngineModule', () => {
  const actual = jest.requireActual('../../services/SyncEngineModule');
  return {
    ...actual,
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
  };
});

// ---------------------------------------------------------------------------
// Screen stubs — route params are surfaced as text for assertions.
// ---------------------------------------------------------------------------
jest.mock('../../screens/DeviceDiscoveryScreen', () => ({
  DeviceDiscoveryScreen: ({
    route,
  }: {
    route?: { params?: { mode?: string; reason?: string } };
  }) => {
    const R = require('react');
    const { Text } = require('react-native');
    return R.createElement(
      Text,
      { testID: 'device-discovery-screen' },
      `DeviceDiscovery reason=${String(
        route?.params?.reason,
      )} mode=${String(route?.params?.mode)}`,
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

jest.mock('../../screens/SharedFilesScreen', () => ({
  SharedFilesScreen: () => null,
}));
jest.mock('../../screens/PhoneSyncSpaceScreen', () => ({
  PhoneSyncSpaceScreen: () => null,
}));
jest.mock('../../screens/LocalComputerScreen', () => ({
  LocalComputerScreen: () => null,
}));
jest.mock('../../screens/DownloadRecordsScreen', () => ({
  DownloadRecordsScreen: () => null,
}));
jest.mock('../../screens/HistoryScreen', () => ({
  HistoryScreen: () => null,
}));
jest.mock('../../screens/SettingsScreen', () => ({
  SettingsScreen: () => null,
}));
jest.mock('../../screens/HelpScreen', () => ({
  HelpScreen: () => null,
}));
jest.mock('../../screens/AutoUploadSettingsScreen', () => ({
  AutoUploadSettingsScreen: () => null,
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

jest.mock('../../components/BottomTabBar', () => ({
  BottomTabBar: () => null,
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
import { CommonActions, NavigationContainer } from '@react-navigation/native';
import { useAuth } from '../../stores/auth-store';
import { RootNavigator } from '../RootNavigator';
import i18n from '../../i18n';

beforeAll(async () => {
  await i18n.changeLanguage('zh-Hans');
});

beforeEach(() => {
  jest.clearAllMocks();
  nativeListeners = {};
  (NativeModules as Record<string, unknown>).NativeSyncEngine = {
    getBindingState: jest.fn().mockResolvedValue({ deviceId: 'desktop-1' }),
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
    isLoggedIn: true,
    isLoading: false,
    signedOutTransition: null,
    clearAuth: jest.fn(),
    setSignedOutTransition: jest.fn(),
  });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function renderRootNavigator() {
  return render(
    <NavigationContainer>
      <RootNavigator />
    </NavigationContainer>,
  );
}

describe('RootNavigator — pairing invalidation', () => {
  test('pairing invalidation event guard accepts only null, undefined, or plain object payloads', () => {
    class CustomPayload {
      reason = 'desktop_reset_code';
    }
    const { isPairingInvalidatedEvent } = jest.requireActual(
      '../../services/SyncEngineModule',
    ) as typeof import('../../services/SyncEngineModule');

    expect(isPairingInvalidatedEvent(null)).toBe(true);
    expect(isPairingInvalidatedEvent(undefined)).toBe(true);
    expect(isPairingInvalidatedEvent({ reason: 'desktop_reset_code' })).toBe(
      true,
    );
    expect(isPairingInvalidatedEvent(Object.create(null))).toBe(true);

    expect(isPairingInvalidatedEvent({ reason: 123 })).toBe(false);
    expect(isPairingInvalidatedEvent(['desktop_reset_code'])).toBe(false);
    expect(isPairingInvalidatedEvent(new Date())).toBe(false);
    expect(isPairingInvalidatedEvent(new Map())).toBe(false);
    expect(isPairingInvalidatedEvent(new CustomPayload())).toBe(false);
  });

  test('global active local navigation resets when native emits onPairingInvalidated', async () => {
    renderRootNavigator();

    await waitFor(() =>
      expect(screen.getByTestId('sync-activity-screen')).toBeTruthy(),
    );

    await act(async () => {
      nativeListeners.onPairingInvalidated?.({ reason: 'desktop_reset_code' });
    });

    await waitFor(() =>
      expect(screen.getByTestId('device-discovery-screen')).toBeTruthy(),
    );
    expect(screen.getByText(/reason=pairing_invalidated/)).toBeTruthy();
    expect(screen.queryByTestId('sync-activity-screen')).toBeNull();
  });

  test('watcher suppresses immediate duplicate invalidation events but handles a later event', async () => {
    renderRootNavigator();

    await waitFor(() =>
      expect(screen.getByTestId('sync-activity-screen')).toBeTruthy(),
    );

    jest.useFakeTimers();
    const resetSpy = jest.spyOn(CommonActions, 'reset');

    act(() => {
      nativeListeners.onPairingInvalidated?.({
        reason: 'desktop_reset_code',
      });
      nativeListeners.onPairingInvalidated?.({
        reason: 'desktop_reset_code',
      });
    });

    expect(resetSpy).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(600);
    });
    act(() => {
      nativeListeners.onPairingInvalidated?.({
        reason: 'desktop_reset_code',
      });
    });

    expect(resetSpy).toHaveBeenCalledTimes(2);
  });

  test('watcher accepts another invalidation after the in-flight debounce window', async () => {
    jest.useFakeTimers();
    renderRootNavigator();

    await waitFor(() =>
      expect(screen.getByTestId('sync-activity-screen')).toBeTruthy(),
    );

    const resetSpy = jest.spyOn(CommonActions, 'reset');

    act(() => {
      nativeListeners.onPairingInvalidated?.({
        reason: 'desktop_reset_code',
      });
    });

    expect(resetSpy).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(500);
    });

    act(() => {
      nativeListeners.onPairingInvalidated?.({
        reason: 'desktop_reset_code',
      });
    });

    expect(resetSpy).toHaveBeenCalledTimes(2);
  });

  test('ordinary offline binding updates do not reset navigation', async () => {
    renderRootNavigator();

    await waitFor(() =>
      expect(screen.getByTestId('sync-activity-screen')).toBeTruthy(),
    );

    await act(async () => {
      nativeListeners.onBindingStateChanged?.({
        deviceId: 'desktop-1',
        status: 'offline',
      });
    });

    expect(screen.getByTestId('sync-activity-screen')).toBeTruthy();
    expect(screen.queryByTestId('device-discovery-screen')).toBeNull();
  });

  test('cold-start native persisted invalidation routes to DeviceDiscovery with reason pairing_invalidated', async () => {
    (
      NativeModules.NativeSyncEngine.getBindingInvalidationState as jest.Mock
    ).mockResolvedValue({ reason: 'desktop_reset_code' });

    renderRootNavigator();

    await waitFor(() =>
      expect(screen.getByTestId('device-discovery-screen')).toBeTruthy(),
    );
    expect(screen.getByText(/reason=pairing_invalidated/)).toBeTruthy();
    expect(screen.queryByTestId('sync-activity-screen')).toBeNull();
  });

  test.each([
    { reason: 123 },
    new Date('2026-06-24T00:00:00.000Z'),
    ['desktop_reset_code'],
  ])(
    'cold-start invalid persisted invalidation state falls back to bound default route: %p',
    async invalidation => {
      (
        NativeModules.NativeSyncEngine.getBindingInvalidationState as jest.Mock
      ).mockResolvedValue(invalidation);

      renderRootNavigator();

      await waitFor(() =>
        expect(screen.getByTestId('sync-activity-screen')).toBeTruthy(),
      );
      expect(screen.queryByTestId('device-discovery-screen')).toBeNull();
    },
  );
});
