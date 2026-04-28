import React from 'react';
import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
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

jest.mock('../../utils/shareDiagnosticsArchive', () => ({
  isDiagnosticsExportUnavailable: jest.fn().mockReturnValue(false),
  shareDiagnosticsArchive: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../utils/onboardingStorage', () => ({
  hasSeenUnconnectedGuide: jest.fn().mockResolvedValue(true),
  markUnconnectedGuideSeen: jest.fn().mockResolvedValue(undefined),
}));

import i18n from '../../i18n';
import { DeviceDiscoveryScreen } from '../DeviceDiscoveryScreen';

const mockNativeSyncEngine = {
  startDiscovery: jest.fn().mockResolvedValue(undefined),
  stopDiscovery: jest.fn().mockResolvedValue(undefined),
  addListener: jest.fn(),
  removeListeners: jest.fn(),
};

describe('DeviceDiscoveryScreen pairing options', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('zh-Hant');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'ios',
    });
    NativeModules.NativeSyncEngine = mockNativeSyncEngine;
    jest
      .spyOn(NativeEventEmitter.prototype, 'addListener')
      .mockReturnValue({ remove: jest.fn() } as any);
  });

  it('opens the v0-style manual IP pairing sheet from the pairing menu', async () => {
    const { getByText, queryByText } = render(<DeviceDiscoveryScreen />);

    fireEvent.press(getByText('手動配對'));

    await waitFor(() => {
      expect(getByText('手動輸入 IP')).toBeTruthy();
      expect(getByText('掃碼配對')).toBeTruthy();
    });

    fireEvent.press(getByText('手動輸入 IP'));

    await waitFor(() => {
      expect(getByText('去哪裡找連接碼和 IP？')).toBeTruthy();
      expect(
        getByText('請在電腦端 Vivi Drop 左側導覽列點擊「全域設定」，即可查看 6 位連接碼、設備 IP 或顯示二維碼。'),
      ).toBeTruthy();
    });
    expect(queryByText('掃碼配對')).toBeNull();
  });

  it('navigates to QRScanner from the scan pairing option', async () => {
    const { getByText } = render(<DeviceDiscoveryScreen />);

    fireEvent.press(getByText('手動配對'));
    await waitFor(() => expect(getByText('掃碼配對')).toBeTruthy());
    fireEvent.press(getByText('掃碼配對'));

    expect(mockNavigate).toHaveBeenCalledWith('QRScanner');
  });

  it('shows the troubleshooting card and opens the connection tutorial', async () => {
    const { getByText } = render(<DeviceDiscoveryScreen />);

    const onDiscoveredDevicesChangedCallback = (
      NativeEventEmitter.prototype.addListener as jest.Mock
    ).mock.calls.find(([event]: [string]) => event === 'onDiscoveredDevicesChanged')?.[1];
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
      expect(getByText('找不到設備或不知道怎麼連？')).toBeTruthy();
      expect(getByText('查看詳細圖文教程 >')).toBeTruthy();
    });

    fireEvent.press(getByText('查看詳細圖文教程 >'));

    expect(mockNavigate).toHaveBeenCalledWith('ConnectionTutorial');
  });
});
