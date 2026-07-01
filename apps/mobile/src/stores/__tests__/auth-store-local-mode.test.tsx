import React from 'react';
import { Text } from 'react-native';
import { render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';

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

jest.mock('../../services/auth-service', () => ({
  registerAuthStoreActions: jest.fn(),
}));

jest.mock('../../services/SyncEngineModule', () => ({
  getOwnerUserId: jest.fn().mockResolvedValue('42'),
  setOwnerUserId: jest.fn().mockResolvedValue(undefined),
  wipeSyncIdentity: jest.fn().mockResolvedValue(undefined),
  setDriveEntitlements: jest.fn().mockResolvedValue(undefined),
  setTunnelCredentials: jest.fn().mockResolvedValue(undefined),
}));

import { AuthProvider, useAuth } from '../auth-store';
import {
  getOwnerUserId,
  setDriveEntitlements,
  setOwnerUserId,
  setTunnelCredentials,
  wipeSyncIdentity,
} from '../../services/SyncEngineModule';

function AuthProbe() {
  const auth = useAuth();
  return (
    <Text testID="auth-state">
      {JSON.stringify({
        isLoggedIn: auth.isLoggedIn,
        isLoading: auth.isLoading,
        profileLoading: auth.profileLoading,
        userId: auth.user?.id ?? null,
      })}
    </Text>
  );
}

describe('AuthProvider guest local mode bootstrap', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Keychain.getGenericPassword as jest.Mock).mockResolvedValue(false);
  });

  test('hydrates no-token guest without running authenticated owner cleanup', async () => {
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );

    await waitFor(() => {
      const state = JSON.parse(
        screen.getByTestId('auth-state').props.children,
      ) as {
        isLoggedIn: boolean;
        isLoading: boolean;
        profileLoading: boolean;
        userId: number | null;
      };

      expect(state).toEqual({
        isLoggedIn: false,
        isLoading: false,
        profileLoading: false,
        userId: null,
      });
    });

    expect(getOwnerUserId).not.toHaveBeenCalled();
    expect(setOwnerUserId).not.toHaveBeenCalled();
    expect(wipeSyncIdentity).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(setDriveEntitlements).toHaveBeenCalledWith(
        expect.objectContaining({
          canUseLanForegroundAutoUpload: true,
          canUseBackgroundContinuation: false,
          canUseRemoteTunnel: false,
          source: 'guest',
          expiresAt: null,
          checkedAt: expect.any(String),
        }),
      );
    });
  });

  test('clears persisted official Keychain tokens and hydrates guest local mode', async () => {
    (Keychain.getGenericPassword as jest.Mock).mockResolvedValueOnce({
      username: 'tokens',
      password: JSON.stringify({
        access: 'access-token',
        refresh: 'refresh-token',
      }),
    });

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );

    await waitFor(() => {
      const state = JSON.parse(
        screen.getByTestId('auth-state').props.children,
      ) as {
        isLoggedIn: boolean;
        isLoading: boolean;
        profileLoading: boolean;
        userId: number | null;
      };

      expect(state).toEqual({
        isLoggedIn: false,
        isLoading: false,
        profileLoading: false,
        userId: null,
      });
    });

    expect(Keychain.resetGenericPassword).toHaveBeenCalledWith({
      service: 'com.lynavo.drive.auth',
    });
    expect(getOwnerUserId).not.toHaveBeenCalled();
    expect(setOwnerUserId).not.toHaveBeenCalled();
    expect(wipeSyncIdentity).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(setTunnelCredentials).toHaveBeenCalledWith('', '', '');
    });
    await waitFor(() => {
      expect(setDriveEntitlements).toHaveBeenCalledWith(
        expect.objectContaining({
          canUseLanForegroundAutoUpload: true,
          canUseBackgroundContinuation: false,
          canUseRemoteTunnel: false,
          source: 'guest',
          expiresAt: null,
          checkedAt: expect.any(String),
        }),
      );
    });
  });

  test('clears legacy AsyncStorage official tokens without hydrating them', async () => {
    (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
      if (key === '@lynavo-drive/auth/access_token') {
        return Promise.resolve('legacy-access-token');
      }
      if (key === '@lynavo-drive/auth/refresh_token') {
        return Promise.resolve('legacy-refresh-token');
      }
      return Promise.resolve(null);
    });

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );

    await waitFor(() => {
      const state = JSON.parse(
        screen.getByTestId('auth-state').props.children,
      ) as {
        isLoggedIn: boolean;
        isLoading: boolean;
        profileLoading: boolean;
        userId: number | null;
      };

      expect(state).toEqual({
        isLoggedIn: false,
        isLoading: false,
        profileLoading: false,
        userId: null,
      });
    });

    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(
      '@lynavo-drive/auth/access_token',
    );
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(
      '@lynavo-drive/auth/refresh_token',
    );
    expect(Keychain.setGenericPassword).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(setDriveEntitlements).toHaveBeenCalledWith(
        expect.objectContaining({
          canUseLanForegroundAutoUpload: true,
          canUseBackgroundContinuation: false,
          canUseRemoteTunnel: false,
          source: 'guest',
          expiresAt: null,
          checkedAt: expect.any(String),
        }),
      );
    });
  });
});
