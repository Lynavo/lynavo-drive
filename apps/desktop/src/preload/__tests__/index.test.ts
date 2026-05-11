import { beforeEach, describe, expect, it, vi } from 'vitest';

const exposed = vi.hoisted(() => ({
  api: undefined as
    | undefined
    | {
        sidecar: { redeemGiftCard(payload: { code: string }): Promise<unknown> };
        auth: {
          sendSMSCode(payload: { phone: string }): Promise<unknown>;
          loginWithSMSCode(payload: { phone: string; code: string }): Promise<unknown>;
        };
      },
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: vi.fn((_key: string, value: unknown) => {
      exposed.api = value as typeof exposed.api;
    }),
  },
  ipcRenderer: {
    invoke: exposed.invoke,
    on: exposed.on,
    removeListener: exposed.removeListener,
  },
}));

describe('preload electronAPI', () => {
  beforeEach(() => {
    vi.resetModules();
    exposed.api = undefined;
    exposed.invoke.mockReset();
    exposed.on.mockReset();
    exposed.removeListener.mockReset();
  });

  it('maps gift card redeem calls to the IPC channel', async () => {
    exposed.invoke.mockResolvedValue({ ok: true });

    await import('../index');

    await expect(
      exposed.api?.sidecar.redeemGiftCard({ code: 'ABCD-EFGH-IJKL' }),
    ).resolves.toEqual({ ok: true });
    expect(exposed.invoke).toHaveBeenCalledWith('sidecar:redeem-gift-card', {
      code: 'ABCD-EFGH-IJKL',
    });
  });

  it('maps phone auth calls to IPC channels', async () => {
    exposed.invoke.mockResolvedValue({ ok: true });

    await import('../index');

    await expect(exposed.api?.auth.sendSMSCode({ phone: '13800138000' })).resolves.toEqual({
      ok: true,
    });
    await expect(
      exposed.api?.auth.loginWithSMSCode({ phone: '13800138000', code: '123456' }),
    ).resolves.toEqual({ ok: true });
    expect(exposed.invoke).toHaveBeenCalledWith('auth:send-sms-code', {
      phone: '13800138000',
    });
    expect(exposed.invoke).toHaveBeenCalledWith('auth:login-with-sms-code', {
      phone: '13800138000',
      code: '123456',
    });
  });
});
