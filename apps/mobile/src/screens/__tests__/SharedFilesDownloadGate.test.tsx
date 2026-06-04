import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { Alert, NativeModules, NativeEventEmitter } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Must mock react-native-localize before i18n import
jest.mock('react-native-localize', () => ({
  getLocales: () => [
    {
      languageCode: 'en',
      countryCode: 'US',
      languageTag: 'en-US',
      isRTL: false,
    },
  ],
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../components/Icon', () => ({
  Icon: ({ name }: { name: string }) => {
    const ReactInner = require('react');
    const { Text: MockText } = require('react-native');
    return ReactInner.createElement(MockText, null, name);
  },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));

jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
  resetGenericPassword: jest.fn(),
}));

jest.mock('../../constants/features', () => ({
  FEATURES: { SUBSCRIPTION_ENFORCEMENT: true },
}));

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
}));

// Declared after jest.mock hoisting; assigned via module-level var reference.
// The `mock` prefix satisfies babel-jest's hoisting safety rule.
const mockNavigate = jest.fn();

jest.mock('../../stores/auth-store', () => {
  const actual = jest.requireActual('../../stores/auth-store');
  return {
    ...actual,
    useAuth: jest.fn(),
  };
});

// Mock NativeEventEmitter to avoid "not a native module" errors
jest.mock('react-native/Libraries/EventEmitter/NativeEventEmitter');

// Mock SyncEngineModule — browseSharedFiles returns one file so the list
// renders and the download button with testID is visible.
const mockBrowseSharedFiles = jest.fn();
const mockDownloadSharedFile = jest.fn();
const mockGetSharedFileStreamUrl = jest.fn();

jest.mock('../../services/SyncEngineModule', () => ({
  browseSharedFiles: (...args: unknown[]) => mockBrowseSharedFiles(...args),
  downloadSharedFile: (...args: unknown[]) => mockDownloadSharedFile(...args),
  getSharedFileStreamUrl: (...args: unknown[]) => mockGetSharedFileStreamUrl(...args),
}));

import i18n from '../../i18n';
import { SharedFilesScreen } from '../SharedFilesScreen';
import { useAuth } from '../../stores/auth-store';

const alertSpy = jest.spyOn(Alert, 'alert');
const nativeListeners = new Map<string, (payload: unknown) => void>();

const FAKE_FILE = {
  name: 'photo.jpg',
  path: '/shared/photo.jpg',
  size: 1024,
  modifiedAt: '2026-06-02T03:00:00.000Z',
  type: 'image',
  isDirectory: false,
  thumbnailUrl: null,
};

const FAKE_OTHER_FILE = {
  name: 'clip.mp4',
  path: '/shared/clip.mp4',
  size: 2048,
  modifiedAt: '2026-06-02T03:05:00.000Z',
  type: 'video',
  isDirectory: false,
  thumbnailUrl: null,
};

const FAKE_FILE_DOWNLOAD_ID = JSON.stringify([
  FAKE_FILE.path,
  FAKE_FILE.size,
  FAKE_FILE.modifiedAt,
]);

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  jest.clearAllMocks();
  nativeListeners.clear();
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);

  // Set up NativeSyncEngine on NativeModules so checkDeviceAvailable passes.
  (NativeModules as Record<string, unknown>).NativeSyncEngine = {
    getBindingState: jest.fn().mockResolvedValue({
      deviceId: 'device-1',
      connectionState: 'connected',
    }),
    addListener: jest.fn(),
    removeListeners: jest.fn(),
  };

  // NativeEventEmitter mock needs addListener to return a removable sub.
  (NativeEventEmitter as jest.Mock).mockImplementation(() => ({
    addListener: jest.fn(
      (eventName: string, listener: (payload: unknown) => void) => {
        nativeListeners.set(eventName, listener);
        return {
          remove: jest.fn(() => nativeListeners.delete(eventName)),
        };
      },
    ),
  }));

  // Return one non-directory file so the FlatList renders the download button.
  mockBrowseSharedFiles.mockResolvedValue({ files: [FAKE_FILE] });
  mockDownloadSharedFile.mockResolvedValue({ savedToPhotos: true, localPath: null });

  alertSpy.mockImplementation((_t, _b, buttons) => {
    // Simulate tap on the first non-cancel button.
    const go = buttons?.find((b: { style?: string }) => b.style !== 'cancel');
    go?.onPress?.();
  });
});

describe('SharedFilesScreen download progress', () => {
  test('shows offline shared-list status without reusing connected binding state', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      subscription: { status: 'trialing' },
      loadSubscription: jest.fn(),
    });

    const { getByText, getByTestId } = render(<SharedFilesScreen />);

    await waitFor(() => getByTestId('shared-file-download-button'));

    expect(getByText('Offline')).toBeTruthy();
  });

  test('shows shared-list route status from shared files reachability', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      subscription: { status: 'trialing' },
      loadSubscription: jest.fn(),
    });

    const { getByText, getByTestId } = render(<SharedFilesScreen />);

    await waitFor(() => getByTestId('shared-file-download-button'));

    await act(async () => {
      nativeListeners.get('onSharedFilesReachabilityChanged')?.({
        deviceId: 'device-1',
        state: 'available',
        route: 'lan',
        reason: 'browse_shared_files_success',
      });
    });
    expect(getByText('LAN online')).toBeTruthy();

    await act(async () => {
      nativeListeners.get('onSharedFilesReachabilityChanged')?.({
        deviceId: 'device-1',
        state: 'available',
        route: 'tunnel',
        reason: 'browse_shared_files_success',
      });
    });
    expect(getByText('P2P online')).toBeTruthy();

    await act(async () => {
      nativeListeners.get('onSharedFilesReachabilityChanged')?.({
        deviceId: 'device-1',
        state: 'available',
        route: 'relay',
        reason: 'browse_shared_files_success',
      });
    });
    expect(getByText('Relay online')).toBeTruthy();
  });

  test('coalesces a connected binding event while the current directory load is in flight', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      subscription: { status: 'trialing' },
      loadSubscription: jest.fn(),
    });
    let resolveBrowse: (value: { files: Array<typeof FAKE_FILE> }) => void = () => undefined;
    mockBrowseSharedFiles.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveBrowse = resolve;
        }),
    );

    render(<SharedFilesScreen />);

    await waitFor(() => expect(mockBrowseSharedFiles).toHaveBeenCalledTimes(1));

    await act(async () => {
      nativeListeners.get('onBindingStateChanged')?.({
        deviceId: 'device-1',
        connectionState: 'connected',
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockBrowseSharedFiles).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveBrowse({ files: [FAKE_FILE] });
    });
  });

  test('does not reload the same path for repeated available binding events', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      subscription: { status: 'trialing' },
      loadSubscription: jest.fn(),
    });

    const { getByTestId } = render(<SharedFilesScreen />);

    await waitFor(() => getByTestId('shared-file-download-button'));
    expect(mockBrowseSharedFiles).toHaveBeenCalledTimes(1);

    await act(async () => {
      nativeListeners.get('onBindingStateChanged')?.({
        deviceId: 'device-1',
        connectionState: 'connected',
      });
      nativeListeners.get('onBindingStateChanged')?.({
        deviceId: 'device-1',
        connectionState: 'bound',
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockBrowseSharedFiles).toHaveBeenCalledTimes(1);
  });

  test('renders native download progress for the active file', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      subscription: { status: 'trialing' },
      loadSubscription: jest.fn(),
    });
    let resolveDownload: (value: { savedToPhotos: boolean; localPath: string | null }) => void =
      () => undefined;
    mockDownloadSharedFile.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDownload = resolve;
        }),
    );

    const { getByTestId, getByText } = render(<SharedFilesScreen />);

    await waitFor(() => getByTestId('shared-file-download-button'));

    await act(async () => {
      fireEvent.press(getByTestId('shared-file-download-button'));
    });
    await act(async () => {
      nativeListeners.get('onSharedFileDownloadProgress')?.({
        path: FAKE_FILE.path,
        bytesWritten: 512,
        totalBytes: 1024,
        progress: 0.5,
      });
    });

    expect(getByText('50%')).toBeTruthy();

    await act(async () => {
      resolveDownload({
        savedToPhotos: false,
        localPath: '/tmp/syncflow_shared_downloads/photo.jpg',
      });
    });
  });

  test('keeps active download visible during transient binding recovery', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      subscription: { status: 'trialing' },
      loadSubscription: jest.fn(),
    });
    mockDownloadSharedFile.mockImplementation(() => new Promise(() => undefined));

    const { getByTestId, getByText, queryByText } = render(<SharedFilesScreen />);

    await waitFor(() => getByTestId('shared-file-download-button'));

    await act(async () => {
      fireEvent.press(getByTestId('shared-file-download-button'));
    });
    await act(async () => {
      nativeListeners.get('onSharedFileDownloadProgress')?.({
        path: FAKE_FILE.path,
        bytesWritten: 512,
        totalBytes: 1024,
        progress: 0.5,
      });
    });
    await act(async () => {
      nativeListeners.get('onBindingStateChanged')?.({
        deviceId: 'device-1',
        connectionState: 'connecting',
      });
    });

    expect(queryByText('Device Unavailable')).toBeNull();
    expect(getByText('50%')).toBeTruthy();
    expect(getByTestId('shared-file-download-button')).toBeTruthy();
  });

  test('reloads files after an unavailable binding reconnects through connecting', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      subscription: { status: 'trialing' },
      loadSubscription: jest.fn(),
    });

    const { getByTestId, getByText } = render(<SharedFilesScreen />);

    await waitFor(() => getByTestId('shared-file-download-button'));
    mockBrowseSharedFiles.mockClear();

    await act(async () => {
      nativeListeners.get('onBindingStateChanged')?.({
        deviceId: 'device-1',
        connectionState: 'offline',
      });
    });
    expect(getByText('Remote unavailable')).toBeTruthy();
    expect(getByText('Failed to Load')).toBeTruthy();

    await act(async () => {
      nativeListeners.get('onBindingStateChanged')?.({
        deviceId: 'device-1',
        connectionState: 'connecting',
      });
    });
    expect(mockBrowseSharedFiles).not.toHaveBeenCalled();

    await act(async () => {
      nativeListeners.get('onBindingStateChanged')?.({
        deviceId: 'device-1',
        connectionState: 'connected',
      });
      await Promise.resolve();
    });

    await waitFor(() => expect(mockBrowseSharedFiles).toHaveBeenCalledTimes(1));
  });

  test('auto retries while unavailable when the paired device still exists', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      subscription: { status: 'trialing' },
      loadSubscription: jest.fn(),
    });

    const { getByTestId, getByText } = render(<SharedFilesScreen />);

    await waitFor(() => getByTestId('shared-file-download-button'));
    mockBrowseSharedFiles.mockClear();
    mockBrowseSharedFiles.mockResolvedValueOnce({ files: [FAKE_OTHER_FILE] });

    jest.useFakeTimers();
    try {
      await act(async () => {
        nativeListeners.get('onBindingStateChanged')?.({
          deviceId: 'device-1',
          connectionState: 'offline',
        });
      });
      expect(getByText('Remote unavailable')).toBeTruthy();
      expect(getByText('Failed to Load')).toBeTruthy();

      await act(async () => {
        jest.runOnlyPendingTimers();
        await Promise.resolve();
        await Promise.resolve();
      });

      await waitFor(() => expect(mockBrowseSharedFiles).toHaveBeenCalledTimes(1));
      expect(getByText('clip.mp4')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  test('marks shared files remote unavailable when an offline binding event carries stale tunnel reachability', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      subscription: { status: 'trialing' },
      loadSubscription: jest.fn(),
    });

    const { getByText, getByTestId } = render(<SharedFilesScreen />);

    await waitFor(() => getByTestId('shared-file-download-button'));

    await act(async () => {
      nativeListeners.get('onSharedFilesReachabilityChanged')?.({
        deviceId: 'device-1',
        state: 'available',
        route: 'tunnel',
        reason: 'browse_shared_files_success',
      });
    });
    expect(getByText('P2P online')).toBeTruthy();

    await act(async () => {
      nativeListeners.get('onBindingStateChanged')?.({
        deviceId: 'device-1',
        connectionState: 'offline',
        sharedFilesReachability: {
          state: 'available',
          route: 'tunnel',
        },
      });
    });

    expect(getByText('Remote unavailable')).toBeTruthy();
    expect(getByText('Failed to Load')).toBeTruthy();
  });

  test('shows remote unavailable instead of offline when a paired device loses LAN reachability', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      subscription: { status: 'trialing' },
      loadSubscription: jest.fn(),
    });

    const { getByText, getByTestId, queryByText } = render(<SharedFilesScreen />);

    await waitFor(() => getByTestId('shared-file-download-button'));

    await act(async () => {
      nativeListeners.get('onBindingStateChanged')?.({
        deviceId: 'device-1',
        connectionState: 'offline',
      });
    });

    expect(getByText('Remote unavailable')).toBeTruthy();
    expect(queryByText('Offline')).toBeNull();
    expect(getByText('Failed to Load')).toBeTruthy();
  });

  test('reloads files when shared files reachability becomes available while binding remains offline', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      subscription: { status: 'trialing' },
      loadSubscription: jest.fn(),
    });

    const { getByTestId, getByText } = render(<SharedFilesScreen />);

    await waitFor(() => getByTestId('shared-file-download-button'));
    mockBrowseSharedFiles.mockClear();
    mockBrowseSharedFiles.mockResolvedValueOnce({ files: [FAKE_OTHER_FILE] });

    await act(async () => {
      nativeListeners.get('onBindingStateChanged')?.({
        deviceId: 'device-1',
        connectionState: 'offline',
      });
    });
    expect(getByText('Remote unavailable')).toBeTruthy();
    expect(getByText('Failed to Load')).toBeTruthy();

    await act(async () => {
      nativeListeners.get('onSharedFilesReachabilityChanged')?.({
        deviceId: 'device-1',
        state: 'available',
        route: 'tunnel',
        reason: 'browse_shared_files_success',
      });
      await Promise.resolve();
    });

    await waitFor(() => expect(mockBrowseSharedFiles).toHaveBeenCalledTimes(1));
    expect(getByText('clip.mp4')).toBeTruthy();
  });

  test('shows the saved location after download completes', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      subscription: { status: 'trialing' },
      loadSubscription: jest.fn(),
    });
    mockDownloadSharedFile.mockResolvedValue({
      savedToPhotos: false,
      localPath: '/tmp/syncflow_shared_downloads/photo.jpg',
    });

    const { getByTestId } = render(<SharedFilesScreen />);

    await waitFor(() => getByTestId('shared-file-download-button'));

    await act(async () => {
      fireEvent.press(getByTestId('shared-file-download-button'));
    });

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith(
        'Download complete',
        expect.stringContaining('/tmp/syncflow_shared_downloads/photo.jpg'),
      ),
    );
  });

  test('marks the file as downloaded after download completes', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      subscription: { status: 'trialing' },
      loadSubscription: jest.fn(),
    });
    mockDownloadSharedFile.mockResolvedValue({
      savedToPhotos: false,
      localPath: '/tmp/syncflow_shared_downloads/photo.jpg',
    });

    const { getByTestId, getByText } = render(<SharedFilesScreen />);

    await waitFor(() => getByTestId('shared-file-download-button'));

    await act(async () => {
      fireEvent.press(getByTestId('shared-file-download-button'));
    });

    await waitFor(() => expect(getByText('Downloaded')).toBeTruthy());
  });

  test('restores downloaded status after reopening shared files', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      subscription: { status: 'trialing' },
      loadSubscription: jest.fn(),
    });
    mockDownloadSharedFile.mockResolvedValue({
      savedToPhotos: false,
      localPath: '/tmp/syncflow_shared_downloads/photo.jpg',
    });

    const firstRender = render(<SharedFilesScreen />);

    await waitFor(() => firstRender.getByTestId('shared-file-download-button'));

    await act(async () => {
      fireEvent.press(firstRender.getByTestId('shared-file-download-button'));
    });

    await waitFor(() => expect(AsyncStorage.setItem).toHaveBeenCalled());
    const [storageKey, storedDownloads] = (AsyncStorage.setItem as jest.Mock)
      .mock.calls[0] as [string, string];
    expect(storageKey).toContain('device-1');
    expect(JSON.parse(storedDownloads)).toEqual([FAKE_FILE_DOWNLOAD_ID]);

    firstRender.unmount();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(
      JSON.stringify([FAKE_FILE_DOWNLOAD_ID]),
    );

    const secondRender = render(<SharedFilesScreen />);

    await waitFor(() =>
      expect(secondRender.getByText('Downloaded')).toBeTruthy(),
    );
  });

  test('shows the saved location when native returns display location only', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      subscription: { status: 'trialing' },
      loadSubscription: jest.fn(),
    });
    mockDownloadSharedFile.mockResolvedValue({
      savedToPhotos: false,
      localPath: null,
      savedLocation: 'Documents/Vivi Drop/photo.jpg',
    });

    const { getByTestId } = render(<SharedFilesScreen />);

    await waitFor(() => getByTestId('shared-file-download-button'));

    await act(async () => {
      fireEvent.press(getByTestId('shared-file-download-button'));
    });

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith(
        'Download complete',
        expect.stringContaining('Documents/Vivi Drop/photo.jpg'),
      ),
    );
  });

  test('does not start a second download while one is active', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      subscription: { status: 'trialing' },
      loadSubscription: jest.fn(),
    });
    mockBrowseSharedFiles.mockResolvedValue({
      files: [FAKE_FILE, FAKE_OTHER_FILE],
    });
    mockDownloadSharedFile.mockImplementation(() => new Promise(() => undefined));

    const { getAllByTestId } = render(<SharedFilesScreen />);

    await waitFor(() => expect(getAllByTestId('shared-file-download-button')).toHaveLength(2));

    await act(async () => {
      fireEvent.press(getAllByTestId('shared-file-download-button')[0]);
    });
    await act(async () => {
      fireEvent.press(getAllByTestId('shared-file-download-button')[1]);
    });

    expect(mockDownloadSharedFile).toHaveBeenCalledTimes(1);
    expect(mockDownloadSharedFile).toHaveBeenCalledWith(FAKE_FILE.path);
  });

  test('ignores repeated presses before the active download re-renders disabled state', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      subscription: { status: 'trialing' },
      loadSubscription: jest.fn(),
    });
    mockDownloadSharedFile.mockImplementation(() => new Promise(() => undefined));

    const { getByTestId } = render(<SharedFilesScreen />);

    await waitFor(() => getByTestId('shared-file-download-button'));

    await act(async () => {
      const button = getByTestId('shared-file-download-button');
      fireEvent.press(button);
      fireEvent.press(button);
    });

    expect(mockDownloadSharedFile).toHaveBeenCalledTimes(1);
    expect(mockDownloadSharedFile).toHaveBeenCalledWith(FAKE_FILE.path);
  });
});

describe('SharedFilesScreen download gate', () => {
  test('blocks download and navigates to Subscription when sub_expired', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      subscription: { status: 'sub_expired' },
      loadSubscription: jest.fn(),
    });

    const { getByTestId } = render(<SharedFilesScreen />);

    // Wait for loadFiles to complete and the FlatList to render.
    await waitFor(() => getByTestId('shared-file-download-button'));

    fireEvent.press(getByTestId('shared-file-download-button'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(mockNavigate).toHaveBeenCalledWith('Subscription');
  });

  test('allows download when trialing', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      subscription: { status: 'trialing' },
      loadSubscription: jest.fn(),
    });

    const { getByTestId } = render(<SharedFilesScreen />);

    await waitFor(() => getByTestId('shared-file-download-button'));

    await act(async () => {
      fireEvent.press(getByTestId('shared-file-download-button'));
    });

    // Gate alert must NOT have fired; download was attempted instead.
    expect(alertSpy).not.toHaveBeenCalledWith(
      expect.stringMatching(/Subscription required/),
      expect.anything(),
      expect.anything(),
    );
    expect(mockNavigate).not.toHaveBeenCalledWith('Subscription');
  });
});
