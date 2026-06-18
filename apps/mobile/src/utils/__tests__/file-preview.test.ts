import {
  canPreviewDocumentFile,
  documentPreviewUri,
  openFileWithOtherApp,
} from '../file-preview';

const shareOpenMock = (
  globalThis as unknown as { __mockReactNativeShareOpen: jest.Mock }
).__mockReactNativeShareOpen;

describe('file-preview', () => {
  beforeEach(() => {
    shareOpenMock.mockReset();
    shareOpenMock.mockResolvedValue({});
  });

  it('normalizes plain file paths to file URIs', () => {
    expect(documentPreviewUri('/tmp/report.pdf')).toBe(
      'file:///tmp/report.pdf',
    );
    expect(documentPreviewUri(' file:///tmp/report.pdf ')).toBe(
      'file:///tmp/report.pdf',
    );
    expect(documentPreviewUri('content://downloads/report.pdf')).toBe(
      'content://downloads/report.pdf',
    );
  });

  it('encodes filesystem paths before converting them to file URIs', () => {
    expect(documentPreviewUri('/tmp/syncflow previews/客戶 報告#Q2.pdf')).toBe(
      'file:///tmp/syncflow%20previews/%E5%AE%A2%E6%88%B6%20%E5%A0%B1%E5%91%8A%23Q2.pdf',
    );
  });

  it('passes a sanitized filename and metadata to the share sheet', async () => {
    await openFileWithOtherApp(
      '/tmp/syncflow_shared_downloads/cache-item',
      '  客戶/報告:Q2.pdf  ',
    );

    expect(shareOpenMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'file:///tmp/syncflow_shared_downloads/cache-item',
        filename: '客戶_報告_Q2.pdf',
        title: '客戶_報告_Q2.pdf',
        subject: '客戶_報告_Q2.pdf',
      }),
    );
  });

  it('routes extensionless files through the share sheet instead of document preview', () => {
    expect(
      canPreviewDocumentFile('application/x-mach-binary', 'protoc-gen-go'),
    ).toBe(false);
    expect(canPreviewDocumentFile('text/plain', 'README')).toBe(false);
    expect(canPreviewDocumentFile('application/pdf', 'report.pdf')).toBe(true);
  });

  it('does not crash at module load when the native share module is missing', async () => {
    jest.resetModules();
    jest.doMock('react-native-share', () => {
      throw new Error('RNShare could not be found');
    });

    let moduleUnderTest: typeof import('../file-preview') | undefined;
    expect(() => {
      moduleUnderTest = require('../file-preview') as typeof import('../file-preview');
    }).not.toThrow();
    if (!moduleUnderTest) {
      throw new Error('file-preview module did not load');
    }

    await expect(
      moduleUnderTest.openFileWithOtherApp('/tmp/cache-item', 'cache-item'),
    ).rejects.toThrow('react-native-share open is unavailable');

    jest.dontMock('react-native-share');
    jest.resetModules();
  });
});
