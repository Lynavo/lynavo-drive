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
      manualPending: 0,
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
      manualPending: 0,
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
      manualPending: 0,
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
      manualPending: 0,
      currentTaskSource: undefined,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
    };

    expect(isSyncActivityActivelyTransferring(snapshot)).toBe(false);
    expect(getSyncActivityMainCardState(snapshot, false)).toBe('standby');
  });

  it('keeps running state when manual work exists even if auto upload is also active', () => {
    const snapshot = {
      uploadState: 'idle',
      autoUploadState: 'active' as const,
      completedCount: 0,
      totalCount: 0,
      autoPending: 0,
      manualPending: 2,
      currentTaskSource: 'manual' as const,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
    };

    expect(getSyncActivityMainCardState(snapshot, false)).toBe('running');
  });

  it('shows an interrupted card after auto upload is interrupted', () => {
    const snapshot = {
      uploadState: 'paused_auto_upload',
      autoUploadState: 'interrupted' as const,
      completedCount: 1,
      totalCount: 3,
      autoPending: 2,
      manualPending: 0,
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
      manualPending: 0,
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
      manualPending: 0,
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
      manualPending: 0,
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
      manualPending: 0,
      currentTaskSource: undefined,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
    };

    expect(getSyncActivityMainCardState(snapshot, false)).toBe('not_started');
  });

  it('treats discovering state as actively transferring for preparation phase', () => {
    const snapshot = {
      uploadState: 'discovering',
      autoUploadState: 'active' as const,
      completedCount: 0,
      totalCount: 0,
      autoPending: 0,
      manualPending: 0,
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
      manualPending: 0,
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
      manualPending: 0,
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
      manualPending: 0,
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
      manualPending: 0,
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

  it('shows manual completed state after a manual round finishes', () => {
    const snapshot = {
      uploadState: 'completed',
      autoUploadState: 'disabled' as const,
      completedCount: 12,
      totalCount: 12,
      autoPending: 0,
      manualPending: 0,
      currentTaskSource: undefined,
      lastCompletedTaskSource: 'manual' as const,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
    };

    expect(isSyncActivityActivelyTransferring(snapshot)).toBe(false);
    expect(getSyncActivityMainCardState(snapshot, false)).toBe(
      'manual_completed',
    );
  });

  it('treats an empty completed auto pulse as standby instead of completion', () => {
    const snapshot = {
      uploadState: 'completed',
      autoUploadState: 'active' as const,
      completedCount: 0,
      totalCount: 0,
      autoPending: 0,
      manualPending: 0,
      currentTaskSource: undefined,
      lastCompletedTaskSource: undefined,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
    };

    expect(isSyncActivityActivelyTransferring(snapshot)).toBe(false);
    expect(getSyncActivityMainCardState(snapshot, false)).toBe('standby');
  });

  it('keeps manual completed state after native settles back to idle', () => {
    const snapshot = {
      uploadState: 'idle',
      autoUploadState: 'disabled' as const,
      completedCount: 1,
      totalCount: 1,
      autoPending: 0,
      manualPending: 0,
      currentTaskSource: undefined,
      lastCompletedTaskSource: 'manual' as const,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
    };

    expect(isSyncActivityActivelyTransferring(snapshot)).toBe(false);
    expect(getSyncActivityMainCardState(snapshot, false)).toBe(
      'manual_completed',
    );
  });

  it('does not show manual completed state on a fresh idle snapshot from persisted queue stats', () => {
    const snapshot = {
      uploadState: 'idle',
      autoUploadState: 'disabled' as const,
      completedCount: 1,
      totalCount: 1,
      autoPending: 0,
      manualPending: 0,
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
      manualPending: 0,
      currentTaskSource: undefined,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
    };

    expect(isSyncActivityActivelyTransferring(snapshot)).toBe(false);
    expect(getSyncActivityMainCardState(snapshot, false)).toBe('standby');
  });

  it('keeps manual completed state after a finished manual round settles into paused_auto_upload', () => {
    const snapshot = {
      uploadState: 'paused_auto_upload',
      autoUploadState: 'interrupted' as const,
      completedCount: 12,
      totalCount: 12,
      autoPending: 0,
      manualPending: 0,
      currentTaskSource: undefined,
      lastCompletedTaskSource: 'manual' as const,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
    };

    expect(isSyncActivityActivelyTransferring(snapshot)).toBe(false);
    expect(getSyncActivityMainCardState(snapshot, false)).toBe(
      'manual_completed',
    );
  });

  it('does not show manual completion when a cancelled payload carries stale finished counts', () => {
    const snapshot = {
      uploadState: 'idle',
      autoUploadState: 'interrupted' as const,
      completedCount: 7,
      totalCount: 7,
      autoPending: 0,
      manualPending: 0,
      currentTaskSource: undefined,
      lastCompletedTaskSource: 'manual' as const,
      manualUploadCancelled: true,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
    };

    expect(getSyncActivityMainCardState(snapshot, false)).toBe('not_started');
  });

  it('keeps offline state ahead of a cancelled manual upload snapshot', () => {
    const snapshot = {
      uploadState: 'idle',
      autoUploadState: 'disabled' as const,
      completedCount: 7,
      totalCount: 7,
      autoPending: 0,
      manualPending: 0,
      currentTaskSource: undefined,
      lastCompletedTaskSource: 'manual' as const,
      manualUploadCancelled: true,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
    };

    expect(getSyncActivityMainCardState(snapshot, true)).toBe('offline');
  });

  it('shows manual completed state when the final upload pulse has cleared current source', () => {
    const snapshot = {
      uploadState: 'uploading',
      autoUploadState: 'interrupted' as const,
      completedCount: 22,
      totalCount: 22,
      autoPending: 0,
      manualPending: 0,
      currentTaskSource: undefined,
      lastCompletedTaskSource: undefined,
      currentFileConfirmedBytes: 546828,
      currentFileTotalBytes: 546828,
    };

    expect(isSyncActivityActivelyTransferring(snapshot)).toBe(false);
    expect(getSyncActivityMainCardState(snapshot, false)).toBe(
      'manual_completed',
    );
  });

  it('shows auto completed state for the final auto upload pulse', () => {
    const snapshot = {
      uploadState: 'uploading',
      autoUploadState: 'active' as const,
      completedCount: 5,
      totalCount: 5,
      autoPending: 0,
      manualPending: 0,
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

  it('keeps manual completed state when native emits a scanning pulse after the last file', () => {
    const snapshot = {
      uploadState: 'scanning',
      autoUploadState: 'disabled' as const,
      completedCount: 12,
      totalCount: 12,
      autoPending: 0,
      manualPending: 0,
      currentTaskSource: undefined,
      lastCompletedTaskSource: 'manual' as const,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
    };

    expect(getSyncActivityMainCardState(snapshot, false)).toBe(
      'manual_completed',
    );
  });

  it('prioritizes newly queued manual work over stale manual completion stats', () => {
    const snapshot = {
      uploadState: 'scanning',
      autoUploadState: 'interrupted' as const,
      completedCount: 12,
      totalCount: 12,
      autoPending: 0,
      manualPending: 2,
      currentTaskSource: undefined,
      lastCompletedTaskSource: 'manual' as const,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
    };

    expect(getSyncActivityMainCardState(snapshot, false)).toBe('running');
  });

  // Regression: during Wi-Fi flip mid-manual-batch the native layer emits
  // uploadState='reconnecting'. Before this was added to the preparation-
  // phase list the running card fell through to the "auto upload running"
  // fallback, producing a Frankenstein UI mixing manual badge + auto title
  // + "取消本次手動上傳" button. Both the selector (mainCardState) and
  // the screen's PREPARATION_STATES must agree that reconnecting is a
  // preparation phase so the active-but-idle else-branch is never reached.
  it('keeps running state during reconnecting when a manual batch is pending', () => {
    const snapshot = {
      uploadState: 'reconnecting',
      autoUploadState: 'interrupted' as const,
      completedCount: 0,
      totalCount: 1,
      autoPending: 0,
      manualPending: 1,
      currentTaskSource: 'manual' as const,
      lastCompletedTaskSource: undefined,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
    };

    // Offline debounce may or may not have fired; selector behaviour must
    // be the same either way because hasManualWork short-circuits first.
    expect(getSyncActivityMainCardState(snapshot, false)).toBe('running');
    expect(getSyncActivityMainCardState(snapshot, true)).toBe('running');
  });

  it('keeps running state during reconnecting mid-batch (after a file has completed)', () => {
    const snapshot = {
      uploadState: 'reconnecting',
      autoUploadState: 'interrupted' as const,
      completedCount: 3,
      totalCount: 6,
      autoPending: 0,
      manualPending: 3,
      currentTaskSource: 'manual' as const,
      lastCompletedTaskSource: 'manual' as const,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
    };

    expect(getSyncActivityMainCardState(snapshot, false)).toBe('running');
    expect(getSyncActivityMainCardState(snapshot, true)).toBe('running');
  });
});
