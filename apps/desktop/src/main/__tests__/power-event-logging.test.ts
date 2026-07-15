import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import log from 'electron-log';
import type { powerMonitor } from 'electron';
import { attachPowerEventLogging } from '../power-event-logging';

vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

class FakePowerMonitor extends EventEmitter {}

describe('attachPowerEventLogging', () => {
  it('records sleep and wake related powerMonitor events', () => {
    const monitor = new FakePowerMonitor() as unknown as typeof powerMonitor;

    attachPowerEventLogging(monitor);

    monitor.emit('suspend');
    monitor.emit('resume');
    monitor.emit('lock-screen');
    monitor.emit('unlock-screen');

    expect(log.info).toHaveBeenCalledWith('[power] event=suspend');
    expect(log.info).toHaveBeenCalledWith('[power] event=resume');
    expect(log.info).toHaveBeenCalledWith('[power] event=lock-screen');
    expect(log.info).toHaveBeenCalledWith('[power] event=unlock-screen');
  });

  it('emits a power snapshot with last resume time for sidecar sync', () => {
    const monitor = new FakePowerMonitor() as unknown as typeof powerMonitor;
    const onSnapshot = vi.fn();

    attachPowerEventLogging(monitor, onSnapshot, () => new Date('2026-06-11T03:50:00.000Z'));

    monitor.emit('resume');

    expect(onSnapshot).toHaveBeenCalledWith({
      event: 'resume',
      state: 'awake',
      lastSuspendAt: null,
      lastResumeAt: '2026-06-11T03:50:00.000Z',
      lastLockAt: null,
      lastUnlockAt: null,
      updatedAt: '2026-06-11T03:50:00.000Z',
    });
  });
});
