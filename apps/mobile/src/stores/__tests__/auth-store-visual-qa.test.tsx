import React from 'react';
import { Text } from 'react-native';
import { render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';

declare const process: { env: Record<string, string | undefined> };

type TestGlobal = typeof globalThis & { __DEV__?: boolean };
const testGlobal = globalThis as TestGlobal;

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
  setDriveEntitlements: jest.fn().mockResolvedValue(undefined),
  setTunnelCredentials: jest.fn().mockResolvedValue(undefined),
}));

import { AuthProvider, useAuth } from '../auth-store';
import { setDriveEntitlements } from '../../services/SyncEngineModule';

function AuthProbe() {
  const auth = useAuth();
  return (
    <Text testID="auth-state">
      {JSON.stringify({
        accessToken: auth.accessToken,
        refreshToken: auth.refreshToken,
        userId: auth.user?.id ?? null,
      })}
    </Text>
  );
}

describe('AuthProvider visual QA bootstrap', () => {
  const originalDev = testGlobal.__DEV__;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    testGlobal.__DEV__ = true;
    process.env = { ...originalEnv };
    delete process.env.LYNAVO_VISUAL_QA;
    delete process.env.LYNAVO_VISUAL_QA_EMAIL;
    delete process.env.LYNAVO_DEV_SKIP_AUTH;
    delete process.env.LYNAVO_DEV_SKIP_AUTH_EMAIL;
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (Keychain.getGenericPassword as jest.Mock).mockResolvedValue(false);
  });

  afterAll(() => {
    testGlobal.__DEV__ = originalDev;
    process.env = originalEnv;
  });

  test('hydrates mock tokens only when enabled and no persisted tokens exist', async () => {
    process.env.LYNAVO_VISUAL_QA = '1';
    process.env.LYNAVO_VISUAL_QA_EMAIL = 'designer@example.com';

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );

    await waitFor(() => {
      const state = JSON.parse(
        screen.getByTestId('auth-state').props.children,
      ) as {
        accessToken: string | null;
        refreshToken: string | null;
        userId: number | null;
      };

      expect(state).toEqual({
        accessToken: 'mock-sandbox-access-token:designer@example.com',
        refreshToken: 'mock-sandbox-refresh-token',
        userId: null,
      });
    });
    expect(Keychain.setGenericPassword).toHaveBeenCalledWith(
      'tokens',
      JSON.stringify({
        access: 'mock-sandbox-access-token:designer@example.com',
        refresh: 'mock-sandbox-refresh-token',
      }),
      expect.any(Object),
    );
    await waitFor(() => {
      expect(setDriveEntitlements).toHaveBeenCalledWith(
        expect.objectContaining({
          canUseLanForegroundAutoUpload: true,
          canUseBackgroundContinuation: false,
          canUseRemoteTunnel: false,
          source: 'free_account',
          expiresAt: null,
          checkedAt: expect.any(String),
        }),
      );
    });
  });

  test('hydrates dev skip-auth tokens without enabling visual QA route mocks', async () => {
    process.env.LYNAVO_DEV_SKIP_AUTH = '1';
    process.env.LYNAVO_DEV_SKIP_AUTH_EMAIL = 'functional@example.com';
    process.env.LYNAVO_VISUAL_QA_ROUTE = 'DeviceDiscovery';

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );

    await waitFor(() => {
      const state = JSON.parse(
        screen.getByTestId('auth-state').props.children,
      ) as {
        accessToken: string | null;
        refreshToken: string | null;
        userId: number | null;
      };

      expect(state).toEqual({
        accessToken: 'mock-sandbox-access-token:functional@example.com',
        refreshToken: 'mock-sandbox-refresh-token',
        userId: null,
      });
    });
    expect(Keychain.setGenericPassword).toHaveBeenCalledWith(
      'tokens',
      JSON.stringify({
        access: 'mock-sandbox-access-token:functional@example.com',
        refresh: 'mock-sandbox-refresh-token',
      }),
      expect.any(Object),
    );
  });

  test('clears stale persisted official tokens before hydrating visual QA tokens', async () => {
    process.env.LYNAVO_VISUAL_QA = '1';
    process.env.LYNAVO_VISUAL_QA_EMAIL = 'designer@example.com';
    (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
      username: 'tokens',
      password: JSON.stringify({
        access: 'persisted-access',
        refresh: 'persisted-refresh',
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
        accessToken: string | null;
        refreshToken: string | null;
      };

      expect(state.accessToken).toBe(
        'mock-sandbox-access-token:designer@example.com',
      );
      expect(state.refreshToken).toBe('mock-sandbox-refresh-token');
    });
    expect(Keychain.resetGenericPassword).toHaveBeenCalledWith({
      service: 'com.lynavo.drive.auth',
    });
    expect(Keychain.setGenericPassword).toHaveBeenCalledWith(
      'tokens',
      expect.stringContaining('mock-sandbox-access-token'),
      expect.any(Object),
    );
  });
});
