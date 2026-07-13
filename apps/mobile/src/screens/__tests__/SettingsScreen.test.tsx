import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { SettingsScreen } from '../SettingsScreen';
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
import { shareDiagnosticsArchive } from '../../utils/shareDiagnosticsArchive';

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
  const en = {
    settings: require('../../i18n/locales/en/settings.json'),
    deviceDiscovery: require('../../i18n/locales/en/deviceDiscovery.json'),
    common: require('../../i18n/locales/en/common.json'),
  };
  return {
    useTranslation: () => ({
      i18n: {
        language: 'en',
        resolvedLanguage: 'en',
      },
      t: (key: string, options?: any) => {
        const parts = key.split('.');
        let current: any = en;
        for (const part of parts) {
          if (current == null) return key;
          current = current[part];
        }
        if (typeof current === 'string') {
          if (options) {
            let res = current;
            for (const k of Object.keys(options)) {
              res = res.replace(
                new RegExp(`\\{\\{${k}\\}\\}`, 'g'),
                options[k],
              );
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

jest.mock('../../utils/shareDiagnosticsArchive', () => ({
  shareDiagnosticsArchive: jest
    .fn()
    .mockResolvedValue('/tmp/settings-diagnostics.zip'),
  isDiagnosticsExportUnavailable: jest.fn(() => false),
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
const mockedShareDiagnosticsArchive =
  shareDiagnosticsArchive as jest.MockedFunction<
    typeof shareDiagnosticsArchive
  >;
async function renderSettingsScreen() {
  const screen = render(<SettingsScreen />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return screen;
}

describe('SettingsScreen', () => {
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
      appName: 'Lynavo Drive',
      version: '3.4.5',
      build: '67',
    });
    mockedSaveLanguagePreference.mockResolvedValue(undefined);
    mockedResolveLanguagePreference.mockReturnValue('en');
    mockedChangeLanguage.mockResolvedValue(undefined);
    mockedShareDiagnosticsArchive.mockResolvedValue(
      '/tmp/settings-diagnostics.zip',
    );
  });

  test('renders local device, current desktop, and version without official account rows', async () => {
    const { getByText, queryByText } = await renderSettingsScreen();

    await waitFor(() => expect(getByText('Field iPhone')).toBeTruthy());
    expect(getByText('Edit Bay')).toBeTruthy();
    expect(getByText('Current device - Connected')).toBeTruthy();
    expect(getByText('Version 3.4.5 (67)')).toBeTruthy();

    expect(queryByText('creator@example.com')).toBeNull();
    expect(queryByText('Membership status')).toBeNull();
    expect(queryByText('Sign out')).toBeNull();
    expect(queryByText('Delete account')).toBeNull();
    expect(queryByText('+1 206 **** 1234')).toBeNull();
    expect(queryByText('MacBook Pro')).toBeNull();
    expect(queryByText('Version 2.1.0')).toBeNull();
  });

  test('uses lucide icons instead of legacy ionicon glyph names on the global settings page', async () => {
    const { queryByText } = await renderSettingsScreen();

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

    const { getByText } = await renderSettingsScreen();

    await waitFor(() => expect(getByText('No computer bound')).toBeTruthy());
    expect(getByText('Not connected to any computer')).toBeTruthy();
    expect(getByText('Version --')).toBeTruthy();
  });

  test('keeps content bottom spacing aligned with the reference page padding', async () => {
    const { getByTestId } = await renderSettingsScreen();

    const contentStyle = StyleSheet.flatten(
      getByTestId('settings-scroll').props.contentContainerStyle,
    );

    expect(contentStyle.paddingBottom).toBe(24);
  });

  test('keeps settings OSS-only without account membership, logout, or delete-account actions', async () => {
    const { getByText, queryByTestId, queryByText } =
      await renderSettingsScreen();

    expect(queryByText('Membership status')).toBeNull();
    expect(queryByTestId('settings-logout')).toBeNull();
    expect(queryByTestId('settings-delete-account')).toBeNull();

    fireEvent.press(getByText('Switch Device'));
    expect(mockNavigate).toHaveBeenCalledWith('DeviceDiscovery', {
      mode: 'switch',
    });

    fireEvent.press(getByText('FAQ'));
    expect(mockNavigate).toHaveBeenCalledWith('Help');
  });

  test('exports diagnostics through the local share helper', async () => {
    const { getByText } = await renderSettingsScreen();

    await act(async () => {
      fireEvent.press(getByText('Export Diagnostics'));
    });

    expect(mockedShareDiagnosticsArchive).toHaveBeenCalledTimes(1);
  });

  test('hydrates and persists the device display name through the native bridge', async () => {
    const { getByDisplayValue, getByTestId, getByText, queryByText } =
      await renderSettingsScreen();

    fireEvent.press(getByTestId('settings-edit-device-name'));

    expect(getByText('Edit Device Name')).toBeTruthy();
    fireEvent.changeText(
      getByDisplayValue('Field iPhone'),
      '  Studio iPhone  ',
    );

    await act(async () => {
      fireEvent.press(getByText('Save'));
    });

    expect(mockedSetClientDisplayName).toHaveBeenCalledWith('Studio iPhone');
    expect(getByText('Studio iPhone')).toBeTruthy();
    expect(queryByText('Edit Device Name')).toBeNull();
  });

  test('keeps the edit device modal open when saving the native display name fails', async () => {
    mockedSetClientDisplayName.mockRejectedValueOnce(new Error('bridge down'));
    const { getByDisplayValue, getByTestId, getByText } =
      await renderSettingsScreen();

    fireEvent.press(getByTestId('settings-edit-device-name'));
    fireEvent.changeText(getByDisplayValue('Field iPhone'), 'Studio iPhone');

    await act(async () => {
      fireEvent.press(getByText('Save'));
    });

    expect(getByText('Edit Device Name')).toBeTruthy();
    expect(getByText('Failed to save, please try again later')).toBeTruthy();
    expect(getByText('Field iPhone')).toBeTruthy();
  });

  test('only offers supported global languages and persists selected preference', async () => {
    const { getByText, getByTestId, queryByText } =
      await renderSettingsScreen();

    fireEvent.press(getByTestId('settings-language'));

    expect(getByText('Follow System Language')).toBeTruthy();
    expect(getByText('Select Language Manually')).toBeTruthy();
    fireEvent.press(getByText('Select Language Manually'));

    expect(getByText('Simplified Chinese')).toBeTruthy();
    expect(getByText('Traditional Chinese')).toBeTruthy();
    expect(getByText('English')).toBeTruthy();
    expect(queryByText('Japanese')).toBeNull();
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

    fireEvent.press(getByTestId('language-back'));
    expect(getByText('English')).toBeTruthy();
  });
});
