export type MobileConnectionState =
  | 'bound'
  | 'connecting'
  | 'connected'
  | 'offline'
  | 'discovering';

type SyncConnectionEvidence = {
  progressPercent?: number | null;
  queueHasUploadingItem?: boolean;
  queueHasActiveItem?: boolean;
  transferredBytes?: number | null;
  uploadState?: string | null;
  currentFileKey?: string | null;
};

export function syncActivityImpliesConnected(
  evidence: SyncConnectionEvidence,
): boolean {
  if (
    evidence.uploadState === 'uploading' ||
    evidence.uploadState === 'completed' ||
    evidence.uploadState === 'preparing' ||
    evidence.uploadState === 'cloud_downloading' ||
    evidence.uploadState === 'reconnecting'
  ) {
    return true;
  }

  if ((evidence.progressPercent ?? 0) > 0 || (evidence.transferredBytes ?? 0) > 0) {
    return true;
  }

  if (evidence.currentFileKey) {
    return true;
  }

  return evidence.queueHasUploadingItem === true || evidence.queueHasActiveItem === true;
}

export function getEffectiveConnectionState(
  connectionState: MobileConnectionState | null | undefined,
  evidence: SyncConnectionEvidence,
): MobileConnectionState | null | undefined {
  if (connectionState === 'connected') {
    return 'connected';
  }

  if (syncActivityImpliesConnected(evidence)) {
    return 'connected';
  }

  return connectionState;
}
