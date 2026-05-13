const mockGetAutoUploadConfig = jest.fn();
const mockResumeAutoUpload = jest.fn();
const mockDisableAutoUpload = jest.fn();
const mockGetAlbumStats = jest.fn();
const mockRequestPhotoPermission = jest.fn();
const mockAsyncStorageGetItem = jest.fn();
const mockAsyncStorageSetItem = jest.fn();
const mockAsyncStorageRemoveItem = jest.fn();
let mockPlatformOS = 'ios';

jest.mock('react-native', () => ({
  Platform: {
    get OS() {
      return mockPlatformOS;
    },
  },
  NativeModules: {
    NativeSyncEngine: {
      getAutoUploadConfig: (...args: unknown[]) =>
        mockGetAutoUploadConfig(...args),
      resumeAutoUpload: (...args: unknown[]) => mockResumeAutoUpload(...args),
      disableAutoUpload: (...args: unknown[]) => mockDisableAutoUpload(...args),
      getAlbumStats: (...args: unknown[]) => mockGetAlbumStats(...args),
      requestPhotoPermission: (...args: unknown[]) =>
        mockRequestPhotoPermission(...args),
    },
  },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: (...args: unknown[]) => mockAsyncStorageGetItem(...args),
    setItem: (...args: unknown[]) => mockAsyncStorageSetItem(...args),
    removeItem: (...args: unknown[]) => mockAsyncStorageRemoveItem(...args),
  },
}));

import {
  clearAutoUploadSessionForTest,
  clearRememberedAutoUploadRoundProgressForTest,
} from '../../utils/autoUploadRoundProgress';
import { disableAutoUpload, enableAutoUpload } from '../SyncEngineModule';

describe('SyncEngineModule auto upload session baseline', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockPlatformOS = 'ios';
    mockGetAutoUploadConfig.mockResolvedValue({
      enabled: false,
      state: 'disabled',
      timeRangeMode: 'all',
    });
    mockResumeAutoUpload.mockResolvedValue(undefined);
    mockDisableAutoUpload.mockResolvedValue(undefined);
    mockRequestPhotoPermission.mockResolvedValue('granted');
    mockGetAlbumStats.mockResolvedValue({
      totalCount: 10,
      transferredCount: 4,
      queuedCount: 0,
      pendingCount: 6,
    });
    mockAsyncStorageGetItem.mockResolvedValue(null);
    mockAsyncStorageSetItem.mockResolvedValue(undefined);
    mockAsyncStorageRemoveItem.mockResolvedValue(undefined);
    await clearAutoUploadSessionForTest();
    clearRememberedAutoUploadRoundProgressForTest();
    jest.clearAllMocks();
  });

  it('still enables native auto upload when baseline persistence fails', async () => {
    mockAsyncStorageSetItem.mockRejectedValueOnce(new Error('disk full'));

    await expect(enableAutoUpload()).resolves.toBeUndefined();

    expect(mockResumeAutoUpload).toHaveBeenCalledTimes(1);
  });

  it('still enables native auto upload when config read fails', async () => {
    mockGetAutoUploadConfig.mockRejectedValueOnce(new Error('config busy'));

    await expect(enableAutoUpload()).resolves.toBeUndefined();

    expect(mockResumeAutoUpload).toHaveBeenCalledTimes(1);
  });

  it('requests Android photo permission before enabling native auto upload', async () => {
    mockPlatformOS = 'android';

    await expect(enableAutoUpload()).resolves.toBeUndefined();

    expect(mockRequestPhotoPermission).toHaveBeenCalledTimes(1);
    expect(mockResumeAutoUpload).toHaveBeenCalledTimes(1);
    expect(mockRequestPhotoPermission.mock.invocationCallOrder[0]).toBeLessThan(
      mockResumeAutoUpload.mock.invocationCallOrder[0],
    );
  });

  it('does not enable native auto upload when Android photo permission is denied', async () => {
    mockPlatformOS = 'android';
    mockRequestPhotoPermission.mockResolvedValueOnce('denied');

    await expect(enableAutoUpload()).rejects.toThrow(
      'Android photo library access is required for auto upload',
    );

    expect(mockResumeAutoUpload).not.toHaveBeenCalled();
  });

  it('still resolves disable when baseline cleanup fails after native disables', async () => {
    mockAsyncStorageRemoveItem.mockRejectedValueOnce(new Error('storage down'));

    await expect(disableAutoUpload()).resolves.toBeUndefined();

    expect(mockDisableAutoUpload).toHaveBeenCalledTimes(1);
  });
});
