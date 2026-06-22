// Keep a NativeSyncEngine mock here to prove this compatibility shim never
// inspects the desktop binding during mobile logout/account switching.
const mockGetBindingState = jest.fn();

jest.mock('react-native', () => ({
  NativeModules: {
    NativeSyncEngine: {
      getBindingState: (...args: unknown[]) => mockGetBindingState(...args),
    },
  },
}));

import { resetCurrentDesktopSidecarIfReachable } from '../sidecar-reset-service';

const originalFetch = globalThis.fetch;

describe('resetCurrentDesktopSidecarIfReachable', () => {
  let fetchMock: jest.Mock;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    mockGetBindingState.mockReset();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    warnSpy.mockRestore();
  });

  test('does not reset desktop sidecar when a binding host is available', async () => {
    mockGetBindingState.mockResolvedValueOnce({
      deviceId: 'mac-1',
      host: '192.168.1.42',
      port: 39393,
    });

    await resetCurrentDesktopSidecarIfReachable();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockGetBindingState).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('does not inspect binding when no desktop reset is needed', async () => {
    mockGetBindingState.mockResolvedValueOnce(null);

    await resetCurrentDesktopSidecarIfReachable();

    expect(mockGetBindingState).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('accepts legacy timeout option without contacting desktop', async () => {
    await expect(
      resetCurrentDesktopSidecarIfReachable({ timeoutMs: 10 }),
    ).resolves.toBeUndefined();
    expect(mockGetBindingState).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
