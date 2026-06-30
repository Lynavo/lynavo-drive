import { NativeModules } from 'react-native';
import {
  applyVisualQaRemotePreviewFlag,
  getDevSkipAuthMockTokens,
  getVisualQaMockTokens,
  isVisualQaHomeEmptyStateEnabled,
  resolveVisualQaInitialRoute,
} from '../visualQa';

declare const process: { env: Record<string, string | undefined> };

type TestGlobal = typeof globalThis & {
  __DEV__?: boolean;
  __SYNCFLOW_REMOTE_RESOURCES_PREVIEW__?: boolean;
};

const testGlobal = globalThis as TestGlobal;

describe('visual QA dev bootstrap', () => {
  const originalDev = testGlobal.__DEV__;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    testGlobal.__DEV__ = true;
    delete NativeModules.NativeMarketConfig;
    delete NativeModules.AppleAuthModule;
    delete testGlobal.__SYNCFLOW_REMOTE_RESOURCES_PREVIEW__;
    process.env = { ...originalEnv };
    delete process.env.SYNCFLOW_VISUAL_QA;
    delete process.env.SYNCFLOW_VISUAL_QA_EMAIL;
    delete process.env.SYNCFLOW_VISUAL_QA_ROUTE;
    delete process.env.SYNCFLOW_VISUAL_QA_REMOTE_PREVIEW;
    delete process.env.SYNCFLOW_VISUAL_QA_HOME_EMPTY;
    delete process.env.SYNCFLOW_DEV_SKIP_AUTH;
    delete process.env.SYNCFLOW_DEV_SKIP_AUTH_EMAIL;
  });

  afterAll(() => {
    testGlobal.__DEV__ = originalDev;
    process.env = originalEnv;
    delete testGlobal.__SYNCFLOW_REMOTE_RESOURCES_PREVIEW__;
  });

  test('stays disabled outside dev even when env is present', () => {
    testGlobal.__DEV__ = false;
    process.env.SYNCFLOW_VISUAL_QA = '1';
    process.env.SYNCFLOW_VISUAL_QA_EMAIL = 'person@example.com';
    process.env.SYNCFLOW_VISUAL_QA_ROUTE = 'History';
    process.env.SYNCFLOW_VISUAL_QA_REMOTE_PREVIEW = '1';

    expect(getVisualQaMockTokens()).toBeNull();
    expect(resolveVisualQaInitialRoute()).toBeNull();
    applyVisualQaRemotePreviewFlag();
    expect(testGlobal.__SYNCFLOW_REMOTE_RESOURCES_PREVIEW__).toBeUndefined();
  });

  test('allows native visual QA constants outside dev runtime', () => {
    testGlobal.__DEV__ = false;
    NativeModules.AppleAuthModule = {
      SYNCFLOW_VISUAL_QA: '1',
      SYNCFLOW_VISUAL_QA_ROUTE: 'History',
      SYNCFLOW_VISUAL_QA_REMOTE_PREVIEW: '1',
    };

    expect(getVisualQaMockTokens()).toEqual({
      accessToken: 'mock-sandbox-access-token:qa@example.com',
      refreshToken: 'mock-sandbox-refresh-token',
    });
    expect(resolveVisualQaInitialRoute()).toBe('History');
    applyVisualQaRemotePreviewFlag();
    expect(testGlobal.__SYNCFLOW_REMOTE_RESOURCES_PREVIEW__).toBe(true);
  });

  test('stays disabled in dev when enable env is missing', () => {
    expect(getVisualQaMockTokens()).toBeNull();
    expect(resolveVisualQaInitialRoute()).toBeNull();
  });

  test('builds mock tokens from enabled env and default email', () => {
    process.env.SYNCFLOW_VISUAL_QA = '1';

    expect(getVisualQaMockTokens()).toEqual({
      accessToken: 'mock-sandbox-access-token:qa@example.com',
      refreshToken: 'mock-sandbox-refresh-token',
    });
  });

  test('prefers native visual QA constants over process env fallback', () => {
    NativeModules.NativeMarketConfig = {
      SYNCFLOW_VISUAL_QA: '1',
      SYNCFLOW_VISUAL_QA_EMAIL: 'native@example.com',
      SYNCFLOW_VISUAL_QA_ROUTE: 'History',
      SYNCFLOW_VISUAL_QA_REMOTE_PREVIEW: '1',
    };
    process.env.SYNCFLOW_VISUAL_QA = '0';
    process.env.SYNCFLOW_VISUAL_QA_EMAIL = 'process@example.com';
    process.env.SYNCFLOW_VISUAL_QA_ROUTE = 'Settings';

    expect(getVisualQaMockTokens()).toEqual({
      accessToken: 'mock-sandbox-access-token:native@example.com',
      refreshToken: 'mock-sandbox-refresh-token',
    });
    expect(resolveVisualQaInitialRoute()).toBe('History');
    applyVisualQaRemotePreviewFlag();
    expect(testGlobal.__SYNCFLOW_REMOTE_RESOURCES_PREVIEW__).toBe(true);
  });

  test('falls back to AppleAuthModule visual QA constants when market config is absent', () => {
    NativeModules.AppleAuthModule = {
      SYNCFLOW_VISUAL_QA: '1',
      SYNCFLOW_VISUAL_QA_ROUTE: 'Settings',
    };

    expect(getVisualQaMockTokens()).toEqual({
      accessToken: 'mock-sandbox-access-token:qa@example.com',
      refreshToken: 'mock-sandbox-refresh-token',
    });
    expect(resolveVisualQaInitialRoute()).toBe('Settings');
  });

  test('reads AppleAuthModule getConstants visual QA constants', () => {
    NativeModules.AppleAuthModule = {
      getConstants: () => ({
        SYNCFLOW_VISUAL_QA: '1',
        SYNCFLOW_VISUAL_QA_ROUTE: 'History',
      }),
    };

    expect(getVisualQaMockTokens()).toEqual({
      accessToken: 'mock-sandbox-access-token:qa@example.com',
      refreshToken: 'mock-sandbox-refresh-token',
    });
    expect(resolveVisualQaInitialRoute()).toBe('History');
  });

  test('reads native dev skip-auth constants without enabling visual QA mocks', () => {
    NativeModules.AppleAuthModule = {
      SYNCFLOW_DEV_SKIP_AUTH: '1',
      SYNCFLOW_DEV_SKIP_AUTH_EMAIL: 'functional@example.com',
      SYNCFLOW_VISUAL_QA: '0',
      SYNCFLOW_VISUAL_QA_ROUTE: 'DeviceDiscovery',
    };

    expect(getDevSkipAuthMockTokens()).toEqual({
      accessToken: 'mock-sandbox-access-token:functional@example.com',
      refreshToken: 'mock-sandbox-refresh-token',
    });
    expect(getVisualQaMockTokens()).toBeNull();
    expect(resolveVisualQaInitialRoute()).toBeNull();
  });

  test('uses requested visual QA email for mock access token', () => {
    process.env.SYNCFLOW_VISUAL_QA = '1';
    process.env.SYNCFLOW_VISUAL_QA_EMAIL = 'designer@example.com';

    expect(getVisualQaMockTokens()?.accessToken).toBe(
      'mock-sandbox-access-token:designer@example.com',
    );
  });

  test('accepts only whitelisted authed initial routes', () => {
    process.env.SYNCFLOW_VISUAL_QA = '1';

    process.env.SYNCFLOW_VISUAL_QA_ROUTE = 'History';
    expect(resolveVisualQaInitialRoute()).toBe('History');

    process.env.SYNCFLOW_VISUAL_QA_ROUTE = 'Settings';
    expect(resolveVisualQaInitialRoute()).toBe('Settings');

    process.env.SYNCFLOW_VISUAL_QA_ROUTE = 'Login';
    expect(resolveVisualQaInitialRoute()).toBeNull();

    process.env.SYNCFLOW_VISUAL_QA_ROUTE = 'NotARoute';
    expect(resolveVisualQaInitialRoute()).toBeNull();
  });

  test('sets remote preview flag only when explicitly enabled', () => {
    process.env.SYNCFLOW_VISUAL_QA = '1';
    applyVisualQaRemotePreviewFlag();
    expect(testGlobal.__SYNCFLOW_REMOTE_RESOURCES_PREVIEW__).toBeUndefined();

    process.env.SYNCFLOW_VISUAL_QA_REMOTE_PREVIEW = '1';
    applyVisualQaRemotePreviewFlag();
    expect(testGlobal.__SYNCFLOW_REMOTE_RESOURCES_PREVIEW__).toBe(true);
  });

  test('enables home empty-state visual QA only when explicitly requested', () => {
    process.env.SYNCFLOW_VISUAL_QA = '1';
    expect(isVisualQaHomeEmptyStateEnabled()).toBe(false);

    process.env.SYNCFLOW_VISUAL_QA_HOME_EMPTY = '1';
    expect(isVisualQaHomeEmptyStateEnabled()).toBe(true);
  });
});
