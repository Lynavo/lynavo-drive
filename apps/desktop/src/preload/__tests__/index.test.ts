import { beforeEach, describe, expect, it, vi } from 'vitest';

const exposed = vi.hoisted(() => ({
  api: undefined as
    | undefined
    | {
        sidecar: {
          getConnectionDevices(): Promise<unknown>;
          revokeConnectionDevice(clientId: string): Promise<unknown>;
          clearBlockedClient(clientId: string): Promise<unknown>;
          getManagedDevices(): Promise<unknown>;
          unblockDevice(clientId: string): Promise<unknown>;
          getSyncRecords(): Promise<unknown>;
          getAccessRecords(): Promise<unknown>;
          getSharedResources(): Promise<unknown>;
          addSharedResource(payload: unknown): Promise<unknown>;
          removeSharedResource(resourceId: string): Promise<unknown>;
          getReceivedLibrary(options?: { page?: number; pageSize?: number }): Promise<unknown>;
        };
        files: {
          selectFile(): Promise<unknown>;
          revealPath(path: string): Promise<unknown>;
        };
        power: {
          getState(): Promise<unknown>;
          setPreventSleepDuringTransfer(enabled: boolean): Promise<unknown>;
        };
        platform: {
          isLinux(): boolean;
          setModalOverlayActive(active: boolean): Promise<unknown>;
        };
      },
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

const platformCapabilities = vi.hoisted(() => ({
  isLinuxPlatform: vi.fn((): boolean => false),
  usesTitleBarOverlayControls: vi.fn((): boolean => false),
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

vi.mock('../../shared/platform-capabilities', () => platformCapabilities);

describe('preload electronAPI', () => {
  beforeEach(() => {
    vi.resetModules();
    exposed.api = undefined;
    exposed.invoke.mockReset();
    exposed.on.mockReset();
    exposed.removeListener.mockReset();
    platformCapabilities.isLinuxPlatform.mockReset();
    platformCapabilities.isLinuxPlatform.mockReturnValue(false);
    platformCapabilities.usesTitleBarOverlayControls.mockReset();
    platformCapabilities.usesTitleBarOverlayControls.mockReturnValue(false);
  });

  it('does not expose non-OSS gift-card, client-config, or auth bridges', async () => {
    exposed.invoke.mockResolvedValue({ ok: true });

    await import('../index');

    expect(exposed.api?.sidecar).not.toHaveProperty('redeemGiftCard');
    expect(exposed.api?.sidecar).not.toHaveProperty('getClientConfig');
    expect(exposed.api).not.toHaveProperty('auth');
  });

  it('maps desktop-local sidecar calls to IPC channels', async () => {
    exposed.invoke.mockResolvedValue({ ok: true });

    await import('../index');

    await exposed.api?.sidecar.getConnectionDevices();
    await exposed.api?.sidecar.revokeConnectionDevice('phone-a');
    await exposed.api?.sidecar.clearBlockedClient('phone-a');
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
    await exposed.api?.sidecar.getReceivedLibrary({ page: 2, pageSize: 30 });

    expect(exposed.invoke).toHaveBeenCalledWith('sidecar:connection-devices');
    expect(exposed.invoke).toHaveBeenCalledWith('sidecar:revoke-connection-device', 'phone-a');
    expect(exposed.invoke).toHaveBeenCalledWith('sidecar:clear-blocked-client', 'phone-a');
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
    expect(exposed.invoke).toHaveBeenCalledWith('sidecar:received-library', {
      page: 2,
      pageSize: 30,
    });
  });

  it('maps file selection to the IPC channel', async () => {
    exposed.invoke.mockResolvedValue('/tmp/photo.jpg');

    await import('../index');

    await expect(exposed.api?.files.selectFile()).resolves.toBe('/tmp/photo.jpg');
    expect(exposed.invoke).toHaveBeenCalledWith('files:select-file');
  });

  it('maps reveal path to the IPC channel', async () => {
    exposed.invoke.mockResolvedValue(undefined);

    await import('../index');

    await expect(exposed.api?.files.revealPath('/tmp/photo.jpg')).resolves.toBeUndefined();
    expect(exposed.invoke).toHaveBeenCalledWith('files:reveal-path', '/tmp/photo.jpg');
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

  it('delegates Linux platform detection through platform capabilities', async () => {
    platformCapabilities.isLinuxPlatform.mockReturnValueOnce(true).mockReturnValueOnce(false);

    await import('../index');

    expect(exposed.api?.platform.isLinux()).toBe(true);
    expect(exposed.api?.platform.isLinux()).toBe(false);
    expect(platformCapabilities.isLinuxPlatform).toHaveBeenCalledTimes(2);
  });

  it('does not expose official Apple auth platform capability in OSS preload', async () => {
    await import('../index');

    expect(exposed.api?.platform).not.toHaveProperty('supportsAppleAuth');
  });

  it('maps modal title bar overlay updates to IPC', async () => {
    exposed.invoke.mockResolvedValue(undefined);

    await import('../index');

    await expect(exposed.api?.platform.setModalOverlayActive(true)).resolves.toBeUndefined();
    expect(exposed.invoke).toHaveBeenCalledWith('window:set-modal-overlay-active', true);
  });
});
