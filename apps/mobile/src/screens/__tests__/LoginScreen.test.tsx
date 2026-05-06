import React from 'react';
import { Alert, StyleSheet } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactTestRendererJSON } from 'react-test-renderer';

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
  useNavigation: () => ({
    navigate: mockNavigate,
  }),
}));

jest.mock('@react-navigation/stack', () => ({}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
  },
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
  resetGenericPassword: jest.fn(),
}));

jest.mock('../../components/Icon', () => ({
  Icon: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));

jest.mock('../../components/auth/AuthScreenShell', () => ({
  AUTH_COLORS: {
    primary: '#3b9fd8',
    textMuted: '#7893ab',
    textFaint: '#8eaac0',
  },
  AuthScreenShell: ({ children }: { children: React.ReactNode }) => children,
}));

const mockAuth = {
  signedOutTransition: null as null | 'session_replaced',
};

jest.mock('../../stores/auth-store', () => ({
  useAuth: () => mockAuth,
}));

const mockSendSmsCode = jest.fn();

jest.mock('../../services/auth-service', () => ({
  sendSmsCode: (phone: string) => mockSendSmsCode(phone),
}));

import i18n from '../../i18n';
import { LoginScreen } from '../LoginScreen';
import { ApiError, ERROR_CODE } from '../../services/api';

function collectBackgroundColors(
  node: ReactTestRendererJSON | ReactTestRendererJSON[] | null,
): string[] {
  if (!node) {
    return [];
  }

  if (Array.isArray(node)) {
    return node.flatMap(child => collectBackgroundColors(child));
  }

  const style = StyleSheet.flatten(node.props.style);
  const ownColor =
    style && typeof style.backgroundColor === 'string'
      ? [style.backgroundColor]
      : [];
  const childColors = (node.children ?? []).flatMap(child =>
    typeof child === 'string' ? [] : collectBackgroundColors(child),
  );

  return [...ownColor, ...childColors];
}

describe('LoginScreen', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('zh-Hant');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.signedOutTransition = null;
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows rate-limit alert for normal sms cooldown', async () => {
    mockSendSmsCode.mockRejectedValueOnce(
      new ApiError(ERROR_CODE.SMS_TOO_FREQUENT, '驗證碼發送過於頻繁'),
    );

    const { getByPlaceholderText, getByText, getByRole } = render(
      <LoginScreen />,
    );

    fireEvent.changeText(getByPlaceholderText('請輸入手機號碼'), '13312341234');
    fireEvent.press(getByRole('checkbox'));
    fireEvent.press(getByText('取得驗證碼'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalled();
    });

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('passes the resolved auth base URL to the SMS verification screen', async () => {
    mockSendSmsCode.mockResolvedValueOnce({
      authBaseUrl: 'https://review-api.vividrop.cn',
    });

    const { getByPlaceholderText, getByText, getByRole } = render(
      <LoginScreen />,
    );

    fireEvent.changeText(getByPlaceholderText('請輸入手機號碼'), '17000000002');
    fireEvent.press(getByRole('checkbox'));
    fireEvent.press(getByText('取得驗證碼'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('SmsVerify', {
        phone: '17000000002',
        authBaseUrl: 'https://review-api.vividrop.cn',
      });
    });
  });

  it('renders the enabled request-code button without a secondary blue overlay', () => {
    const { getByPlaceholderText, getByRole, toJSON } = render(<LoginScreen />);

    fireEvent.changeText(getByPlaceholderText('請輸入手機號碼'), '17000000002');
    fireEvent.press(getByRole('checkbox'));

    expect(collectBackgroundColors(toJSON())).not.toContain('#60c4f0');
  });
});
