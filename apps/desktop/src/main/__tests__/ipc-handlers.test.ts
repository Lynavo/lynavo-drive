import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get as httpGet } from 'node:http';
import { shell } from 'electron';
import { APP_COMPATIBILITY_VERSION } from '@syncflow/contracts';
import { IPC, registerIpcHandlers } from '../ipc-handlers';
import { checkForUpdates, uploadDiagnostics } from '../diagnostics';
import { sidecarClient, syncCredentialsToSidecar } from '../sidecar-client';

type IpcHandler = (...args: unknown[]) => unknown;

const handlers = new Map<string, IpcHandler>();

const electronMockState = vi.hoisted(() => {
  let appleBeforeRequest:
    | ((
        details: { method: string; uploadData?: Array<{ bytes: Buffer }> },
        callback: (result: unknown) => void,
      ) => void)
    | null = null;
  const browserWindowInstance = {
    once: vi.fn((event: string, callback: () => void) => {
      if (event === 'ready-to-show') {
        callback();
      }
    }),
    show: vi.fn(),
    on: vi.fn(),
    destroy: vi.fn(),
    loadURL: vi.fn().mockResolvedValue(undefined),
    webContents: {
      session: {
        webRequest: {
          onBeforeRequest: vi.fn(
            (
              _filter: unknown,
              callback: (
                details: { method: string; uploadData?: Array<{ bytes: Buffer }> },
                callback: (result: unknown) => void,
              ) => void,
            ) => {
              appleBeforeRequest = callback;
            },
          ),
        },
      },
    },
  };
  return {
    BrowserWindow: vi.fn(function BrowserWindowMock() {
      return browserWindowInstance;
    }),
    browserWindowInstance,
    getAppleBeforeRequest: () => appleBeforeRequest,
    resetAppleBeforeRequest: () => {
      appleBeforeRequest = null;
    },
  };
});

vi.mock('electron', () => ({
  app: {
    getName: () => 'Vivi Drop',
    getPath: () => '/tmp/vivi-drop-test',
    getVersion: () => '0.1.0',
  },
  BrowserWindow: electronMockState.BrowserWindow,
  clipboard: { writeText: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      handlers.set(channel, handler);
    }),
  },
  net: { fetch: vi.fn() },
  shell: { openExternal: vi.fn(), openPath: vi.fn() },
}));

vi.mock('electron-log', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../sidecar-client', async () => {
  const actual = await vi.importActual<typeof import('../sidecar-client')>('../sidecar-client');
  return {
    ...actual,
    syncCredentialsToSidecar: vi.fn().mockResolvedValue(true),
    sidecarClient: {
      ...actual.sidecarClient,
      getHealth: vi.fn(),
      getDashboardSummary: vi.fn(),
      getDashboardDevices: vi.fn(),
      getDeviceFiles: vi.fn(),
      getDeviceDates: vi.fn(),
      getSettings: vi.fn(),
      updateSettings: vi.fn(),
      resetState: vi.fn(),
      regenerateConnectionCode: vi.fn(),
      getShareStatus: vi.fn(),
      validateShare: vi.fn(),
      getTransferActive: vi.fn(),
      getSharedList: vi.fn(),
      getClientConfig: vi.fn(),
      redeemGiftCard: vi.fn(),
      sendSMSCode: vi.fn(),
      loginWithSMSCode: vi.fn(),
      getAuthSessionView: vi.fn(),
      logout: vi.fn(),
      loginWithGoogle: vi.fn(),
      loginWithApple: vi.fn(),
    },
  };
});

function compatibleHealth(capabilities?: { revokesPairingsOnCodeRotation?: boolean }) {
  return {
    ok: true,
    service: 'syncflow-sidecar',
    appCompatibilityVersion: APP_COMPATIBILITY_VERSION,
    ...(capabilities ? { capabilities } : {}),
  };
}

function createUnsignedIdToken(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(payload)}.`;
}

function requestLocalUrl(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    httpGet(url, (res) => {
      res.resume();
      res.on('end', resolve);
    }).on('error', reject);
  });
}

vi.mock('../diagnostics', () => ({
  exportDiagnostics: vi.fn(),
  uploadDiagnostics: vi.fn(),
  getAppInfo: vi.fn(() => ({ name: 'Vivi Drop', version: '0.1.0', buildNumber: '1' })),
  checkForUpdates: vi.fn(),
}));

describe('registerIpcHandlers', () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    electronMockState.resetAppleBeforeRequest();
  });

  function registerWithManager() {
    const manager = {
      retryStart: vi.fn().mockResolvedValue(undefined),
      startCredentialsSyncInterval: vi.fn(),
    };
    registerIpcHandlers(manager as never);
    const handler = handlers.get(IPC.SIDECAR_REGENERATE_CODE);
    if (!handler) {
      throw new Error('missing regenerate connection code handler');
    }
    return { handler, manager };
  }

  it('regenerates the connection code directly when the sidecar supports pair revocation', async () => {
    vi.mocked(sidecarClient.getHealth).mockResolvedValue({
      ...compatibleHealth({ revokesPairingsOnCodeRotation: true }),
    });
    vi.mocked(sidecarClient.regenerateConnectionCode).mockResolvedValue({ code: '123456' });

    const { handler, manager } = registerWithManager();

    await expect(handler()).resolves.toEqual({ code: '123456' });
    expect(manager.retryStart).not.toHaveBeenCalled();
    expect(sidecarClient.regenerateConnectionCode).toHaveBeenCalledTimes(1);
  });

  it('restarts a stale sidecar before regenerating the connection code', async () => {
    vi.mocked(sidecarClient.getHealth).mockResolvedValue(compatibleHealth());
    vi.mocked(sidecarClient.regenerateConnectionCode).mockResolvedValue({ code: '654321' });

    const { handler, manager } = registerWithManager();

    await expect(handler()).resolves.toEqual({ code: '654321' });
    expect(manager.retryStart).toHaveBeenCalledTimes(1);
    expect(sidecarClient.regenerateConnectionCode).toHaveBeenCalledTimes(1);
  });

  it('registers diagnostics upload IPC with description payload', async () => {
    const manager = { retryStart: vi.fn(), getState: vi.fn() };
    vi.mocked(uploadDiagnostics).mockResolvedValue({
      refId: 'DIA1234',
      uploadedAt: '2026-05-08T03:00:00Z',
    });

    registerIpcHandlers(manager as never);
    const handler = handlers.get(IPC.SUPPORT_UPLOAD_DIAGNOSTICS);

    await expect(
      handler?.(undefined, { description: 'Wi-Fi 断线', locale: 'zh-Hans' }),
    ).resolves.toEqual({
      refId: 'DIA1234',
      uploadedAt: '2026-05-08T03:00:00Z',
    });
    expect(uploadDiagnostics).toHaveBeenCalledWith(manager, {
      description: 'Wi-Fi 断线',
      locale: 'zh-Hans',
    });
  });

  it('registers gift card redeem IPC', async () => {
    vi.mocked(sidecarClient.redeemGiftCard).mockResolvedValue({
      ok: true,
      message: 'done',
    });

    registerIpcHandlers({ retryStart: vi.fn() } as never);
    const handler = handlers.get(IPC.SIDECAR_REDEEM_GIFT_CARD);

    await expect(handler?.(undefined, { code: 'ABCD-EFGH-IJKL' })).resolves.toEqual({
      ok: true,
      message: 'done',
    });
    expect(sidecarClient.redeemGiftCard).toHaveBeenCalledWith({ code: 'ABCD-EFGH-IJKL' });
  });

  it('registers client config IPC', async () => {
    vi.mocked(sidecarClient.getClientConfig).mockResolvedValue({
      features: { giftCard: { enabled: true } },
    });

    registerIpcHandlers({ retryStart: vi.fn() } as never);
    const handler = handlers.get(IPC.SIDECAR_CLIENT_CONFIG);

    await expect(handler?.(undefined)).resolves.toEqual({
      features: { giftCard: { enabled: true } },
    });
    expect(sidecarClient.getClientConfig).toHaveBeenCalledTimes(1);
  });

  it('registers phone auth IPC for SMS send and login', async () => {
    vi.mocked(sidecarClient.sendSMSCode).mockResolvedValue({ ok: true });
    vi.mocked(sidecarClient.loginWithSMSCode).mockResolvedValue({ ok: true });

    const manager = {
      retryStart: vi.fn(),
      startCredentialsSyncInterval: vi.fn(),
    };
    registerIpcHandlers(manager as never);
    const sendHandler = handlers.get(IPC.AUTH_SEND_SMS_CODE);
    const loginHandler = handlers.get(IPC.AUTH_LOGIN_WITH_SMS_CODE);

    await expect(sendHandler?.(undefined, { phone: '13800138000' })).resolves.toEqual({
      ok: true,
    });
    await expect(
      loginHandler?.(undefined, { phone: '13800138000', code: '123456' }),
    ).resolves.toEqual({
      ok: true,
    });
    expect(sidecarClient.sendSMSCode).toHaveBeenCalledWith({ phone: '13800138000' });
    expect(sidecarClient.loginWithSMSCode).toHaveBeenCalledWith({
      phone: '13800138000',
      code: '123456',
    });
    await Promise.resolve();
    expect(syncCredentialsToSidecar).toHaveBeenCalledTimes(1);
    expect(manager.startCredentialsSyncInterval).toHaveBeenCalledTimes(1);
  });

  it('returns only the sanitized auth session through renderer IPC', async () => {
    vi.mocked(sidecarClient.getAuthSessionView).mockReturnValue({
      loggedIn: true,
      phone: '+8613800138000',
    });

    registerIpcHandlers({ retryStart: vi.fn() } as never);
    const handler = handlers.get(IPC.AUTH_GET_SESSION);

    expect(handler?.()).toEqual({
      loggedIn: true,
      phone: '+8613800138000',
    });
    expect(sidecarClient.getAuthSessionView).toHaveBeenCalledTimes(1);
  });

  it('runs Google OAuth through system browser loopback and syncs credentials', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'desktop-client.apps.googleusercontent.com');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'desktop-secret');
    vi.mocked(sidecarClient.loginWithGoogle).mockResolvedValue({ ok: true });
    const fetchMock = vi.mocked((await import('electron')).net.fetch);

    const manager = {
      retryStart: vi.fn(),
      startCredentialsSyncInterval: vi.fn(),
    };
    registerIpcHandlers(manager as never);
    const handler = handlers.get(IPC.AUTH_LOGIN_WITH_OAUTH);
    const loginPromise = handler?.(undefined, { provider: 'google' }) as Promise<unknown>;

    await vi.waitFor(() => {
      expect(shell.openExternal).toHaveBeenCalledTimes(1);
    });

    const authUrl = new URL(vi.mocked(shell.openExternal).mock.calls[0]?.[0] as string);
    const redirectUri = authUrl.searchParams.get('redirect_uri');
    const state = authUrl.searchParams.get('state');
    const nonce = authUrl.searchParams.get('nonce');
    expect(authUrl.searchParams.get('response_type')).toBe('code');
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(redirectUri).toBeTruthy();
    expect(new URL(redirectUri ?? '').hostname).toBe('127.0.0.1');
    expect(state).toBeTruthy();
    expect(nonce).toBeTruthy();

    const idToken = createUnsignedIdToken({ nonce: nonce ?? '' });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        id_token: idToken,
      }),
    } as unknown as Response);
    await requestLocalUrl(`${redirectUri}?code=google-code&state=${state}`);

    await expect(loginPromise).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/token',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    const tokenRequest = fetchMock.mock.calls[0]?.[1] as { body: URLSearchParams };
    expect(tokenRequest.body.get('grant_type')).toBe('authorization_code');
    expect(tokenRequest.body.get('code')).toBe('google-code');
    expect(tokenRequest.body.get('client_secret')).toBe('desktop-secret');
    expect(sidecarClient.loginWithGoogle).toHaveBeenCalledWith({
      identityToken: idToken,
    });
    expect(syncCredentialsToSidecar).toHaveBeenCalledTimes(1);
    expect(manager.startCredentialsSyncInterval).toHaveBeenCalledTimes(1);
  });

  it('runs Apple OAuth form_post through BrowserWindow and syncs credentials', async () => {
    vi.stubEnv('SYNCFLOW_APPLE_CLIENT_ID', 'com.vividrop.global.signin');
    vi.stubEnv('SYNCFLOW_APPLE_REDIRECT_URI', 'https://global-api.vividrop.cn/auth/apple/callback');
    vi.mocked(sidecarClient.loginWithApple).mockResolvedValue({ ok: true });

    const manager = {
      retryStart: vi.fn(),
      startCredentialsSyncInterval: vi.fn(),
    };
    registerIpcHandlers(manager as never);
    const handler = handlers.get(IPC.AUTH_LOGIN_WITH_OAUTH);
    const loginPromise = handler?.(undefined, { provider: 'apple' }) as Promise<unknown>;

    await vi.waitFor(() => {
      expect(
        electronMockState.browserWindowInstance.webContents.session.webRequest.onBeforeRequest,
      ).toHaveBeenCalledTimes(1);
    });

    const loadedUrl = new URL(
      electronMockState.browserWindowInstance.loadURL.mock.calls[0]?.[0] as string,
    );
    const state = loadedUrl.searchParams.get('state') ?? '';
    const nonce = loadedUrl.searchParams.get('nonce') ?? '';
    const idToken = createUnsignedIdToken({ nonce });
    const body = new URLSearchParams({
      state,
      code: 'apple-code',
      id_token: idToken,
      user: JSON.stringify({ name: { firstName: 'Ada', lastName: 'Lovelace' } }),
    }).toString();
    const firstChunk = body.slice(0, 32);
    const secondChunk = body.slice(32);

    const callback = vi.fn();
    electronMockState.getAppleBeforeRequest()?.(
      {
        method: 'POST',
        uploadData: [{ bytes: Buffer.from(firstChunk) }, { bytes: Buffer.from(secondChunk) }],
      },
      callback,
    );

    expect(callback).toHaveBeenCalledWith({ cancel: true });
    expect(electronMockState.browserWindowInstance.destroy).toHaveBeenCalledTimes(1);
    await expect(loginPromise).resolves.toEqual({ ok: true });
    expect(sidecarClient.loginWithApple).toHaveBeenCalledWith({
      identityToken: idToken,
      authorizationCode: 'apple-code',
      fullName: 'Ada Lovelace',
    });
    expect(syncCredentialsToSidecar).toHaveBeenCalledTimes(1);
    expect(manager.startCredentialsSyncInterval).toHaveBeenCalledTimes(1);
  });

  it('registers update-check IPC', async () => {
    vi.mocked(checkForUpdates).mockResolvedValue({
      updateAvailable: true,
      latestVersion: '0.2.0',
      checkedAt: '2026-05-08T03:00:00Z',
    });

    registerIpcHandlers({ retryStart: vi.fn() } as never);
    const handler = handlers.get(IPC.SUPPORT_CHECK_FOR_UPDATES);

    await expect(handler?.()).resolves.toEqual({
      updateAvailable: true,
      latestVersion: '0.2.0',
      checkedAt: '2026-05-08T03:00:00Z',
    });
    expect(checkForUpdates).toHaveBeenCalledTimes(1);
  });
});
