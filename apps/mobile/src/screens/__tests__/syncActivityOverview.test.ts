import {
  buildOverview,
  getSyncActivityDisplayProgressPercent,
  shouldDelayAutoCompletionCard,
  shouldRenderSyncActivityProgress,
} from '../SyncActivityScreen';
import {
  getSyncActivityMainCardState,
} from '../../utils/syncActivityTransferState';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: jest.fn(),
    dispatch: jest.fn(),
  }),
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
    expect(getSyncActivityMainCardState(next, false)).toBe(
      'manual_completed',
    );
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
    expect(getSyncActivityMainCardState(next, false)).toBe(
      'manual_completed',
    );
  });
});

describe('shouldDelayAutoCompletionCard', () => {
  it('holds the first auto completion frame immediately to avoid a one-frame flash', () => {
    expect(
      shouldDelayAutoCompletionCard(
        'auto_completed',
        'completed',
        'active',
        null,
        Date.now(),
      ),
    ).toBe(true);
  });

  it('keeps holding follow-up standby or running states only while the hold window is active', () => {
    const now = Date.now();
    expect(
      shouldDelayAutoCompletionCard(
        'standby',
        'idle',
        'active',
        now + 200,
        now,
      ),
    ).toBe(true);

    expect(
      shouldDelayAutoCompletionCard(
        'running',
        'scanning',
        'active',
        now + 200,
        now,
      ),
    ).toBe(true);
  });

  it('stops holding once the visual hold window expires', () => {
    const now = Date.now();
    expect(
      shouldDelayAutoCompletionCard(
        'standby',
        'idle',
        'active',
        now - 1,
        now,
      ),
    ).toBe(false);
  });

  it('never holds when auto upload is inactive or a fresh upload already started', () => {
    const future = Date.now() + 200;
    expect(
      shouldDelayAutoCompletionCard(
        'auto_completed',
        'completed',
        'disabled',
        future,
        Date.now(),
      ),
    ).toBe(false);
    expect(
      shouldDelayAutoCompletionCard(
        'running',
        'uploading',
        'active',
        future,
        Date.now(),
      ),
    ).toBe(false);
    expect(
      shouldDelayAutoCompletionCard(
        'manual_completed',
        'idle',
        'active',
        future,
        Date.now(),
      ),
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

  it('holds completion at 100 percent only during the completion visual delay', () => {
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
