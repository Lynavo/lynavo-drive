jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as config from '../config';

const testGlobal = globalThis as typeof globalThis & { __DEV__?: boolean };

describe('OSS API config', () => {
  const originalDevFlag = testGlobal.__DEV__;

  beforeEach(async () => {
    jest.clearAllMocks();
    Object.defineProperty(testGlobal, '__DEV__', {
      value: true,
      configurable: true,
    });
    await config.setDebugBaseUrlOverride(null);
  });

  afterEach(() => {
    Object.defineProperty(testGlobal, '__DEV__', {
      value: originalDevFlag,
      configurable: true,
    });
  });

  test('uses review API as the debug built-in base URL', () => {
    expect(config.PROD_BASE_URL).toBe('https://api.lynavo.com');
    expect(config.REVIEW_API_BASE_URL).toBe('https://review-api.lynavo.com');
    expect(config.DEV_API_BASE_URL).toBe('https://review-api.lynavo.com');
    expect(config.getBaseUrl()).toBe('https://review-api.lynavo.com');
  });

  test('uses production API as the release built-in base URL', () => {
    Object.defineProperty(testGlobal, '__DEV__', {
      value: false,
      configurable: true,
    });

    expect(config.getBaseUrl()).toBe(config.PROD_BASE_URL);
  });

  test('uses and persists the debug base URL override in dev builds', async () => {
    await config.setDebugBaseUrlOverride('http://192.168.1.42:8080');

    expect(config.getDebugBaseUrlOverride()).toBe('http://192.168.1.42:8080');
    expect(config.getBaseUrl()).toBe('http://192.168.1.42:8080');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      '@vividrop/debug/api_base_url',
      'http://192.168.1.42:8080',
    );
  });

  test('loads persisted debug base URL override in dev builds', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(
      'http://192.168.1.42:8080',
    );

    await config.loadDebugBaseUrlOverride();

    expect(config.getBaseUrl()).toBe('http://192.168.1.42:8080');
  });

  test('does not expose official auth routing or session-base helpers', () => {
    expect(config).not.toHaveProperty('APP_REVIEW_EMAIL');
    expect(config).not.toHaveProperty('resolveAuthBaseUrlForEmail');
    expect(config).not.toHaveProperty('loadSessionBaseUrl');
    expect(config).not.toHaveProperty('setSessionBaseUrl');
    expect(config).not.toHaveProperty('clearSessionBaseUrl');
    expect(config).not.toHaveProperty('getSessionBaseUrl');
  });

  test('rejects invalid debug base URL overrides', async () => {
    await expect(
      config.setDebugBaseUrlOverride('192.168.1.42:8080'),
    ).rejects.toThrow(
      'debug base URL must start with http:// or https://',
    );
  });
});
