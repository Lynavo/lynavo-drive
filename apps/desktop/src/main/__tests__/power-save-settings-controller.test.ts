import { describe, expect, it, vi } from 'vitest';
import { PowerSaveSettingsController } from '../power-save-settings-controller';

describe('PowerSaveSettingsController', () => {
  it('persists preference before mutating the runtime power save state', () => {
    const manager = {
      getState: vi.fn(() => ({
        preventSleepDuringTransfer: true,
        blockingSleep: false,
      })),
      setPreventSleepDuringTransfer: vi.fn(() => ({
        preventSleepDuringTransfer: false,
        blockingSleep: false,
      })),
    };
    const preferences = {
      write: vi.fn(() => {
        throw new Error('disk unavailable');
      }),
    };
    const controller = new PowerSaveSettingsController(manager, preferences);

    expect(() => controller.setPreventSleepDuringTransfer(false)).toThrow('disk unavailable');
    expect(manager.setPreventSleepDuringTransfer).not.toHaveBeenCalled();
  });

  it('returns the runtime state after a persisted preference update', () => {
    const manager = {
      getState: vi.fn(() => ({
        preventSleepDuringTransfer: true,
        blockingSleep: false,
      })),
      setPreventSleepDuringTransfer: vi.fn(() => ({
        preventSleepDuringTransfer: false,
        blockingSleep: false,
      })),
    };
    const preferences = {
      write: vi.fn(),
    };
    const controller = new PowerSaveSettingsController(manager, preferences);

    expect(controller.setPreventSleepDuringTransfer(false)).toEqual({
      preventSleepDuringTransfer: false,
      blockingSleep: false,
    });
    expect(preferences.write).toHaveBeenCalledWith({
      preventSleepDuringTransfer: false,
    });
  });
});
