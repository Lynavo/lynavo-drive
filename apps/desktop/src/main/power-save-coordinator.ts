import type { SidecarEvent } from '@lynavo-drive/contracts';
import type { SidecarRuntimeState } from '../shared/sidecar-runtime';

export type RuntimeSyncAction = 'connect' | 'disconnect';

type TransferActiveProvider = () => Promise<{ active: boolean }>;
type WarnLogger = (message: string, err: unknown) => void;
type PowerSaveTransferManager = {
  setTransferActive(active: boolean): void;
};

export class PowerSaveCoordinator {
  private runtimeGeneration = 0;
  private runtimeHealthy = false;

  constructor(
    private readonly manager: PowerSaveTransferManager,
    private readonly getTransferActive: TransferActiveProvider,
    private readonly warn: WarnLogger,
  ) {}

  handleRuntimeState(state: Pick<SidecarRuntimeState, 'status'>): RuntimeSyncAction {
    const generation = ++this.runtimeGeneration;

    if (state.status === 'healthy') {
      this.runtimeHealthy = true;
      void this.refreshTransferActive(generation);
      return 'connect';
    }

    this.runtimeHealthy = false;
    this.manager.setTransferActive(false);
    return 'disconnect';
  }

  handleSidecarEvent(event: SidecarEvent): void {
    if (event.type === 'transfer.active.changed') {
      this.manager.setTransferActive(event.payload.isActive);
    }
  }

  private async refreshTransferActive(generation: number): Promise<void> {
    try {
      const state = await this.getTransferActive();
      if (!this.runtimeHealthy || generation !== this.runtimeGeneration) {
        return;
      }
      this.manager.setTransferActive(state.active);
    } catch (err) {
      this.warn('[PowerSave] failed to refresh transfer active state:', err);
    }
  }
}
