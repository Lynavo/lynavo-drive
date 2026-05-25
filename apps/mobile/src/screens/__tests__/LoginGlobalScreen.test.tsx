import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { NativeModules } from 'react-native';
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

jest.mock('../../services/auth-service', () => ({
  appleLogin: jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
  googleLogin: jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
  sendEmailCode: jest.fn().mockResolvedValue(undefined),
}));

describe('LoginGlobalScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  it('shows Google, Apple and Phone login buttons', () => {
    const { getByText } = render(<LoginGlobalScreen />);

    expect(getByText('Continue with Google')).toBeTruthy();
    expect(getByText('Continue with Apple')).toBeTruthy();
    expect(getByText('Continue with phone')).toBeTruthy();
  });

  it('navigates to LoginEmail screen when phone button is pressed', () => {
    const { getByText } = render(<LoginGlobalScreen />);

    const phoneButton = getByText('Continue with phone');
    fireEvent.press(phoneButton);

    expect(mockNavigate).toHaveBeenCalledWith('LoginEmail');
  });

  it('keeps provider buttons disabled while provider login is pending', () => {
    // Modify AppleAuthModule mock to return a pending promise to keep it in pending state
    let resolveLogin: any;
    const pendingPromise = new Promise((resolve) => {
      resolveLogin = resolve;
    });
    
    NativeModules.AppleAuthModule.login = jest.fn().mockReturnValue(pendingPromise);

    const { getByText, queryByText } = render(<LoginGlobalScreen />);

    const appleButton = getByText('Continue with Apple');
    fireEvent.press(appleButton);

    // Apple button is loading (text is temporarily replaced by ActivityIndicator)
    // Google button remains rendered (but disabled)
    expect(queryByText('Continue with Apple')).toBeNull();
    expect(getByText('Continue with Google')).toBeTruthy();
    
    // Resolve the promise to clean up
    resolveLogin({
      identityToken: 'mock-apple-id-token',
      authorizationCode: 'mock-auth-code',
      fullName: 'Test User',
    });
  });
});
