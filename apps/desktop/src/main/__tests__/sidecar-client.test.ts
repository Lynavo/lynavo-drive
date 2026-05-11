import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

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

describe('sidecarClient', () => {
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
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
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
        createResponse(
          200,
          JSON.stringify({ code: 3001, message: '禮品卡碼無效', data: {} }),
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
      callback(
        createResponse(
          401,
          JSON.stringify({ code: 1006, message: 'Token 無效或已過期' }),
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
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });

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
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });

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

    await expect(client.loginWithSMSCode({ phone: '13800138000', code: '123456' })).resolves.toEqual({
      ok: true,
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
      Authorization: 'Bearer user-access-token',
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
        createResponse(
          200,
          JSON.stringify({ code: 1004, message: '驗證碼錯誤', data: {} }),
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

    await expect(client.loginWithSMSCode({ phone: '13800138000', code: '123456' })).resolves.toEqual({
      ok: false,
      reason: 'sms_code_invalid',
      message: '驗證碼錯誤',
    });

    expect(httpRequest).not.toHaveBeenCalled();
    expect(httpsRequest).toHaveBeenCalledTimes(1);

    vi.unstubAllEnvs();
    vi.resetModules();
  });
});
