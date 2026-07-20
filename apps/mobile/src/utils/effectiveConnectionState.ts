export type MobileConnectionState =
  'bound' | 'connecting' | 'connected' | 'offline' | 'discovering';

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

const ACTIVE_UPLOAD_STATES = new Set([
  'uploading',
  'preparing',
  'cloud_downloading',
]);

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
  if (ACTIVE_UPLOAD_STATES.has(evidence.uploadState ?? '')) {
    return true;
  }

  return (
    evidence.queueHasUploadingItem === true ||
    evidence.queueHasActiveItem === true
  );
}

export function getEffectiveConnectionState(
  connectionState: MobileConnectionState | null | undefined,
  evidence: SyncConnectionEvidence,
): MobileConnectionState | null | undefined {
  // Native offline is authoritative; stale progress from a previous upload
  // must not keep the badge green.
  if (connectionState === 'offline') {
    return 'offline';
  }

  if (
    evidence.uploadState === 'reconnecting' ||
    evidence.uploadState === 'backoff_waiting'
  ) {
    return 'connecting';
  }

  if (connectionState === 'connected') {
    return 'connected';
  }

  if (connectionState !== 'bound' && syncActivityImpliesConnected(evidence)) {
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
