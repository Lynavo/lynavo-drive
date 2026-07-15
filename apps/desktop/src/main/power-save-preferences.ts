import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type PowerSavePreferenceState = {
  preventSleepDuringTransfer: boolean;
};

const DEFAULT_POWER_SAVE_PREFERENCES: PowerSavePreferenceState = {
  preventSleepDuringTransfer: true,
};

export class PowerSavePreferences {
  private readonly filePath: string;

  constructor(userDataPath: string) {
    this.filePath = join(userDataPath, 'power-save-preferences.json');
  }

  read(): PowerSavePreferenceState {
    if (!existsSync(this.filePath)) {
      return DEFAULT_POWER_SAVE_PREFERENCES;
    }

    try {
      const parsed = JSON.parse(
        readFileSync(this.filePath, 'utf8'),
      ) as Partial<PowerSavePreferenceState>;
      return {
        preventSleepDuringTransfer:
          parsed.preventSleepDuringTransfer ??
          DEFAULT_POWER_SAVE_PREFERENCES.preventSleepDuringTransfer,
      };
    } catch {
      return DEFAULT_POWER_SAVE_PREFERENCES;
    }
  }

  write(state: PowerSavePreferenceState): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(state, null, 2));
  }
}
