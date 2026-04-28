const mockGetAutoUploadConfig = jest.fn();
const mockResumeAutoUpload = jest.fn();
const mockDisableAutoUpload = jest.fn();
const mockGetAlbumStats = jest.fn();
const mockAsyncStorageGetItem = jest.fn();
const mockAsyncStorageSetItem = jest.fn();
const mockAsyncStorageRemoveItem = jest.fn();

jest.mock('react-native', () => ({
  NativeModules: {
    NativeSyncEngine: {
      getAutoUploadConfig: (...args: unknown[]) =>
        mockGetAutoUploadConfig(...args),
      resumeAutoUpload: (...args: unknown[]) => mockResumeAutoUpload(...args),
      disableAutoUpload: (...args: unknown[]) => mockDisableAutoUpload(...args),
      getAlbumStats: (...args: unknown[]) => mockGetAlbumStats(...args),
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
    mockGetAutoUploadConfig.mockResolvedValue({
      enabled: false,
      state: 'disabled',
      timeRangeMode: 'all',
    });
    mockResumeAutoUpload.mockResolvedValue(undefined);
    mockDisableAutoUpload.mockResolvedValue(undefined);
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

  it('still resolves disable when baseline cleanup fails after native disables', async () => {
    mockAsyncStorageRemoveItem.mockRejectedValueOnce(new Error('storage down'));

    await expect(disableAutoUpload()).resolves.toBeUndefined();

    expect(mockDisableAutoUpload).toHaveBeenCalledTimes(1);
  });
});
