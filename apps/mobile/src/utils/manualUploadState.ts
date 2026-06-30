import type { UploadTaskSource } from '@lynavo-drive/contracts';

export interface ManualUploadSnapshot {
  manualPending?: number | null;
  currentTaskSource?: UploadTaskSource | null;
}

export function hasPendingManualWork(
  snapshot: ManualUploadSnapshot | null | undefined,
): boolean {
  return (snapshot?.manualPending ?? 0) > 0 || snapshot?.currentTaskSource === 'manual';
}
