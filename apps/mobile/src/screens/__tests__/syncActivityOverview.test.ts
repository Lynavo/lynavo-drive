import {
  buildOverview,
  getSyncActivityAutoRoundDisplayMetrics,
  getTrialUpgradeEntryDays,
  getSyncActivityDisplayProgressPercent,
  isPreparationPhase,
  resolveSyncErrorAlertMessage,
  shouldBypassOfflineDisplayDelay,
  shouldKickAutoUploadSyncAfterGateRelease,
  shouldRenderSyncActivityProgress,
  shouldShowSubscriptionExpiredOverlay,
  shouldTreatSyncActivityAsBetweenItems,
} from '../SyncActivityScreen';
import { getSyncActivityMainCardState } from '../../utils/syncActivityTransferState';
import type { TFunction } from 'i18next';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: jest.fn(),
    dispatch: jest.fn(),
  }),
  useIsFocused: () => true,
  CommonActions: {
    reset: jest.fn(),
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('../../components/Icon', () => ({
  Icon: () => null,
}));

jest.mock('../../stores/auth-store', () => ({
  useAuth: () => ({
    isLoggedIn: false,
    user: null,
  }),
  isFeatureAccessAllowed: () => true,
}));

describe('buildOverview', () => {
  it('clears stale current file fields when scanning payload explicitly sends null', () => {
    const prev = {
      progressPercent: 100,
      currentSpeedMbps: 12.4,
      uploadState: 'completed',
      completedCount: 8,
      totalCount: 8,
      completedBytes: 1024,
      totalBytes: 1024,
      currentFile: 'old-file-key',
      currentFilename: 'old-file.jpg',
      currentFileConfirmedBytes: 1024,
      currentFileTotalBytes: 1024,
      currentTaskSource: null,
      autoUploadState: 'active' as const,
      manualPending: 0,
      autoPending: 0,
    };

    const next = buildOverview(
      {
        uploadState: 'scanning',
        progressPercent: 0,
        currentFile: null,
        currentFilename: null,
        currentFileConfirmedBytes: 0,
        currentFileTotalBytes: 0,
      },
      prev,
    );

    expect(next.uploadState).toBe('scanning');
    expect(next.progressPercent).toBe(0);
    expect(next.currentFile).toBeUndefined();
    expect(next.currentFilename).toBeUndefined();
    expect(next.currentFileConfirmedBytes).toBe(0);
    expect(next.currentFileTotalBytes).toBe(0);
  });

  it('keeps previous file fields only when payload omits them entirely', () => {
    const prev = {
      progressPercent: 35,
      currentSpeedMbps: 8.2,
      uploadState: 'uploading',
      completedCount: 2,
      totalCount: 5,
      completedBytes: 512,
      totalBytes: 2048,
      currentFile: 'file-key-1',
      currentFilename: 'clip.mov',
      currentFileConfirmedBytes: 350,
      currentFileTotalBytes: 1000,
      currentTaskSource: 'auto' as const,
      autoUploadState: 'active' as const,
      manualPending: 0,
      autoPending: 1,
    };

    const next = buildOverview(
      {
        uploadState: 'uploading',
      },
      prev,
    );

    expect(next.currentFile).toBe('file-key-1');
    expect(next.currentFilename).toBe('clip.mov');
    expect(next.currentFileConfirmedBytes).toBe(350);
    expect(next.currentFileTotalBytes).toBe(1000);
  });

  it('captures the last completed task source for the completion card', () => {
    const prev = {
      progressPercent: 92,
      currentSpeedMbps: 8.2,
      uploadState: 'uploading',
      completedCount: 11,
      totalCount: 12,
      completedBytes: 4096,
      totalBytes: 8192,
      currentFile: 'file-key-2',
      currentFilename: 'clip-2.mov',
      currentFileConfirmedBytes: 950,
      currentFileTotalBytes: 1000,
      currentTaskSource: 'manual' as const,
      lastCompletedTaskSource: null,
      autoUploadState: 'disabled' as const,
      manualPending: 0,
      autoPending: 0,
    };

    const next = buildOverview(
      {
        uploadState: 'completed',
        completedCount: 12,
        totalCount: 12,
        completedBytes: 8192,
        currentTaskSource: null,
      },
      prev,
    );

    expect(next.uploadState).toBe('completed');
    expect(next.currentTaskSource).toBeUndefined();
    expect(next.lastCompletedTaskSource).toBe('manual');
  });

  it('uses native last completed source when an auto round completes after stale manual state', () => {
    const prev = {
      progressPercent: 100,
      currentSpeedMbps: 0,
      uploadState: 'uploading',
      completedCount: 5,
      totalCount: 5,
      completedBytes: 1629535908,
      totalBytes: 1629535908,
      currentFile: 'auto-file-key',
      currentFilename: 'IMG_0005.MOV',
      currentFileConfirmedBytes: 621067508,
      currentFileTotalBytes: 621067508,
      currentTaskSource: undefined,
      lastCompletedTaskSource: 'manual' as const,
      autoUploadState: 'active' as const,
      manualPending: 0,
      autoPending: 0,
    };

    const fileCompleted = buildOverview(
      {
        uploadState: 'uploading',
        progressPercent: 100,
        completedCount: 5,
        totalCount: 5,
        completedBytes: 1629535908,
        totalBytes: 1629535908,
        currentTaskSource: null,
        lastCompletedTaskSource: 'auto',
        manualPending: 0,
        autoPending: 0,
        autoUploadState: 'active',
      },
      prev,
    );
    const settled = buildOverview(
      {
        uploadState: 'completed',
        progressPercent: 100,
        completedCount: 5,
        totalCount: 5,
        completedBytes: 1629535908,
        totalBytes: 1629535908,
        currentTaskSource: null,
        lastCompletedTaskSource: 'auto',
        manualPending: 0,
        autoPending: 0,
        autoUploadState: 'active',
      },
      fileCompleted,
    );

    expect(fileCompleted.lastCompletedTaskSource).toBe('auto');
    expect(settled.lastCompletedTaskSource).toBe('auto');
    expect(getSyncActivityMainCardState(settled, false)).toBe('auto_completed');
  });

  it('infers active auto completion ahead of stale manual context when native omits last source', () => {
    const prev = {
      progressPercent: 100,
      currentSpeedMbps: 0,
      uploadState: 'uploading',
      completedCount: 5,
      totalCount: 5,
      completedBytes: 1629535908,
      totalBytes: 1629535908,
      currentFile: 'auto-file-key',
      currentFilename: 'IMG_0005.MOV',
      currentFileConfirmedBytes: 621067508,
      currentFileTotalBytes: 621067508,
      currentTaskSource: undefined,
      lastCompletedTaskSource: 'manual' as const,
      autoUploadState: 'active' as const,
      manualPending: 0,
      autoPending: 0,
    };

    const next = buildOverview(
      {
        uploadState: 'completed',
        progressPercent: 100,
        completedCount: 5,
        totalCount: 5,
        completedBytes: 1629535908,
        totalBytes: 1629535908,
        currentTaskSource: null,
        manualPending: 0,
        autoPending: 0,
        autoUploadState: 'active',
      },
      prev,
    );

    expect(next.lastCompletedTaskSource).toBe('auto');
    expect(getSyncActivityMainCardState(next, false)).toBe('auto_completed');
  });

  it('returns to the default card when auto upload is closed after completion', () => {
    const prev = {
      progressPercent: 100,
      currentSpeedMbps: 0,
      uploadState: 'completed',
      completedCount: 2,
      totalCount: 2,
      completedBytes: 1293262,
      totalBytes: 1293262,
      currentFile: undefined,
      currentFilename: undefined,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
      currentTaskSource: undefined,
      lastCompletedTaskSource: 'auto' as const,
      autoUploadState: 'active' as const,
      manualPending: 0,
      autoPending: 0,
    };

    const next = buildOverview(
      {
        uploadState: 'paused_auto_upload',
        progressPercent: 100,
        completedCount: 2,
        totalCount: 2,
        completedBytes: 1293262,
        totalBytes: 1293262,
        currentTaskSource: null,
        manualPending: 0,
        autoPending: 0,
        autoUploadState: 'interrupted',
      },
      prev,
    );

    expect(next.lastCompletedTaskSource).toBe('auto');
    expect(getSyncActivityMainCardState(next, false)).toBe('not_started');
  });

  it('keeps completed counters when auto upload is disabled after completion', () => {
    const prev = {
      progressPercent: 100,
      currentSpeedMbps: 0,
      uploadState: 'completed',
      completedCount: 2,
      totalCount: 2,
      completedBytes: 1293262,
      totalBytes: 1293262,
      currentFile: undefined,
      currentFilename: undefined,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
      currentTaskSource: undefined,
      lastCompletedTaskSource: 'auto' as const,
      autoUploadState: 'active' as const,
      manualPending: 0,
      autoPending: 0,
    };

    const next = buildOverview(
      {
        uploadState: 'idle',
        progressPercent: 100,
        completedCount: 2,
        totalCount: 2,
        completedBytes: 1293262,
        totalBytes: 1293262,
        currentTaskSource: null,
        lastCompletedTaskSource: null,
        manualPending: 0,
        autoPending: 0,
        autoUploadState: 'disabled',
      },
      prev,
    );

    expect(next.completedCount).toBe(2);
    expect(next.totalCount).toBe(2);
    expect(next.progressPercent).toBe(100);
    expect(next.lastCompletedTaskSource).toBeUndefined();
    expect(getSyncActivityMainCardState(next, false)).toBe('not_started');
  });

  it('clears stale manual completion when enabling auto upload finds no new work', () => {
    const prev = {
      progressPercent: 100,
      currentSpeedMbps: 0,
      uploadState: 'idle',
      completedCount: 1,
      totalCount: 1,
      completedBytes: 8192,
      totalBytes: 8192,
      currentFile: undefined,
      currentFilename: undefined,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
      currentTaskSource: undefined,
      lastCompletedTaskSource: 'manual' as const,
      autoUploadState: 'disabled' as const,
      manualPending: 0,
      autoPending: 0,
    };

    const next = buildOverview(
      {
        uploadState: 'idle',
        progressPercent: 0,
        completedCount: 0,
        totalCount: 0,
        completedBytes: 0,
        totalBytes: 0,
        currentTaskSource: null,
        lastCompletedTaskSource: null,
        manualPending: 0,
        autoPending: 0,
        autoUploadState: 'active',
      },
      prev,
    );

    expect(next.completedCount).toBe(0);
    expect(next.totalCount).toBe(0);
    expect(next.lastCompletedTaskSource).toBeUndefined();
    expect(getSyncActivityMainCardState(next, false)).toBe('standby');
  });

  it('derives the last completed task source when native jumps straight from uploading to idle', () => {
    const prev = {
      progressPercent: 100,
      currentSpeedMbps: 0,
      uploadState: 'uploading',
      completedCount: 0,
      totalCount: 1,
      completedBytes: 0,
      totalBytes: 8192,
      currentFile: 'file-key-3',
      currentFilename: 'clip-3.mov',
      currentFileConfirmedBytes: 8192,
      currentFileTotalBytes: 8192,
      currentTaskSource: 'manual' as const,
      lastCompletedTaskSource: null,
      autoUploadState: 'disabled' as const,
      manualPending: 0,
      autoPending: 0,
    };

    const next = buildOverview(
      {
        uploadState: 'idle',
        completedCount: 1,
        totalCount: 1,
        completedBytes: 8192,
        currentTaskSource: null,
        manualPending: 0,
        autoPending: 0,
      },
      prev,
    );

    expect(next.uploadState).toBe('idle');
    expect(next.currentTaskSource).toBeUndefined();
    expect(next.lastCompletedTaskSource).toBe('manual');
  });

  it('derives the last completed task source when native settles into paused_auto_upload after a manual round', () => {
    const prev = {
      progressPercent: 100,
      currentSpeedMbps: 0,
      uploadState: 'uploading',
      completedCount: 11,
      totalCount: 12,
      completedBytes: 2027645956,
      totalBytes: 2071538583,
      currentFile: 'file-key-4',
      currentFilename: 'clip-4.mov',
      currentFileConfirmedBytes: 43892627,
      currentFileTotalBytes: 43892627,
      currentTaskSource: 'manual' as const,
      lastCompletedTaskSource: null,
      autoUploadState: 'interrupted' as const,
      manualPending: 0,
      autoPending: 0,
    };

    const next = buildOverview(
      {
        uploadState: 'paused_auto_upload',
        completedCount: 12,
        totalCount: 12,
        completedBytes: 2071538583,
        currentTaskSource: null,
        manualPending: 0,
        autoPending: 0,
        autoUploadState: 'interrupted',
      },
      prev,
    );

    expect(next.uploadState).toBe('paused_auto_upload');
    expect(next.currentTaskSource).toBeUndefined();
    expect(next.lastCompletedTaskSource).toBe('manual');
  });

  it('derives the last completed task source when native scans immediately after a manual round finishes', () => {
    const prev = {
      progressPercent: 100,
      currentSpeedMbps: 0,
      uploadState: 'uploading',
      completedCount: 11,
      totalCount: 12,
      completedBytes: 4314711641,
      totalBytes: 4314899286,
      currentFile: 'file-key-5',
      currentFilename: 'IMG_8971.JPG',
      currentFileConfirmedBytes: 187645,
      currentFileTotalBytes: 187645,
      currentTaskSource: 'manual' as const,
      lastCompletedTaskSource: null,
      autoUploadState: 'interrupted' as const,
      manualPending: 0,
      autoPending: 0,
    };

    const next = buildOverview(
      {
        uploadState: 'scanning',
        completedCount: 12,
        totalCount: 12,
        completedBytes: 4314899286,
        currentTaskSource: null,
        manualPending: 0,
        autoPending: 0,
        autoUploadState: 'interrupted',
      },
      prev,
    );

    expect(next.uploadState).toBe('scanning');
    expect(next.currentTaskSource).toBeUndefined();
    expect(next.lastCompletedTaskSource).toBe('manual');
  });

  it('keeps manual completion context through a transient idle disabled payload', () => {
    const prev = {
      progressPercent: 100,
      currentSpeedMbps: 0,
      uploadState: 'uploading',
      completedCount: 0,
      totalCount: 1,
      completedBytes: 0,
      totalBytes: 8192,
      currentFile: 'file-key-6',
      currentFilename: 'clip-6.mov',
      currentFileConfirmedBytes: 8192,
      currentFileTotalBytes: 8192,
      currentTaskSource: 'manual' as const,
      lastCompletedTaskSource: null,
      autoUploadState: 'disabled' as const,
      manualPending: 1,
      autoPending: 0,
    };

    const next = buildOverview(
      {
        uploadState: 'idle',
        completedCount: 0,
        totalCount: 0,
        completedBytes: 0,
        totalBytes: 0,
        currentTaskSource: null,
        manualPending: 0,
        autoPending: 0,
        autoUploadState: 'disabled',
      },
      prev,
    );

    expect(next.completedCount).toBe(1);
    expect(next.totalCount).toBe(1);
    expect(next.completedBytes).toBe(8192);
    expect(next.totalBytes).toBe(8192);
    expect(next.lastCompletedTaskSource).toBe('manual');
    expect(getSyncActivityMainCardState(next, false)).toBe('manual_completed');
  });

  it('does not turn a cancelled manual upload into manual completion', () => {
    const prev = {
      progressPercent: 31,
      currentSpeedMbps: 8.5,
      uploadState: 'uploading',
      completedCount: 7,
      totalCount: 8,
      completedBytes: 632_240_107,
      totalBytes: 1_006_267_682,
      currentFile: 'file-key-cancelled',
      currentFilename: 'clip-cancelled.mov',
      currentFileConfirmedBytes: 117_440_512,
      currentFileTotalBytes: 374_027_575,
      currentTaskSource: 'manual' as const,
      lastCompletedTaskSource: null,
      autoUploadState: 'disabled' as const,
      manualPending: 0,
      autoPending: 0,
    };

    const next = buildOverview(
      {
        uploadState: 'idle',
        completedCount: 0,
        totalCount: 0,
        completedBytes: 0,
        totalBytes: 0,
        currentTaskSource: null,
        manualPending: 0,
        autoPending: 0,
        autoUploadState: 'disabled',
        manualUploadCancelled: true,
      },
      prev,
    );

    expect(next.completedCount).toBe(0);
    expect(next.totalCount).toBe(0);
    expect(next.completedBytes).toBe(0);
    expect(next.totalBytes).toBe(0);
    expect(next.currentTaskSource).toBeUndefined();
    expect(next.lastCompletedTaskSource).toBeUndefined();
    expect(getSyncActivityMainCardState(next, false)).toBe('not_started');
  });

  it('clears stale completed counts from a cancelled manual upload payload', () => {
    const prev = {
      progressPercent: 45,
      currentSpeedMbps: 6.5,
      uploadState: 'uploading',
      completedCount: 6,
      totalCount: 7,
      completedBytes: 3_194_059,
      totalBytes: 4_912_657,
      currentFile: 'file-key-cancelled',
      currentFilename: 'clip-cancelled.mov',
      currentFileConfirmedBytes: 512_000,
      currentFileTotalBytes: 1_024_000,
      currentTaskSource: 'manual' as const,
      lastCompletedTaskSource: null,
      autoUploadState: 'interrupted' as const,
      manualPending: 0,
      autoPending: 0,
    };

    const next = buildOverview(
      {
        uploadState: 'idle',
        progressPercent: 100,
        completedCount: 7,
        totalCount: 7,
        completedBytes: 4_912_657,
        totalBytes: 4_912_657,
        currentTaskSource: null,
        manualPending: 0,
        autoPending: 0,
        autoUploadState: 'interrupted',
        manualUploadCancelled: true,
      },
      prev,
    );

    expect(next.progressPercent).toBe(0);
    expect(next.completedCount).toBe(0);
    expect(next.totalCount).toBe(0);
    expect(next.completedBytes).toBe(0);
    expect(next.totalBytes).toBe(0);
    expect(next.lastCompletedTaskSource).toBeUndefined();
    expect(getSyncActivityMainCardState(next, false)).toBe('not_started');
  });

  it('keeps cancellation across a stale idle overview refresh', () => {
    const cancelled = buildOverview(
      {
        uploadState: 'idle',
        completedCount: 7,
        totalCount: 7,
        completedBytes: 4_912_657,
        totalBytes: 4_912_657,
        currentTaskSource: null,
        manualPending: 0,
        autoPending: 0,
        autoUploadState: 'interrupted',
        manualUploadCancelled: true,
      },
      {
        progressPercent: 45,
        currentSpeedMbps: 6.5,
        uploadState: 'uploading',
        completedCount: 6,
        totalCount: 7,
        completedBytes: 3_194_059,
        totalBytes: 4_912_657,
        currentFile: 'file-key-cancelled',
        currentFilename: 'clip-cancelled.mov',
        currentFileConfirmedBytes: 512_000,
        currentFileTotalBytes: 1_024_000,
        currentTaskSource: 'manual' as const,
        lastCompletedTaskSource: null,
        autoUploadState: 'interrupted' as const,
        manualPending: 0,
        autoPending: 0,
      },
    );

    const refreshed = buildOverview(
      {
        uploadState: 'idle',
        progressPercent: 100,
        completedCount: 7,
        totalCount: 7,
        completedBytes: 4_912_657,
        totalBytes: 4_912_657,
        currentTaskSource: null,
        manualPending: 0,
        autoPending: 0,
        autoUploadState: 'interrupted',
      },
      cancelled,
    );

    expect(refreshed.progressPercent).toBe(0);
    expect(refreshed.completedCount).toBe(0);
    expect(refreshed.totalCount).toBe(0);
    expect(refreshed.manualUploadCancelled).toBe(true);
    expect(getSyncActivityMainCardState(refreshed, false)).toBe('not_started');
  });

  it('does not show the auto interrupted card for a cancelled manual upload snapshot', () => {
    const prev = {
      progressPercent: 31,
      currentSpeedMbps: 8.5,
      uploadState: 'uploading',
      completedCount: 7,
      totalCount: 8,
      completedBytes: 632_240_107,
      totalBytes: 1_006_267_682,
      currentFile: 'file-key-cancelled',
      currentFilename: 'clip-cancelled.mov',
      currentFileConfirmedBytes: 117_440_512,
      currentFileTotalBytes: 374_027_575,
      currentTaskSource: 'manual' as const,
      lastCompletedTaskSource: null,
      autoUploadState: 'interrupted' as const,
      manualPending: 0,
      autoPending: 0,
    };

    const next = buildOverview(
      {
        uploadState: 'paused_auto_upload',
        completedCount: 0,
        totalCount: 0,
        completedBytes: 0,
        totalBytes: 0,
        currentTaskSource: null,
        manualPending: 0,
        autoPending: 0,
        autoUploadState: 'interrupted',
        manualUploadCancelled: true,
      },
      prev,
    );

    expect(next.completedCount).toBe(0);
    expect(next.totalCount).toBe(0);
    expect(next.currentTaskSource).toBeUndefined();
    expect(next.lastCompletedTaskSource).toBeUndefined();
    expect(getSyncActivityMainCardState(next, false)).toBe('not_started');
  });

  it('keeps manual completion after the final upload pulse clears current source', () => {
    const prev = {
      progressPercent: 100,
      currentSpeedMbps: 0,
      uploadState: 'uploading',
      completedCount: 10,
      totalCount: 10,
      completedBytes: 63406077,
      totalBytes: 63406077,
      currentFile: 'file-key-7',
      currentFilename: 'CAP_741A2D58.jpg',
      currentFileConfirmedBytes: 230748,
      currentFileTotalBytes: 230748,
      currentTaskSource: undefined,
      lastCompletedTaskSource: null,
      autoUploadState: 'interrupted' as const,
      manualPending: 0,
      autoPending: 0,
    };

    const next = buildOverview(
      {
        uploadState: 'idle',
        completedCount: 0,
        totalCount: 0,
        completedBytes: 0,
        totalBytes: 0,
        currentTaskSource: null,
        manualPending: 0,
        autoPending: 0,
        autoUploadState: 'interrupted',
      },
      prev,
    );

    expect(next.completedCount).toBe(10);
    expect(next.totalCount).toBe(10);
    expect(next.completedBytes).toBe(63406077);
    expect(next.totalBytes).toBe(63406077);
    expect(next.lastCompletedTaskSource).toBe('manual');
    expect(getSyncActivityMainCardState(next, false)).toBe('manual_completed');
  });

  it('does not convert a manual auto-upload interruption into auto completion', () => {
    const prev = {
      progressPercent: 42,
      currentSpeedMbps: 12.4,
      uploadState: 'uploading',
      completedCount: 5,
      totalCount: 6046,
      completedBytes: 631_659_485,
      totalBytes: 8_253_316_833,
      currentFile: 'auto-file-key',
      currentFilename: 'IMG_0480.MOV',
      currentFileConfirmedBytes: 80_000_000,
      currentFileTotalBytes: 571_265_496,
      currentTaskSource: 'auto' as const,
      lastCompletedTaskSource: 'manual' as const,
      autoUploadState: 'active' as const,
      manualPending: 0,
      autoPending: 198,
    };

    const next = buildOverview(
      {
        uploadState: 'paused_auto_upload',
        completedCount: 0,
        totalCount: 0,
        completedBytes: 0,
        totalBytes: 0,
        currentTaskSource: 'auto',
        manualPending: 0,
        autoPending: 0,
        autoUploadState: 'interrupted',
      },
      prev,
    );

    expect(next.completedCount).toBe(0);
    expect(next.totalCount).toBe(0);
    expect(next.currentTaskSource).toBe('auto');
    expect(getSyncActivityMainCardState(next, false)).toBe('auto_interrupted');
  });

  it('keeps the interrupted card after the interrupted auto pipeline clears source', () => {
    const prev = {
      progressPercent: 0,
      currentSpeedMbps: 12.4,
      uploadState: 'paused_auto_upload',
      completedCount: 0,
      totalCount: 0,
      completedBytes: 0,
      totalBytes: 0,
      currentFile: undefined,
      currentFilename: undefined,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
      currentTaskSource: 'auto' as const,
      lastCompletedTaskSource: 'manual' as const,
      autoUploadState: 'interrupted' as const,
      manualPending: 0,
      autoPending: 0,
    };

    const next = buildOverview(
      {
        uploadState: 'paused_auto_upload',
        completedCount: 0,
        totalCount: 0,
        completedBytes: 0,
        totalBytes: 0,
        currentTaskSource: null,
        manualPending: 0,
        autoPending: 0,
        autoUploadState: 'interrupted',
      },
      prev,
    );

    expect(next.completedCount).toBe(0);
    expect(next.totalCount).toBe(0);
    expect(next.currentTaskSource).toBeUndefined();
    expect(getSyncActivityMainCardState(next, false)).toBe('auto_interrupted');
  });

  it('clears a previous reconnect error when native sends a null error code', () => {
    const prev = {
      progressPercent: 0,
      currentSpeedMbps: 0,
      uploadState: 'offline',
      completedCount: 4,
      totalCount: 6046,
      completedBytes: 1024,
      totalBytes: 8253316833,
      currentFile: undefined,
      currentFilename: undefined,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
      currentTaskSource: undefined,
      lastCompletedTaskSource: undefined,
      autoUploadState: 'active' as const,
      manualPending: 0,
      autoPending: 6042,
      lastErrorCode: 'RECONNECT_EXHAUSTED',
    };

    const next = buildOverview(
      {
        uploadState: 'idle',
        progressPercent: 0,
        completedCount: 0,
        totalCount: 0,
        completedBytes: 0,
        totalBytes: 0,
        currentFile: null,
        currentFilename: null,
        currentFileConfirmedBytes: 0,
        currentFileTotalBytes: 0,
        currentTaskSource: null,
        lastErrorCode: null,
        manualPending: 0,
        autoPending: 0,
        autoUploadState: 'active',
      },
      prev,
    );

    expect(next.lastErrorCode).toBeUndefined();
    expect(getSyncActivityMainCardState(next, false)).toBe('standby');
  });
});

describe('shouldBypassOfflineDisplayDelay', () => {
  it('bypasses startup and foreground grace for terminal reconnect failures', () => {
    expect(shouldBypassOfflineDisplayDelay({ uploadState: 'offline' })).toBe(
      true,
    );
    expect(
      shouldBypassOfflineDisplayDelay({ lastErrorCode: 'RECONNECT_EXHAUSTED' }),
    ).toBe(true);
  });

  it('keeps normal grace for non-terminal states', () => {
    expect(shouldBypassOfflineDisplayDelay({ uploadState: 'idle' })).toBe(
      false,
    );
    expect(
      shouldBypassOfflineDisplayDelay({ uploadState: 'reconnecting' }),
    ).toBe(false);
  });
});

describe('shouldRenderSyncActivityProgress', () => {
  it('does not render upload progress while a manual batch is only preparing to connect', () => {
    expect(shouldRenderSyncActivityProgress('preparing', false, false)).toBe(
      false,
    );
  });

  it('renders upload progress for active upload and inter-item gaps', () => {
    expect(shouldRenderSyncActivityProgress('uploading', false, false)).toBe(
      true,
    );
    expect(shouldRenderSyncActivityProgress('scanning', false, true)).toBe(
      true,
    );
  });
});

describe('shouldTreatSyncActivityAsBetweenItems', () => {
  it('keeps regular preparation gaps frozen between files', () => {
    expect(shouldTreatSyncActivityAsBetweenItems('scanning', 6, 3)).toBe(true);
    expect(shouldTreatSyncActivityAsBetweenItems('preparing', 6, 3)).toBe(true);
    expect(shouldTreatSyncActivityAsBetweenItems('completed', 6, 3)).toBe(true);
  });

  it('lets reconnect phases render the reconnect card mid-batch', () => {
    expect(shouldTreatSyncActivityAsBetweenItems('reconnecting', 6, 3)).toBe(
      false,
    );
    expect(shouldTreatSyncActivityAsBetweenItems('backoff_waiting', 6, 3)).toBe(
      false,
    );
  });
});

describe('isPreparationPhase', () => {
  // Regression: native emits uploadState='reconnecting' on every retryable
  // upload failure (SyncEngineManager.swift). Without this membership the
  // running card's preparation guard evaluates false and the fallback
  // else-branch renders the auto-running title over a manual batch — the
  // Frankenstein UI bug reproduced by flipping desktop Wi-Fi mid-upload.
  it.each([
    'discovering',
    'reconciling',
    'scanning',
    'preparing',
    'backoff_waiting',
    'reconnecting',
  ])('treats %s as a preparation phase', state => {
    expect(isPreparationPhase(state)).toBe(true);
  });

  it.each(['uploading', 'completed', 'idle', 'paused_auto_upload'])(
    'does not treat %s as a preparation phase',
    state => {
      expect(isPreparationPhase(state)).toBe(false);
    },
  );
});

describe('getSyncActivityDisplayProgressPercent', () => {
  it('uses the current file progress instead of round-level progress', () => {
    expect(
      getSyncActivityDisplayProgressPercent(
        {
          progressPercent: 18,
          currentSpeedMbps: 8.2,
          uploadState: 'uploading',
          completedCount: 3,
          totalCount: 5,
          completedBytes: 3_000,
          totalBytes: 5_000,
          currentFile: 'file-key-4',
          currentFilename: 'clip-4.mov',
          currentFileConfirmedBytes: 180,
          currentFileTotalBytes: 1_000,
          currentTaskSource: 'manual',
          lastCompletedTaskSource: null,
          autoUploadState: 'disabled',
          manualPending: 2,
          autoPending: 0,
        },
        false,
      ),
    ).toBe(18);
  });

  it('uses 100 percent while the caller explicitly delays completion display', () => {
    expect(
      getSyncActivityDisplayProgressPercent(
        {
          progressPercent: 18,
          currentSpeedMbps: 8.2,
          uploadState: 'uploading',
          completedCount: 3,
          totalCount: 5,
          completedBytes: 3_000,
          totalBytes: 5_000,
          currentFile: 'file-key-4',
          currentFilename: 'clip-4.mov',
          currentFileConfirmedBytes: 180,
          currentFileTotalBytes: 1_000,
          currentTaskSource: 'auto',
          lastCompletedTaskSource: null,
          autoUploadState: 'active',
          manualPending: 0,
          autoPending: 2,
        },
        true,
      ),
    ).toBe(100);
  });
});

describe('getSyncActivityAutoRoundDisplayMetrics', () => {
  it('uses the current auto round as the progress denominator instead of cumulative completed history', () => {
    expect(
      getSyncActivityAutoRoundDisplayMetrics({
        overview: {
          uploadState: 'scanning',
          completedCount: 4,
          totalCount: 6046,
          completedBytes: 1024,
          currentTaskSource: undefined,
          lastCompletedTaskSource: 'manual',
          autoUploadState: 'active',
          autoPending: 6042,
        },
        isManualUploading: false,
        rawMainCardState: 'running',
        baseline: null,
      }),
    ).toEqual({
      shouldTrack: true,
      baseline: {
        completedCount: 4,
        completedBytes: 1024,
      },
      completedCount: 0,
      totalCount: 6042,
      completedBytes: 0,
    });
  });

  it('keeps counting against the same baseline while the auto round advances', () => {
    expect(
      getSyncActivityAutoRoundDisplayMetrics({
        overview: {
          uploadState: 'uploading',
          completedCount: 7,
          totalCount: 6046,
          completedBytes: 4096,
          currentTaskSource: 'auto',
          lastCompletedTaskSource: 'manual',
          autoUploadState: 'active',
          autoPending: 6039,
        },
        isManualUploading: false,
        rawMainCardState: 'running',
        baseline: {
          completedCount: 4,
          completedBytes: 1024,
        },
      }),
    ).toEqual({
      shouldTrack: true,
      baseline: {
        completedCount: 4,
        completedBytes: 1024,
      },
      completedCount: 3,
      totalCount: 6042,
      completedBytes: 3072,
    });
  });

  it('falls back to the raw overview values when entering mid-round without a baseline', () => {
    expect(
      getSyncActivityAutoRoundDisplayMetrics({
        overview: {
          uploadState: 'uploading',
          completedCount: 7,
          totalCount: 6046,
          completedBytes: 4096,
          currentTaskSource: 'auto',
          lastCompletedTaskSource: 'manual',
          autoUploadState: 'active',
          autoPending: 6039,
        },
        isManualUploading: false,
        rawMainCardState: 'running',
        baseline: null,
      }),
    ).toEqual({
      shouldTrack: true,
      baseline: null,
      completedCount: 7,
      totalCount: 6046,
      completedBytes: 4096,
    });
  });

  it('prefers the native-provided round baseline when entering mid-round', () => {
    expect(
      getSyncActivityAutoRoundDisplayMetrics({
        overview: {
          uploadState: 'uploading',
          completedCount: 7,
          totalCount: 6046,
          completedBytes: 4096,
          currentTaskSource: 'auto',
          lastCompletedTaskSource: 'manual',
          autoUploadState: 'active',
          autoPending: 6039,
          roundBaselineCompletedCount: 4,
          roundBaselineCompletedBytes: 1024,
        },
        isManualUploading: false,
        rawMainCardState: 'running',
        baseline: null,
      }),
    ).toEqual({
      shouldTrack: true,
      baseline: {
        completedCount: 4,
        completedBytes: 1024,
      },
      completedCount: 3,
      totalCount: 6042,
      completedBytes: 3072,
    });
  });

  it('keeps the same auto-round baseline through completed and standby cards', () => {
    const baseline = {
      completedCount: 4,
      completedBytes: 1024,
    };

    expect(
      getSyncActivityAutoRoundDisplayMetrics({
        overview: {
          uploadState: 'completed',
          completedCount: 10,
          totalCount: 10,
          completedBytes: 8192,
          currentTaskSource: undefined,
          lastCompletedTaskSource: 'auto',
          autoUploadState: 'active',
          autoPending: 0,
        },
        isManualUploading: false,
        rawMainCardState: 'auto_completed',
        baseline,
      }),
    ).toEqual({
      shouldTrack: true,
      baseline,
      completedCount: 6,
      totalCount: 6,
      completedBytes: 7168,
    });

    expect(
      getSyncActivityAutoRoundDisplayMetrics({
        overview: {
          uploadState: 'idle',
          completedCount: 10,
          totalCount: 10,
          completedBytes: 8192,
          currentTaskSource: undefined,
          lastCompletedTaskSource: 'auto',
          autoUploadState: 'active',
          autoPending: 0,
        },
        isManualUploading: false,
        rawMainCardState: 'standby',
        baseline,
      }),
    ).toEqual({
      shouldTrack: true,
      baseline,
      completedCount: 6,
      totalCount: 6,
      completedBytes: 7168,
    });
  });

  it('does not apply auto-round baseline logic to manual uploads', () => {
    expect(
      getSyncActivityAutoRoundDisplayMetrics({
        overview: {
          uploadState: 'uploading',
          completedCount: 3,
          totalCount: 5,
          completedBytes: 2048,
          currentTaskSource: 'manual',
          lastCompletedTaskSource: null,
          autoUploadState: 'active',
          autoPending: 2,
        },
        isManualUploading: true,
        rawMainCardState: 'running',
        baseline: {
          completedCount: 1,
          completedBytes: 512,
        },
      }),
    ).toEqual({
      shouldTrack: false,
      baseline: null,
      completedCount: 3,
      totalCount: 5,
      completedBytes: 2048,
    });
  });
});

describe('shouldShowSubscriptionExpiredOverlay', () => {
  it('shows only when subscription enforcement is active on the focused screen', () => {
    expect(
      shouldShowSubscriptionExpiredOverlay({
        subscriptionEnforcement: true,
        isFocused: true,
        isLoggedIn: true,
        featureAccessAllowed: false,
      }),
    ).toBe(true);
  });

  it('hides after navigating away from SyncActivity', () => {
    expect(
      shouldShowSubscriptionExpiredOverlay({
        subscriptionEnforcement: true,
        isFocused: false,
        isLoggedIn: true,
        featureAccessAllowed: false,
      }),
    ).toBe(false);
  });
});

describe('shouldKickAutoUploadSyncAfterGateRelease', () => {
  it('starts the native loop when auto upload is active but idle', () => {
    expect(
      shouldKickAutoUploadSyncAfterGateRelease({
        autoUploadState: 'active',
        uploadState: 'idle',
      }),
    ).toBe(true);
  });

  it('does not start when auto upload is disabled', () => {
    expect(
      shouldKickAutoUploadSyncAfterGateRelease({
        autoUploadState: 'disabled',
        uploadState: 'idle',
      }),
    ).toBe(false);
  });

  it('does not duplicate an active native scan or transfer', () => {
    expect(
      shouldKickAutoUploadSyncAfterGateRelease({
        autoUploadState: 'active',
        uploadState: 'scanning',
      }),
    ).toBe(false);
    expect(
      shouldKickAutoUploadSyncAfterGateRelease({
        autoUploadState: 'active',
        uploadState: 'uploading',
        currentTaskSource: 'auto',
      }),
    ).toBe(false);
  });

  it('leaves reconnect-exhausted recovery to the reconnect flow', () => {
    expect(
      shouldKickAutoUploadSyncAfterGateRelease({
        autoUploadState: 'active',
        uploadState: 'offline',
        lastErrorCode: 'RECONNECT_EXHAUSTED',
      }),
    ).toBe(false);
  });
});

describe('getTrialUpgradeEntryDays', () => {
  it('returns remaining days for account trial users', () => {
    const trialEnd = new Date(
      Date.now() + 3 * 24 * 60 * 60 * 1000,
    ).toISOString();

    expect(
      getTrialUpgradeEntryDays({
        user: {
          id: 1,
          primaryIdentity: null,
          identities: [],
          status: 'trialing',
          plan: '',
          expireAt: null,
          trialEnd,
        },
      }),
    ).toBeGreaterThanOrEqual(2);
  });

  it('prefers subscription snapshot and hides the entry for subscribed users', () => {
    expect(
      getTrialUpgradeEntryDays({
        subscription: {
          status: 'subscribed',
          plan: 'yearly',
          expireAt: '2027-04-23T00:00:00.000Z',
          trialEnd: null,
        },
        user: {
          id: 1,
          primaryIdentity: null,
          identities: [],
          status: 'trialing',
          plan: '',
          expireAt: null,
          trialEnd: '2026-04-26T00:00:00.000Z',
        },
      }),
    ).toBe(0);
  });

  it('hides the entry when the trial has expired', () => {
    expect(
      getTrialUpgradeEntryDays({
        user: {
          id: 1,
          primaryIdentity: null,
          identities: [],
          status: 'trial_expired',
          plan: '',
          expireAt: null,
          trialEnd: '2026-04-17T00:00:00.000Z',
        },
      }),
    ).toBe(0);
  });
});

describe('resolveSyncErrorAlertMessage', () => {
  const t = ((key: string) => {
    const values: Record<string, string> = {
      'errors.unknown': '未知錯誤',
      'syncActivity.dialogs.syncError.lowDiskPaused':
        '接收磁碟剩餘空間小於 500MB，已暫停新的接收任務',
      'syncActivity.dialogs.syncError.storageUnavailable':
        '電腦端接收目錄不可用，請在電腦端重新選擇或恢復資料夾',
    };
    return values[key] ?? key;
  }) as TFunction;

  it('uses localized copy for low disk pause instead of native raw message', () => {
    expect(
      resolveSyncErrorAlertMessage(
        {
          code: 'LOW_DISK_PAUSED',
          message: 'remaining disk bytes 523636736 below threshold',
        },
        t,
      ),
    ).toBe('接收磁碟剩餘空間小於 500MB，已暫停新的接收任務');
  });

  it('keeps the native message for other errors', () => {
    expect(
      resolveSyncErrorAlertMessage(
        { code: 'SYNC_PIPELINE_ERROR', message: 'network failed' },
        t,
      ),
    ).toBe('network failed');
  });

  it('uses localized copy for unavailable desktop storage', () => {
    expect(
      resolveSyncErrorAlertMessage(
        {
          code: 'STORAGE_UNAVAILABLE',
          message: 'desktop receive directory is unavailable',
        },
        t,
      ),
    ).toBe('電腦端接收目錄不可用，請在電腦端重新選擇或恢復資料夾');
  });
});
