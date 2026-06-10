import type { powerSaveBlocker } from 'electron';

type PowerSaveBlocker = Pick<typeof powerSaveBlocker, 'start' | 'stop'>;

export type PowerSaveState = {
  preventSleepDuringTransfer: boolean;
  blockingSleep: boolean;
};

export class PowerSaveManager {
  private enabled = false;
  private transferActive = false;
  private blockerId: number | null = null;

  constructor(private readonly blocker: PowerSaveBlocker) {}

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.syncBlocker();
  }

  setPreventSleepDuringTransfer(enabled: boolean): PowerSaveState {
    this.setEnabled(enabled);
    return this.getState();
  }

  setTransferActive(active: boolean): void {
    this.transferActive = active;
    this.syncBlocker();
  }

  getState(): PowerSaveState {
    return {
      preventSleepDuringTransfer: this.enabled,
      blockingSleep: this.blockerId !== null,
    };
  }

  stop(): void {
    if (this.blockerId === null) {
      return;
    }
    this.blocker.stop(this.blockerId);
    this.blockerId = null;
  }

  private syncBlocker(): void {
    const shouldBlock = this.enabled && this.transferActive;

    if (shouldBlock && this.blockerId === null) {
      this.blockerId = this.blocker.start('prevent-display-sleep');
      return;
    }

    if (!shouldBlock) {
      this.stop();
    }
  }
}
