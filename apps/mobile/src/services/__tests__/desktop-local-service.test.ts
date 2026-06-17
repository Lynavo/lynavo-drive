import { NativeModules } from 'react-native';

import {
  downloadGlobalRemoteAccessResource,
  downloadReceivedLibraryItem,
  downloadResource,
  downloadResourceForGlobal,
  getGlobalRemoteAccessPreviewUrl,
  getReceivedLibraryPreviewUrl,
  getResourcePreviewUrl,
  isDownloadSavedLocally,
  listGlobalRemoteAccessFolderContents,
  listGlobalRemoteAccessResources,
  listCurrentClientReceivedLibrary,
  listReceivedLibrary,
  listSharedResources,
  listSharedFolderContents,
  prepareGlobalRemoteAccessPreview,
  prepareReceivedLibraryPreview,
  prepareResourcePreview,
  shareGlobalRemoteAccessResources,
  shareResources,
} from '../desktop-local-service';
import {
  browseDirectory,
  downloadDirectoryFile,
  getDirectoryFileStreamUrl,
  getClientId,
  prepareDirectoryFilePreview,
} from '../SyncEngineModule';

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
  browseDirectory: jest.fn(),
  downloadDirectoryFile: jest.fn(),
  getDirectoryFileStreamUrl: jest.fn(),
  prepareDirectoryFilePreview: jest.fn(),
}));

const mockedGetClientId = getClientId as jest.MockedFunction<
  typeof getClientId
>;
const mockedBrowseDirectory = browseDirectory as jest.MockedFunction<
  typeof browseDirectory
>;
const mockedDownloadDirectoryFile = downloadDirectoryFile as jest.MockedFunction<
  typeof downloadDirectoryFile
>;
const mockedGetDirectoryFileStreamUrl =
  getDirectoryFileStreamUrl as jest.MockedFunction<
    typeof getDirectoryFileStreamUrl
  >;
const mockedPrepareDirectoryFilePreview =
  prepareDirectoryFilePreview as jest.MockedFunction<
    typeof prepareDirectoryFilePreview
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

  it('downloads a received library item by fileKey through native local persistence', async () => {
    mockDownloadUrlToLocal.mockResolvedValueOnce({
      savedToPhotos: true,
      localPath: 'ph://asset-001',
      savedLocation: 'Photos',
    });

    await expect(
      downloadReceivedLibraryItem(
        { host: '192.168.10.20', port: 39394 },
        {
          resourceId: '',
          desktopDeviceId: 'desktop-001',
          clientId: 'client-001',
          displayName: 'Alice iPhone',
          fileKey: '2026/06/17/client-001-photo',
          filename: 'IMG_0001.JPG',
          mediaType: 'image',
          fileSize: 2048,
          completedAt: '2026-06-16T08:00:00.000Z',
          shareStatus: 'not_shared',
        },
      ),
    ).resolves.toEqual({
      savedToPhotos: true,
      localPath: 'ph://asset-001',
      savedLocation: 'Photos',
    });

    expect(mockDownloadUrlToLocal).toHaveBeenCalledWith(
      'http://192.168.10.20:39394/resources/mobile/received/download?clientId=client-001&clientName=Alice%20iPhone&fileKey=2026%2F06%2F17%2Fclient-001-photo',
      'IMG_0001.JPG',
      'image',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to received preview when a legacy desktop cannot download received images', async () => {
    mockDownloadUrlToLocal
      .mockRejectedValueOnce(new Error('HTTP 404: page not found'))
      .mockResolvedValueOnce({
        savedToPhotos: true,
        localPath: 'ph://asset-002',
        savedLocation: 'Photos',
      });

    await expect(
      downloadReceivedLibraryItem(
        { host: '192.168.10.20', port: 39394 },
        {
          resourceId: '',
          desktopDeviceId: 'desktop-001',
          clientId: 'client-001',
          displayName: 'Alice iPhone',
          fileKey: '2026/06/17/client-001-photo',
          filename: 'IMG_0001.JPG',
          mediaType: 'image',
          fileSize: 2048,
          completedAt: '2026-06-16T08:00:00.000Z',
          shareStatus: 'not_shared',
        },
      ),
    ).resolves.toEqual({
      savedToPhotos: true,
      localPath: 'ph://asset-002',
      savedLocation: 'Photos',
    });

    expect(mockDownloadUrlToLocal).toHaveBeenNthCalledWith(
      1,
      'http://192.168.10.20:39394/resources/mobile/received/download?clientId=client-001&clientName=Alice%20iPhone&fileKey=2026%2F06%2F17%2Fclient-001-photo',
      'IMG_0001.JPG',
      'image',
    );
    expect(mockDownloadUrlToLocal).toHaveBeenNthCalledWith(
      2,
      'http://192.168.10.20:39394/resources/mobile/received/preview?clientId=client-001&clientName=Alice%20iPhone&fileKey=2026%2F06%2F17%2Fclient-001-photo',
      'IMG_0001.JPG',
      'image',
    );
  });

  it('falls back to received stream when a legacy desktop cannot download received videos', async () => {
    mockDownloadUrlToLocal
      .mockRejectedValueOnce(new Error('HTTP 404: page not found'))
      .mockResolvedValueOnce({
        savedToPhotos: true,
        localPath: 'ph://asset-003',
        savedLocation: 'Photos',
      });

    await expect(
      downloadReceivedLibraryItem(
        { host: '192.168.10.20', port: 39394 },
        {
          resourceId: '',
          desktopDeviceId: 'desktop-001',
          clientId: 'client-001',
          displayName: 'Alice iPhone',
          fileKey: '2026/06/17/client-001-video',
          filename: 'VID_0001.MOV',
          mediaType: 'video',
          fileSize: 4096,
          completedAt: '2026-06-16T08:00:00.000Z',
          shareStatus: 'not_shared',
        },
      ),
    ).resolves.toEqual({
      savedToPhotos: true,
      localPath: 'ph://asset-003',
      savedLocation: 'Photos',
    });

    expect(mockDownloadUrlToLocal).toHaveBeenNthCalledWith(
      1,
      'http://192.168.10.20:39394/resources/mobile/received/download?clientId=client-001&clientName=Alice%20iPhone&fileKey=2026%2F06%2F17%2Fclient-001-video',
      'VID_0001.MOV',
      'video',
    );
    expect(mockDownloadUrlToLocal).toHaveBeenNthCalledWith(
      2,
      'http://192.168.10.20:39394/resources/mobile/received/stream?clientId=client-001&clientName=Alice%20iPhone&fileKey=2026%2F06%2F17%2Fclient-001-video',
      'VID_0001.MOV',
      'video',
    );
  });

  it('does not fall back for legacy received document downloads without a file endpoint', async () => {
    const error = new Error('HTTP 404: page not found');
    mockDownloadUrlToLocal.mockRejectedValueOnce(error);

    await expect(
      downloadReceivedLibraryItem(
        { host: '192.168.10.20', port: 39394 },
        {
          resourceId: '',
          desktopDeviceId: 'desktop-001',
          clientId: 'client-001',
          displayName: 'Alice iPhone',
          fileKey: '2026/06/17/client-001-doc',
          filename: 'notes.txt',
          mediaType: 'document',
          fileSize: 512,
          completedAt: '2026-06-16T08:00:00.000Z',
          shareStatus: 'not_shared',
        },
      ),
    ).rejects.toThrow(error);

    expect(mockDownloadUrlToLocal).toHaveBeenCalledTimes(1);
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
            fileKey: '2026/06/17/image-key',
            filename: 'IMG_0001.JPG',
            mediaType: 'image',
            fileSize: 2048,
            completedAt: '2026-06-16T08:00:00.000Z',
            shareStatus: 'not_shared',
            previewUrl: '/resources/mobile/download/legacy-image-resource',
            thumbnailUrl: '/resources/mobile/download/legacy-image-thumb',
          },
          {
            resourceId: '',
            desktopDeviceId: 'desktop-001',
            clientId: 'client-001',
            displayName: 'Alice iPhone',
            fileKey: '2026/06/17/video-key',
            filename: 'VID_0001.MOV',
            mediaType: 'video',
            fileSize: 4096,
            completedAt: '2026-06-16T08:01:00.000Z',
            shareStatus: 'not_shared',
            previewUrl: '/resources/mobile/download/legacy-video-resource',
            streamUrl: '/resources/mobile/download/legacy-video-stream',
          },
        ],
      }),
    });

    await expect(
      listCurrentClientReceivedLibrary({ host: '192.168.10.20', port: 39394 }),
    ).resolves.toMatchObject([
      {
        fileKey: '2026/06/17/image-key',
        previewUrl:
          'http://192.168.10.20:39394/resources/mobile/received/preview?clientId=client-001&clientName=Alice%20iPhone&fileKey=2026%2F06%2F17%2Fimage-key',
        thumbnailUrl:
          'http://192.168.10.20:39394/resources/mobile/received/thumbnail?clientId=client-001&clientName=Alice%20iPhone&fileKey=2026%2F06%2F17%2Fimage-key',
      },
      {
        fileKey: '2026/06/17/video-key',
        previewUrl:
          'http://192.168.10.20:39394/resources/mobile/received/preview?clientId=client-001&clientName=Alice%20iPhone&fileKey=2026%2F06%2F17%2Fvideo-key',
        streamUrl:
          'http://192.168.10.20:39394/resources/mobile/received/stream?clientId=client-001&clientName=Alice%20iPhone&fileKey=2026%2F06%2F17%2Fvideo-key',
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

  it('previews received library media and documents by fileKey', async () => {
    mockDownloadUrlToShareCache.mockResolvedValueOnce('/cache/notes.pdf');

    const desktop = { host: '192.168.10.20', port: 39394 };
    const imageItem = {
      resourceId: '',
      desktopDeviceId: 'desktop-001',
      clientId: 'client-001',
      displayName: 'Alice iPhone',
      fileKey: '2026/06/17/client-001-photo',
      filename: 'IMG_0001.JPG',
      mediaType: 'image',
      fileSize: 2048,
      completedAt: '2026-06-16T08:00:00.000Z',
      shareStatus: 'not_shared' as const,
      previewUrl: '/resources/mobile/download/legacy-image-resource',
    };
    const docItem = {
      ...imageItem,
      fileKey: 'client-001-doc',
      filename: 'notes.pdf',
      mediaType: 'document',
    };

    await expect(getReceivedLibraryPreviewUrl(desktop, imageItem)).resolves.toBe(
      'http://192.168.10.20:39394/resources/mobile/received/preview?clientId=client-001&clientName=Alice%20iPhone&fileKey=2026%2F06%2F17%2Fclient-001-photo',
    );
    await expect(
      prepareReceivedLibraryPreview(desktop, docItem),
    ).resolves.toBe('/cache/notes.pdf');

    expect(mockDownloadUrlToShareCache).toHaveBeenCalledWith(
      'http://192.168.10.20:39394/resources/mobile/received/download?clientId=client-001&clientName=Alice%20iPhone&fileKey=client-001-doc',
      'notes.pdf',
    );
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

  it('lists global remote access from the desktop personal directory root', async () => {
    mockedBrowseDirectory.mockResolvedValueOnce({
      scope: 'personal',
      path: '',
      files: [
        {
          name: 'Desktop',
          path: 'Desktop',
          type: 'other',
          size: 96,
          modifiedAt: '2026-06-17T08:00:00.000Z',
          isDirectory: true,
        },
        {
          name: 'notes.txt',
          path: 'notes.txt',
          type: 'document',
          size: 12,
          modifiedAt: '2026-06-17T08:01:00.000Z',
        },
      ],
      totalCount: 2,
    });

    await expect(listGlobalRemoteAccessResources()).resolves.toEqual([
      {
        resourceId: 'personal-dir:Desktop',
        desktopDeviceId: 'personal-dir',
        kind: 'shared_folder',
        displayName: 'Desktop',
        status: 'available',
        fileSize: 96,
        mediaType: 'other',
        addedAt: '2026-06-17T08:00:00.000Z',
        downloadCount: 0,
      },
      {
        resourceId: 'personal-dir:notes.txt',
        desktopDeviceId: 'personal-dir',
        kind: 'shared_file',
        displayName: 'notes.txt',
        status: 'available',
        fileSize: 12,
        mediaType: 'document',
        addedAt: '2026-06-17T08:01:00.000Z',
        downloadCount: 0,
      },
    ]);
    expect(mockedBrowseDirectory).toHaveBeenCalledWith('personal');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lists global remote access folders through the desktop personal directory bridge', async () => {
    mockedBrowseDirectory.mockResolvedValueOnce({
      scope: 'personal',
      path: 'Desktop/Projects',
      files: [
        {
          name: 'brief.pdf',
          path: 'Desktop/Projects/brief.pdf',
          type: 'document',
          size: 4096,
          modifiedAt: '2026-06-17T09:00:00.000Z',
        },
      ],
      totalCount: 1,
    });

    await expect(
      listGlobalRemoteAccessFolderContents(
        'personal-dir:Desktop',
        'Projects',
      ),
    ).resolves.toEqual({
      scope: 'personal',
      path: 'Desktop/Projects',
      files: [
        {
          name: 'brief.pdf',
          path: 'Desktop/Projects/brief.pdf',
          type: 'document',
          size: 4096,
          modifiedAt: '2026-06-17T09:00:00.000Z',
        },
      ],
      totalCount: 1,
    });
    expect(mockedBrowseDirectory).toHaveBeenCalledWith(
      'personal',
      'Desktop/Projects',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('downloads and previews global remote access files through the personal directory bridge', async () => {
    mockedDownloadDirectoryFile.mockResolvedValueOnce({
      savedToPhotos: false,
      localPath: '/downloads/notes.txt',
      savedLocation: '/downloads/notes.txt',
    });
    mockedGetDirectoryFileStreamUrl.mockResolvedValueOnce(
      'http://127.0.0.1:39394/personal/stream/Desktop/notes.txt',
    );
    mockedPrepareDirectoryFilePreview.mockResolvedValueOnce('/cache/notes.txt');

    await expect(
      downloadGlobalRemoteAccessResource('personal-dir:Desktop/notes.txt'),
    ).resolves.toEqual({
      savedToPhotos: false,
      localPath: '/downloads/notes.txt',
      savedLocation: '/downloads/notes.txt',
    });
    await expect(
      getGlobalRemoteAccessPreviewUrl('personal-dir:Desktop/notes.txt'),
    ).resolves.toBe(
      'http://127.0.0.1:39394/personal/stream/Desktop/notes.txt',
    );
    await expect(
      prepareGlobalRemoteAccessPreview(
        'personal-dir:Desktop/notes.txt',
        'notes.txt',
      ),
    ).resolves.toBe('/cache/notes.txt');

    expect(mockedDownloadDirectoryFile).toHaveBeenCalledWith(
      'personal',
      'Desktop/notes.txt',
    );
    expect(mockedGetDirectoryFileStreamUrl).toHaveBeenCalledWith(
      'personal',
      'Desktop/notes.txt',
    );
    expect(mockedPrepareDirectoryFilePreview).toHaveBeenCalledWith(
      'personal',
      'Desktop/notes.txt',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shares global remote access files through the personal directory preview cache', async () => {
    mockedPrepareDirectoryFilePreview
      .mockResolvedValueOnce('/cache/photo.jpg')
      .mockResolvedValueOnce('/cache/report.pdf');
    mockShareFiles.mockResolvedValueOnce(true);

    await expect(
      shareGlobalRemoteAccessResources([
        {
          resourceId: 'personal-dir:Pictures/photo.jpg',
          displayName: 'photo.jpg',
        },
        {
          resourceId: 'personal-dir:Documents/report.pdf',
          displayName: 'report.pdf',
        },
      ]),
    ).resolves.toBeUndefined();

    expect(mockedPrepareDirectoryFilePreview).toHaveBeenNthCalledWith(
      1,
      'personal',
      'Pictures/photo.jpg',
    );
    expect(mockedPrepareDirectoryFilePreview).toHaveBeenNthCalledWith(
      2,
      'personal',
      'Documents/report.pdf',
    );
    expect(mockShareFiles).toHaveBeenCalledWith([
      '/cache/photo.jpg',
      '/cache/report.pdf',
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
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
