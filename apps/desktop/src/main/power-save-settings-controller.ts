import type { PowerSaveState } from './power-save-manager';
import type { PowerSavePreferenceState } from './power-save-preferences';

type PowerSaveRuntimeManager = {
  getState(): PowerSaveState;
  setPreventSleepDuringTransfer(enabled: boolean): PowerSaveState;
};

type PowerSavePreferenceStore = {
  write(state: PowerSavePreferenceState): void;
};

export class PowerSaveSettingsController {
  constructor(
    private readonly manager: PowerSaveRuntimeManager,
    private readonly preferences: PowerSavePreferenceStore,
  ) {}

  getState(): PowerSaveState {
    return this.manager.getState();
  }

  setPreventSleepDuringTransfer(enabled: boolean): PowerSaveState {
    this.preferences.write({ preventSleepDuringTransfer: enabled });
    return this.manager.setPreventSleepDuringTransfer(enabled);
  }
}
