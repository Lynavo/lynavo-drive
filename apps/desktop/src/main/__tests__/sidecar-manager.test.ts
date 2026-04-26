import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SidecarManager } from '../sidecar-manager';
import { sidecarClient } from '../sidecar-client';

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));
const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/Volumes/T7/Dev/Web/SyncFlow/apps/desktop',
  },
}));

vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('node:child_process', () => ({
  default: {
    spawn: spawnMock,
    execFile: execFileMock,
  },
  spawn: spawnMock,
  execFile: execFileMock,
}));

vi.mock('../sidecar-client', () => ({
  sidecarClient: {
    getHealth: vi.fn(),
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

function createChildProcessStub() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
    killed: boolean;
    pid: number;
  };

  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.pid = 4242;
  child.kill = vi.fn(() => {
    child.killed = true;
  });

  return child;
}

describe('SidecarManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    spawnMock.mockReturnValue(createChildProcessStub());
    execFileMock.mockImplementation(
      (_file: string, _args: string[], callback?: (...args: any[]) => void) => {
        callback?.(null, { stdout: '', stderr: '' });
        return {} as never;
      },
    );
  });

  it('restarts with a managed sidecar when a reused external sidecar becomes unhealthy', async () => {
    vi.mocked(sidecarClient.getHealth).mockResolvedValueOnce({
      ok: true,
      service: 'syncflow-sidecar',
      capabilities: { revokesPairingsOnCodeRotation: true },
    });
    vi.mocked(sidecarClient.getHealth).mockRejectedValueOnce(new Error('ECONNREFUSED'));
    vi.mocked(sidecarClient.getHealth).mockRejectedValueOnce(new Error('ECONNREFUSED'));
    vi.mocked(sidecarClient.getHealth).mockResolvedValue({
      ok: true,
      service: 'syncflow-sidecar',
      capabilities: { revokesPairingsOnCodeRotation: true },
    });

    const manager = new SidecarManager();

    await manager.start({ reuseExisting: true });
    expect(spawnMock).not.toHaveBeenCalled();
    expect(manager.getState().status).toBe('healthy');

    await vi.advanceTimersByTimeAsync(3000);
    expect(manager.getState().status).toBe('starting');
    expect(manager.getState().message).toContain('正在重试');

    await vi.advanceTimersByTimeAsync(1500);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(manager.getState().status).toBe('healthy');
  });

  it('cold starts a fresh sidecar by default in dev mode', async () => {
    vi.mocked(sidecarClient.getHealth).mockResolvedValue({ ok: true, service: 'syncflow-sidecar' });

    const manager = new SidecarManager();

    await manager.start();

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(manager.getState().status).toBe('healthy');
  });

  it('does not reuse an external sidecar without pairing-revocation capability', async () => {
    vi.mocked(sidecarClient.getHealth)
      .mockResolvedValueOnce({
        ok: true,
        service: 'syncflow-sidecar',
      })
      .mockResolvedValue({
        ok: true,
        service: 'syncflow-sidecar',
        capabilities: { revokesPairingsOnCodeRotation: true },
      });

    const manager = new SidecarManager();

    await manager.start({ reuseExisting: true });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(manager.getState().status).toBe('healthy');
  });
});
