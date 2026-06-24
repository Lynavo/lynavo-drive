import { NativeModules, Platform } from 'react-native';

import {
  downloadGlobalRemoteAccessResource,
  downloadReceivedLibraryItem,
  downloadResource,
  downloadResourceForGlobal,
  getGlobalRemoteAccessPreviewUrl,
  getReceivedLibraryPreviewUrl,
  getResourcePreviewUrl,
  listGlobalReceivedLibraryPage,
  isDownloadSavedLocally,
  listCurrentClientReceivedLibraryPage,
  listGlobalRemoteAccessFolderContents,
  listGlobalRemoteAccessResources,
  listCurrentClientReceivedLibrary,
  listReceivedLibrary,
  listSharedResources,
  listSharedFolderContents,
  prepareGlobalRemoteAccessShareFile,
  prepareGlobalRemoteAccessPreview,
  prepareReceivedLibraryPreview,
  prepareResourcePreview,
  shareGlobalRemoteAccessResources,
  shareResources,
} from '../desktop-local-service';
import {
  browseDirectory,
  downloadReceivedFile,
  downloadDirectoryFile,
  getDirectoryFileStreamUrl,
  getClientId,
  getReceivedFilePreviewUrl,
  listGlobalReceivedFiles,
  listReceivedFiles,
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
  Platform: {
    OS: 'ios',
  },
}));

jest.mock('../SyncEngineModule', () => ({
  getClientId: jest.fn(),
  browseDirectory: jest.fn(),
  downloadReceivedFile: jest.fn(),
  downloadDirectoryFile: jest.fn(),
  getDirectoryFileStreamUrl: jest.fn(),
  getReceivedFilePreviewUrl: jest.fn(),
  listGlobalReceivedFiles: jest.fn(),
  listReceivedFiles: jest.fn(),
  prepareDirectoryFilePreview: jest.fn(),
}));

const mockedGetClientId = getClientId as jest.MockedFunction<
  typeof getClientId
>;
const mockedBrowseDirectory = browseDirectory as jest.MockedFunction<
  typeof browseDirectory
>;
const mockedDownloadReceivedFile = downloadReceivedFile as jest.MockedFunction<
  typeof downloadReceivedFile
>;
const mockedDownloadDirectoryFile =
  downloadDirectoryFile as jest.MockedFunction<typeof downloadDirectoryFile>;
const mockedGetDirectoryFileStreamUrl =
  getDirectoryFileStreamUrl as jest.MockedFunction<
    typeof getDirectoryFileStreamUrl
  >;
const mockedGetReceivedFilePreviewUrl =
  getReceivedFilePreviewUrl as jest.MockedFunction<
    typeof getReceivedFilePreviewUrl
  >;
const mockedListGlobalReceivedFiles =
  listGlobalReceivedFiles as jest.MockedFunction<typeof listGlobalReceivedFiles>;
const mockedListReceivedFiles = listReceivedFiles as jest.MockedFunction<
  typeof listReceivedFiles
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
  ?.shareFiles as jest.MockedFunction<
  (localPaths: string[]) => Promise<boolean>
>;

function setPlatformOS(os: typeof Platform.OS): void {
  Object.defineProperty(Platform, 'OS', {
    configurable: true,
    value: os,
  });
}

describe('desktop-local-service', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    setPlatformOS('ios');
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
    mockedDownloadReceivedFile.mockResolvedValueOnce({
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

    expect(mockedDownloadReceivedFile).toHaveBeenCalledWith(
      '2026/06/17/client-001-photo',
      'IMG_0001.JPG',
      'image',
    );
    expect(mockDownloadUrlToLocal).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats received iOS PhotoKit downloads as saved to photos even when native omits the flag', async () => {
    mockedDownloadReceivedFile.mockResolvedValueOnce({
      savedToPhotos: false,
      localPath: 'ph://asset-004',
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
          filename: 'IMG_0002.JPG',
          mediaType: 'image/jpeg',
          fileSize: 2048,
          completedAt: '2026-06-16T08:00:00.000Z',
          shareStatus: 'not_shared',
        },
      ),
    ).resolves.toEqual({
      savedToPhotos: true,
      localPath: 'ph://asset-004',
      savedLocation: 'Photos',
    });
  });

  it('treats received Android media-store downloads as saved to photos from their saved location', async () => {
    mockedDownloadReceivedFile.mockResolvedValueOnce({
      savedToPhotos: false,
      localPath: null,
      savedLocation: 'Pictures/Vivi Drop',
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
          filename: 'IMG_0003.JPG',
          mediaType: 'image/jpeg',
          fileSize: 2048,
          completedAt: '2026-06-16T08:00:00.000Z',
          shareStatus: 'not_shared',
        },
      ),
    ).resolves.toEqual({
      savedToPhotos: true,
      localPath: null,
      savedLocation: 'Pictures/Vivi Drop',
    });
  });

  it('does not bypass the native received route for received image downloads', async () => {
    mockedDownloadReceivedFile.mockResolvedValueOnce({
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

    expect(mockedDownloadReceivedFile).toHaveBeenCalledWith(
      '2026/06/17/client-001-photo',
      'IMG_0001.JPG',
      'image',
    );
    expect(mockDownloadUrlToLocal).not.toHaveBeenCalled();
  });

  it('does not bypass the native received route for received video downloads', async () => {
    mockedDownloadReceivedFile.mockResolvedValueOnce({
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

    expect(mockedDownloadReceivedFile).toHaveBeenCalledWith(
      '2026/06/17/client-001-video',
      'VID_0001.MOV',
      'video',
    );
    expect(mockDownloadUrlToLocal).not.toHaveBeenCalled();
  });

  it('propagates native received download failures for documents', async () => {
    const error = new Error('Download failed with HTTP 404');
    mockedDownloadReceivedFile.mockRejectedValueOnce(error);

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

    expect(mockedDownloadReceivedFile).toHaveBeenCalledWith(
      '2026/06/17/client-001-doc',
      'notes.txt',
      'document',
    );
    expect(mockDownloadUrlToLocal).not.toHaveBeenCalled();
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
              name: 'photo.jpg',
              path: 'photo.jpg',
              type: 'image',
              size: 2048,
              modifiedAt: '2026-06-16T08:31:00.000Z',
              thumbnailUrl:
                'http://192.168.10.20:39394/shared/thumbnail/photo.jpg',
              streamUrl: 'http://192.168.10.20:39394/shared/stream/photo.jpg',
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
        resourceId: 'shared-dir:photo.jpg',
        desktopDeviceId: 'shared-dir',
        kind: 'shared_file',
        displayName: 'photo.jpg',
        status: 'available',
        fileSize: 2048,
        mediaType: 'image',
        addedAt: '2026-06-16T08:31:00.000Z',
        downloadCount: 0,
        thumbnailUrl: 'http://192.168.10.20:39394/shared/thumbnail/photo.jpg',
        previewUrl: 'http://192.168.10.20:39394/shared/stream/photo.jpg',
        streamUrl: 'http://192.168.10.20:39394/shared/stream/photo.jpg',
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

  it('keeps non-Android global received library requests on the native route first', async () => {
    mockedListReceivedFiles.mockResolvedValueOnce([]);

    await expect(
      listCurrentClientReceivedLibrary({ host: '192.168.10.20', port: 39394 }),
    ).resolves.toEqual([]);

    expect(mockedListReceivedFiles).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('adds direct desktop media URLs to the current-client global library', async () => {
    setPlatformOS('android');
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
            fileKey: '2026/06/17/fallback-image',
            filename: 'IMG_FALLBACK.JPG',
            mediaType: 'image',
            fileSize: 2048,
            completedAt: '2026-06-16T08:00:00.000Z',
            shareStatus: 'not_shared',
          },
        ],
      }),
    });

    await expect(
      listCurrentClientReceivedLibrary({ host: '192.168.10.20', port: 39394 }),
    ).resolves.toMatchObject([
      {
        fileKey: '2026/06/17/fallback-image',
        previewUrl:
          'http://192.168.10.20:39394/resources/mobile/received/preview?clientId=client-001&clientName=Alice%20iPhone&fileKey=2026%2F06%2F17%2Ffallback-image',
        thumbnailUrl:
          'http://192.168.10.20:39394/resources/mobile/received/thumbnail?clientId=client-001&clientName=Alice%20iPhone&fileKey=2026%2F06%2F17%2Ffallback-image',
      },
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://192.168.10.20:39394/resources/mobile/received?clientId=client-001&clientName=Alice%20iPhone&scope=client',
    );
    expect(mockedListReceivedFiles).not.toHaveBeenCalled();
  });

  it('requests current-client global library pages over direct Android HTTP', async () => {
    setPlatformOS('android');
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
            fileKey: '2026/06/17/page-image',
            filename: 'IMG_PAGE.JPG',
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
            fileKey: '2026/06/17/page-video',
            filename: 'IMG_0346.MOV',
            mediaType: 'video',
            fileSize: 8192,
            completedAt: '2026-06-16T08:01:00.000Z',
            shareStatus: 'not_shared',
          },
        ],
        page: 2,
        pageSize: 20,
        totalItems: 41,
        totalBytes: 8388608,
        deviceStats: [
          {
            clientId: 'client-001',
            photoCount: 39,
            fileCount: 2,
            totalBytes: 8388608,
          },
        ],
      }),
    });

    await expect(
      listCurrentClientReceivedLibraryPage(
        { host: '192.168.10.20', port: 39394 },
        { page: 2, pageSize: 20 },
      ),
    ).resolves.toMatchObject({
      page: 2,
      pageSize: 20,
      totalItems: 41,
      totalBytes: 8388608,
      items: [
        {
          fileKey: '2026/06/17/page-image',
          previewUrl:
            'http://192.168.10.20:39394/resources/mobile/received/preview?clientId=client-001&clientName=Alice%20iPhone&fileKey=2026%2F06%2F17%2Fpage-image',
          thumbnailUrl:
            'http://192.168.10.20:39394/resources/mobile/received/thumbnail?clientId=client-001&clientName=Alice%20iPhone&fileKey=2026%2F06%2F17%2Fpage-image',
        },
        {
          fileKey: '2026/06/17/page-video',
          previewUrl:
            'http://192.168.10.20:39394/resources/mobile/received/preview?clientId=client-001&clientName=Alice%20iPhone&fileKey=2026%2F06%2F17%2Fpage-video',
          thumbnailUrl:
            'http://192.168.10.20:39394/resources/mobile/received/thumbnail?clientId=client-001&clientName=Alice%20iPhone&fileKey=2026%2F06%2F17%2Fpage-video',
          streamUrl:
            'http://192.168.10.20:39394/resources/mobile/received/stream?clientId=client-001&clientName=Alice%20iPhone&fileKey=2026%2F06%2F17%2Fpage-video',
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://192.168.10.20:39394/resources/mobile/received?clientId=client-001&clientName=Alice%20iPhone&scope=client&page=2&pageSize=20',
    );
    expect(mockedListReceivedFiles).not.toHaveBeenCalled();
  });

  it('requests global received library pages without current-client scoping', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      statusText: 'OK',
      json: jest.fn().mockResolvedValue({
        items: [
          {
            resourceId: '',
            desktopDeviceId: 'desktop-001',
            clientId: 'account-a-client',
            displayName: 'A account photo',
            fileKey: '2026/06/17/account-a-image',
            filename: 'IMG_ACCOUNT_A.JPG',
            mediaType: 'image',
            fileSize: 4096,
            completedAt: '2026-06-16T08:00:00.000Z',
            shareStatus: 'not_shared',
          },
        ],
        page: 2,
        pageSize: 20,
        totalItems: 1,
        totalBytes: 4096,
        deviceStats: [],
      }),
    });

    await expect(
      listGlobalReceivedLibraryPage(
        { host: '192.168.10.20', port: 39394 },
        { page: 2, pageSize: 20 },
      ),
    ).resolves.toMatchObject({
      page: 2,
      pageSize: 20,
      totalItems: 1,
      items: [
        {
          clientId: 'account-a-client',
          fileKey: '2026/06/17/account-a-image',
          previewUrl:
            'http://192.168.10.20:39394/resources/mobile/received/preview?clientId=client-001&clientName=Alice%20iPhone&fileKey=2026%2F06%2F17%2Faccount-a-image',
          thumbnailUrl:
            'http://192.168.10.20:39394/resources/mobile/received/thumbnail?clientId=client-001&clientName=Alice%20iPhone&fileKey=2026%2F06%2F17%2Faccount-a-image',
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://192.168.10.20:39394/resources/mobile/received?clientId=client-001&clientName=Alice%20iPhone&page=2&pageSize=20',
    );
    expect(mockedListReceivedFiles).not.toHaveBeenCalled();
  });

  it('preserves server-generated media URLs for cross-device global received items', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      statusText: 'OK',
      json: jest.fn().mockResolvedValue({
        items: [
          {
            resourceId: '',
            desktopDeviceId: 'desktop-001',
            clientId: 'other-device-client',
            displayName: 'Other device video',
            fileKey: 'file-from-other-device',
            filename: 'OTHER_DEVICE.MOV',
            mediaType: 'video',
            fileSize: 8192,
            completedAt: '2026-06-16T08:00:00.000Z',
            shareStatus: 'not_shared',
            previewUrl:
              '/resources/mobile/received/preview?clientId=client-001&clientName=Alice%20iPhone&fileKey=file-from-other-device',
            thumbnailUrl:
              '/resources/mobile/received/thumbnail?clientId=client-001&clientName=Alice%20iPhone&fileKey=file-from-other-device',
            streamUrl:
              '/resources/mobile/received/stream?clientId=client-001&clientName=Alice%20iPhone&fileKey=file-from-other-device',
          },
        ],
        page: 1,
        pageSize: 20,
        totalItems: 1,
        totalBytes: 8192,
        deviceStats: [],
      }),
    });

    const result = await listGlobalReceivedLibraryPage(
      { host: '192.168.10.20', port: 39394 },
      { page: 1, pageSize: 20 },
    );

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        fileKey: 'file-from-other-device',
        previewUrl:
          '/resources/mobile/received/preview?clientId=client-001&clientName=Alice%20iPhone&fileKey=file-from-other-device',
        thumbnailUrl:
          '/resources/mobile/received/thumbnail?clientId=client-001&clientName=Alice%20iPhone&fileKey=file-from-other-device',
        streamUrl:
          '/resources/mobile/received/stream?clientId=client-001&clientName=Alice%20iPhone&fileKey=file-from-other-device',
      }),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'http://192.168.10.20:39394/resources/mobile/received?clientId=client-001&clientName=Alice%20iPhone&page=1&pageSize=20',
    );
    expect(mockedListReceivedFiles).not.toHaveBeenCalled();
  });

  it('falls back to the native unscoped received library for global pages', async () => {
    fetchMock.mockRejectedValueOnce(new Error('LAN route unavailable'));
    mockedListGlobalReceivedFiles.mockResolvedValueOnce([
      {
        resourceId: '',
        desktopDeviceId: 'desktop-001',
        clientId: 'account-a-client',
        displayName: 'A account photo',
        fileKey: '2026/06/17/native-account-a-image',
        filename: 'IMG_ACCOUNT_A_NATIVE.JPG',
        mediaType: 'image',
        fileSize: 4096,
        completedAt: '2026-06-16T08:00:00.000Z',
        shareStatus: 'not_shared',
        previewUrl:
          'http://127.0.0.1:49394/resources/mobile/received/preview?fileKey=native-account-a-image',
        thumbnailUrl:
          'http://127.0.0.1:49394/resources/mobile/received/thumbnail?fileKey=native-account-a-image',
      },
    ]);

    await expect(
      listGlobalReceivedLibraryPage(
        { host: '192.168.10.20', port: 39394 },
        { page: 1, pageSize: 20 },
      ),
    ).resolves.toMatchObject({
      page: 1,
      pageSize: 20,
      totalItems: 1,
      items: [
        {
          clientId: 'account-a-client',
          fileKey: '2026/06/17/native-account-a-image',
          previewUrl:
            'http://127.0.0.1:49394/resources/mobile/received/preview?fileKey=native-account-a-image',
          thumbnailUrl:
            'http://127.0.0.1:49394/resources/mobile/received/thumbnail?fileKey=native-account-a-image',
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://192.168.10.20:39394/resources/mobile/received?clientId=client-001&clientName=Alice%20iPhone&page=1&pageSize=20',
    );
    expect(mockedListGlobalReceivedFiles).toHaveBeenCalledTimes(1);
    expect(mockedListReceivedFiles).not.toHaveBeenCalled();
  });

  it('requests current-client global library pages over direct HTTP on iOS before native', async () => {
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
            fileKey: '2026/06/17/ios-page-image',
            filename: 'IMG_IOS_PAGE.JPG',
            mediaType: 'image',
            fileSize: 4096,
            completedAt: '2026-06-16T08:00:00.000Z',
            shareStatus: 'not_shared',
          },
        ],
        page: 1,
        pageSize: 20,
        totalItems: 41,
        totalBytes: 8388608,
        deviceStats: [],
      }),
    });

    await expect(
      listCurrentClientReceivedLibraryPage(
        { host: '192.168.10.20', port: 39394 },
        { page: 1, pageSize: 20 },
      ),
    ).resolves.toMatchObject({
      page: 1,
      pageSize: 20,
      totalItems: 41,
      items: [
        {
          fileKey: '2026/06/17/ios-page-image',
          thumbnailUrl:
            'http://192.168.10.20:39394/resources/mobile/received/thumbnail?clientId=client-001&clientName=Alice%20iPhone&fileKey=2026%2F06%2F17%2Fios-page-image',
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://192.168.10.20:39394/resources/mobile/received?clientId=client-001&clientName=Alice%20iPhone&scope=client&page=1&pageSize=20',
    );
    expect(mockedListReceivedFiles).not.toHaveBeenCalled();
  });

  it('falls back to the native received library when direct HTTP fails', async () => {
    setPlatformOS('android');
    fetchMock.mockRejectedValueOnce(new Error('LAN route unavailable'));
    mockedListReceivedFiles.mockResolvedValueOnce([
      {
        resourceId: '',
        desktopDeviceId: 'desktop-001',
        clientId: 'client-001',
        displayName: 'Alice iPhone',
        fileKey: '2026/06/17/native-image',
        filename: 'IMG_NATIVE.JPG',
        mediaType: 'image',
        fileSize: 2048,
        completedAt: '2026-06-16T08:00:00.000Z',
        shareStatus: 'not_shared',
        previewUrl:
          'http://127.0.0.1:49394/resources/mobile/received/preview?fileKey=native-image',
        thumbnailUrl:
          'http://127.0.0.1:49394/resources/mobile/received/thumbnail?fileKey=native-image',
      },
    ]);

    await expect(
      listCurrentClientReceivedLibrary({ host: '192.168.10.20', port: 39394 }),
    ).resolves.toMatchObject([
      {
        fileKey: '2026/06/17/native-image',
        previewUrl:
          'http://127.0.0.1:49394/resources/mobile/received/preview?fileKey=native-image',
        thumbnailUrl:
          'http://127.0.0.1:49394/resources/mobile/received/thumbnail?fileKey=native-image',
      },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockedListReceivedFiles).toHaveBeenCalledTimes(1);
  });

  it('propagates native received listing route failures after direct HTTP fails', async () => {
    setPlatformOS('android');
    fetchMock.mockRejectedValueOnce(new Error('LAN route unavailable'));
    const routeError = new Error('Shared files route unavailable');
    mockedListReceivedFiles.mockRejectedValueOnce(routeError);

    await expect(
      listCurrentClientReceivedLibrary({ host: '192.168.10.20', port: 39394 }),
    ).rejects.toBe(routeError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockedListReceivedFiles).toHaveBeenCalledTimes(1);
  });

  it('keeps native received media urls when direct HTTP falls back to native listing', async () => {
    setPlatformOS('android');
    fetchMock.mockRejectedValueOnce(new Error('LAN route unavailable'));
    mockedListReceivedFiles.mockResolvedValueOnce([
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
        previewUrl:
          'http://127.0.0.1:49394/resources/mobile/received/preview?fileKey=image-key',
        thumbnailUrl:
          'http://127.0.0.1:49394/resources/mobile/received/thumbnail?fileKey=image-key',
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
        previewUrl:
          'http://127.0.0.1:49394/resources/mobile/received/preview?fileKey=video-key',
        streamUrl:
          'http://127.0.0.1:49394/resources/mobile/received/stream?fileKey=video-key',
      },
    ]);

    await expect(
      listCurrentClientReceivedLibrary({ host: '192.168.10.20', port: 39394 }),
    ).resolves.toMatchObject([
      {
        fileKey: '2026/06/17/image-key',
        previewUrl:
          'http://127.0.0.1:49394/resources/mobile/received/preview?fileKey=image-key',
        thumbnailUrl:
          'http://127.0.0.1:49394/resources/mobile/received/thumbnail?fileKey=image-key',
      },
      {
        fileKey: '2026/06/17/video-key',
        previewUrl:
          'http://127.0.0.1:49394/resources/mobile/received/preview?fileKey=video-key',
        streamUrl:
          'http://127.0.0.1:49394/resources/mobile/received/stream?fileKey=video-key',
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockedListReceivedFiles).toHaveBeenCalledTimes(1);
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
    mockedGetReceivedFilePreviewUrl.mockResolvedValueOnce(
      'http://127.0.0.1:49394/resources/mobile/received/preview?fileKey=client-001-photo',
    );
    mockedDownloadReceivedFile.mockResolvedValueOnce({
      savedToPhotos: false,
      localPath: '/cache/notes.pdf',
    });

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

    await expect(
      getReceivedLibraryPreviewUrl(desktop, imageItem),
    ).resolves.toBe(
      'http://127.0.0.1:49394/resources/mobile/received/preview?fileKey=client-001-photo',
    );
    await expect(prepareReceivedLibraryPreview(desktop, docItem)).resolves.toBe(
      '/cache/notes.pdf',
    );

    expect(mockedGetReceivedFilePreviewUrl).toHaveBeenCalledWith(
      '2026/06/17/client-001-photo',
      'preview',
    );
    expect(mockedDownloadReceivedFile).toHaveBeenCalledWith(
      'client-001-doc',
      'notes.pdf',
      'document',
    );
    expect(mockDownloadUrlToShareCache).not.toHaveBeenCalled();
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
          name: 'clip.mov',
          path: 'clip.mov',
          type: 'video',
          size: 12,
          modifiedAt: '2026-06-17T08:01:00.000Z',
          streamUrl: 'http://127.0.0.1:39394/personal/stream/clip.mov',
        },
        {
          name: 'cover.jpg',
          path: 'cover.jpg',
          type: 'image',
          size: 2048,
          modifiedAt: '2026-06-17T08:02:00.000Z',
          thumbnailUrl:
            'http://192.168.1.100:39394/personal/thumbnail/cover.jpg?v=2048-1780000',
        },
        {
          name: 'walkthrough.mov',
          path: 'walkthrough.mov',
          type: 'video',
          size: 4096,
          modifiedAt: '2026-06-17T08:03:00.000Z',
          thumbnailUrl:
            'http://192.168.1.100:39394/personal/thumbnail/walkthrough.mov?v=4096-1780000',
          streamUrl:
            'http://192.168.1.100:39394/personal/stream/walkthrough.mov',
        },
      ],
      totalCount: 4,
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
        resourceId: 'personal-dir:clip.mov',
        desktopDeviceId: 'personal-dir',
        kind: 'shared_file',
        displayName: 'clip.mov',
        status: 'available',
        fileSize: 12,
        mediaType: 'video',
        addedAt: '2026-06-17T08:01:00.000Z',
        downloadCount: 0,
        previewUrl: 'http://127.0.0.1:39394/personal/stream/clip.mov',
        streamUrl: 'http://127.0.0.1:39394/personal/stream/clip.mov',
      },
      {
        resourceId: 'personal-dir:cover.jpg',
        desktopDeviceId: 'personal-dir',
        kind: 'shared_file',
        displayName: 'cover.jpg',
        status: 'available',
        fileSize: 2048,
        mediaType: 'image',
        thumbnailUrl:
          'http://192.168.1.100:39394/personal/thumbnail/cover.jpg?v=2048-1780000',
        addedAt: '2026-06-17T08:02:00.000Z',
        downloadCount: 0,
      },
      {
        resourceId: 'personal-dir:walkthrough.mov',
        desktopDeviceId: 'personal-dir',
        kind: 'shared_file',
        displayName: 'walkthrough.mov',
        status: 'available',
        fileSize: 4096,
        mediaType: 'video',
        thumbnailUrl:
          'http://192.168.1.100:39394/personal/thumbnail/walkthrough.mov?v=4096-1780000',
        previewUrl:
          'http://192.168.1.100:39394/personal/stream/walkthrough.mov',
        streamUrl:
          'http://192.168.1.100:39394/personal/stream/walkthrough.mov',
        addedAt: '2026-06-17T08:03:00.000Z',
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
      listGlobalRemoteAccessFolderContents('personal-dir:Desktop', 'Projects'),
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
    ).resolves.toBe('http://127.0.0.1:39394/personal/stream/Desktop/notes.txt');
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
      'notes.txt',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('normalizes global remote access media-store downloads as saved to photos', async () => {
    mockedDownloadDirectoryFile.mockResolvedValueOnce({
      savedToPhotos: false,
      localPath: null,
      savedLocation: 'Movies/Vivi Drop',
    });

    await expect(
      downloadGlobalRemoteAccessResource('personal-dir:Projects/video.mov'),
    ).resolves.toEqual({
      savedToPhotos: true,
      localPath: null,
      savedLocation: 'Movies/Vivi Drop',
    });
  });

  it('prepares global remote access share files through the native share cache', async () => {
    mockedGetDirectoryFileStreamUrl.mockResolvedValueOnce(
      'http://127.0.0.1:39394/personal/stream/protoc-gen-go',
    );
    mockDownloadUrlToShareCache.mockResolvedValueOnce(
      '/share-cache/protoc-gen-go',
    );

    await expect(
      prepareGlobalRemoteAccessShareFile(
        'personal-dir:protoc-gen-go',
        'protoc-gen-go',
      ),
    ).resolves.toBe('/share-cache/protoc-gen-go');

    expect(mockedGetDirectoryFileStreamUrl).toHaveBeenCalledWith(
      'personal',
      'protoc-gen-go',
    );
    expect(mockDownloadUrlToShareCache).toHaveBeenCalledWith(
      'http://127.0.0.1:39394/personal/stream/protoc-gen-go',
      'protoc-gen-go',
    );
    expect(mockedDownloadDirectoryFile).not.toHaveBeenCalled();
    expect(mockedPrepareDirectoryFilePreview).not.toHaveBeenCalled();
  });

  it('shares global remote access files through the native share cache', async () => {
    mockedGetDirectoryFileStreamUrl
      .mockResolvedValueOnce(
        'http://127.0.0.1:39394/personal/stream/Pictures/photo.jpg',
      )
      .mockResolvedValueOnce(
        'http://127.0.0.1:39394/personal/stream/Documents/report.pdf',
      );
    mockDownloadUrlToShareCache
      .mockResolvedValueOnce('/share-cache/photo.jpg')
      .mockResolvedValueOnce('/share-cache/report.pdf');
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

    expect(mockedGetDirectoryFileStreamUrl).toHaveBeenNthCalledWith(
      1,
      'personal',
      'Pictures/photo.jpg',
    );
    expect(mockedGetDirectoryFileStreamUrl).toHaveBeenNthCalledWith(
      2,
      'personal',
      'Documents/report.pdf',
    );
    expect(mockDownloadUrlToShareCache).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:39394/personal/stream/Pictures/photo.jpg',
      'photo.jpg',
    );
    expect(mockDownloadUrlToShareCache).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:39394/personal/stream/Documents/report.pdf',
      'report.pdf',
    );
    expect(mockedDownloadDirectoryFile).not.toHaveBeenCalled();
    expect(mockedPrepareDirectoryFilePreview).not.toHaveBeenCalled();
    expect(mockShareFiles).toHaveBeenCalledWith([
      '/share-cache/photo.jpg',
      '/share-cache/report.pdf',
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
