describe('SyncEngineModule shared bridge wrappers', () => {
  const loadModule = (
    nativeSyncEngine: Record<string, unknown>,
    options: { accessToken?: string | null } = {},
  ) => {
    jest.resetModules();
    jest.doMock('react-native', () => ({
      NativeModules: {
        NativeSyncEngine: nativeSyncEngine,
      },
      Platform: {
        OS: 'ios',
      },
      PermissionsAndroid: {
        RESULTS: {
          GRANTED: 'granted',
        },
        check: jest.fn(),
        request: jest.fn(),
      },
    }));
    jest.doMock('@react-native-async-storage/async-storage', () => ({
      __esModule: true,
      default: {
        getItem: jest.fn().mockResolvedValue(null),
        setItem: jest.fn().mockResolvedValue(undefined),
        removeItem: jest.fn().mockResolvedValue(undefined),
      },
    }));
    jest.doMock('../../stores/auth-store', () => ({
      getAccessToken: jest.fn(() => options.accessToken ?? null),
    }));

    return require('../SyncEngineModule') as typeof import('../SyncEngineModule');
  };

  afterEach(() => {
    jest.dontMock('react-native');
    jest.dontMock('@react-native-async-storage/async-storage');
    jest.dontMock('../../stores/auth-store');
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('forwards required state, queue, and history bridge calls', async () => {
    const bindingState = {
      deviceId: 'desktop-1',
      deviceName: 'Studio Mac',
      deviceAlias: 'Studio Mac',
      host: '192.168.1.20',
      port: 39393,
      connectionState: 'connected',
      pairingId: 'pairing-1',
      shareEnabled: true,
      lastBoundAt: '2026-06-16T08:00:00.000Z',
    };
    const syncOverview = {
      currentDeviceId: 'desktop-1',
      currentDeviceName: 'Studio Mac',
      currentSpeedMbps: 12,
      transferredBytes: 256,
      totalBytes: 1024,
      progressPercent: 25,
      uploadState: 'uploading',
    };
    const queue = [
      {
        fileKey: 'file-1',
        filename: 'clip.mov',
        fileSize: 1024,
        mediaType: 'video',
        status: 'uploading',
        progress: 25,
      },
    ];
    const historyPage = {
      items: [
        {
          dateKey: '2026-06-16',
          deviceId: 'desktop-1',
          deviceName: 'Studio Mac',
          deviceIp: '192.168.1.20',
          totalFileCount: 2,
          totalBytes: 4096,
          activeTransmissionSeconds: 12,
        },
      ],
      nextCursor: 'next',
    };
    const nativeSyncEngine = {
      getBindingState: jest.fn().mockResolvedValue(bindingState),
      getSyncOverview: jest.fn().mockResolvedValue(syncOverview),
      getReadOnlyQueue: jest.fn().mockResolvedValue(queue),
      getHistoryDays: jest.fn().mockResolvedValue(historyPage),
    };
    const syncEngine = loadModule(nativeSyncEngine);

    await expect(syncEngine.getBindingState()).resolves.toEqual(bindingState);
    await expect(syncEngine.getSyncOverview()).resolves.toEqual(syncOverview);
    await expect(syncEngine.getReadOnlyQueue()).resolves.toEqual(queue);
    await expect(syncEngine.getHistoryDays('cursor-1')).resolves.toEqual(
      historyPage,
    );

    expect(nativeSyncEngine.getBindingState).toHaveBeenCalledTimes(1);
    expect(nativeSyncEngine.getSyncOverview).toHaveBeenCalledTimes(1);
    expect(nativeSyncEngine.getReadOnlyQueue).toHaveBeenCalledTimes(1);
    expect(nativeSyncEngine.getHistoryDays).toHaveBeenCalledWith('cursor-1');
  });

  it('normalizes iOS legacy history ledger fields to the shared contract shape', async () => {
    const nativeSyncEngine = {
      getHistoryDays: jest.fn().mockResolvedValue({
        items: [
          {
            ledgerDate: '2026-06-15',
            deviceId: 'desktop-legacy',
            deviceName: 'Studio Mac',
            deviceIp: '192.168.1.30',
            fileCount: 3,
            totalBytes: 8192,
            transmissionMs: 12345,
            updatedAt: '2026-06-15T12:34:56.000Z',
          },
        ],
        nextCursor: null,
      }),
    };
    const syncEngine = loadModule(nativeSyncEngine);

    await expect(syncEngine.getHistoryDays()).resolves.toEqual({
      items: [
        {
          dateKey: '2026-06-15',
          deviceId: 'desktop-legacy',
          deviceName: 'Studio Mac',
          deviceIp: '192.168.1.30',
          totalFileCount: 3,
          totalBytes: 8192,
          activeTransmissionSeconds: 12.345,
        },
      ],
      nextCursor: null,
    });
    expect(nativeSyncEngine.getHistoryDays).toHaveBeenCalledWith(null);
  });

  it('returns null when the binding-state bridge method is unavailable', async () => {
    const syncEngine = loadModule({});

    await expect(syncEngine.getBindingState()).resolves.toBeNull();
  });

  it('guards optional display-name and app-info bridge methods', async () => {
    const syncEngine = loadModule({});

    await expect(syncEngine.getClientDisplayName()).resolves.toBeNull();
    await expect(
      syncEngine.setClientDisplayName('Field iPhone'),
    ).resolves.toBeUndefined();
    await expect(syncEngine.getAppInfo()).resolves.toBeNull();
  });

  it('forwards optional display-name and app-info bridge methods when available', async () => {
    const appInfo = {
      appName: 'Lynavo Drive',
      version: '1.0.0',
      build: '37',
    };
    const nativeSyncEngine = {
      getClientDisplayName: jest.fn().mockResolvedValue('Field iPhone'),
      setClientDisplayName: jest.fn().mockResolvedValue(undefined),
      getAppInfo: jest.fn().mockResolvedValue(appInfo),
    };
    const syncEngine = loadModule(nativeSyncEngine);

    await expect(syncEngine.getClientDisplayName()).resolves.toBe(
      'Field iPhone',
    );
    await expect(
      syncEngine.setClientDisplayName('Studio iPhone'),
    ).resolves.toBeUndefined();
    await expect(syncEngine.getAppInfo()).resolves.toEqual(appInfo);

    expect(nativeSyncEngine.getClientDisplayName).toHaveBeenCalledTimes(1);
    expect(nativeSyncEngine.setClientDisplayName).toHaveBeenCalledWith(
      'Studio iPhone',
    );
    expect(nativeSyncEngine.getAppInfo).toHaveBeenCalledTimes(1);
  });

  it('forwards received file downloads to the native bridge', async () => {
    const downloadResult = {
      savedToPhotos: false,
      localPath: '/downloads/notes.txt',
      savedLocation: '/downloads/notes.txt',
    };
    const nativeSyncEngine = {
      downloadReceivedFile: jest.fn().mockResolvedValue(downloadResult),
    };
    const syncEngine = loadModule(nativeSyncEngine);

    await expect(
      syncEngine.downloadReceivedFile(
        '2026/06/17/client-001-doc',
        'notes.txt',
        'document',
      ),
    ).resolves.toEqual(downloadResult);

    expect(nativeSyncEngine.downloadReceivedFile).toHaveBeenCalledWith(
      '2026/06/17/client-001-doc',
      'notes.txt',
      'document',
    );
  });

  it('forwards received library listing to the native bridge', async () => {
    const items = [
      {
        resourceId: '',
        desktopDeviceId: 'desktop-001',
        clientId: 'client-001',
        displayName: 'Alice iPhone',
        fileKey: '2026/06/17/client-001-doc',
        filename: 'notes.txt',
        mediaType: 'document',
        fileSize: 1024,
        completedAt: '2026-06-17T08:00:00.000Z',
        shareStatus: 'not_shared',
      },
    ];
    const nativeSyncEngine = {
      listReceivedFiles: jest.fn().mockResolvedValue(items),
    };
    const syncEngine = loadModule(nativeSyncEngine);

    await expect(syncEngine.listReceivedFiles()).resolves.toEqual(items);

    expect(nativeSyncEngine.listReceivedFiles).toHaveBeenCalledTimes(1);
  });

  it('forwards global received library listing to the native bridge', async () => {
    const items = [
      {
        resourceId: '',
        desktopDeviceId: 'desktop-001',
        clientId: 'account-a-client',
        displayName: 'Account A photo',
        fileKey: '2026/06/17/account-a-image',
        filename: 'IMG_ACCOUNT_A.JPG',
        mediaType: 'image',
        fileSize: 4096,
        completedAt: '2026-06-17T08:00:00.000Z',
        shareStatus: 'not_shared',
      },
    ];
    const nativeSyncEngine = {
      listGlobalReceivedFiles: jest.fn().mockResolvedValue(items),
    };
    const syncEngine = loadModule(nativeSyncEngine);

    await expect(syncEngine.listGlobalReceivedFiles()).resolves.toEqual(items);

    expect(nativeSyncEngine.listGlobalReceivedFiles).toHaveBeenCalledTimes(1);
  });

  it('forwards received file preview URL resolution to the native bridge', async () => {
    const nativeSyncEngine = {
      getReceivedFilePreviewUrl: jest
        .fn()
        .mockResolvedValue(
          'http://127.0.0.1:49394/resources/mobile/received/preview?fileKey=client-001-doc',
        ),
    };
    const syncEngine = loadModule(nativeSyncEngine);

    await expect(
      syncEngine.getReceivedFilePreviewUrl(
        '2026/06/17/client-001-doc',
        'preview',
      ),
    ).resolves.toBe(
      'http://127.0.0.1:49394/resources/mobile/received/preview?fileKey=client-001-doc',
    );

    expect(nativeSyncEngine.getReceivedFilePreviewUrl).toHaveBeenCalledWith(
      '2026/06/17/client-001-doc',
      'preview',
    );
  });

  it('forwards preview cache filenames to the native bridge', async () => {
    const nativeSyncEngine = {
      prepareSharedFilePreview: jest.fn().mockResolvedValue('/cache/notes.txt'),
    };
    const syncEngine = loadModule(nativeSyncEngine);

    await expect(
      syncEngine.prepareDirectoryFilePreview(
        'personal',
        'Desktop/notes.txt',
        'notes.txt',
      ),
    ).resolves.toBe('/cache/notes.txt');

    expect(nativeSyncEngine.prepareSharedFilePreview).toHaveBeenCalledWith(
      'personal',
      'Desktop/notes.txt',
      '',
      'notes.txt',
    );
  });

  it('does not forward stale official access tokens for personal file operations', async () => {
    const directoryListing = {
      scope: 'personal',
      path: '',
      files: [],
      totalCount: 0,
    };
    const downloadResult = {
      savedToPhotos: false,
      localPath: '/downloads/notes.txt',
    };
    const nativeSyncEngine = {
      browseSharedFiles: jest.fn().mockResolvedValue(directoryListing),
      downloadSharedFile: jest.fn().mockResolvedValue(downloadResult),
      getSharedFileStreamUrl: jest
        .fn()
        .mockResolvedValue('http://127.0.0.1:39394/personal/stream/notes.txt'),
      getPersonalFileThumbnailUrl: jest
        .fn()
        .mockResolvedValue(
          'http://127.0.0.1:39394/personal/thumbnail/notes.txt',
        ),
      prepareSharedFilePreview: jest.fn().mockResolvedValue('/cache/notes.txt'),
    };
    const syncEngine = loadModule(nativeSyncEngine, {
      accessToken: 'stale-official-token',
    });

    await expect(syncEngine.browseDirectory('personal')).resolves.toEqual(
      directoryListing,
    );
    await expect(
      syncEngine.downloadDirectoryFile('personal', 'Desktop/notes.txt'),
    ).resolves.toEqual(downloadResult);
    await expect(
      syncEngine.getDirectoryFileStreamUrl('personal', 'Desktop/notes.txt'),
    ).resolves.toBe('http://127.0.0.1:39394/personal/stream/notes.txt');
    await expect(
      syncEngine.getPersonalFileThumbnailUrl('Desktop/notes.txt'),
    ).resolves.toBe('http://127.0.0.1:39394/personal/thumbnail/notes.txt');
    await expect(
      syncEngine.prepareDirectoryFilePreview(
        'personal',
        'Desktop/notes.txt',
        'notes.txt',
      ),
    ).resolves.toBe('/cache/notes.txt');

    expect(nativeSyncEngine.browseSharedFiles).toHaveBeenCalledWith(
      'personal',
      '',
      '',
    );
    expect(nativeSyncEngine.downloadSharedFile).toHaveBeenCalledWith(
      'personal',
      'Desktop/notes.txt',
      '',
    );
    expect(nativeSyncEngine.getSharedFileStreamUrl).toHaveBeenCalledWith(
      'personal',
      'Desktop/notes.txt',
      '',
    );
    expect(nativeSyncEngine.getPersonalFileThumbnailUrl).toHaveBeenCalledWith(
      'Desktop/notes.txt',
      '',
    );
    expect(nativeSyncEngine.prepareSharedFilePreview).toHaveBeenCalledWith(
      'personal',
      'Desktop/notes.txt',
      '',
      'notes.txt',
    );
  });
});
