import React from 'react';
import { Text } from 'react-native';
import { act, render, screen, waitFor } from '@testing-library/react-native';

declare const process: { env: Record<string, string | undefined> };

type TestGlobal = typeof globalThis & { __DEV__?: boolean };
const testGlobal = globalThis as TestGlobal;

let mockRegisteredClearAuth: ((transition?: unknown) => void) | null = null;

jest.mock('../../services/auth-service', () => ({
  registerSessionClearAction: jest.fn(
    (clearAuth: (transition?: unknown) => void) => {
      mockRegisteredClearAuth = clearAuth;
    },
  ),
}));

import { AuthProvider, useAuth } from '../auth-store';

function AuthProbe() {
  const auth = useAuth();
  return (
    <Text testID="auth-state">
      {JSON.stringify({
        isLoggedIn: auth.isLoggedIn,
        signedOutTransition: auth.signedOutTransition,
      })}
    </Text>
  );
}

describe('AuthProvider API session clear bridge', () => {
  const originalDev = testGlobal.__DEV__;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    mockRegisteredClearAuth = null;
    testGlobal.__DEV__ = true;
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    testGlobal.__DEV__ = originalDev;
    process.env = originalEnv;
  });

  test('records session-replaced transition after registered local session clear', async () => {
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(mockRegisteredClearAuth).not.toBeNull();
    });
    await waitFor(() => {
      const state = JSON.parse(
        screen.getByTestId('auth-state').props.children,
      ) as {
        isLoggedIn: boolean;
      };

      expect(state.isLoggedIn).toBe(false);
    });
    await act(async () => {
      mockRegisteredClearAuth?.('session_replaced');
    });

    await waitFor(() => {
      const state = JSON.parse(
        screen.getByTestId('auth-state').props.children,
      ) as {
        isLoggedIn: boolean;
        signedOutTransition: string | null;
      };

      expect(state).toEqual({
        isLoggedIn: false,
        signedOutTransition: 'session_replaced',
      });
    });
  });
});
