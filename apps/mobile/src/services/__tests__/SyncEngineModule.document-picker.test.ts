describe('SyncEngineModule manual file-selection boundary', () => {
  const readSource = (relativePath: string): string => {
    const { readFileSync } = jest.requireActual('fs') as {
      readFileSync: (path: string, encoding: 'utf8') => string;
    };
    const { process } = globalThis as unknown as {
      process: { cwd: () => string };
    };
    return readFileSync(`${process.cwd()}/${relativePath}`, 'utf8');
  };

  it('does not expose JS upload APIs backed by a document picker or manual submit bridge', () => {
    const syncEngineModule = readSource('src/services/SyncEngineModule.ts');
    const mobilePackage = readSource('package.json');

    expect(syncEngineModule).not.toContain('@react-native-documents/picker');
    expect(syncEngineModule).not.toContain('pickDocumentUploads');
    expect(syncEngineModule).not.toContain('submitDocumentUploads');
    expect(syncEngineModule).not.toContain('submitManualUpload');
    expect(syncEngineModule).not.toContain('cancelManualBatch');
    expect(syncEngineModule).not.toContain('cancelAllManualUploads');
    expect(mobilePackage).not.toContain('@react-native-documents/picker');
    expect(mobilePackage).toContain('@react-native-documents/viewer');
  });

  it('does not expose native manual upload bridge methods', () => {
    const iosExternBridge = readSource('ios/SyncEngine/RNBridge.m');
    const iosSwiftBridge = readSource('ios/SyncEngine/RNBridge.swift');
    const androidBridge = readSource(
      'android/app/src/main/java/com/lynavo/drive/mobile/sync/NativeSyncEngineModule.kt',
    );

    for (const source of [iosExternBridge, iosSwiftBridge, androidBridge]) {
      expect(source).not.toContain('pickDocumentUploads');
      expect(source).not.toContain('submitDocumentUploads');
      expect(source).not.toContain('submitManualUpload');
      expect(source).not.toContain('cancelManualBatch');
      expect(source).not.toContain('cancelAllManualUploads');
    }
  });
});
