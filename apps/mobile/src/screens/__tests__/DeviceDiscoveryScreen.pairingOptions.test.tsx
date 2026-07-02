import React from 'react';
import {
  Alert,
  NativeEventEmitter,
  NativeModules,
  Platform,
} from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

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

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    const R = require('react');
    R.useEffect(cb, [cb]);
  },
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: jest.fn(),
    dispatch: jest.fn(),
  }),
  useRoute: () => ({
    params: { mode: 'initial' },
  }),
  CommonActions: {
    reset: jest.fn(payload => ({ type: 'RESET', payload })),
  },
}));

jest.mock('@react-navigation/stack', () => ({}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../components/Icon', () => ({
  Icon: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));

const mockShareDiagnosticsArchive = jest.fn();
jest.mock('../../utils/shareDiagnosticsArchive', () => ({
  shareDiagnosticsArchive: () => mockShareDiagnosticsArchive(),
  isDiagnosticsExportUnavailable: jest.fn(() => false),
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
  getClientId: jest.fn().mockResolvedValue('mobile-client-id'),
  addListener: jest.fn(),
  removeListeners: jest.fn(),
};

describe('DeviceDiscoveryScreen pairing options', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockShareDiagnosticsArchive.mockResolvedValue(
      '/tmp/discovery-diagnostics.zip',
    );
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'ios',
    });
    NativeModules.NativeSyncEngine = mockNativeSyncEngine;
    jest
      .spyOn(NativeEventEmitter.prototype, 'addListener')
      .mockReturnValue({ remove: jest.fn() } as any);
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  it('opens the v0-style manual IP pairing sheet from the pairing menu', async () => {
    const { getByText, queryByText } = render(<DeviceDiscoveryScreen />);

    fireEvent.press(getByText('Manual Pairing'));

    await waitFor(() => {
      expect(getByText('Enter IP Manually')).toBeTruthy();
      expect(getByText('Scan QR Code')).toBeTruthy();
    });

    fireEvent.press(getByText('Enter IP Manually'));

    await waitFor(() => {
      expect(getByText('Where do I find the code and IP?')).toBeTruthy();
      expect(
        getByText(
          'Open Lynavo Drive on your computer, choose Global Settings from the sidebar, then check the 6-digit code, device IP, or QR code.',
        ),
      ).toBeTruthy();
    });
    expect(queryByText('Scan QR Code')).toBeNull();
  });

  it('shows the full pairing popover before the manual IP sheet on Android', async () => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'android',
    });

    const { getByText, queryByText } = render(<DeviceDiscoveryScreen />);

    fireEvent.press(getByText('Manual Pairing'));

    await waitFor(() => {
      expect(getByText('Enter IP Manually')).toBeTruthy();
      expect(getByText('Scan QR Code')).toBeTruthy();
      expect(getByText('Export diagnostics')).toBeTruthy();
    });
    expect(queryByText('Where do I find the code and IP?')).toBeNull();

    fireEvent.press(getByText('Enter IP Manually'));

    await waitFor(() => {
      expect(getByText('Where do I find the code and IP?')).toBeTruthy();
    });
  });

  it('exports diagnostics from the pairing popover on iOS', async () => {
    const { getByText } = render(<DeviceDiscoveryScreen />);

    fireEvent.press(getByText('Manual Pairing'));
    await waitFor(() => expect(getByText('Export diagnostics')).toBeTruthy());

    fireEvent.press(getByText('Export diagnostics'));

    await waitFor(() => {
      expect(mockShareDiagnosticsArchive).toHaveBeenCalledTimes(1);
    });
  });

  it('exports diagnostics from the pairing popover on Android', async () => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'android',
    });

    const { getByText } = render(<DeviceDiscoveryScreen />);

    fireEvent.press(getByText('Manual Pairing'));
    await waitFor(() => expect(getByText('Export diagnostics')).toBeTruthy());

    fireEvent.press(getByText('Export diagnostics'));

    await waitFor(() => {
      expect(mockShareDiagnosticsArchive).toHaveBeenCalledTimes(1);
    });
  });

  it('navigates to QRScanner from the scan pairing option', async () => {
    const { getByText } = render(<DeviceDiscoveryScreen />);

    fireEvent.press(getByText('Manual Pairing'));
    await waitFor(() => expect(getByText('Scan QR Code')).toBeTruthy());
    fireEvent.press(getByText('Scan QR Code'));

    expect(mockNavigate).toHaveBeenCalledWith('QRScanner');
  });

  it('shows the troubleshooting card and opens the connection tutorial', async () => {
    const { getByText } = render(<DeviceDiscoveryScreen />);

    const onDiscoveredDevicesChangedCallback = (
      NativeEventEmitter.prototype.addListener as jest.Mock
    ).mock.calls.find(
      ([event]: [string]) => event === 'onDiscoveredDevicesChanged',
    )?.[1];
    expect(onDiscoveredDevicesChangedCallback).toBeDefined();

    act(() => {
      onDiscoveredDevicesChangedCallback([
        {
          deviceId: 'studio-mac',
          name: 'Studio Mac',
          ip: '192.168.1.8',
          port: 39393,
          type: 'mac',
        },
      ]);
    });

    await waitFor(() => {
      expect(
        getByText("Can't find a device or not sure how to connect?"),
      ).toBeTruthy();
      expect(getByText('View full illustrated tutorial >')).toBeTruthy();
    });

    fireEvent.press(getByText('View full illustrated tutorial >'));

    expect(mockNavigate).toHaveBeenCalledWith('ConnectionTutorial');
  });
});
