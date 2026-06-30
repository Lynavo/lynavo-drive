import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_COMPATIBILITY_VERSION } from '@lynavo-drive/contracts';
import { SidecarManager } from '../sidecar-manager';
import { sidecarClient, syncCredentialsToSidecar } from '../sidecar-client';

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));
const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}));
const { syncCredentialsToSidecarMock } = vi.hoisted(() => ({
  syncCredentialsToSidecarMock: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/Volumes/T7/Dev/Web/SyncFlow/apps/desktop',
    getVersion: () => '0.1.0',
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

vi.mock('../sidecar-client', async () => {
  const actual = await vi.importActual<typeof import('../sidecar-client')>('../sidecar-client');
  return {
    ...actual,
    syncCredentialsToSidecar: syncCredentialsToSidecarMock,
    sidecarClient: {
      ...actual.sidecarClient,
      getHealth: vi.fn(),
    },
  };
});

function compatibleHealth(capabilities?: { connectionDeviceManagement?: boolean }) {
  return {
    ok: true,
    service: 'syncflow-sidecar',
    appCompatibilityVersion: APP_COMPATIBILITY_VERSION,
    ...(capabilities ? { capabilities } : {}),
  };
}

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
    syncCredentialsToSidecarMock.mockResolvedValue(true);
    execFileMock.mockImplementation(
      (
        _file: string,
        _args: string[],
        callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        callback?.(null, { stdout: '', stderr: '' });
        return {} as never;
      },
    );
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('restarts with a managed sidecar when a reused external sidecar becomes unhealthy', async () => {
    vi.mocked(sidecarClient.getHealth).mockResolvedValueOnce(
      compatibleHealth({ connectionDeviceManagement: true }),
    );
    vi.mocked(sidecarClient.getHealth).mockRejectedValueOnce(new Error('ECONNREFUSED'));
    vi.mocked(sidecarClient.getHealth).mockRejectedValueOnce(new Error('ECONNREFUSED'));
    vi.mocked(sidecarClient.getHealth).mockResolvedValue(
      compatibleHealth({ connectionDeviceManagement: true }),
    );

    const manager = new SidecarManager();

    await manager.start({ reuseExisting: true });
    expect(spawnMock).not.toHaveBeenCalled();
    expect(manager.getState().status).toBe('healthy');

    await vi.advanceTimersByTimeAsync(3000);
    expect(manager.getState().status).toBe('starting');
    expect(manager.getState().messageCode).toBe('retryingAfterFailure');
    expect(manager.getState().messageArgs).toEqual({ restart: 1, max: 3 });

    await vi.advanceTimersByTimeAsync(1500);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(manager.getState().status).toBe('healthy');
  });

  it('cold starts a fresh sidecar by default in dev mode', async () => {
    vi.mocked(sidecarClient.getHealth).mockResolvedValue(compatibleHealth());

    const manager = new SidecarManager();

    await manager.start();

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(manager.getState().status).toBe('healthy');
  });

  it('does not sync commercial credentials during OSS sidecar startup', async () => {
    vi.mocked(sidecarClient.getHealth).mockResolvedValue(compatibleHealth());

    const manager = new SidecarManager();
    await manager.start();

    expect(manager.getState().status).toBe('healthy');
    expect(syncCredentialsToSidecar).not.toHaveBeenCalled();
  });

  it('only keeps the health interval when the sidecar starts', async () => {
    vi.mocked(sidecarClient.getHealth).mockResolvedValue(compatibleHealth());

    const manager = new SidecarManager();
    await manager.start();
    expect(vi.getTimerCount()).toBe(1);
  });

  it('keeps only restart scheduling timers when the sidecar exits', async () => {
    vi.mocked(sidecarClient.getHealth).mockResolvedValue(compatibleHealth());

    const manager = new SidecarManager();
    await manager.start();

    const child = spawnMock.mock.results[0]?.value as ReturnType<typeof createChildProcessStub>;
    child.emit('exit', 1);

    expect(manager.getState().status).toBe('starting');
    expect(manager.getState().messageCode).toBe('retryingAfterFailure');
    expect(vi.getTimerCount()).toBe(1);
  });

  it('does not schedule commercial credentials refresh without an active session', async () => {
    vi.mocked(sidecarClient.getHealth).mockResolvedValue(compatibleHealth());

    const manager = new SidecarManager();
    await manager.start();

    expect(syncCredentialsToSidecar).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
  });

  it('ignores commercial signaling refresh requests in the OSS desktop runtime', async () => {
    vi.mocked(sidecarClient.getHealth)
      .mockResolvedValueOnce(compatibleHealth({ connectionDeviceManagement: true }))
      .mockResolvedValueOnce({
        ...compatibleHealth({ connectionDeviceManagement: true }),
        tunnel: {
          signalingAuthState: 'refresh_required',
          credentialRefreshRequired: true,
        },
      })
      .mockResolvedValue(compatibleHealth({ connectionDeviceManagement: true }));

    const manager = new SidecarManager();
    await manager.start();
    expect(syncCredentialsToSidecar).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(3000);

    expect(syncCredentialsToSidecar).not.toHaveBeenCalled();
    expect(manager.getState().status).toBe('healthy');
  });

  it('does not reuse an external sidecar without connection device management capability', async () => {
    vi.mocked(sidecarClient.getHealth)
      .mockResolvedValueOnce({
        ok: true,
        service: 'syncflow-sidecar',
      })
      .mockResolvedValue({
        ...compatibleHealth({ connectionDeviceManagement: true }),
      });

    const manager = new SidecarManager();

    await manager.start({ reuseExisting: true });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(manager.getState().status).toBe('healthy');
  });
});
