import React from 'react';
import { fireEvent, render, act } from '@testing-library/react-native';
import { NativeModules } from 'react-native';

const mockNavigate = jest.fn();
const mockDispatch = jest.fn();
const mockGoBack = jest.fn();
const mockUseRoute = jest.fn();

const defaultRouteParams = {
  deviceId: 'device-1',
  host: '192.168.1.8',
  port: 39393,
  deviceName: 'Studio Mac',
};

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
    goBack: mockGoBack,
    dispatch: mockDispatch,
    navigate: mockNavigate,
  }),
  useRoute: () => mockUseRoute(),
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

function pairingNativeError(
  code: string,
  message: string,
  userInfo?: Record<string, unknown>,
) {
  return {
    code,
    message,
    userInfo,
  };
}

async function renderPrefilledPairingFailure(error: unknown) {
  const mockPairDevice = jest.fn().mockRejectedValueOnce(error);
  NativeModules.NativeSyncEngine = {
    pairDevice: mockPairDevice,
  };
  mockUseRoute.mockReturnValue({
    params: {
      ...defaultRouteParams,
      prefilledCode: '123456',
    },
  });

  const result = render(<CodeVerifyScreen />);

  await act(async () => {
    await new Promise<void>(resolve => setTimeout(resolve, 600));
  });

  expect(mockPairDevice).toHaveBeenCalledWith({
    deviceId: 'device-1',
    host: '192.168.1.8',
    port: 39393,
    connectionCode: '123456',
  });

  return result;
}

describe('CodeVerifyScreen', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('zh-Hant');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    NativeModules.NativeSyncEngine = undefined;
    mockUseRoute.mockReturnValue({
      params: defaultRouteParams,
    });
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    NativeModules.NativeSyncEngine = undefined;
    jest.restoreAllMocks();
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

  it('shows remaining attempts when pairDevice rejects with PAIRING_CODE_INVALID metadata', async () => {
    const { getByText } = await renderPrefilledPairingFailure(
      pairingNativeError(
        'PAIRING_CODE_INVALID',
        'Pairing code invalid',
        {
          failedAttempts: 3,
          remainingAttempts: 2,
          maxAttempts: 5,
        },
      ),
    );

    expect(getByText('連接碼錯誤，還可嘗試 2 次')).toBeTruthy();
  });

  it('shows permanent blocked guidance when pairDevice rejects with PAIRING_CLIENT_BLOCKED', async () => {
    const { getByText } = await renderPrefilledPairingFailure(
      pairingNativeError(
        'PAIRING_CLIENT_BLOCKED',
        'Client blocked',
        {
          failedAttempts: 5,
          remainingAttempts: 0,
          maxAttempts: 5,
        },
      ),
    );

    expect(
      getByText(
        '這台手機已被此電腦封鎖，請在電腦端解除後再試',
      ),
    ).toBeTruthy();
  });

  it('does not show remaining-attempt wrong-code copy for PAIR_TOKEN_INVALID', async () => {
    const { getByText, queryByText } = await renderPrefilledPairingFailure(
      pairingNativeError(
        'PAIR_TOKEN_INVALID',
        'Pairing token invalid',
        {
          remainingAttempts: 2,
          maxAttempts: 5,
        },
      ),
    );

    expect(getByText('連接已失效，請重新輸入電腦端連接碼')).toBeTruthy();
    expect(queryByText('連接碼錯誤，還可嘗試 2 次')).toBeNull();
  });

  it('triggers Alert.alert when pairDevice throws APP_VERSION_INCOMPATIBLE', async () => {
    const { Alert, NativeModules } = require('react-native');
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const mockPairDevice = jest.fn().mockRejectedValueOnce(
      pairingNativeError('APP_VERSION_INCOMPATIBLE', 'version mismatch'),
    );
    NativeModules.NativeSyncEngine = {
      pairDevice: mockPairDevice,
    };
    mockUseRoute.mockReturnValue({
      params: {
        ...defaultRouteParams,
        prefilledCode: '123456',
      },
    });

    render(<CodeVerifyScreen />);

    // Wait for the deferred submitCode timer (500ms) to fire
    await act(async () => {
      await new Promise<void>(resolve => setTimeout(resolve, 600));
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
  });
});
