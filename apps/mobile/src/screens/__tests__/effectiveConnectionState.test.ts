import {
  buildSyncConnectionEvidence,
  getEffectiveConnectionState,
  getConnectionBadgeState,
  syncActivityImpliesConnected,
} from '../../utils/effectiveConnectionState';

describe('effectiveConnectionState', () => {
  it('treats active uploading as connected even if binding state is still connecting', () => {
    expect(
      getEffectiveConnectionState('connecting', {
        progressPercent: 12,
        uploadState: 'uploading',
      }),
    ).toBe('connected');
  });

  it('treats preparing as connected evidence', () => {
    expect(
      getEffectiveConnectionState('connecting', {
        progressPercent: 0,
        uploadState: 'preparing',
      }),
    ).toBe('connected');
  });

  it('keeps reconnecting and backoff badge state distinct from online', () => {
    expect(
      syncActivityImpliesConnected({
        progressPercent: 0,
        transferredBytes: 0,
        uploadState: 'reconnecting',
      }),
    ).toBe(false);

    expect(
      getConnectionBadgeState('connecting', {
        progressPercent: 45,
        currentFileKey: 'file-key',
        transferredBytes: 1024,
        uploadState: 'reconnecting',
      }),
    ).toBe('connecting');

    expect(
      getConnectionBadgeState('connected', {
        progressPercent: 45,
        currentFileKey: 'file-key',
        transferredBytes: 1024,
        uploadState: 'backoff_waiting',
      }),
    ).toBe('connecting');
  });

  it('treats an active current file as connected evidence even before progress moves', () => {
    expect(
      getEffectiveConnectionState('connecting', {
        progressPercent: 0,
        currentFileKey: 'abc123',
        uploadState: 'preparing',
      }),
    ).toBe('connected');
  });

  it('treats visible queue uploading state as connected evidence', () => {
    expect(
      getEffectiveConnectionState('bound', {
        progressPercent: 0,
        queueHasUploadingItem: true,
        uploadState: 'idle',
      }),
    ).toBe('connected');
  });

  it('keeps connected binding state connected without waiting for transfer evidence', () => {
    expect(
      getEffectiveConnectionState('connected', {
        progressPercent: 0,
        uploadState: 'preparing',
      }),
    ).toBe('connected');
  });

  it('respects native offline even if stale sync evidence exists', () => {
    expect(
      getConnectionBadgeState(
        'offline',
        buildSyncConnectionEvidence({
          currentFile: 'abc123',
          uploadState: 'idle',
        }),
      ),
    ).toBe('offline');
  });

  it('keeps connecting badge state distinct from online when no sync evidence exists', () => {
    expect(
      getConnectionBadgeState(
        'connecting',
        buildSyncConnectionEvidence({
          uploadState: 'idle',
        }),
      ),
    ).toBe('connecting');
  });
});
