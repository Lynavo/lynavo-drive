import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_COMPATIBILITY_VERSION } from '@syncflow/contracts';
import { IPC, registerIpcHandlers } from '../ipc-handlers';
import { checkForUpdates, uploadDiagnostics } from '../diagnostics';
import { sidecarClient } from '../sidecar-client';

type IpcHandler = (...args: unknown[]) => unknown;

const handlers = new Map<string, IpcHandler>();

vi.mock('electron', () => ({
  app: {
    getName: () => 'Vivi Drop',
    getPath: () => '/tmp/vivi-drop-test',
    getVersion: () => '0.1.0',
  },
  clipboard: { writeText: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      handlers.set(channel, handler);
    }),
  },
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
      redeemGiftCard: vi.fn(),
      sendSMSCode: vi.fn(),
      loginWithSMSCode: vi.fn(),
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
  });

  function registerWithManager() {
    const manager = {
      retryStart: vi.fn().mockResolvedValue(undefined),
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

  it('registers phone auth IPC for SMS send and login', async () => {
    vi.mocked(sidecarClient.sendSMSCode).mockResolvedValue({ ok: true });
    vi.mocked(sidecarClient.loginWithSMSCode).mockResolvedValue({ ok: true });

    registerIpcHandlers({ retryStart: vi.fn() } as never);
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
