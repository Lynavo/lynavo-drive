jest.mock('../../markets', () => ({
  activeMarket: 'cn',
  isGlobalMarket: () => false,
  isChinaMarket: () => true,
  marketConfig: {
    market: 'cn',
    apiBaseUrl: 'https://api.vividrop.cn',
    reviewApiBaseUrl: 'https://review-api.vividrop.cn',
    appReviewPhone: '18812345678',
  },
}));

jest.mock('../../release-profile', () => ({
  releaseApiBaseUrl: null,
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  APP_REVIEW_PHONE,
  DEV_API_BASE_URL,
  PROD_BASE_URL,
  REVIEW_API_BASE_URL,
  clearSessionBaseUrl,
  getBaseUrl,
  getSessionBaseUrl,
  loadSessionBaseUrl,
  resolveAuthBaseUrlForPhone,
  setDebugBaseUrlOverride,
  setSessionBaseUrl,
} from '../config';

const testGlobal = globalThis as typeof globalThis & { __DEV__?: boolean };

describe('review server routing config', () => {
  const originalDevFlag = testGlobal.__DEV__;

  beforeEach(() => {
    jest.clearAllMocks();
    void clearSessionBaseUrl();
    void setDebugBaseUrlOverride(null);
  });

  afterEach(() => {
    Object.defineProperty(testGlobal, '__DEV__', {
      value: originalDevFlag,
      configurable: true,
    });
  });

  test('routes the App Review phone to the review API server', () => {
    expect(resolveAuthBaseUrlForPhone(APP_REVIEW_PHONE)).toBe(
      REVIEW_API_BASE_URL,
    );
    expect(resolveAuthBaseUrlForPhone(`+86 ${APP_REVIEW_PHONE}`)).toBe(
      REVIEW_API_BASE_URL,
    );
  });

  test('routes normal phone numbers to the review API server by default', () => {
    expect(resolveAuthBaseUrlForPhone('13312341234')).toBe(DEV_API_BASE_URL);
  });

  test('routes normal phone numbers to the review API server on Android dev builds by default', () => {
    jest.isolateModules(() => {
      Object.defineProperty(testGlobal, '__DEV__', {
        value: true,
        configurable: true,
      });
      jest.doMock('react-native', () => ({
        Platform: { OS: 'android' },
      }));

      const config = require('../config') as typeof import('../config');

      expect(config.resolveAuthBaseUrlForPhone('13312341234')).toBe(
        config.DEV_API_BASE_URL,
      );
    });
  });

  test('uses the debug base URL override before review server routing in dev', async () => {
    await setDebugBaseUrlOverride('http://192.168.1.42:8080');

    expect(resolveAuthBaseUrlForPhone(APP_REVIEW_PHONE)).toBe(
      'http://192.168.1.42:8080',
    );
  });

  test('persists the authenticated session base URL for later API calls', async () => {
    await setSessionBaseUrl(REVIEW_API_BASE_URL);

    expect(getSessionBaseUrl()).toBe(REVIEW_API_BASE_URL);
    expect(getBaseUrl()).toBe(REVIEW_API_BASE_URL);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      '@vividrop/auth/api_base_url',
      REVIEW_API_BASE_URL,
    );
  });

  test('loads and clears the authenticated session base URL', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(
      REVIEW_API_BASE_URL,
    );

    await loadSessionBaseUrl();

    expect(getSessionBaseUrl()).toBe(REVIEW_API_BASE_URL);

    await clearSessionBaseUrl();

    expect(getSessionBaseUrl()).toBeNull();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(
      '@vividrop/auth/api_base_url',
    );
  });

  test('ignores stale production session URL when using the review API server', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(
      'https://api.vividrop.cn',
    );

    await loadSessionBaseUrl();

    expect(getSessionBaseUrl()).toBeNull();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(
      '@vividrop/auth/api_base_url',
    );
  });

  test('does not block the active session when session URL persistence fails', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(
      new Error('storage unavailable'),
    );

    await expect(setSessionBaseUrl(REVIEW_API_BASE_URL)).resolves.toBe(
      undefined,
    );
    expect(getSessionBaseUrl()).toBe(REVIEW_API_BASE_URL);
    expect(getBaseUrl()).toBe(REVIEW_API_BASE_URL);
    expect(warnSpy).toHaveBeenCalledWith(
      '[config] failed to persist session API base URL',
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });
});
