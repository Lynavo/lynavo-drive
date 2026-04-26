// Mock AsyncStorage with an in-memory map so we can assert exactly which
// keys were removed by the util. Real AsyncStorage is unavailable under
// jest-node anyway.
const mockStore = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getAllKeys: jest.fn(async () => Array.from(mockStore.keys())),
    multiRemove: jest.fn(async (keys: string[]) => {
      for (const k of keys) mockStore.delete(k);
    }),
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearUserScopedStorage } from '../clearUserScopedStorage';

describe('clearUserScopedStorage', () => {
  beforeEach(() => {
    mockStore.clear();
    jest.clearAllMocks();
  });

  test('removes every @vividrop/reminder-shown/* key', async () => {
    mockStore.set('@vividrop/reminder-shown/2026-04-17/warn7', '1');
    mockStore.set('@vividrop/reminder-shown/2026-04-18/warnToday', '1');
    mockStore.set('@vividrop/reminder-shown/2026-04-18/expired', '1');

    await clearUserScopedStorage();

    expect(AsyncStorage.multiRemove).toHaveBeenCalledTimes(1);
    expect(mockStore.size).toBe(0);
  });

  test('leaves unrelated keys intact', async () => {
    mockStore.set('@vividrop/reminder-shown/2026-04-17/warn7', '1');
    mockStore.set('@vividrop/debug/api_base_url', 'https://staging.example.com');
    mockStore.set('@vividrop/auth/access_token', 'legacy');
    mockStore.set('random-unrelated', 'keep-me');

    await clearUserScopedStorage();

    expect(mockStore.has('@vividrop/reminder-shown/2026-04-17/warn7')).toBe(false);
    expect(mockStore.get('@vividrop/debug/api_base_url')).toBe('https://staging.example.com');
    expect(mockStore.get('@vividrop/auth/access_token')).toBe('legacy');
    expect(mockStore.get('random-unrelated')).toBe('keep-me');
  });

  test('no-op when no reminder keys exist', async () => {
    mockStore.set('unrelated', 'x');

    await clearUserScopedStorage();

    // When the filter produces an empty list we should skip the multiRemove
    // round-trip entirely — avoids an unnecessary native bridge call.
    expect(AsyncStorage.multiRemove).not.toHaveBeenCalled();
    expect(mockStore.size).toBe(1);
  });

  test('propagates getAllKeys errors as a rejection (so callers can await)', async () => {
    (AsyncStorage.getAllKeys as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    await expect(clearUserScopedStorage()).rejects.toThrow('boom');
  });
});
