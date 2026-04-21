import React from 'react';
import { Text } from 'react-native';
import { render, screen, waitFor } from '@testing-library/react-native';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn().mockResolvedValue({
    username: 'tokens',
    password: JSON.stringify({
      access: 'expired-access',
      refresh: 'refresh-1',
    }),
  }),
  setGenericPassword: jest.fn().mockResolvedValue(true),
  resetGenericPassword: jest.fn().mockResolvedValue(true),
  ACCESSIBLE: {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AfterFirstUnlockThisDeviceOnly',
  },
}));

jest.mock('../bootstrapAuthedSession', () =>
  jest.requireActual('../bootstrapAuthedSession'),
);

jest.mock('../../constants/features', () => ({
  FEATURES: {
    SUBSCRIPTION_ENFORCEMENT: false,
    IAP_ENABLED: false,
    IAP_RESTORE_ENABLED: false,
  },
}));

jest.mock('../../hooks/useIapLifecycle', () => ({
  useIapLifecycle: jest.fn(),
}));

let mockRegisteredSetTokens:
  | ((accessToken: string, refreshToken: string) => void)
  | null = null;
const mockGetUserProfile = jest.fn(async () => {
  await waitFor(() => {
    expect(mockRegisteredSetTokens).not.toBeNull();
  });
  mockRegisteredSetTokens?.('fresh-access', 'refresh-2');
  return {
    id: 42,
    primaryIdentity: { type: 'email', display: 'u@example.com' },
    identities: [{ type: 'email', display: 'u@example.com' }],
    status: 'subscribed',
    plan: 'yearly',
    expireAt: '2030-01-01T00:00:00.000Z',
    trialEnd: null,
  };
});

jest.mock('../../services/auth-service', () => ({
  registerAuthStoreActions: jest.fn(
    (
      setTokens: (accessToken: string, refreshToken: string) => void,
      _clearAuth: () => void,
    ) => {
      mockRegisteredSetTokens = setTokens;
    },
  ),
  getUserProfile: mockGetUserProfile,
}));

jest.mock('../../services/subscription-service', () => ({
  getSubscriptionStatus: jest.fn().mockResolvedValue({
    status: 'subscribed',
    plan: 'yearly',
    expireAt: '2030-01-01T00:00:00.000Z',
    trialEnd: null,
  }),
}));

jest.mock('../../services/SyncEngineModule', () => ({
  getOwnerUserId: jest.fn().mockResolvedValue('42'),
  setOwnerUserId: jest.fn().mockResolvedValue(undefined),
  wipeSyncIdentity: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/sidecar-reset-service', () => ({
  resetCurrentDesktopSidecarIfReachable: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../utils/clearUserScopedStorage', () => ({
  clearUserScopedStorage: jest.fn().mockResolvedValue(undefined),
}));

import { AuthProvider, useAuth } from '../auth-store';

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

describe('AuthProvider bootstrap after token refresh', () => {
  beforeEach(() => {
    mockRegisteredSetTokens = null;
    mockGetUserProfile.mockClear();
  });

  test('does not cancel profile bootstrap when API silently rotates tokens', async () => {
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
        profileLoading: boolean;
        userId: number | null;
      };

      expect(state).toEqual({
        accessToken: 'fresh-access',
        profileLoading: false,
        userId: 42,
      });
    });
    expect(mockGetUserProfile).toHaveBeenCalledTimes(1);
  });
});
