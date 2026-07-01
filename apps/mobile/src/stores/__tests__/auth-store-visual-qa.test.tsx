import React from 'react';
import { Text } from 'react-native';
import { render, screen, waitFor } from '@testing-library/react-native';

declare const process: { env: Record<string, string | undefined> };

type TestGlobal = typeof globalThis & { __DEV__?: boolean };
const testGlobal = globalThis as TestGlobal;

jest.mock('../../services/auth-service', () => ({
  registerSessionClearAction: jest.fn(),
}));

import { AuthProvider, useAuth } from '../auth-store';

function AuthProbe() {
  const auth = useAuth();
  return (
    <Text testID="auth-state">
      {JSON.stringify({
        isLoggedIn: auth.isLoggedIn,
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
  });

  afterAll(() => {
    testGlobal.__DEV__ = originalDev;
    process.env = originalEnv;
  });

  test('enables local dev session when visual QA is enabled', async () => {
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
        isLoggedIn: boolean;
      };

      expect(state).toEqual({
        isLoggedIn: true,
      });
    });
  });

  test('enables dev skip-auth session without enabling visual QA route mocks', async () => {
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
        isLoggedIn: boolean;
      };

      expect(state).toEqual({
        isLoggedIn: true,
      });
    });
  });

  test('keeps guest session when visual QA and dev skip-auth are disabled', async () => {
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
      };

      expect(state).toEqual({
        isLoggedIn: false,
      });
    });
  });
});
