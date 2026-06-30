import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { SettingsGlobalScreen } from '../SettingsGlobalScreen';
import {
  getAppInfo,
  getBindingState,
  getClientDisplayName,
  setClientDisplayName,
} from '../../services/SyncEngineModule';
import {
  resolveLanguagePreference,
  saveLanguagePreference,
} from '../../i18n/language-preference';
import i18n from '../../i18n';

jest.mock('react-native-localize', () => ({
  getLocales: jest.fn(() => [
    {
      languageCode: 'en',
      scriptCode: undefined,
      countryCode: 'US',
      languageTag: 'en-US',
      isRTL: false,
    },
  ]),
}));

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
  }),
}));

jest.mock('react-i18next', () => {
  const zhHans = {
    settings: require('../../i18n/locales/zh-Hans/settings.json'),
    deviceDiscovery: require('../../i18n/locales/zh-Hans/deviceDiscovery.json'),
    common: require('../../i18n/locales/zh-Hans/common.json'),
  };
  return {
    useTranslation: () => ({
      i18n: {
        language: 'zh-Hans',
        resolvedLanguage: 'zh-Hans',
      },
      t: (key: string, options?: any) => {
        const parts = key.split('.');
        let current: any = zhHans;
        for (const part of parts) {
          if (current == null) return key;
          current = current[part];
        }
        if (typeof current === 'string') {
          if (options) {
            let res = current;
            for (const k of Object.keys(options)) {
              res = res.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), options[k]);
            }
            return res;
          }
          return current;
        }
        return key;
      },
    }),
  };
});

jest.mock('../../services/SyncEngineModule', () => ({
  getBindingState: jest.fn(),
  getClientDisplayName: jest.fn(),
  setClientDisplayName: jest.fn(),
  getAppInfo: jest.fn(),
}));

jest.mock('../../i18n/language-preference', () => ({
  loadStoredLanguagePreference: jest.fn().mockResolvedValue('system'),
  resolveLanguagePreference: jest.fn().mockReturnValue('en'),
  saveLanguagePreference: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../i18n', () => ({
  __esModule: true,
  default: {
    changeLanguage: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../components/Icon', () => ({
  Icon: ({ name }: { name: string }) => {
    const ReactInner = require('react');
    const { Text } = require('react-native');
    return ReactInner.createElement(Text, null, name);
  },
}));

jest.mock('lucide-react-native', () => {
  const ReactInner = require('react');
  const { View } = require('react-native');
  const createIcon =
    (fallbackTestID: string) =>
    ({ testID, ...props }: { testID?: string }) =>
      ReactInner.createElement(View, {
        testID: testID ?? fallbackTestID,
        ...props,
      });
  return {
    ArrowUpToLine: createIcon('mock-arrow-up-to-line-icon'),
    Check: createIcon('mock-check-icon'),
    ChevronLeft: createIcon('mock-chevron-left-icon'),
    ChevronRight: createIcon('mock-chevron-right-icon'),
    FolderOpen: createIcon('mock-folder-open-icon'),
    HelpCircle: createIcon('mock-help-circle-icon'),
    Home: createIcon('mock-home-icon'),
    Laptop: createIcon('mock-laptop-icon'),
    Languages: createIcon('mock-languages-icon'),
    MessageSquare: createIcon('mock-message-square-icon'),
    Monitor: createIcon('mock-monitor-icon'),
    Pencil: createIcon('mock-pencil-icon'),
    RefreshCw: createIcon('mock-refresh-cw-icon'),
    Smartphone: createIcon('mock-smartphone-icon'),
    User: createIcon('mock-user-icon'),
  };
});

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

const mockedGetBindingState = getBindingState as jest.MockedFunction<
  typeof getBindingState
>;
const mockedGetClientDisplayName = getClientDisplayName as jest.MockedFunction<
  typeof getClientDisplayName
>;
const mockedSetClientDisplayName = setClientDisplayName as jest.MockedFunction<
  typeof setClientDisplayName
>;
const mockedGetAppInfo = getAppInfo as jest.MockedFunction<typeof getAppInfo>;
const mockedSaveLanguagePreference =
  saveLanguagePreference as jest.MockedFunction<typeof saveLanguagePreference>;
const mockedResolveLanguagePreference =
  resolveLanguagePreference as jest.MockedFunction<
    typeof resolveLanguagePreference
  >;
const mockedChangeLanguage = i18n.changeLanguage as jest.Mock;
async function renderSettingsGlobalScreen() {
  const screen = render(<SettingsGlobalScreen />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return screen;
}

describe('SettingsGlobalScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetBindingState.mockResolvedValue({
      deviceId: 'desktop-1',
      deviceName: 'Studio Mac',
      deviceAlias: 'Edit Bay',
      host: '192.168.1.20',
      port: 39393,
      connectionState: 'connected',
      pairingId: 'pairing-1',
      shareEnabled: true,
      lastBoundAt: '2026-06-16T00:00:00.000Z',
    });
    mockedGetClientDisplayName.mockResolvedValue('Field iPhone');
    mockedSetClientDisplayName.mockResolvedValue(undefined);
    mockedGetAppInfo.mockResolvedValue({
      appName: 'Vivi Drop',
      version: '3.4.5',
      build: '67',
    });
    mockedSaveLanguagePreference.mockResolvedValue(undefined);
    mockedResolveLanguagePreference.mockReturnValue('en');
    mockedChangeLanguage.mockResolvedValue(undefined);
  });

  test('renders local device, current desktop, and version without official account rows', async () => {
    const { getByText, queryByText } = await renderSettingsGlobalScreen();

    await waitFor(() => expect(getByText('Field iPhone')).toBeTruthy());
    expect(getByText('Edit Bay')).toBeTruthy();
    expect(getByText('当前设备 · 已连接')).toBeTruthy();
    expect(getByText('版本 3.4.5 (67)')).toBeTruthy();

    expect(queryByText('creator@example.com')).toBeNull();
    expect(queryByText('会员状态')).toBeNull();
    expect(queryByText('退出登录')).toBeNull();
    expect(queryByText('注销账号')).toBeNull();
    expect(queryByText('+1 206 **** 1234')).toBeNull();
    expect(queryByText('Pro Annual · 剩余 28 天')).toBeNull();
    expect(queryByText('MacBook Pro')).toBeNull();
    expect(queryByText('版本 2.1.0')).toBeNull();
  });

  test('uses lucide icons instead of legacy ionicon glyph names on the global settings page', async () => {
    const { queryByText } = await renderSettingsGlobalScreen();

    [
      'person-outline',
      'crown-outline',
      'refresh-outline',
      'phone-portrait-outline',
      'pencil-outline',
      'laptop-outline',
      'desktop-outline',
      'language-outline',
      'help-circle-outline',
      'message-square-outline',
      'cloud-upload-outline',
      'log-out-outline',
      'trash-outline',
      'chevron-forward',
    ].forEach(name => {
      expect(queryByText(name)).toBeNull();
    });
  });

  test('falls back to neutral desktop and version labels when bridge state is unavailable', async () => {
    mockedGetBindingState.mockResolvedValueOnce(null);
    mockedGetAppInfo.mockResolvedValueOnce(null);

    const { getByText } = await renderSettingsGlobalScreen();

    await waitFor(() => expect(getByText('未绑定电脑')).toBeTruthy());
    expect(getByText('尚未连接任何电脑')).toBeTruthy();
    expect(getByText('版本 --')).toBeTruthy();
  });

  test('keeps content bottom spacing aligned with the reference page padding', async () => {
    const { getByTestId } = await renderSettingsGlobalScreen();

    const contentStyle = StyleSheet.flatten(
      getByTestId('global-settings-scroll').props.contentContainerStyle,
    );

    expect(contentStyle.paddingBottom).toBe(24);
  });

  test('keeps settings OSS-only without purchase, membership, logout, or delete-account actions', async () => {
    const { getByText, queryByTestId, queryByText } =
      await renderSettingsGlobalScreen();

    expect(mockNavigate).not.toHaveBeenCalledWith('Subscription');
    expect(queryByText('会员状态')).toBeNull();
    expect(queryByTestId('global-settings-logout')).toBeNull();
    expect(queryByTestId('global-settings-delete-account')).toBeNull();
    expect(queryByTestId('global-settings-restore-purchase')).toBeNull();
    expect(queryByText('恢复购买')).toBeNull();

    fireEvent.press(getByText('切换设备'));
    expect(mockNavigate).toHaveBeenCalledWith('DeviceDiscovery', {
      mode: 'switch',
    });

    fireEvent.press(getByText('常见问题'));
    expect(mockNavigate).toHaveBeenCalledWith('Help');
  });

  test('hydrates and persists the device display name through the native bridge', async () => {
    const { getByDisplayValue, getByTestId, getByText, queryByText } =
      await renderSettingsGlobalScreen();

    fireEvent.press(getByTestId('global-settings-edit-device-name'));

    expect(getByText('编辑设备名称')).toBeTruthy();
    fireEvent.changeText(
      getByDisplayValue('Field iPhone'),
      '  Studio iPhone  ',
    );

    await act(async () => {
      fireEvent.press(getByText('保存'));
    });

    expect(mockedSetClientDisplayName).toHaveBeenCalledWith('Studio iPhone');
    expect(getByText('Studio iPhone')).toBeTruthy();
    expect(queryByText('编辑设备名称')).toBeNull();
  });

  test('keeps the edit device modal open when saving the native display name fails', async () => {
    mockedSetClientDisplayName.mockRejectedValueOnce(new Error('bridge down'));
    const { getByDisplayValue, getByTestId, getByText } =
      await renderSettingsGlobalScreen();

    fireEvent.press(getByTestId('global-settings-edit-device-name'));
    fireEvent.changeText(getByDisplayValue('Field iPhone'), 'Studio iPhone');

    await act(async () => {
      fireEvent.press(getByText('保存'));
    });

    expect(getByText('编辑设备名称')).toBeTruthy();
    expect(getByText('保存失败，请稍后重试')).toBeTruthy();
    expect(getByText('Field iPhone')).toBeTruthy();
  });

  test('only offers supported global languages and persists selected preference', async () => {
    const { getByText, getByTestId, queryByText } =
      await renderSettingsGlobalScreen();

    fireEvent.press(getByTestId('global-settings-language'));

    expect(getByText('跟随系统语言')).toBeTruthy();
    expect(getByText('手动选择语言')).toBeTruthy();
    fireEvent.press(getByText('手动选择语言'));

    expect(getByText('简体中文')).toBeTruthy();
    expect(getByText('繁体中文')).toBeTruthy();
    expect(getByText('English')).toBeTruthy();
    expect(queryByText('日本語')).toBeNull();
    expect(queryByText('한국어')).toBeNull();
    expect(queryByText('Français')).toBeNull();
    expect(queryByText('Español')).toBeNull();
    expect(queryByText('Русский')).toBeNull();

    await act(async () => {
      fireEvent.press(getByText('English'));
    });

    expect(mockedSaveLanguagePreference).toHaveBeenCalledWith('en');
    expect(mockedResolveLanguagePreference).toHaveBeenCalledWith(
      'en',
      expect.any(Array),
    );
    expect(mockedChangeLanguage).toHaveBeenCalledWith('en');

    fireEvent.press(getByTestId('global-language-back'));
    expect(getByText('English')).toBeTruthy();
  });

});
