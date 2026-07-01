describe('SyncEngineModule background service bridge', () => {
  const loadModule = (
    platform: 'android' | 'ios',
    options: { includeEntitlementBridge?: boolean } = {
      includeEntitlementBridge: true,
    },
  ) => {
    jest.resetModules();
    const nativeSyncEngine = {
      startBackgroundSyncService: jest.fn().mockResolvedValue(undefined),
      stopBackgroundSyncService: jest.fn().mockResolvedValue(undefined),
      setBackgroundSilentAudioEnabled: jest.fn().mockResolvedValue(undefined),
      ...(options.includeEntitlementBridge === false
        ? {}
        : {
            setDriveEntitlements: jest.fn().mockResolvedValue(undefined),
          }),
    };

    jest.doMock('react-native', () => ({
      NativeModules: {
        NativeSyncEngine: nativeSyncEngine,
      },
      Platform: {
        OS: platform,
      },
    }));

    const syncEngine =
      require('../SyncEngineModule') as typeof import('../SyncEngineModule');

    return {
      nativeSyncEngine,
      syncEngine,
    };
  };

  afterEach(() => {
    jest.dontMock('react-native');
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('starts the Android foreground sync service without touching iOS silent audio', async () => {
    const { nativeSyncEngine, syncEngine } = loadModule('android');

    await syncEngine.startBackgroundSyncService('manual_upload');
    await syncEngine.stopBackgroundSyncService();

    expect(nativeSyncEngine.startBackgroundSyncService).toHaveBeenCalledWith(
      'manual_upload',
    );
    expect(nativeSyncEngine.stopBackgroundSyncService).toHaveBeenCalledTimes(1);
    expect(
      nativeSyncEngine.setBackgroundSilentAudioEnabled,
    ).not.toHaveBeenCalled();
  });

  it('keeps the iOS silent audio bridge separate from Android foreground sync', async () => {
    const { nativeSyncEngine, syncEngine } = loadModule('ios');

    await syncEngine.startBackgroundSyncService('manual_upload');
    await syncEngine.stopBackgroundSyncService();
    await syncEngine.setBackgroundSilentAudioEnabled(true);

    expect(nativeSyncEngine.startBackgroundSyncService).not.toHaveBeenCalled();
    expect(nativeSyncEngine.stopBackgroundSyncService).not.toHaveBeenCalled();
    expect(
      nativeSyncEngine.setBackgroundSilentAudioEnabled,
    ).toHaveBeenCalledWith(true);
  });

  it('does not export commercial entitlement or tunnel bridge wrappers in OSS', () => {
    const { syncEngine } = loadModule('android');

    expect(syncEngine).not.toHaveProperty('setDriveEntitlements');
    expect(syncEngine).not.toHaveProperty('setTunnelCredentials');
  });
});
