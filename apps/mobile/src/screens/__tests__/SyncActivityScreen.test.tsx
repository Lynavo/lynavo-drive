import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { NativeEventEmitter, NativeModules, StyleSheet } from 'react-native';

import { SyncActivityScreen } from '../SyncActivityScreen';
import { listDownloadRecords } from '../../services/download-records-service';
import {
  getBindingState,
  getHistoryDays,
  getReadOnlyQueue,
  getSyncOverview,
} from '../../services/SyncEngineModule';

const mockRecentDownloadsSection = jest.fn();
const mockTimelineSection = jest.fn();
let mockVisualQaEnabled = false;
const nativeEventHandlers: Partial<Record<string, (payload: unknown) => void>> =
  {};
const nativeEventSubscriptionRemovers: jest.Mock[] = [];

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: jest.fn(),
  }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const ReactInner = require('react');
    ReactInner.useEffect(effect, [effect]);
  },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

jest.mock('react-native/Libraries/EventEmitter/NativeEventEmitter');

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({
    children,
    edges,
  }: {
    children: React.ReactNode;
    edges?: string[];
  }) =>
    (() => {
      const ReactInner = require('react');
      const { View } = require('react-native');
      return ReactInner.createElement(
        View,
        { testID: 'sync-activity-safe-area', edges },
        children,
      );
    })(),
}));

jest.mock('../../components/GradientBackground', () => ({
  GradientBackground: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

jest.mock('../../components/BottomTabBar', () => ({
  BottomTabBar: () => {
    const ReactInner = require('react');
    const { View } = require('react-native');
    return ReactInner.createElement(View, {
      testID: 'bottom-tab-bar',
    });
  },
}));

jest.mock('../../components/Icon', () => ({
  Icon: ({ name }: { name: string }) => {
    const ReactInner = require('react');
    const { Text } = require('react-native');
    return ReactInner.createElement(Text, null, name);
  },
}));

jest.mock('../components/SyncActivityHomeSections', () => ({
  RecentDownloadsSection: (props: { records: Array<{ filename: string }> }) => {
    mockRecentDownloadsSection(props);
    const ReactInner = require('react');
    const { Text, View } = require('react-native');
    return ReactInner.createElement(
      View,
      { testID: 'recent-downloads-section' },
      props.records.map(record =>
        ReactInner.createElement(
          Text,
          { key: record.filename },
          record.filename,
        ),
      ),
    );
  },
  SyncRecordTimelineSection: (props: {
    days: Array<{
      key: string;
      label: string;
      records: Array<{ id: string; deviceName: string; duration: string }>;
      totalFiles: number;
      totalSize: string;
    }>;
    totalSyncedSize: string;
  }) => {
    mockTimelineSection(props);
    const ReactInner = require('react');
    const { Text, View } = require('react-native');
    return ReactInner.createElement(
      View,
      {
        testID: 'sync-record-timeline-section',
      },
      [
        ReactInner.createElement(Text, { key: 'total' }, props.totalSyncedSize),
        ...props.days.flatMap(day => [
          ReactInner.createElement(
            Text,
            { key: `${day.key}-label` },
            day.label,
          ),
          ReactInner.createElement(
            Text,
            { key: `${day.key}-stats` },
            `${day.totalFiles} items - ${day.totalSize}`,
          ),
          ...day.records.map(record =>
            ReactInner.createElement(
              Text,
              { key: record.id },
              `${record.deviceName} ${record.duration}`,
            ),
          ),
        ]),
      ],
    );
  },
}));

jest.mock('../../services/download-records-service', () => ({
  listDownloadRecords: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../services/SyncEngineModule', () => ({
  getBindingState: jest.fn(),
  getSyncOverview: jest.fn(),
  getReadOnlyQueue: jest.fn(),
  getHistoryDays: jest.fn(),
}));

jest.mock('../../dev/visualQa', () => ({
  isVisualQaEnabled: () => mockVisualQaEnabled,
  isVisualQaHomeEmptyStateEnabled: () => false,
}));

describe('SyncActivityScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVisualQaEnabled = false;
    mockRecentDownloadsSection.mockClear();
    mockTimelineSection.mockClear();
    nativeEventSubscriptionRemovers.length = 0;
    Object.keys(nativeEventHandlers).forEach(key => {
      delete nativeEventHandlers[key];
    });
    (NativeModules as Record<string, unknown>).NativeSyncEngine = {
      addListener: jest.fn(),
      removeListeners: jest.fn(),
    };
    (NativeEventEmitter as jest.Mock).mockImplementation(() => ({
      addListener: jest.fn(
        (eventName: string, handler: (payload: unknown) => void) => {
          nativeEventHandlers[eventName] = handler;
          const remove = jest.fn();
          nativeEventSubscriptionRemovers.push(remove);
          return { remove };
        },
      ),
    }));
    (listDownloadRecords as jest.Mock).mockResolvedValue([]);
    (getBindingState as jest.Mock).mockResolvedValue({
      deviceId: 'desktop-1',
      deviceName: 'Studio Mac',
      deviceAlias: 'Studio Mac',
      host: '192.168.1.20',
      port: 39593,
      connectionState: 'connected',
      pairingId: 'pairing-1',
      shareEnabled: true,
      lastBoundAt: '2026-06-16T08:00:00.000Z',
    });
    (getSyncOverview as jest.Mock).mockResolvedValue({
      currentDeviceId: 'desktop-1',
      currentDeviceName: 'Studio Mac',
      currentSpeedMbps: 0,
      transferredBytes: 0,
      totalBytes: 0,
      progressPercent: 0,
      uploadState: 'idle',
      completedCount: 0,
      totalCount: 0,
      completedBytes: 0,
      autoUploadState: 'disabled',
    });
    (getReadOnlyQueue as jest.Mock).mockResolvedValue([]);
    (getHistoryDays as jest.Mock).mockResolvedValue({
      items: [],
      nextCursor: null,
    });
  });

  test('does not reserve bottom safe-area inside the main tab content', async () => {
    const { getByTestId } = render(
      <SyncActivityScreen showBottomTabBar={false} />,
    );

    await waitFor(() => {
      expect(listDownloadRecords).toHaveBeenCalled();
    });

    expect(getByTestId('sync-activity-safe-area').props.edges).toEqual([
      'top',
      'left',
      'right',
    ]);
  });

  test('uses visual QA recent-download mocks when the stored download history is empty', async () => {
    mockVisualQaEnabled = true;

    const { getByText, queryByTestId } = render(
      <SyncActivityScreen showBottomTabBar={false} />,
    );

    await waitFor(() => {
      expect(getByText('Client-Handoff.mov')).toBeTruthy();
    });
    expect(queryByTestId('recent-download-empty-state')).toBeNull();
    expect(mockRecentDownloadsSection).toHaveBeenLastCalledWith(
      expect.objectContaining({
        records: expect.arrayContaining([
          expect.objectContaining({ filename: 'Client-Handoff.mov' }),
        ]),
      }),
    );
  });

  test('does not inject visual QA recent-download mocks when visual QA is disabled', async () => {
    const { queryByText } = render(
      <SyncActivityScreen showBottomTabBar={false} />,
    );

    await waitFor(() => {
      expect(mockRecentDownloadsSection).toHaveBeenLastCalledWith(
        expect.objectContaining({ records: [] }),
      );
    });
    expect(queryByText('Client-Handoff.mov')).toBeNull();
  });

  test('loads sync overview, queue, history, and binding snapshots for home state', async () => {
    (getSyncOverview as jest.Mock).mockResolvedValueOnce({
      currentDeviceId: 'desktop-1',
      currentDeviceName: 'Studio Mac',
      currentSpeedMbps: 12.5,
      transferredBytes: 2 * 1024 * 1024,
      totalBytes: 5 * 1024 * 1024,
      progressPercent: 42,
      uploadState: 'uploading',
      completedCount: 2,
      totalCount: 5,
      completedBytes: 2 * 1024 * 1024,
      currentFilename: 'Clip-A.mov',
      autoUploadState: 'active',
      lastCompletedAt: '2026-06-16T17:45:00',
    });
    (getHistoryDays as jest.Mock).mockResolvedValueOnce({
      items: [
        {
          dateKey: '2026-06-16',
          deviceId: 'desktop-1',
          deviceName: 'Studio Mac',
          deviceIp: '192.168.1.20',
          totalFileCount: 3,
          totalBytes: 6 * 1024 * 1024,
          activeTransmissionSeconds: 75,
        },
      ],
      nextCursor: null,
    });

    const { getByText, getByTestId, queryByText } = render(
      <SyncActivityScreen showBottomTabBar={false} />,
    );

    expect(
      queryByText(
        'syncActivity.home.syncing - syncActivity.home.currentTransferProgress',
      ),
    ).toBeNull();

    await waitFor(() => {
      expect(
        getByText(
          'syncActivity.home.syncing - syncActivity.home.currentTransferProgress',
        ),
      ).toBeTruthy();
    });

    expect(getBindingState).toHaveBeenCalledTimes(1);
    expect(getSyncOverview).toHaveBeenCalledTimes(1);
    expect(getReadOnlyQueue).toHaveBeenCalledTimes(1);
    expect(getHistoryDays).toHaveBeenCalledTimes(1);
    expect(getByText('Studio Mac')).toBeTruthy();
    expect(getByText('common.connectionStates.connected')).toBeTruthy();
    const metaRowChildren = React.Children.toArray(
      getByTestId('sync-activity-auto-meta-row').props.children,
    ) as React.ReactElement<{ testID?: string }>[];
    expect(metaRowChildren.map(child => child.props.testID)).toEqual([
      'sync-activity-auto-state-badge',
      'sync-activity-auto-device-name',
    ]);
    expect(
      StyleSheet.flatten(
        getByTestId('sync-activity-auto-meta-row').props.style,
      ),
    ).toEqual(
      expect.objectContaining({
        flexDirection: 'row',
        alignItems: 'center',
      }),
    );
    expect(getByText('syncActivity.home.uploadedCount')).toBeTruthy();
    expect(getByText('42%')).toBeTruthy();
    expect(getByText('syncActivity.stats.transferSpeed')).toBeTruthy();
    expect(getByText('12.5 MB/s')).toBeTruthy();
    expect(getByText('syncActivity.stats.progress')).toBeTruthy();
    expect(getByText('syncActivity.stats.fileSize')).toBeTruthy();
    expect(getByText('2.0 MB / 5.0 MB')).toBeTruthy();
    expect(getByText('syncActivity.stats.currentFile')).toBeTruthy();
    expect(getByText('Clip-A.mov')).toBeTruthy();
    expect(
      getByText('syncActivity.home.latestSyncTimeLabel:2026-06-16 17:45'),
    ).toBeTruthy();
    expect(getByText('Studio Mac 1m 15s')).toBeTruthy();
    expect(getByText('6.0 MB')).toBeTruthy();
    expect(queryByText('syncActivity.home.autoSyncDisabled')).toBeNull();
  });

  test('renders completed auto-upload as a settled state instead of an active transfer', async () => {
    (getSyncOverview as jest.Mock).mockResolvedValueOnce({
      currentDeviceId: 'desktop-1',
      currentDeviceName: 'Studio Mac',
      currentSpeedMbps: 0,
      transferredBytes: 13 * 1024 * 1024,
      totalBytes: 13 * 1024 * 1024,
      progressPercent: 100,
      uploadState: 'uploading',
      completedCount: 7,
      totalCount: 7,
      completedBytes: 13 * 1024 * 1024,
      autoUploadState: 'active',
      autoPending: 0,
      lastCompletedAt: '2026-06-17T02:10:27.000Z',
    });
    (getHistoryDays as jest.Mock).mockResolvedValueOnce({
      items: [
        {
          dateKey: '2026-06-17',
          deviceId: 'desktop-1',
          deviceName: 'Studio Mac',
          deviceIp: '192.168.1.20',
          totalFileCount: 7,
          totalBytes: 13 * 1024 * 1024,
          activeTransmissionSeconds: 0.1,
        },
      ],
      nextCursor: null,
    });

    const { getByText, getByTestId, queryByText } = render(
      <SyncActivityScreen showBottomTabBar={false} />,
    );

    await waitFor(() => {
      expect(getByText('syncActivity.completed.auto.title')).toBeTruthy();
    });

    expect(getByText('syncActivity.home.completedSummary')).toBeTruthy();
    expect(getByText('syncActivity.home.waitingForNewAssets')).toBeTruthy();
    expect(
      StyleSheet.flatten(
        getByTestId('sync-activity-upload-completed-card').props.style,
      ),
    ).toEqual(
      expect.objectContaining({
        flexDirection: 'column',
        alignItems: 'stretch',
      }),
    );
    expect(
      queryByText(
        'syncActivity.home.syncing - syncActivity.home.currentTransferProgress',
      ),
    ).toBeNull();
    expect(queryByText('0 MB/s')).toBeNull();
    expect(queryByText('Preparing')).toBeNull();
    expect(getByText('Studio Mac <1s')).toBeTruthy();
  });

  test('subscribes to native sync events, refreshes matching snapshots, and cleans up', async () => {
    const screen = render(<SyncActivityScreen showBottomTabBar={false} />);

    await waitFor(() => {
      expect(NativeEventEmitter).toHaveBeenCalledWith(
        NativeModules.NativeSyncEngine,
      );
      expect(Object.keys(nativeEventHandlers).sort()).toEqual([
        'onBindingStateChanged',
        'onHistoryUpdated',
        'onQueueUpdated',
        'onSyncStateChanged',
      ]);
    });

    await act(async () => {
      nativeEventHandlers.onSyncStateChanged?.({
        currentDeviceId: 'desktop-1',
        currentDeviceName: 'Studio Mac',
        currentSpeedMbps: 8,
        transferredBytes: 4 * 1024 * 1024,
        totalBytes: 8 * 1024 * 1024,
        progressPercent: 80,
        uploadState: 'uploading',
        completedCount: 4,
        totalCount: 5,
        completedBytes: 4 * 1024 * 1024,
        currentFilename: 'Clip-B.mov',
        autoUploadState: 'active',
      });
    });

    expect(screen.getByText('80%')).toBeTruthy();
    expect(screen.getByText('Clip-B.mov')).toBeTruthy();

    (getReadOnlyQueue as jest.Mock).mockResolvedValueOnce([
      {
        fileKey: 'file-1',
        filename: 'Clip-B.mov',
        fileSize: 1024,
        mediaType: 'video',
        status: 'uploading',
      },
    ]);
    await act(async () => {
      nativeEventHandlers.onQueueUpdated?.({});
    });
    expect(getReadOnlyQueue).toHaveBeenCalledTimes(2);

    (getHistoryDays as jest.Mock).mockResolvedValueOnce({
      items: [
        {
          dateKey: '2026-06-15',
          deviceId: 'desktop-1',
          deviceName: 'Field Mac',
          deviceIp: '192.168.1.21',
          totalFileCount: 1,
          totalBytes: 1024,
          activeTransmissionSeconds: 5,
        },
      ],
      nextCursor: null,
    });
    await act(async () => {
      nativeEventHandlers.onHistoryUpdated?.({});
    });
    await waitFor(() => {
      expect(screen.getByText('Field Mac 5s')).toBeTruthy();
    });

    await act(async () => {
      nativeEventHandlers.onBindingStateChanged?.({
        deviceId: 'desktop-1',
        deviceName: 'Studio Mac',
        deviceAlias: 'Studio Mac',
        host: '192.168.1.20',
        port: 39593,
        connectionState: 'offline',
        pairingId: 'pairing-1',
        shareEnabled: true,
        lastBoundAt: '2026-06-16T08:00:00.000Z',
      });
    });
    expect(screen.getByText('Studio Mac')).toBeTruthy();
    expect(screen.getByText('common.connectionStates.offline')).toBeTruthy();

    screen.unmount();

    expect(nativeEventSubscriptionRemovers).toHaveLength(4);
    nativeEventSubscriptionRemovers.forEach(remove => {
      expect(remove).toHaveBeenCalledTimes(1);
    });
  });
});
