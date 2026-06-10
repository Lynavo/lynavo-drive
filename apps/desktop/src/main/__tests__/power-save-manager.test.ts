import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PowerSaveManager } from '../power-save-manager';

function createBlocker() {
  return {
    start: vi.fn(() => 42),
    stop: vi.fn(),
  };
}

describe('PowerSaveManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts display sleep blocker only when enabled and transfer is active', () => {
    const blocker = createBlocker();
    const manager = new PowerSaveManager(blocker);

    manager.setEnabled(true);
    expect(blocker.start).not.toHaveBeenCalled();

    manager.setTransferActive(true);

    expect(blocker.start).toHaveBeenCalledWith('prevent-display-sleep');
    expect(blocker.start).toHaveBeenCalledTimes(1);
  });

  it('stops the blocker when transfer becomes inactive', () => {
    const blocker = createBlocker();
    const manager = new PowerSaveManager(blocker);

    manager.setEnabled(true);
    manager.setTransferActive(true);
    manager.setTransferActive(false);

    expect(blocker.stop).toHaveBeenCalledWith(42);
  });

  it('stops the blocker when the preference is disabled during transfer', () => {
    const blocker = createBlocker();
    const manager = new PowerSaveManager(blocker);

    manager.setEnabled(true);
    manager.setTransferActive(true);
    manager.setEnabled(false);

    expect(blocker.stop).toHaveBeenCalledWith(42);
  });

  it('does not start duplicate blockers while already active', () => {
    const blocker = createBlocker();
    const manager = new PowerSaveManager(blocker);

    manager.setEnabled(true);
    manager.setTransferActive(true);
    manager.setTransferActive(true);
    manager.setEnabled(true);

    expect(blocker.start).toHaveBeenCalledTimes(1);
  });

  it('reports preference and active blocker state', () => {
    const blocker = createBlocker();
    const manager = new PowerSaveManager(blocker);

    expect(manager.getState()).toEqual({
      preventSleepDuringTransfer: false,
      blockingSleep: false,
    });

    manager.setPreventSleepDuringTransfer(true);
    manager.setTransferActive(true);

    expect(manager.getState()).toEqual({
      preventSleepDuringTransfer: true,
      blockingSleep: true,
    });
  });
});
