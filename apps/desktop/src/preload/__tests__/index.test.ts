import { beforeEach, describe, expect, it, vi } from 'vitest';

const exposed = vi.hoisted(() => ({
  api: undefined as
    | undefined
    | {
        sidecar: {
          getClientConfig(): Promise<unknown>;
          redeemGiftCard(payload: { code: string }): Promise<unknown>;
          getManagedDevices(): Promise<unknown>;
          unblockDevice(clientId: string): Promise<unknown>;
          getSyncRecords(): Promise<unknown>;
          getAccessRecords(): Promise<unknown>;
          getSharedResources(): Promise<unknown>;
          addSharedResource(payload: unknown): Promise<unknown>;
          removeSharedResource(resourceId: string): Promise<unknown>;
          getReceivedLibrary(): Promise<unknown>;
        };
        files: {
          selectFile(): Promise<unknown>;
        };
        auth: {
          sendSMSCode(payload: { phone: string }): Promise<unknown>;
          loginWithSMSCode(payload: { phone: string; code: string }): Promise<unknown>;
          getAuthSession(): Promise<unknown>;
          logout(): Promise<unknown>;
        };
        power: {
          getState(): Promise<unknown>;
          setPreventSleepDuringTransfer(enabled: boolean): Promise<unknown>;
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

    await expect(exposed.api?.sidecar.redeemGiftCard({ code: 'ABCD-EFGH-IJKL' })).resolves.toEqual({
      ok: true,
    });
    expect(exposed.invoke).toHaveBeenCalledWith('sidecar:redeem-gift-card', {
      code: 'ABCD-EFGH-IJKL',
    });
  });

  it('maps client config calls to the IPC channel', async () => {
    exposed.invoke.mockResolvedValue({ features: { giftCard: { enabled: true } } });

    await import('../index');

    await expect(exposed.api?.sidecar.getClientConfig()).resolves.toEqual({
      features: { giftCard: { enabled: true } },
    });
    expect(exposed.invoke).toHaveBeenCalledWith('sidecar:client-config');
  });

  it('maps desktop-local sidecar calls to IPC channels', async () => {
    exposed.invoke.mockResolvedValue({ ok: true });

    await import('../index');

    await exposed.api?.sidecar.getManagedDevices();
    await exposed.api?.sidecar.unblockDevice('client-1');
    await exposed.api?.sidecar.getSyncRecords();
    await exposed.api?.sidecar.getAccessRecords();
    await exposed.api?.sidecar.getSharedResources();
    await exposed.api?.sidecar.addSharedResource({
      kind: 'shared_file',
      displayName: 'photo.jpg',
      localPath: '/tmp/photo.jpg',
    });
    await exposed.api?.sidecar.removeSharedResource('res-1');
    await exposed.api?.sidecar.getReceivedLibrary();

    expect(exposed.invoke).toHaveBeenCalledWith('sidecar:managed-devices');
    expect(exposed.invoke).toHaveBeenCalledWith('sidecar:unblock-device', 'client-1');
    expect(exposed.invoke).toHaveBeenCalledWith('sidecar:sync-records');
    expect(exposed.invoke).toHaveBeenCalledWith('sidecar:access-records');
    expect(exposed.invoke).toHaveBeenCalledWith('sidecar:shared-resources');
    expect(exposed.invoke).toHaveBeenCalledWith('sidecar:add-shared-resource', {
      kind: 'shared_file',
      displayName: 'photo.jpg',
      localPath: '/tmp/photo.jpg',
    });
    expect(exposed.invoke).toHaveBeenCalledWith('sidecar:remove-shared-resource', 'res-1');
    expect(exposed.invoke).toHaveBeenCalledWith('sidecar:received-library');
  });

  it('maps file selection to the IPC channel', async () => {
    exposed.invoke.mockResolvedValue('/tmp/photo.jpg');

    await import('../index');

    await expect(exposed.api?.files.selectFile()).resolves.toBe('/tmp/photo.jpg');
    expect(exposed.invoke).toHaveBeenCalledWith('files:select-file');
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

  it('maps renderer auth session calls to sanitized session IPC', async () => {
    exposed.invoke
      .mockResolvedValueOnce({ loggedIn: true, email: 'ada@example.com' })
      .mockResolvedValueOnce({ ok: true });

    await import('../index');

    await expect(exposed.api?.auth.getAuthSession()).resolves.toEqual({
      loggedIn: true,
      email: 'ada@example.com',
    });
    await expect(exposed.api?.auth.logout()).resolves.toEqual({ ok: true });
    expect(exposed.invoke).toHaveBeenCalledWith('auth:get-session');
    expect(exposed.invoke).toHaveBeenCalledWith('auth:logout');
  });

  it('maps power save calls to IPC channels', async () => {
    exposed.invoke.mockResolvedValue({ preventSleepDuringTransfer: true, blockingSleep: false });

    await import('../index');

    await expect(exposed.api?.power.getState()).resolves.toEqual({
      preventSleepDuringTransfer: true,
      blockingSleep: false,
    });
    await expect(exposed.api?.power.setPreventSleepDuringTransfer(false)).resolves.toEqual({
      preventSleepDuringTransfer: true,
      blockingSleep: false,
    });
    expect(exposed.invoke).toHaveBeenCalledWith('power-save:get-state');
    expect(exposed.invoke).toHaveBeenCalledWith('power-save:set-prevent-sleep', false);
  });
});
