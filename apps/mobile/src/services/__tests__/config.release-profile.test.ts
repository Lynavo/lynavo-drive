const testGlobal = globalThis as typeof globalThis & { __DEV__?: boolean };

describe('release profile routing config', () => {
  const originalDevFlag = testGlobal.__DEV__;

  afterEach(() => {
    jest.resetModules();
    jest.dontMock('../../markets');
    jest.dontMock('../../release-profile');
    jest.dontMock('@react-native-async-storage/async-storage');
    Object.defineProperty(testGlobal, '__DEV__', {
      value: originalDevFlag,
      configurable: true,
    });
  });

  test('uses the release profile API as the debug built-in base URL', () => {
    jest.resetModules();
    Object.defineProperty(testGlobal, '__DEV__', {
      value: true,
      configurable: true,
    });
    jest.doMock('../../markets', () => ({
      activeMarket: 'global',
      isGlobalMarket: () => true,
      isChinaMarket: () => false,
      marketConfig: {
        market: 'global',
        apiBaseUrl: 'https://global-api.vividrop.cn',
        reviewApiBaseUrl: 'https://review-api.vividrop.cn',
        appReviewPhone: '18812345678',
        appReviewEmail: 'review@vividrop.cn',
      },
    }));
    jest.doMock('../../release-profile', () => ({
      releaseApiBaseUrl: 'https://global-api.vividrop.cn',
    }));
    jest.doMock('@react-native-async-storage/async-storage', () => ({
      __esModule: true,
      default: {
        getItem: jest.fn(),
        setItem: jest.fn(),
        removeItem: jest.fn(),
      },
    }));

    const config = require('../config') as typeof import('../config');

    expect(config.DEV_API_BASE_URL).toBe('https://global-api.vividrop.cn');
    expect(config.getBaseUrl()).toBe('https://global-api.vividrop.cn');
    expect(config.resolveAuthBaseUrlForEmail('normal@vividrop.cn')).toBe(
      'https://global-api.vividrop.cn',
    );
    expect(config.resolveAuthBaseUrlForEmail('review@vividrop.cn')).toBe(
      'https://review-api.vividrop.cn',
    );
  });
});
