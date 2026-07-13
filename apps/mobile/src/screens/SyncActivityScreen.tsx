import React, { useCallback, useMemo, useState } from 'react';
import {
  NativeEventEmitter,
  NativeModules,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type {
  AutoUploadState,
  BindingStateDTO,
  HistoryLedgerCardDTO,
  ReadOnlyQueueItemDTO,
  SyncSummaryDTO,
} from '@lynavo-drive/contracts';

import { BottomTabBar } from '../components/BottomTabBar';
import { GradientBackground } from '../components/GradientBackground';
import { Icon } from '../components/Icon';
import {
  isVisualQaEnabled,
  isVisualQaHomeEmptyStateEnabled,
} from '../dev/visualQa';
import { getVisualQaDownloadRecords } from '../dev/visualQaMockData';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { colors } from '../theme/globalColors';
import {
  SyncRecordTimelineSection,
  RecentDownloadsSection,
  type SyncRecordTimelineDay,
  type RecentDownloadRecord,
  type RecentDownloadPlaceholder,
} from './components/SyncActivityHomeSections';
import {
  listDownloadRecords,
  type DownloadRecord,
} from '../services/download-records-service';
import {
  getBindingState,
  getHistoryDays,
  getReadOnlyQueue,
  getSyncOverview,
} from '../services/SyncEngineModule';
import { androidBoxShadow } from '../utils/androidShadow';
import { formatBytes, formatDuration } from '../utils/format';

type NavigationProp = StackNavigationProp<RootStackParamList, 'SyncActivity'>;

const BLUE = colors.accent;

interface SyncActivityScreenProps {
  showBottomTabBar?: boolean;
}

type SyncOverview = Omit<SyncSummaryDTO, 'uploadState'> & {
  autoUploadState?: AutoUploadState;
  completedBytes: number;
  completedCount: number;
  currentFilename?: string;
  lastCompletedAt?: string;
  totalCount: number;
  uploadState: string;
};

const EMPTY_SYNC_OVERVIEW: SyncOverview = {
  currentDeviceId: null,
  currentDeviceName: null,
  currentSpeedMbps: 0,
  transferredBytes: 0,
  totalBytes: 0,
  progressPercent: 0,
  uploadState: 'idle',
  completedBytes: 0,
  completedCount: 0,
  totalCount: 0,
  autoUploadState: 'disabled',
  autoPending: 0,
};

const RECENT_DOWNLOAD_PLACEHOLDERS: RecentDownloadPlaceholder[] = [
  {
    key: 'photo',
    label: 'Photo',
    iconName: 'image-outline',
    iconColor: BLUE,
    iconBackground: '#B8DDF8',
    previewType: 'photo',
  },
  {
    key: 'video',
    label: 'Video',
    iconName: 'play-circle-outline',
    iconColor: '#ffffff',
    iconBackground: '#AAB7FF',
    previewType: 'video',
  },
  {
    key: 'file-1',
    label: 'File',
    iconName: 'document-outline',
    iconColor: '#315E8C',
    iconBackground: '#EEF3FA',
    previewType: 'file',
  },
  {
    key: 'file-2',
    label: 'File',
    iconName: 'document-outline',
    iconColor: '#315E8C',
    iconBackground: '#EEF3FA',
    previewType: 'file',
  },
];

export function SyncActivityScreen({
  showBottomTabBar = true,
}: SyncActivityScreenProps) {
  const navigation = useNavigation<NavigationProp>();
  const { t } = useTranslation();
  const showHomeEmptyState = isVisualQaHomeEmptyStateEnabled();
  const [downloadRecords, setDownloadRecords] = useState<DownloadRecord[]>([]);
  const [overview, setOverview] = useState<SyncOverview>(EMPTY_SYNC_OVERVIEW);
  const [bindingState, setBindingState] = useState<BindingStateDTO | null>(
    null,
  );
  const [queueItems, setQueueItems] = useState<ReadOnlyQueueItemDTO[]>([]);
  const [historyDays, setHistoryDays] = useState<HistoryLedgerCardDTO[]>([]);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      const refreshDownloads = async () => {
        const records = await listDownloadRecords();
        if (!active) return;
        setDownloadRecords(
          records.length > 0 || !isVisualQaEnabled()
            ? records
            : getVisualQaDownloadRecords(),
        );
      };

      const refreshBinding = async () => {
        try {
          const binding = await getBindingState();
          if (active) {
            setBindingState(normalizeBindingState(binding));
          }
        } catch {
          if (active) {
            setBindingState(null);
          }
        }
      };

      const refreshOverview = async () => {
        try {
          const snapshot = await getSyncOverview();
          if (active) {
            setOverview(prev => normalizeSyncOverview(snapshot, prev));
          }
        } catch {
          if (active) {
            setOverview(EMPTY_SYNC_OVERVIEW);
          }
        }
      };

      const refreshQueue = async () => {
        try {
          const queue = await getReadOnlyQueue();
          if (active) {
            setQueueItems(queue);
          }
        } catch {
          if (active) {
            setQueueItems([]);
          }
        }
      };

      const refreshHistory = async () => {
        try {
          const history = await getHistoryDays();
          if (active) {
            setHistoryDays(history.items);
          }
        } catch {
          if (active) {
            setHistoryDays([]);
          }
        }
      };

      void Promise.all([
        refreshDownloads(),
        refreshBinding(),
        refreshOverview(),
        refreshQueue(),
        refreshHistory(),
      ]);

      const nativeSyncEngine = NativeModules.NativeSyncEngine;
      const subscriptions: Array<{ remove: () => void }> = [];
      if (nativeSyncEngine) {
        const emitter = new NativeEventEmitter(nativeSyncEngine);
        subscriptions.push(
          emitter.addListener('onSyncStateChanged', payload => {
            setOverview(prev => normalizeSyncOverview(payload, prev));
          }),
          emitter.addListener('onQueueUpdated', () => {
            void refreshQueue();
          }),
          emitter.addListener('onHistoryUpdated', () => {
            void refreshHistory();
          }),
          emitter.addListener('onBindingStateChanged', payload => {
            setBindingState(normalizeBindingState(payload));
          }),
        );
      }

      return () => {
        active = false;
        subscriptions.forEach(subscription => {
          subscription.remove();
        });
      };
    }, []),
  );

  const recentDownloadRecords = showHomeEmptyState
    ? []
    : downloadRecords.slice(0, 4).map(toRecentDownloadRecord);
  const uploadProgress = useMemo(
    () => buildUploadProgress(overview, queueItems.length),
    [overview, queueItems.length],
  );
  const autoUploadActive = overview.autoUploadState === 'active';
  const shouldShowUploadCompleted =
    autoUploadActive && isCompletedUploadState(overview, uploadProgress);
  const shouldShowUploadProgress =
    !shouldShowUploadCompleted &&
    autoUploadActive &&
    (isActiveUploadState(overview.uploadState) ||
      uploadProgress.totalCount > 0 ||
      uploadProgress.totalBytes > 0);
  const connectionMeta = formatConnectionMetaParts(bindingState, overview, t);
  const timelineDays = useMemo(
    () =>
      showHomeEmptyState
        ? []
        : [...historyDays]
            .sort((a, b) => b.dateKey.localeCompare(a.dateKey))
            .map(item => toSyncRecordTimelineDay(item, t)),
    [historyDays, showHomeEmptyState, t],
  );
  const totalSyncedSize = useMemo(
    () =>
      formatBytes(
        showHomeEmptyState
          ? 0
          : historyDays.reduce((sum, item) => sum + item.totalBytes, 0),
      ),
    [historyDays, showHomeEmptyState],
  );
  const latestSyncLabel = getLatestSyncLabel(overview, historyDays, t);

  return (
    <GradientBackground>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <Text style={styles.title}>
              {t('syncActivity.title') || 'Sync Activity'}
            </Text>
            <Text style={styles.subtitle}>
              {t('syncActivity.desc') ||
                'View current connection, transfer progress, and recent files.'}
            </Text>
          </View>

          <View style={styles.autoCard}>
            <View style={styles.autoCardSurface}>
              <View style={styles.autoHeader}>
                <View style={styles.autoTitleRow}>
                  <View style={styles.autoIconBox}>
                    <Icon name="desktop-outline" size={22} color={BLUE} />
                  </View>
                  <View style={styles.autoCopyBlock}>
                    <Text style={styles.autoTitle}>
                      {t('syncActivity.home.autoSyncTitle') || 'Auto Sync'}
                    </Text>
                    <View
                      testID="sync-activity-auto-meta-row"
                      style={styles.autoMetaRow}
                    >
                      <View
                        testID="sync-activity-auto-state-badge"
                        style={styles.autoStateBadge}
                      >
                        <Text style={styles.autoStateText}>
                          {connectionMeta.stateLabel}
                        </Text>
                      </View>
                      {connectionMeta.deviceName ? (
                        <Text
                          testID="sync-activity-auto-device-name"
                          style={styles.autoDeviceName}
                          numberOfLines={1}
                        >
                          {connectionMeta.deviceName}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                </View>
                <TouchableOpacity
                  style={styles.autoButton}
                  activeOpacity={0.76}
                  onPress={() => navigation.navigate('AutoUploadSettings')}
                >
                  <Text style={styles.autoButtonText}>
                    {autoUploadActive
                      ? t('syncActivity.home.adjust') || 'Adjust'
                      : t('syncActivity.home.enableAuto') || 'On'}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.phonePanel}>
                <Text style={styles.phoneTitle}>
                  {t('syncActivity.home.currentPhoneStatus') ||
                    'Current Phone Status'}
                </Text>
                <Text style={styles.phoneStatus}>
                  {autoUploadActive
                    ? shouldShowUploadCompleted
                      ? t('syncActivity.home.uploadedCount', {
                          completed: uploadProgress.completedCount,
                          total: uploadProgress.totalCount,
                        }) ||
                        `Uploaded${uploadProgress.completedCount}/${uploadProgress.totalCount}`
                      : uploadProgress.totalCount > 0
                        ? t('syncActivity.home.uploadedCount', {
                            completed: uploadProgress.completedCount,
                            total: uploadProgress.totalCount,
                          }) ||
                          `Uploaded${uploadProgress.completedCount}/${uploadProgress.totalCount}`
                        : t('syncActivity.home.waitingForSync') ||
                          'Waiting for auto sync'
                    : t('syncActivity.home.autoDisabled') ||
                      'Auto sync is not enabled'}
                </Text>
                {shouldShowUploadProgress ? (
                  <View style={styles.uploadProgressCard}>
                    <View style={styles.uploadProgressHeader}>
                      <Text style={styles.uploadProgressTitle}>
                        {t('syncActivity.home.syncing') || 'Uploading'} -{' '}
                        {t('syncActivity.home.currentTransferProgress') ||
                          'Current transfer progress'}
                      </Text>
                      <Text style={styles.uploadProgressPercent}>
                        {uploadProgress.percent}%
                      </Text>
                    </View>
                    <View style={styles.uploadProgressTrack}>
                      <View
                        style={[
                          styles.uploadProgressFill,
                          { width: `${uploadProgress.percent}%` },
                        ]}
                      />
                    </View>
                    <View style={styles.uploadProgressGrid}>
                      <View style={styles.uploadProgressStat}>
                        <Text style={styles.uploadProgressLabel}>
                          {t('syncActivity.stats.transferSpeed') ||
                            'Transfer Speed'}
                        </Text>
                        <Text style={styles.uploadProgressValue}>
                          {formatSpeedMbps(uploadProgress.speedMbps)}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.uploadProgressStat,
                          styles.uploadProgressStatRight,
                        ]}
                      >
                        <Text style={styles.uploadProgressLabel}>
                          {t('syncActivity.stats.progress') ||
                            'Transfer Progress'}
                        </Text>
                        <Text style={styles.uploadProgressValue}>
                          {uploadProgress.completedCount} /{' '}
                          {uploadProgress.totalCount}
                        </Text>
                      </View>
                      <View style={styles.uploadProgressStat}>
                        <Text style={styles.uploadProgressLabel}>
                          {t('syncActivity.stats.fileSize') || 'File Size'}
                        </Text>
                        <Text style={styles.uploadProgressValue}>
                          {formatBytes(uploadProgress.completedBytes)} /{' '}
                          {formatBytes(uploadProgress.totalBytes)}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.uploadProgressStat,
                          styles.uploadProgressStatRight,
                        ]}
                      >
                        <Text style={styles.uploadProgressLabel}>
                          {t('syncActivity.stats.currentFile') || 'CurrentFile'}
                        </Text>
                        <Text style={styles.uploadProgressValue}>
                          {uploadProgress.currentFilename ||
                            t('syncActivity.phases.defaultTitle') ||
                            'Preparing'}
                        </Text>
                      </View>
                    </View>
                  </View>
                ) : shouldShowUploadCompleted ? (
                  <View
                    testID="sync-activity-upload-completed-card"
                    style={styles.uploadCompletedCard}
                  >
                    <View style={styles.uploadCompletedPrimaryRow}>
                      <View style={styles.uploadCompletedIcon}>
                        <Icon name="checkmark-circle" size={18} color={BLUE} />
                      </View>
                      <View style={styles.uploadCompletedCopy}>
                        <Text style={styles.uploadCompletedTitle}>
                          {t('syncActivity.completed.auto.title') ||
                            'This sync round is complete'}
                        </Text>
                        <Text style={styles.uploadCompletedMeta}>
                          {t('syncActivity.home.completedSummary', {
                            count: uploadProgress.completedCount,
                            size: formatBytes(uploadProgress.completedBytes),
                          }) ||
                            `Synced ${uploadProgress.completedCount} items - ${formatBytes(uploadProgress.completedBytes)}`}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.uploadCompletedHint}>
                      {t('syncActivity.home.waitingForNewAssets') ||
                        'Waiting for new assets to auto sync'}
                    </Text>
                  </View>
                ) : null}
                <Text style={styles.latestSyncText}>
                  {t('syncActivity.home.latestSyncTimeLabel') ||
                    'Last sync time'}
                  :{latestSyncLabel}
                </Text>
              </View>
            </View>
          </View>

          <RecentDownloadsSection
            records={recentDownloadRecords}
            placeholders={RECENT_DOWNLOAD_PLACEHOLDERS}
            t={t}
            onPressViewAll={() => navigation.navigate('DownloadRecords')}
            title={t('syncActivity.recentDownload.title') || 'Recent Downloads'}
            viewAllLabel={
              t('syncActivity.recentDownload.viewAll') || 'View All'
            }
            sectionIconColor={BLUE}
            sectionIconName="arrow-down-circle-outline"
            variant="globalPreview"
          />

          <SyncRecordTimelineSection
            days={timelineDays}
            totalSyncedSize={totalSyncedSize}
          />
        </ScrollView>

        {showBottomTabBar ? <BottomTabBar activeTab="home" /> : null}
      </SafeAreaView>
    </GradientBackground>
  );
}

function toRecentDownloadRecord(record: DownloadRecord): RecentDownloadRecord {
  const extraFields = isRecord(record)
    ? {
        thumbnailUrl: readStringField(record, 'thumbnailUrl'),
        previewUrl: readStringField(record, 'previewUrl'),
        streamUrl: readStringField(record, 'streamUrl'),
      }
    : {};

  return {
    recordId: record.id,
    filename: record.filename,
    fileSize: record.fileSize,
    mediaType: record.mediaType,
    ...(extraFields.thumbnailUrl
      ? { thumbnailUrl: extraFields.thumbnailUrl }
      : {}),
    ...(extraFields.previewUrl ? { previewUrl: extraFields.previewUrl } : {}),
    ...(extraFields.streamUrl ? { streamUrl: extraFields.streamUrl } : {}),
    ...(record.localPath ? { localPath: record.localPath } : {}),
    completedAt: record.downloadedAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readStringField(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0
    ? value
    : undefined;
}

function readNumberField(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function isAutoUploadState(value: unknown): value is AutoUploadState {
  return value === 'active' || value === 'disabled' || value === 'interrupted';
}

function isConnectionState(
  value: unknown,
): value is BindingStateDTO['connectionState'] {
  return (
    value === 'discovering' ||
    value === 'bound' ||
    value === 'connecting' ||
    value === 'connected' ||
    value === 'offline'
  );
}

function normalizeBindingState(value: unknown): BindingStateDTO | null {
  if (!isRecord(value)) {
    return null;
  }

  const deviceId = readStringField(value, 'deviceId');
  if (!deviceId) {
    return null;
  }

  const deviceName = readStringField(value, 'deviceName') ?? '';
  const connectionStateValue = value.connectionState;

  return {
    deviceId,
    deviceName,
    deviceAlias: readStringField(value, 'deviceAlias') ?? deviceName,
    host: readStringField(value, 'host') ?? '',
    port: readNumberField(value, 'port') ?? 39393,
    connectionState: isConnectionState(connectionStateValue)
      ? connectionStateValue
      : 'bound',
    pairingId: readStringField(value, 'pairingId') ?? '',
    shareEnabled: value.shareEnabled === true,
    shareName: readStringField(value, 'shareName'),
    lastBoundAt: readStringField(value, 'lastBoundAt') ?? '',
    sharedFilesReachability: null,
    wake: null,
  };
}

function normalizeSyncOverview(
  payload: unknown,
  prev: SyncOverview,
): SyncOverview {
  if (!isRecord(payload)) {
    return prev;
  }

  const uploadState =
    readStringField(payload, 'uploadState') ?? prev.uploadState;
  const completedBytes =
    readNumberField(payload, 'completedBytes') ??
    readNumberField(payload, 'transferredBytes') ??
    prev.completedBytes;
  const totalBytes = readNumberField(payload, 'totalBytes') ?? prev.totalBytes;
  const completedCount =
    readNumberField(payload, 'completedCount') ?? prev.completedCount;
  const totalCount =
    readNumberField(payload, 'totalCount') ??
    readNumberField(payload, 'queueTotalCount') ??
    prev.totalCount;
  const explicitPercent = readNumberField(payload, 'progressPercent');
  const derivedPercent =
    totalBytes > 0
      ? (completedBytes / totalBytes) * 100
      : totalCount > 0
        ? (completedCount / totalCount) * 100
        : prev.progressPercent;
  const shouldClearCurrentFile =
    uploadState === 'idle' ||
    uploadState === 'completed' ||
    uploadState === 'paused_auto_upload';
  const hasCurrentFilename = Object.prototype.hasOwnProperty.call(
    payload,
    'currentFilename',
  );
  const autoUploadStateValue = payload.autoUploadState;

  return {
    ...prev,
    currentDeviceId:
      payload.currentDeviceId === null
        ? null
        : (readStringField(payload, 'currentDeviceId') ?? prev.currentDeviceId),
    currentDeviceName:
      payload.currentDeviceName === null
        ? null
        : (readStringField(payload, 'currentDeviceName') ??
          prev.currentDeviceName),
    currentSpeedMbps:
      readNumberField(payload, 'currentSpeedMbps') ?? prev.currentSpeedMbps,
    transferredBytes:
      readNumberField(payload, 'transferredBytes') ?? completedBytes,
    totalBytes,
    progressPercent: clampPercent(explicitPercent ?? derivedPercent),
    uploadState,
    completedBytes,
    completedCount,
    totalCount,
    currentFilename: shouldClearCurrentFile
      ? undefined
      : hasCurrentFilename
        ? readStringField(payload, 'currentFilename')
        : prev.currentFilename,
    lastCompletedAt:
      readStringField(payload, 'lastCompletedAt') ?? prev.lastCompletedAt,
    autoUploadState: isAutoUploadState(autoUploadStateValue)
      ? autoUploadStateValue
      : prev.autoUploadState,
    autoPending: readNumberField(payload, 'autoPending') ?? prev.autoPending,
  };
}

function buildUploadProgress(
  overview: SyncOverview,
  pendingQueueCount: number,
) {
  const totalCount =
    overview.totalCount > 0 ? overview.totalCount : pendingQueueCount;
  const completedCount =
    totalCount > 0
      ? Math.min(Math.max(overview.completedCount, 0), totalCount)
      : Math.max(overview.completedCount, 0);
  const totalBytes = Math.max(overview.totalBytes, 0);
  const completedBytes =
    totalBytes > 0
      ? Math.min(Math.max(overview.completedBytes, 0), totalBytes)
      : Math.max(overview.completedBytes, 0);
  const derivedPercent =
    totalBytes > 0
      ? (completedBytes / totalBytes) * 100
      : totalCount > 0
        ? (completedCount / totalCount) * 100
        : overview.progressPercent;

  return {
    completedBytes,
    completedCount,
    currentFilename: overview.currentFilename,
    percent: clampPercent(overview.progressPercent || derivedPercent),
    speedMbps: Math.max(overview.currentSpeedMbps, 0),
    totalBytes,
    totalCount,
  };
}

function isActiveUploadState(uploadState: string): boolean {
  return (
    uploadState === 'scanning' ||
    uploadState === 'queued' ||
    uploadState === 'uploading' ||
    uploadState === 'retrying' ||
    uploadState === 'preparing' ||
    uploadState === 'reconnecting' ||
    uploadState === 'backoff_waiting'
  );
}

function isCompletedUploadState(
  overview: SyncOverview,
  progress: ReturnType<typeof buildUploadProgress>,
): boolean {
  const finishedCount =
    progress.totalCount > 0 && progress.completedCount >= progress.totalCount;
  const finishedBytes =
    progress.totalBytes <= 0 || progress.completedBytes >= progress.totalBytes;
  const hasPendingQueueWork = (overview.autoPending ?? 0) > 0;

  if (!finishedCount || !finishedBytes || hasPendingQueueWork) {
    return false;
  }

  if (overview.uploadState === 'completed' || overview.uploadState === 'idle') {
    return true;
  }

  return (
    overview.uploadState === 'uploading' &&
    !overview.currentFilename &&
    overview.currentSpeedMbps <= 0
  );
}

function formatSpeedMbps(speedMbps: number): string {
  if (!Number.isFinite(speedMbps) || speedMbps <= 0) {
    return '0 MB/s';
  }
  return `${speedMbps.toFixed(1)} MB/s`;
}

function formatConnectionMetaParts(
  binding: BindingStateDTO | null,
  overview: SyncOverview,
  t: any,
): { deviceName?: string; stateLabel: string } {
  const deviceName =
    binding?.deviceAlias ||
    binding?.deviceName ||
    overview.currentDeviceName ||
    undefined;
  const stateLabel = binding
    ? formatConnectionStateLabel(binding.connectionState, t)
    : overview.autoUploadState === 'active'
      ? t('common.connectionStates.active') || 'Enabled'
      : t('common.connectionStates.inactive') || 'Disabled';

  return { deviceName, stateLabel };
}

function formatConnectionStateLabel(
  connectionState: BindingStateDTO['connectionState'],
  t: any,
): string {
  switch (connectionState) {
    case 'connected':
      return t('common.connectionStates.connected') || 'Connected';
    case 'connecting':
    case 'discovering':
      return t('common.connectionStates.connecting') || 'Connecting';
    case 'offline':
      return t('common.connectionStates.offline') || 'Offline';
    case 'bound':
    default:
      return t('common.connectionStates.bound') || 'Bound';
  }
}

function toSyncRecordTimelineDay(
  item: HistoryLedgerCardDTO,
  t: any,
): SyncRecordTimelineDay {
  const totalSize = formatBytes(item.totalBytes);
  return {
    key: item.dateKey,
    label: formatHistoryDayLabel(item.dateKey, t),
    totalFiles: item.totalFileCount,
    totalSize,
    records: [
      {
        id: `${item.dateKey}-${item.deviceId}`,
        deviceName:
          item.deviceName ||
          item.deviceId ||
          t('common.connectionStates.boundDeviceFallback') ||
          'BoundComputer',
        duration: formatGlobalHistoryDuration(item.activeTransmissionSeconds),
        fileCount: item.totalFileCount,
        status: 'completed',
        totalSize,
      },
    ],
  };
}

function formatGlobalHistoryDuration(
  activeTransmissionSeconds: number,
): string {
  if (
    !Number.isFinite(activeTransmissionSeconds) ||
    activeTransmissionSeconds <= 0
  ) {
    return '--';
  }
  if (activeTransmissionSeconds < 1) {
    return '<1s';
  }
  return formatDuration(activeTransmissionSeconds * 1000);
}

function formatHistoryDayLabel(dateKey: string, t: any): string {
  const parts = dateKey.split('-').map(part => Number(part));
  if (parts.length !== 3 || parts.some(part => !Number.isFinite(part))) {
    return dateKey;
  }

  const [year, month, day] = parts;
  const date = new Date(year, month - 1, day);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString())
    return t('common.today') || 'Today';
  if (date.toDateString() === yesterday.toDateString())
    return t('common.yesterday') || 'Yesterday';
  if (date.getFullYear() === today.getFullYear()) {
    return t('history.dates.monthDay', { month, day }) || `${month}/${day}`;
  }
  return dateKey;
}

function getLatestSyncLabel(
  overview: SyncOverview,
  historyDays: HistoryLedgerCardDTO[],
  t: any,
): string {
  const overviewLabel = formatDateTimeLabel(overview.lastCompletedAt);
  if (overviewLabel) {
    return overviewLabel;
  }

  const latestDateKey = historyDays
    .map(item => item.dateKey)
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a))[0];
  return latestDateKey
    ? formatHistoryDayLabel(latestDateKey, t)
    : t('syncActivity.home.latestSyncTimeEmpty') || 'None';
}

function formatDateTimeLabel(isoString?: string): string | null {
  if (!isoString) return null;
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return null;

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    '0',
  )}-${String(date.getDate()).padStart(2, '0')} ${String(
    date.getHours(),
  ).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 24,
    paddingBottom: 24,
  },
  header: {
    marginBottom: 20,
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '600',
    color: '#17191C',
  },
  subtitle: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 20,
    color: '#59616D',
  },
  autoCard: {
    marginHorizontal: 20,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.70)',
    backgroundColor: 'rgba(255,255,255,0.58)',
    shadowColor: '#46608A',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.12,
    shadowRadius: 52,
    elevation: 3,
    ...androidBoxShadow({
      offsetY: 18,
      blurRadius: 52,
      color: 'rgba(70, 96, 138, 0.12)',
    }),
  },
  autoCardSurface: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: 'rgba(255,255,255,0.52)',
  },
  autoHeader: {
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  autoTitleRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  autoIconBox: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.80)',
    backgroundColor: '#E4F5FF',
  },
  autoTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
    color: '#17191C',
  },
  autoCopyBlock: {
    flex: 1,
    minWidth: 0,
  },
  autoMetaRow: {
    marginTop: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  autoDeviceName: {
    flex: 1,
    minWidth: 0,
    fontSize: 11,
    lineHeight: 15,
    color: '#59616D',
  },
  autoStateBadge: {
    flexShrink: 0,
    borderRadius: 999,
    backgroundColor: 'rgba(32,128,219,0.10)',
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  autoStateText: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '600',
    color: BLUE,
  },
  autoButton: {
    minHeight: 36,
    minWidth: 54,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    backgroundColor: BLUE,
    shadowColor: BLUE,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.18,
    shadowRadius: 28,
    elevation: 2,
  },
  autoButtonText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  phonePanel: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.70)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.50)',
    shadowColor: '#46608A',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 34,
    elevation: 1,
    ...androidBoxShadow({
      offsetY: 12,
      blurRadius: 34,
      color: 'rgba(70, 96, 138, 0.08)',
    }),
  },
  phoneTitle: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    color: '#17191C',
  },
  phoneStatus: {
    marginTop: 4,
    fontSize: 11,
    lineHeight: 20,
    color: '#59616D',
  },
  uploadProgressCard: {
    marginTop: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.70)',
    backgroundColor: 'rgba(255,255,255,0.54)',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  uploadProgressHeader: {
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  uploadProgressTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 9,
    lineHeight: 13,
    fontWeight: '500',
    color: '#59616D',
  },
  uploadProgressPercent: {
    fontSize: 9,
    lineHeight: 13,
    fontWeight: '600',
    color: '#59616D',
  },
  uploadProgressTrack: {
    height: 8,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: '#DCE9F5',
  },
  uploadProgressFill: {
    height: 8,
    borderRadius: 999,
    backgroundColor: BLUE,
  },
  uploadProgressGrid: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 12,
  },
  uploadProgressStat: {
    width: '50%',
    minWidth: 0,
  },
  uploadProgressStatRight: {
    alignItems: 'flex-end',
  },
  uploadProgressLabel: {
    fontSize: 9,
    lineHeight: 13,
    color: '#9AB0C6',
  },
  uploadProgressValue: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    color: '#17191C',
  },
  uploadCompletedCard: {
    marginTop: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(74,153,222,0.16)',
    backgroundColor: 'rgba(245,251,255,0.72)',
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 8,
  },
  uploadCompletedPrimaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  uploadCompletedIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DFF3FF',
  },
  uploadCompletedCopy: {
    flex: 1,
    minWidth: 0,
  },
  uploadCompletedTitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    color: '#17191C',
  },
  uploadCompletedMeta: {
    marginTop: 3,
    fontSize: 10,
    lineHeight: 14,
    color: '#59616D',
  },
  uploadCompletedHint: {
    marginLeft: 44,
    fontSize: 10,
    lineHeight: 15,
    color: '#9AB0C6',
  },
  latestSyncText: {
    marginTop: 6,
    fontSize: 10,
    lineHeight: 15,
    color: '#9AB0C6',
  },
});
