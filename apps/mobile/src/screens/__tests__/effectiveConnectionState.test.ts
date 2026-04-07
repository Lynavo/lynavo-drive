import {
  getEffectiveConnectionState,
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

  it('treats preparing and reconnecting as connected evidence', () => {
    expect(
      getEffectiveConnectionState('connecting', {
        progressPercent: 0,
        uploadState: 'preparing',
      }),
    ).toBe('connected');

    expect(
      syncActivityImpliesConnected({
        progressPercent: 0,
        transferredBytes: 0,
        uploadState: 'reconnecting',
      }),
    ).toBe(true);
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
});
