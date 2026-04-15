export type MobileConnectionState =
  | 'bound'
  | 'connecting'
  | 'connected'
  | 'offline'
  | 'discovering';

export type SyncConnectionEvidence = {
  progressPercent?: number | null;
  queueHasUploadingItem?: boolean;
  queueHasActiveItem?: boolean;
  transferredBytes?: number | null;
  uploadState?: string | null;
  currentFileKey?: string | null;
};

export type SyncConnectionSnapshot = {
  progressPercent?: number | null;
  queueHasUploadingItem?: boolean;
  queueHasActiveItem?: boolean;
  transferredBytes?: number | null;
  currentFile?: string | null;
  currentFileConfirmedBytes?: number | null;
  uploadState?: string | null;
};

export type ConnectionBadgeState = 'online' | 'connecting' | 'offline';

export function buildSyncConnectionEvidence(
  snapshot: SyncConnectionSnapshot,
): SyncConnectionEvidence {
  return {
    progressPercent: snapshot.progressPercent,
    queueHasUploadingItem: snapshot.queueHasUploadingItem,
    queueHasActiveItem: snapshot.queueHasActiveItem,
    transferredBytes:
      snapshot.currentFileConfirmedBytes ?? snapshot.transferredBytes,
    uploadState: snapshot.uploadState,
    currentFileKey: snapshot.currentFile,
  };
}

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
  if (connectionState === 'connected' || connectionState === 'bound') {
    return 'connected';
  }

  // When the native layer explicitly says offline, only override if the queue
  // proves a transfer is truly in-flight right now — stale progress values
  // (e.g. 100% from a previous completed upload) must not keep the badge green.
  if (connectionState === 'offline') {
    return 'offline';
  }

  if (syncActivityImpliesConnected(evidence)) {
    return 'connected';
  }

  return connectionState;
}

export function getConnectionBadgeState(
  connectionState: MobileConnectionState | null | undefined,
  evidence: SyncConnectionEvidence,
): ConnectionBadgeState {
  const effectiveConnectionState = getEffectiveConnectionState(
    connectionState,
    evidence,
  );

  if (effectiveConnectionState === 'connected') {
    return 'online';
  }

  if (
    effectiveConnectionState === 'bound' ||
    effectiveConnectionState === 'connecting' ||
    effectiveConnectionState === 'discovering'
  ) {
    return 'connecting';
  }

  return 'offline';
}
