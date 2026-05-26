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

let mockIsGlobal = false;
jest.mock('../../markets', () => {
  const actual = jest.requireActual('../../markets');
  return {
    ...actual,
    isGlobalMarket: () => mockIsGlobal,
  };
});

const mockSendSmsCode = jest.fn();
const mockSendEmailCode = jest.fn();

jest.mock('../../services/auth-service', () => ({
  sendSmsCode: (phone: string) => mockSendSmsCode(phone),
  sendEmailCode: (email: string) => mockSendEmailCode(email),
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
    mockIsGlobal = false;
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
        phone: '+8617000000002',
        authBaseUrl: 'https://review-api.vividrop.cn',
      });
    });
  });

  it('verifies dynamic country picker selection and validation', async () => {
    mockSendSmsCode.mockResolvedValueOnce({
      authBaseUrl: 'https://review-api.vividrop.cn',
    });

    const { getByPlaceholderText, getByText, getByRole } = render(
      <LoginScreen />,
    );

    // Press country picker combobox
    fireEvent.press(getByRole('combobox'));

    // Select United States (+1)
    fireEvent.press(getByText('United States (美国)'));

    // US number input (maxLength 10)
    const phoneInput = getByPlaceholderText('請輸入手機號碼');
    
    // Type an invalid/short phone number and trigger blur to verify error
    fireEvent.changeText(phoneInput, '202555');
    fireEvent(phoneInput, 'blur');
    expect(getByText('請輸入有效的 美国 手機號碼')).toBeTruthy();

    // Type a valid 10-digit phone number
    fireEvent.changeText(phoneInput, '2025550143');
    fireEvent.press(getByRole('checkbox'));
    fireEvent.press(getByText('取得驗證碼'));

    await waitFor(() => {
      expect(mockSendSmsCode).toHaveBeenCalledWith('+12025550143');
      expect(mockNavigate).toHaveBeenCalledWith('SmsVerify', {
        phone: '+12025550143',
        authBaseUrl: 'https://review-api.vividrop.cn',
      });
    });
  });

  it('allows searching country list in picker', async () => {
    const { getByPlaceholderText, getByText, getByRole, queryByText } = render(
      <LoginScreen />,
    );

    // Open picker
    fireEvent.press(getByRole('combobox'));

    // Search input is inside the picker modal
    const searchInput = getByPlaceholderText('Search by country or code...');
    fireEvent.changeText(searchInput, 'Canada');

    // Canada should be visible, others like Germany should not
    expect(getByText('Canada (加拿大)')).toBeTruthy();
    expect(queryByText('Germany (德国)')).toBeNull();
  });

  it('renders the enabled request-code button without a secondary blue overlay', () => {
    const { getByPlaceholderText, getByRole, toJSON } = render(<LoginScreen />);

    fireEvent.changeText(getByPlaceholderText('請輸入手機號碼'), '17000000002');
    fireEvent.press(getByRole('checkbox'));

    expect(collectBackgroundColors(toJSON())).not.toContain('#60c4f0');
  });
  it('lets iOS center the phone input without a forced line height', () => {
    const { getByPlaceholderText } = render(<LoginScreen />);

    const phoneInputStyle = StyleSheet.flatten(
      getByPlaceholderText('請輸入手機號碼').props.style,
    );

    expect(phoneInputStyle.height).toBe(48);
    expect(phoneInputStyle.paddingVertical).toBe(0);
    expect(phoneInputStyle.lineHeight).toBeUndefined();
  });

  describe('Global market email login', () => {
    beforeEach(() => {
      mockIsGlobal = true;
    });

    it('submits email and navigates to verify screen on success', async () => {
      mockSendEmailCode.mockResolvedValueOnce(undefined);

      const { getByPlaceholderText, getByText, getByRole } = render(
        <LoginScreen />,
      );

      // In global market, placeholder should be email placeholder
      const emailInput = getByPlaceholderText('請輸入電子郵件');
      fireEvent.changeText(emailInput, 'test@example.com');
      fireEvent.press(getByRole('checkbox'));
      fireEvent.press(getByText('取得驗證碼'));

      await waitFor(() => {
        expect(mockSendEmailCode).toHaveBeenCalledWith('test@example.com');
        expect(mockNavigate).toHaveBeenCalledWith('SmsVerify', {
          email: 'test@example.com',
        });
      });
    });

    it('shows email format error if invalid email is entered', async () => {
      const { getByPlaceholderText, getByText } = render(<LoginScreen />);
      const emailInput = getByPlaceholderText('請輸入電子郵件');
            fireEvent.changeText(emailInput, 'invalid-email');
      fireEvent(emailInput, 'blur');
      await waitFor(() => {
        expect(getByText('請輸入有效的電子郵件地址')).toBeTruthy();
      });
    });
  });
});
