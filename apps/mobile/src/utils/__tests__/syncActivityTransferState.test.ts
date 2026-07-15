import {
  getSyncActivityMainCardState,
  getSyncActivityProgressPercent,
  hasOutstandingSyncRoundWork,
  isSyncActivityActivelyTransferring,
} from '../syncActivityTransferState';

describe('syncActivityTransferState', () => {
  it('treats an unfinished round as still transferring during file switch gaps', () => {
    const snapshot = {
      uploadState: 'idle',
      completedCount: 1,
      totalCount: 3,
      autoPending: 0,
      currentTaskSource: undefined,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
    };

    expect(hasOutstandingSyncRoundWork(snapshot)).toBe(true);
    expect(isSyncActivityActivelyTransferring(snapshot)).toBe(true);
    expect(getSyncActivityProgressPercent(snapshot)).toBe(33);
  });

  it('uses current file progress when a file is actively uploading', () => {
    const snapshot = {
      uploadState: 'uploading',
      completedCount: 1,
      totalCount: 3,
      autoPending: 1,
      currentTaskSource: 'auto' as const,
      currentFileConfirmedBytes: 50,
      currentFileTotalBytes: 200,
    };

    expect(isSyncActivityActivelyTransferring(snapshot)).toBe(true);
    expect(getSyncActivityProgressPercent(snapshot)).toBe(25);
  });

  it('falls back to idle when there is no active file and no unfinished round', () => {
    const snapshot = {
      uploadState: 'idle',
      completedCount: 3,
      totalCount: 3,
      autoPending: 0,
      currentTaskSource: undefined,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
    };

    expect(hasOutstandingSyncRoundWork(snapshot)).toBe(false);
    expect(isSyncActivityActivelyTransferring(snapshot)).toBe(false);
    expect(getSyncActivityProgressPercent(snapshot)).toBe(0);
  });

  it('treats active auto upload without queue work as standby instead of running', () => {
    const snapshot = {
      uploadState: 'idle',
      autoUploadState: 'active' as const,
      completedCount: 0,
      totalCount: 0,
      autoPending: 0,
      currentTaskSource: undefined,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
    };

    expect(isSyncActivityActivelyTransferring(snapshot)).toBe(false);
    expect(getSyncActivityMainCardState(snapshot, false)).toBe('standby');
  });

  it('ignores stale non-auto queue fields when auto upload has no work', () => {
    const snapshot = {
      uploadState: 'idle',
      autoUploadState: 'active' as const,
      completedCount: 0,
      totalCount: 0,
      autoPending: 0,
      currentTaskSource: 'legacy' as never,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
    };

    expect(isSyncActivityActivelyTransferring(snapshot)).toBe(false);
    expect(getSyncActivityMainCardState(snapshot, false)).toBe('standby');
  });

  it('shows an interrupted card after auto upload is interrupted', () => {
    const snapshot = {
      uploadState: 'paused_auto_upload',
      autoUploadState: 'interrupted' as const,
      completedCount: 1,
      totalCount: 3,
      autoPending: 2,
      currentTaskSource: undefined,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
    };

    expect(hasOutstandingSyncRoundWork(snapshot)).toBe(false);
    expect(isSyncActivityActivelyTransferring(snapshot)).toBe(false);
    expect(getSyncActivityMainCardState(snapshot, false)).toBe(
      'auto_interrupted',
    );
  });

  it('returns to not-started after closing auto upload from standby', () => {
    const snapshot = {
      uploadState: 'paused_auto_upload',
      autoUploadState: 'interrupted' as const,
      completedCount: 0,
      totalCount: 0,
      autoPending: 0,
      currentTaskSource: undefined,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
    };

    expect(isSyncActivityActivelyTransferring(snapshot)).toBe(false);
    expect(getSyncActivityMainCardState(snapshot, false)).toBe('not_started');
  });

  it('returns to not-started when closing auto upload after an auto round completed', () => {
    const snapshot = {
      uploadState: 'paused_auto_upload',
      autoUploadState: 'interrupted' as const,
      completedCount: 2,
      totalCount: 2,
      autoPending: 0,
      currentTaskSource: undefined,
      lastCompletedTaskSource: 'auto' as const,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
    };

    expect(isSyncActivityActivelyTransferring(snapshot)).toBe(false);
    expect(getSyncActivityMainCardState(snapshot, false)).toBe('not_started');
  });

  it('keeps interrupted state when auto upload is paused by a storage error', () => {
    const snapshot = {
      uploadState: 'paused_auto_upload',
      autoUploadState: 'interrupted' as const,
      completedCount: 0,
      totalCount: 0,
      autoPending: 0,
      currentTaskSource: undefined,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
      lastErrorCode: 'STORAGE_UNAVAILABLE',
    };

    expect(isSyncActivityActivelyTransferring(snapshot)).toBe(false);
    expect(getSyncActivityMainCardState(snapshot, false)).toBe(
      'auto_interrupted',
    );
  });

  it('keeps disabled auto upload on the not-started card', () => {
    const snapshot = {
      uploadState: 'idle',
      autoUploadState: 'disabled' as const,
      completedCount: 0,
      totalCount: 0,
      autoPending: 0,
      currentTaskSource: undefined,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
    };

    expect(getSyncActivityMainCardState(snapshot, false)).toBe('not_started');
  });

  it('keeps disabled auto upload on the not-started card even with auto queue pending', () => {
    const snapshot = {
      uploadState: 'idle',
      autoUploadState: 'disabled' as const,
      completedCount: 0,
      totalCount: 237,
      autoPending: 237,
      currentTaskSource: undefined,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
    };

    expect(hasOutstandingSyncRoundWork(snapshot)).toBe(false);
    expect(isSyncActivityActivelyTransferring(snapshot)).toBe(false);
    expect(getSyncActivityMainCardState(snapshot, false)).toBe('not_started');
  });

  it('treats discovering state as actively transferring for preparation phase', () => {
    const snapshot = {
      uploadState: 'discovering',
      autoUploadState: 'active' as const,
      completedCount: 0,
      totalCount: 0,
      autoPending: 0,
      currentTaskSource: undefined,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
    };

    expect(isSyncActivityActivelyTransferring(snapshot)).toBe(true);
    expect(getSyncActivityMainCardState(snapshot, false)).toBe('running');
  });

  it('treats reconciling state as actively transferring for preparation phase', () => {
    const snapshot = {
      uploadState: 'reconciling',
      autoUploadState: 'active' as const,
      completedCount: 0,
      totalCount: 0,
      autoPending: 0,
      currentTaskSource: undefined,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
    };

    expect(isSyncActivityActivelyTransferring(snapshot)).toBe(true);
    expect(getSyncActivityMainCardState(snapshot, false)).toBe('running');
  });

  it('keeps the running card during active transfer even if offline is briefly reported', () => {
    const snapshot = {
      uploadState: 'uploading',
      autoUploadState: 'active' as const,
      completedCount: 1,
      totalCount: 3,
      autoPending: 1,
      currentTaskSource: 'auto' as const,
      currentFileConfirmedBytes: 50,
      currentFileTotalBytes: 200,
    };

    expect(isSyncActivityActivelyTransferring(snapshot)).toBe(true);
    expect(getSyncActivityMainCardState(snapshot, true)).toBe('running');
  });

  it('shows offline after reconnect attempts are exhausted even with auto queue work', () => {
    const snapshot = {
      uploadState: 'offline',
      autoUploadState: 'active' as const,
      completedCount: 1,
      totalCount: 3,
      autoPending: 2,
      currentTaskSource: 'auto' as const,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
      lastErrorCode: 'RECONNECT_EXHAUSTED',
    };

    expect(isSyncActivityActivelyTransferring(snapshot)).toBe(false);
    expect(getSyncActivityMainCardState(snapshot, true)).toBe('offline');
  });

  it('shows auto completed state after an auto round finishes', () => {
    const snapshot = {
      uploadState: 'completed',
      autoUploadState: 'active' as const,
      completedCount: 12,
      totalCount: 12,
      autoPending: 0,
      currentTaskSource: undefined,
      lastCompletedTaskSource: 'auto' as const,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
    };

    expect(isSyncActivityActivelyTransferring(snapshot)).toBe(false);
    expect(getSyncActivityMainCardState(snapshot, false)).toBe(
      'auto_completed',
    );
  });

  it('does not show a completion card for stale non-auto source snapshots', () => {
    const snapshot = {
      uploadState: 'completed',
      autoUploadState: 'disabled' as const,
      completedCount: 12,
      totalCount: 12,
      autoPending: 0,
      currentTaskSource: undefined,
      lastCompletedTaskSource: 'legacy' as never,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
    };

    expect(isSyncActivityActivelyTransferring(snapshot)).toBe(false);
    expect(getSyncActivityMainCardState(snapshot, false)).toBe('not_started');
  });

  it('treats an empty completed auto pulse as standby instead of completion', () => {
    const snapshot = {
      uploadState: 'completed',
      autoUploadState: 'active' as const,
      completedCount: 0,
      totalCount: 0,
      autoPending: 0,
      currentTaskSource: undefined,
      lastCompletedTaskSource: undefined,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
    };

    expect(isSyncActivityActivelyTransferring(snapshot)).toBe(false);
    expect(getSyncActivityMainCardState(snapshot, false)).toBe('standby');
  });

  it('ignores stale non-auto completion after native settles back to idle', () => {
    const snapshot = {
      uploadState: 'idle',
      autoUploadState: 'disabled' as const,
      completedCount: 1,
      totalCount: 1,
      autoPending: 0,
      currentTaskSource: undefined,
      lastCompletedTaskSource: 'legacy' as never,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
    };

    expect(isSyncActivityActivelyTransferring(snapshot)).toBe(false);
    expect(getSyncActivityMainCardState(snapshot, false)).toBe('not_started');
  });

  it('does not show manual completed state on a fresh idle snapshot from persisted queue stats', () => {
    const snapshot = {
      uploadState: 'idle',
      autoUploadState: 'disabled' as const,
      completedCount: 1,
      totalCount: 1,
      autoPending: 0,
      currentTaskSource: undefined,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
    };

    expect(isSyncActivityActivelyTransferring(snapshot)).toBe(false);
    expect(getSyncActivityMainCardState(snapshot, false)).toBe('not_started');
  });

  it('does not show auto completed state on a fresh idle snapshot from persisted queue stats', () => {
    const snapshot = {
      uploadState: 'idle',
      autoUploadState: 'active' as const,
      completedCount: 12,
      totalCount: 12,
      autoPending: 0,
      currentTaskSource: undefined,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
    };

    expect(isSyncActivityActivelyTransferring(snapshot)).toBe(false);
    expect(getSyncActivityMainCardState(snapshot, false)).toBe('standby');
  });

  it('does not preserve stale non-auto completion after auto upload is closed', () => {
    const snapshot = {
      uploadState: 'paused_auto_upload',
      autoUploadState: 'interrupted' as const,
      completedCount: 12,
      totalCount: 12,
      autoPending: 0,
      currentTaskSource: undefined,
      lastCompletedTaskSource: 'legacy' as never,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
    };

    expect(isSyncActivityActivelyTransferring(snapshot)).toBe(false);
    expect(getSyncActivityMainCardState(snapshot, false)).toBe('not_started');
  });

  it('ignores stale non-auto cancellation fields and follows auto interrupted state', () => {
    const snapshot = {
      uploadState: 'idle',
      autoUploadState: 'interrupted' as const,
      completedCount: 7,
      totalCount: 7,
      autoPending: 0,
      currentTaskSource: undefined,
      lastCompletedTaskSource: 'legacy' as never,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
    };

    expect(getSyncActivityMainCardState(snapshot, false)).toBe(
      'auto_interrupted',
    );
  });

  it('keeps offline state ahead of a stale non-auto source snapshot', () => {
    const snapshot = {
      uploadState: 'idle',
      autoUploadState: 'disabled' as const,
      completedCount: 7,
      totalCount: 7,
      autoPending: 0,
      currentTaskSource: undefined,
      lastCompletedTaskSource: 'legacy' as never,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
    };

    expect(getSyncActivityMainCardState(snapshot, true)).toBe('offline');
  });

  it('does not infer non-auto completion from a final upload pulse without auto context', () => {
    const snapshot = {
      uploadState: 'uploading',
      autoUploadState: 'interrupted' as const,
      completedCount: 22,
      totalCount: 22,
      autoPending: 0,
      currentTaskSource: undefined,
      lastCompletedTaskSource: undefined,
      currentFileConfirmedBytes: 546828,
      currentFileTotalBytes: 546828,
    };

    expect(isSyncActivityActivelyTransferring(snapshot)).toBe(false);
    expect(getSyncActivityMainCardState(snapshot, false)).toBe(
      'auto_interrupted',
    );
  });

  it('shows auto completed state for the final auto upload pulse', () => {
    const snapshot = {
      uploadState: 'uploading',
      autoUploadState: 'active' as const,
      completedCount: 5,
      totalCount: 5,
      autoPending: 0,
      currentTaskSource: undefined,
      lastCompletedTaskSource: 'auto' as const,
      currentFileConfirmedBytes: 42_943_681,
      currentFileTotalBytes: 42_943_681,
    };

    expect(isSyncActivityActivelyTransferring(snapshot)).toBe(false);
    expect(getSyncActivityMainCardState(snapshot, false)).toBe(
      'auto_completed',
    );
  });

  it('ignores stale non-auto completion when native emits a scanning pulse', () => {
    const snapshot = {
      uploadState: 'scanning',
      autoUploadState: 'disabled' as const,
      completedCount: 12,
      totalCount: 12,
      autoPending: 0,
      currentTaskSource: undefined,
      lastCompletedTaskSource: 'legacy' as never,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
    };

    expect(getSyncActivityMainCardState(snapshot, false)).toBe('not_started');
  });

  it('does not prioritize stale non-auto queue fields over auto interruption', () => {
    const snapshot = {
      uploadState: 'scanning',
      autoUploadState: 'interrupted' as const,
      completedCount: 12,
      totalCount: 12,
      autoPending: 0,
      currentTaskSource: undefined,
      lastCompletedTaskSource: 'legacy' as never,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
    };

    expect(getSyncActivityMainCardState(snapshot, false)).toBe(
      'auto_interrupted',
    );
  });

  it('does not keep running state for stale non-auto work during reconnecting', () => {
    const snapshot = {
      uploadState: 'reconnecting',
      autoUploadState: 'interrupted' as const,
      completedCount: 0,
      totalCount: 1,
      autoPending: 0,
      currentTaskSource: 'legacy' as never,
      lastCompletedTaskSource: undefined,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
    };

    expect(getSyncActivityMainCardState(snapshot, false)).toBe(
      'auto_interrupted',
    );
    expect(getSyncActivityMainCardState(snapshot, true)).toBe('offline');
  });

  it('does not keep running state during stale non-auto reconnecting snapshots', () => {
    const snapshot = {
      uploadState: 'reconnecting',
      autoUploadState: 'interrupted' as const,
      completedCount: 3,
      totalCount: 6,
      autoPending: 0,
      currentTaskSource: 'legacy' as never,
      lastCompletedTaskSource: 'legacy' as never,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
    };

    expect(getSyncActivityMainCardState(snapshot, false)).toBe(
      'auto_interrupted',
    );
    expect(getSyncActivityMainCardState(snapshot, true)).toBe('offline');
  });
});
