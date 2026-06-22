import React from 'react';
import { Alert, NativeModules, NativeEventEmitter } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(null),
    removeItem: jest.fn().mockResolvedValue(null),
  },
}));

// IMPORTANT: must be hoisted above the i18n import below — i18n.init reads
// RNLocalize.getLocales() synchronously to pick the initial language.
jest.mock('react-native-localize', () => ({
  getLocales: () => [
    {
      languageCode: 'zh',
      scriptCode: 'Hant',
      countryCode: 'TW',
      languageTag: 'zh-Hant-TW',
      isRTL: false,
    },
  ],
}));

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockDispatch = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    const R = require('react');
    R.useEffect(cb, [cb]);
  },
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    dispatch: mockDispatch,
  }),
  useRoute: () => ({
    params: { mode: 'switch' },
  }),
  CommonActions: {
    reset: jest.fn(payload => ({ type: 'RESET', payload })),
  },
}));

jest.mock('@react-navigation/stack', () => ({}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: any) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../components/Icon', () => ({
  Icon: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));

jest.mock('../../utils/shareDiagnosticsArchive', () => ({
  isDiagnosticsExportUnavailable: jest.fn().mockReturnValue(false),
  shareDiagnosticsArchive: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../utils/onboardingStorage', () => ({
  hasSeenUnconnectedGuide: jest.fn().mockResolvedValue(true),
  markUnconnectedGuideSeen: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../stores/recent-desktops-store', () => ({
  useRecentDesktops: () => ({
    recentDesktops: [],
    isLoading: false,
    addDesktop: jest.fn(),
    forgetDesktop: jest.fn(),
    updateAuthStatus: jest.fn(),
  }),
}));

import i18n from '../../i18n';
import { DeviceDiscoveryScreen } from '../DeviceDiscoveryScreen';

const mockNativeSyncEngine = {
  startDiscovery: jest.fn().mockResolvedValue(undefined),
  stopDiscovery: jest.fn().mockResolvedValue(undefined),
  getKnownDeviceIds: jest.fn().mockResolvedValue([]),
  getBindingState: jest.fn().mockResolvedValue(null),
  pairDevice: jest.fn().mockResolvedValue(undefined),
  addListener: jest.fn(),
  removeListeners: jest.fn(),
};

const mockEmitter = {
  addListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
};

describe('DeviceDiscoveryScreen — switch mode', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('zh-Hant');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Re-prime default resolved values cleared from the mock object's call state.
    mockNativeSyncEngine.startDiscovery.mockResolvedValue(undefined);
    mockNativeSyncEngine.stopDiscovery.mockResolvedValue(undefined);
    mockNativeSyncEngine.getKnownDeviceIds.mockResolvedValue([]);
    mockNativeSyncEngine.getBindingState.mockResolvedValue(null);
    mockNativeSyncEngine.pairDevice.mockResolvedValue(undefined);
    NativeModules.NativeSyncEngine = mockNativeSyncEngine;
    jest
      .spyOn(NativeEventEmitter.prototype, 'addListener')
      .mockImplementation(mockEmitter.addListener as any);
  });

  it('calls getKnownDeviceIds on mount', async () => {
    render(<DeviceDiscoveryScreen />);
    await waitFor(() => {
      expect(mockNativeSyncEngine.getKnownDeviceIds).toHaveBeenCalledTimes(1);
    });
  });

  it('shows back button and keeps manual pairing options available', async () => {
    const { getByText, queryByText } = render(<DeviceDiscoveryScreen />);
    await waitFor(() => {
      expect(getByText('手動配對')).toBeTruthy();
      expect(queryByText('chevron-back')).toBeTruthy();
    });

    fireEvent.press(getByText('手動配對'));

    await waitFor(() => {
      expect(getByText('手動輸入 IP')).toBeTruthy();
      expect(getByText('掃碼配對')).toBeTruthy();
    });
  });

  it('pairs device with connection code and resets to SyncActivity', async () => {
    mockNativeSyncEngine.getKnownDeviceIds.mockResolvedValueOnce(['server-known']);
    mockNativeSyncEngine.getBindingState.mockResolvedValueOnce({ deviceId: 'server-current' });

    const { getByText, getByPlaceholderText, queryByText } = render(
      <DeviceDiscoveryScreen />,
    );

    // Wait for switch-mode bootstrap to settle BEFORE injecting the device
    // event, so handleDevicePress sees the populated knownDeviceIds set.
    await waitFor(() => {
      expect(mockNativeSyncEngine.getKnownDeviceIds).toHaveBeenCalled();
      expect(mockNativeSyncEngine.getBindingState).toHaveBeenCalled();
    });

    const onDiscoveredDevicesChangedCallback = mockEmitter.addListener.mock.calls.find(
      ([event]: [string]) => event === 'onDiscoveredDevicesChanged',
    )?.[1];
    expect(onDiscoveredDevicesChangedCallback).toBeDefined();

    act(() => {
      onDiscoveredDevicesChangedCallback([
        { deviceId: 'server-known', name: 'Studio Mac', ip: '192.168.1.8', port: 39393, type: 'mac' },
      ]);
    });

    await waitFor(() => {
      expect(getByText('Studio Mac')).toBeTruthy();
    });

    fireEvent.press(getByText('Studio Mac'));

    await waitFor(() => {
      expect(getByPlaceholderText('輸入連接碼')).toBeTruthy();
    });
    expect(queryByText('選擇連接方式')).toBeNull();
    expect(queryByText('掃碼連接')).toBeNull();

    fireEvent.changeText(getByPlaceholderText('輸入連接碼'), '123456');
    fireEvent.press(getByText('連接'));

    await waitFor(() => {
      expect(mockNativeSyncEngine.pairDevice).toHaveBeenCalledWith({
        deviceId: 'server-known',
        host: '192.168.1.8',
        port: 39393,
        connectionCode: '123456',
      });
    });
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'RESET',
      payload: {
        index: 0,
        routes: [{ name: 'SyncActivity' }],
      },
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows error when pairing fails', async () => {
    mockNativeSyncEngine.getKnownDeviceIds.mockResolvedValueOnce(['server-known']);
    mockNativeSyncEngine.getBindingState.mockResolvedValueOnce({ deviceId: 'server-current' });
    mockNativeSyncEngine.pairDevice.mockRejectedValueOnce(new Error('PAIR_CODE_REQUIRED'));

    const { getByText, getByPlaceholderText, queryByText } = render(
      <DeviceDiscoveryScreen />,
    );

    await waitFor(() => {
      expect(mockNativeSyncEngine.getKnownDeviceIds).toHaveBeenCalled();
      expect(mockNativeSyncEngine.getBindingState).toHaveBeenCalled();
    });

    const onDiscoveredDevicesChangedCallback = mockEmitter.addListener.mock.calls.find(
      ([event]: [string]) => event === 'onDiscoveredDevicesChanged',
    )?.[1];
    expect(onDiscoveredDevicesChangedCallback).toBeDefined();

    act(() => {
      onDiscoveredDevicesChangedCallback([
        { deviceId: 'server-known', name: 'Studio Mac', ip: '192.168.1.8', port: 39393, type: 'mac' },
      ]);
    });

    await waitFor(() => getByText('Studio Mac'));
    fireEvent.press(getByText('Studio Mac'));

    await waitFor(() => {
      expect(getByPlaceholderText('輸入連接碼')).toBeTruthy();
    });
    expect(queryByText('選擇連接方式')).toBeNull();
    expect(queryByText('掃碼連接')).toBeNull();

    fireEvent.changeText(getByPlaceholderText('輸入連接碼'), '111111');
    fireEvent.press(getByText('連接'));

    await waitFor(() => {
      expect(mockNativeSyncEngine.pairDevice).toHaveBeenCalledWith({
        deviceId: 'server-known',
        host: '192.168.1.8',
        port: 39393,
        connectionCode: '111111',
      });
      // Should show the error message inside the modal
      expect(getByText('PAIR_CODE_REQUIRED')).toBeTruthy();
    });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('pairs unknown device by opening connection code directly', async () => {
    mockNativeSyncEngine.getKnownDeviceIds.mockResolvedValueOnce([]);
    mockNativeSyncEngine.getBindingState.mockResolvedValueOnce(null);

    const { getByText, getByPlaceholderText, queryByText } = render(
      <DeviceDiscoveryScreen />,
    );

    await waitFor(() => {
      expect(mockNativeSyncEngine.getKnownDeviceIds).toHaveBeenCalled();
    });

    const onDiscoveredDevicesChangedCallback = mockEmitter.addListener.mock.calls.find(
      ([event]: [string]) => event === 'onDiscoveredDevicesChanged',
    )?.[1];
    expect(onDiscoveredDevicesChangedCallback).toBeDefined();

    act(() => {
      onDiscoveredDevicesChangedCallback([
        { deviceId: 'server-new', name: 'New PC', ip: '192.168.1.9', port: 39393, type: 'win' },
      ]);
    });

    await waitFor(() => getByText('New PC'));
    fireEvent.press(getByText('New PC'));

    await waitFor(() => {
      expect(getByPlaceholderText('輸入連接碼')).toBeTruthy();
    });
    expect(queryByText('選擇連接方式')).toBeNull();
    expect(queryByText('掃碼連接')).toBeNull();

    fireEvent.changeText(getByPlaceholderText('輸入連接碼'), '654321');
    fireEvent.press(getByText('連接'));

    await waitFor(() => {
      expect(mockNativeSyncEngine.pairDevice).toHaveBeenCalledWith({
        deviceId: 'server-new',
        host: '192.168.1.9',
        port: 39393,
        connectionCode: '654321',
      });
    });
  });

  it('shows alert when tapping current device', async () => {
    mockNativeSyncEngine.getKnownDeviceIds.mockResolvedValueOnce(['server-current']);
    mockNativeSyncEngine.getBindingState.mockResolvedValueOnce({ deviceId: 'server-current' });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const { getByText } = render(<DeviceDiscoveryScreen />);

    await waitFor(() => {
      expect(mockNativeSyncEngine.getKnownDeviceIds).toHaveBeenCalled();
      expect(mockNativeSyncEngine.getBindingState).toHaveBeenCalled();
    });

    const onDiscoveredDevicesChangedCallback = mockEmitter.addListener.mock.calls.find(
      ([event]: [string]) => event === 'onDiscoveredDevicesChanged',
    )?.[1];
    expect(onDiscoveredDevicesChangedCallback).toBeDefined();

    act(() => {
      onDiscoveredDevicesChangedCallback([
        { deviceId: 'server-current', name: 'My Mac', ip: '192.168.1.5', port: 39393, type: 'mac' },
      ]);
    });

    await waitFor(() => getByText('My Mac'));
    fireEvent.press(getByText('My Mac'));

    expect(mockNativeSyncEngine.pairDevice).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    // Alert.alert(title) — title contains the toast text "已是當前連接設備".
    // RN Alert is used here as a cross-platform stand-in for a transient toast;
    // see plan note in Task 5 / Spec → "toast vs Alert" decision.
    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('當前'));
  });
});
