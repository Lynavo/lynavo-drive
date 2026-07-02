import React from 'react';
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
} from '@testing-library/react-native';
import { NativeModules, NativeEventEmitter } from 'react-native';

const mockNavigate = jest.fn();
const mockDispatch = jest.fn();
const originalConsoleError = console.error;
let consoleErrorSpy: jest.SpyInstance;

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    dispatch: mockDispatch,
  }),
  useIsFocused: () => true,
  CommonActions: {
    reset: jest.fn(payload => payload),
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === 'syncActivity.title') return 'Sync Activity';
      if (key === 'syncActivity.header.help') return 'Help';
      if (key === 'syncActivity.home.recentDownloadsTitle')
        return 'Recent Downloads';
      if (key === 'syncActivity.home.syncRecordsTitle') return 'Sync Records';
      if (key === 'syncActivity.notStarted.title') return 'Auto Upload Is Off';
      if (key === 'syncActivity.notStarted.subtitle')
        return 'Turn on auto upload to sync after shooting, or choose manual transfer';
      if (key === 'syncActivity.notStarted.goToAlbum') return 'Go to Album';
      if (key === 'syncActivity.notStarted.enableAuto')
        return 'Enable Auto Upload';
      if (key === 'syncActivity.badges.auto') return 'Auto';
      if (key === 'syncActivity.badges.autoEnabled')
        return 'Auto upload enabled';
      if (key === 'syncActivity.running.autoTitle') return 'Auto Uploading';
      if (key === 'syncActivity.running.queueInfo') return '3 queued';
      if (key === 'syncActivity.stats.speed') return 'Speed';
      if (key === 'syncActivity.stats.progress') return 'Progress';
      if (key === 'syncActivity.stats.transferred') return 'Transferred';
      if (key === 'syncActivity.quickEntry.title') return 'Quick Actions';
      if (key === 'syncActivity.quickEntry.albumTitle') return 'Photos';
      if (key === 'syncActivity.quickEntry.albumDesc')
        return 'BrowseAlbum Library';
      if (key === 'syncActivity.quickEntry.sharedFilesTitle')
        return 'Shared Folder';
      if (key === 'syncActivity.quickEntry.sharedFilesDesc')
        return 'Browse shared folder and personal shared folder';
      if (key === 'settings.connection.online') return 'Online';
      return key;
    },
  }),
}));

jest.mock('react-native/Libraries/EventEmitter/NativeEventEmitter');

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../components/Icon', () => ({
  Icon: ({ name }: { name: string }) => {
    const ReactInner = require('react');
    const { Text } = require('react-native');
    return ReactInner.createElement(Text, null, name);
  },
}));

jest.mock('../../services/SyncEngineModule', () => ({
  disableAutoUpload: jest.fn().mockResolvedValue(undefined),
  enableAutoUpload: jest.fn().mockResolvedValue(undefined),
  retryLanReconnect: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/desktop-local-service', () => ({
  listHistory: jest.fn().mockResolvedValue([]),
}));

import { SyncActivityScreen } from '../SyncActivityScreen';
import { retryLanReconnect } from '../../services/SyncEngineModule';

beforeEach(() => {
  jest.clearAllMocks();
  consoleErrorSpy = jest
    .spyOn(console, 'error')
    .mockImplementation((message?: unknown, ...args: unknown[]) => {
      if (
        typeof message === 'string' &&
        message.includes('not wrapped in act')
      ) {
        return;
      }
      originalConsoleError(message, ...args);
    });

  (NativeModules as Record<string, unknown>).NativeSyncEngine = {
    getBindingState: jest.fn().mockResolvedValue({
      deviceId: 'desktop-1',
      deviceName: 'Mini4',
      connectionState: 'connected',
    }),
    getHistoryDays: jest.fn().mockResolvedValue({ items: [] }),
    getReadOnlyQueue: jest.fn().mockResolvedValue([]),
    getSyncOverview: jest.fn().mockResolvedValue({
      uploadState: 'idle',
      progressPercent: 0,
      currentSpeedMbps: 0,
      completedCount: 0,
      totalCount: 0,
      completedBytes: 0,
      totalBytes: 0,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
      autoUploadState: 'disabled',
      autoPending: 0,
    }),
    startDiscovery: jest.fn().mockResolvedValue(undefined),
    triggerSync: jest.fn().mockResolvedValue(undefined),
    addListener: jest.fn(),
    removeListeners: jest.fn(),
  };

  (NativeEventEmitter as jest.Mock).mockImplementation(() => ({
    addListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
  }));
});

afterEach(() => {
  cleanup();
  if (jest.isMockFunction(setTimeout)) {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  }
  consoleErrorSpy.mockRestore();
});

describe('SyncActivityScreen header', () => {
  it('renders the v0 transfer home in idle state and opens auto upload settings', async () => {
    const screen = render(<SyncActivityScreen />);

    await waitFor(() => {
      expect(screen.getAllByText('Sync Activity').length).toBeGreaterThan(0);
      expect(screen.getByTestId('sync-activity-device-row')).toBeTruthy();
      expect(screen.getAllByText('Mini4').length).toBeGreaterThan(0);
      expect(screen.getByText('Online')).toBeTruthy();
      expect(screen.getByText('Auto Upload Is Off')).toBeTruthy();
      expect(screen.getByText('Enable Auto Upload')).toBeTruthy();
      expect(screen.getByText('Quick Actions')).toBeTruthy();
      expect(screen.queryByText('Current Phone Status')).toBeNull();
    });

    fireEvent.press(screen.getByText('Enable Auto Upload'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('AutoUploadSettings');
    });
  });

  it('renders the v0 transfer body while auto upload is running', async () => {
    (
      NativeModules.NativeSyncEngine.getSyncOverview as jest.Mock
    ).mockResolvedValue({
      uploadState: 'uploading',
      progressPercent: 25,
      currentSpeedMbps: 2.5,
      completedCount: 1,
      totalCount: 4,
      completedBytes: 1024 * 1024,
      totalBytes: 4 * 1024 * 1024,
      currentFile: 'asset-2',
      currentFilename: 'IMG_0002.HEIC',
      currentFileConfirmedBytes: 1024,
      currentFileTotalBytes: 4096,
      currentTaskSource: 'auto',
      autoUploadState: 'active',
      autoPending: 3,
    });

    const screen = render(<SyncActivityScreen />);

    await waitFor(() => {
      expect(screen.getByText('Auto')).toBeTruthy();
      expect(screen.getByText('Auto upload enabled')).toBeTruthy();
      expect(screen.getByText('Auto Uploading')).toBeTruthy();
      expect(screen.getByText('25%')).toBeTruthy();
      expect(screen.getByText('IMG_0002.HEIC')).toBeTruthy();
      expect(screen.getByText('Speed')).toBeTruthy();
      expect(screen.getByText('Progress')).toBeTruthy();
      expect(screen.getByText('Transferred')).toBeTruthy();
      expect(screen.getByText('3 queued')).toBeTruthy();
      expect(screen.queryByText('Current Transfer Progress')).toBeNull();
    });
  });

  it('navigates to Help from the header help entry', async () => {
    const screen = render(<SyncActivityScreen />);

    fireEvent.press(screen.getByLabelText('Help'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('Help');
    });
  });

  it('uses LAN-only retry when pressing offline reconnect', async () => {
    jest.useFakeTimers();
    (
      NativeModules.NativeSyncEngine.getBindingState as jest.Mock
    ).mockResolvedValue({
      deviceId: 'desktop-1',
      deviceName: 'Mini4',
      connectionState: 'offline',
    });
    (
      NativeModules.NativeSyncEngine.getSyncOverview as jest.Mock
    ).mockResolvedValue({
      uploadState: 'offline',
      progressPercent: 0,
      currentSpeedMbps: 0,
      completedCount: 0,
      totalCount: 0,
      completedBytes: 0,
      totalBytes: 0,
      currentFileConfirmedBytes: 0,
      currentFileTotalBytes: 0,
      autoUploadState: 'disabled',
      autoPending: 0,
      lastErrorCode: 'RECONNECT_EXHAUSTED',
    });

    const screen = render(<SyncActivityScreen />);
    await waitFor(() => {
      expect(screen.getByText('syncActivity.offline.reconnect')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('syncActivity.offline.reconnect'));

    await waitFor(() => {
      expect(retryLanReconnect).toHaveBeenCalledWith({ allowWake: true });
    });
  });
});
