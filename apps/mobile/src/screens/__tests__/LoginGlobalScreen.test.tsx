import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { NativeModules, Alert, Platform, StyleSheet } from 'react-native';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { LoginGlobalScreen } from '../LoginGlobalScreen';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: jest.fn(),
  }),
}));

jest.mock('@react-navigation/stack', () => ({}));

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn().mockResolvedValue(true),
    signIn: jest.fn().mockResolvedValue({
      data: { idToken: 'mock-google-id-token' },
    }),
  },
}));

const mockLogin = jest.fn();

jest.mock('../../stores/auth-store', () => ({
  useAuth: () => ({
    login: mockLogin,
  }),
}));

const mockAppleLogin = jest.fn();
const mockGoogleLogin = jest.fn();
const mockSendEmailCode = jest.fn();
const mockEmailLogin = jest.fn();

jest.mock('../../services/auth-service', () => ({
  appleLogin: (args: {
    identityToken: string;
    authorizationCode?: string;
    fullName?: string;
  }) => mockAppleLogin(args),
  googleLogin: (identityToken: string) => mockGoogleLogin(identityToken),
  sendEmailCode: (email: string) => mockSendEmailCode(email),
  emailLogin: (email: string, code: string) => mockEmailLogin(email, code),
}));

describe('LoginGlobalScreen', () => {
  const originalPlatformOS = Platform.OS;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'ios',
    });
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockAppleLogin.mockResolvedValue({ accessToken: 'a', refreshToken: 'r' });
    mockGoogleLogin.mockResolvedValue({ accessToken: 'a', refreshToken: 'r' });
    NativeModules.AppleAuthModule = {
      login: jest.fn().mockResolvedValue({
        identityToken: 'mock-apple-id-token',
        authorizationCode: 'mock-auth-code',
        fullName: 'Test User',
      }),
    };
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: originalPlatformOS,
    });
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('renders the reference global auth landing without phone fallback', () => {
    const { getByText, queryByText, queryByPlaceholderText } = render(
      <LoginGlobalScreen />,
    );

    expect(getByText('Vivi Drop')).toBeTruthy();
    expect(getByText('Connect your desktop and keep media in sync.')).toBeTruthy();
    expect(getByText('登录或创建账号')).toBeTruthy();
    expect(getByText('使用 Google 继续')).toBeTruthy();
    expect(getByText('使用 Apple 继续')).toBeTruthy();
    expect(getByText('使用邮箱登录')).toBeTruthy();
    expect(getByText('继续即表示你同意', { exact: false })).toBeTruthy();

    expect(queryByText('OR')).toBeNull();
    expect(queryByText(/or phone/i)).toBeNull();
    expect(queryByText(/手机号|验证码|短信/)).toBeNull();
    expect(queryByText('Continue')).toBeNull();
    expect(queryByPlaceholderText('Phone number')).toBeNull();
  });

  it('hides Apple Sign-In on Android', () => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'android',
    });

    const { getByText, queryByText, queryByTestId } = render(
      <LoginGlobalScreen />,
    );

    expect(getByText('使用 Google 继续')).toBeTruthy();
    expect(getByText('使用邮箱登录')).toBeTruthy();
    expect(queryByText('使用 Apple 继续')).toBeNull();
    expect(queryByTestId('global-auth-apple-provider-button')).toBeNull();
  });

  it('keeps Android email inputs vertically centered without font-scale clipping', () => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'android',
    });

    const { getByText, getByPlaceholderText } = render(<LoginGlobalScreen />);

    fireEvent.press(getByText('使用邮箱登录'));

    const emailInput = getByPlaceholderText('请输入电子邮箱');
    const codeInput = getByPlaceholderText('6 位数验证码');
    const emailInputStyle = StyleSheet.flatten(emailInput.props.style);
    const codeInputStyle = StyleSheet.flatten(codeInput.props.style);

    expect(emailInput.props.allowFontScaling).toBe(false);
    expect(emailInput.props.maxFontSizeMultiplier).toBe(1);
    expect(codeInput.props.allowFontScaling).toBe(false);
    expect(codeInput.props.maxFontSizeMultiplier).toBe(1);
    expect(emailInputStyle.height).toBe(40);
    expect(emailInputStyle.paddingVertical).toBe(0);
    expect(emailInputStyle.paddingTop).toBe(0);
    expect(emailInputStyle.paddingBottom).toBe(0);
    expect(emailInputStyle.lineHeight).toBe(20);
    expect(emailInputStyle.includeFontPadding).toBe(false);
    expect(emailInputStyle.textAlignVertical).toBe('center');
    expect(codeInputStyle.paddingVertical).toBe(0);
    expect(codeInputStyle.textAlignVertical).toBe('center');
  });

  it('requires terms agreement before provider authorization', () => {
    const { getByText, getByTestId, queryByText } = render(
      <LoginGlobalScreen />,
    );

    fireEvent.press(getByText('使用 Google 继续'));

    expect(getByTestId('global-auth-agreement-modal-backdrop')).toBeTruthy();
    expect(getByTestId('global-auth-agreement-modal-card')).toBeTruthy();
    expect(getByText('请先同意服务协议')).toBeTruthy();
    expect(
      getByText(
        '登录前需要确认你已阅读并同意服务条款和隐私政策，之后可继续使用 Google 授权。',
      ),
    ).toBeTruthy();
    expect(queryByText('Google 授权登录')).toBeNull();
    expect(GoogleSignin.signIn).not.toHaveBeenCalled();
    expect(mockGoogleLogin).not.toHaveBeenCalled();
  });

  it('continues to provider confirmation after accepting terms from the gate', () => {
    const { getByRole, getByText, getByTestId } = render(
      <LoginGlobalScreen />,
    );

    fireEvent.press(getByText('使用 Apple 继续'));
    fireEvent.press(getByText('同意并继续'));

    expect(getByRole('checkbox').props.accessibilityState).toEqual({
      checked: true,
    });
    expect(getByTestId('global-auth-provider-modal-backdrop')).toBeTruthy();
    expect(getByTestId('global-auth-provider-modal-card')).toBeTruthy();
    expect(getByText('Apple 授权登录')).toBeTruthy();
    expect(getByText('将打开 Apple 完成账号授权。')).toBeTruthy();
    expect(NativeModules.AppleAuthModule.login).not.toHaveBeenCalled();
  });

  it('uses provider confirmation instead of direct auth after explicit agreement', () => {
    const { getByRole, getByText, getByTestId } = render(
      <LoginGlobalScreen />,
    );

    fireEvent.press(getByRole('checkbox'));
    fireEvent.press(getByText('使用 Google 继续'));

    expect(getByTestId('global-auth-provider-modal-backdrop')).toBeTruthy();
    expect(getByText('Google 授权登录')).toBeTruthy();
    expect(
      getByText(
        '使用 Google 账号授权后，ViviDrop 只会用于识别账号和同步设备，不会读取你的密码。',
      ),
    ).toBeTruthy();
    expect(GoogleSignin.signIn).not.toHaveBeenCalled();
    expect(mockGoogleLogin).not.toHaveBeenCalled();
  });

  it('logs in with Google after agreement and provider confirmation', async () => {
    const { getByRole, getByText } = render(<LoginGlobalScreen />);

    fireEvent.press(getByRole('checkbox'));
    fireEvent.press(getByText('使用 Google 继续'));
    fireEvent.press(getByText('继续授权'));

    await waitFor(() => {
      expect(mockGoogleLogin).toHaveBeenCalledWith('mock-google-id-token');
      expect(mockLogin).toHaveBeenCalledWith('a', 'r');
    });
  });

  it('logs in with Apple after agreement and provider confirmation', async () => {
    const { getByRole, getByText } = render(<LoginGlobalScreen />);

    fireEvent.press(getByRole('checkbox'));
    fireEvent.press(getByText('使用 Apple 继续'));
    fireEvent.press(getByText('继续授权'));

    await waitFor(() => {
      expect(mockAppleLogin).toHaveBeenCalledWith({
        identityToken: 'mock-apple-id-token',
        authorizationCode: 'mock-auth-code',
        fullName: 'Test User',
      });
      expect(mockLogin).toHaveBeenCalledWith('a', 'r');
    });
  });

  it('switches to email login screen and requires terms agreement before sending code or logging in', async () => {
    const { getByText, getByPlaceholderText, queryByText } = render(
      <LoginGlobalScreen />,
    );

    fireEvent.press(getByText('使用邮箱登录'));

    expect(getByText('邮箱登录')).toBeTruthy();
    expect(getByPlaceholderText('请输入电子邮箱')).toBeTruthy();
    expect(getByPlaceholderText('6 位数验证码')).toBeTruthy();

    // Try sending code without entering email
    fireEvent.press(getByText('获取验证码'));
    expect(Alert.alert).toHaveBeenCalledWith('提示', '请输入电子邮箱');

    // Try logging in without terms agreement
    fireEvent.changeText(getByPlaceholderText('请输入电子邮箱'), 'test@example.com');
    fireEvent.changeText(getByPlaceholderText('6 位数验证码'), '123456');
    fireEvent.press(getByText('登录'));

    // Check that Agreement modal is shown
    expect(getByText('请先同意服务协议')).toBeTruthy();
    expect(
      getByText(
        '登录前需要确认你已阅读并同意服务条款和隐私政策，之后可继续使用 邮箱登录。',
      ),
    ).toBeTruthy();
  });

  it('completes email login flow successfully after agreement', async () => {
    mockSendEmailCode.mockResolvedValue(undefined);
    mockEmailLogin.mockResolvedValue({ accessToken: 'a', refreshToken: 'r' });

    const { getByRole, getByText, getByPlaceholderText } = render(
      <LoginGlobalScreen />,
    );

    fireEvent.press(getByText('使用邮箱登录'));
    fireEvent.press(getByRole('checkbox'));

    fireEvent.changeText(getByPlaceholderText('请输入电子邮箱'), 'test@example.com');
    fireEvent.press(getByText('获取验证码'));

    await waitFor(() => {
      expect(mockSendEmailCode).toHaveBeenCalledWith('test@example.com');
      expect(Alert.alert).toHaveBeenCalledWith('提示', '验证码已发送至您的邮箱，请注意查收');
    });

    fireEvent.changeText(getByPlaceholderText('6 位数验证码'), '123456');
    fireEvent.press(getByText('登录'));

    await waitFor(() => {
      expect(mockEmailLogin).toHaveBeenCalledWith('test@example.com', '123456');
      expect(mockLogin).toHaveBeenCalledWith('a', 'r');
    });
  });

  it('allows returning back to provider selection', () => {
    const { getByText, queryByPlaceholderText } = render(
      <LoginGlobalScreen />,
    );

    fireEvent.press(getByText('使用邮箱登录'));
    expect(queryByPlaceholderText('请输入电子邮箱')).toBeTruthy();

    fireEvent.press(getByText('返回第三方登录'));
    expect(queryByPlaceholderText('请输入电子邮箱')).toBeNull();
    expect(getByText('使用 Google 继续')).toBeTruthy();
  });
});
