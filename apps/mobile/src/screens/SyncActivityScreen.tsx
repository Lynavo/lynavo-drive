import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  NativeModules,
  NativeEventEmitter,
  Alert,
  AppState,
  Platform,
  type AppStateStatus,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useNavigation,
  CommonActions,
} from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { UploadTaskSource, AutoUploadState } from '@syncflow/contracts';
import { Icon } from '../components/Icon';
import {
  pauseAutoUpload,
  resumeAutoUpload,
  cancelManualBatch,
} from '../services/SyncEngineModule';
import { formatBytes } from '../utils/format';
import { formatLocalDateKey } from '../utils/localDateKey';
import { getEffectiveConnectionState } from '../utils/effectiveConnectionState';
import type { MainTabParamList } from '../navigation/RootNavigator';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SyncActivityNav = BottomTabNavigationProp<MainTabParamList, 'SyncActivity'>;

interface SyncOverview {
  progressPercent: number;
  currentSpeedMbps: number;
  uploadState: string;
  completedCount: number;
  totalCount: number;
  completedBytes: number;
  totalBytes: number;
  currentFile?: string;
  currentFilename?: string;
  currentFileConfirmedBytes: number;
  currentFileTotalBytes: number;
  currentTaskSource?: UploadTaskSource | null;
  autoUploadState?: AutoUploadState;
  manualBatchPending?: number;
  autoPending?: number;
  lastErrorCode?: string;
}

interface BindingState {
  deviceId: string;
  deviceName: string;
  deviceAlias?: string;
  deviceType?: 'mac' | 'win';
  host: string;
  connectionState:
    | 'bound'
    | 'connecting'
    | 'connected'
    | 'offline'
    | 'discovering';
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BLUE = '#3b9fd8';
const DARK = '#1a3a5c';
const SCREEN_BG = '#d6ecf8';
const CARD_BG = 'rgba(255,255,255,0.62)';

const EMPTY_OVERVIEW: SyncOverview = {
  progressPercent: 0,
  currentSpeedMbps: 0,
  uploadState: 'idle',
  completedCount: 0,
  totalCount: 0,
  completedBytes: 0,
  totalBytes: 0,
  currentFileConfirmedBytes: 0,
  currentFileTotalBytes: 0,
  currentTaskSource: null,
  autoUploadState: 'disabled',
  manualBatchPending: 0,
  autoPending: 0,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSpeedMbps(speedMbps: number): string {
  if (!Number.isFinite(speedMbps) || speedMbps <= 0) {
    return '0 MB/s';
  }
  return `${speedMbps >= 10 ? speedMbps.toFixed(0) : speedMbps.toFixed(1)} MB/s`;
}

function uploadStateLabel(state: string): string {
  switch (state) {
    case 'uploading':
      return '正在同步';
    case 'preparing':
      return '准备同步';
    case 'scanning':
      return '扫描中';
    case 'cloud_downloading':
      return '准备素材中';
    case 'reconnecting':
      return '等待重连';
    case 'completed':
      return '已完成';
    case 'paused_no_permission':
      return '等待权限';
    case 'paused_auto_upload':
      return '自动上传已暂停';
    default:
      return '空闲';
  }
}

// ---------------------------------------------------------------------------
// SyncActivityScreen
// ---------------------------------------------------------------------------

export function SyncActivityScreen() {
  const navigation = useNavigation<SyncActivityNav>();
  const [overview, setOverview] = useState<SyncOverview>(EMPTY_OVERVIEW);
  const [bindingState, setBindingState] = useState<BindingState | null>(null);
  const [todayStats, setTodayStats] = useState({ fileCount: 0, totalBytes: 0 });
  const [initialLoading, setInitialLoading] = useState(true);
  const [cancellingBatch, setCancellingBatch] = useState(false);

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  const loadTodayStats = useCallback(async (engine?: Record<string, Function>) => {
    try {
      const mod = engine ?? NativeModules.NativeSyncEngine;
      if (!mod) return;
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
        setTodayStats({ fileCount: totalFiles, totalBytes: totalBytesSum });
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    let syncSub: { remove: () => void } | undefined;
    let bindingSub: { remove: () => void } | undefined;
    let errorSub: { remove: () => void } | undefined;

    const applyBindingState = (
      state: Record<string, unknown> | null | undefined,
    ) => {
      if (!state || !state.deviceId) {
        setBindingState(null);
        // Navigate back to pairing flow when binding is lost
        navigation.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [{ name: 'DeviceDiscovery' }],
          }),
        );
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
      return true;
    };

    const loadReal = async () => {
      try {
        const { NativeSyncEngine } = NativeModules;
        if (!NativeSyncEngine) return;

        const emitter = new NativeEventEmitter(NativeSyncEngine);

        bindingSub = emitter.addListener(
          'onBindingStateChanged',
          (state: Record<string, unknown>) => {
            applyBindingState(state);
          },
        );

        const binding = await NativeSyncEngine.getBindingState();
        applyBindingState(binding);

        await loadTodayStats(NativeSyncEngine);

        const syncData = await NativeSyncEngine.getSyncOverview();
        if (syncData) {
          setOverview(prev => buildOverview(syncData, prev));
        }

        setInitialLoading(false);

        await NativeSyncEngine.startDiscovery();
        NativeSyncEngine.triggerSync?.().catch((e: Error) => {
          console.warn('[SyncActivity] triggerSync failed:', e);
          Alert.alert('触发同步失败', '请稍后重试');
        });

        syncSub = emitter.addListener(
          'onSyncStateChanged',
          (state: Record<string, unknown>) => {
            setOverview(prev => buildOverview(state, prev));
            if (state.uploadState === 'completed') {
              void loadTodayStats();
            }
          },
        );

        errorSub = emitter.addListener(
          'onError',
          (error: { code?: string; message?: string }) => {
            const msg = error?.message || '发生未知错误';
            Alert.alert('同步异常', msg);
          },
        );
      } catch (e) {
        console.warn('[SyncActivity] loadReal error:', e);
        setInitialLoading(false);
      }
    };

    void loadReal();

    return () => {
      syncSub?.remove();
      bindingSub?.remove();
      errorSub?.remove();
    };
  }, [loadTodayStats]);

  // Foreground refresh
  useEffect(() => {
    let appState = AppState.currentState;
    const subscription = AppState.addEventListener(
      'change',
      (nextState: AppStateStatus) => {
        if (appState !== 'active' && nextState === 'active') {
          void loadTodayStats();
        }
        appState = nextState;
      },
    );
    return () => subscription.remove();
  }, [loadTodayStats]);

  // ---------------------------------------------------------------------------
  // Control handlers
  // ---------------------------------------------------------------------------

  const handlePauseAutoUpload = useCallback(async () => {
    try {
      await pauseAutoUpload();
    } catch (e) {
      console.warn('[SyncActivity] pauseAutoUpload error:', e);
      Alert.alert('暂停失败', '无法暂停自动上传，请稍后重试');
    }
  }, []);

  const handleResumeAutoUpload = useCallback(async () => {
    try {
      await resumeAutoUpload();
    } catch (e) {
      console.warn('[SyncActivity] resumeAutoUpload error:', e);
      Alert.alert('恢复失败', '无法恢复自动上传，请稍后重试');
    }
  }, []);

  const handleCancelManualBatch = useCallback(() => {
    Alert.alert('取消手动上传', '确定取消当前的手动上传批次吗？', [
      { text: '再想想', style: 'cancel' },
      {
        text: '确认取消',
        style: 'destructive',
        onPress: async () => {
          try {
            setCancellingBatch(true);
            // Query the pending queue to find the current manual batch ID.
            // cancelManualBatch requires a real batchId — an empty string
            // matches nothing in the SQL WHERE clause.
            const queue = await NativeModules.NativeSyncEngine?.getReadOnlyQueue();
            const manualItem = (queue as Array<Record<string, unknown>> | undefined)?.find(
              (item) => item.source === 'manual' && typeof item.batchId === 'string' && item.batchId !== '',
            );
            const batchId = (manualItem?.batchId as string) ?? '';
            if (!batchId) {
              console.warn('[SyncActivity] no active manual batchId found');
              return;
            }
            await cancelManualBatch(batchId);
          } catch (e) {
            console.warn('[SyncActivity] cancelManualBatch error:', e);
            Alert.alert('取消失败', '无法取消当前批次，请稍后重试');
          } finally {
            setCancellingBatch(false);
          }
        },
      },
    ]);
  }, []);

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  const boundDeviceName =
    bindingState?.deviceAlias ||
    bindingState?.deviceName ||
    (bindingState?.deviceType === 'win' ? 'Windows 电脑' : '电脑');

  const effectiveConnectionState = getEffectiveConnectionState(
    bindingState?.connectionState,
    {
      progressPercent: overview.progressPercent,
      currentFileKey: overview.currentFile,
      queueHasActiveItem: false,
      queueHasUploadingItem: false,
      transferredBytes: overview.currentFileConfirmedBytes,
      uploadState: overview.uploadState,
    },
  );

  const isConnected = effectiveConnectionState === 'connected';
  const isOffline = effectiveConnectionState === 'offline';
  const isSyncing =
    overview.uploadState === 'uploading' ||
    overview.uploadState === 'preparing' ||
    overview.uploadState === 'cloud_downloading';
  const isDone = overview.uploadState === 'completed';
  const isIdle = overview.uploadState === 'idle' && !isDone;
  const isPausedAuto =
    overview.uploadState === 'paused_auto_upload' ||
    overview.autoUploadState === 'paused';

  const progressPercent =
    overview.currentFileTotalBytes > 0
      ? Math.round(
          (overview.currentFileConfirmedBytes / overview.currentFileTotalBytes) *
            100,
        )
      : 0;

  const totalPending =
    (overview.manualBatchPending ?? 0) + (overview.autoPending ?? 0);

  const currentTaskSource = overview.currentTaskSource;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>同步动态</Text>
        </View>

        {/* Device status card */}
        <View style={styles.deviceCard}>
          <View style={styles.deviceIconBox}>
            <Icon name="desktop-outline" size={22} color="#fff" />
          </View>
          <View style={styles.deviceInfo}>
            <Text style={styles.deviceName}>{boundDeviceName}</Text>
            <View style={styles.deviceStatusRow}>
              <View
                style={[
                  styles.statusDot,
                  isConnected
                    ? styles.statusDotOnline
                    : isOffline
                      ? styles.statusDotOffline
                      : styles.statusDotConnecting,
                ]}
              />
              <Text
                style={[
                  styles.statusText,
                  isConnected
                    ? styles.statusTextOnline
                    : isOffline
                      ? styles.statusTextOffline
                      : styles.statusTextConnecting,
                ]}
              >
                {isConnected
                  ? '在线'
                  : isOffline
                    ? '离线'
                    : '连接中'}
              </Text>
            </View>
          </View>
        </View>

        {/* Transfer progress card */}
        {(isSyncing || isPausedAuto) && (
          <View style={styles.progressCard}>
            {/* Task source badge */}
            {currentTaskSource && (
              <View
                style={[
                  styles.sourceBadge,
                  currentTaskSource === 'auto'
                    ? styles.sourceBadgeAuto
                    : styles.sourceBadgeManual,
                ]}
              >
                <Text
                  style={[
                    styles.sourceBadgeText,
                    currentTaskSource === 'auto'
                      ? styles.sourceBadgeTextAuto
                      : styles.sourceBadgeTextManual,
                  ]}
                >
                  {currentTaskSource === 'auto' ? '自动' : '手动'}
                </Text>
              </View>
            )}

            <Text style={styles.progressTitle}>
              {uploadStateLabel(overview.uploadState)}
            </Text>

            {/* Progress ring (simplified bar) */}
            <View style={styles.progressBarContainer}>
              <View style={styles.progressBarTrack}>
                <View
                  style={[
                    styles.progressBarFill,
                    { width: `${Math.min(100, progressPercent)}%` },
                  ]}
                />
              </View>
              <Text style={styles.progressPercent}>{progressPercent}%</Text>
            </View>

            {/* Current file */}
            {overview.currentFilename && (
              <Text style={styles.currentFileName} numberOfLines={1}>
                {overview.currentFilename}
              </Text>
            )}

            {/* Stats row */}
            <View style={styles.progressStats}>
              <View style={styles.progressStatItem}>
                <Text style={styles.progressStatLabel}>速度</Text>
                <Text style={styles.progressStatValue}>
                  {formatSpeedMbps(overview.currentSpeedMbps)}
                </Text>
              </View>
              <View style={styles.progressStatItem}>
                <Text style={styles.progressStatLabel}>进度</Text>
                <Text style={styles.progressStatValue}>
                  {`${overview.completedCount} / ${overview.totalCount}`}
                </Text>
              </View>
              <View style={styles.progressStatItem}>
                <Text style={styles.progressStatLabel}>已传输</Text>
                <Text style={styles.progressStatValue}>
                  {formatBytes(overview.completedBytes)}
                </Text>
              </View>
            </View>

            {/* Queue info */}
            {totalPending > 0 && (
              <View style={styles.queueInfo}>
                <Text style={styles.queueInfoText}>
                  排队中 {totalPending} 项
                  {(overview.autoPending ?? 0) > 0 &&
                    (overview.manualBatchPending ?? 0) > 0
                    ? ` (自动 ${overview.autoPending} + 手动 ${overview.manualBatchPending})`
                    : ''}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Idle / Completed state card */}
        {(isIdle || isDone) && !isSyncing && (
          <View style={styles.idleCard}>
            {isDone ? (
              <>
                <View style={styles.idleIconBox}>
                  <Icon name="checkmark-circle" size={40} color="#22c55e" />
                </View>
                <Text style={styles.idleTitle}>所有文件已同步</Text>
                <Text style={styles.idleSubText}>
                  今日 {todayStats.fileCount} 个文件 ·{' '}
                  {formatBytes(todayStats.totalBytes)}
                </Text>
              </>
            ) : (
              <>
                <View style={styles.idleIconBox}>
                  <Icon name="sync-outline" size={36} color={BLUE} />
                </View>
                <Text style={styles.idleTitle}>等待同步</Text>
                <Text style={styles.idleSubText}>
                  {isConnected
                    ? '已连接，等待新素材'
                    : '连接后将自动开始同步'}
                </Text>
              </>
            )}
          </View>
        )}

        {/* Disconnected state */}
        {isOffline && !isSyncing && !isDone && !isIdle && (
          <View style={styles.idleCard}>
            <View style={styles.idleIconBox}>
              <Icon name="alert-circle-outline" size={40} color="#e53935" />
            </View>
            <Text style={styles.idleTitle}>未连接</Text>
            <Text style={styles.idleSubText}>
              请确认电脑端 Vivi Drop 正在运行且与手机在同一网络
            </Text>
          </View>
        )}

        {/* Control buttons — state matrix:
            ┌───────────────────────────────────┬──────────┬──────────┬──────────────┐
            │ Scenario                          │ Resume   │ Pause    │ Cancel manual│
            ├───────────────────────────────────┼──────────┼──────────┼──────────────┤
            │ current=manual, auto=active       │ hidden   │ visible  │ visible      │
            │ current=manual, auto=paused       │ visible  │ hidden   │ visible      │
            │ current=auto,   auto=active       │ hidden   │ visible  │ hidden       │
            │ no current,     auto=paused       │ visible  │ hidden   │ hidden       │
            │ no current,     auto=active/idle  │ hidden   │ visible  │ hidden       │
            └───────────────────────────────────┴──────────┴──────────┴──────────────┘ */}
        {(isSyncing || isPausedAuto || overview.autoUploadState === 'active') && (
          <View style={styles.controlSection}>
            {/* Resume — visible when auto is paused (even during manual task) */}
            {isPausedAuto && (
              <TouchableOpacity
                style={[styles.controlButton, styles.controlButtonPrimary]}
                activeOpacity={0.7}
                onPress={() => void handleResumeAutoUpload()}
              >
                <Icon name="play-circle-outline" size={18} color="#fff" />
                <Text style={styles.controlButtonTextPrimary}>
                  恢复自动上传
                </Text>
              </TouchableOpacity>
            )}

            {/* Pause — visible when auto is active (regardless of current task source) */}
            {!isPausedAuto && overview.autoUploadState === 'active' && (
              <TouchableOpacity
                style={styles.controlButton}
                activeOpacity={0.7}
                onPress={() => void handlePauseAutoUpload()}
              >
                <Icon name="pause-circle-outline" size={18} color={BLUE} />
                <Text style={styles.controlButtonText}>暂停自动上传</Text>
              </TouchableOpacity>
            )}

            {/* Cancel — visible when current task is manual (regardless of auto state) */}
            {currentTaskSource === 'manual' && (
              <TouchableOpacity
                style={[styles.controlButton, styles.controlButtonDanger]}
                activeOpacity={0.7}
                onPress={handleCancelManualBatch}
                disabled={cancellingBatch}
              >
                <Icon name="stop-circle-outline" size={18} color="#e53935" />
                <Text style={styles.controlButtonTextDanger}>
                  {cancellingBatch ? '正在取消...' : '取消本次手动上传'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Quick entry cards */}
        <View style={styles.quickEntrySection}>
          <Text style={styles.sectionLabel}>快捷入口</Text>
          <View style={styles.quickEntryRow}>
            <TouchableOpacity
              style={styles.quickEntryCard}
              activeOpacity={0.7}
              onPress={() => navigation.navigate('AlbumWorkbench')}
            >
              <View
                style={[
                  styles.quickEntryIcon,
                  { backgroundColor: 'rgba(59,159,216,0.12)' },
                ]}
              >
                <Icon name="albums-outline" size={22} color={BLUE} />
              </View>
              <Text style={styles.quickEntryTitle}>相册工作台</Text>
              <Text style={styles.quickEntryDesc}>浏览和手动上传素材</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.quickEntryCard}
              activeOpacity={0.7}
              onPress={() => navigation.navigate('SharedFiles')}
            >
              <View
                style={[
                  styles.quickEntryIcon,
                  { backgroundColor: 'rgba(34,197,94,0.12)' },
                ]}
              >
                <Icon name="folder-outline" size={22} color="#22c55e" />
              </View>
              <Text style={styles.quickEntryTitle}>共享文件</Text>
              <Text style={styles.quickEntryDesc}>浏览电脑共享目录</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Overview builder
// ---------------------------------------------------------------------------

function buildOverview(
  payload: Record<string, unknown>,
  prev: SyncOverview,
): SyncOverview {
  if (!payload) return prev;

  const uploadState =
    (payload.uploadState as string | undefined) ?? prev.uploadState;
  const currentFileConfirmedBytes =
    (payload.currentFileConfirmedBytes as number | undefined) ??
    (payload.confirmedBytes as number | undefined) ??
    prev.currentFileConfirmedBytes;
  const currentFileTotalBytes =
    (payload.currentFileTotalBytes as number | undefined) ??
    prev.currentFileTotalBytes;

  return {
    progressPercent:
      (payload.progressPercent as number | undefined) ??
      (currentFileTotalBytes > 0
        ? Math.round((currentFileConfirmedBytes / currentFileTotalBytes) * 100)
        : prev.progressPercent),
    currentSpeedMbps:
      uploadState === 'reconnecting'
        ? 0
        : ((payload.currentSpeedMbps as number | undefined) ??
          prev.currentSpeedMbps),
    uploadState,
    completedCount:
      (payload.completedCount as number | undefined) ?? prev.completedCount,
    totalCount:
      (payload.totalCount as number | undefined) ??
      (payload.queueTotalCount as number | undefined) ??
      prev.totalCount,
    completedBytes:
      (payload.completedBytes as number | undefined) ?? prev.completedBytes,
    totalBytes:
      (payload.totalBytes as number | undefined) ??
      (payload.queueTotalBytes as number | undefined) ??
      prev.totalBytes,
    currentFile:
      uploadState === 'completed' || uploadState === 'idle'
        ? undefined
        : typeof payload.currentFile === 'string'
          ? payload.currentFile
          : prev.currentFile,
    currentFilename:
      uploadState === 'completed' || uploadState === 'idle'
        ? undefined
        : typeof payload.currentFilename === 'string'
          ? payload.currentFilename
          : prev.currentFilename,
    currentFileConfirmedBytes:
      uploadState === 'completed' || uploadState === 'idle'
        ? 0
        : currentFileConfirmedBytes,
    currentFileTotalBytes:
      uploadState === 'completed' || uploadState === 'idle'
        ? 0
        : currentFileTotalBytes,
    // Native sends null (NSNull) when no task is active — respect it as
    // "clear". Only fall back to prev when the key is absent from payload.
    currentTaskSource:
      'currentTaskSource' in payload
        ? (payload.currentTaskSource as UploadTaskSource | undefined) ?? undefined
        : prev.currentTaskSource,
    autoUploadState:
      (payload.autoUploadState as AutoUploadState | undefined) ??
      prev.autoUploadState,
    manualBatchPending:
      (payload.manualBatchPending as number | undefined) ??
      prev.manualBatchPending,
    autoPending:
      (payload.autoPending as number | undefined) ?? prev.autoPending,
    lastErrorCode:
      typeof payload.lastErrorCode === 'string'
        ? payload.lastErrorCode
        : prev.lastErrorCode,
  };
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: SCREEN_BG,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
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

  // Device status card
  deviceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 18,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
    gap: 12,
    shadowColor: 'rgba(80,160,210,0.3)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 2,
  },
  deviceIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#3ba4dc',
    shadowColor: 'rgba(59,159,216,0.5)',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 3,
  },
  deviceInfo: {
    flex: 1,
    minWidth: 0,
  },
  deviceName: {
    fontSize: 15,
    fontWeight: '600',
    color: DARK,
  },
  deviceStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 3,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusDotOnline: {
    backgroundColor: '#22c55e',
  },
  statusDotOffline: {
    backgroundColor: '#e53935',
  },
  statusDotConnecting: {
    backgroundColor: '#f59e0b',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
  },
  statusTextOnline: {
    color: '#16a34a',
  },
  statusTextOffline: {
    color: '#dc2626',
  },
  statusTextConnecting: {
    color: '#d97706',
  },

  // Progress card
  progressCard: {
    marginHorizontal: 20,
    marginBottom: 12,
    borderRadius: 20,
    paddingVertical: 20,
    paddingHorizontal: 20,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
    shadowColor: '#50a0d2',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 24,
    elevation: 4,
  },
  sourceBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8,
    marginBottom: 8,
  },
  sourceBadgeAuto: {
    backgroundColor: 'rgba(59,159,216,0.12)',
  },
  sourceBadgeManual: {
    backgroundColor: 'rgba(249,115,22,0.12)',
  },
  sourceBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  sourceBadgeTextAuto: {
    color: BLUE,
  },
  sourceBadgeTextManual: {
    color: '#ea580c',
  },
  progressTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: DARK,
    marginBottom: 12,
  },
  progressBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  progressBarTrack: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(59,159,216,0.12)',
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: BLUE,
  },
  progressPercent: {
    fontSize: 14,
    fontWeight: '700',
    color: BLUE,
    minWidth: 40,
    textAlign: 'right',
  },
  currentFileName: {
    fontSize: 12,
    color: '#6a96b8',
    marginBottom: 12,
  },
  progressStats: {
    flexDirection: 'row',
    gap: 12,
  },
  progressStatItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  progressStatLabel: {
    fontSize: 10,
    color: '#8aabbd',
  },
  progressStatValue: {
    fontSize: 13,
    fontWeight: '600',
    color: DARK,
    marginTop: 2,
  },
  queueInfo: {
    marginTop: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(59,159,216,0.06)',
  },
  queueInfoText: {
    fontSize: 12,
    color: '#6a96b8',
    textAlign: 'center',
  },

  // Idle/Completed card
  idleCard: {
    marginHorizontal: 20,
    marginBottom: 12,
    borderRadius: 20,
    paddingVertical: 32,
    paddingHorizontal: 24,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    shadowColor: '#50a0d2',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 24,
    elevation: 4,
  },
  idleIconBox: {
    marginBottom: 12,
  },
  idleTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: DARK,
    marginBottom: 6,
  },
  idleSubText: {
    fontSize: 13,
    color: '#8aabbd',
    textAlign: 'center',
  },

  // Control buttons
  controlSection: {
    marginHorizontal: 20,
    marginBottom: 12,
    gap: 8,
  },
  controlButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.75)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  controlButtonPrimary: {
    backgroundColor: BLUE,
    borderColor: BLUE,
  },
  controlButtonDanger: {
    backgroundColor: 'rgba(229,57,53,0.06)',
    borderColor: 'rgba(229,57,53,0.2)',
  },
  controlButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: BLUE,
  },
  controlButtonTextPrimary: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  controlButtonTextDanger: {
    fontSize: 14,
    fontWeight: '600',
    color: '#e53935',
  },

  // Quick entry section
  quickEntrySection: {
    paddingHorizontal: 20,
    marginTop: 8,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6a96b8',
    marginBottom: 10,
  },
  quickEntryRow: {
    flexDirection: 'row',
    gap: 12,
  },
  quickEntryCard: {
    flex: 1,
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 16,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
    shadowColor: 'rgba(80,160,210,0.3)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 2,
  },
  quickEntryIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  quickEntryTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: DARK,
    marginBottom: 4,
  },
  quickEntryDesc: {
    fontSize: 11,
    color: '#8aabbd',
  },
});
