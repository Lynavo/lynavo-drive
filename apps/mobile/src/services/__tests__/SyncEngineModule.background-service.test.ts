describe('SyncEngineModule commercial background bridge', () => {
  const driveCapabilitySetter = ['setDrive', 'Entitlements'].join('');
  const loadModule = (
    platform: 'android' | 'ios',
    options: { includeCapabilityBridge?: boolean } = {
      includeCapabilityBridge: true,
    },
  ) => {
    jest.resetModules();
    const nativeSyncEngine = {
      startBackgroundSyncService: jest.fn().mockResolvedValue(undefined),
      stopBackgroundSyncService: jest.fn().mockResolvedValue(undefined),
      setBackgroundSilentAudioEnabled: jest.fn().mockResolvedValue(undefined),
      ...(options.includeCapabilityBridge === false
        ? {}
        : {
            [driveCapabilitySetter]: jest.fn().mockResolvedValue(undefined),
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

  it('does not export Android paid background service wrappers in OSS', () => {
    const { nativeSyncEngine, syncEngine } = loadModule('android');

    expect(syncEngine).not.toHaveProperty('startBackgroundSyncService');
    expect(syncEngine).not.toHaveProperty('stopBackgroundSyncService');
    expect(nativeSyncEngine.startBackgroundSyncService).not.toHaveBeenCalled();
    expect(nativeSyncEngine.stopBackgroundSyncService).not.toHaveBeenCalled();
    expect(
      nativeSyncEngine.setBackgroundSilentAudioEnabled,
    ).not.toHaveBeenCalled();
  });

  it('does not export iOS silent audio bridge wrappers in OSS', () => {
    const { nativeSyncEngine, syncEngine } = loadModule('ios');

    expect(syncEngine).not.toHaveProperty('startBackgroundSyncService');
    expect(syncEngine).not.toHaveProperty('stopBackgroundSyncService');
    expect(syncEngine).not.toHaveProperty('setBackgroundSilentAudioEnabled');
    expect(nativeSyncEngine.startBackgroundSyncService).not.toHaveBeenCalled();
    expect(nativeSyncEngine.stopBackgroundSyncService).not.toHaveBeenCalled();
    expect(
      nativeSyncEngine.setBackgroundSilentAudioEnabled,
    ).not.toHaveBeenCalled();
  });

  it('does not export commercial capability or tunnel bridge wrappers in OSS', () => {
    const { syncEngine } = loadModule('android');

    expect(syncEngine).not.toHaveProperty(driveCapabilitySetter);
    expect(syncEngine).not.toHaveProperty('setTunnelCredentials');
  });
});
