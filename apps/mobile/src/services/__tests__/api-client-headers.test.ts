jest.mock('react-native', () => ({
  NativeModules: {
    NativeSyncEngine: {
      getAppInfo: jest.fn().mockResolvedValue({ version: '1.0.0', build: '9' }),
    },
  },
  Platform: { OS: 'android' },
}));

jest.mock('../auth-service', () => ({
  _clearAuthFromApi: jest.fn(),
}));

jest.mock('../auth-device-id', () => ({
  getOrCreateAuthDeviceId: jest.fn().mockResolvedValue('device-1'),
}));

jest.mock('../config', () => ({
  getBaseUrl: () => 'https://api.test',
  describeInsecureBaseUrl: () => null,
}));

import { apiGet, clientInfoHeaders, ERROR_CODE } from '../api';

type TestGlobal = typeof globalThis & {
  fetch: jest.Mock;
};

const testGlobal = globalThis as TestGlobal;
const originalFetch = testGlobal.fetch;

function mockJsonResponse<T>(data: T): Response {
  return {
    status: 200,
    json: jest.fn().mockResolvedValue(data),
  } as unknown as Response;
}

describe('api client headers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    testGlobal.fetch = jest.fn();
  });

  afterAll(() => {
    testGlobal.fetch = originalFetch;
  });

  test('builds app version headers for API requests', async () => {
    await expect(clientInfoHeaders()).resolves.toEqual({
      'X-Client-App': 'lynavo-drive-mobile',
      'X-Client-Platform': 'android',
      'X-Client-Version': '1.0.0',
      'X-Client-Build': '9',
    });
  });

  test('does not attach Authorization to OSS API requests', async () => {
    testGlobal.fetch.mockResolvedValueOnce(
      mockJsonResponse({
        code: 0,
        message: 'ok',
        data: { ok: true },
      }),
    );

    await expect(apiGet('/status')).resolves.toEqual({ ok: true });

    expect(testGlobal.fetch).toHaveBeenCalledTimes(1);
    const init = testGlobal.fetch.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toEqual(
      expect.objectContaining({
        'Content-Type': 'application/json',
        'X-Auth-Device-Id': 'device-1',
        'X-Client-App': 'lynavo-drive-mobile',
        'X-Client-Platform': 'android',
      }),
    );
    expect(init.headers).not.toEqual(
      expect.objectContaining({
        Authorization: expect.any(String),
      }),
    );
  });

  test('surfaces TOKEN_INVALID without retrying token rotation', async () => {
    testGlobal.fetch
      .mockResolvedValueOnce(
        mockJsonResponse({
          code: ERROR_CODE.TOKEN_INVALID,
          message: 'token invalid',
          data: null,
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          code: 0,
          message: 'ok',
          data: {
            access_token: 'fresh-access-token',
            refresh_token: 'fresh-refresh-token',
          },
        }),
      );

    await expect(apiGet('/profile')).rejects.toMatchObject({
      code: ERROR_CODE.TOKEN_INVALID,
      message: 'token invalid',
    });

    expect(testGlobal.fetch).toHaveBeenCalledTimes(1);
    expect(testGlobal.fetch.mock.calls[0]?.[0]).toBe(
      'https://api.test/api/v1/profile',
    );
  });
});
