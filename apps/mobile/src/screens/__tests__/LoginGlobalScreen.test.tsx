import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { NativeModules, Alert } from 'react-native';
import { LoginGlobalScreen } from '../LoginGlobalScreen';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
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

jest.mock('../../stores/auth-store', () => ({
  useAuth: () => ({
    login: jest.fn(),
  }),
}));

const mockSendEmailCode = jest.fn();
const mockSendSmsCode = jest.fn();

jest.mock('../../services/auth-service', () => ({
  appleLogin: jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
  googleLogin: jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
  sendEmailCode: (email: string) => mockSendEmailCode(email),
  sendSmsCode: (phone: string) => mockSendSmsCode(phone),
}));

describe('LoginGlobalScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    NativeModules.AppleAuthModule = {
      login: jest.fn().mockImplementation(() => {
        return Promise.resolve({
          identityToken: 'mock-apple-id-token',
          authorizationCode: 'mock-auth-code',
          fullName: 'Test User',
        });
      }),
    };
  });

  it('shows Google, Apple and Phone login buttons by default', () => {
    const { getByText, getByPlaceholderText } = render(<LoginGlobalScreen />);

    expect(getByText('Continue with Google')).toBeTruthy();
    expect(getByText('Continue with Apple')).toBeTruthy();
    expect(getByText('Continue with phone')).toBeTruthy();
    expect(getByPlaceholderText('Email address')).toBeTruthy();
  });

  it('toggles between phone and email mode in place', () => {
    const { getByText, getByPlaceholderText, queryByText, queryByPlaceholderText } = render(
      <LoginGlobalScreen />
    );

    // 1. Switch to Phone Mode
    fireEvent.press(getByText('Continue with phone'));

    expect(queryByPlaceholderText('Email address')).toBeNull();
    expect(getByPlaceholderText('Phone number')).toBeTruthy();
    expect(queryByText('Continue with phone')).toBeNull();
    expect(getByText('Continue with email')).toBeTruthy();

    // 2. Switch back to Email Mode
    fireEvent.press(getByText('Continue with email'));

    expect(queryByPlaceholderText('Phone number')).toBeNull();
    expect(getByPlaceholderText('Email address')).toBeTruthy();
    expect(queryByText('Continue with email')).toBeNull();
    expect(getByText('Continue with phone')).toBeTruthy();
  });

  it('submits email in email mode and navigates to SmsVerify', async () => {
    mockSendEmailCode.mockResolvedValueOnce(undefined);

    const { getByPlaceholderText, getByText } = render(<LoginGlobalScreen />);

    const input = getByPlaceholderText('Email address');
    fireEvent.changeText(input, 'global@example.com');
    fireEvent.press(getByText('Continue'));

    await waitFor(() => {
      expect(mockSendEmailCode).toHaveBeenCalledWith('global@example.com');
      expect(mockNavigate).toHaveBeenCalledWith('SmsVerify', { email: 'global@example.com' });
    });
  });

  it('submits phone in phone mode and navigates to SmsVerify', async () => {
    mockSendSmsCode.mockResolvedValueOnce({ authBaseUrl: 'https://api.vivi.cn' });

    const { getByText, getByPlaceholderText } = render(<LoginGlobalScreen />);

    // Toggle to phone
    fireEvent.press(getByText('Continue with phone'));

    const input = getByPlaceholderText('Phone number');
    fireEvent.changeText(input, '13312345678');
    fireEvent.press(getByText('Continue'));

    await waitFor(() => {
      expect(mockSendSmsCode).toHaveBeenCalledWith('+8613312345678');
      expect(mockNavigate).toHaveBeenCalledWith('SmsVerify', {
        phone: '+8613312345678',
        authBaseUrl: 'https://api.vivi.cn',
      });
    });
  });

  it('keeps provider buttons disabled while provider login is pending', () => {
    let resolveLogin: any;
    const pendingPromise = new Promise((resolve) => {
      resolveLogin = resolve;
    });
    
    NativeModules.AppleAuthModule.login = jest.fn().mockReturnValue(pendingPromise);

    const { getByText, queryByText } = render(<LoginGlobalScreen />);

    const appleButton = getByText('Continue with Apple');
    fireEvent.press(appleButton);

    expect(queryByText('Continue with Apple')).toBeNull();
    expect(getByText('Continue with Google')).toBeTruthy();
    
    resolveLogin({
      identityToken: 'mock-apple-id-token',
      authorizationCode: 'mock-auth-code',
      fullName: 'Test User',
    });
  });
});
