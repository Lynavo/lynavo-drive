import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  NativeModules,
  NativeEventEmitter,
  Alert,
  AppState,
  Modal,
  type AppStateStatus,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, CommonActions } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { UploadTaskSource, AutoUploadState } from '@syncflow/contracts';
import { Icon } from '../components/Icon';
import {
  cancelAllManualUploads,
  interruptAutoUpload,
  enableAutoUpload,
} from '../services/SyncEngineModule';
import { formatBytes } from '../utils/format';
import { formatLocalDateKey } from '../utils/localDateKey';
import {
  buildSyncConnectionEvidence,
  getConnectionBadgeState,
} from '../utils/effectiveConnectionState';
import { formatQueueCountDisplay } from '../utils/queueCountDisplay';
import { hasPendingManualWork } from '../utils/manualUploadState';
import {
  getSyncActivityMainCardState,
  getSyncActivityProgressPercent,
  type SyncActivityMainCardState,
} from '../utils/syncActivityTransferState';
import { useAuth, isFeatureAccessAllowed } from '../stores/auth-store';
import { FEATURES } from '../constants/features';
import type { RootStackParamList } from '../navigation/RootNavigator';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SyncActivityNav = StackNavigationProp<RootStackParamList, 'SyncActivity'>;

type SyncErrorEvent = {
  code?: string;
  message?: string;
};

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
  lastCompletedTaskSource?: UploadTaskSource | null;
  autoUploadState?: AutoUploadState;
  manualPending?: number;
  autoPending?: number;
  lastErrorCode?: string;
  /** Seconds elapsed during Bonjour device discovery */
  discoveryElapsedSec?: number;
  /** Total photos in the library during scan phase */
  libraryTotal?: number;
  /** Number of photos scanned so far */
  scannedCount?: number;
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

interface TodayStats {
  fileCount: number;
  totalBytes: number;
  latestUpdatedAt?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BLUE = '#3b9fd8';
const DARK = '#1a3a5c';
const SCREEN_BG = '#d6ecf8';
const CARD_BG = '#ffffff';
const CARD_BORDER = 'rgba(187, 214, 233, 0.72)';
const ICON_SURFACE = '#eaf4fb';
const HEADER_ICON = '#6d86a3';
const PRIMARY_NAVY = '#24466e';
const PRIMARY_NAVY_PRESSED = '#1f3d60';
const OUTLINE_SURFACE = '#eef6fd';
const OUTLINE_BORDER = '#b6d3ee';
const OUTLINE_TEXT = '#274a72';
const ONLINE_GREEN = '#22c55e';
const ONLINE_TEXT = '#1ebc63';
const CONNECTING_AMBER = '#f3b24c';
const CONNECTING_TEXT = '#c68a23';
const OFFLINE_SLATE = '#94a3b8';
const OFFLINE_TEXT = '#72859a';
const SOFT_TEXT = '#8eaac0';
const MUTED_TEXT = '#7893ab';
const EMPTY_INFO_BG = '#edf6fd';
const EMPTY_INFO_ICON = '#8faabd';
const EMPTY_OFFLINE_BG = '#edf6fd';
const EMPTY_OFFLINE_ICON = '#df7266';

/** Grace period on mount / foreground before showing offline state (ms). */
const STARTUP_CONNECTION_GRACE_MS = 2500;
/** Delay before transitioning to offline display (ms). */
const OFFLINE_DISPLAY_DELAY_MS = 800;
const AUTO_COMPLETION_VISUAL_HOLD_MS = 350;
/** Minimum time the optimistic "enabling auto-upload" card stays visible. */
const AUTO_UPLOAD_PREPARING_MIN_MS = 400;
/** Safety timeout — force-clear optimistic preparing state if native never confirms. */
const AUTO_UPLOAD_PREPARING_SAFETY_MS = 35000;

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
  lastCompletedTaskSource: null,
  autoUploadState: 'disabled',
  manualPending: 0,
  autoPending: 0,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSpeedMbps(speedMbps: number): string {
  if (!Number.isFinite(speedMbps) || speedMbps <= 0) {
    return '0 MB/s';
  }
  return `${
    speedMbps >= 10 ? speedMbps.toFixed(0) : speedMbps.toFixed(1)
  } MB/s`;
}

const PREPARATION_STATES = new Set([
  'discovering',
  'reconciling',
  'scanning',
  'preparing',
  'backoff_waiting',
  'reconnecting',
]);

export function isPreparationPhase(uploadState: string): boolean {
  return PREPARATION_STATES.has(uploadState);
}

function getPreparationTitle(uploadState: string, t: TFunction): string {
  switch (uploadState) {
    case 'discovering':
      return t('syncActivity.phases.discoveringTitle');
    case 'reconciling':
      return t('syncActivity.phases.reconcilingTitle');
    case 'scanning':
      return t('syncActivity.phases.scanningTitle');
    case 'preparing':
    case 'backoff_waiting':
      return t('syncActivity.phases.preparingTitle');
    case 'reconnecting':
      return t('syncActivity.phases.reconnectingTitle');
    default:
      return t('syncActivity.phases.defaultTitle');
  }
}

function getPreparationSubtitle(overview: SyncOverview, t: TFunction): string {
  switch (overview.uploadState) {
    case 'discovering': {
      const sec = Math.round(overview.discoveryElapsedSec ?? 0);
      return sec > 0
        ? t('syncActivity.phases.discoveringSubtitleWaited', { seconds: sec })
        : t('syncActivity.phases.discoveringSubtitleSearching');
    }
    case 'reconciling':
      return t('syncActivity.phases.reconcilingSubtitle');
    case 'scanning': {
      const scanned = overview.scannedCount ?? 0;
      const total = overview.libraryTotal ?? 0;
      if (total > 0) {
        return t('syncActivity.phases.scanningSubtitleProgress', {
          scanned,
          total,
        });
      }
      return t('syncActivity.phases.scanningSubtitleReading');
    }
    case 'preparing':
    case 'backoff_waiting':
      return t('syncActivity.phases.preparingSubtitle');
    case 'reconnecting':
      return t('syncActivity.phases.reconnectingSubtitle');
    default:
      return '';
  }
}

export function resolveSyncErrorAlertMessage(
  error: SyncErrorEvent | null | undefined,
  t: TFunction,
): string {
  if (error?.code === 'LOW_DISK_PAUSED') {
    return t('syncActivity.dialogs.syncError.lowDiskPaused');
  }
  return error?.message || t('errors.unknown');
}

function formatDateTimeLabel(iso: string | undefined, t: TFunction): string {
  if (!iso) return t('settings.status.noRecord');
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return t('settings.status.noRecord');

  const now = new Date();
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}`;
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

export function shouldDelayAutoCompletionCard(
  rawMainCardState: SyncActivityMainCardState,
  uploadState: string,
  autoUploadState: AutoUploadState | undefined,
  autoCompletionVisualHoldUntilMs: number | null,
  now: number,
): boolean {
  if (autoUploadState !== 'active') {
    return false;
  }

  if (uploadState === 'uploading') {
    return false;
  }

  if (
    rawMainCardState !== 'auto_completed' &&
    rawMainCardState !== 'running' &&
    rawMainCardState !== 'standby'
  ) {
    return false;
  }

  if (rawMainCardState === 'auto_completed') {
    return true;
  }

  return (
    autoCompletionVisualHoldUntilMs !== null &&
    now < autoCompletionVisualHoldUntilMs
  );
}

export function shouldRenderSyncActivityProgress(
  uploadState: string,
  shouldDelayCompletion: boolean,
  isBetweenItems: boolean,
): boolean {
  return (
    uploadState === 'uploading' ||
    uploadState === 'cloud_downloading' ||
    shouldDelayCompletion ||
    isBetweenItems
  );
}

export function getSyncActivityDisplayProgressPercent(
  overview: SyncOverview,
  shouldDelayCompletion: boolean,
): number {
  if (shouldDelayCompletion) {
    return 100;
  }

  return getSyncActivityProgressPercent(overview);
}

function CompletionStatCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={styles.completionStatCard}>
      <Text style={styles.completionStatLabel}>{label}</Text>
      <Text style={styles.completionStatValue}>{value}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// SyncActivityScreen
// ---------------------------------------------------------------------------

export function SyncActivityScreen() {
  const navigation = useNavigation<SyncActivityNav>();
  const { t } = useTranslation();
  const auth = useAuth();
  const [overview, setOverview] = useState<SyncOverview>(EMPTY_OVERVIEW);
  const [bindingState, setBindingState] = useState<BindingState | null>(null);
  const [todayStats, setTodayStats] = useState<TodayStats>({
    fileCount: 0,
    totalBytes: 0,
    latestUpdatedAt: undefined,
  });
  const [initialLoading, setInitialLoading] = useState(true);
  const [cancellingBatch, setCancellingBatch] = useState(false);
  const [autoCompletionVisualHoldUntilMs, setAutoCompletionVisualHoldUntilMs] =
    useState<number | null>(null);

  // Offline debounce: stabilize isOffline to avoid rapid UI flicker
  const [stableOffline, setStableOffline] = useState(false);
  const offlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoCompletionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  // Optimistic UI: show "preparing auto-upload" immediately after the toggle,
  // since the native pipeline can sit in a ~30 s heartbeat wait after the
  // manual batch drains before it re-enters the scan loop.
  const [autoUploadPreparing, setAutoUploadPreparing] = useState(false);
  const autoUploadPreparingMinUntilRef = useRef<number | null>(null);
  const autoUploadPreparingSafetyTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const autoUploadPreparingClearTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  // Tracks whether the native pipeline has visibly woken up (entered a
  // preparation / uploading phase) during the current optimistic window.
  // Used to detect "scan finished with zero new items" so we can exit
  // optimistic without waiting for the 35 s safety timeout.
  const autoUploadObservedWakeRef = useRef(false);
  const lastAutoUploadingVisualRef = useRef<{
    currentFilename?: string;
    currentSpeedMbps: number;
  } | null>(null);
  const mountGraceRef = useRef(true);

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  const loadTodayStats = useCallback(
    async (engine?: Record<string, Function>) => {
      try {
        const mod = engine ?? NativeModules.NativeSyncEngine;
        if (!mod) return;
        const history = await mod.getHistoryDays(null);
        if (history?.items) {
          const today = formatLocalDateKey(new Date());
          let totalFiles = 0;
          let totalBytesSum = 0;
          let latestUpdatedAt: string | undefined;
          for (const item of history.items) {
            if ((item.ledgerDate || item.dateKey) === today) {
              totalFiles += item.fileCount || 0;
              totalBytesSum += item.totalBytes || 0;
              const updatedAt =
                typeof item.updatedAt === 'string' ? item.updatedAt : undefined;
              if (
                updatedAt &&
                (!latestUpdatedAt ||
                  new Date(updatedAt).getTime() >
                    new Date(latestUpdatedAt).getTime())
              ) {
                latestUpdatedAt = updatedAt;
              }
            }
          }
          setTodayStats(prev =>
            prev.fileCount === totalFiles &&
            prev.totalBytes === totalBytesSum &&
            prev.latestUpdatedAt === latestUpdatedAt
              ? prev
              : {
                  fileCount: totalFiles,
                  totalBytes: totalBytesSum,
                  latestUpdatedAt,
                },
          );
        }
      } catch {
        /* ignore */
      }
    },
    [],
  );

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
        // Do NOT call triggerSync() here — per PRD, auto upload must be
        // explicitly enabled by the user in the album page. Unconditional
        // triggerSync on mount was the old "always auto sync" behavior.

        syncSub = emitter.addListener(
          'onSyncStateChanged',
          (state: Record<string, unknown>) => {
            setOverview(prev => buildOverview(state, prev));
            if (state.uploadState === 'completed') {
              void loadTodayStats();
            }
          },
        );

        errorSub = emitter.addListener('onError', (error: SyncErrorEvent) => {
          const msg = resolveSyncErrorAlertMessage(error, t);
          Alert.alert(t('syncActivity.dialogs.syncError.title'), msg);
        });
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
  }, [loadTodayStats, navigation, t]);

  // Foreground refresh + reset mount grace on foreground transitions
  useEffect(() => {
    let appState = AppState.currentState;
    let foregroundGraceTimer: ReturnType<typeof setTimeout> | undefined;
    const subscription = AppState.addEventListener(
      'change',
      (nextState: AppStateStatus) => {
        const becameActive = appState !== 'active' && nextState === 'active';
        appState = nextState;
        if (!becameActive) return;
        void loadTodayStats();
        // Re-suppress offline display during foreground grace period
        mountGraceRef.current = true;
        setStableOffline(false);
        if (foregroundGraceTimer) clearTimeout(foregroundGraceTimer);
        foregroundGraceTimer = setTimeout(() => {
          mountGraceRef.current = false;
        }, STARTUP_CONNECTION_GRACE_MS);
      },
    );
    return () => {
      if (foregroundGraceTimer) clearTimeout(foregroundGraceTimer);
      subscription.remove();
    };
  }, [loadTodayStats]);

  // Mount grace period — suppress offline display for initial connection time
  useEffect(() => {
    const t = setTimeout(() => {
      mountGraceRef.current = false;
    }, STARTUP_CONNECTION_GRACE_MS);
    return () => clearTimeout(t);
  }, []);

  // ---------------------------------------------------------------------------
  // Control handlers
  // ---------------------------------------------------------------------------

  const startAutoUploadPreparing = useCallback(() => {
    autoUploadObservedWakeRef.current = false;
    setAutoUploadPreparing(true);
    autoUploadPreparingMinUntilRef.current =
      Date.now() + AUTO_UPLOAD_PREPARING_MIN_MS;
    if (autoUploadPreparingClearTimerRef.current) {
      clearTimeout(autoUploadPreparingClearTimerRef.current);
      autoUploadPreparingClearTimerRef.current = null;
    }
    if (autoUploadPreparingSafetyTimerRef.current) {
      clearTimeout(autoUploadPreparingSafetyTimerRef.current);
    }
    autoUploadPreparingSafetyTimerRef.current = setTimeout(() => {
      autoUploadPreparingSafetyTimerRef.current = null;
      autoUploadPreparingMinUntilRef.current = null;
      setAutoUploadPreparing(false);
    }, AUTO_UPLOAD_PREPARING_SAFETY_MS);
  }, []);

  const clearAutoUploadPreparing = useCallback(() => {
    const finish = () => {
      autoUploadPreparingMinUntilRef.current = null;
      if (autoUploadPreparingSafetyTimerRef.current) {
        clearTimeout(autoUploadPreparingSafetyTimerRef.current);
        autoUploadPreparingSafetyTimerRef.current = null;
      }
      autoUploadPreparingClearTimerRef.current = null;
      setAutoUploadPreparing(false);
    };
    const minUntil = autoUploadPreparingMinUntilRef.current;
    const now = Date.now();
    if (minUntil !== null && now < minUntil) {
      if (autoUploadPreparingClearTimerRef.current) {
        clearTimeout(autoUploadPreparingClearTimerRef.current);
      }
      autoUploadPreparingClearTimerRef.current = setTimeout(
        finish,
        minUntil - now,
      );
      return;
    }
    finish();
  }, []);

  const handleCancelManualBatch = useCallback(() => {
    Alert.alert(
      t('syncActivity.dialogs.cancelManual.title'),
      t('syncActivity.dialogs.cancelManual.body'),
      [
        {
          text: t('syncActivity.dialogs.cancelManual.rethink'),
          style: 'cancel',
        },
        {
          text: t('syncActivity.dialogs.cancelManual.confirm'),
          style: 'destructive',
          onPress: async () => {
            try {
              setCancellingBatch(true);
              await cancelAllManualUploads();
            } catch (e) {
              console.warn('[SyncActivity] cancelAllManualUploads error:', e);
              Alert.alert(
                t('syncActivity.dialogs.cancelManualFailed.title'),
                t('syncActivity.dialogs.cancelManualFailed.body'),
              );
            } finally {
              setCancellingBatch(false);
            }
          },
        },
      ],
    );
  }, [t]);

  const handleCloseAutoUpload = useCallback(() => {
    Alert.alert(
      t('syncActivity.dialogs.closeAuto.title'),
      t('syncActivity.dialogs.closeAuto.body'),
      [
        { text: t('syncActivity.dialogs.closeAuto.continue'), style: 'cancel' },
        {
          text: t('syncActivity.dialogs.closeAuto.confirm'),
          style: 'destructive',
          onPress: async () => {
            try {
              clearAutoUploadPreparing();
              await interruptAutoUpload();
              // Reload overview to reflect the new state
              const syncData =
                await NativeModules.NativeSyncEngine?.getSyncOverview();
              if (syncData) {
                setOverview(prev => buildOverview(syncData, prev));
              }
            } catch (e) {
              console.warn('[SyncActivity] interruptAutoUpload error:', e);
              Alert.alert(
                t('syncActivity.dialogs.closeAutoFailed.title'),
                t('syncActivity.dialogs.closeAutoFailed.body'),
              );
            }
          },
        },
      ],
    );
  }, [t, clearAutoUploadPreparing]);

  const handleReconnect = useCallback(async () => {
    try {
      const { NativeSyncEngine } = NativeModules;
      if (!NativeSyncEngine) return;
      await NativeSyncEngine.startDiscovery();
      NativeSyncEngine.triggerSync?.().catch((e: Error) => {
        console.warn('[SyncActivity] triggerSync failed:', e);
      });
    } catch (e) {
      console.warn('[SyncActivity] reconnect error:', e);
      Alert.alert(
        t('syncActivity.dialogs.reconnectFailed.title'),
        t('syncActivity.dialogs.reconnectFailed.body'),
      );
    }
  }, [t]);

  const handleSwitchDevice = useCallback(() => {
    Alert.alert(
      t('syncActivity.dialogs.switchDevice.title'),
      t('syncActivity.dialogs.switchDevice.body'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('syncActivity.dialogs.switchDevice.confirm'),
          style: 'destructive',
          onPress: async () => {
            try {
              await NativeModules.NativeSyncEngine?.disconnectAndUnbind();
            } catch (e) {
              console.warn('[SyncActivity] disconnectAndUnbind error:', e);
            }
            navigation.dispatch(
              CommonActions.reset({
                index: 0,
                routes: [{ name: 'DeviceDiscovery' }],
              }),
            );
          },
        },
      ],
    );
  }, [navigation, t]);

  const handleEnableAutoUpload = useCallback(async () => {
    // Check device connection first
    try {
      const binding = await NativeModules.NativeSyncEngine?.getBindingState();
      if (
        !binding?.deviceId ||
        (binding.connectionState !== 'connected' &&
          binding.connectionState !== 'bound')
      ) {
        Alert.alert(
          t('syncActivity.dialogs.enableAutoBlocked.title'),
          t('syncActivity.dialogs.enableAutoBlocked.body'),
        );
        return;
      }
    } catch {
      Alert.alert(
        t('syncActivity.dialogs.enableAutoBlocked.title'),
        t('syncActivity.dialogs.enableAutoBlocked.body'),
      );
      return;
    }
    try {
      const syncData = await NativeModules.NativeSyncEngine?.getSyncOverview();
      if (hasPendingManualWork(syncData)) {
        Alert.alert(
          t('syncActivity.dialogs.switchUploadMode.title'),
          t('syncActivity.dialogs.switchUploadMode.body'),
          [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('syncActivity.dialogs.switchUploadMode.confirm'),
              onPress: async () => {
                startAutoUploadPreparing();
                try {
                  await cancelAllManualUploads();
                  await enableAutoUpload();
                  await NativeModules.NativeSyncEngine?.triggerSync();
                  const nextSyncData =
                    await NativeModules.NativeSyncEngine?.getSyncOverview();
                  if (nextSyncData) {
                    setOverview(prev => buildOverview(nextSyncData, prev));
                  }
                } catch (e) {
                  console.warn('[SyncActivity] enableAutoUpload error:', e);
                  clearAutoUploadPreparing();
                  Alert.alert(
                    t('syncActivity.dialogs.enableAutoFailed.title'),
                    t('syncActivity.dialogs.enableAutoFailed.body'),
                  );
                }
              },
            },
          ],
        );
        return;
      }

      startAutoUploadPreparing();
      await enableAutoUpload();
      await NativeModules.NativeSyncEngine?.triggerSync();
      const nextSyncData =
        await NativeModules.NativeSyncEngine?.getSyncOverview();
      if (nextSyncData) {
        setOverview(prev => buildOverview(nextSyncData, prev));
      }
    } catch (e) {
      console.warn('[SyncActivity] enableAutoUpload error:', e);
      clearAutoUploadPreparing();
      Alert.alert(
        t('syncActivity.dialogs.enableAutoFailed.title'),
        t('syncActivity.dialogs.enableAutoFailed.body'),
      );
    }
  }, [t, startAutoUploadPreparing, clearAutoUploadPreparing]);

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  const boundDeviceName =
    bindingState?.deviceAlias ||
    bindingState?.deviceName ||
    (bindingState?.deviceType === 'win'
      ? t('common.deviceNames.windows')
      : t('common.deviceNames.default'));

  const connectionBadgeState = getConnectionBadgeState(
    bindingState?.connectionState,
    buildSyncConnectionEvidence({
      progressPercent: overview.progressPercent,
      currentFile: overview.currentFile,
      currentFileConfirmedBytes: overview.currentFileConfirmedBytes,
      uploadState: overview.uploadState,
    }),
  );
  const isConnecting = connectionBadgeState === 'connecting';
  const isOffline = connectionBadgeState === 'offline';

  // Debounce offline transitions: delay going offline, instant recovery
  useEffect(() => {
    if (isOffline && !mountGraceRef.current) {
      offlineTimerRef.current = setTimeout(() => {
        setStableOffline(true);
      }, OFFLINE_DISPLAY_DELAY_MS);
    } else {
      if (offlineTimerRef.current) {
        clearTimeout(offlineTimerRef.current);
        offlineTimerRef.current = null;
      }
      setStableOffline(false);
    }
    return () => {
      if (offlineTimerRef.current) {
        clearTimeout(offlineTimerRef.current);
      }
    };
  }, [isOffline]);

  const isAutoUploadActive = overview.autoUploadState === 'active';
  const currentTaskSource = overview.currentTaskSource;
  const hasManualUploadWork = hasPendingManualWork({
    manualPending: overview.manualPending,
    currentTaskSource,
  });
  const totalPending =
    (overview.manualPending ?? 0) + (overview.autoPending ?? 0);
  const totalPendingDisplay = formatQueueCountDisplay(totalPending);

  // ---------------------------------------------------------------------------
  // Card state determination
  // ---------------------------------------------------------------------------

  // State 1: Upload Running — auto or manual upload active
  // State 2: Auto Upload Not Started — device online, no upload active
  // State 3: Device Offline

  const isManualUploading = hasManualUploadWork;

  const rawMainCardState = getSyncActivityMainCardState(
    overview,
    stableOffline,
  );
  const shouldDelayAutoCompletion = shouldDelayAutoCompletionCard(
    rawMainCardState,
    overview.uploadState,
    overview.autoUploadState,
    autoCompletionVisualHoldUntilMs,
    Date.now(),
  );
  const mainCardState =
    shouldDelayAutoCompletion || autoUploadPreparing
      ? 'running'
      : rawMainCardState;
  const displayProgressPercent = getSyncActivityDisplayProgressPercent(
    overview,
    shouldDelayAutoCompletion,
  );
  // Inter-item transition: between items native briefly emits 'completed'
  // and/or preparation states ('preparing'/'reconciling'/'scanning'/
  // 'discovering'). These cause two visible flickers we need to suppress
  // while the round is still in progress:
  //   (a) buildOverview clears currentFilename/bytes on 'completed' — the
  //       filename <Text> unmounts and speed dips to 0.
  //   (b) shouldRenderPreparationPhase would flip the running card into the
  //       "Establishing connection…" UI and back.
  // Gate on completedCount > 0 so the genuine round-start preparation
  // (first item of a round) still shows the connection UI normally.
  const isInterItemTransitionState =
    overview.uploadState === 'completed' ||
    isPreparationPhase(overview.uploadState);
  const isBetweenItems =
    isInterItemTransitionState &&
    overview.totalCount > 0 &&
    overview.completedCount > 0 &&
    overview.completedCount < overview.totalCount;
  const shouldFreezeItemVisuals = shouldDelayAutoCompletion || isBetweenItems;
  const displayCurrentFilename = shouldFreezeItemVisuals
    ? lastAutoUploadingVisualRef.current?.currentFilename ??
      overview.currentFilename
    : overview.currentFilename;
  const displayCurrentSpeedMbps = shouldFreezeItemVisuals
    ? lastAutoUploadingVisualRef.current?.currentSpeedMbps ??
      overview.currentSpeedMbps
    : overview.currentSpeedMbps;
  const shouldRenderPreparationPhase =
    (autoUploadPreparing || isPreparationPhase(overview.uploadState)) &&
    !shouldDelayAutoCompletion &&
    !isBetweenItems;
  const shouldRenderUploadProgress = shouldRenderSyncActivityProgress(
    overview.uploadState,
    shouldDelayAutoCompletion,
    isBetweenItems,
  );
  const completedProgressTotal = Math.max(
    overview.totalCount,
    overview.completedCount,
  );
  const latestSyncLabel = todayStats.latestUpdatedAt
    ? formatDateTimeLabel(todayStats.latestUpdatedAt, t)
    : undefined;

  useEffect(() => {
    // Cache the last known uploading visual regardless of task source.
    // Used to freeze filename/speed during:
    //   (a) auto-completion hold window (round end)
    //   (b) inter-item transition (uploadState briefly flips to 'completed'
    //       which clears currentFilename/bytes in buildOverview)
    if (overview.uploadState === 'uploading') {
      lastAutoUploadingVisualRef.current = {
        currentFilename: overview.currentFilename,
        currentSpeedMbps: overview.currentSpeedMbps,
      };
    }
  }, [
    overview.currentFilename,
    overview.currentSpeedMbps,
    overview.uploadState,
  ]);

  useEffect(() => {
    if (rawMainCardState === 'auto_completed') {
      const holdUntil = Date.now() + AUTO_COMPLETION_VISUAL_HOLD_MS;
      setAutoCompletionVisualHoldUntilMs(holdUntil);
      if (autoCompletionTimerRef.current) {
        clearTimeout(autoCompletionTimerRef.current);
      }
      autoCompletionTimerRef.current = setTimeout(() => {
        autoCompletionTimerRef.current = null;
        setAutoCompletionVisualHoldUntilMs(null);
      }, AUTO_COMPLETION_VISUAL_HOLD_MS);
      return;
    }

    if (
      overview.uploadState === 'uploading' ||
      rawMainCardState === 'manual_completed' ||
      rawMainCardState === 'offline' ||
      rawMainCardState === 'not_started'
    ) {
      if (autoCompletionTimerRef.current) {
        clearTimeout(autoCompletionTimerRef.current);
        autoCompletionTimerRef.current = null;
      }
      setAutoCompletionVisualHoldUntilMs(null);
    }
  }, [overview.uploadState, rawMainCardState]);

  useEffect(() => {
    return () => {
      if (autoCompletionTimerRef.current) {
        clearTimeout(autoCompletionTimerRef.current);
        autoCompletionTimerRef.current = null;
      }
    };
  }, []);

  // Clear the optimistic "preparing auto-upload" state only once there is
  // concrete evidence that auto-upload has taken over. We intentionally do
  // NOT clear the moment native enters 'scanning' — between scan-end and
  // the first auto item actually uploading there is a transient gap where
  // rawMainCardState regresses to 'manual_completed' (because
  // lastCompletedTaskSource stays 'manual' until a new round starts).
  // Keeping optimistic ON across that gap prevents the visible flash back
  // to the manual-completed card.
  //
  // Edge case: if the scan finishes with zero new items (nothing new to
  // upload), we'd otherwise wait out the 35 s safety timeout. We avoid
  // that by tracking "native was observed to wake up" and clearing once
  // the pipeline has settled back to a non-active state.
  useEffect(() => {
    if (!autoUploadPreparing) return;
    if (
      isPreparationPhase(overview.uploadState) ||
      overview.uploadState === 'uploading' ||
      overview.uploadState === 'cloud_downloading'
    ) {
      autoUploadObservedWakeRef.current = true;
    }
    const concreteAutoActivity =
      overview.autoUploadState === 'active' &&
      (overview.currentTaskSource === 'auto' ||
        (overview.autoPending ?? 0) > 0);
    const scanEndedEmpty =
      autoUploadObservedWakeRef.current &&
      overview.autoUploadState === 'active' &&
      !isPreparationPhase(overview.uploadState) &&
      overview.uploadState !== 'uploading' &&
      overview.uploadState !== 'cloud_downloading' &&
      (overview.autoPending ?? 0) === 0 &&
      overview.currentTaskSource !== 'auto';
    if (concreteAutoActivity || scanEndedEmpty) {
      clearAutoUploadPreparing();
    }
  }, [
    autoUploadPreparing,
    overview.autoUploadState,
    overview.uploadState,
    overview.autoPending,
    overview.currentTaskSource,
    clearAutoUploadPreparing,
  ]);

  useEffect(() => {
    return () => {
      if (autoUploadPreparingSafetyTimerRef.current) {
        clearTimeout(autoUploadPreparingSafetyTimerRef.current);
        autoUploadPreparingSafetyTimerRef.current = null;
      }
      if (autoUploadPreparingClearTimerRef.current) {
        clearTimeout(autoUploadPreparingClearTimerRef.current);
        autoUploadPreparingClearTimerRef.current = null;
      }
    };
  }, []);

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
          <Text style={styles.headerTitle}>{t('syncActivity.title')}</Text>
          <View style={styles.headerActions}>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => navigation.navigate('History')}
            >
              <Icon name="time-outline" size={22} color={HEADER_ICON} />
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => navigation.navigate('Settings')}
            >
              <Icon name="settings-outline" size={22} color={HEADER_ICON} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Unified main card */}
        <View style={styles.mainCard}>
          {/* Device info row — always shown at top of card */}
          <View style={styles.deviceRow}>
            <View style={styles.deviceIconBox}>
              <Icon name="desktop-outline" size={22} color={BLUE} />
            </View>
            <View style={styles.deviceInfo}>
              <Text style={styles.deviceName}>{boundDeviceName}</Text>
              <View style={styles.deviceStatusRow}>
                <View
                  style={[
                    styles.statusDot,
                    connectionBadgeState === 'offline'
                      ? styles.statusDotOffline
                      : connectionBadgeState === 'connecting'
                      ? styles.statusDotConnecting
                      : styles.statusDotOnline,
                  ]}
                />
                <Text
                  style={[
                    styles.statusText,
                    connectionBadgeState === 'offline'
                      ? styles.statusTextOffline
                      : connectionBadgeState === 'connecting'
                      ? styles.statusTextConnecting
                      : styles.statusTextOnline,
                  ]}
                >
                  {connectionBadgeState === 'offline'
                    ? t('settings.connection.offline')
                    : isConnecting
                    ? t('settings.connection.connecting')
                    : t('settings.connection.online')}
                </Text>
              </View>
            </View>
          </View>

          {/* ---- State 1: Upload Running (auto or manual) ---- */}
          {mainCardState === 'running' && (
            <View style={styles.cardBody}>
              {/* Badge row — dynamic based on upload source */}
              <View style={styles.badgeRow}>
                <View
                  style={
                    isManualUploading ? styles.manualBadge : styles.autoBadge
                  }
                >
                  <Text
                    style={
                      isManualUploading
                        ? styles.manualBadgeText
                        : styles.autoBadgeText
                    }
                  >
                    {isManualUploading
                      ? t('syncActivity.badges.manual')
                      : t('syncActivity.badges.auto')}
                  </Text>
                </View>
                <Text style={styles.badgeLabel}>
                  {isManualUploading
                    ? t('syncActivity.badges.manualUploading')
                    : t('syncActivity.badges.autoEnabled')}
                </Text>
              </View>

              {shouldRenderPreparationPhase ? (
                <View style={styles.preparationBody}>
                  <ActivityIndicator size="small" color={BLUE} />
                  <Text style={styles.preparationTitle}>
                    {autoUploadPreparing &&
                    !isPreparationPhase(overview.uploadState)
                      ? t('syncActivity.phases.autoPreparingTitle')
                      : getPreparationTitle(overview.uploadState, t)}
                  </Text>
                  <Text style={styles.preparationSubtitle}>
                    {autoUploadPreparing &&
                    !isPreparationPhase(overview.uploadState)
                      ? t('syncActivity.phases.autoPreparingSubtitle')
                      : getPreparationSubtitle(overview, t)}
                  </Text>
                </View>
              ) : shouldRenderUploadProgress ? (
                <>
                  {/* Title row with percentage */}
                  <View style={styles.runningTitleRow}>
                    <Text style={styles.runningTitle}>
                      {isManualUploading
                        ? t('syncActivity.running.manualTitle')
                        : t('syncActivity.running.autoTitle')}
                    </Text>
                    <Text style={styles.runningPercent}>
                      {displayProgressPercent}%
                    </Text>
                  </View>

                  {/* Progress bar */}
                  <View style={styles.progressBarTrack}>
                    <View
                      style={[
                        styles.progressBarFill,
                        { width: `${Math.min(100, displayProgressPercent)}%` },
                      ]}
                    />
                  </View>

                  {/* Current file */}
                  {displayCurrentFilename ? (
                    <Text style={styles.currentFileName} numberOfLines={1}>
                      {displayCurrentFilename}
                    </Text>
                  ) : null}

                  {/* Stats row */}
                  <View style={styles.statsRow}>
                    <View style={styles.statItem}>
                      <Text style={styles.statLabel}>
                        {t('syncActivity.stats.speed')}
                      </Text>
                      <Text style={styles.statValue}>
                        {formatSpeedMbps(displayCurrentSpeedMbps)}
                      </Text>
                    </View>
                    <View style={styles.statDivider} />
                    <View style={styles.statItem}>
                      <Text style={styles.statLabel}>
                        {t('syncActivity.stats.progress')}
                      </Text>
                      <Text style={styles.statValue}>
                        {`${overview.completedCount} / ${overview.totalCount}`}
                      </Text>
                    </View>
                    <View style={styles.statDivider} />
                    <View style={styles.statItem}>
                      <Text style={styles.statLabel}>
                        {t('syncActivity.stats.transferred')}
                      </Text>
                      <Text style={styles.statValue}>
                        {formatBytes(overview.completedBytes)}
                      </Text>
                    </View>
                  </View>

                  {/* Queue info */}
                  {totalPending > 0 && (
                    <Text style={styles.queueInfoText}>
                      {t('syncActivity.running.queueInfo', {
                        queued: totalPendingDisplay,
                      })}
                    </Text>
                  )}
                </>
              ) : isManualUploading ? (
                <>
                  {/* Manual batch in flight but pipeline is in a transient gap
                      (e.g. Wi-Fi flip, backoff). Show manual-context copy and
                      fall through to the manual cancel button below — NEVER
                      the auto-running fallback, which produced a Frankenstein
                      UI mixing manual badge with "自動上傳執行中" text. */}
                  <Text style={styles.runningTitle}>
                    {t('syncActivity.running.manualTitle')}
                  </Text>
                  <Text style={styles.idleSubtitle}>
                    {t('syncActivity.phases.preparingSubtitle')}
                  </Text>
                  {overview.completedCount > 0 && (
                    <View style={styles.statsRow}>
                      <View style={styles.statItem}>
                        <Text style={styles.statLabel}>
                          {t('syncActivity.stats.transferred')}
                        </Text>
                        <Text style={styles.statValue}>
                          {t('syncActivity.stats.transferredCount', {
                            count: overview.completedCount,
                          })}
                        </Text>
                      </View>
                      <View style={styles.statDivider} />
                      <View style={styles.statItem}>
                        <Text style={styles.statLabel}>
                          {t('syncActivity.stats.dataAmount')}
                        </Text>
                        <Text style={styles.statValue}>
                          {formatBytes(overview.completedBytes)}
                        </Text>
                      </View>
                    </View>
                  )}
                </>
              ) : (
                <>
                  {/* Active but idle — auto upload watching for new photos */}
                  <Text style={styles.runningTitle}>
                    {t('syncActivity.running.autoRunningTitle')}
                  </Text>
                  <Text style={styles.idleSubtitle}>
                    {t('syncActivity.running.autoRunningSubtitle')}
                  </Text>
                  {overview.completedCount > 0 && (
                    <View style={styles.statsRow}>
                      <View style={styles.statItem}>
                        <Text style={styles.statLabel}>
                          {t('syncActivity.stats.transferred')}
                        </Text>
                        <Text style={styles.statValue}>
                          {t('syncActivity.stats.transferredCount', {
                            count: overview.completedCount,
                          })}
                        </Text>
                      </View>
                      <View style={styles.statDivider} />
                      <View style={styles.statItem}>
                        <Text style={styles.statLabel}>
                          {t('syncActivity.stats.dataAmount')}
                        </Text>
                        <Text style={styles.statValue}>
                          {formatBytes(overview.completedBytes)}
                        </Text>
                      </View>
                    </View>
                  )}
                </>
              )}

              {/* Action button — only one visible at a time per PRD */}
              {hasManualUploadWork ? (
                <TouchableOpacity
                  style={[styles.outlinedButton, styles.dangerButton]}
                  activeOpacity={0.7}
                  onPress={handleCancelManualBatch}
                  disabled={cancellingBatch}
                >
                  <Text style={styles.dangerButtonText}>
                    {cancellingBatch
                      ? t('syncActivity.actions.cancelling')
                      : t('syncActivity.actions.cancelManualBatch')}
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.outlinedButton}
                  activeOpacity={0.7}
                  onPress={handleCloseAutoUpload}
                >
                  <Text style={styles.outlinedButtonText}>
                    {t('syncActivity.actions.closeAutoUpload')}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* ---- State 2: Auto Upload Completed ---- */}
          {mainCardState === 'auto_completed' && (
            <View style={styles.cardBody}>
              <View style={styles.badgeRow}>
                <View style={styles.autoBadge}>
                  <Text style={styles.autoBadgeText}>
                    {t('syncActivity.badges.auto')}
                  </Text>
                </View>
                <Text style={styles.badgeLabel}>
                  {t('syncActivity.badges.autoEnabled')}
                </Text>
              </View>

              <View style={styles.runningTitleRow}>
                <Text style={styles.runningTitle}>
                  {t('syncActivity.completed.auto.title')}
                </Text>
                <Text style={[styles.runningPercent, styles.completionPercent]}>
                  100%
                </Text>
              </View>

              <View
                style={[
                  styles.progressBarTrack,
                  styles.progressBarTrackComplete,
                ]}
              >
                <View
                  style={[
                    styles.progressBarFill,
                    styles.progressBarFillComplete,
                  ]}
                />
              </View>

              <Text style={styles.completionSubtitle}>
                {t('syncActivity.completed.auto.subtitle', {
                  count: overview.completedCount,
                })}
              </Text>

              <View style={styles.completionStatsRow}>
                <CompletionStatCard
                  label={t('syncActivity.stats.speed')}
                  value={t('syncActivity.completed.speedIdle')}
                />
                <CompletionStatCard
                  label={t('syncActivity.completed.auto.fileCountLabel')}
                  value={t('syncActivity.completed.auto.fileCountValue', {
                    count: overview.completedCount,
                  })}
                />
                <CompletionStatCard
                  label={t('syncActivity.stats.transferred')}
                  value={formatBytes(overview.completedBytes)}
                />
              </View>

              {latestSyncLabel ? (
                <Text style={styles.completionMetaText}>
                  {t('syncActivity.completed.auto.latestSync', {
                    label: latestSyncLabel,
                  })}
                </Text>
              ) : null}

              <View style={styles.twoButtonRowCompact}>
                <TouchableOpacity
                  style={[styles.rowButton, styles.rowButtonOutlined]}
                  activeOpacity={0.7}
                  onPress={() => navigation.navigate('AlbumWorkbench')}
                >
                  <Text style={styles.rowButtonOutlinedText}>
                    {t('syncActivity.completed.auto.goToAlbum')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.rowButton,
                    styles.rowButtonOutlined,
                    styles.completionDangerButton,
                  ]}
                  activeOpacity={0.7}
                  onPress={handleCloseAutoUpload}
                >
                  <Text style={styles.completionDangerButtonText}>
                    {t('syncActivity.actions.closeAutoUpload')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* ---- State 3: Manual Upload Completed ---- */}
          {mainCardState === 'manual_completed' && (
            <View style={styles.cardBody}>
              <View style={styles.badgeRow}>
                <View style={styles.manualBadge}>
                  <Text style={styles.manualBadgeText}>
                    {t('syncActivity.badges.manual')}
                  </Text>
                </View>
                <Text style={styles.badgeLabel}>
                  {t('syncActivity.badges.manualUploading')}
                </Text>
              </View>

              <View style={styles.runningTitleRow}>
                <Text style={styles.runningTitle}>
                  {t('syncActivity.completed.manual.title')}
                </Text>
                <Text style={[styles.runningPercent, styles.completionPercent]}>
                  100%
                </Text>
              </View>

              <View
                style={[
                  styles.progressBarTrack,
                  styles.progressBarTrackComplete,
                ]}
              >
                <View
                  style={[
                    styles.progressBarFill,
                    styles.progressBarFillComplete,
                  ]}
                />
              </View>

              <Text style={styles.completionSubtitle}>
                {t('syncActivity.completed.manual.subtitle', {
                  completed: overview.completedCount,
                  total: completedProgressTotal,
                })}
              </Text>

              <View style={styles.completionStatsRow}>
                <CompletionStatCard
                  label={t('syncActivity.stats.speed')}
                  value={t('syncActivity.completed.speedIdle')}
                />
                <CompletionStatCard
                  label={t('syncActivity.stats.progress')}
                  value={t('syncActivity.completed.manual.progressValue', {
                    completed: overview.completedCount,
                    total: completedProgressTotal,
                  })}
                />
                <CompletionStatCard
                  label={t('syncActivity.stats.transferred')}
                  value={formatBytes(overview.completedBytes)}
                />
              </View>

              <Text style={styles.completionHintText}>
                {t('syncActivity.completed.manual.hint')}
              </Text>

              <View style={styles.twoButtonRowCompact}>
                <TouchableOpacity
                  style={[styles.rowButton, styles.rowButtonOutlined]}
                  activeOpacity={0.7}
                  onPress={() => navigation.navigate('AlbumWorkbench')}
                >
                  <Text style={styles.rowButtonOutlinedText}>
                    {t('syncActivity.completed.manual.goToAlbum')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.rowButton, styles.rowButtonPrimary]}
                  activeOpacity={0.7}
                  onPress={() => void handleEnableAutoUpload()}
                >
                  <Text style={styles.rowButtonPrimaryText}>
                    {t('syncActivity.completed.manual.enableAuto')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* ---- State 4: Auto Upload Standby ---- */}
          {mainCardState === 'standby' && (
            <View style={styles.cardBody}>
              <View style={styles.badgeRow}>
                <View style={styles.autoBadge}>
                  <Text style={styles.autoBadgeText}>
                    {t('syncActivity.badges.auto')}
                  </Text>
                </View>
                <Text style={styles.badgeLabel}>
                  {t('syncActivity.badges.autoEnabled')}
                </Text>
              </View>

              <Text style={styles.runningTitle}>
                {t('syncActivity.standby.title')}
              </Text>
              <Text style={styles.idleSubtitle}>
                {t('syncActivity.standby.subtitle')}
              </Text>

              {overview.completedCount > 0 && (
                <View style={styles.statsRow}>
                  <View style={styles.statItem}>
                    <Text style={styles.statLabel}>
                      {t('syncActivity.stats.transferred')}
                    </Text>
                    <Text style={styles.statValue}>
                      {t('syncActivity.stats.transferredCount', {
                        count: overview.completedCount,
                      })}
                    </Text>
                  </View>
                  <View style={styles.statDivider} />
                  <View style={styles.statItem}>
                    <Text style={styles.statLabel}>
                      {t('syncActivity.stats.dataAmount')}
                    </Text>
                    <Text style={styles.statValue}>
                      {formatBytes(overview.completedBytes)}
                    </Text>
                  </View>
                </View>
              )}

              <TouchableOpacity
                style={styles.outlinedButton}
                activeOpacity={0.7}
                onPress={handleCloseAutoUpload}
              >
                <Text style={styles.outlinedButtonText}>
                  {t('syncActivity.actions.closeAutoUpload')}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ---- State 5: Auto Upload Not Started ---- */}
          {mainCardState === 'not_started' && (
            <View style={styles.cardBodyCentered}>
              <View style={styles.notStartedIconCircle}>
                <Icon
                  name="alert-circle-outline"
                  size={38}
                  color={EMPTY_INFO_ICON}
                />
              </View>
              <Text style={styles.centeredTitle}>
                {t('syncActivity.notStarted.title')}
              </Text>
              <Text style={styles.centeredSubtitle}>
                {t('syncActivity.notStarted.subtitle')}
              </Text>
              <View style={styles.twoButtonRow}>
                <TouchableOpacity
                  style={[styles.rowButton, styles.rowButtonOutlined]}
                  activeOpacity={0.7}
                  onPress={() => navigation.navigate('AlbumWorkbench')}
                >
                  <Text style={styles.rowButtonOutlinedText}>
                    {t('syncActivity.notStarted.goToAlbum')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.rowButton, styles.rowButtonPrimary]}
                  activeOpacity={0.7}
                  onPress={() => void handleEnableAutoUpload()}
                >
                  <Text style={styles.rowButtonPrimaryText}>
                    {t('syncActivity.notStarted.enableAuto')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* ---- State 6: Device Offline ---- */}
          {mainCardState === 'offline' && (
            <View style={styles.cardBodyCentered}>
              <View style={styles.offlineIconCircle}>
                <Icon
                  name="alert-circle-outline"
                  size={38}
                  color={EMPTY_OFFLINE_ICON}
                />
              </View>
              <Text style={styles.centeredTitle}>
                {t('syncActivity.offline.title')}
              </Text>
              <Text style={styles.centeredSubtitle}>
                {t('syncActivity.offline.subtitle')}
              </Text>
              <View style={styles.twoButtonRow}>
                <TouchableOpacity
                  style={[styles.rowButton, styles.offlineButtonOutlined]}
                  activeOpacity={0.7}
                  onPress={handleSwitchDevice}
                >
                  <Text style={styles.offlineButtonOutlinedText}>
                    {t('syncActivity.offline.switchDevice')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.rowButton, styles.offlineButtonPrimary]}
                  activeOpacity={0.7}
                  onPress={handleReconnect}
                >
                  <Text style={styles.rowButtonPrimaryText}>
                    {t('syncActivity.offline.reconnect')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        {/* Quick entry cards */}
        <View style={styles.quickEntrySection}>
          <Text style={styles.sectionLabel}>
            {t('syncActivity.quickEntry.title')}
          </Text>
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
              <Text style={styles.quickEntryTitle}>
                {t('syncActivity.quickEntry.albumTitle')}
              </Text>
              <Text style={styles.quickEntryDesc}>
                {t('syncActivity.quickEntry.albumDesc')}
              </Text>
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
              <Text style={styles.quickEntryTitle}>
                {t('syncActivity.quickEntry.sharedFilesTitle')}
              </Text>
              <Text style={styles.quickEntryDesc}>
                {t('syncActivity.quickEntry.sharedFilesDesc')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      {/* Trial / Subscription expired overlay — gated by FEATURES until real
          IAP is wired (otherwise the overlay sends users to a dead-end
          subscription screen with no working purchase flow). */}
      {FEATURES.SUBSCRIPTION_ENFORCEMENT &&
        auth.isLoggedIn &&
        !isFeatureAccessAllowed(auth.user?.status) && (
          <Modal visible transparent animationType="fade" statusBarTranslucent>
            <View style={styles.expiredOverlay}>
              <View style={styles.expiredCard}>
                <View style={styles.expiredIconCircle}>
                  <Icon name="shield-outline" size={36} color="#8b5cf6" />
                </View>
                <Text style={styles.expiredTitle}>
                  {t('syncActivity.expired.title')}
                </Text>
                <Text style={styles.expiredSubtitle}>
                  {t('syncActivity.expired.subtitle')}
                </Text>
                <TouchableOpacity
                  style={styles.expiredPrimaryButton}
                  activeOpacity={0.7}
                  onPress={() => navigation.navigate('Subscription')}
                >
                  <Text style={styles.expiredPrimaryButtonText}>
                    {t('syncActivity.expired.subscribeCta')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.6}
                  onPress={() => navigation.navigate('Help')}
                >
                  <Text style={styles.expiredSecondaryText}>
                    {t('syncActivity.expired.viewHelp')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        )}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Overview builder
// ---------------------------------------------------------------------------

export function buildOverview(
  payload: Record<string, unknown>,
  prev: SyncOverview,
): SyncOverview {
  if (!payload) return prev;

  const hasCurrentTaskSource = Object.prototype.hasOwnProperty.call(
    payload,
    'currentTaskSource',
  );
  const uploadState =
    (payload.uploadState as string | undefined) ?? prev.uploadState;
  const currentFileConfirmedBytes =
    (payload.currentFileConfirmedBytes as number | undefined) ??
    (payload.confirmedBytes as number | undefined) ??
    prev.currentFileConfirmedBytes;
  const currentFileTotalBytes =
    (payload.currentFileTotalBytes as number | undefined) ??
    prev.currentFileTotalBytes;
  const shouldClearActiveFile =
    uploadState === 'completed' ||
    uploadState === 'idle' ||
    uploadState === 'paused_auto_upload';
  const nextCurrentTaskSource = hasCurrentTaskSource
    ? (payload.currentTaskSource as UploadTaskSource | undefined) ?? undefined
    : prev.currentTaskSource;
  const nextCompletedCount =
    (payload.completedCount as number | undefined) ?? prev.completedCount;
  const nextTotalCount =
    (payload.totalCount as number | undefined) ??
    (payload.queueTotalCount as number | undefined) ??
    prev.totalCount;
  const nextManualPending =
    (payload.manualPending as number | undefined) ?? prev.manualPending;
  const nextAutoPending =
    (payload.autoPending as number | undefined) ?? prev.autoPending;
  const nextAutoUploadState =
    (payload.autoUploadState as AutoUploadState | undefined) ??
    prev.autoUploadState;
  const isManualFinalFileSettlingToIdle =
    (uploadState === 'idle' || uploadState === 'paused_auto_upload') &&
    (nextAutoUploadState === 'disabled' ||
      nextAutoUploadState === 'interrupted') &&
    (prev.currentTaskSource === 'manual' ||
      (prev.autoUploadState !== 'active' &&
        prev.totalCount > 0 &&
        prev.completedCount >= prev.totalCount) ||
      (prev.autoUploadState !== 'active' &&
        prev.currentFileTotalBytes > 0 &&
        prev.currentFileConfirmedBytes >= prev.currentFileTotalBytes)) &&
    nextManualPending === 0 &&
    nextAutoPending === 0 &&
    nextCompletedCount === 0 &&
    nextTotalCount === 0;
  const effectiveCompletedCount = isManualFinalFileSettlingToIdle
    ? prev.totalCount
    : nextCompletedCount;
  const effectiveTotalCount = isManualFinalFileSettlingToIdle
    ? prev.totalCount
    : nextTotalCount;
  const effectiveCompletedBytes = isManualFinalFileSettlingToIdle
    ? prev.completedCount >= prev.totalCount
      ? Math.max(prev.totalBytes, prev.completedBytes)
      : Math.max(
          prev.totalBytes,
          prev.completedBytes + prev.currentFileConfirmedBytes,
        )
    : (payload.completedBytes as number | undefined) ?? prev.completedBytes;
  const effectiveTotalBytes = isManualFinalFileSettlingToIdle
    ? Math.max(prev.totalBytes, effectiveCompletedBytes)
    : (payload.totalBytes as number | undefined) ??
      (payload.queueTotalBytes as number | undefined) ??
      prev.totalBytes;
  const roundSettledStates = new Set(['idle', 'paused_auto_upload']);
  const roundCompletionBridgeStates = new Set([
    ...roundSettledStates,
    'scanning',
  ]);
  const roundFinishedWithoutCompletedPulse =
    isManualFinalFileSettlingToIdle ||
    (roundCompletionBridgeStates.has(uploadState) &&
      !roundCompletionBridgeStates.has(prev.uploadState) &&
      effectiveTotalCount > 0 &&
      effectiveCompletedCount >= effectiveTotalCount &&
      nextManualPending === 0 &&
      nextAutoPending === 0);
  const derivedLastCompletedTaskSource =
    uploadState === 'completed'
      ? nextCurrentTaskSource ??
        prev.currentTaskSource ??
        prev.lastCompletedTaskSource ??
        ((prev.autoUploadState === 'active'
          ? 'auto'
          : 'manual') as UploadTaskSource)
      : roundFinishedWithoutCompletedPulse
      ? prev.currentTaskSource ??
        prev.lastCompletedTaskSource ??
        ((prev.autoUploadState === 'active'
          ? 'auto'
          : 'manual') as UploadTaskSource)
      : prev.lastCompletedTaskSource;

  return {
    progressPercent:
      (payload.progressPercent as number | undefined) ??
      (currentFileTotalBytes > 0
        ? Math.round((currentFileConfirmedBytes / currentFileTotalBytes) * 100)
        : prev.progressPercent),
    currentSpeedMbps:
      uploadState === 'reconnecting'
        ? 0
        : (payload.currentSpeedMbps as number | undefined) ??
          prev.currentSpeedMbps,
    uploadState,
    completedCount: effectiveCompletedCount,
    totalCount: effectiveTotalCount,
    completedBytes: effectiveCompletedBytes,
    totalBytes: effectiveTotalBytes,
    currentFile: shouldClearActiveFile
      ? undefined
      : 'currentFile' in payload
      ? typeof payload.currentFile === 'string'
        ? payload.currentFile
        : undefined
      : prev.currentFile,
    currentFilename: shouldClearActiveFile
      ? undefined
      : 'currentFilename' in payload
      ? typeof payload.currentFilename === 'string'
        ? payload.currentFilename
        : undefined
      : prev.currentFilename,
    currentFileConfirmedBytes: shouldClearActiveFile
      ? 0
      : 'currentFileConfirmedBytes' in payload || 'confirmedBytes' in payload
      ? currentFileConfirmedBytes
      : prev.currentFileConfirmedBytes,
    currentFileTotalBytes: shouldClearActiveFile
      ? 0
      : 'currentFileTotalBytes' in payload
      ? currentFileTotalBytes
      : prev.currentFileTotalBytes,
    // Native sends null (NSNull) when no task is active — respect it as
    // "clear". Only fall back to prev when the key is absent from payload.
    currentTaskSource: nextCurrentTaskSource,
    lastCompletedTaskSource: derivedLastCompletedTaskSource,
    autoUploadState: nextAutoUploadState,
    manualPending: nextManualPending,
    autoPending: nextAutoPending,
    lastErrorCode:
      typeof payload.lastErrorCode === 'string'
        ? payload.lastErrorCode
        : prev.lastErrorCode,
    discoveryElapsedSec:
      (payload.discoveryElapsedSec as number | undefined) ?? undefined,
    libraryTotal: (payload.libraryTotal as number | undefined) ?? undefined,
    scannedCount: (payload.scannedCount as number | undefined) ?? undefined,
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
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: DARK,
  },

  // Unified main card
  mainCard: {
    marginHorizontal: 20,
    marginBottom: 12,
    borderRadius: 20,
    paddingTop: 18,
    paddingBottom: 20,
    paddingHorizontal: 20,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    shadowColor: '#4f8fbc',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 28,
    elevation: 4,
  },

  // Device row (top of card)
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#d6e7f4',
  },
  deviceIconBox: {
    width: 52,
    height: 52,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: ICON_SURFACE,
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
    backgroundColor: ONLINE_GREEN,
  },
  statusDotConnecting: {
    backgroundColor: CONNECTING_AMBER,
  },
  statusDotOffline: {
    backgroundColor: OFFLINE_SLATE,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
  },
  statusTextOnline: {
    color: ONLINE_TEXT,
  },
  statusTextConnecting: {
    color: CONNECTING_TEXT,
  },
  statusTextOffline: {
    color: OFFLINE_TEXT,
  },

  // Card body for state 1 (running)
  cardBody: {
    marginTop: 16,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  autoBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(34,197,94,0.12)',
  },
  autoBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#16a34a',
  },
  manualBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(59,159,216,0.12)',
  },
  manualBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: BLUE,
  },
  badgeLabel: {
    fontSize: 12,
    color: MUTED_TEXT,
  },
  runningTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  runningTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: DARK,
  },
  idleSubtitle: {
    fontSize: 14,
    color: MUTED_TEXT,
    marginTop: 4,
    marginBottom: 8,
  },
  preparationBody: {
    alignItems: 'center',
    paddingVertical: 20,
    gap: 8,
  },
  preparationTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: DARK,
    marginTop: 4,
  },
  preparationSubtitle: {
    fontSize: 13,
    color: MUTED_TEXT,
  },
  runningPercent: {
    fontSize: 18,
    fontWeight: '700',
    color: BLUE,
  },
  progressBarTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(59,159,216,0.16)',
    overflow: 'hidden',
    marginBottom: 10,
  },
  progressBarTrackComplete: {
    backgroundColor: 'rgba(34,197,94,0.16)',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: BLUE,
  },
  progressBarFillComplete: {
    width: '100%',
    backgroundColor: ONLINE_GREEN,
  },
  completionPercent: {
    color: ONLINE_GREEN,
  },
  currentFileName: {
    fontSize: 12,
    color: MUTED_TEXT,
    marginBottom: 12,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: '#f5fbff',
    marginBottom: 10,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(118, 153, 184, 0.18)',
  },
  statLabel: {
    fontSize: 10,
    color: SOFT_TEXT,
  },
  statValue: {
    fontSize: 13,
    fontWeight: '600',
    color: DARK,
    marginTop: 2,
  },
  queueInfoText: {
    fontSize: 12,
    color: MUTED_TEXT,
    textAlign: 'center',
    marginBottom: 12,
  },
  completionSubtitle: {
    fontSize: 13,
    color: MUTED_TEXT,
    marginBottom: 12,
  },
  completionStatsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  completionStatCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 14,
    backgroundColor: '#f6fbff',
    borderWidth: 1,
    borderColor: 'rgba(182, 211, 238, 0.68)',
  },
  completionStatLabel: {
    fontSize: 10,
    color: SOFT_TEXT,
    marginBottom: 4,
  },
  completionStatValue: {
    fontSize: 14,
    fontWeight: '700',
    color: DARK,
  },
  completionMetaText: {
    fontSize: 12,
    color: MUTED_TEXT,
    textAlign: 'center',
    marginBottom: 12,
  },
  completionHintText: {
    fontSize: 12,
    lineHeight: 18,
    color: SOFT_TEXT,
    textAlign: 'center',
    marginBottom: 12,
    paddingHorizontal: 8,
  },
  twoButtonRowCompact: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
    marginTop: 2,
  },

  // Outlined button (close auto upload)
  outlinedButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: OUTLINE_BORDER,
    backgroundColor: OUTLINE_SURFACE,
    marginTop: 4,
  },
  outlinedButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: OUTLINE_TEXT,
  },
  dangerButton: {
    backgroundColor: 'rgba(229,57,53,0.06)',
    borderColor: 'rgba(229,57,53,0.2)',
  },
  dangerButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#e53935',
  },

  // Card body for state 2 & 3 (centered content)
  cardBodyCentered: {
    marginTop: 20,
    alignItems: 'center',
  },
  emptyIconBox: {
    marginBottom: 14,
  },
  notStartedIconCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: EMPTY_INFO_BG,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  offlineIconCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: EMPTY_OFFLINE_BG,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  centeredTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: DARK,
    marginBottom: 8,
  },
  centeredSubtitle: {
    fontSize: 13,
    color: SOFT_TEXT,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 20,
    paddingHorizontal: 8,
  },
  twoButtonRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  rowButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 14,
  },
  rowButtonOutlined: {
    backgroundColor: OUTLINE_SURFACE,
    borderWidth: 1,
    borderColor: OUTLINE_BORDER,
  },
  rowButtonOutlinedText: {
    fontSize: 14,
    fontWeight: '600',
    color: OUTLINE_TEXT,
  },
  completionDangerButton: {
    borderColor: 'rgba(248, 113, 113, 0.3)',
    backgroundColor: 'rgba(254, 242, 242, 0.96)',
  },
  completionDangerButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ef4444',
  },
  rowButtonPrimary: {
    backgroundColor: PRIMARY_NAVY,
  },
  rowButtonPrimaryText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  offlineButtonOutlined: {
    backgroundColor: OUTLINE_SURFACE,
  },
  offlineButtonOutlinedText: {
    fontSize: 14,
    fontWeight: '600',
    color: OUTLINE_TEXT,
  },
  offlineButtonPrimary: {
    backgroundColor: PRIMARY_NAVY_PRESSED,
  },

  // Quick entry section
  quickEntrySection: {
    paddingHorizontal: 20,
    marginTop: 8,
  },
  sectionLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: DARK,
    marginBottom: 12,
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
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: CARD_BORDER,
    shadowColor: '#4f8fbc',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
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
    color: SOFT_TEXT,
  },

  // Trial / Subscription expired overlay
  expiredOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  expiredCard: {
    width: '100%',
    backgroundColor: '#ffffff',
    borderRadius: 24,
    paddingVertical: 36,
    paddingHorizontal: 28,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
  },
  expiredIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(139,92,246,0.10)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  expiredTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: DARK,
    marginBottom: 10,
  },
  expiredSubtitle: {
    fontSize: 14,
    color: MUTED_TEXT,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 24,
  },
  expiredPrimaryButton: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: PRIMARY_NAVY,
    marginBottom: 16,
  },
  expiredPrimaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  expiredSecondaryText: {
    fontSize: 14,
    fontWeight: '500',
    color: MUTED_TEXT,
  },
});
