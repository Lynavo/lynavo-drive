import type { AutoUploadState, UploadTaskSource } from '@lynavo-drive/contracts';

import { hasPendingManualWork } from './manualUploadState';

export interface SyncActivityTransferSnapshot {
  uploadState?: string | null;
  autoUploadState?: AutoUploadState | null;
  currentFileConfirmedBytes?: number | null;
  currentFileTotalBytes?: number | null;
  currentTaskSource?: UploadTaskSource | null;
  lastCompletedTaskSource?: UploadTaskSource | null;
  manualUploadCancelled?: boolean | null;
  manualPending?: number | null;
  autoPending?: number | null;
  completedCount?: number | null;
  totalCount?: number | null;
  lastErrorCode?: string | null;
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

function isAutoUploadStopped(
  snapshot: SyncActivityTransferSnapshot | null | undefined,
): boolean {
  return (
    snapshot?.autoUploadState === 'disabled' ||
    isAutoUploadInterrupted(snapshot)
  );
}

function isReconnectExhaustedOffline(
  snapshot: SyncActivityTransferSnapshot | null | undefined,
): boolean {
  return (
    snapshot?.uploadState === 'offline' ||
    snapshot?.lastErrorCode === 'RECONNECT_EXHAUSTED'
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
    isAutoUploadStopped(snapshot) &&
    !hasPendingManualWork(snapshot) &&
    snapshot?.currentTaskSource !== 'manual'
  ) {
    return false;
  }

  const totalCount = snapshot?.totalCount ?? 0;
  const completedCount = snapshot?.completedCount ?? 0;
  return totalCount > 0 && completedCount < totalCount;
}

function hasFinishedSyncRound(
  snapshot: SyncActivityTransferSnapshot | null | undefined,
): boolean {
  const totalCount = snapshot?.totalCount ?? 0;
  const completedCount = snapshot?.completedCount ?? 0;
  return totalCount > 0 && completedCount >= totalCount;
}

function hasNoPendingQueueWork(
  snapshot: SyncActivityTransferSnapshot | null | undefined,
): boolean {
  return (
    (snapshot?.manualPending ?? 0) === 0 && (snapshot?.autoPending ?? 0) === 0
  );
}

function hasExplicitCompletedTaskSource(
  snapshot: SyncActivityTransferSnapshot | null | undefined,
): boolean {
  return (
    snapshot?.lastCompletedTaskSource === 'manual' ||
    snapshot?.lastCompletedTaskSource === 'auto' ||
    snapshot?.currentTaskSource === 'manual' ||
    snapshot?.currentTaskSource === 'auto'
  );
}

function isFinalUploadPulse(
  snapshot: SyncActivityTransferSnapshot | null | undefined,
): boolean {
  return (
    snapshot?.uploadState === 'uploading' &&
    hasFinishedSyncRound(snapshot) &&
    (snapshot.currentFileTotalBytes ?? 0) > 0 &&
    (snapshot.currentFileConfirmedBytes ?? 0) >=
      (snapshot.currentFileTotalBytes ?? 0)
  );
}

export function isSyncActivityActivelyTransferring(
  snapshot: SyncActivityTransferSnapshot | null | undefined,
): boolean {
  if (isReconnectExhaustedOffline(snapshot)) {
    return false;
  }

  if (
    isAutoUploadStopped(snapshot) &&
    !hasPendingManualWork(snapshot) &&
    snapshot?.currentTaskSource !== 'manual'
  ) {
    return false;
  }

  if (isFinalUploadPulse(snapshot) && hasNoPendingQueueWork(snapshot)) {
    return false;
  }

  return (
    ACTIVE_TRANSFER_STATES.has(snapshot?.uploadState ?? '') ||
    hasPendingManualWork(snapshot) ||
    (snapshot?.autoUploadState === 'active' &&
      (snapshot?.autoPending ?? 0) > 0) ||
    hasOutstandingSyncRoundWork(snapshot)
  );
}

export type SyncActivityMainCardState =
  | 'running'
  | 'standby'
  | 'not_started'
  | 'auto_interrupted'
  | 'offline'
  | 'auto_completed'
  | 'manual_completed';

function getCompletedTaskSource(
  snapshot: SyncActivityTransferSnapshot | null | undefined,
  allowStateFallback = false,
): UploadTaskSource | undefined {
  if (snapshot?.lastCompletedTaskSource === 'manual') {
    return 'manual';
  }
  if (snapshot?.lastCompletedTaskSource === 'auto') {
    return 'auto';
  }
  if (snapshot?.currentTaskSource === 'manual') {
    return 'manual';
  }
  if (snapshot?.currentTaskSource === 'auto') {
    return 'auto';
  }
  if (!allowStateFallback) {
    return undefined;
  }
  if (snapshot?.autoUploadState === 'active') {
    return 'auto';
  }
  if (snapshot?.autoUploadState === 'disabled') {
    return 'manual';
  }
  if (
    snapshot?.autoUploadState === 'interrupted' &&
    hasFinishedSyncRound(snapshot) &&
    hasNoPendingQueueWork(snapshot)
  ) {
    return 'manual';
  }
  return undefined;
}

export function getSyncActivityMainCardState(
  snapshot: SyncActivityTransferSnapshot | null | undefined,
  isOffline: boolean,
): SyncActivityMainCardState {
  if (isOffline && isReconnectExhaustedOffline(snapshot)) {
    return 'offline';
  }

  const hasManualWork = hasPendingManualWork(snapshot);
  const isActivelyTransferring = isSyncActivityActivelyTransferring(snapshot);
  const isAutoUploadActive = snapshot?.autoUploadState === 'active';
  const hasNonEmptyFinishedRound = hasFinishedSyncRound(snapshot);
  const hasCompletionPulse =
    snapshot?.uploadState === 'completed' && hasNonEmptyFinishedRound;
  const hasFinalUploadPulse = isFinalUploadPulse(snapshot);
  const hasCompletionContext = hasExplicitCompletedTaskSource(snapshot);
  const completedTaskSource = getCompletedTaskSource(
    snapshot,
    hasCompletionPulse || hasFinalUploadPulse,
  );
  const isFinishedRound =
    (hasCompletionPulse ||
      (hasNonEmptyFinishedRound &&
        (hasCompletionContext || hasFinalUploadPulse))) &&
    completedTaskSource;
  const isClosedAutoUploadIdle =
    snapshot?.uploadState === 'paused_auto_upload' &&
    snapshot?.autoUploadState === 'interrupted' &&
    hasNoPendingQueueWork(snapshot) &&
    completedTaskSource !== 'manual' &&
    !snapshot?.lastErrorCode;

  if (hasManualWork) {
    return 'running';
  }

  if (snapshot?.manualUploadCancelled && isOffline && !isActivelyTransferring) {
    return 'offline';
  }

  if (snapshot?.manualUploadCancelled) {
    return isAutoUploadActive ? 'standby' : 'not_started';
  }

  if (isFinishedRound && completedTaskSource === 'manual') {
    return 'manual_completed';
  }

  if (isOffline && !isActivelyTransferring && !hasManualWork) {
    return 'offline';
  }

  if (isActivelyTransferring) {
    return 'running';
  }

  if (isClosedAutoUploadIdle) {
    return 'not_started';
  }

  if (isFinishedRound && completedTaskSource) {
    return completedTaskSource === 'manual'
      ? 'manual_completed'
      : 'auto_completed';
  }

  if (snapshot?.autoUploadState === 'interrupted') {
    return 'auto_interrupted';
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
