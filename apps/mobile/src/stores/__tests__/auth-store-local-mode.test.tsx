import React from 'react';
import { Text } from 'react-native';
import { render, screen, waitFor } from '@testing-library/react-native';

jest.mock('../../services/auth-service', () => ({
  registerSessionClearAction: jest.fn(),
}));

jest.mock('../../services/SyncEngineModule', () => ({
  wipeSyncIdentity: jest.fn().mockResolvedValue(undefined),
}));

import { AuthProvider, useAuth } from '../auth-store';
import { wipeSyncIdentity } from '../../services/SyncEngineModule';

function AuthProbe() {
  const auth = useAuth();
  return (
    <Text testID="auth-state">
      {JSON.stringify({
        isLoggedIn: auth.isLoggedIn,
        isLoading: auth.isLoading,
      })}
    </Text>
  );
}

describe('AuthProvider guest local mode bootstrap', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
      };

      expect(state).toEqual({
        isLoggedIn: false,
        isLoading: false,
      });
    });

    expect(wipeSyncIdentity).not.toHaveBeenCalled();
  });
});
