import React from 'react';
import { NativeEventEmitter, NativeModules } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockNavigate = jest.fn();
const mockDispatch = jest.fn();
const mockHasSeenSyncActivityTour = jest.fn().mockResolvedValue(false);
const mockMarkSyncActivityTourSeen = jest.fn().mockResolvedValue(undefined);

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
    t: (key: string, values?: Record<string, unknown>) =>
      ({
        'common.deviceNames.default': '電腦',
        'settings.connection.online': '在線',
        'settings.connection.connecting': '連接中',
        'settings.connection.offline': '離線',
        'settings.status.noRecord': '暫無記錄',
        'syncActivity.title': '同步動態',
        'syncActivity.badges.auto': '自動',
        'syncActivity.badges.autoEnabled': '自動上傳已開啟',
        'syncActivity.notStarted.title': '自動上傳未開啟',
        'syncActivity.notStarted.subtitle':
          '開啟自動上傳，拍完就同步；或者也可以選手動傳輸',
        'syncActivity.notStarted.goToAlbum': '去相簿',
        'syncActivity.notStarted.enableAuto': '開啟自動上傳',
        'syncActivity.quickEntry.title': '快捷入口',
        'syncActivity.quickEntry.albumTitle': '相簿',
        'syncActivity.quickEntry.albumDesc': '瀏覽相簿素材',
        'syncActivity.quickEntry.sharedFilesTitle': '共享目錄',
        'syncActivity.quickEntry.sharedFilesDesc': '瀏覽共享目錄與個人共享目錄',
        'syncActivity.quickEntry.globalSharedFilesTitle': '我的電腦',
        'syncActivity.quickEntry.globalSharedFilesDesc': '瀏覽我的電腦中的檔案',
        'syncActivity.onboarding.skip': '跳過引導',
        'syncActivity.onboarding.previous': '上一步',
        'syncActivity.onboarding.next': `下一步 ${values?.step ?? ''}/${values?.total ?? ''}`,
        'syncActivity.onboarding.startJourney': '開啟旅程',
        'syncActivity.onboarding.album.title': '相簿素材',
        'syncActivity.onboarding.album.body':
          '從這裡瀏覽照片和影片。新增素材會進入自動同步隊列。',
        'syncActivity.onboarding.panel.title': '無感備份',
        'syncActivity.onboarding.panel.body': '這裡即時展示自動上傳進度。',
        'syncActivity.onboarding.history.title': '傳輸歷史',
        'syncActivity.onboarding.history.body': '查看所有已完成的傳輸記錄。',
        'syncActivity.onboarding.settings.title': '全域設定',
        'syncActivity.onboarding.settings.body':
          '查看連接設備，修改手機顯示名稱。',
        'syncActivity.onboarding.help.title': '幫助中心',
        'syncActivity.onboarding.help.body': '遇到問題時可查看快速上手指南。',
      })[key] ?? key,
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

jest.mock('../../utils/onboardingStorage', () => ({
  hasSeenSyncActivityTour: () => mockHasSeenSyncActivityTour(),
  markSyncActivityTourSeen: () => mockMarkSyncActivityTourSeen(),
}));

jest.mock('../../components/onboarding/SyncActivityTour', () => {
  const actual = jest.requireActual(
    '../../components/onboarding/SyncActivityTour',
  );
  const ReactInner = require('react');
  const { Text, TouchableOpacity, View } = require('react-native');

  return {
    ...actual,
    SyncActivityTour: ({
      visible,
      onFinish,
    }: {
      visible: boolean;
      onFinish: () => void;
    }) => {
      const [step, setStep] = ReactInner.useState(1);

      if (!visible) return null;

      return ReactInner.createElement(
        View,
        null,
        ReactInner.createElement(Text, null, '相簿素材'),
        ReactInner.createElement(
          TouchableOpacity,
          {
            onPress: () => {
              if (step >= 5) {
                onFinish();
                return;
              }
              setStep((current: number) => current + 1);
            },
          },
          ReactInner.createElement(
            Text,
            null,
            step >= 5 ? '開啟旅程' : `下一步 ${step}/5`,
          ),
        ),
      );
    },
  };
});

import { SyncActivityScreen } from '../SyncActivityScreen';

describe('SyncActivityScreen onboarding', () => {
  const originalConsoleError = console.error;
  let consoleErrorSpy: jest.SpyInstance;

  beforeAll(() => {
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
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockHasSeenSyncActivityTour.mockResolvedValue(false);
    mockMarkSyncActivityTourSeen.mockResolvedValue(undefined);
    (NativeModules as Record<string, unknown>).NativeSyncEngine = {
      getBindingState: jest.fn().mockResolvedValue({
        deviceId: 'desktop-1',
        deviceName: 'Mini4',
        connectionState: 'connected',
      }),
      getReadOnlyQueue: jest.fn().mockResolvedValue([]),
      getHistoryDays: jest.fn().mockResolvedValue({ items: [] }),
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

  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  it('shows the sync activity tour once and marks it seen on finish', async () => {
    const screen = render(<SyncActivityScreen />);

    await waitFor(() => {
      expect(screen.getByText('相簿素材')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('下一步 1/5'));
    fireEvent.press(screen.getByText('下一步 2/5'));
    fireEvent.press(screen.getByText('下一步 3/5'));
    fireEvent.press(screen.getByText('下一步 4/5'));
    fireEvent.press(screen.getByText('開啟旅程'));

    await waitFor(() => {
      expect(mockMarkSyncActivityTourSeen).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(screen.queryByText('相簿素材')).toBeNull();
    });
  });

  it('does not show the sync activity tour after it has been seen', async () => {
    mockHasSeenSyncActivityTour.mockResolvedValueOnce(true);

    const screen = render(<SyncActivityScreen />);

    await waitFor(() => {
      expect(mockHasSeenSyncActivityTour).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText('相簿素材')).toBeNull();
  });

  it('uses My Computer copy for the shared files quick entry', async () => {
    mockHasSeenSyncActivityTour.mockResolvedValueOnce(true);

    const screen = render(<SyncActivityScreen />);

    await waitFor(() => {
      expect(screen.getByText('我的電腦')).toBeTruthy();
    });

    expect(screen.getByText('瀏覽我的電腦中的檔案')).toBeTruthy();
    expect(screen.queryByText('共享目錄')).toBeNull();
  });
});
