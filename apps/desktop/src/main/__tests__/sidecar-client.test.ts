import { EventEmitter } from 'node:events';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { logInfoMock, logWarnMock, logErrorMock } = vi.hoisted(() => ({
  logInfoMock: vi.fn(),
  logWarnMock: vi.fn(),
  logErrorMock: vi.fn(),
}));

vi.mock('electron', () => {
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const userDataPath = join(tmpdir(), 'vividrop-test-userdata');
  const { mkdirSync } = require('node:fs');
  try {
    mkdirSync(userDataPath, { recursive: true });
  } catch {}
  return {
    app: {
      getAppPath: () => '/tmp/vividrop-app',
      getName: () => 'Vivi Drop',
      getVersion: () => '0.1.0',
      getPath: (name: string) => {
        if (name === 'userData') return userDataPath;
        return tmpdir();
      },
    },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (str: string) => Buffer.from(str),
      decryptString: (buf: Buffer) => buf.toString(),
    },
  };
});

vi.mock('electron-log', () => ({
  default: {
    info: logInfoMock,
    warn: logWarnMock,
    error: logErrorMock,
  },
}));

type RequestOptions = {
  method?: string;
  protocol?: string;
  hostname?: string;
  port?: string | number | undefined;
  path?: string;
  headers?: Record<string, string>;
};

function createResponse(statusCode: number, body: string) {
  const res = new EventEmitter() as EventEmitter & {
    statusCode?: number;
  };
  res.statusCode = statusCode;
  queueMicrotask(() => {
    res.emit('data', body);
    res.emit('end');
  });
  return res;
}

function createUnsignedJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(payload)}.`;
}

function fakeAccessToken(accountId: string): string {
  return createUnsignedJwt({ uid: accountId });
}

const remoteClientHeaders = {
  'X-Client-App': 'vividrop-desktop',
  'X-Client-Platform': process.platform,
  'X-Client-Version': '0.1.0',
};

describe('sidecarClient', () => {
  beforeEach(() => {
    const sessionFile = join(tmpdir(), 'vividrop-test-userdata', 'session.json');
    if (existsSync(sessionFile)) {
      try {
        unlinkSync(sessionFile);
      } catch {}
    }
    vi.clearAllMocks();
  });

  it('fetches client config from the public API without user auth', async () => {
    const httpRequest = vi.fn();
    const httpsRequest = vi.fn((options: RequestOptions, callback: (res: unknown) => void) => {
      const req = new EventEmitter() as EventEmitter & {
        on: typeof EventEmitter.prototype.on;
        write: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
      };
      req.write = vi.fn();
      req.end = vi.fn();
      callback(
        createResponse(
          200,
          JSON.stringify({
            code: 0,
            message: 'success',
            data: { features: { gift_card: { enabled: true } } },
          }),
        ),
      );
      return req;
    });

    vi.doMock('node:http', () => ({
      default: { request: httpRequest },
      request: httpRequest,
    }));
    vi.doMock('node:https', () => ({
      default: { request: httpsRequest },
      request: httpsRequest,
    }));

    vi.resetModules();
    vi.stubEnv('SYNCFLOW_CLIENT_CONFIG_BASE_URL', 'https://config.example.test');
    vi.stubEnv('SYNCFLOW_GIFTCARD_REDEEM_TOKEN', 'redeem-token');

    const { sidecarClient: client } = await import('../sidecar-client');

    await expect(client.getClientConfig()).resolves.toEqual({
      features: { giftCard: { enabled: true } },
    });

    expect(httpRequest).not.toHaveBeenCalled();
    expect(httpsRequest).toHaveBeenCalledTimes(1);
    const [options] = httpsRequest.mock.calls[0] as [RequestOptions, (res: unknown) => void];
    expect(options.protocol).toBe('https:');
    expect(options.hostname).toBe('config.example.test');
    expect(options.path).toBe('/api/v1/config');
    expect(options.method).toBe('GET');
    expect(options.headers).toEqual({
      'Content-Type': 'application/json',
      ...remoteClientHeaders,
    });

    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('uses https transport when the redeem base url is https', async () => {
    const httpRequest = vi.fn();
    const httpsRequest = vi.fn((options: RequestOptions, callback: (res: unknown) => void) => {
      const req = new EventEmitter() as EventEmitter & {
        on: typeof EventEmitter.prototype.on;
        write: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
      };
      req.write = vi.fn();
      req.end = vi.fn();
      callback(
        createResponse(
          200,
          JSON.stringify({
            code: 0,
            message: 'success',
            data: { plan: 'monthly', gift_card_id: 12 },
          }),
        ),
      );
      return req;
    });

    vi.doMock('node:http', () => ({
      default: { request: httpRequest },
      request: httpRequest,
    }));
    vi.doMock('node:https', () => ({
      default: { request: httpsRequest },
      request: httpsRequest,
    }));

    vi.resetModules();
    vi.stubEnv('SYNCFLOW_GIFTCARD_REDEEM_BASE_URL', 'https://gift.example.test');

    const { sidecarClient: client } = await import('../sidecar-client');

    await expect(client.redeemGiftCard({ code: 'ABCD-EFGH-IJKL' })).resolves.toEqual({
      ok: true,
    });

    expect(httpRequest).not.toHaveBeenCalled();
    expect(httpsRequest).toHaveBeenCalledTimes(1);
    const [options, callback] = httpsRequest.mock.calls[0] as [
      RequestOptions,
      (res: unknown) => void,
    ];
    expect(options.protocol).toBe('https:');
    expect(options.hostname).toBe('gift.example.test');
    expect(options.path).toBe('/api/v1/gift-cards/redeem');
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({
      'Content-Type': 'application/json',
      ...remoteClientHeaders,
    });
    expect(typeof callback).toBe('function');

    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('defaults gift card redeem requests to the production API base', async () => {
    const httpRequest = vi.fn();
    const httpsRequest = vi.fn((options: RequestOptions, callback: (res: unknown) => void) => {
      const req = new EventEmitter() as EventEmitter & {
        on: typeof EventEmitter.prototype.on;
        write: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
      };
      req.write = vi.fn();
      req.end = vi.fn();
      callback(createResponse(200, JSON.stringify({ code: 0, message: 'success', data: {} })));
      return req;
    });

    vi.doMock('node:http', () => ({
      default: { request: httpRequest },
      request: httpRequest,
    }));
    vi.doMock('node:https', () => ({
      default: { request: httpsRequest },
      request: httpsRequest,
    }));

    vi.resetModules();
    vi.stubEnv('SYNCFLOW_GIFTCARD_REDEEM_BASE_URL', '');
    vi.stubEnv('VIVIDROP_API_BASE_URL', '');
    vi.stubEnv('SYNCFLOW_API_BASE_URL', '');

    const { sidecarClient: client } = await import('../sidecar-client');

    await expect(client.redeemGiftCard({ code: 'ABCD-EFGH-IJKL' })).resolves.toEqual({
      ok: true,
    });

    expect(httpRequest).not.toHaveBeenCalled();
    expect(httpsRequest).toHaveBeenCalledTimes(1);
    const [options] = httpsRequest.mock.calls[0] as [RequestOptions, (res: unknown) => void];
    expect(options.protocol).toBe('https:');
    expect(options.hostname).toBe('api.vividrop.cn');
    expect(options.path).toBe('/api/v1/gift-cards/redeem');

    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('defaults global builds to the global production API base', async () => {
    const httpRequest = vi.fn();
    const httpsRequest = vi.fn((options: RequestOptions, callback: (res: unknown) => void) => {
      const req = new EventEmitter() as EventEmitter & {
        on: typeof EventEmitter.prototype.on;
        write: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
      };
      req.write = vi.fn();
      req.end = vi.fn();
      callback(createResponse(200, JSON.stringify({ code: 0, message: 'success', data: {} })));
      return req;
    });

    vi.doMock('node:http', () => ({
      default: { request: httpRequest },
      request: httpRequest,
    }));
    vi.doMock('node:https', () => ({
      default: { request: httpsRequest },
      request: httpsRequest,
    }));

    vi.resetModules();
    vi.stubEnv('SYNCFLOW_MARKET', 'global');
    vi.stubEnv('SYNCFLOW_GIFTCARD_REDEEM_BASE_URL', '');
    vi.stubEnv('VIVIDROP_API_BASE_URL', '');
    vi.stubEnv('SYNCFLOW_API_BASE_URL', '');

    const { sidecarClient: client } = await import('../sidecar-client');

    await expect(client.redeemGiftCard({ code: 'ABCD-EFGH-IJKL' })).resolves.toEqual({
      ok: true,
    });

    expect(httpRequest).not.toHaveBeenCalled();
    expect(httpsRequest).toHaveBeenCalledTimes(1);
    const [options] = httpsRequest.mock.calls[0] as [RequestOptions, (res: unknown) => void];
    expect(options.hostname).toBe('global-api.vividrop.cn');
    expect(options.path).toBe('/api/v1/gift-cards/redeem');

    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('adds bearer auth to gift card redeem requests when a token is configured', async () => {
    const httpRequest = vi.fn();
    const httpsRequest = vi.fn((options: RequestOptions, callback: (res: unknown) => void) => {
      const req = new EventEmitter() as EventEmitter & {
        on: typeof EventEmitter.prototype.on;
        write: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
      };
      req.write = vi.fn();
      req.end = vi.fn();
      callback(createResponse(200, JSON.stringify({ code: 0, message: 'success', data: {} })));
      return req;
    });

    vi.doMock('node:http', () => ({
      default: { request: httpRequest },
      request: httpRequest,
    }));
    vi.doMock('node:https', () => ({
      default: { request: httpsRequest },
      request: httpsRequest,
    }));

    vi.resetModules();
    vi.stubEnv('SYNCFLOW_GIFTCARD_REDEEM_BASE_URL', 'https://gift.example.test');
    vi.stubEnv('SYNCFLOW_GIFTCARD_REDEEM_TOKEN', 'redeem-token');

    const { sidecarClient: client } = await import('../sidecar-client');

    await expect(client.redeemGiftCard({ code: 'ABCD-EFGH-IJKL' })).resolves.toEqual({
      ok: true,
    });

    expect(httpRequest).not.toHaveBeenCalled();
    expect(httpsRequest).toHaveBeenCalledTimes(1);
    const [options] = httpsRequest.mock.calls[0] as [RequestOptions, (res: unknown) => void];
    expect(options.headers).toEqual({
      'Content-Type': 'application/json',
      ...remoteClientHeaders,
      Authorization: 'Bearer redeem-token',
    });

    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('normalizes server business errors from the response envelope', async () => {
    const httpRequest = vi.fn();
    const httpsRequest = vi.fn((options: RequestOptions, callback: (res: unknown) => void) => {
      const req = new EventEmitter() as EventEmitter & {
        on: typeof EventEmitter.prototype.on;
        write: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
      };
      req.write = vi.fn();
      req.end = vi.fn();
      callback(
        createResponse(200, JSON.stringify({ code: 3001, message: '禮品卡碼無效', data: {} })),
      );
      return req;
    });

    vi.doMock('node:http', () => ({
      default: { request: httpRequest },
      request: httpRequest,
    }));
    vi.doMock('node:https', () => ({
      default: { request: httpsRequest },
      request: httpsRequest,
    }));

    vi.resetModules();
    vi.stubEnv('SYNCFLOW_GIFTCARD_REDEEM_BASE_URL', 'https://gift.example.test');

    const { sidecarClient: client } = await import('../sidecar-client');

    await expect(client.redeemGiftCard({ code: 'ABCD-EFGH-IJKL' })).resolves.toEqual({
      ok: false,
      reason: 'invalid_code',
      message: '禮品卡碼無效',
    });

    expect(httpRequest).not.toHaveBeenCalled();
    expect(httpsRequest).toHaveBeenCalledTimes(1);

    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('maps duplicate gift card redemption to an already-redeemed reason', async () => {
    const httpRequest = vi.fn();
    const httpsRequest = vi.fn((options: RequestOptions, callback: (res: unknown) => void) => {
      const req = new EventEmitter() as EventEmitter & {
        on: typeof EventEmitter.prototype.on;
        write: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
      };
      req.write = vi.fn();
      req.end = vi.fn();
      callback(
        createResponse(
          200,
          JSON.stringify({ code: 3004, message: '此帳號已兌換過此禮品卡', data: {} }),
        ),
      );
      return req;
    });

    vi.doMock('node:http', () => ({
      default: { request: httpRequest },
      request: httpRequest,
    }));
    vi.doMock('node:https', () => ({
      default: { request: httpsRequest },
      request: httpsRequest,
    }));

    vi.resetModules();
    vi.stubEnv('SYNCFLOW_GIFTCARD_REDEEM_BASE_URL', 'https://gift.example.test');

    const { sidecarClient: client } = await import('../sidecar-client');

    await expect(client.redeemGiftCard({ code: 'ABCD-EFGH-IJKL' })).resolves.toEqual({
      ok: false,
      reason: 'already_redeemed',
      message: '此帳號已兌換過此禮品卡',
    });

    expect(httpRequest).not.toHaveBeenCalled();
    expect(httpsRequest).toHaveBeenCalledTimes(1);

    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('maps token-invalid response envelopes to a gift card auth-required reason', async () => {
    const httpRequest = vi.fn();
    const httpsRequest = vi.fn((options: RequestOptions, callback: (res: unknown) => void) => {
      const req = new EventEmitter() as EventEmitter & {
        on: typeof EventEmitter.prototype.on;
        write: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
      };
      req.write = vi.fn();
      req.end = vi.fn();
      callback(
        createResponse(
          200,
          JSON.stringify({ code: 1006, message: 'Token 無效或已過期', data: {} }),
        ),
      );
      return req;
    });

    vi.doMock('node:http', () => ({
      default: { request: httpRequest },
      request: httpRequest,
    }));
    vi.doMock('node:https', () => ({
      default: { request: httpsRequest },
      request: httpsRequest,
    }));

    vi.resetModules();
    vi.stubEnv('SYNCFLOW_GIFTCARD_REDEEM_BASE_URL', 'https://gift.example.test');

    const { sidecarClient: client } = await import('../sidecar-client');

    await expect(client.redeemGiftCard({ code: 'ABCD-EFGH-IJKL' })).resolves.toEqual({
      ok: false,
      reason: 'auth_required',
      message: 'Token 無效或已過期',
    });

    expect(httpRequest).not.toHaveBeenCalled();
    expect(httpsRequest).toHaveBeenCalledTimes(1);

    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('maps auth failures to a gift card auth-required reason', async () => {
    const httpRequest = vi.fn();
    const httpsRequest = vi.fn((options: RequestOptions, callback: (res: unknown) => void) => {
      const req = new EventEmitter() as EventEmitter & {
        on: typeof EventEmitter.prototype.on;
        write: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
      };
      req.write = vi.fn();
      req.end = vi.fn();
      callback(createResponse(401, JSON.stringify({ code: 1006, message: 'Token 無效或已過期' })));
      return req;
    });

    vi.doMock('node:http', () => ({
      default: { request: httpRequest },
      request: httpRequest,
    }));
    vi.doMock('node:https', () => ({
      default: { request: httpsRequest },
      request: httpsRequest,
    }));

    vi.resetModules();
    vi.stubEnv('SYNCFLOW_GIFTCARD_REDEEM_BASE_URL', 'https://gift.example.test');

    const { sidecarClient: client } = await import('../sidecar-client');

    await expect(client.redeemGiftCard({ code: 'ABCD-EFGH-IJKL' })).resolves.toEqual({
      ok: false,
      reason: 'auth_required',
    });

    expect(httpRequest).not.toHaveBeenCalled();
    expect(httpsRequest).toHaveBeenCalledTimes(1);

    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('does not reuse the diagnostics token for gift card redeem requests', async () => {
    const httpRequest = vi.fn();
    const httpsRequest = vi.fn((options: RequestOptions, callback: (res: unknown) => void) => {
      const req = new EventEmitter() as EventEmitter & {
        on: typeof EventEmitter.prototype.on;
        write: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
      };
      req.write = vi.fn();
      req.end = vi.fn();
      callback(createResponse(200, JSON.stringify({ code: 0, message: 'success', data: {} })));
      return req;
    });

    vi.doMock('node:http', () => ({
      default: { request: httpRequest },
      request: httpRequest,
    }));
    vi.doMock('node:https', () => ({
      default: { request: httpsRequest },
      request: httpsRequest,
    }));

    vi.resetModules();
    vi.stubEnv('SYNCFLOW_GIFTCARD_REDEEM_BASE_URL', 'https://gift.example.test');
    vi.stubEnv('VIVIDROP_DIAGNOSTICS_TOKEN', 'diagnostics-token');

    const { sidecarClient: client } = await import('../sidecar-client');

    await expect(client.redeemGiftCard({ code: 'ABCD-EFGH-IJKL' })).resolves.toEqual({
      ok: true,
    });

    expect(httpRequest).not.toHaveBeenCalled();
    expect(httpsRequest).toHaveBeenCalledTimes(1);
    const [options] = httpsRequest.mock.calls[0] as [RequestOptions, (res: unknown) => void];
    expect(options.headers).toEqual({
      'Content-Type': 'application/json',
      ...remoteClientHeaders,
    });

    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('does not reuse generic API tokens for gift card redeem requests', async () => {
    const httpRequest = vi.fn();
    const httpsRequest = vi.fn((options: RequestOptions, callback: (res: unknown) => void) => {
      const req = new EventEmitter() as EventEmitter & {
        on: typeof EventEmitter.prototype.on;
        write: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
      };
      req.write = vi.fn();
      req.end = vi.fn();
      callback(createResponse(200, JSON.stringify({ code: 0, message: 'success', data: {} })));
      return req;
    });

    vi.doMock('node:http', () => ({
      default: { request: httpRequest },
      request: httpRequest,
    }));
    vi.doMock('node:https', () => ({
      default: { request: httpsRequest },
      request: httpsRequest,
    }));

    vi.resetModules();
    vi.stubEnv('SYNCFLOW_GIFTCARD_REDEEM_BASE_URL', 'https://gift.example.test');
    vi.stubEnv('VIVIDROP_API_TOKEN', 'api-token');
    vi.stubEnv('SYNCFLOW_API_TOKEN', 'sync-token');

    const { sidecarClient: client } = await import('../sidecar-client');

    await expect(client.redeemGiftCard({ code: 'ABCD-EFGH-IJKL' })).resolves.toEqual({
      ok: true,
    });

    expect(httpRequest).not.toHaveBeenCalled();
    expect(httpsRequest).toHaveBeenCalledTimes(1);
    const [options] = httpsRequest.mock.calls[0] as [RequestOptions, (res: unknown) => void];
    expect(options.headers).toEqual({
      'Content-Type': 'application/json',
      ...remoteClientHeaders,
    });

    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('uses the phone login access token for subsequent gift card redeem requests', async () => {
    const httpRequest = vi.fn();
    const httpsRequest = vi.fn((options: RequestOptions, callback: (res: unknown) => void) => {
      const req = new EventEmitter() as EventEmitter & {
        on: typeof EventEmitter.prototype.on;
        write: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
      };
      req.write = vi.fn();
      req.end = vi.fn();

      if (options.path === '/api/v1/auth/sms/login') {
        callback(
          createResponse(
            200,
            JSON.stringify({
              code: 0,
              message: 'success',
              data: {
                access_token: 'user-access-token',
                refresh_token: 'user-refresh-token',
                user_id: 42,
                is_new_user: true,
                merged: false,
              },
            }),
          ),
        );
        return req;
      }

      callback(createResponse(200, JSON.stringify({ code: 0, message: 'success', data: {} })));
      return req;
    });

    vi.doMock('node:http', () => ({
      default: { request: httpRequest },
      request: httpRequest,
    }));
    vi.doMock('node:https', () => ({
      default: { request: httpsRequest },
      request: httpsRequest,
    }));

    vi.resetModules();
    vi.stubEnv('SYNCFLOW_GIFTCARD_REDEEM_BASE_URL', 'https://gift.example.test');

    const { sidecarClient: client } = await import('../sidecar-client');

    await expect(
      client.loginWithSMSCode({ phone: '13800138000', code: '123456' }),
    ).resolves.toEqual({
      ok: true,
      userId: 42,
      isNewUser: true,
      merged: false,
    });
    await expect(client.redeemGiftCard({ code: 'ABCD-EFGH-IJKL' })).resolves.toEqual({
      ok: true,
    });

    expect(httpsRequest).toHaveBeenCalledTimes(2);
    const [, redeemCall] = httpsRequest.mock.calls;
    const [redeemOptions] = redeemCall as [RequestOptions, (res: unknown) => void];
    expect(redeemOptions.path).toBe('/api/v1/gift-cards/redeem');
    expect(redeemOptions.headers).toEqual({
      'Content-Type': 'application/json',
      ...remoteClientHeaders,
      Authorization: 'Bearer user-access-token',
    });

    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('normalizes Google login user metadata from the auth response envelope', async () => {
    const httpRequest = vi.fn();
    const accessToken = createUnsignedJwt({
      phone: '+8613800138000',
      email: 'ada@example.com',
    });
    const httpsRequest = vi.fn((options: RequestOptions, callback: (res: unknown) => void) => {
      const req = new EventEmitter() as EventEmitter & {
        on: typeof EventEmitter.prototype.on;
        write: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
      };
      req.write = vi.fn();
      req.end = vi.fn();
      callback(
        createResponse(
          200,
          JSON.stringify({
            code: 0,
            message: 'success',
            data: {
              access_token: accessToken,
              refresh_token: 'google-refresh-token',
              user_id: 77,
              is_new_user: false,
              merged: true,
            },
          }),
        ),
      );
      return req;
    });

    vi.doMock('node:http', () => ({
      default: { request: httpRequest },
      request: httpRequest,
    }));
    vi.doMock('node:https', () => ({
      default: { request: httpsRequest },
      request: httpsRequest,
    }));

    vi.resetModules();
    vi.stubEnv('SYNCFLOW_AUTH_BASE_URL', 'https://auth.example.test');

    const { sidecarClient: client } = await import('../sidecar-client');

    await expect(client.loginWithGoogle({ identityToken: 'id-token' })).resolves.toEqual({
      ok: true,
      userId: 77,
      isNewUser: false,
      merged: true,
    });

    expect(httpRequest).not.toHaveBeenCalled();
    expect(httpsRequest).toHaveBeenCalledTimes(1);
    const [options] = httpsRequest.mock.calls[0] as [RequestOptions, (res: unknown) => void];
    expect(options.path).toBe('/api/v1/auth/google/login');
    expect(client.getAuthSessionView()).toEqual({
      loggedIn: true,
      phone: '+8613800138000',
      email: 'ada@example.com',
    });

    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('routes OAuth login to the review API when only the review auth base is configured', async () => {
    const httpRequest = vi.fn();
    const httpsRequest = vi.fn((options: RequestOptions, callback: (res: unknown) => void) => {
      const req = new EventEmitter() as EventEmitter & {
        on: typeof EventEmitter.prototype.on;
        write: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
      };
      req.write = vi.fn();
      req.end = vi.fn();
      callback(
        createResponse(
          200,
          JSON.stringify({
            code: 0,
            message: 'success',
            data: {
              access_token: 'apple-access-token',
              refresh_token: 'apple-refresh-token',
              user_id: 88,
              is_new_user: true,
              merged: false,
            },
          }),
        ),
      );
      return req;
    });

    vi.doMock('node:http', () => ({
      default: { request: httpRequest },
      request: httpRequest,
    }));
    vi.doMock('node:https', () => ({
      default: { request: httpsRequest },
      request: httpsRequest,
    }));

    vi.resetModules();
    vi.stubEnv('SYNCFLOW_AUTH_REVIEW_BASE_URL', 'https://review-api.vividrop.cn');

    const { sidecarClient: client } = await import('../sidecar-client');

    await expect(
      client.loginWithApple({
        identityToken: 'id-token',
        authorizationCode: 'auth-code',
      }),
    ).resolves.toEqual({
      ok: true,
      userId: 88,
      isNewUser: true,
      merged: false,
    });

    expect(httpRequest).not.toHaveBeenCalled();
    expect(httpsRequest).toHaveBeenCalledTimes(1);
    const [options] = httpsRequest.mock.calls[0] as [RequestOptions, (res: unknown) => void];
    expect(options.hostname).toBe('review-api.vividrop.cn');
    expect(options.path).toBe('/api/v1/auth/apple/login');
    expect(client.getAuthSession()).toEqual({
      accessToken: 'apple-access-token',
      refreshToken: 'apple-refresh-token',
      baseUrl: 'https://review-api.vividrop.cn',
    });

    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('routes global dev OAuth login to the configured review API base URL', async () => {
    const httpRequest = vi.fn();
    const httpsRequest = vi.fn((options: RequestOptions, callback: (res: unknown) => void) => {
      const req = new EventEmitter() as EventEmitter & {
        on: typeof EventEmitter.prototype.on;
        write: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
      };
      req.write = vi.fn();
      req.end = vi.fn();
      callback(
        createResponse(
          200,
          JSON.stringify({
            code: 0,
            message: 'success',
            data: {
              access_token: 'google-access-token',
              refresh_token: 'google-refresh-token',
              user_id: 77,
              is_new_user: false,
              merged: false,
            },
          }),
        ),
      );
      return req;
    });

    vi.doMock('node:http', () => ({
      default: { request: httpRequest },
      request: httpRequest,
    }));
    vi.doMock('node:https', () => ({
      default: { request: httpsRequest },
      request: httpsRequest,
    }));

    vi.resetModules();
    vi.stubEnv('SYNCFLOW_MARKET', 'global');
    vi.stubEnv('SYNCFLOW_API_BASE_URL', 'https://review-api.vividrop.cn');
    vi.stubEnv('SYNCFLOW_GIFTCARD_REDEEM_BASE_URL', 'https://review-api.vividrop.cn');

    const { sidecarClient: client } = await import('../sidecar-client');

    await expect(client.loginWithGoogle({ identityToken: 'id-token' })).resolves.toEqual({
      ok: true,
      userId: 77,
      isNewUser: false,
      merged: false,
    });

    expect(httpRequest).not.toHaveBeenCalled();
    expect(httpsRequest).toHaveBeenCalledTimes(1);
    const [options] = httpsRequest.mock.calls[0] as [RequestOptions, (res: unknown) => void];
    expect(options.hostname).toBe('review-api.vividrop.cn');
    expect(options.path).toBe('/api/v1/auth/google/login');
    expect(client.getAuthSession()).toEqual({
      accessToken: 'google-access-token',
      refreshToken: 'google-refresh-token',
      baseUrl: 'https://review-api.vividrop.cn',
    });

    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('logs the selected Google auth API target and network failure diagnostics', async () => {
    const httpRequest = vi.fn();
    const networkError = Object.assign(
      new Error('getaddrinfo ENOTFOUND review-api.vividrop.cn'),
      { code: 'ENOTFOUND' },
    );
    const httpsRequest = vi.fn(() => {
      const req = new EventEmitter() as EventEmitter & {
        on: typeof EventEmitter.prototype.on;
        write: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
      };
      req.write = vi.fn();
      req.end = vi.fn(() => {
        queueMicrotask(() => req.emit('error', networkError));
      });
      return req;
    });

    vi.doMock('node:http', () => ({
      default: { request: httpRequest },
      request: httpRequest,
    }));
    vi.doMock('node:https', () => ({
      default: { request: httpsRequest },
      request: httpsRequest,
    }));

    vi.resetModules();
    vi.stubEnv('SYNCFLOW_MARKET', 'global');
    vi.stubEnv('SYNCFLOW_API_BASE_URL', 'https://review-api.vividrop.cn');

    const { sidecarClient: client } = await import('../sidecar-client');

    await expect(client.loginWithGoogle({ identityToken: 'id-token' })).rejects.toThrow(
      'getaddrinfo ENOTFOUND review-api.vividrop.cn',
    );

    expect(logInfoMock).toHaveBeenCalledWith('[sidecar-client] Starting Google auth login.', {
      baseUrl: 'https://review-api.vividrop.cn',
      path: '/api/v1/auth/google/login',
    });
    expect(logErrorMock).toHaveBeenCalledWith('[sidecar-client] Remote API request failed.', {
      method: 'POST',
      url: 'https://review-api.vividrop.cn/api/v1/auth/google/login',
      name: 'Error',
      message: 'getaddrinfo ENOTFOUND review-api.vividrop.cn',
      code: 'ENOTFOUND',
    });

    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('maps SMS throttling response envelopes to a structured auth reason', async () => {
    const httpRequest = vi.fn();
    const httpsRequest = vi.fn((options: RequestOptions, callback: (res: unknown) => void) => {
      const req = new EventEmitter() as EventEmitter & {
        on: typeof EventEmitter.prototype.on;
        write: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
      };
      req.write = vi.fn();
      req.end = vi.fn();
      callback(
        createResponse(
          200,
          JSON.stringify({ code: 1002, message: '驗證碼發送過於頻繁', data: {} }),
        ),
      );
      return req;
    });

    vi.doMock('node:http', () => ({
      default: { request: httpRequest },
      request: httpRequest,
    }));
    vi.doMock('node:https', () => ({
      default: { request: httpsRequest },
      request: httpsRequest,
    }));

    vi.resetModules();
    vi.stubEnv('SYNCFLOW_AUTH_BASE_URL', 'https://gift.example.test');

    const { sidecarClient: client } = await import('../sidecar-client');

    await expect(client.sendSMSCode({ phone: '13800138000' })).resolves.toEqual({
      ok: false,
      reason: 'sms_too_frequent',
      message: '驗證碼發送過於頻繁',
    });

    expect(httpRequest).not.toHaveBeenCalled();
    expect(httpsRequest).toHaveBeenCalledTimes(1);

    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('routes App Review phone SMS requests to the review API base URL', async () => {
    const httpRequest = vi.fn();
    const httpsRequest = vi.fn((options: RequestOptions, callback: (res: unknown) => void) => {
      const req = new EventEmitter() as EventEmitter & {
        on: typeof EventEmitter.prototype.on;
        write: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
      };
      req.write = vi.fn();
      req.end = vi.fn();
      callback(createResponse(200, JSON.stringify({ code: 0, message: 'success', data: {} })));
      return req;
    });

    vi.doMock('node:http', () => ({
      default: { request: httpRequest },
      request: httpRequest,
    }));
    vi.doMock('node:https', () => ({
      default: { request: httpsRequest },
      request: httpsRequest,
    }));

    vi.resetModules();
    vi.stubEnv('SYNCFLOW_APP_REVIEW_PHONE', '17000000002');

    const { sidecarClient: client } = await import('../sidecar-client');

    await expect(client.sendSMSCode({ phone: '+8617000000002' })).resolves.toEqual({
      ok: true,
    });

    expect(httpRequest).not.toHaveBeenCalled();
    expect(httpsRequest).toHaveBeenCalledTimes(1);
    const [options] = httpsRequest.mock.calls[0] as [RequestOptions, (res: unknown) => void];
    expect(options.hostname).toBe('review-api.vividrop.cn');
    expect(options.path).toBe('/api/v1/auth/sms/send');

    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('lets explicit auth base URL overrides bypass App Review phone routing', async () => {
    const httpRequest = vi.fn();
    const httpsRequest = vi.fn((options: RequestOptions, callback: (res: unknown) => void) => {
      const req = new EventEmitter() as EventEmitter & {
        on: typeof EventEmitter.prototype.on;
        write: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
      };
      req.write = vi.fn();
      req.end = vi.fn();
      callback(createResponse(200, JSON.stringify({ code: 0, message: 'success', data: {} })));
      return req;
    });

    vi.doMock('node:http', () => ({
      default: { request: httpRequest },
      request: httpRequest,
    }));
    vi.doMock('node:https', () => ({
      default: { request: httpsRequest },
      request: httpsRequest,
    }));

    vi.resetModules();
    vi.stubEnv('SYNCFLOW_AUTH_BASE_URL', 'https://auth.example.test');
    vi.stubEnv('SYNCFLOW_APP_REVIEW_PHONE', '17000000002');

    const { sidecarClient: client } = await import('../sidecar-client');

    await expect(client.sendSMSCode({ phone: '+8617000000002' })).resolves.toEqual({
      ok: true,
    });

    expect(httpRequest).not.toHaveBeenCalled();
    expect(httpsRequest).toHaveBeenCalledTimes(1);
    const [options] = httpsRequest.mock.calls[0] as [RequestOptions, (res: unknown) => void];
    expect(options.hostname).toBe('auth.example.test');
    expect(options.path).toBe('/api/v1/auth/sms/send');

    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('maps invalid SMS code response envelopes to a structured auth reason', async () => {
    const httpRequest = vi.fn();
    const httpsRequest = vi.fn((options: RequestOptions, callback: (res: unknown) => void) => {
      const req = new EventEmitter() as EventEmitter & {
        on: typeof EventEmitter.prototype.on;
        write: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
      };
      req.write = vi.fn();
      req.end = vi.fn();
      callback(
        createResponse(200, JSON.stringify({ code: 1004, message: '驗證碼錯誤', data: {} })),
      );
      return req;
    });

    vi.doMock('node:http', () => ({
      default: { request: httpRequest },
      request: httpRequest,
    }));
    vi.doMock('node:https', () => ({
      default: { request: httpsRequest },
      request: httpsRequest,
    }));

    vi.resetModules();
    vi.stubEnv('SYNCFLOW_AUTH_BASE_URL', 'https://gift.example.test');

    const { sidecarClient: client } = await import('../sidecar-client');

    await expect(
      client.loginWithSMSCode({ phone: '13800138000', code: '123456' }),
    ).resolves.toEqual({
      ok: false,
      reason: 'sms_code_invalid',
      message: '驗證碼錯誤',
    });

    expect(httpRequest).not.toHaveBeenCalled();
    expect(httpsRequest).toHaveBeenCalledTimes(1);

    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('persists the App Review SMS login base URL with the auth session', async () => {
    const httpRequest = vi.fn();
    const httpsRequest = vi.fn((options: RequestOptions, callback: (res: unknown) => void) => {
      const req = new EventEmitter() as EventEmitter & {
        on: typeof EventEmitter.prototype.on;
        write: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
      };
      req.write = vi.fn();
      req.end = vi.fn();
      callback(
        createResponse(
          200,
          JSON.stringify({
            code: 0,
            message: 'success',
            data: {
              access_token: 'review-access-token',
              refresh_token: 'review-refresh-token',
              user_id: 42,
              is_new_user: false,
              merged: false,
            },
          }),
        ),
      );
      return req;
    });

    vi.doMock('node:http', () => ({
      default: { request: httpRequest },
      request: httpRequest,
    }));
    vi.doMock('node:https', () => ({
      default: { request: httpsRequest },
      request: httpsRequest,
    }));

    vi.resetModules();
    vi.stubEnv('SYNCFLOW_APP_REVIEW_PHONE', '17000000002');

    const { sidecarClient: client } = await import('../sidecar-client');

    await expect(
      client.loginWithSMSCode({ phone: '+8617000000002', code: '123456' }),
    ).resolves.toEqual({
      ok: true,
      userId: 42,
      isNewUser: false,
      merged: false,
    });

    expect(client.getAuthSession()).toEqual({
      accessToken: 'review-access-token',
      refreshToken: 'review-refresh-token',
      baseUrl: 'https://review-api.vividrop.cn',
    });
    const [options] = httpsRequest.mock.calls[0] as [RequestOptions, (res: unknown) => void];
    expect(options.hostname).toBe('review-api.vividrop.cn');
    expect(options.path).toBe('/api/v1/auth/sms/login');

    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('uses the App Review auth session base URL for subsequent gift card redemption', async () => {
    const httpRequest = vi.fn();
    const httpsRequest = vi.fn((options: RequestOptions, callback: (res: unknown) => void) => {
      const req = new EventEmitter() as EventEmitter & {
        on: typeof EventEmitter.prototype.on;
        write: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
      };
      req.write = vi.fn();
      req.end = vi.fn();

      if (options.path === '/api/v1/auth/sms/login') {
        callback(
          createResponse(
            200,
            JSON.stringify({
              code: 0,
              message: 'success',
              data: {
                access_token: 'review-access-token',
                refresh_token: 'review-refresh-token',
                user_id: 42,
                is_new_user: false,
                merged: false,
              },
            }),
          ),
        );
        return req;
      }

      callback(createResponse(200, JSON.stringify({ code: 0, message: 'success', data: {} })));
      return req;
    });

    vi.doMock('node:http', () => ({
      default: { request: httpRequest },
      request: httpRequest,
    }));
    vi.doMock('node:https', () => ({
      default: { request: httpsRequest },
      request: httpsRequest,
    }));

    vi.resetModules();
    vi.stubEnv('SYNCFLOW_APP_REVIEW_PHONE', '17000000002');

    const { sidecarClient: client } = await import('../sidecar-client');

    await expect(
      client.loginWithSMSCode({ phone: '+8617000000002', code: '123456' }),
    ).resolves.toEqual({
      ok: true,
      userId: 42,
      isNewUser: false,
      merged: false,
    });
    await expect(client.redeemGiftCard({ code: 'ABCD-EFGH-IJKL' })).resolves.toEqual({
      ok: true,
    });

    expect(httpRequest).not.toHaveBeenCalled();
    expect(httpsRequest).toHaveBeenCalledTimes(2);
    const [, redeemCall] = httpsRequest.mock.calls;
    const [redeemOptions] = redeemCall as [RequestOptions, (res: unknown) => void];
    expect(redeemOptions.hostname).toBe('review-api.vividrop.cn');
    expect(redeemOptions.path).toBe('/api/v1/gift-cards/redeem');
    expect(redeemOptions.headers).toEqual({
      'Content-Type': 'application/json',
      ...remoteClientHeaders,
      Authorization: 'Bearer review-access-token',
    });

    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('loads persistent session from session.json on startup and removes it on logout', async () => {
    const { writeFileSync, existsSync } = require('node:fs');
    const { join } = require('node:path');
    const { tmpdir } = require('node:os');

    const userDataPath = join(tmpdir(), 'vividrop-test-userdata');
    const sessionFilePath = join(userDataPath, 'session.json');

    const mockAccessToken = 'test-access-token';
    const mockRefreshToken = 'test-refresh-token';
    const encryptedAccess = Buffer.from(mockAccessToken).toString('base64');
    const encryptedRefresh = Buffer.from(mockRefreshToken).toString('base64');

    const mockData = {
      accessToken: encryptedAccess,
      refreshToken: encryptedRefresh,
      encrypted: true,
    };

    writeFileSync(sessionFilePath, JSON.stringify(mockData, null, 2), 'utf8');

    const httpRequest = vi.fn((options: RequestOptions, callback: (res: unknown) => void) => {
      const req = new EventEmitter() as EventEmitter & {
        on: typeof EventEmitter.prototype.on;
        write: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
      };
      req.write = vi.fn();
      req.end = vi.fn();
      callback(createResponse(200, JSON.stringify({ ok: true })));
      return req;
    });

    vi.doMock('node:http', () => ({
      default: { request: httpRequest },
      request: httpRequest,
    }));

    vi.resetModules();
    const { sidecarClient: client } = await import('../sidecar-client');

    const session = client.getAuthSession();
    expect(session).toEqual({
      accessToken: mockAccessToken,
      refreshToken: mockRefreshToken,
    });

    await client.logout();

    expect(client.getAuthSession()).toBeNull();
    expect(existsSync(sessionFilePath)).toBe(false);

    vi.resetModules();
  });

  describe('refreshSession', () => {
    it('refreshes the session successfully when token is valid', async () => {
      const { writeFileSync } = require('node:fs');
      const { join } = require('node:path');
      const { tmpdir } = require('node:os');
      const userDataPath = join(tmpdir(), 'vividrop-test-userdata');
      const sessionFilePath = join(userDataPath, 'session.json');

      const mockData = {
        accessToken: Buffer.from('old-access-token').toString('base64'),
        refreshToken: Buffer.from('old-refresh-token').toString('base64'),
        encrypted: true,
      };
      writeFileSync(sessionFilePath, JSON.stringify(mockData, null, 2), 'utf8');

      const httpsRequest = vi.fn((options: RequestOptions, callback: (res: unknown) => void) => {
        const req = new EventEmitter() as EventEmitter & {
          on: typeof EventEmitter.prototype.on;
          write: ReturnType<typeof vi.fn>;
          end: ReturnType<typeof vi.fn>;
        };
        req.write = vi.fn();
        req.end = vi.fn();

        if (options.path === '/api/v1/auth/refresh') {
          callback(
            createResponse(
              200,
              JSON.stringify({
                code: 0,
                message: 'success',
                data: {
                  access_token: 'new-access-token',
                  refresh_token: 'new-refresh-token',
                },
              }),
            ),
          );
        }
        return req;
      });

      vi.doMock('node:https', () => ({
        default: { request: httpsRequest },
        request: httpsRequest,
      }));

      vi.resetModules();
      const { sidecarClient: client } = await import('../sidecar-client');

      const result = await client.refreshSession();
      expect(result).toBe(true);
      expect(client.getAuthSession()).toEqual({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });
      vi.resetModules();
    });

    it('refreshes against the base URL persisted with the SMS auth session', async () => {
      const { writeFileSync } = require('node:fs');
      const { join } = require('node:path');
      const { tmpdir } = require('node:os');
      const userDataPath = join(tmpdir(), 'vividrop-test-userdata');
      const sessionFilePath = join(userDataPath, 'session.json');

      const mockData = {
        accessToken: Buffer.from('old-access-token').toString('base64'),
        refreshToken: Buffer.from('old-refresh-token').toString('base64'),
        baseUrl: 'https://review-api.vividrop.cn',
        encrypted: true,
      };
      writeFileSync(sessionFilePath, JSON.stringify(mockData, null, 2), 'utf8');

      const httpsRequest = vi.fn((options: RequestOptions, callback: (res: unknown) => void) => {
        const req = new EventEmitter() as EventEmitter & {
          on: typeof EventEmitter.prototype.on;
          write: ReturnType<typeof vi.fn>;
          end: ReturnType<typeof vi.fn>;
        };
        req.write = vi.fn();
        req.end = vi.fn();

        callback(
          createResponse(
            200,
            JSON.stringify({
              code: 0,
              message: 'success',
              data: {
                access_token: 'new-access-token',
                refresh_token: 'new-refresh-token',
              },
            }),
          ),
        );
        return req;
      });

      vi.doMock('node:https', () => ({
        default: { request: httpsRequest },
        request: httpsRequest,
      }));

      vi.resetModules();
      const { sidecarClient: client } = await import('../sidecar-client');

      await expect(client.refreshSession()).resolves.toBe(true);
      expect(client.getAuthSession()).toEqual({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        baseUrl: 'https://review-api.vividrop.cn',
      });
      const [options] = httpsRequest.mock.calls[0] as [RequestOptions, (res: unknown) => void];
      expect(options.hostname).toBe('review-api.vividrop.cn');
      expect(options.path).toBe('/api/v1/auth/refresh');

      vi.resetModules();
    });

    it('clears session when refresh API returns non-zero code', async () => {
      const { writeFileSync, existsSync } = require('node:fs');
      const { join } = require('node:path');
      const { tmpdir } = require('node:os');
      const userDataPath = join(tmpdir(), 'vividrop-test-userdata');
      const sessionFilePath = join(userDataPath, 'session.json');

      const mockData = {
        accessToken: Buffer.from('old-access-token').toString('base64'),
        refreshToken: Buffer.from('old-refresh-token').toString('base64'),
        encrypted: true,
      };
      writeFileSync(sessionFilePath, JSON.stringify(mockData, null, 2), 'utf8');

      const httpsRequest = vi.fn((options: RequestOptions, callback: (res: unknown) => void) => {
        const req = new EventEmitter() as EventEmitter & {
          on: typeof EventEmitter.prototype.on;
          write: ReturnType<typeof vi.fn>;
          end: ReturnType<typeof vi.fn>;
        };
        req.write = vi.fn();
        req.end = vi.fn();

        callback(
          createResponse(
            200,
            JSON.stringify({
              code: 1007,
              message: 'Refresh token invalid',
            }),
          ),
        );
        return req;
      });

      vi.doMock('node:https', () => ({
        default: { request: httpsRequest },
        request: httpsRequest,
      }));

      vi.resetModules();
      const { sidecarClient: client } = await import('../sidecar-client');

      const result = await client.refreshSession();
      expect(result).toBe(false);
      expect(client.getAuthSession()).toBeNull();
      expect(existsSync(sessionFilePath)).toBe(false);
      vi.resetModules();
    });

    it('does not clear session when refresh API throws network/HTTP error', async () => {
      const { writeFileSync, existsSync } = require('node:fs');
      const { join } = require('node:path');
      const { tmpdir } = require('node:os');
      const userDataPath = join(tmpdir(), 'vividrop-test-userdata');
      const sessionFilePath = join(userDataPath, 'session.json');

      const mockData = {
        accessToken: Buffer.from('old-access-token').toString('base64'),
        refreshToken: Buffer.from('old-refresh-token').toString('base64'),
        encrypted: true,
      };
      writeFileSync(sessionFilePath, JSON.stringify(mockData, null, 2), 'utf8');

      const httpsRequest = vi.fn((options: RequestOptions, callback: (res: unknown) => void) => {
        const req = new EventEmitter() as EventEmitter & {
          on: typeof EventEmitter.prototype.on;
          write: ReturnType<typeof vi.fn>;
          end: ReturnType<typeof vi.fn>;
        };
        req.write = vi.fn();
        req.end = vi.fn();

        callback(createResponse(500, 'Internal Server Error'));
        return req;
      });

      vi.doMock('node:https', () => ({
        default: { request: httpsRequest },
        request: httpsRequest,
      }));

      vi.resetModules();
      const { sidecarClient: client } = await import('../sidecar-client');

      const result = await client.refreshSession();
      expect(result).toBe(false);
      expect(client.getAuthSession()).toEqual({
        accessToken: 'old-access-token',
        refreshToken: 'old-refresh-token',
      });
      expect(existsSync(sessionFilePath)).toBe(true);
      vi.resetModules();
    });
  });

  describe('syncCredentialsToSidecar with token rotation', () => {
    it('passes the desktop account id to the sidecar credentials endpoint', async () => {
      const { writeFileSync } = require('node:fs');
      const { join } = require('node:path');
      const { tmpdir } = require('node:os');
      const userDataPath = join(tmpdir(), 'vividrop-test-userdata');
      const sessionFilePath = join(userDataPath, 'session.json');

      const accessToken = fakeAccessToken('42');
      const mockData = {
        accessToken: Buffer.from(accessToken).toString('base64'),
        refreshToken: Buffer.from('refresh-token').toString('base64'),
        encrypted: true,
      };
      writeFileSync(sessionFilePath, JSON.stringify(mockData, null, 2), 'utf8');

      const sidecarPayloads: unknown[] = [];
      const httpRequest = vi.fn((options: RequestOptions, callback: (res: unknown) => void) => {
        const req = new EventEmitter() as EventEmitter & {
          on: typeof EventEmitter.prototype.on;
          write: ReturnType<typeof vi.fn>;
          end: ReturnType<typeof vi.fn>;
        };
        req.write = vi.fn((chunk: string) => {
          sidecarPayloads.push(JSON.parse(chunk));
        });
        req.end = vi.fn();
        callback(createResponse(200, JSON.stringify({ ok: true })));
        return req;
      });

      const httpsRequest = vi.fn((options: RequestOptions, callback: (res: unknown) => void) => {
        const req = new EventEmitter() as EventEmitter & {
          on: typeof EventEmitter.prototype.on;
          write: ReturnType<typeof vi.fn>;
          end: ReturnType<typeof vi.fn>;
        };
        req.write = vi.fn();
        req.end = vi.fn();

        if (options.path?.includes('/tunnel/turn-credentials')) {
          callback(
            createResponse(
              200,
              JSON.stringify({
                code: 0,
                data: {
                  urls: ['turn:example.com'],
                  username: 'user',
                  credential: 'pwd',
                },
              }),
            ),
          );
        }
        return req;
      });

      vi.doMock('node:http', () => ({
        default: { request: httpRequest },
        request: httpRequest,
      }));
      vi.doMock('node:https', () => ({
        default: { request: httpsRequest },
        request: httpsRequest,
      }));

      vi.resetModules();
      const { syncCredentialsToSidecar } = await import('../sidecar-client');

      await expect(syncCredentialsToSidecar()).resolves.toBe(true);

      expect(sidecarPayloads).toEqual([
        expect.objectContaining({
          accessToken,
          accountId: '42',
        }),
      ]);
      vi.resetModules();
    });

    it('shares an in-flight refresh when concurrent syncs see an expired access token', async () => {
      const { writeFileSync } = require('node:fs');
      const { join } = require('node:path');
      const { tmpdir } = require('node:os');
      const userDataPath = join(tmpdir(), 'vividrop-test-userdata');
      const sessionFilePath = join(userDataPath, 'session.json');

      const mockData = {
        accessToken: Buffer.from('old-access-token').toString('base64'),
        refreshToken: Buffer.from('old-refresh-token').toString('base64'),
        encrypted: true,
      };
      writeFileSync(sessionFilePath, JSON.stringify(mockData, null, 2), 'utf8');

      const sidecarPayloads: unknown[] = [];
      const httpRequest = vi.fn((options: RequestOptions, callback: (res: unknown) => void) => {
        const req = new EventEmitter() as EventEmitter & {
          on: typeof EventEmitter.prototype.on;
          write: ReturnType<typeof vi.fn>;
          end: ReturnType<typeof vi.fn>;
        };
        req.write = vi.fn((chunk: string) => {
          sidecarPayloads.push(JSON.parse(chunk));
        });
        req.end = vi.fn();
        callback(createResponse(200, JSON.stringify({ ok: true })));
        return req;
      });

      let turnFetchCount = 0;
      let refreshCount = 0;
      const httpsRequest = vi.fn((options: RequestOptions, callback: (res: unknown) => void) => {
        const req = new EventEmitter() as EventEmitter & {
          on: typeof EventEmitter.prototype.on;
          write: ReturnType<typeof vi.fn>;
          end: ReturnType<typeof vi.fn>;
        };
        req.write = vi.fn();
        req.end = vi.fn();

        if (options.path?.includes('/tunnel/turn-credentials')) {
          turnFetchCount++;
          if (turnFetchCount <= 2) {
            callback(createResponse(200, JSON.stringify({ code: 1006, message: 'Expired' })));
          } else {
            callback(
              createResponse(
                200,
                JSON.stringify({
                  code: 0,
                  data: {
                    urls: ['turn:example.com'],
                    username: 'user',
                    credential: 'pwd',
                  },
                }),
              ),
            );
          }
        } else if (options.path === '/api/v1/auth/refresh') {
          refreshCount++;
          callback(
            createResponse(
              200,
              JSON.stringify({
                code: 0,
                data: {
                  access_token: 'new-access-token',
                  refresh_token: 'new-refresh-token',
                },
              }),
            ),
          );
        }
        return req;
      });

      vi.doMock('node:http', () => ({
        default: { request: httpRequest },
        request: httpRequest,
      }));
      vi.doMock('node:https', () => ({
        default: { request: httpsRequest },
        request: httpsRequest,
      }));

      vi.resetModules();
      vi.stubEnv('SYNCFLOW_API_BASE_URL', 'https://review-api.vividrop.cn');
      vi.stubEnv('SYNCFLOW_GIFTCARD_REDEEM_BASE_URL', 'https://review-api.vividrop.cn');
      const { sidecarClient: client, syncCredentialsToSidecar } = await import('../sidecar-client');

      await expect(
        Promise.all([syncCredentialsToSidecar(), syncCredentialsToSidecar()]),
      ).resolves.toEqual([true, true]);

      expect(refreshCount).toBe(1);
      expect(client.getAuthSession()).toEqual({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });
      expect(sidecarPayloads).toHaveLength(2);
      expect(sidecarPayloads).toEqual([
        expect.objectContaining({
          signalingUrl: 'https://review-api.vividrop.cn',
          accessToken: 'new-access-token',
        }),
        expect.objectContaining({
          signalingUrl: 'https://review-api.vividrop.cn',
          accessToken: 'new-access-token',
        }),
      ]);
      vi.resetModules();
    });

    it('retries fetchTurnCredentials after a successful refreshSession when initial code is 1006', async () => {
      const { writeFileSync } = require('node:fs');
      const { join } = require('node:path');
      const { tmpdir } = require('node:os');
      const userDataPath = join(tmpdir(), 'vividrop-test-userdata');
      const sessionFilePath = join(userDataPath, 'session.json');

      const mockData = {
        accessToken: Buffer.from('old-access-token').toString('base64'),
        refreshToken: Buffer.from('old-refresh-token').toString('base64'),
        encrypted: true,
      };
      writeFileSync(sessionFilePath, JSON.stringify(mockData, null, 2), 'utf8');

      const httpRequest = vi.fn((options: RequestOptions, callback: (res: unknown) => void) => {
        const req = new EventEmitter() as EventEmitter & {
          on: typeof EventEmitter.prototype.on;
          write: ReturnType<typeof vi.fn>;
          end: ReturnType<typeof vi.fn>;
        };
        req.write = vi.fn();
        req.end = vi.fn();
        callback(createResponse(200, JSON.stringify({ ok: true })));
        return req;
      });

      let turnFetchCount = 0;
      const httpsRequest = vi.fn((options: RequestOptions, callback: (res: unknown) => void) => {
        const req = new EventEmitter() as EventEmitter & {
          on: typeof EventEmitter.prototype.on;
          write: ReturnType<typeof vi.fn>;
          end: ReturnType<typeof vi.fn>;
        };
        req.write = vi.fn();
        req.end = vi.fn();

        if (options.path?.includes('/tunnel/turn-credentials')) {
          turnFetchCount++;
          if (turnFetchCount === 1) {
            callback(createResponse(200, JSON.stringify({ code: 1006, message: 'Expired' })));
          } else {
            callback(
              createResponse(
                200,
                JSON.stringify({
                  code: 0,
                  data: {
                    urls: ['turn:example.com'],
                    username: 'user',
                    credential: 'pwd',
                  },
                }),
              ),
            );
          }
        } else if (options.path === '/api/v1/auth/refresh') {
          callback(
            createResponse(
              200,
              JSON.stringify({
                code: 0,
                data: {
                  access_token: 'new-access-token',
                  refresh_token: 'new-refresh-token',
                },
              }),
            ),
          );
        }
        return req;
      });

      vi.doMock('node:http', () => ({
        default: { request: httpRequest },
        request: httpRequest,
      }));
      vi.doMock('node:https', () => ({
        default: { request: httpsRequest },
        request: httpsRequest,
      }));

      vi.resetModules();
      const { sidecarClient: client, syncCredentialsToSidecar } = await import('../sidecar-client');

      const result = await syncCredentialsToSidecar();
      expect(result).toBe(true);
      expect(turnFetchCount).toBe(2);
      expect(client.getAuthSession()).toEqual({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });
      vi.resetModules();
    });

    it('preserves sidecar tunnel credentials when refresh clears the local session', async () => {
      const { writeFileSync, existsSync } = require('node:fs');
      const { join } = require('node:path');
      const { tmpdir } = require('node:os');
      const userDataPath = join(tmpdir(), 'vividrop-test-userdata');
      const sessionFilePath = join(userDataPath, 'session.json');

      const mockData = {
        accessToken: Buffer.from('old-access-token').toString('base64'),
        refreshToken: Buffer.from('old-refresh-token').toString('base64'),
        encrypted: true,
      };
      writeFileSync(sessionFilePath, JSON.stringify(mockData, null, 2), 'utf8');

      const sidecarPayloads: unknown[] = [];
      const httpRequest = vi.fn((options: RequestOptions, callback: (res: unknown) => void) => {
        const req = new EventEmitter() as EventEmitter & {
          on: typeof EventEmitter.prototype.on;
          write: ReturnType<typeof vi.fn>;
          end: ReturnType<typeof vi.fn>;
        };
        req.write = vi.fn((chunk: string) => {
          sidecarPayloads.push(JSON.parse(chunk));
        });
        req.end = vi.fn();
        callback(createResponse(200, JSON.stringify({ ok: true })));
        return req;
      });

      const httpsRequest = vi.fn((options: RequestOptions, callback: (res: unknown) => void) => {
        const req = new EventEmitter() as EventEmitter & {
          on: typeof EventEmitter.prototype.on;
          write: ReturnType<typeof vi.fn>;
          end: ReturnType<typeof vi.fn>;
        };
        req.write = vi.fn();
        req.end = vi.fn();

        if (options.path?.includes('/tunnel/turn-credentials')) {
          callback(createResponse(200, JSON.stringify({ code: 1006, message: 'Expired' })));
        } else if (options.path === '/api/v1/auth/refresh') {
          callback(
            createResponse(
              200,
              JSON.stringify({
                code: 1007,
                message: 'Refresh token invalid',
              }),
            ),
          );
        }
        return req;
      });

      vi.doMock('node:http', () => ({
        default: { request: httpRequest },
        request: httpRequest,
      }));
      vi.doMock('node:https', () => ({
        default: { request: httpsRequest },
        request: httpsRequest,
      }));

      vi.resetModules();
      const { sidecarClient: client, syncCredentialsToSidecar } = await import('../sidecar-client');

      const result = await syncCredentialsToSidecar();
      expect(result).toBe(false);
      expect(client.getAuthSession()).toBeNull();
      expect(existsSync(sessionFilePath)).toBe(false);

      const secondResult = await syncCredentialsToSidecar();
      expect(secondResult).toBe(false);
      expect(httpRequest).not.toHaveBeenCalled();
      expect(httpsRequest).toHaveBeenCalledTimes(2);
      expect(sidecarPayloads).toEqual([]);

      vi.resetModules();
    });

    it('logs why sidecar tunnel credentials are cleared when no auth session is available', async () => {
      const sidecarPayloads: unknown[] = [];
      const httpRequest = vi.fn((options: RequestOptions, callback: (res: unknown) => void) => {
        const req = new EventEmitter() as EventEmitter & {
          on: typeof EventEmitter.prototype.on;
          write: ReturnType<typeof vi.fn>;
          end: ReturnType<typeof vi.fn>;
        };
        req.write = vi.fn((chunk: string) => {
          sidecarPayloads.push(JSON.parse(chunk));
        });
        req.end = vi.fn();
        callback(createResponse(200, JSON.stringify({ ok: true, message: 'credentials cleared' })));
        return req;
      });
      const httpsRequest = vi.fn();

      vi.doMock('node:http', () => ({
        default: { request: httpRequest },
        request: httpRequest,
      }));
      vi.doMock('node:https', () => ({
        default: { request: httpsRequest },
        request: httpsRequest,
      }));

      vi.resetModules();
      const { syncCredentialsToSidecar } = await import('../sidecar-client');

      await expect(syncCredentialsToSidecar()).resolves.toBe(true);

      expect(sidecarPayloads).toEqual([
        {
          signalingUrl: '',
          accessToken: '',
          iceServers: [],
        },
      ]);
      expect(logWarnMock).toHaveBeenCalledWith(
        '[sidecar-client] Clearing sidecar tunnel credentials: no active auth session or access token.',
        {
          hasSession: false,
          hasAccessToken: false,
        },
      );
      expect(logInfoMock).toHaveBeenCalledWith(
        '[sidecar-client] Sidecar tunnel credentials clear request completed.',
        {
          ok: true,
          message: 'credentials cleared',
        },
      );

      vi.resetModules();
    });

    it('uses the persisted auth base URL for TURN credentials and sidecar signaling URL', async () => {
      const { writeFileSync } = require('node:fs');
      const { join } = require('node:path');
      const { tmpdir } = require('node:os');
      const userDataPath = join(tmpdir(), 'vividrop-test-userdata');
      const sessionFilePath = join(userDataPath, 'session.json');

      const mockData = {
        accessToken: Buffer.from('review-access-token').toString('base64'),
        refreshToken: Buffer.from('review-refresh-token').toString('base64'),
        baseUrl: 'https://review-api.vividrop.cn',
        encrypted: true,
      };
      writeFileSync(sessionFilePath, JSON.stringify(mockData, null, 2), 'utf8');

      const sidecarPayloads: unknown[] = [];
      const httpRequest = vi.fn((options: RequestOptions, callback: (res: unknown) => void) => {
        const req = new EventEmitter() as EventEmitter & {
          on: typeof EventEmitter.prototype.on;
          write: ReturnType<typeof vi.fn>;
          end: ReturnType<typeof vi.fn>;
        };
        req.write = vi.fn((chunk: string) => {
          sidecarPayloads.push(JSON.parse(chunk));
        });
        req.end = vi.fn();
        callback(createResponse(200, JSON.stringify({ ok: true, message: 'success' })));
        return req;
      });

      const httpsRequest = vi.fn((options: RequestOptions, callback: (res: unknown) => void) => {
        const req = new EventEmitter() as EventEmitter & {
          on: typeof EventEmitter.prototype.on;
          write: ReturnType<typeof vi.fn>;
          end: ReturnType<typeof vi.fn>;
        };
        req.write = vi.fn();
        req.end = vi.fn();
        callback(
          createResponse(
            200,
            JSON.stringify({
              code: 0,
              data: {
                urls: ['turn:review.example.com'],
                username: 'user',
                credential: 'pwd',
              },
            }),
          ),
        );
        return req;
      });

      vi.doMock('node:http', () => ({
        default: { request: httpRequest },
        request: httpRequest,
      }));
      vi.doMock('node:https', () => ({
        default: { request: httpsRequest },
        request: httpsRequest,
      }));

      vi.resetModules();
      const { syncCredentialsToSidecar } = await import('../sidecar-client');

      await expect(syncCredentialsToSidecar()).resolves.toBe(true);

      const [turnOptions] = httpsRequest.mock.calls[0] as [RequestOptions, (res: unknown) => void];
      expect(turnOptions.hostname).toBe('review-api.vividrop.cn');
      expect(turnOptions.path).toBe('/api/v1/tunnel/turn-credentials');
      expect(sidecarPayloads).toEqual([
        expect.objectContaining({
          signalingUrl: 'https://review-api.vividrop.cn',
          accessToken: 'review-access-token',
        }),
      ]);
      expect(logInfoMock).toHaveBeenCalledWith(
        '[sidecar-client] Fetching TURN credentials for sidecar tunnel.',
        {
          baseUrl: 'https://review-api.vividrop.cn',
        },
      );
      expect(logInfoMock).toHaveBeenCalledWith(
        '[sidecar-client] TURN credentials fetched for sidecar tunnel.',
        {
          baseUrl: 'https://review-api.vividrop.cn',
          urlsCount: 1,
          hasUsername: true,
          hasCredential: true,
        },
      );
      expect(logInfoMock).toHaveBeenCalledWith(
        '[sidecar-client] Applying sidecar tunnel credentials.',
        {
          signalingUrl: 'https://review-api.vividrop.cn',
          iceServerCount: 1,
        },
      );
      expect(logInfoMock).toHaveBeenCalledWith(
        '[sidecar-client] Sidecar tunnel credentials apply request completed.',
        {
          ok: true,
          message: 'success',
        },
      );

      vi.resetModules();
    });
  });
});
