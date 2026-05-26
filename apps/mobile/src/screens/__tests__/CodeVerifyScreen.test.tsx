import React from 'react';
import { fireEvent, render, act } from '@testing-library/react-native';

const mockNavigate = jest.fn();

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

jest.mock('@react-navigation/native', () => ({
  CommonActions: {
    reset: jest.fn(payload => ({ type: 'RESET', payload })),
  },
  useNavigation: () => ({
    canGoBack: jest.fn(() => true),
    goBack: jest.fn(),
    dispatch: jest.fn(),
    navigate: mockNavigate,
  }),
  useRoute: () => ({
    params: {
      deviceId: 'device-1',
      host: '192.168.1.8',
      port: 39393,
      deviceName: 'Studio Mac',
    },
  }),
}));

jest.mock('@react-navigation/stack', () => ({}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('../../components/Icon', () => ({
  Icon: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));

import i18n from '../../i18n';
import { CodeVerifyScreen } from '../CodeVerifyScreen';

describe('CodeVerifyScreen', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('zh-Hant');
  });

  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it('renders the complete v0-style pairing-code help card', () => {
    const { getByText } = render(<CodeVerifyScreen />);

    expect(getByText('去哪裡找連接碼？')).toBeTruthy();
    expect(
      getByText(
        '請在電腦端 Vivi Drop 左側導覽列點擊「全域設定」，即可查看 6 位數字連接碼。',
      ),
    ).toBeTruthy();
    expect(
      getByText('連接碼不會自動刷新，需手動點擊「重新產生」才會更新。'),
    ).toBeTruthy();
    expect(getByText('示例')).toBeTruthy();
    expect(getByText('3')).toBeTruthy();
    expect(getByText('8')).toBeTruthy();
    expect(getByText('5')).toBeTruthy();
    expect(getByText('2')).toBeTruthy();
    expect(getByText('1')).toBeTruthy();
    expect(getByText('7')).toBeTruthy();
    expect(getByText('查看詳細圖文教學 >')).toBeTruthy();
  });

  it('opens the detailed connection tutorial from the help card', () => {
    const { getByText } = render(<CodeVerifyScreen />);

    fireEvent.press(getByText('查看詳細圖文教學 >'));

    expect(mockNavigate).toHaveBeenCalledWith('ConnectionTutorial');
  });

  it('triggers Alert.alert when pairDevice throws APP_VERSION_INCOMPATIBLE', async () => {
    const { Alert, NativeModules } = require('react-native');
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const mockPairDevice = jest.fn().mockRejectedValueOnce(
      new Error('APP_VERSION_INCOMPATIBLE: version mismatch')
    );
    NativeModules.NativeSyncEngine = {
      pairDevice: mockPairDevice,
    };

    const nav = require('@react-navigation/native');
    jest.spyOn(nav, 'useRoute').mockReturnValue({
      params: {
        deviceId: 'device-1',
        host: '192.168.1.8',
        port: 39393,
        deviceName: 'Studio Mac',
        prefilledCode: '123456',
      },
    });

    render(<CodeVerifyScreen />);

    // Wait for the deferred submitCode timer (500ms) to fire
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 600));
    });

    expect(mockPairDevice).toHaveBeenCalledWith({
      deviceId: 'device-1',
      host: '192.168.1.8',
      port: 39393,
      connectionCode: '123456',
    });
    expect(alertSpy).toHaveBeenCalledWith(
      '版本不相容',
      '手機與電腦端的版本不相容，請將電腦端（桌面端）App 更新至最新版本後再試。',
      [{ text: '好' }]
    );
    
    alertSpy.mockRestore();
  });
});
