import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  NativeModules,
  NativeEventEmitter,
  Linking,
  AppState,
  type AppStateStatus,
  type ListRenderItemInfo,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { Icon } from '../components/Icon';
import { formatLocalDateKey } from '../utils/localDateKey';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SyncStatusNav = StackNavigationProp<RootStackParamList, 'SyncStatus'>;

interface QueueItem {
  id: string;
  name: string;
  size: string;
  type: 'video' | 'image';
  status: 'queued' | 'preparing' | 'cloud_downloading' | 'uploading' | 'completed';
  isCloudAsset: boolean;
}

interface SyncOverview {
  progressPercent: number;
  speed: string;
  completed: string;
  total: string;
  uploadState: string;
  retryAttempt?: number;
  retryDelaySec?: number;
}

interface BindingState {
  deviceId: string;
  deviceName: string;
  deviceAlias?: string;
  deviceType?: 'mac' | 'win';
  host: string;
  connectionState: 'bound' | 'connecting' | 'connected' | 'offline' | 'discovering';
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

const RING_SIZE = 200;
const RING_THICKNESS = 9;
const RECONNECT_PAUSED_THRESHOLD_MS = 15_000;
const RECONNECT_PAUSED_THRESHOLD_ATTEMPT = 3;
const STARTUP_CONNECTION_GRACE_MS = 2500;
const CONNECTION_BANNER_SHOW_DELAY_MS = 700;
const COMPLETION_CARD_HOLD_MS = 1200;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fileIcon(type: 'video' | 'image'): React.ReactElement {
  return type === 'video'
    ? <Icon name="videocam-outline" size={16} color="#3b82f6" />
    : <Icon name="image-outline" size={16} color="#06b6d4" />;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatDateTimeLabel(iso?: string): string {
  if (!iso) return '暂无记录';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '暂无记录';

  const now = new Date();
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  if (date.toDateString() === now.toDateString()) {
    return `今天 ${time}`;
  }
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
  }
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${time}`;
}

/**
 * Build an array of small arc segments for the circular progress ring.
 */
function buildRingSegments(progress: number): Array<{ angle: number; active: boolean }> {
  const TOTAL_SEGMENTS = 72;
  const filled = Math.round((progress / 100) * TOTAL_SEGMENTS);
  const segments: Array<{ angle: number; active: boolean }> = [];
  for (let i = 0; i < TOTAL_SEGMENTS; i++) {
    segments.push({ angle: (360 / TOTAL_SEGMENTS) * i - 90, active: i < filled });
  }
  return segments;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CircularProgress({ progress, speed }: { progress: number; speed: string }) {
  const segments = buildRingSegments(progress);
  const centre = RING_SIZE / 2;
  const radius = (RING_SIZE - RING_THICKNESS) / 2;

  return (
    <View style={[styles.ringContainer, { width: RING_SIZE, height: RING_SIZE }]}>
      {/* Background track */}
      <View
        style={[
          styles.ringTrack,
          {
            width: RING_SIZE,
            height: RING_SIZE,
            borderRadius: RING_SIZE / 2,
            borderWidth: RING_THICKNESS,
            borderColor: RING_BG,
          },
        ]}
      />

      {/* Progress segments */}
      {segments.map((seg) => {
        const rad = (seg.angle * Math.PI) / 180;
        const x = centre + radius * Math.cos(rad) - 3;
        const y = centre + radius * Math.sin(rad) - 3;
        return (
          <View
            key={seg.angle}
            style={[
              styles.ringDot,
              {
                left: x,
                top: y,
                backgroundColor: seg.active ? BLUE : RING_BG,
              },
            ]}
          />
        );
      })}

      {/* Centre content */}
      <View style={styles.ringCentre}>
        <Text style={styles.transmittingLabel}>TRANSMITTING</Text>
        <Text style={styles.percentageText}>{progress}%</Text>
        <Text style={styles.speedText}>{speed}</Text>
      </View>
    </View>
  );
}

function CompletionCard({
  fileCount,
  totalSize,
  latestSyncLabel,
}: {
  fileCount: number;
  totalSize: string;
  latestSyncLabel?: string;
}) {
  return (
    <View style={styles.completionContainer}>
      {/* Glow backdrop */}
      <View style={styles.completionGlow} />
      {/* Checkmark circle */}
      <View style={styles.completionCircle}>
        <Icon name="checkmark-circle" size={64} color="#22c55e" />
      </View>
      <Text style={styles.completionTitle}>{'所有文件已同步'}</Text>
      <View style={styles.completionMeta}>
        <Text style={styles.completionStats}>
          {fileCount} {'个文件'} {'·'} {totalSize}
        </Text>
        <Text style={styles.completionSubtext}>{'本次同步已全部完成'}</Text>
        {latestSyncLabel ? (
          <Text style={styles.lastSyncText}>{`最近一次成功同步：${latestSyncLabel}`}</Text>
        ) : null}
      </View>
    </View>
  );
}

function QueueItemRow({ item, isLast }: { item: QueueItem; isLast: boolean }) {
  const isUploading = item.status === 'uploading';
  return (
    <View
      style={[
        styles.queueRow,
        !isLast && styles.queueRowBorder,
        isUploading && styles.queueRowUploading,
      ]}
    >
      <View style={styles.queueIcon}>
        {fileIcon(item.type)}
      </View>
      <View style={styles.queueInfo}>
        <Text style={styles.queueFileName} numberOfLines={1}>
          {item.name}
        </Text>
        <View style={styles.queueFileMeta}>
          <Text style={styles.queueFileSize}>{item.size}</Text>
          {isUploading && (
            <View style={styles.uploadingBadge}>
              <View style={styles.uploadingDot} />
              <Text style={styles.uploadingLabel}>{'传输中'}</Text>
            </View>
          )}
          {item.isCloudAsset && (
            <View style={styles.cloudAssetBadge}>
              <Icon name="cloud-outline" size={11} color={BLUE} />
              <Text style={styles.cloudAssetLabel}>{'iCloud'}</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export function SyncStatusScreen() {
  const navigation = useNavigation<SyncStatusNav>();
  const insets = useSafeAreaInsets();
  const [overview, setOverview] = useState<SyncOverview>({
    progressPercent: 0,
    speed: '0 MB/s',
    completed: '0 B',
    total: '0 B',
    uploadState: 'idle',
    retryAttempt: 0,
    retryDelaySec: 0,
  });
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [todayStats, setTodayStats] = useState({ fileCount: 0, totalBytes: 0 });
  const [initialLoading, setInitialLoading] = useState(true);
  const [bindingState, setBindingState] = useState<BindingState | null>(null);
  const [retryBanner, setRetryBanner] = useState<RetryBannerState | null>(null);
  const [retryCountdownSec, setRetryCountdownSec] = useState(0);
  const [latestSync, setLatestSync] = useState<LatestSyncInfo | null>(null);
  const [suppressInitialOfflineBanner, setSuppressInitialOfflineBanner] = useState(false);
  const [showConnectionBanner, setShowConnectionBanner] = useState(false);
  const [holdCompletionCardUntilMs, setHoldCompletionCardUntilMs] = useState<number | null>(null);

  const mapQueueItem = useCallback((item: Record<string, unknown>, index: number): QueueItem => ({
    id: String(item.id ?? index),
    name: (item.originalFilename as string) || 'Unknown',
    size: formatBytes((item.fileSize as number) ?? 0),
    type: (item.mediaType as string) === 'video' ? 'video' : 'image',
    status: ((item.status as string) ?? 'queued') as QueueItem['status'],
    isCloudAsset: Boolean(item.isCloudAsset),
  }), []);

  const loadTodayStats = useCallback(async (engine?: any) => {
    try {
      const mod = engine || NativeModules.NativeSyncEngine;
      if (!mod) return null;
      const history = await mod.getHistoryDays(null);
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
    } catch { /* ignore */ }
    return null;
  }, []);

  const loadLatestSync = useCallback(async (engine?: any) => {
    try {
      const mod = engine || NativeModules.NativeSyncEngine;
      if (!mod) return;
      const history = await mod.getHistoryDays(null);
      const items = history?.items as Array<Record<string, unknown>> | undefined;
      if (!items?.length) {
        setLatestSync(null);
        return;
      }

      let latest: LatestSyncInfo | null = null;
      for (const item of items) {
        const updatedAt = item.updatedAt as string | undefined;
        if (!updatedAt) continue;
        if (!latest || new Date(updatedAt).getTime() > new Date(latest.updatedAt).getTime()) {
          latest = {
            updatedAt,
            deviceName: (item.deviceName as string) || '电脑',
          };
        }
      }
      setLatestSync(latest);
    } catch { /* ignore */ }
  }, []);

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

    const applyBindingState = (state: Record<string, unknown> | null | undefined) => {
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
        connectionState: ((state.connectionState as BindingState['connectionState']) || 'bound'),
      });

      const connectionState = (state.connectionState as BindingState['connectionState']) || 'bound';
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
        errorSub = debugEmitter.addListener('onError', (error: Record<string, unknown>) => {
          console.error('[SyncStatus] Native error:', JSON.stringify(error));
        });

        // Listen for binding cleared (e.g. token lost → need re-pair)
        const bindingEmitter = new NativeEventEmitter(NativeSyncEngine);
        bindingSub = bindingEmitter.addListener('onBindingStateChanged', (state: Record<string, unknown>) => {
          applyBindingState(state);
        });

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
        const loadedTodayStats = await loadTodayStats(NativeSyncEngine);
        await loadLatestSync(NativeSyncEngine);

        const syncData = await NativeSyncEngine.getSyncOverview();
        const initialOverview: SyncOverview = syncData ? {
          progressPercent: syncData.progressPercent ?? 0,
          speed: syncData.currentSpeedMbps ? `${syncData.currentSpeedMbps} MB/s` : '0 MB/s',
          completed: formatBytes(syncData.transferredBytes ?? 0),
          total: formatBytes(syncData.totalBytes ?? 0),
          uploadState: syncData.uploadState ?? 'idle',
          retryAttempt: 0,
          retryDelaySec: 0,
        } : {
          progressPercent: 0,
          speed: '0 MB/s',
          completed: '0 B',
          total: '0 B',
          uploadState: 'idle',
          retryAttempt: 0,
          retryDelaySec: 0,
        };
        if (syncData) {
          setOverview(initialOverview);
        }

        // Load initial queue
        const queueData = await NativeSyncEngine.getReadOnlyQueue();
        const initialQueue = queueData
          ? queueData.map(mapQueueItem)
          : [];
        if (queueData) {
          setQueue(initialQueue);
        }

        const initialDone =
          initialOverview.uploadState === 'completed' ||
          (
            initialOverview.uploadState === 'idle' &&
            initialQueue.length === 0 &&
            (initialOverview.progressPercent >= 100 || (loadedTodayStats?.fileCount ?? 0) > 0)
          );
        if (initialDone) {
          setHoldCompletionCardUntilMs(Date.now() + COMPLETION_CARD_HOLD_MS);
        }

        setInitialLoading(false);

        // NOW trigger sync (after initial UI render, so no flash)
        await NativeSyncEngine.startDiscovery();
        NativeSyncEngine.triggerSync?.()
          .catch((e: Error) => console.warn('[SyncStatus] triggerSync failed:', e));

        // Subscribe to live updates
        const emitter = new NativeEventEmitter(NativeSyncEngine);
        syncSub = emitter.addListener('onSyncStateChanged', (state: Record<string, unknown>) => {
          const uploadState = (state.uploadState as string) ?? undefined;
          if (uploadState === 'reconnecting') {
            const nextRetryAttempt = Number(state.retryAttempt ?? 0);
            const nextRetryDelaySec = Number(state.retryDelaySec ?? 0);
            const now = Date.now();
            setRetryBanner((prev) => ({
              attempt: nextRetryAttempt,
              retryAtMs: now + Math.max(nextRetryDelaySec, 0) * 1000,
              startedAtMs: prev?.startedAtMs ?? now,
            }));
          } else if (uploadState === 'uploading' || uploadState === 'completed') {
            setRetryBanner(null);
            setSuppressInitialOfflineBanner(false);
          }

          if (uploadState === 'preparing' || uploadState === 'uploading' || uploadState === 'reconnecting' || uploadState === 'paused_no_permission') {
            setHoldCompletionCardUntilMs(null);
          }

          setOverview((prev) => ({
            ...prev,
            progressPercent: (state.progressPercent as number) ?? prev.progressPercent,
            speed: uploadState === 'reconnecting'
              ? '0 MB/s'
              : state.currentSpeedMbps !== undefined && state.currentSpeedMbps !== null
                ? `${state.currentSpeedMbps} MB/s`
                : prev.speed,
            completed: state.transferredBytes !== undefined && state.transferredBytes !== null
              ? formatBytes(state.transferredBytes as number)
              : prev.completed,
            total: state.totalBytes !== undefined && state.totalBytes !== null
              ? formatBytes(state.totalBytes as number)
              : prev.total,
            uploadState: uploadState ?? prev.uploadState,
            retryAttempt: uploadState === 'reconnecting'
              ? ((state.retryAttempt as number) ?? prev.retryAttempt ?? 0)
              : 0,
            retryDelaySec: uploadState === 'reconnecting'
              ? ((state.retryDelaySec as number) ?? prev.retryDelaySec ?? 0)
              : 0,
          }));
          // Reload today stats when sync completes
          if (state.uploadState === 'completed') {
            loadTodayStats(NativeModules.NativeSyncEngine);
            loadLatestSync(NativeModules.NativeSyncEngine);
          }
        });

        queueSub = emitter.addListener('onQueueUpdated', (updatedQueue: Array<Record<string, unknown>>) => {
          if (updatedQueue) {
            setQueue(updatedQueue.map(mapQueueItem));
          }
        });
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
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
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
    });

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
      <QueueItemRow item={item} isLast={index === queue.length - 1} />
    ),
    [queue.length],
  );

  const keyExtractor = useCallback((item: QueueItem) => item.id, []);

  const isDone = overview.uploadState === 'completed' ||
    (overview.uploadState === 'idle' && queue.length === 0 && (overview.progressPercent >= 100 || todayStats.fileCount > 0));
  const holdCompletionCard =
    holdCompletionCardUntilMs !== null &&
    Date.now() < holdCompletionCardUntilMs &&
    overview.uploadState !== 'preparing' &&
    overview.uploadState !== 'uploading' &&
    overview.uploadState !== 'reconnecting' &&
    overview.uploadState !== 'paused_no_permission';
  const boundDeviceName = bindingState?.deviceAlias || bindingState?.deviceName || (
    bindingState?.deviceType === 'win' ? 'Windows 电脑' : '电脑'
  );
  const isConnectingState =
    bindingState?.connectionState === 'bound' ||
    bindingState?.connectionState === 'connecting' ||
    bindingState?.connectionState === 'discovering';
  const isConnectionError = bindingState?.connectionState === 'offline';
  const isTransferInterrupted = retryBanner !== null || overview.uploadState === 'reconnecting';
  const isPermissionBlocked = overview.uploadState === 'paused_no_permission';
  const suppressConnectionNotice = suppressInitialOfflineBanner && !isPermissionBlocked;
  const reconnectElapsedMs = retryBanner ? Date.now() - retryBanner.startedAtMs : 0;
  const isWaitingForNetworkRecovery = isTransferInterrupted && (
    reconnectElapsedMs >= RECONNECT_PAUSED_THRESHOLD_MS ||
    (retryBanner?.attempt ?? overview.retryAttempt ?? 0) >= RECONNECT_PAUSED_THRESHOLD_ATTEMPT
  );
  const isTransientReconnect = isTransferInterrupted && !isWaitingForNetworkRecovery;
  const isBannerError =
    isPermissionBlocked ||
    isConnectionError ||
    (isTransferInterrupted && isWaitingForNetworkRecovery);
  const enableConnectionBanner = true;
  const connectionNotice = (
    isPermissionBlocked
      ? '需要授予照片访问权限。'
      : suppressConnectionNotice
      ? null
      : isTransferInterrupted
      ? (
        isWaitingForNetworkRecovery
          ? '传输已暂停，等待网络恢复。'
          : `网络波动，正在重连“${boundDeviceName}”。`
      )
      : isConnectionError
      ? (
        `未连接到“${boundDeviceName}”，请确认电脑端 SyncFlow 正在运行。`
      )
      : isConnectingState
        ? `正在连接到“${boundDeviceName}”。`
        : null
  );
  const connectionDetail = (
    isPermissionBlocked
      ? '打开系统设置后允许访问照片，恢复后会自动继续同步。'
      : suppressConnectionNotice
      ? null
      : isTransferInterrupted
      ? (
        isWaitingForNetworkRecovery
          ? (
            retryCountdownSec > 0
              ? `已保留当前进度 ${overview.completed} / ${overview.total}，网络恢复后将在 ${retryCountdownSec} 秒后发起第 ${retryBanner?.attempt ?? overview.retryAttempt ?? 0} 次重试。`
              : `已保留当前进度 ${overview.completed} / ${overview.total}，网络恢复后会自动继续。`
          )
          : (
            retryCountdownSec > 0
              ? `已保留当前进度 ${overview.completed} / ${overview.total}，将在 ${retryCountdownSec} 秒后发起第 ${retryBanner?.attempt ?? overview.retryAttempt ?? 0} 次重试。`
              : `已保留当前进度 ${overview.completed} / ${overview.total}，正在重新建立连接。`
          )
      )
      : isConnectionError
        ? '恢复网络或重新打开电脑端 SyncFlow 后会自动继续。'
        : isConnectingState
        ? '连接建立后会自动继续当前同步任务。'
        : null
  );

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
        <Text style={styles.headerTitle}>{'同步动态'}</Text>
        <View style={styles.headerActions}>
          <Pressable
            onPress={handleHistory}
            style={styles.headerBtn}
            accessibilityLabel={'历史记录'}
          >
            <Icon name="time-outline" size={20} color="#4a6a8a" />
          </Pressable>
          <Pressable
            onPress={handleSettings}
            style={styles.headerBtn}
            accessibilityLabel={'设置'}
          >
            <Icon name="settings-outline" size={20} color="#4a6a8a" />
          </Pressable>
        </View>
      </View>

      {initialLoading || !enableConnectionBanner || !connectionNotice || !showConnectionBanner ? null : (
        <View
          style={[
            styles.connectionBanner,
            styles.connectionBannerFloating,
            { top: insets.top + 56 },
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
                <Text style={styles.connectionBannerActionText}>{'打开系统设置'}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      )}

      {initialLoading ? null : (isDone || holdCompletionCard) ? (
        /* ---- Completion card ---- */
        <View style={styles.progressCard}>
          <CompletionCard
            fileCount={todayStats.fileCount}
            totalSize={formatBytes(todayStats.totalBytes)}
            latestSyncLabel={latestSync ? `${formatDateTimeLabel(latestSync.updatedAt)} · ${latestSync.deviceName}` : undefined}
          />
        </View>
      ) : (
        <>
          {/* ---- Progress card ---- */}
          <View style={styles.progressCard}>
            <CircularProgress progress={overview.progressPercent} speed={overview.speed} />
            <Text style={styles.completedText}>
              {'已完成 '}{overview.completed}{' / '}{overview.total}
            </Text>
          </View>

          {/* ---- Queue card ---- */}
          <View style={styles.queueCard}>
            <View style={styles.queueHeader}>
              <Text style={styles.queueTitle}>{'排队中'}</Text>
              <View style={styles.queueBadge}>
                <Text style={styles.queueBadgeText}>{queue.length}</Text>
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
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: DARK,
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
    paddingVertical: 32,
    paddingHorizontal: 24,
    alignItems: 'center',
    backgroundColor: CARD_BG,
    shadowColor: '#50a0d2',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 32,
    elevation: 4,
  },
  completedText: {
    marginTop: 20,
    fontSize: 14,
    color: BLUE_MUTED,
  },
  pendingText: {
    marginTop: 6,
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
    gap: 8,
    marginTop: 2,
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
