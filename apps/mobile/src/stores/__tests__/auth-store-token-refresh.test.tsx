import React from 'react';
import { Text } from 'react-native';
import { act, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn().mockResolvedValue(false),
  setGenericPassword: jest.fn().mockResolvedValue(true),
  resetGenericPassword: jest.fn().mockResolvedValue(true),
  ACCESSIBLE: {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AfterFirstUnlockThisDeviceOnly',
  },
}));

let mockRegisteredSetTokens:
  | ((accessToken: string, refreshToken: string) => void)
  | null = null;

jest.mock('../../services/auth-service', () => ({
  registerAuthStoreActions: jest.fn(
    (
      setTokens: (accessToken: string, refreshToken: string) => void,
      _clearAuth: () => void,
    ) => {
      mockRegisteredSetTokens = setTokens;
    },
  ),
}));

jest.mock('../../services/SyncEngineModule', () => ({
  setTunnelCredentials: jest.fn().mockResolvedValue(undefined),
}));

import { AuthProvider, useAuth } from '../auth-store';
import * as Keychain from 'react-native-keychain';

function AuthProbe() {
  const auth = useAuth();
  return (
    <Text testID="auth-state">
      {JSON.stringify({
        accessToken: auth.accessToken,
        profileLoading: auth.profileLoading,
        userId: auth.user?.id ?? null,
      })}
    </Text>
  );
}

describe('AuthProvider token refresh bridge', () => {
  beforeEach(() => {
    mockRegisteredSetTokens = null;
  });

  test('ignores official API token updates without running profile bootstrap', async () => {
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(mockRegisteredSetTokens).not.toBeNull();
    });
    await act(async () => {
      mockRegisteredSetTokens?.('fresh-access', 'refresh-2');
    });

    await waitFor(() => {
      const state = JSON.parse(
        screen.getByTestId('auth-state').props.children,
      ) as {
        accessToken: string | null;
        profileLoading: boolean;
        userId: number | null;
      };

      expect(state).toEqual({
        accessToken: null,
        profileLoading: false,
        userId: null,
      });
    });
    expect(Keychain.setGenericPassword).not.toHaveBeenCalledWith(
      'tokens',
      expect.stringContaining('fresh-access'),
      expect.any(Object),
    );
  });
});
