import { NativeModules } from 'react-native';
import * as visualQa from '../visualQa';
import {
  applyVisualQaSharedFilesPreviewFlag,
  isVisualQaEnabled,
  isVisualQaHomeEmptyStateEnabled,
  resolveVisualQaInitialRoute,
} from '../visualQa';

declare const process: { env: Record<string, string | undefined> };

type TestGlobal = typeof globalThis & {
  __DEV__?: boolean;
  __LYNAVO_SHARED_FILES_PREVIEW__?: boolean;
};

const testGlobal = globalThis as TestGlobal;

describe('visual QA dev bootstrap', () => {
  const originalDev = testGlobal.__DEV__;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    testGlobal.__DEV__ = true;
    delete NativeModules.NativeAppRuntimeConfig;
    delete testGlobal.__LYNAVO_SHARED_FILES_PREVIEW__;
    process.env = { ...originalEnv };
    delete process.env.LYNAVO_VISUAL_QA;
    delete process.env.LYNAVO_VISUAL_QA_ROUTE;
    delete process.env.LYNAVO_VISUAL_QA_SHARED_FILES_PREVIEW;
    delete process.env.LYNAVO_VISUAL_QA_HOME_EMPTY;
    delete process.env.LYNAVO_DEV_SKIP_AUTH;
    delete process.env.LYNAVO_DEV_SKIP_AUTH_EMAIL;
  });

  afterAll(() => {
    testGlobal.__DEV__ = originalDev;
    process.env = originalEnv;
    delete testGlobal.__LYNAVO_SHARED_FILES_PREVIEW__;
  });

  test('stays disabled outside dev even when env is present', () => {
    testGlobal.__DEV__ = false;
    process.env.LYNAVO_VISUAL_QA = '1';
    process.env.LYNAVO_VISUAL_QA_ROUTE = 'History';
    process.env.LYNAVO_VISUAL_QA_SHARED_FILES_PREVIEW = '1';

    expect(isVisualQaEnabled()).toBe(false);
    expect(resolveVisualQaInitialRoute()).toBeNull();
    applyVisualQaSharedFilesPreviewFlag();
    expect(testGlobal.__LYNAVO_SHARED_FILES_PREVIEW__).toBeUndefined();
  });

  test('allows native visual QA constants outside dev runtime', () => {
    testGlobal.__DEV__ = false;
    NativeModules.NativeAppRuntimeConfig = {
      LYNAVO_VISUAL_QA: '1',
      LYNAVO_VISUAL_QA_ROUTE: 'History',
      LYNAVO_VISUAL_QA_SHARED_FILES_PREVIEW: '1',
    };

    expect(isVisualQaEnabled()).toBe(true);
    expect(resolveVisualQaInitialRoute()).toBe('History');
    applyVisualQaSharedFilesPreviewFlag();
    expect(testGlobal.__LYNAVO_SHARED_FILES_PREVIEW__).toBe(true);
  });

  test('stays disabled in dev when enable env is missing', () => {
    expect(isVisualQaEnabled()).toBe(false);
    expect(resolveVisualQaInitialRoute()).toBeNull();
  });

  test('enables local visual QA flags without shipping mock auth helpers', () => {
    process.env.LYNAVO_VISUAL_QA = '1';

    expect(isVisualQaEnabled()).toBe(true);
    expect(visualQa).not.toHaveProperty('getVisualQaMockTokens');
    expect(visualQa).not.toHaveProperty('getDevSkipAuthMockTokens');
  });

  test('prefers native runtime visual QA constants over process env fallback', () => {
    NativeModules.NativeAppRuntimeConfig = {
      LYNAVO_VISUAL_QA: '1',
      LYNAVO_VISUAL_QA_ROUTE: 'History',
      LYNAVO_VISUAL_QA_SHARED_FILES_PREVIEW: '1',
    };
    process.env.LYNAVO_VISUAL_QA = '0';
    process.env.LYNAVO_VISUAL_QA_ROUTE = 'Settings';

    expect(isVisualQaEnabled()).toBe(true);
    expect(resolveVisualQaInitialRoute()).toBe('History');
    applyVisualQaSharedFilesPreviewFlag();
    expect(testGlobal.__LYNAVO_SHARED_FILES_PREVIEW__).toBe(true);
  });

  test('reads native runtime getConstants visual QA constants', () => {
    NativeModules.NativeAppRuntimeConfig = {
      getConstants: () => ({
        LYNAVO_VISUAL_QA: '1',
        LYNAVO_VISUAL_QA_ROUTE: 'History',
      }),
    };

    expect(isVisualQaEnabled()).toBe(true);
    expect(resolveVisualQaInitialRoute()).toBe('History');
  });

  test('ignores legacy dev skip-auth constants for local visual QA routing', () => {
    NativeModules.NativeAppRuntimeConfig = {
      LYNAVO_DEV_SKIP_AUTH: '1',
      LYNAVO_DEV_SKIP_AUTH_EMAIL: 'functional@example.com',
      LYNAVO_VISUAL_QA: '0',
      LYNAVO_VISUAL_QA_ROUTE: 'DeviceDiscovery',
    };

    expect(isVisualQaEnabled()).toBe(false);
    expect(resolveVisualQaInitialRoute()).toBeNull();
  });

  test('accepts only whitelisted local LAN initial routes', () => {
    process.env.LYNAVO_VISUAL_QA = '1';

    process.env.LYNAVO_VISUAL_QA_ROUTE = 'History';
    expect(resolveVisualQaInitialRoute()).toBe('History');

    process.env.LYNAVO_VISUAL_QA_ROUTE = 'Settings';
    expect(resolveVisualQaInitialRoute()).toBe('Settings');

    process.env.LYNAVO_VISUAL_QA_ROUTE = 'Login';
    expect(resolveVisualQaInitialRoute()).toBeNull();

    process.env.LYNAVO_VISUAL_QA_ROUTE = 'NotARoute';
    expect(resolveVisualQaInitialRoute()).toBeNull();
  });

  test('sets shared files preview flag only when explicitly enabled', () => {
    process.env.LYNAVO_VISUAL_QA = '1';
    applyVisualQaSharedFilesPreviewFlag();
    expect(testGlobal.__LYNAVO_SHARED_FILES_PREVIEW__).toBeUndefined();

    process.env.LYNAVO_VISUAL_QA_SHARED_FILES_PREVIEW = '1';
    applyVisualQaSharedFilesPreviewFlag();
    expect(testGlobal.__LYNAVO_SHARED_FILES_PREVIEW__).toBe(true);
  });

  test('enables home empty-state visual QA only when explicitly requested', () => {
    process.env.LYNAVO_VISUAL_QA = '1';
    expect(isVisualQaHomeEmptyStateEnabled()).toBe(false);

    process.env.LYNAVO_VISUAL_QA_HOME_EMPTY = '1';
    expect(isVisualQaHomeEmptyStateEnabled()).toBe(true);
  });
});
