import React from 'react';
import {
  Alert,
  Clipboard,
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

const mockUploadDiagnostics = jest.fn();
jest.mock('../../services/diagnostic-upload-service', () => {
  class DiagnosticUploadError extends Error {
    readonly detail: { kind: string; status?: number };
    constructor(detail: { kind: string; status?: number }) {
      super(detail.kind);
      this.detail = detail;
      this.name = 'DiagnosticUploadError';
    }
  }
  return {
    DiagnosticUploadError,
    diagnosticUploadService: {
      upload: (...args: unknown[]) => mockUploadDiagnostics(...args),
    },
  };
});

jest.mock('../../utils/onboardingStorage', () => ({
  hasSeenUnconnectedGuide: jest.fn().mockResolvedValue(true),
  markUnconnectedGuideSeen: jest.fn().mockResolvedValue(undefined),
}));

import i18n from '../../i18n';
import { DeviceDiscoveryScreen } from '../DeviceDiscoveryScreen';

const mockNativeSyncEngine = {
  startDiscovery: jest.fn().mockResolvedValue(undefined),
  stopDiscovery: jest.fn().mockResolvedValue(undefined),
  exportDiagnostics: jest
    .fn()
    .mockResolvedValue('/tmp/discovery-diagnostics.zip'),
  getClientId: jest.fn().mockResolvedValue('mobile-client-id'),
  addListener: jest.fn(),
  removeListeners: jest.fn(),
};

describe('DeviceDiscoveryScreen pairing options', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('zh-Hant');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockUploadDiagnostics.mockResolvedValue({
      refId: 'DISC1234',
      uploadedAt: '2026-05-07T12:00:00.000Z',
    });
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'ios',
    });
    NativeModules.NativeSyncEngine = mockNativeSyncEngine;
    jest
      .spyOn(NativeEventEmitter.prototype, 'addListener')
      .mockReturnValue({ remove: jest.fn() } as any);
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    (Alert as typeof Alert & { prompt: jest.Mock }).prompt = jest.fn();
    jest.spyOn(Clipboard, 'setString').mockImplementation(() => undefined);
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

  it('shows the full pairing popover before the manual IP sheet on Android', async () => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'android',
    });

    const { getByText, queryByText } = render(<DeviceDiscoveryScreen />);

    fireEvent.press(getByText('手動配對'));

    await waitFor(() => {
      expect(getByText('手動輸入 IP')).toBeTruthy();
      expect(getByText('掃碼配對')).toBeTruthy();
      expect(getByText('上傳診斷包')).toBeTruthy();
    });
    expect(queryByText('去哪裡找連接碼和 IP？')).toBeNull();

    fireEvent.press(getByText('手動輸入 IP'));

    await waitFor(() => {
      expect(getByText('去哪裡找連接碼和 IP？')).toBeTruthy();
    });
  });

  it('prompts for a diagnostic note before uploading from the pairing popover on iOS', async () => {
    const { getByText } = render(<DeviceDiscoveryScreen />);

    fireEvent.press(getByText('手動配對'));
    await waitFor(() => expect(getByText('上傳診斷包')).toBeTruthy());

    fireEvent.press(getByText('上傳診斷包'));

    await waitFor(() => {
      expect(Alert.prompt).toHaveBeenCalledWith(
        '上傳診斷包',
        expect.stringContaining('請簡述你遇到的問題'),
        expect.any(Array),
        'plain-text',
        '',
      );
    });

    const promptButtons = (Alert.prompt as jest.Mock).mock.calls[0][2] as Array<{
      text: string;
      onPress?: (note?: string) => void;
    }>;
    const continueButton = promptButtons.find(button => button.text === '繼續');
    expect(continueButton?.onPress).toBeDefined();

    await act(async () => {
      continueButton?.onPress?.('  搜尋設備頁上傳卡住  ');
    });

    await waitFor(() => {
      expect(mockNativeSyncEngine.exportDiagnostics).toHaveBeenCalled();
      expect(mockNativeSyncEngine.getClientId).toHaveBeenCalled();
      expect(mockUploadDiagnostics).toHaveBeenCalledWith(
        'file:///tmp/discovery-diagnostics.zip',
        'mobile-client-id',
        expect.any(AbortSignal),
        expect.any(Function),
        '搜尋設備頁上傳卡住',
      );
    });
    expect(Clipboard.setString).toHaveBeenCalledWith('DISC1234');
  });

  it('shows a diagnostic note modal before uploading from the pairing popover on Android', async () => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'android',
    });

    const { getByPlaceholderText, getByText } = render(<DeviceDiscoveryScreen />);

    fireEvent.press(getByText('手動配對'));
    await waitFor(() => expect(getByText('上傳診斷包')).toBeTruthy());

    fireEvent.press(getByText('上傳診斷包'));

    const noteInput = await waitFor(() =>
      getByPlaceholderText('例如：上傳卡在 30%'),
    );
    fireEvent.changeText(noteInput, '  Android 找不到設備  ');

    await act(async () => {
      fireEvent.press(getByText('繼續'));
    });

    await waitFor(() => {
      expect(Alert.prompt).not.toHaveBeenCalled();
      expect(mockNativeSyncEngine.exportDiagnostics).toHaveBeenCalled();
      expect(mockUploadDiagnostics).toHaveBeenCalledWith(
        'file:///tmp/discovery-diagnostics.zip',
        'mobile-client-id',
        expect.any(AbortSignal),
        expect.any(Function),
        'Android 找不到設備',
      );
    });
    expect(Clipboard.setString).toHaveBeenCalledWith('DISC1234');
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
