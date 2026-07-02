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
        'common.deviceNames.default': 'Computer',
        'settings.connection.online': 'Online',
        'settings.connection.connecting': 'Connecting',
        'settings.connection.offline': 'Offline',
        'settings.status.noRecord': 'No records yet',
        'syncActivity.title': 'Sync Activity',
        'syncActivity.badges.auto': 'Auto',
        'syncActivity.badges.autoEnabled': 'Auto upload enabled',
        'syncActivity.notStarted.title': 'Auto Upload Is Off',
        'syncActivity.notStarted.subtitle':
          'Turn on auto upload to sync after shooting, or choose manual transfer',
        'syncActivity.notStarted.goToAlbum': 'Go to Album',
        'syncActivity.notStarted.enableAuto': 'Enable Auto Upload',
        'syncActivity.quickEntry.title': 'Quick Actions',
        'syncActivity.quickEntry.albumTitle': 'Photos',
        'syncActivity.quickEntry.albumDesc': 'BrowseAlbum Library',
        'syncActivity.quickEntry.sharedFilesTitle': 'Shared Folder',
        'syncActivity.quickEntry.sharedFilesDesc':
          'Browse shared folder and personal shared folder',
        'syncActivity.quickEntry.globalSharedFilesTitle': 'My Computer',
        'syncActivity.quickEntry.globalSharedFilesDesc':
          'Browse files from My Computer',
        'syncActivity.onboarding.skip': 'Skip guide',
        'syncActivity.onboarding.previous': 'Back',
        'syncActivity.onboarding.next': `Next ${values?.step ?? ''}/${values?.total ?? ''}`,
        'syncActivity.onboarding.startJourney': 'Start Journey',
        'syncActivity.onboarding.album.title': 'Album Library',
        'syncActivity.onboarding.album.body':
          'Browse photos and videos from here. New media is picked up by the automatic sync queue.',
        'syncActivity.onboarding.panel.title': 'Hands-free Backup',
        'syncActivity.onboarding.panel.body':
          'This panel shows live auto-upload progress.',
        'syncActivity.onboarding.history.title': 'Transfer History',
        'syncActivity.onboarding.history.body':
          'Review all completed transfer records.',
        'syncActivity.onboarding.settings.title': 'Global Settings',
        'syncActivity.onboarding.settings.body':
          'Check connected devices and edit the phone display name.',
        'syncActivity.onboarding.help.title': 'Help Center',
        'syncActivity.onboarding.help.body':
          'Open the quick start guide when you need help.',
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
        ReactInner.createElement(Text, null, 'Album Library'),
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
            step >= 5 ? 'Start Journey' : `Next ${step}/5`,
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
      expect(screen.getByText('Album Library')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('Next 1/5'));
    fireEvent.press(screen.getByText('Next 2/5'));
    fireEvent.press(screen.getByText('Next 3/5'));
    fireEvent.press(screen.getByText('Next 4/5'));
    fireEvent.press(screen.getByText('Start Journey'));

    await waitFor(() => {
      expect(mockMarkSyncActivityTourSeen).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(screen.queryByText('Album Library')).toBeNull();
    });
  });

  it('does not show the sync activity tour after it has been seen', async () => {
    mockHasSeenSyncActivityTour.mockResolvedValueOnce(true);

    const screen = render(<SyncActivityScreen />);

    await waitFor(() => {
      expect(mockHasSeenSyncActivityTour).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText('Album Library')).toBeNull();
  });

  it('uses My Computer copy for the shared files quick entry', async () => {
    mockHasSeenSyncActivityTour.mockResolvedValueOnce(true);

    const screen = render(<SyncActivityScreen />);

    await waitFor(() => {
      expect(screen.getByText('My Computer')).toBeTruthy();
    });

    expect(screen.getByText('Browse files from My Computer')).toBeTruthy();
    expect(screen.queryByText('Shared Folder')).toBeNull();
  });
});
