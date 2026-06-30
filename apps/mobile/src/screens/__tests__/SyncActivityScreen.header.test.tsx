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
      if (key === 'syncActivity.title') return '同步動態';
      if (key === 'syncActivity.header.help') return 'Help';
      if (key === 'syncActivity.home.recentDownloadsTitle') return '最近下載';
      if (key === 'syncActivity.home.syncRecordsTitle') return '同步記錄';
      if (key === 'syncActivity.notStarted.title') return '自動上傳未開啟';
      if (key === 'syncActivity.notStarted.subtitle')
        return '開啟自動上傳，拍完就同步；或者也可以選手動傳輸';
      if (key === 'syncActivity.notStarted.goToAlbum') return '去相簿';
      if (key === 'syncActivity.notStarted.enableAuto') return '開啟自動上傳';
      if (key === 'syncActivity.badges.auto') return '自動';
      if (key === 'syncActivity.badges.autoEnabled') return '自動上傳已開啟';
      if (key === 'syncActivity.running.autoTitle') return '正在自動上傳';
      if (key === 'syncActivity.running.queueInfo') return '排隊中 3項';
      if (key === 'syncActivity.stats.speed') return '速度';
      if (key === 'syncActivity.stats.progress') return '進度';
      if (key === 'syncActivity.stats.transferred') return '已傳輸';
      if (key === 'syncActivity.quickEntry.title') return '快捷入口';
      if (key === 'syncActivity.quickEntry.albumTitle') return '相簿';
      if (key === 'syncActivity.quickEntry.albumDesc')
        return '瀏覽並手動上傳素材';
      if (key === 'syncActivity.quickEntry.sharedFilesTitle') return '共享目錄';
      if (key === 'syncActivity.quickEntry.sharedFilesDesc')
        return '瀏覽共享目錄與個人共享目錄';
      if (key === 'settings.connection.online') return '線上';
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
  cancelAllManualUploads: jest.fn().mockResolvedValue(undefined),
  disableAutoUpload: jest.fn().mockResolvedValue(undefined),
  enableAutoUpload: jest.fn().mockResolvedValue(undefined),
  retryLanReconnect: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/desktop-local-service', () => ({
  listHistory: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../stores/auth-store', () => ({
  useAuth: () => ({
    isLoggedIn: true,
    user: {
      status: 'trialing',
      trialEnd: null,
    },
    subscription: {
      status: 'trialing',
      trialEnd: null,
    },
  }),
  isFeatureAccessAllowed: () => true,
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
      manualPending: 0,
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
      expect(screen.getAllByText('同步動態').length).toBeGreaterThan(0);
      expect(screen.getByTestId('sync-activity-device-row')).toBeTruthy();
      expect(screen.getAllByText('Mini4').length).toBeGreaterThan(0);
      expect(screen.getByText('線上')).toBeTruthy();
      expect(screen.getByText('自動上傳未開啟')).toBeTruthy();
      expect(screen.getByText('開啟自動上傳')).toBeTruthy();
      expect(screen.getByText('快捷入口')).toBeTruthy();
      expect(screen.queryByText('當前手機狀態')).toBeNull();
    });

    fireEvent.press(screen.getByText('開啟自動上傳'));

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
      manualPending: 0,
      autoPending: 3,
    });

    const screen = render(<SyncActivityScreen />);

    await waitFor(() => {
      expect(screen.getByText('自動')).toBeTruthy();
      expect(screen.getByText('自動上傳已開啟')).toBeTruthy();
      expect(screen.getByText('正在自動上傳')).toBeTruthy();
      expect(screen.getByText('25%')).toBeTruthy();
      expect(screen.getByText('IMG_0002.HEIC')).toBeTruthy();
      expect(screen.getByText('速度')).toBeTruthy();
      expect(screen.getByText('進度')).toBeTruthy();
      expect(screen.getByText('已傳輸')).toBeTruthy();
      expect(screen.getByText('排隊中 3項')).toBeTruthy();
      expect(screen.queryByText('當前傳輸進度')).toBeNull();
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
      manualPending: 0,
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
