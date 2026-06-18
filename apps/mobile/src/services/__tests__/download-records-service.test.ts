import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  clearDownloadRecords,
  DOWNLOAD_RECORDS_STORAGE_KEY,
  listDownloadRecords,
  recordDownloadedFile,
} from '../download-records-service';
import { clearUserScopedStorage } from '../../utils/clearUserScopedStorage';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
    getAllKeys: jest.fn(),
    multiRemove: jest.fn(),
  },
}));

const mockedAsyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

describe('download-records-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-16T08:30:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('stores downloaded files newest first without mixing sync history', async () => {
    mockedAsyncStorage.getItem.mockResolvedValueOnce(
      JSON.stringify([
        {
          id: 'old-resource',
          resourceId: 'old-resource',
          filename: 'Old.pdf',
          fileSize: 1024,
          mediaType: 'document',
          downloadedAt: '2026-06-15T08:00:00.000Z',
        },
      ]),
    );

    const record = await recordDownloadedFile({
      resourceId: 'real-resource-1',
      filename: 'Real Report.pdf',
      fileSize: 2048,
      mediaType: 'document',
      localPath: '/local/Real Report.pdf',
      savedToPhotos: true,
    });

    expect(record).toMatchObject({
      id: 'real-resource-1',
      filename: 'Real Report.pdf',
      downloadedAt: '2026-06-16T08:30:00.000Z',
    });
    expect(mockedAsyncStorage.setItem).toHaveBeenCalledWith(
      'syncflow:download-records:v1',
      JSON.stringify([
        record,
        {
          id: 'old-resource',
          resourceId: 'old-resource',
          filename: 'Old.pdf',
          fileSize: 1024,
          mediaType: 'document',
          downloadedAt: '2026-06-15T08:00:00.000Z',
        },
      ]),
    );
  });

  it('reads stored download records and ignores invalid cache payloads', async () => {
    mockedAsyncStorage.getItem.mockResolvedValueOnce('not-json');

    await expect(listDownloadRecords()).resolves.toEqual([]);
  });

  it('normalizes legacy mock download paths to null before persistence', async () => {
    mockedAsyncStorage.getItem.mockResolvedValueOnce('[]');

    const record = await recordDownloadedFile({
      resourceId: 'legacy-mock-resource',
      filename: 'Legacy Mock.pdf',
      localPath: '/mock/path/legacy-mock-resource',
      savedToPhotos: false,
    });

    expect(record.localPath).toBeNull();
    expect(mockedAsyncStorage.setItem).toHaveBeenCalledWith(
      'syncflow:download-records:v1',
      JSON.stringify([record]),
    );
  });

  it('stores normalized preview fields for downloaded files', async () => {
    mockedAsyncStorage.getItem.mockResolvedValueOnce('[]');

    const record = await recordDownloadedFile({
      resourceId: 'preview-resource',
      filename: 'Preview.mov',
      mediaType: 'video/quicktime',
      thumbnailUrl: ' https://desktop.local/thumb.jpg ',
      previewUrl: ' https://desktop.local/preview.mov ',
      streamUrl: ' https://desktop.local/stream.mov ',
      localPath: ' /tmp/Preview.mov ',
    });

    expect(record).toMatchObject({
      thumbnailUrl: 'https://desktop.local/thumb.jpg',
      previewUrl: 'https://desktop.local/preview.mov',
      streamUrl: 'https://desktop.local/stream.mov',
      localPath: '/tmp/Preview.mov',
    });
    expect(mockedAsyncStorage.setItem).toHaveBeenCalledWith(
      'syncflow:download-records:v1',
      JSON.stringify([record]),
    );
  });

  it('normalizes legacy mock download paths when reading stored records', async () => {
    mockedAsyncStorage.getItem.mockResolvedValueOnce(
      JSON.stringify([
        {
          id: 'legacy-mock-resource',
          resourceId: 'legacy-mock-resource',
          filename: 'Legacy Mock.pdf',
          downloadedAt: '2026-06-16T08:30:00.000Z',
          localPath: '/mock/path/legacy-mock-resource',
        },
      ]),
    );

    await expect(listDownloadRecords()).resolves.toEqual([
      {
        id: 'legacy-mock-resource',
        resourceId: 'legacy-mock-resource',
        filename: 'Legacy Mock.pdf',
        downloadedAt: '2026-06-16T08:30:00.000Z',
        localPath: null,
      },
    ]);
  });

  it('keeps legacy records readable when preview fields are missing', async () => {
    mockedAsyncStorage.getItem.mockResolvedValueOnce(
      JSON.stringify([
        {
          id: 'legacy-resource',
          resourceId: 'legacy-resource',
          filename: 'Legacy.pdf',
          downloadedAt: '2026-06-16T08:30:00.000Z',
        },
      ]),
    );

    await expect(listDownloadRecords()).resolves.toEqual([
      {
        id: 'legacy-resource',
        resourceId: 'legacy-resource',
        filename: 'Legacy.pdf',
        downloadedAt: '2026-06-16T08:30:00.000Z',
      },
    ]);
  });

  it('clears persisted download records', async () => {
    await clearDownloadRecords();

    expect(mockedAsyncStorage.removeItem).toHaveBeenCalledWith(
      DOWNLOAD_RECORDS_STORAGE_KEY,
    );
  });

  it('clears download records during user-scoped cleanup', async () => {
    mockedAsyncStorage.getAllKeys.mockResolvedValueOnce([
      'unrelated-key',
      DOWNLOAD_RECORDS_STORAGE_KEY,
    ]);

    await clearUserScopedStorage();

    expect(mockedAsyncStorage.multiRemove).toHaveBeenCalledWith([
      DOWNLOAD_RECORDS_STORAGE_KEY,
    ]);
    expect(mockedAsyncStorage.removeItem).not.toHaveBeenCalled();
  });
});
