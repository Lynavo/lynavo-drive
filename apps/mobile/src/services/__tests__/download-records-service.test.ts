import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  clearDownloadRecords,
  DOWNLOAD_RECORDS_STORAGE_KEY,
  isPersonalDirRecord,
  listDownloadRecords,
  recordDownloadedFile,
} from '../download-records-service';
import { recordDiagnosticsLog } from '../diagnostics-log-service';

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

jest.mock('../diagnostics-log-service', () => ({
  recordDiagnosticsLog: jest.fn(),
}));

const mockedAsyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
const mockedRecordDiagnosticsLog = recordDiagnosticsLog as jest.Mock;

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
      'lynavo-drive:download-records:v1',
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
      'lynavo-drive:download-records:v1',
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
      'lynavo-drive:download-records:v1',
      JSON.stringify([record]),
    );
  });

  it('records diagnostic details for persisted download preview sources', async () => {
    mockedAsyncStorage.getItem.mockResolvedValueOnce('[]');

    await recordDownloadedFile({
      resourceId: 'photo-resource',
      filename: 'Photo.jpg',
      mediaType: 'image/jpeg',
      thumbnailUrl: ' https://desktop.local/thumb.jpg ',
      previewUrl: ' https://desktop.local/preview.jpg ',
      streamUrl: ' https://desktop.local/stream.jpg ',
      localPath: null,
      savedToPhotos: true,
    });

    expect(mockedRecordDiagnosticsLog).toHaveBeenCalledWith(
      'DownloadRecords',
      'record persisted',
      expect.objectContaining({
        resourceId: 'photo-resource',
        filename: 'Photo.jpg',
        mediaType: 'image/jpeg',
        savedToPhotos: true,
        hasLocalPath: false,
        hasThumbnailUrl: true,
        hasPreviewUrl: true,
        hasStreamUrl: true,
      }),
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

  it('strips signed URLs from personal-dir records before persistence', async () => {
    mockedAsyncStorage.getItem.mockResolvedValueOnce('[]');

    const record = await recordDownloadedFile({
      resourceId: 'personal-dir:Desktop/photo.jpg',
      filename: 'photo.jpg',
      mediaType: 'image/jpeg',
      thumbnailUrl:
        'http://172.16.20.108:39394/personal/thumbnail/Desktop/photo.jpg?v=1&X-LynavoDrive-Auth=abc&X-LynavoDrive-Auth-Timestamp=2026-06-24T06:48:27.303Z&X-LynavoDrive-Auth-Nonce=xyz',
      previewUrl:
        'http://172.16.20.108:39394/personal/stream/Desktop/photo.jpg?access_token=tok&X-LynavoDrive-Auth=abc&X-LynavoDrive-Auth-Timestamp=2026-06-24T06:48:27.303Z&X-LynavoDrive-Auth-Nonce=xyz',
      streamUrl:
        'http://172.16.20.108:39394/personal/stream/Desktop/photo.jpg?access_token=tok&X-LynavoDrive-Auth=abc&X-LynavoDrive-Auth-Timestamp=2026-06-24T06:48:27.303Z&X-LynavoDrive-Auth-Nonce=xyz',
      localPath: '/var/mobile/Containers/photo.jpg',
      savedToPhotos: true,
    });

    expect(record.thumbnailUrl).toBeUndefined();
    expect(record.previewUrl).toBeUndefined();
    expect(record.streamUrl).toBeUndefined();
    expect(record.localPath).toBe('/var/mobile/Containers/photo.jpg');
    expect(mockedAsyncStorage.setItem).toHaveBeenCalledWith(
      DOWNLOAD_RECORDS_STORAGE_KEY,
      JSON.stringify([record]),
    );
  });

  it('strips signed URLs from existing personal-dir records when reading from storage', async () => {
    mockedAsyncStorage.getItem.mockResolvedValueOnce(
      JSON.stringify([
        {
          id: 'personal-dir:Desktop/old.jpg',
          resourceId: 'personal-dir:Desktop/old.jpg',
          filename: 'old.jpg',
          downloadedAt: '2026-06-24T06:48:27.303Z',
          thumbnailUrl:
            'http://172.16.20.108:39394/personal/thumbnail/Desktop/old.jpg?v=1&X-LynavoDrive-Auth=stale',
          previewUrl:
            'http://172.16.20.108:39394/personal/stream/Desktop/old.jpg?access_token=tok&X-LynavoDrive-Auth=stale',
          streamUrl:
            'http://172.16.20.108:39394/personal/stream/Desktop/old.jpg?access_token=tok&X-LynavoDrive-Auth=stale',
          localPath: '/var/mobile/Containers/old.jpg',
        },
      ]),
    );

    const records = await listDownloadRecords();

    expect(records).toHaveLength(1);
    expect(records[0].thumbnailUrl).toBeUndefined();
    expect(records[0].previewUrl).toBeUndefined();
    expect(records[0].streamUrl).toBeUndefined();
    expect(records[0].localPath).toBe('/var/mobile/Containers/old.jpg');
  });

  describe('isPersonalDirRecord', () => {
    it('returns true for personal-dir: prefixed resourceIds', () => {
      expect(isPersonalDirRecord('personal-dir:Desktop/photo.jpg')).toBe(true);
      expect(isPersonalDirRecord('personal-dir:')).toBe(true);
    });

    it('returns false for non personal-dir resourceIds', () => {
      expect(
        isPersonalDirRecord(
          'abfd5c9298dd380a1442009f6685277b94d33a6e95817354b74d8de2a5ea4cf8',
        ),
      ).toBe(false);
      expect(isPersonalDirRecord('shared-dir:Documents')).toBe(false);
      expect(isPersonalDirRecord('')).toBe(false);
    });
  });
});
