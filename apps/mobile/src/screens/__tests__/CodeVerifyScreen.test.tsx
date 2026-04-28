import React from 'react';
import { render } from '@testing-library/react-native';

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

  it('renders the complete v0-style pairing-code help card', () => {
    const { getByText } = render(<CodeVerifyScreen />);

    expect(getByText('去哪裡找連接碼？')).toBeTruthy();
    expect(
      getByText('請在電腦端 Vivi Drop 左側導覽列點擊「全域設定」，即可查看 6 位數字連接碼。'),
    ).toBeTruthy();
    expect(
      getByText('連接碼不會自動刷新，需手動點擊「重新產生」才會更新。'),
    ).toBeTruthy();
    expect(getByText('示例')).toBeTruthy();
  });
});
