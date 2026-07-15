import { describe, expect, it, vi } from 'vitest';
import { PowerSaveCoordinator } from '../power-save-coordinator';

function createManager() {
  return {
    setTransferActive: vi.fn(),
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe('PowerSaveCoordinator', () => {
  it('ignores stale transfer-active refresh after runtime becomes unhealthy', async () => {
    const manager = createManager();
    const refresh = createDeferred<{ active: boolean }>();
    const coordinator = new PowerSaveCoordinator(manager, () => refresh.promise, vi.fn());

    expect(coordinator.handleRuntimeState({ status: 'healthy' })).toBe('connect');
    expect(coordinator.handleRuntimeState({ status: 'failed' })).toBe('disconnect');

    refresh.resolve({ active: true });
    await refresh.promise;
    await Promise.resolve();

    expect(manager.setTransferActive).toHaveBeenCalledTimes(1);
    expect(manager.setTransferActive).toHaveBeenCalledWith(false);
  });

  it('applies transfer-active refresh while runtime is still healthy', async () => {
    const manager = createManager();
    const coordinator = new PowerSaveCoordinator(manager, async () => ({ active: true }), vi.fn());

    expect(coordinator.handleRuntimeState({ status: 'healthy' })).toBe('connect');
    await Promise.resolve();

    expect(manager.setTransferActive).toHaveBeenCalledWith(true);
  });

  it('updates transfer activity from sidecar events', () => {
    const manager = createManager();
    const coordinator = new PowerSaveCoordinator(manager, async () => ({ active: false }), vi.fn());

    coordinator.handleSidecarEvent({
      type: 'transfer.active.changed',
      payload: { isActive: true },
    });

    expect(manager.setTransferActive).toHaveBeenCalledWith(true);
  });
});
