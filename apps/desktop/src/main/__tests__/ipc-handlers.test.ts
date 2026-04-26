import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC, registerIpcHandlers } from '../ipc-handlers';
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

vi.mock('../sidecar-client', () => ({
  sidecarClient: {
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
  },
  supportsPairingRevocationOnCodeRotation: (
    health:
      | {
          ok?: boolean;
          service?: string;
          capabilities?: { revokesPairingsOnCodeRotation?: boolean };
        }
      | null
      | undefined,
  ) =>
    health?.ok === true &&
    health.service === 'syncflow-sidecar' &&
    health.capabilities?.revokesPairingsOnCodeRotation === true,
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
      ok: true,
      service: 'syncflow-sidecar',
      capabilities: { revokesPairingsOnCodeRotation: true },
    });
    vi.mocked(sidecarClient.regenerateConnectionCode).mockResolvedValue({ code: '123456' });

    const { handler, manager } = registerWithManager();

    await expect(handler()).resolves.toEqual({ code: '123456' });
    expect(manager.retryStart).not.toHaveBeenCalled();
    expect(sidecarClient.regenerateConnectionCode).toHaveBeenCalledTimes(1);
  });

  it('restarts a stale sidecar before regenerating the connection code', async () => {
    vi.mocked(sidecarClient.getHealth).mockResolvedValue({
      ok: true,
      service: 'syncflow-sidecar',
    });
    vi.mocked(sidecarClient.regenerateConnectionCode).mockResolvedValue({ code: '654321' });

    const { handler, manager } = registerWithManager();

    await expect(handler()).resolves.toEqual({ code: '654321' });
    expect(manager.retryStart).toHaveBeenCalledTimes(1);
    expect(sidecarClient.regenerateConnectionCode).toHaveBeenCalledTimes(1);
  });
});
