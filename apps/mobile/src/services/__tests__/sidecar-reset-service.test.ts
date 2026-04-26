// Mock NativeModules.NativeSyncEngine so the service can read the current
// binding without a live bridge. We control getBindingState per-test.
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

  test('POSTs to sidecar reset endpoint when a binding host is available', async () => {
    mockGetBindingState.mockResolvedValueOnce({
      deviceId: 'mac-1',
      host: '192.168.1.42',
      port: 39393,
    });
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });

    await resetCurrentDesktopSidecarIfReachable();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://192.168.1.42:39394/settings/reset-state');
    expect(init.method).toBe('POST');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('skips fetch entirely when no binding exists', async () => {
    mockGetBindingState.mockResolvedValueOnce(null);

    await resetCurrentDesktopSidecarIfReachable();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('skips fetch when binding has no host field', async () => {
    mockGetBindingState.mockResolvedValueOnce({ deviceId: 'mac-1', port: 39393 });

    await resetCurrentDesktopSidecarIfReachable();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('resolves (not rejects) when fetch throws — best-effort semantics', async () => {
    mockGetBindingState.mockResolvedValueOnce({ host: '10.0.0.5', port: 39393 });
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(resetCurrentDesktopSidecarIfReachable()).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });

  test('resolves when sidecar responds non-2xx — logs but does not throw', async () => {
    mockGetBindingState.mockResolvedValueOnce({ host: '10.0.0.5', port: 39393 });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });

    await expect(resetCurrentDesktopSidecarIfReachable()).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });

  test('aborts after timeoutMs and resolves (best-effort)', async () => {
    mockGetBindingState.mockResolvedValueOnce({ host: '10.0.0.5', port: 39393 });
    // Fetch that rejects when its AbortSignal fires, mirroring real semantics.
    fetchMock.mockImplementationOnce(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            const err = new Error('aborted');
            (err as Error & { name: string }).name = 'AbortError';
            reject(err);
          });
        }),
    );

    await expect(
      resetCurrentDesktopSidecarIfReachable({ timeoutMs: 10 }),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });

  test('resolves when getBindingState itself rejects (e.g., bridge tear-down)', async () => {
    mockGetBindingState.mockRejectedValueOnce(new Error('bridge invalidated'));

    await expect(resetCurrentDesktopSidecarIfReachable()).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });
});
