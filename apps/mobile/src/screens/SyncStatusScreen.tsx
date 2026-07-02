// DEPRECATED: Replaced by SyncActivityScreen in Lynavo Drive update
import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  TouchableOpacity,
  NativeModules,
  NativeEventEmitter,
  Linking,
  AppState,
  Platform,
  type AppStateStatus,
  type ListRenderItemInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { Icon } from '../components/Icon';
import { formatLocalDateKey } from '../utils/localDateKey';
import { getEffectiveConnectionState } from '../utils/effectiveConnectionState';
import { shouldTreatReconnectAsWaitingForNetworkRecovery } from '../utils/reconnectBannerState';
import { getReconnectInterruptionReason } from '../utils/reconnectInterruptionReason';
import { formatQueueCountDisplay } from '../utils/queueCountDisplay';
import { SyncPerformanceHint } from './components/SyncPerformanceHint';
import type { DeviceType } from '@lynavo-drive/contracts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** @deprecated — this screen is replaced by SyncActivityScreen */
type SyncStatusNav = StackNavigationProp<RootStackParamList, 'SyncActivity'>;

interface QueueItem {
  id: string;
  name: string;
  fileKey: string;
  rawFileSize: number;
  ackedOffset: number;
  type: 'video' | 'image';
  status:
    | 'queued'
    | 'discovered'
    | 'preparing'
    | 'ready'
    | 'cloud_downloading'
    | 'uploading'
    | 'completed'
    | 'failed'
    | 'skipped';
  isCloudAsset: boolean;
}

interface SyncOverview {
  progressPercent: number;
  currentSpeedMbps: number;
  uploadState: string;
  performanceHint?: 'none' | 'thermal_limited';
  performanceMessage?: string;
  thermalState?: 'nominal' | 'fair' | 'serious' | 'critical' | 'unknown';
  activeTuningProfile?: string;
  isThermalLimited?: boolean;
  completedCount: number;
  totalCount: number;
  completedBytes: number;
  totalBytes: number;
  currentFile?: string;
  currentFilename?: string;
  currentFileConfirmedBytes: number;
  currentFileTotalBytes: number;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  retryAttempt?: number;
  retryDelaySec?: number;
  autoUploadState?: string;
}

interface BindingState {
  deviceId: string;
  deviceName: string;
  deviceAlias?: string;
  deviceType?: DeviceType;
  host: string;
  connectionState:
    | 'bound'
    | 'connecting'
    | 'connected'
    | 'offline'
    | 'discovering';
}

interface RetryBannerState {
  attempt: number;
  retryAtMs: number;
  startedAtMs: number;
}

interface LatestSyncInfo {
  updatedAt: string;
  deviceName: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BLUE = '#3b9fd8';
const BLUE_LIGHT = '#7eb8d8';
const BLUE_MUTED = '#8ab0c8';
const DARK = '#1a3a5c';
const DARK_FILE = '#1e3a54';
const MUTED_FILE = '#a8bece';
const RING_BG = '#daeef8';
const CARD_BG = 'rgba(255,255,255,0.62)';
const QUEUE_CARD_BG = 'rgba(255,255,255,0.80)';
const ICON_BG = '#eef6fc';
const SEPARATOR = '#f2f6fa';
const QUEUE_SEPARATOR = '#eef3f8';
const SCREEN_BG = '#d6ecf8';
const UPLOADING_BG = 'rgba(59,159,216,0.08)';
const UPLOADING_BORDER = BLUE;

const RECONNECT_PAUSED_THRESHOLD_MS = 15_000;
const RECONNECT_PAUSED_THRESHOLD_ATTEMPT = 3;
const STARTUP_CONNECTION_GRACE_MS = 2500;
const CONNECTION_BANNER_SHOW_DELAY_MS = 700;
const COMPLETION_CARD_HOLD_MS = 1200;
const EMPTY_OVERVIEW: SyncOverview = {
  progressPercent: 0,
  currentSpeedMbps: 0,
  uploadState: 'idle',
  performanceHint: 'none',
  performanceMessage: undefined,
  thermalState: 'unknown',
  activeTuningProfile: undefined,
  isThermalLimited: false,
  completedCount: 0,
  totalCount: 0,
  completedBytes: 0,
  totalBytes: 0,
  currentFileConfirmedBytes: 0,
  currentFileTotalBytes: 0,
  lastErrorCode: undefined,
  lastErrorMessage: undefined,
  retryAttempt: 0,
  retryDelaySec: 0,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fileIcon(type: 'video' | 'image'): React.ReactElement {
  return type === 'video' ? (
    <Icon name="videocam-outline" size={16} color="#3b82f6" />
  ) : (
    <Icon name="image-outline" size={16} color="#06b6d4" />
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatSpeedMbps(speedMbps: number): string {
  if (!Number.isFinite(speedMbps) || speedMbps <= 0) {
    return '0 MB/s';
  }
  return `${speedMbps >= 10 ? speedMbps.toFixed(0) : speedMbps.toFixed(1)} MB/s`;
}

function buildOverviewFromPayload(
  payload: Record<string, unknown> | null | undefined,
  previous: SyncOverview,
): SyncOverview {
  if (!payload) {
    return previous;
  }

  const nextUploadState =
    (payload.uploadState as string | undefined) ?? previous.uploadState;
  const hasCurrentFile = Object.prototype.hasOwnProperty.call(
    payload,
    'currentFile',
  );
  const hasCurrentFilename = Object.prototype.hasOwnProperty.call(
    payload,
    'currentFilename',
  );
  const hasCurrentFileConfirmedBytes = Object.prototype.hasOwnProperty.call(
    payload,
    'currentFileConfirmedBytes',
  );
  const hasCurrentFileTotalBytes = Object.prototype.hasOwnProperty.call(
    payload,
    'currentFileTotalBytes',
  );
  const hasLastErrorCode = Object.prototype.hasOwnProperty.call(
    payload,
    'lastErrorCode',
  );
  const hasLastErrorMessage = Object.prototype.hasOwnProperty.call(
    payload,
    'lastErrorMessage',
  );

  const nextCurrentFile = hasCurrentFile
    ? typeof payload.currentFile === 'string'
      ? payload.currentFile
      : undefined
    : previous.currentFile;
  const nextCurrentFilename = hasCurrentFilename
    ? typeof payload.currentFilename === 'string'
      ? payload.currentFilename
      : undefined
    : previous.currentFilename;
  const nextCurrentFileConfirmedBytes = hasCurrentFileConfirmedBytes
    ? ((payload.currentFileConfirmedBytes as number | undefined) ??
      (payload.confirmedBytes as number | undefined) ??
      0)
    : ((payload.confirmedBytes as number | undefined) ??
      previous.currentFileConfirmedBytes);
  const nextCurrentFileTotalBytes = hasCurrentFileTotalBytes
    ? ((payload.currentFileTotalBytes as number | undefined) ?? 0)
    : previous.currentFileTotalBytes;
  const nextLastErrorCode = hasLastErrorCode
    ? typeof payload.lastErrorCode === 'string'
      ? payload.lastErrorCode
      : undefined
    : previous.lastErrorCode;
  const nextLastErrorMessage = hasLastErrorMessage
    ? typeof payload.lastErrorMessage === 'string'
      ? payload.lastErrorMessage
      : undefined
    : previous.lastErrorMessage;
  const derivedProgressPercent =
    nextCurrentFileTotalBytes > 0
      ? Math.round(
          (nextCurrentFileConfirmedBytes / nextCurrentFileTotalBytes) * 100,
        )
      : 0;

  return {
    progressPercent:
      (payload.progressPercent as number | undefined) ??
      derivedProgressPercent ??
      previous.progressPercent,
    currentSpeedMbps:
      (payload.currentSpeedMbps as number | undefined) ??
      previous.currentSpeedMbps,
    uploadState: nextUploadState,
    performanceHint:
      (payload.performanceHint as
        | SyncOverview['performanceHint']
        | undefined) ?? previous.performanceHint,
    performanceMessage:
      typeof payload.performanceMessage === 'string'
        ? payload.performanceMessage
        : Object.prototype.hasOwnProperty.call(payload, 'performanceMessage')
          ? undefined
          : previous.performanceMessage,
    thermalState:
      (payload.thermalState as SyncOverview['thermalState'] | undefined) ??
      previous.thermalState,
    activeTuningProfile:
      typeof payload.activeTuningProfile === 'string'
        ? payload.activeTuningProfile
        : Object.prototype.hasOwnProperty.call(payload, 'activeTuningProfile')
          ? undefined
          : previous.activeTuningProfile,
    isThermalLimited:
      typeof payload.isThermalLimited === 'boolean'
        ? payload.isThermalLimited
        : previous.isThermalLimited,
    completedCount:
      (payload.completedCount as number | undefined) ?? previous.completedCount,
    totalCount:
      (payload.totalCount as number | undefined) ??
      (payload.queueTotalCount as number | undefined) ??
      previous.totalCount,
    completedBytes:
      (payload.completedBytes as number | undefined) ?? previous.completedBytes,
    totalBytes:
      (payload.totalBytes as number | undefined) ??
      (payload.queueTotalBytes as number | undefined) ??
      previous.totalBytes,
    currentFile:
      nextUploadState === 'completed' || nextUploadState === 'idle'
        ? undefined
        : nextCurrentFile,
    currentFilename:
      nextUploadState === 'completed' || nextUploadState === 'idle'
        ? undefined
        : nextCurrentFilename,
    currentFileConfirmedBytes:
      nextUploadState === 'completed' || nextUploadState === 'idle'
        ? 0
        : nextCurrentFileConfirmedBytes,
    currentFileTotalBytes:
      nextUploadState === 'completed' || nextUploadState === 'idle'
        ? 0
        : nextCurrentFileTotalBytes,
    lastErrorCode:
      nextUploadState === 'completed' || nextUploadState === 'idle'
        ? undefined
        : nextLastErrorCode,
    lastErrorMessage:
      nextUploadState === 'completed' || nextUploadState === 'idle'
        ? undefined
        : nextLastErrorMessage,
    retryAttempt:
      (payload.retryAttempt as number | undefined) ?? previous.retryAttempt,
    retryDelaySec:
      (payload.retryDelaySec as number | undefined) ?? previous.retryDelaySec,
    autoUploadState:
      (payload.autoUploadState as string | undefined) ??
      previous.autoUploadState,
  };
}

function summaryTitleForUploadState(uploadState: string, t: TFunction): string {
  switch (uploadState) {
    case 'uploading':
      return t('syncStatus.phases.uploading');
    case 'preparing':
      return t('syncStatus.phases.preparing');
    case 'cloud_downloading':
      return t('syncStatus.phases.cloudDownloading');
    case 'reconnecting':
      return t('syncStatus.phases.reconnecting');
    case 'paused_no_permission':
      return t('syncStatus.phases.pausedNoPermission');
    default:
      return t('syncStatus.phases.default');
  }
}

function formatDateTimeLabel(iso: string | undefined, t: TFunction): string {
  if (!iso) return t('settings.status.noRecord');
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return t('settings.status.noRecord');

  const now = new Date();
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  if (date.toDateString() === now.toDateString()) {
    return t('settings.dates.todayAt', { time });
  }
  if (date.getFullYear() === now.getFullYear()) {
    return t('settings.dates.monthDayAt', {
      month: date.getMonth() + 1,
      day: date.getDate(),
      time,
    });
  }
  return t('settings.dates.fullDate', {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    time,
  });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CompletionCard({
  fileCount,
  totalSize,
  latestSyncLabel,
  t,
}: {
  fileCount: number;
  totalSize: string;
  latestSyncLabel?: string;
  t: TFunction;
}) {
  return (
    <View style={styles.completionContainer}>
      {/* Glow backdrop */}
      <View style={styles.completionGlow} />
      {/* Checkmark circle */}
      <View style={styles.completionCircle}>
        <Icon name="checkmark-circle" size={64} color="#22c55e" />
      </View>
      <Text style={styles.completionTitle}>
        {t('syncStatus.completion.title')}
      </Text>
      <View style={styles.completionMeta}>
        <Text style={styles.completionStats}>
          {fileCount} {t('syncStatus.completion.filesUnit')} {'-'} {totalSize}
        </Text>
        <Text style={styles.completionSubtext}>
          {t('syncStatus.completion.subtitle')}
        </Text>
        {latestSyncLabel ? (
          <Text style={styles.lastSyncText}>
            {t('syncStatus.completion.latestSync', { label: latestSyncLabel })}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function SyncSummaryCard({
  uploadState,
  completedCount,
  totalCount,
  transferredBytes,
  totalBytes,
  currentSpeedMbps,
  activeFileName,
  t,
}: {
  uploadState: string;
  completedCount: number;
  totalCount: number;
  transferredBytes: number;
  totalBytes: number;
  currentSpeedMbps: number;
  activeFileName?: string;
  t: TFunction;
}) {
  return (
    <>
      <Text style={styles.summaryEyebrow}>
        {summaryTitleForUploadState(uploadState, t)}
      </Text>
      <Text style={styles.summaryTitle}>
        {t('syncStatus.summary.filesCompleted', {
          completed: completedCount,
          total: totalCount,
        })}
      </Text>
      <View style={styles.summaryStats}>
        <View style={styles.summaryStatCard}>
          <Text style={styles.summaryStatLabel}>
            {t('syncStatus.summary.transferred')}
          </Text>
          <Text style={styles.summaryStatValue}>
            {`${formatBytes(transferredBytes)} / ${formatBytes(totalBytes)}`}
          </Text>
        </View>
        <View style={styles.summaryStatCard}>
          <Text style={styles.summaryStatLabel}>
            {t('syncStatus.summary.speed')}
          </Text>
          <Text style={styles.summaryStatValue}>
            {formatSpeedMbps(currentSpeedMbps)}
          </Text>
        </View>
      </View>
      {activeFileName ? (
        <Text style={styles.summaryCurrentFile} numberOfLines={1}>
          {t('syncStatus.summary.currentFile', { name: activeFileName })}
        </Text>
      ) : null}
    </>
  );
}

function QueueItemRow({
  item,
  isLast,
  activeFileKey,
  activeProgressPercent,
  activeConfirmedBytes,
  activeTotalBytes,
  t,
}: {
  item: QueueItem;
  isLast: boolean;
  activeFileKey?: string;
  activeProgressPercent: number;
  activeConfirmedBytes: number;
  activeTotalBytes: number;
  t: TFunction;
}) {
  const isActive =
    item.status === 'uploading' ||
    (item.fileKey.length > 0 && item.fileKey === activeFileKey);
  const showItemProgress = isActive && activeTotalBytes > 0;
  const itemStatusLabel = showItemProgress
    ? t('syncStatus.queue.itemStatus.transferring', {
        percent: activeProgressPercent,
      })
    : item.status === 'cloud_downloading'
      ? t('syncStatus.queue.itemStatus.cloudDownloading')
      : item.status === 'preparing'
        ? t('syncStatus.queue.itemStatus.preparing')
        : item.status === 'uploading'
          ? t('syncStatus.queue.itemStatus.uploading')
          : item.status === 'ready' ||
              item.status === 'discovered' ||
              item.status === 'queued'
            ? t('albumWorkbench.badges.queued')
            : null;

  return (
    <View
      style={[
        styles.queueRow,
        !isLast && styles.queueRowBorder,
        isActive && styles.queueRowUploading,
      ]}
    >
      <View style={styles.queueIcon}>{fileIcon(item.type)}</View>
      <View style={styles.queueInfo}>
        <Text style={styles.queueFileName} numberOfLines={1}>
          {item.name}
        </Text>
        <View style={styles.queueFileMeta}>
          <Text style={styles.queueFileSize}>
            {formatBytes(item.rawFileSize)}
          </Text>
          {itemStatusLabel ? (
            <View style={styles.uploadingBadge}>
              <View style={styles.uploadingDot} />
              <Text style={styles.uploadingLabel}>{itemStatusLabel}</Text>
            </View>
          ) : null}
          {item.isCloudAsset && (
            <View style={styles.cloudAssetBadge}>
              <Icon name="cloud-outline" size={11} color={BLUE} />
              <Text style={styles.cloudAssetLabel}>{'iCloud'}</Text>
            </View>
          )}
        </View>
        {showItemProgress ? (
          <View style={styles.itemProgressGroup}>
            <View style={styles.itemProgressTrack}>
              <View
                style={[
                  styles.itemProgressFill,
                  {
                    width: `${Math.max(0, Math.min(100, activeProgressPercent))}%`,
                  },
                ]}
              />
            </View>
            <Text style={styles.itemProgressText}>
              {`${formatBytes(activeConfirmedBytes)} / ${formatBytes(activeTotalBytes)}`}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export function SyncStatusScreen() {
  const navigation = useNavigation<SyncStatusNav>();
  const { t } = useTranslation();
  const isAndroid = Platform.OS === 'android';
  const [overview, setOverview] = useState<SyncOverview>(EMPTY_OVERVIEW);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [todayStats, setTodayStats] = useState({ fileCount: 0, totalBytes: 0 });
  const [initialLoading, setInitialLoading] = useState(true);
  const [bindingState, setBindingState] = useState<BindingState | null>(null);
  const [retryBanner, setRetryBanner] = useState<RetryBannerState | null>(null);
  const [retryCountdownSec, setRetryCountdownSec] = useState(0);
  const [latestSync, setLatestSync] = useState<LatestSyncInfo | null>(null);
  const [suppressInitialOfflineBanner, setSuppressInitialOfflineBanner] =
    useState(false);
  const [showConnectionBanner, setShowConnectionBanner] = useState(false);
  const [holdCompletionCardUntilMs, setHoldCompletionCardUntilMs] = useState<
    number | null
  >(null);

  const mapQueueItem = useCallback(
    (item: Record<string, unknown>, index: number): QueueItem => ({
      id: String(item.id ?? index),
      name: (item.originalFilename as string) || 'Unknown',
      fileKey: (item.fileKey as string) || '',
      rawFileSize: (item.fileSize as number) ?? 0,
      ackedOffset: (item.ackedOffset as number) ?? 0,
      type: (item.mediaType as string) === 'video' ? 'video' : 'image',
      status: ((item.status as string) ?? 'queued') as QueueItem['status'],
      isCloudAsset: Boolean(item.isCloudAsset),
    }),
    [],
  );

  const loadTodayStats = useCallback(async (engine?: any) => {
    try {
      const mod = engine || NativeModules.NativeSyncEngine;
      if (!mod) return null;
      const history = await mod.getHistoryDays('');
      if (history?.items) {
        const today = formatLocalDateKey(new Date());
        let totalFiles = 0;
        let totalBytesSum = 0;
        for (const item of history.items) {
          if ((item.ledgerDate || item.dateKey) === today) {
            totalFiles += item.fileCount || 0;
            totalBytesSum += item.totalBytes || 0;
          }
        }
        const stats = { fileCount: totalFiles, totalBytes: totalBytesSum };
        setTodayStats(stats);
        return stats;
      }
    } catch {
      /* ignore */
    }
    return null;
  }, []);

  const loadLatestSync = useCallback(
    async (engine?: any) => {
      try {
        const mod = engine || NativeModules.NativeSyncEngine;
        if (!mod) return;
        const history = await mod.getHistoryDays('');
        const items = history?.items as
          | Array<Record<string, unknown>>
          | undefined;
        if (!items?.length) {
          setLatestSync(null);
          return;
        }

        let latest: LatestSyncInfo | null = null;
        for (const item of items) {
          const updatedAt = item.updatedAt as string | undefined;
          if (!updatedAt) continue;
          if (
            !latest ||
            new Date(updatedAt).getTime() > new Date(latest.updatedAt).getTime()
          ) {
            latest = {
              updatedAt,
              deviceName:
                (item.deviceName as string) || t('common.deviceNames.default'),
            };
          }
        }
        setLatestSync(latest);
      } catch {
        /* ignore */
      }
    },
    [t],
  );

  useEffect(() => {
    if (!retryBanner) {
      setRetryCountdownSec(0);
      return;
    }

    const updateCountdown = () => {
      const remainingMs = retryBanner.retryAtMs - Date.now();
      setRetryCountdownSec(Math.max(0, Math.ceil(remainingMs / 1000)));
    };

    updateCountdown();
    const timer = setInterval(updateCountdown, 250);
    return () => clearInterval(timer);
  }, [retryBanner]);

  // ---------------------------------------------------------------------------
  // Load real data from native module
  // ---------------------------------------------------------------------------

  useEffect(() => {
    let errorSub: { remove: () => void } | undefined;
    let syncSub: { remove: () => void } | undefined;
    let queueSub: { remove: () => void } | undefined;
    let bindingSub: { remove: () => void } | undefined;
    let startupBannerTimer: ReturnType<typeof setTimeout> | undefined;

    const applyBindingState = (
      state: Record<string, unknown> | null | undefined,
    ) => {
      if (!state || !state.deviceId) {
        setBindingState(null);
        navigation.reset({ index: 0, routes: [{ name: 'DeviceDiscovery' }] });
        return false;
      }

      setBindingState({
        deviceId: state.deviceId as string,
        deviceName: (state.deviceName as string) || '',
        deviceAlias: state.deviceAlias as string | undefined,
        deviceType: state.deviceType as BindingState['deviceType'] | undefined,
        host: (state.host as string) || '',
        connectionState:
          (state.connectionState as BindingState['connectionState']) || 'bound',
      });

      const connectionState =
        (state.connectionState as BindingState['connectionState']) || 'bound';
      if (connectionState === 'connected') {
        setSuppressInitialOfflineBanner(false);
      }
      return true;
    };

    const loadReal = async () => {
      try {
        const { NativeSyncEngine } = NativeModules;
        if (!NativeSyncEngine) return;

        // Listen for errors from native engine
        const debugEmitter = new NativeEventEmitter(NativeSyncEngine);
        errorSub = debugEmitter.addListener(
          'onError',
          (error: Record<string, unknown>) => {
            console.error('[SyncStatus] Native error:', JSON.stringify(error));
          },
        );

        // Listen for binding cleared (e.g. token lost → need re-pair)
        const bindingEmitter = new NativeEventEmitter(NativeSyncEngine);
        bindingSub = bindingEmitter.addListener(
          'onBindingStateChanged',
          (state: Record<string, unknown>) => {
            applyBindingState(state);
          },
        );

        // Check binding before loading data
        const binding = await NativeSyncEngine.getBindingState();
        if (!applyBindingState(binding)) {
          return;
        }

        setSuppressInitialOfflineBanner(true);
        startupBannerTimer = setTimeout(() => {
          setSuppressInitialOfflineBanner(false);
        }, STARTUP_CONNECTION_GRACE_MS);

        // Load initial state FIRST (before triggering sync, to avoid flash)
        await loadTodayStats(NativeSyncEngine);
        await loadLatestSync(NativeSyncEngine);

        const syncData = await NativeSyncEngine.getSyncOverview();
        const initialOverview = buildOverviewFromPayload(
          syncData,
          EMPTY_OVERVIEW,
        );
        if (syncData) {
          setOverview(initialOverview);
        }

        // Load initial queue
        const queueData = await NativeSyncEngine.getReadOnlyQueue();
        const initialQueue = queueData ? queueData.map(mapQueueItem) : [];
        if (queueData) {
          setQueue(initialQueue);
        }

        const initialAutoOff =
          initialOverview.uploadState === 'paused_auto_upload' ||
          initialOverview.autoUploadState === 'interrupted' ||
          initialOverview.autoUploadState === 'disabled';
        const initialDone =
          !initialAutoOff && initialOverview.uploadState === 'completed';
        if (initialDone) {
          setHoldCompletionCardUntilMs(Date.now() + COMPLETION_CARD_HOLD_MS);
        }

        setInitialLoading(false);

        // NOW trigger sync (after initial UI render, so no flash)
        await NativeSyncEngine.startDiscovery();
        NativeSyncEngine.triggerSync?.().catch((e: Error) =>
          console.warn('[SyncStatus] triggerSync failed:', e),
        );

        // Subscribe to live updates
        const emitter = new NativeEventEmitter(NativeSyncEngine);
        syncSub = emitter.addListener(
          'onSyncStateChanged',
          (state: Record<string, unknown>) => {
            const uploadState = (state.uploadState as string) ?? undefined;
            if (uploadState === 'reconnecting') {
              const nextRetryAttempt = Number(state.retryAttempt ?? 0);
              const nextRetryDelaySec = Number(state.retryDelaySec ?? 0);
              const now = Date.now();
              setRetryBanner(prev => ({
                attempt: nextRetryAttempt,
                retryAtMs: now + Math.max(nextRetryDelaySec, 0) * 1000,
                startedAtMs: prev?.startedAtMs ?? now,
              }));
            } else if (
              uploadState === 'uploading' ||
              uploadState === 'completed'
            ) {
              setRetryBanner(null);
              setSuppressInitialOfflineBanner(false);
            }

            if (
              uploadState === 'preparing' ||
              uploadState === 'uploading' ||
              uploadState === 'reconnecting' ||
              uploadState === 'paused_no_permission'
            ) {
              setHoldCompletionCardUntilMs(null);
            }

            setOverview(prev => ({
              ...buildOverviewFromPayload(state, prev),
              currentSpeedMbps:
                uploadState === 'reconnecting'
                  ? 0
                  : ((state.currentSpeedMbps as number | undefined) ??
                    prev.currentSpeedMbps),
              retryAttempt:
                uploadState === 'reconnecting'
                  ? ((state.retryAttempt as number) ?? prev.retryAttempt ?? 0)
                  : 0,
              retryDelaySec:
                uploadState === 'reconnecting'
                  ? ((state.retryDelaySec as number) ?? prev.retryDelaySec ?? 0)
                  : 0,
            }));
            // Reload today stats when sync completes
            if (state.uploadState === 'completed') {
              loadTodayStats(NativeModules.NativeSyncEngine);
              loadLatestSync(NativeModules.NativeSyncEngine);
            }
          },
        );

        queueSub = emitter.addListener(
          'onQueueUpdated',
          (updatedQueue: Array<Record<string, unknown>>) => {
            if (updatedQueue) {
              setQueue(updatedQueue.map(mapQueueItem));
            }
          },
        );
      } catch (e) {
        console.warn('Native module not available for SyncStatus');
        setInitialLoading(false);
      }
    };

    loadReal();

    return () => {
      if (startupBannerTimer) {
        clearTimeout(startupBannerTimer);
      }
      errorSub?.remove();
      syncSub?.remove();
      queueSub?.remove();
      bindingSub?.remove();
    };
  }, [loadLatestSync, loadTodayStats, mapQueueItem, navigation]);

  useEffect(() => {
    let appState = AppState.currentState;
    let foregroundBannerTimer: ReturnType<typeof setTimeout> | undefined;
    const subscription = AppState.addEventListener(
      'change',
      (nextState: AppStateStatus) => {
        const becameActive = appState !== 'active' && nextState === 'active';
        appState = nextState;
        if (!becameActive) {
          return;
        }
        setSuppressInitialOfflineBanner(true);
        if (foregroundBannerTimer) {
          clearTimeout(foregroundBannerTimer);
        }
        foregroundBannerTimer = setTimeout(() => {
          setSuppressInitialOfflineBanner(false);
        }, STARTUP_CONNECTION_GRACE_MS);
      },
    );

    return () => {
      if (foregroundBannerTimer) {
        clearTimeout(foregroundBannerTimer);
      }
      subscription.remove();
    };
  }, []);

  const handleHistory = useCallback(() => {
    navigation.navigate('History');
  }, [navigation]);

  const handleSettings = useCallback(() => {
    navigation.navigate('Settings');
  }, [navigation]);

  const renderQueueItem = useCallback(
    ({ item, index }: ListRenderItemInfo<QueueItem>) => (
      <QueueItemRow
        item={item}
        isLast={index === queue.length - 1}
        activeFileKey={overview.currentFile}
        activeProgressPercent={overview.progressPercent}
        activeConfirmedBytes={overview.currentFileConfirmedBytes}
        activeTotalBytes={overview.currentFileTotalBytes}
        t={t}
      />
    ),
    [
      overview.currentFile,
      overview.currentFileConfirmedBytes,
      overview.currentFileTotalBytes,
      overview.progressPercent,
      queue.length,
      t,
    ],
  );

  const keyExtractor = useCallback((item: QueueItem) => item.id, []);

  const summaryTotalCount = Math.max(
    overview.totalCount,
    overview.completedCount + queue.length,
  );
  const summaryTotalBytes = Math.max(
    overview.totalBytes,
    overview.completedBytes +
      queue.reduce((sum, item) => sum + item.rawFileSize, 0),
  );
  const summaryTransferredBytes = Math.min(
    summaryTotalBytes,
    overview.completedBytes + overview.currentFileConfirmedBytes,
  );
  const queueCountDisplay = formatQueueCountDisplay(queue.length);
  const activeQueueItem = queue.find(
    item => item.fileKey.length > 0 && item.fileKey === overview.currentFile,
  );
  const activeFileName = overview.currentFilename || activeQueueItem?.name;

  // interrupted / disabled should NOT show the completion card
  const isAutoUploadOff =
    overview.uploadState === 'paused_auto_upload' ||
    overview.autoUploadState === 'interrupted' ||
    overview.autoUploadState === 'disabled';
  const isDone = !isAutoUploadOff && overview.uploadState === 'completed';
  const holdCompletionCard =
    holdCompletionCardUntilMs !== null &&
    Date.now() < holdCompletionCardUntilMs &&
    overview.uploadState !== 'preparing' &&
    overview.uploadState !== 'uploading' &&
    overview.uploadState !== 'reconnecting' &&
    overview.uploadState !== 'paused_no_permission';
  const boundDeviceName =
    bindingState?.deviceAlias ||
    bindingState?.deviceName ||
    (bindingState?.deviceType === 'win'
      ? t('common.deviceNames.windows')
      : t('common.deviceNames.default'));
  const effectiveConnectionState = getEffectiveConnectionState(
    bindingState?.connectionState,
    {
      progressPercent: overview.progressPercent,
      currentFileKey: overview.currentFile,
      queueHasActiveItem: queue.some(
        item =>
          item.status === 'preparing' ||
          item.status === 'cloud_downloading' ||
          item.status === 'uploading',
      ),
      queueHasUploadingItem: queue.some(item => item.status === 'uploading'),
      transferredBytes: overview.currentFileConfirmedBytes,
      uploadState:
        overview.uploadState === 'cloud_downloading'
          ? 'preparing'
          : overview.uploadState,
    },
  );
  const isConnectingState =
    effectiveConnectionState === 'bound' ||
    effectiveConnectionState === 'connecting' ||
    effectiveConnectionState === 'discovering';
  const isConnectionError = effectiveConnectionState === 'offline';
  const isTransferInterrupted =
    retryBanner !== null || overview.uploadState === 'reconnecting';
  const isPermissionBlocked = overview.uploadState === 'paused_no_permission';
  const suppressConnectionNotice =
    suppressInitialOfflineBanner && !isPermissionBlocked;
  const reconnectElapsedMs = retryBanner
    ? Date.now() - retryBanner.startedAtMs
    : 0;
  const isWaitingForNetworkRecovery =
    shouldTreatReconnectAsWaitingForNetworkRecovery({
      isTransferInterrupted,
      reconnectElapsedMs,
      retryAttempt: retryBanner?.attempt ?? overview.retryAttempt ?? 0,
      retryCountdownSec,
      pausedThresholdMs: RECONNECT_PAUSED_THRESHOLD_MS,
      pausedThresholdAttempt: RECONNECT_PAUSED_THRESHOLD_ATTEMPT,
    });
  const reconnectInterruptionReason = getReconnectInterruptionReason({
    deviceType: bindingState?.deviceType,
    isWaitingForNetworkRecovery,
    lastErrorCode: overview.lastErrorCode,
  });
  const isBannerError =
    isPermissionBlocked ||
    isConnectionError ||
    (isTransferInterrupted &&
      reconnectInterruptionReason !== 'transient_reconnect');
  const enableConnectionBanner = true;
  const retryAttempt = retryBanner?.attempt ?? overview.retryAttempt ?? 0;
  const transferred = formatBytes(summaryTransferredBytes);
  const total = formatBytes(summaryTotalBytes);
  const connectionNotice = isPermissionBlocked
    ? t('syncStatus.banners.permissionRequired')
    : suppressConnectionNotice
      ? null
      : isTransferInterrupted
        ? reconnectInterruptionReason === 'windows_host_interrupted'
          ? t('syncStatus.banners.windowsInterrupted', {
              device: boundDeviceName,
            })
          : reconnectInterruptionReason === 'network_recovery'
            ? t('syncStatus.banners.networkPaused')
            : t('syncStatus.banners.networkReconnecting', {
                device: boundDeviceName,
              })
        : isConnectionError
          ? t('syncStatus.banners.notConnected', { device: boundDeviceName })
          : isConnectingState
            ? t('syncStatus.banners.connecting', { device: boundDeviceName })
            : null;
  const connectionDetail = isPermissionBlocked
    ? t('syncStatus.banners.permissionDetail')
    : suppressConnectionNotice
      ? null
      : isTransferInterrupted
        ? reconnectInterruptionReason === 'windows_host_interrupted'
          ? retryCountdownSec > 0
            ? t('syncStatus.banners.progressWindowsRetry', {
                transferred,
                total,
                seconds: retryCountdownSec,
                attempt: retryAttempt,
              })
            : t('syncStatus.banners.progressWindowsNoRetry', {
                transferred,
                total,
              })
          : reconnectInterruptionReason === 'network_recovery'
            ? retryCountdownSec > 0
              ? t('syncStatus.banners.networkWithRetry', {
                  transferred,
                  total,
                  seconds: retryCountdownSec,
                  attempt: retryAttempt,
                })
              : t('syncStatus.banners.networkAutoResume', {
                  transferred,
                  total,
                })
            : retryCountdownSec > 0
              ? t('syncStatus.banners.progressWithRetry', {
                  transferred,
                  total,
                  seconds: retryCountdownSec,
                  attempt: retryAttempt,
                })
              : t('syncStatus.banners.retryingReconnect', {
                  transferred,
                  total,
                })
        : isConnectionError
          ? t('syncStatus.banners.connectionErrorResume')
          : isConnectingState
            ? t('syncStatus.banners.connectingAutoResume')
            : null;

  useEffect(() => {
    if (!connectionNotice) {
      setShowConnectionBanner(false);
      return;
    }

    if (isPermissionBlocked) {
      setShowConnectionBanner(true);
      return;
    }

    const timer = setTimeout(() => {
      setShowConnectionBanner(true);
    }, CONNECTION_BANNER_SHOW_DELAY_MS);

    return () => clearTimeout(timer);
  }, [connectionNotice, isPermissionBlocked]);

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      {/* ---- Header ---- */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('syncActivity.title')}</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={handleHistory}
            style={styles.headerBtn}
            activeOpacity={0.6}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityLabel={t('history.title')}
          >
            <Icon name="time-outline" size={20} color="#4a6a8a" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleSettings}
            style={styles.headerBtn}
            activeOpacity={0.6}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityLabel={t('settings.title')}
          >
            <Icon name="settings-outline" size={20} color="#4a6a8a" />
          </TouchableOpacity>
        </View>
      </View>

      {isAndroid ? (
        <View style={styles.androidNoticeCard}>
          <Text style={styles.androidNoticeTitle}>
            {t('settings.android.title')}
          </Text>
          <Text style={styles.androidNoticeBody}>
            {t('settings.android.body')}
          </Text>
        </View>
      ) : null}

      {initialLoading ||
      !enableConnectionBanner ||
      !connectionNotice ||
      !showConnectionBanner ? null : (
        <View
          style={[
            styles.connectionBanner,
            styles.connectionBannerFloating,
            { top: 106 }, // Header height (56) + 50px offset
            isBannerError
              ? styles.connectionBannerError
              : styles.connectionBannerWarning,
          ]}
        >
          <Icon
            name={isBannerError ? 'alert-circle-outline' : 'sync-outline'}
            size={18}
            color={isBannerError ? '#b91c1c' : '#9a3412'}
          />
          <View style={styles.connectionBannerCopy}>
            <Text
              style={[
                styles.connectionBannerText,
                isBannerError
                  ? styles.connectionBannerTextError
                  : styles.connectionBannerTextWarning,
              ]}
            >
              {connectionNotice}
            </Text>
            {connectionDetail ? (
              <Text
                style={[
                  styles.connectionBannerDetail,
                  isBannerError
                    ? styles.connectionBannerDetailError
                    : styles.connectionBannerDetailWarning,
                ]}
              >
                {connectionDetail}
              </Text>
            ) : null}
            {isPermissionBlocked ? (
              <Pressable
                onPress={() => {
                  void Linking.openSettings();
                }}
                style={styles.connectionBannerAction}
              >
                <Text style={styles.connectionBannerActionText}>
                  {t('settings.photoPermission.openSettings')}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      )}

      {initialLoading ? null : isDone || holdCompletionCard ? (
        /* ---- Completion card ---- */
        <View style={styles.progressCard}>
          <CompletionCard
            fileCount={todayStats.fileCount}
            totalSize={formatBytes(todayStats.totalBytes)}
            latestSyncLabel={
              latestSync
                ? `${formatDateTimeLabel(latestSync.updatedAt, t)} - ${latestSync.deviceName}`
                : undefined
            }
            t={t}
          />
        </View>
      ) : (
        <>
          <SyncPerformanceHint
            uploadState={overview.uploadState}
            performanceHint={overview.performanceHint}
            performanceMessage={overview.performanceMessage}
          />

          {/* ---- Progress card ---- */}
          <View style={styles.progressCard}>
            <SyncSummaryCard
              uploadState={overview.uploadState}
              completedCount={overview.completedCount}
              totalCount={summaryTotalCount}
              transferredBytes={summaryTransferredBytes}
              totalBytes={summaryTotalBytes}
              currentSpeedMbps={overview.currentSpeedMbps}
              activeFileName={activeFileName}
              t={t}
            />
          </View>

          {/* ---- Queue card ---- */}
          <View style={styles.queueCard}>
            <View style={styles.queueHeader}>
              <Text style={styles.queueTitle}>
                {t('albumWorkbench.badges.queued')}
              </Text>
              <View style={styles.queueBadge}>
                <Text style={styles.queueBadgeText}>{queueCountDisplay}</Text>
              </View>
            </View>
            <FlatList<QueueItem>
              data={queue}
              renderItem={renderQueueItem}
              keyExtractor={keyExtractor}
              scrollEnabled={true}
              showsVerticalScrollIndicator={false}
            />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: SCREEN_BG,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    zIndex: 30, // Must be above connectionBannerFloating (zIndex: 20)
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: DARK,
  },
  androidNoticeCard: {
    marginHorizontal: 20,
    marginBottom: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.76)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.88)',
  },
  androidNoticeTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#28597e',
    marginBottom: 6,
  },
  androidNoticeBody: {
    fontSize: 12,
    lineHeight: 18,
    color: '#5d7f98',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectionBanner: {
    marginHorizontal: 20,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  connectionBannerFloating: {
    position: 'absolute',
    left: 20,
    right: 20,
    marginHorizontal: 0,
    zIndex: 20,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 8,
  },
  connectionBannerCopy: {
    flex: 1,
    gap: 4,
  },
  connectionBannerAction: {
    alignSelf: 'flex-start',
    marginTop: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(185,28,28,0.08)',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  connectionBannerActionText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#991b1b',
  },
  connectionBannerError: {
    backgroundColor: 'rgba(254,226,226,0.94)',
    borderColor: 'rgba(220,38,38,0.18)',
  },
  connectionBannerWarning: {
    backgroundColor: 'rgba(255,243,199,0.92)',
    borderColor: 'rgba(217,119,6,0.18)',
  },
  connectionBannerText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  connectionBannerDetail: {
    fontSize: 12,
    lineHeight: 17,
  },
  connectionBannerTextError: {
    color: '#991b1b',
  },
  connectionBannerDetailError: {
    color: '#b91c1c',
  },
  connectionBannerTextWarning: {
    color: '#8a4b08',
  },
  connectionBannerDetailWarning: {
    color: '#9a3412',
  },

  // Progress card
  progressCard: {
    marginHorizontal: 20,
    marginTop: 16,
    borderRadius: 24,
    paddingVertical: 28,
    paddingHorizontal: 24,
    backgroundColor: CARD_BG,
    shadowColor: '#50a0d2',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 32,
    elevation: 4,
  },
  summaryEyebrow: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: BLUE,
    textTransform: 'uppercase',
  },
  summaryTitle: {
    marginTop: 8,
    fontSize: 28,
    fontWeight: '700',
    color: DARK,
    lineHeight: 34,
  },
  summaryStats: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 18,
  },
  summaryStatCard: {
    flex: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(126,184,216,0.18)',
  },
  summaryStatLabel: {
    fontSize: 12,
    color: BLUE_MUTED,
  },
  summaryStatValue: {
    marginTop: 6,
    fontSize: 15,
    fontWeight: '700',
    color: DARK_FILE,
  },
  summaryCurrentFile: {
    marginTop: 14,
    fontSize: 13,
    color: '#587894',
  },
  lastSyncText: {
    marginTop: 8,
    fontSize: 12,
    color: '#8aa7ba',
  },

  // Circular progress ring
  ringContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringTrack: {
    position: 'absolute',
  },
  ringDot: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  ringCentre: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  transmittingLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 2,
    color: BLUE_LIGHT,
    textTransform: 'uppercase',
  },
  percentageText: {
    fontSize: 42,
    fontWeight: '700',
    color: BLUE,
    lineHeight: 48,
    marginTop: 2,
  },
  speedText: {
    fontSize: 14,
    fontWeight: '600',
    color: BLUE,
    marginTop: 4,
  },

  // Queue card
  queueCard: {
    flex: 1,
    marginHorizontal: 20,
    marginTop: 20,
    marginBottom: 20,
    borderRadius: 24,
    backgroundColor: QUEUE_CARD_BG,
    shadowColor: '#50a0d2',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 3,
    overflow: 'hidden',
  },
  queueHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: QUEUE_SEPARATOR,
  },
  queueTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: DARK,
  },
  queueBadge: {
    height: 20,
    minWidth: 20,
    borderRadius: 10,
    backgroundColor: BLUE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  queueBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ffffff',
  },

  // Queue list row
  queueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#ffffff',
  },
  queueRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: SEPARATOR,
  },
  queueIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: ICON_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  queueInfo: {
    flex: 1,
    minWidth: 0,
  },
  queueFileName: {
    fontSize: 14,
    fontWeight: '600',
    color: DARK_FILE,
  },
  queueFileSize: {
    fontSize: 12,
    color: MUTED_FILE,
    marginTop: 2,
  },
  queueFileMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 2,
  },
  itemProgressGroup: {
    marginTop: 10,
    gap: 6,
  },
  itemProgressTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(59,159,216,0.12)',
    overflow: 'hidden',
  },
  itemProgressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: BLUE,
  },
  itemProgressText: {
    fontSize: 12,
    color: '#587894',
  },

  // Uploading row highlight
  queueRowUploading: {
    backgroundColor: UPLOADING_BG,
    borderLeftWidth: 3,
    borderLeftColor: UPLOADING_BORDER,
  },
  cloudAssetBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(59,159,216,0.12)',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  cloudAssetLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: BLUE,
  },
  uploadingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(59,159,216,0.12)',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  uploadingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: BLUE,
  },
  uploadingLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: BLUE,
  },

  // Completion card
  completionContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
  },
  completionGlow: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(59,159,216,0.12)',
  },
  completionCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 4,
    borderColor: '#c5e5f5',
    backgroundColor: 'rgba(59,159,216,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  completionTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: BLUE,
    letterSpacing: -0.3,
  },
  completionMeta: {
    alignItems: 'center',
    gap: 4,
    marginTop: 16,
  },
  completionStats: {
    fontSize: 16,
    fontWeight: '700',
    color: BLUE,
  },
  completionSubtext: {
    fontSize: 12,
    color: '#9bb8c8',
  },
});
