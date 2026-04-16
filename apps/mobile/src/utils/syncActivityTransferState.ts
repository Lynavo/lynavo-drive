import type { AutoUploadState, UploadTaskSource } from '@syncflow/contracts';

import { hasPendingManualWork } from './manualUploadState';

export interface SyncActivityTransferSnapshot {
  uploadState?: string | null;
  autoUploadState?: AutoUploadState | null;
  currentFileConfirmedBytes?: number | null;
  currentFileTotalBytes?: number | null;
  currentTaskSource?: UploadTaskSource | null;
  manualPending?: number | null;
  autoPending?: number | null;
  completedCount?: number | null;
  totalCount?: number | null;
}

const ACTIVE_TRANSFER_STATES = new Set([
  'uploading',
  'preparing',
  'cloud_downloading',
  'scanning',
  'discovering',
  'reconciling',
]);

function isAutoUploadInterrupted(
  snapshot: SyncActivityTransferSnapshot | null | undefined,
): boolean {
  return (
    snapshot?.uploadState === 'paused_auto_upload' ||
    snapshot?.autoUploadState === 'interrupted'
  );
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function hasOutstandingSyncRoundWork(
  snapshot: SyncActivityTransferSnapshot | null | undefined,
): boolean {
  if (
    isAutoUploadInterrupted(snapshot) &&
    !hasPendingManualWork(snapshot) &&
    snapshot?.currentTaskSource !== 'manual'
  ) {
    return false;
  }

  const totalCount = snapshot?.totalCount ?? 0;
  const completedCount = snapshot?.completedCount ?? 0;
  return totalCount > 0 && completedCount < totalCount;
}

export function isSyncActivityActivelyTransferring(
  snapshot: SyncActivityTransferSnapshot | null | undefined,
): boolean {
  if (
    isAutoUploadInterrupted(snapshot) &&
    !hasPendingManualWork(snapshot) &&
    snapshot?.currentTaskSource !== 'manual'
  ) {
    return false;
  }

  return (
    ACTIVE_TRANSFER_STATES.has(snapshot?.uploadState ?? '') ||
    hasPendingManualWork(snapshot) ||
    (snapshot?.autoPending ?? 0) > 0 ||
    hasOutstandingSyncRoundWork(snapshot)
  );
}

export type SyncActivityMainCardState =
  | 'running'
  | 'standby'
  | 'not_started'
  | 'offline';

export function getSyncActivityMainCardState(
  snapshot: SyncActivityTransferSnapshot | null | undefined,
  isOffline: boolean,
): SyncActivityMainCardState {
  const hasManualWork = hasPendingManualWork(snapshot);
  const isActivelyTransferring = isSyncActivityActivelyTransferring(snapshot);
  const isAutoUploadActive = snapshot?.autoUploadState === 'active';

  if (isOffline && !isActivelyTransferring && !hasManualWork) {
    return 'offline';
  }

  if (isActivelyTransferring || hasManualWork) {
    return 'running';
  }

  if (isAutoUploadActive) {
    return 'standby';
  }

  return 'not_started';
}

export function getSyncActivityProgressPercent(
  snapshot: SyncActivityTransferSnapshot | null | undefined,
): number {
  const currentFileTotalBytes = snapshot?.currentFileTotalBytes ?? 0;
  const currentFileConfirmedBytes = snapshot?.currentFileConfirmedBytes ?? 0;

  if (currentFileTotalBytes > 0) {
    return clampPercent(
      (currentFileConfirmedBytes / currentFileTotalBytes) * 100,
    );
  }

  if (hasOutstandingSyncRoundWork(snapshot)) {
    const totalCount = snapshot?.totalCount ?? 0;
    const completedCount = snapshot?.completedCount ?? 0;
    return clampPercent((completedCount / totalCount) * 100);
  }

  return 0;
}
