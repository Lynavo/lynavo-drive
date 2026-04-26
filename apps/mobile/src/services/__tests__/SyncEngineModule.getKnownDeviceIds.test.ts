const mockGetKnownDeviceIds = jest.fn();

jest.mock('react-native', () => ({
  NativeModules: {
    NativeSyncEngine: {
      getKnownDeviceIds: (...args: unknown[]) => mockGetKnownDeviceIds(...args),
    },
  },
}));

import { getKnownDeviceIds } from '../SyncEngineModule';

afterEach(() => {
  jest.clearAllMocks();
});

describe('getKnownDeviceIds', () => {
  it('returns array of server ids from native', async () => {
    mockGetKnownDeviceIds.mockResolvedValueOnce(['device-abc', 'device-xyz']);
    const result = await getKnownDeviceIds();
    expect(result).toEqual(['device-abc', 'device-xyz']);
    expect(mockGetKnownDeviceIds).toHaveBeenCalledTimes(1);
  });

  it('returns empty array when native returns empty', async () => {
    mockGetKnownDeviceIds.mockResolvedValueOnce([]);
    const result = await getKnownDeviceIds();
    expect(result).toEqual([]);
  });

  it('returns empty array when native returns null', async () => {
    mockGetKnownDeviceIds.mockResolvedValueOnce(null);
    const result = await getKnownDeviceIds();
    expect(result).toEqual([]);
  });
});
