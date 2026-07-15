import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PowerSavePreferences } from '../power-save-preferences';

describe('PowerSavePreferences', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function createStore() {
    const dir = mkdtempSync(join(tmpdir(), 'lynavo-drive-power-save-'));
    dirs.push(dir);
    return new PowerSavePreferences(dir);
  }

  it('defaults prevent sleep during transfer to enabled', () => {
    const store = createStore();

    expect(store.read()).toEqual({ preventSleepDuringTransfer: true });
  });

  it('persists prevent sleep during transfer preference', () => {
    const store = createStore();

    store.write({ preventSleepDuringTransfer: false });

    expect(store.read()).toEqual({ preventSleepDuringTransfer: false });
  });
});
