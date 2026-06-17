import { NativeModules } from 'react-native';

import {
  downloadResource,
  downloadResourceForGlobal,
  getResourcePreviewUrl,
  isDownloadSavedLocally,
  listCurrentClientReceivedLibrary,
  listReceivedLibrary,
  listSharedResources,
  listSharedFolderContents,
  prepareResourcePreview,
  shareResources,
} from '../desktop-local-service';
import { getClientId } from '../SyncEngineModule';

jest.mock('react-native', () => ({
  NativeModules: {
    NativeSyncEngine: {
      getClientDisplayName: jest.fn(),
      downloadUrlToShareCache: jest.fn(),
      downloadUrlToLocal: jest.fn(),
      shareFiles: jest.fn(),
    },
  },
}));

jest.mock('../SyncEngineModule', () => ({
  getClientId: jest.fn(),
}));

const mockedGetClientId = getClientId as jest.MockedFunction<
  typeof getClientId
>;
const mockGetClientDisplayName = NativeModules.NativeSyncEngine
  ?.getClientDisplayName as jest.MockedFunction<() => Promise<string>>;
const mockDownloadUrlToShareCache = NativeModules.NativeSyncEngine
  ?.downloadUrlToShareCache as jest.MockedFunction<
    (url: string, filename: string) => Promise<string>
  >;
const mockDownloadUrlToLocal = NativeModules.NativeSyncEngine
  ?.downloadUrlToLocal as jest.MockedFunction<
    (
      url: string,
      filename: string,
      mediaType?: string | null,
    ) => Promise<{
      savedToPhotos: boolean;
      localPath: string | null;
      savedLocation?: string | null;
    }>
  >;
const mockShareFiles = NativeModules.NativeSyncEngine
  ?.shareFiles as jest.MockedFunction<(localPaths: string[]) => Promise<boolean>>;

describe('desktop-local-service', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetClientId.mockResolvedValue('client-001');
    mockGetClientDisplayName.mockResolvedValue('Alice iPhone');
    fetchMock = jest.fn();
    globalThis.fetch = fetchMock;
  });

  it('keeps the legacy CN downloadResource request without manufacturing a local path', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      statusText: 'OK',
    });

    await expect(
      downloadResource({ host: '192.168.10.20', port: 39394 }, 'resource-1'),
    ).resolves.toEqual({
      savedToPhotos: false,
      localPath: null,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://192.168.10.20:39394/resources/mobile/download/resource-1?clientId=client-001&clientName=Alice%20iPhone',
    );
  });

  it('downloads a global remote resource through native local persistence', async () => {
    mockDownloadUrlToLocal.mockResolvedValueOnce({
      savedToPhotos: false,
      localPath: '/downloads/report.pdf',
      savedLocation: '/downloads/report.pdf',
    });

    await expect(
      downloadResourceForGlobal(
        { host: '192.168.10.20', port: 39394 },
        'resource-1',
        'report.pdf',
        'document',
      ),
    ).resolves.toEqual({
      savedToPhotos: false,
      localPath: '/downloads/report.pdf',
      savedLocation: '/downloads/report.pdf',
    });
    expect(mockDownloadUrlToLocal).toHaveBeenCalledWith(
      'http://192.168.10.20:39394/resources/mobile/download/resource-1?clientId=client-001&clientName=Alice%20iPhone',
      'report.pdf',
      'document',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lists a shared folder with encoded nested path segments', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      statusText: 'OK',
      json: jest.fn().mockResolvedValue({
        path: 'Design Assets/June',
        files: [
          {
            name: 'hero.png',
            path: 'Design Assets/June/hero.png',
            type: 'image',
            size: 1024,
            modifiedAt: '2026-06-16T08:00:00.000Z',
          },
        ],
        totalCount: 1,
      }),
    });

    await expect(
      listSharedFolderContents(
        { host: '192.168.10.20', port: 39394 },
        'resource-1',
        'Design Assets/June',
      ),
    ).resolves.toEqual({
      path: 'Design Assets/June',
      files: [
        {
          name: 'hero.png',
          path: 'Design Assets/June/hero.png',
          type: 'image',
          size: 1024,
          modifiedAt: '2026-06-16T08:00:00.000Z',
        },
      ],
      totalCount: 1,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://192.168.10.20:39394/resources/mobile/shared/resource-1/list/Design%20Assets/June?clientId=client-001&clientName=Alice%20iPhone',
    );
  });

  it('falls back to the desktop shared directory when the managed registry is empty', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        statusText: 'OK',
        json: jest.fn().mockResolvedValue({ items: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        statusText: 'OK',
        json: jest.fn().mockResolvedValue({
          path: '',
          files: [
            {
              name: 'Projects',
              path: 'Projects',
              type: 'other',
              size: 96,
              modifiedAt: '2026-06-16T08:30:00.000Z',
              isDirectory: true,
            },
            {
              name: 'readme.txt',
              path: 'readme.txt',
              type: 'document',
              size: 2048,
              modifiedAt: '2026-06-16T08:31:00.000Z',
            },
          ],
          totalCount: 2,
        }),
      });

    await expect(
      listSharedResources({ host: '192.168.10.20', port: 39394 }),
    ).resolves.toEqual([
      {
        resourceId: 'shared-dir:Projects',
        desktopDeviceId: 'shared-dir',
        kind: 'shared_folder',
        displayName: 'Projects',
        status: 'available',
        fileSize: 96,
        mediaType: 'other',
        addedAt: '2026-06-16T08:30:00.000Z',
        downloadCount: 0,
      },
      {
        resourceId: 'shared-dir:readme.txt',
        desktopDeviceId: 'shared-dir',
        kind: 'shared_file',
        displayName: 'readme.txt',
        status: 'available',
        fileSize: 2048,
        mediaType: 'document',
        addedAt: '2026-06-16T08:31:00.000Z',
        downloadCount: 0,
      },
    ]);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://192.168.10.20:39394/resources/mobile/shared?clientId=client-001&clientName=Alice%20iPhone',
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://192.168.10.20:39394/shared/list',
    );
  });

  it('lists fallback shared-directory folder contents by encoded path', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      statusText: 'OK',
      json: jest.fn().mockResolvedValue({
        path: 'Projects/June',
        files: [],
        totalCount: 0,
      }),
    });

    await expect(
      listSharedFolderContents(
        { host: '192.168.10.20', port: 39394 },
        'shared-dir:Projects',
        'June',
      ),
    ).resolves.toEqual({
      path: 'Projects/June',
      files: [],
      totalCount: 0,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://192.168.10.20:39394/shared/list/Projects/June',
    );
  });

  it('downloads fallback shared-directory files by encoded path', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      statusText: 'OK',
    });

    await expect(
      downloadResource(
        { host: '192.168.10.20', port: 39394 },
        'shared-dir:Reports/Quarterly%20Summary.pdf',
      ),
    ).resolves.toEqual({
      savedToPhotos: false,
      localPath: null,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://192.168.10.20:39394/shared/download/Reports/Quarterly%20Summary.pdf',
    );
  });

  it('keeps the legacy received library request unscoped for CN screens', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      statusText: 'OK',
      json: jest.fn().mockResolvedValue({ items: [] }),
    });

    await expect(
      listReceivedLibrary({ host: '192.168.10.20', port: 39394 }),
    ).resolves.toEqual([]);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://192.168.10.20:39394/resources/mobile/received?clientId=client-001&clientName=Alice%20iPhone',
    );
  });

  it('scopes the global received library request to the current mobile client', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      statusText: 'OK',
      json: jest.fn().mockResolvedValue({ items: [] }),
    });

    await expect(
      listCurrentClientReceivedLibrary({ host: '192.168.10.20', port: 39394 }),
    ).resolves.toEqual([]);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://192.168.10.20:39394/resources/mobile/received?clientId=client-001&clientName=Alice%20iPhone&scope=client',
    );
  });

  it('adds absolute preview and thumbnail urls for current-client received media', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      statusText: 'OK',
      json: jest.fn().mockResolvedValue({
        items: [
          {
            resourceId: '',
            desktopDeviceId: 'desktop-001',
            clientId: 'client-001',
            displayName: 'Alice iPhone',
            fileKey: 'image-key',
            filename: 'IMG_0001.JPG',
            mediaType: 'image',
            fileSize: 2048,
            completedAt: '2026-06-16T08:00:00.000Z',
            shareStatus: 'not_shared',
          },
          {
            resourceId: '',
            desktopDeviceId: 'desktop-001',
            clientId: 'client-001',
            displayName: 'Alice iPhone',
            fileKey: 'video-key',
            filename: 'VID_0001.MOV',
            mediaType: 'video',
            fileSize: 4096,
            completedAt: '2026-06-16T08:01:00.000Z',
            shareStatus: 'not_shared',
          },
        ],
      }),
    });

    await expect(
      listCurrentClientReceivedLibrary({ host: '192.168.10.20', port: 39394 }),
    ).resolves.toMatchObject([
      {
        fileKey: 'image-key',
        previewUrl:
          'http://192.168.10.20:39394/resources/mobile/received/preview?clientId=client-001&clientName=Alice%20iPhone&fileKey=image-key',
        thumbnailUrl:
          'http://192.168.10.20:39394/resources/mobile/received/thumbnail?clientId=client-001&clientName=Alice%20iPhone&fileKey=image-key',
      },
      {
        fileKey: 'video-key',
        previewUrl:
          'http://192.168.10.20:39394/resources/mobile/received/preview?clientId=client-001&clientName=Alice%20iPhone&fileKey=video-key',
        streamUrl:
          'http://192.168.10.20:39394/resources/mobile/received/stream?clientId=client-001&clientName=Alice%20iPhone&fileKey=video-key',
      },
    ]);
  });

  it('downloads selected remote resources to share cache and opens the system share sheet once', async () => {
    mockDownloadUrlToShareCache
      .mockResolvedValueOnce('/cache/photo.jpg')
      .mockResolvedValueOnce('/cache/spec.pdf');
    mockShareFiles.mockResolvedValueOnce(true);

    await expect(
      shareResources({ host: '192.168.10.20', port: 39394 }, [
        { resourceId: 'resource-1', displayName: 'photo.jpg' },
        {
          resourceId: 'shared-folder-entry:folder-1:Specs/June Plan.pdf',
          displayName: 'spec.pdf',
        },
      ]),
    ).resolves.toBeUndefined();

    expect(mockDownloadUrlToShareCache).toHaveBeenNthCalledWith(
      1,
      'http://192.168.10.20:39394/resources/mobile/download/resource-1?clientId=client-001&clientName=Alice%20iPhone',
      'photo.jpg',
    );
    expect(mockDownloadUrlToShareCache).toHaveBeenNthCalledWith(
      2,
      'http://192.168.10.20:39394/resources/mobile/download/folder-1?path=Specs%2FJune%20Plan.pdf&clientId=client-001&clientName=Alice%20iPhone',
      'spec.pdf',
    );
    expect(mockShareFiles).toHaveBeenCalledWith([
      '/cache/photo.jpg',
      '/cache/spec.pdf',
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prepares a normal remote resource for system preview through the share cache', async () => {
    mockDownloadUrlToShareCache.mockResolvedValueOnce('/cache/report.pdf');

    await expect(
      prepareResourcePreview(
        { host: '192.168.10.20', port: 39394 },
        'resource-1',
        'report.pdf',
      ),
    ).resolves.toBe('/cache/report.pdf');

    expect(mockDownloadUrlToShareCache).toHaveBeenCalledWith(
      'http://192.168.10.20:39394/resources/mobile/download/resource-1?clientId=client-001&clientName=Alice%20iPhone',
      'report.pdf',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prepares a shared-folder entry for system preview with the nested path preserved', async () => {
    mockDownloadUrlToShareCache.mockResolvedValueOnce('/cache/june-plan.pdf');

    await expect(
      prepareResourcePreview(
        { host: '192.168.10.20', port: 39394 },
        'shared-folder-entry:folder-1:Specs/June Plan.pdf',
        'June Plan.pdf',
      ),
    ).resolves.toBe('/cache/june-plan.pdf');

    expect(mockDownloadUrlToShareCache).toHaveBeenCalledWith(
      'http://192.168.10.20:39394/resources/mobile/download/folder-1?path=Specs%2FJune%20Plan.pdf&clientId=client-001&clientName=Alice%20iPhone',
      'June Plan.pdf',
    );
  });

  it('returns a direct preview URL for fallback shared-directory resources', async () => {
    await expect(
      getResourcePreviewUrl(
        { host: '192.168.10.20', port: 39394 },
        'shared-dir:Reports/Quarterly%20Summary.pdf',
      ),
    ).resolves.toBe(
      'http://192.168.10.20:39394/shared/download/Reports/Quarterly%20Summary.pdf',
    );
  });

  it('detects whether a download result was actually saved locally', () => {
    expect(
      isDownloadSavedLocally({ savedToPhotos: false, localPath: null }),
    ).toBe(false);
    expect(
      isDownloadSavedLocally({ savedToPhotos: false, localPath: '  ' }),
    ).toBe(false);
    expect(
      isDownloadSavedLocally({
        savedToPhotos: false,
        localPath: '/tmp/report.pdf',
      }),
    ).toBe(true);
    expect(
      isDownloadSavedLocally({
        savedToPhotos: false,
        localPath: null,
        savedLocation: 'Downloads/Vivi Drop',
      }),
    ).toBe(true);
    expect(
      isDownloadSavedLocally({ savedToPhotos: true, localPath: null }),
    ).toBe(true);
  });
});
