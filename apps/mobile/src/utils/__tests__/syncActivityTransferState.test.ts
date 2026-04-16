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

  it('does not keep the running card after auto upload is interrupted', () => {
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
});
