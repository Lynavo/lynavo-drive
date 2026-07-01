describe('SyncEngineModule document picker bridge', () => {
  const readNativeBridgeSource = (relativePath: string): string => {
    const { readFileSync } = jest.requireActual('fs') as {
      readFileSync: (path: string, encoding: 'utf8') => string;
    };
    const { process } = globalThis as unknown as {
      process: { cwd: () => string };
    };
    return readFileSync(`${process.cwd()}/${relativePath}`, 'utf8');
  };

  const loadModule = () => {
    jest.resetModules();
    const nativeSyncEngine = {
      submitDocumentUploads: jest.fn().mockResolvedValue({
        queuedCount: 1,
        skippedCount: 0,
        batchId: 'document-batch-1',
        files: [
          {
            name: 'Launch Clip.mov',
            size: 12,
            mimeType: 'video/quicktime',
            uri: 'content://docs/launch-clip',
          },
        ],
      }),
    };
    const pickerPick = jest.fn();
    const isErrorWithCode = jest.fn();

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
    jest.doMock(
      '@react-native-documents/picker',
      () => ({
        errorCodes: {
          OPERATION_CANCELED: 'OPERATION_CANCELED',
        },
        isErrorWithCode,
        pick: pickerPick,
      }),
      { virtual: true },
    );

    const syncEngine =
      require('../SyncEngineModule') as typeof import('../SyncEngineModule');

    return {
      isErrorWithCode,
      nativeSyncEngine,
      pickerPick,
      syncEngine,
    };
  };

  afterEach(() => {
    jest.dontMock('react-native');
    jest.dontMock('@react-native-async-storage/async-storage');
    jest.dontMock('@react-native-documents/picker');
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('selects files through @react-native-documents/picker instead of the native picker bridge', async () => {
    const { nativeSyncEngine, pickerPick, syncEngine } = loadModule();
    pickerPick.mockResolvedValue([
      {
        name: 'Brand Guidelines.pdf',
        size: 2048,
        type: 'application/pdf',
        uri: 'content://docs/brand-guidelines',
      },
      {
        name: null,
        size: null,
        type: null,
        uri: 'content://docs/unnamed',
      },
    ]);

    await expect(syncEngine.pickDocumentUploads()).resolves.toEqual({
      queuedCount: 0,
      skippedCount: 0,
      batchId: '',
      files: [
        {
          name: 'Brand Guidelines.pdf',
          size: 2048,
          mimeType: 'application/pdf',
          uri: 'content://docs/brand-guidelines',
        },
        {
          name: 'Document',
          size: 0,
          mimeType: null,
          uri: 'content://docs/unnamed',
        },
      ],
    });

    expect(pickerPick).toHaveBeenCalledWith({
      allowMultiSelection: true,
      mode: 'open',
      requestLongTermAccess: true,
    });
    expect(nativeSyncEngine).not.toHaveProperty('pickDocumentUploads');
  });

  it('normalizes picker cancellation for existing screen error handling', async () => {
    const { isErrorWithCode, pickerPick, syncEngine } = loadModule();
    const pickerError = { code: 'OPERATION_CANCELED' };
    isErrorWithCode.mockReturnValue(true);
    pickerPick.mockRejectedValue(pickerError);

    await expect(syncEngine.pickDocumentUploads()).rejects.toMatchObject({
      code: 'DOCUMENT_PICKER_CANCELLED',
    });
  });

  it('submits the final selected file list to the native sync engine', async () => {
    const { nativeSyncEngine, syncEngine } = loadModule();
    const files = [
      {
        name: 'Launch Clip.mov',
        size: 12,
        mimeType: 'video/quicktime',
        uri: 'content://docs/launch-clip',
      },
    ];

    await expect(syncEngine.submitDocumentUploads(files)).resolves.toEqual({
      queuedCount: 1,
      skippedCount: 0,
      batchId: 'document-batch-1',
      files,
    });
    expect(nativeSyncEngine.submitDocumentUploads).toHaveBeenCalledWith({
      files,
    });
  });

  it('does not expose the legacy native document picker bridge', () => {
    const iosExternBridge = readNativeBridgeSource('ios/SyncEngine/RNBridge.m');
    const iosSwiftBridge = readNativeBridgeSource(
      'ios/SyncEngine/RNBridge.swift',
    );
    const androidBridge = readNativeBridgeSource(
      'android/app/src/main/java/com/lynavo/drive/mobile/sync/NativeSyncEngineModule.kt',
    );

    expect(iosExternBridge).not.toContain('pickDocumentUploads');
    expect(iosSwiftBridge).not.toContain('func pickDocumentUploads');
    expect(androidBridge).not.toContain('fun pickDocumentUploads');
  });
});
