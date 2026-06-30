const mockGetAccessToken = jest.fn<string | null, []>();
const mockGetRefreshToken = jest.fn<string | null, []>();
const mockSetTokensFromApi = jest.fn<void, [string, string]>();
const mockClearAuthFromApi = jest.fn<void, [unknown?]>();
const mockAuthDeviceId = jest.fn<Promise<string>, []>();

jest.mock('../../stores/auth-store', () => ({
  getAccessToken: () => mockGetAccessToken(),
  getRefreshToken: () => mockGetRefreshToken(),
}));

jest.mock('../auth-service', () => ({
  _setTokensFromApi: (access: string, refresh: string) =>
    mockSetTokensFromApi(access, refresh),
  _clearAuthFromApi: (transition?: unknown) => mockClearAuthFromApi(transition),
}));

jest.mock('../auth-device-id', () => ({
  getOrCreateAuthDeviceId: () => mockAuthDeviceId(),
}));

jest.mock('../config', () => ({
  describeInsecureBaseUrl: () => null,
  getBaseUrl: () => 'https://api.test',
}));

import { apiPostNoAuth, ERROR_CODE } from '../api';

type TestGlobal = typeof globalThis & {
  __DEV__?: boolean;
  fetch: jest.Mock;
};

const testGlobal = globalThis as TestGlobal;
const originalDev = testGlobal.__DEV__;
const originalFetch = testGlobal.fetch;

describe('api dev sandbox mock tokens', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    testGlobal.__DEV__ = true;
    testGlobal.fetch = jest.fn();
    mockAuthDeviceId.mockResolvedValue('device-1');
    mockGetAccessToken.mockReturnValue(
      'mock-sandbox-access-token:qa@example.com',
    );
    mockGetRefreshToken.mockReturnValue('mock-sandbox-refresh-token');
  });

  afterAll(() => {
    testGlobal.__DEV__ = originalDev;
    testGlobal.fetch = originalFetch;
  });

  test('rejects auth refresh without hitting network in the OSS runtime', async () => {
    await expect(
      apiPostNoAuth('/auth/refresh', {
        refresh_token: 'mock-sandbox-refresh-token',
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODE.TOKEN_INVALID,
    });
    expect(mockSetTokensFromApi).not.toHaveBeenCalled();
    expect(mockClearAuthFromApi).not.toHaveBeenCalled();
    expect(testGlobal.fetch).not.toHaveBeenCalled();
  });
});
