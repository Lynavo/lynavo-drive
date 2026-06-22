import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  Modal,
  Platform,
  type AppStateStatus,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useNavigation,
  CommonActions,
  useIsFocused,
} from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type {
  UploadTaskSource,
  AutoUploadState,
  DesktopSyncRecordDTO,
  DeviceType,
} from '@syncflow/contracts';
import { colors } from '../theme/colors';
import { Icon } from '../components/Icon';
import { SubscriptionStatusIcon } from '../components/SubscriptionStatusIcon';
import { GradientBackground } from '../components/GradientBackground';
import { BottomTabBar } from '../components/BottomTabBar';
import { listHistory } from '../services/desktop-local-service';
import {
  RecentDownloadsSection,
  SyncRecordSummarySection,
  type RecentDownloadPlaceholder,
} from './components/SyncActivityHomeSections';
import {
  SyncActivityTour,
  isValidTourTargetLayout,
  type TourTarget,
  type TourTargetLayout,
} from '../components/onboarding/SyncActivityTour';
import {
  disableAutoUpload,
  retryLanReconnect,
} from '../services/SyncEngineModule';
import {
  hasSeenSyncActivityTour,
  markSyncActivityTourSeen,
} from '../utils/onboardingStorage';
import { formatBytes } from '../utils/format';
import { formatLocalDateKey } from '../utils/localDateKey';
import {
  buildSyncConnectionEvidence,
  getConnectionBadgeState,
} from '../utils/effectiveConnectionState';
import { hasPendingManualWork } from '../utils/manualUploadState';
import { rememberAutoUploadRoundProgress } from '../utils/autoUploadRoundProgress';
import {
  getSyncActivityMainCardState,
  getSyncActivityProgressPercent,
  type SyncActivityMainCardState,
} from '../utils/syncActivityTransferState';
import {
  useAuth,
  isFeatureAccessAllowed,
  type SubscriptionInfo,
  type UserProfile,
} from '../stores/auth-store';
import { resolveSubscriptionDisplayState } from '../utils/subscriptionStatusDisplay';
import { FEATURES } from '../constants/features';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { isGlobalMarket } from '../markets';

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
  roundBaselineCompletedCount?: number;
  roundBaselineCompletedBytes?: number;
  currentFile?: string;
  currentFilename?: string;
  currentFileConfirmedBytes: number;
  currentFileTotalBytes: number;
  currentTaskSource?: UploadTaskSource | null;
  lastCompletedTaskSource?: UploadTaskSource | null;
  manualUploadCancelled?: boolean | null;
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

interface QueueItem {
  id: string;
  name: string;
  fileKey: string;
  rawFileSize: number;
  ackedOffset: number;
  type: 'image' | 'video';
  status:
    | 'queued'
    | 'preparing'
    | 'uploading'
    | 'completed'
    | 'failed'
    | 'cloud_downloading';
  isCloudAsset: boolean;
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

interface TodayStats {
  fileCount: number;
  totalBytes: number;
  latestUpdatedAt?: string;
}

interface AutoRoundDisplayBaseline {
  completedCount: number;
  completedBytes: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BLUE = colors.accent;
const DARK = colors.primary;
const SCREEN_BG = 'transparent';
const HEADER_ICON = colors.secondaryForeground;
const PRIMARY_NAVY = colors.primary;
const PRIMARY_NAVY_PRESSED = '#163352';
const OUTLINE_SURFACE = colors.secondary;
const OUTLINE_BORDER = colors.border;
const OUTLINE_TEXT = colors.primary;
const ONLINE_GREEN = colors.success;
const ONLINE_TEXT = colors.success;
const CONNECTING_AMBER = colors.warning;
const CONNECTING_TEXT = colors.warningForeground;
const OFFLINE_SLATE = colors.mutedForeground;
const OFFLINE_TEXT = colors.mutedForeground;
const SOFT_TEXT = colors.secondaryForeground;
const MUTED_TEXT = colors.secondaryForeground;
const EMPTY_INFO_BG = colors.secondary;
const EMPTY_INFO_ICON = colors.mutedForeground;
const EMPTY_OFFLINE_BG = 'rgba(239, 68, 68, 0.08)';
const EMPTY_OFFLINE_ICON = colors.destructive;

/** Grace period on mount / foreground before showing offline state (ms). */
const STARTUP_CONNECTION_GRACE_MS = 2500;
/** Delay before transitioning to offline display (ms). */
const OFFLINE_DISPLAY_DELAY_MS = 800;
/** Minimum time the optimistic "enabling auto-upload" card stays visible. */
const AUTO_UPLOAD_PREPARING_MIN_MS = 400;
/** Safety timeout — force-clear optimistic preparing state if native never confirms. */
const AUTO_UPLOAD_PREPARING_SAFETY_MS = 35000;
const SYNC_ACTIVITY_TOUR_MEASURE_RETRY_LIMIT = 5;
const SYNC_ACTIVITY_TOUR_MEASURE_RETRY_DELAY_MS = 80;
const NATIVE_SYNC_LOOP_ACTIVE_STATES = new Set([
  'scanning',
  'preparing',
  'uploading',
  'cloud_downloading',
  'reconnecting',
  'backoff_waiting',
  'discovering',
  'reconciling',
]);

type MeasurableTourRef = React.ElementRef<typeof TouchableOpacity> | View;

const EMPTY_OVERVIEW: SyncOverview = {
  progressPercent: 0,
  currentSpeedMbps: 0,
  uploadState: 'idle',
  completedCount: 0,
  totalCount: 0,
  completedBytes: 0,
  totalBytes: 0,
  roundBaselineCompletedCount: 0,
  roundBaselineCompletedBytes: 0,
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
  if (error?.code === 'STORAGE_UNAVAILABLE') {
    return t('syncActivity.dialogs.syncError.storageUnavailable');
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

export function shouldTreatSyncActivityAsBetweenItems(
  uploadState: string,
  totalCount: number,
  completedCount: number,
): boolean {
  if (uploadState === 'reconnecting' || uploadState === 'backoff_waiting') {
    return false;
  }

  return (
    (uploadState === 'completed' || isPreparationPhase(uploadState)) &&
    totalCount > 0 &&
    completedCount > 0 &&
    completedCount < totalCount
  );
}

export function shouldBypassOfflineDisplayDelay(snapshot: {
  uploadState?: string | null;
  lastErrorCode?: string | null;
}): boolean {
  return (
    snapshot.uploadState === 'offline' ||
    snapshot.lastErrorCode === 'RECONNECT_EXHAUSTED'
  );
}

export function shouldShowSubscriptionExpiredOverlay({
  subscriptionEnforcement,
  isFocused,
  isLoggedIn,
  featureAccessAllowed,
}: {
  subscriptionEnforcement: boolean;
  isFocused: boolean;
  isLoggedIn: boolean;
  featureAccessAllowed: boolean;
}): boolean {
  return (
    subscriptionEnforcement && isFocused && isLoggedIn && !featureAccessAllowed
  );
}

export function shouldKickAutoUploadSyncAfterGateRelease(snapshot: {
  autoUploadState?: AutoUploadState | null;
  uploadState?: string | null;
  currentTaskSource?: UploadTaskSource | null;
  autoPending?: number | null;
  lastErrorCode?: string | null;
  localEnableInProgress?: boolean;
}): boolean {
  if (snapshot.localEnableInProgress) {
    return false;
  }

  if (snapshot.autoUploadState !== 'active') {
    return false;
  }

  if (snapshot.currentTaskSource === 'auto') {
    return false;
  }

  if (NATIVE_SYNC_LOOP_ACTIVE_STATES.has(snapshot.uploadState ?? '')) {
    return false;
  }

  if (snapshot.lastErrorCode === 'RECONNECT_EXHAUSTED') {
    return false;
  }

  return (
    (snapshot.autoPending ?? 0) > 0 ||
    (typeof snapshot.lastErrorCode === 'string' &&
      snapshot.lastErrorCode.length > 0)
  );
}

export function shouldResetAutoUploadGateKickAttempt(snapshot: {
  autoUploadState?: AutoUploadState | null;
  featureAccessAllowed: boolean;
  bindingDeviceId?: string | null;
}): boolean {
  return (
    snapshot.autoUploadState !== 'active' ||
    !snapshot.featureAccessAllowed ||
    !snapshot.bindingDeviceId
  );
}

export function getTrialUpgradeEntryDays(input: {
  subscription?: SubscriptionInfo | null;
  user?: UserProfile | null;
}): number {
  const state = resolveSubscriptionDisplayState(input);
  if (
    state.kind !== 'account_trial' &&
    state.kind !== 'subscription_intro_trial'
  ) {
    return 0;
  }
  return Math.max(0, state.daysRemaining);
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

export function getSyncActivityAutoRoundDisplayMetrics(input: {
  overview: Pick<
    SyncOverview,
    | 'autoUploadState'
    | 'uploadState'
    | 'completedCount'
    | 'totalCount'
    | 'completedBytes'
    | 'currentTaskSource'
    | 'lastCompletedTaskSource'
    | 'autoPending'
    | 'roundBaselineCompletedCount'
    | 'roundBaselineCompletedBytes'
  >;
  isManualUploading: boolean;
  rawMainCardState: SyncActivityMainCardState;
  baseline?: AutoRoundDisplayBaseline | null;
}): {
  shouldTrack: boolean;
  baseline: AutoRoundDisplayBaseline | null;
  completedCount: number;
  totalCount: number;
  completedBytes: number;
} {
  const { overview, isManualUploading, rawMainCardState, baseline } = input;
  const shouldTrack =
    overview.autoUploadState === 'active' &&
    !isManualUploading &&
    (baseline !== null ||
      rawMainCardState === 'standby' ||
      rawMainCardState === 'auto_completed' ||
      overview.currentTaskSource === 'auto' ||
      (overview.autoPending ?? 0) > 0);

  if (!shouldTrack) {
    return {
      shouldTrack: false,
      baseline: null,
      completedCount: overview.completedCount,
      totalCount: overview.totalCount,
      completedBytes: overview.completedBytes,
    };
  }

  const resolvedKnownBaseline = baseline ?? null;

  if (rawMainCardState === 'auto_completed') {
    return {
      shouldTrack: true,
      baseline: resolvedKnownBaseline,
      completedCount: overview.completedCount,
      totalCount: overview.totalCount,
      completedBytes: overview.completedBytes,
    };
  }

  const canSeedBaseline =
    baseline !== null ||
    (overview.currentTaskSource !== 'auto' && rawMainCardState !== 'standby');

  if (!resolvedKnownBaseline && !canSeedBaseline) {
    return {
      shouldTrack: true,
      baseline: null,
      completedCount: overview.completedCount,
      totalCount: overview.totalCount,
      completedBytes: overview.completedBytes,
    };
  }

  const resolvedBaseline = resolvedKnownBaseline ?? {
    completedCount: overview.completedCount,
    completedBytes: overview.completedBytes,
  };
  const completedCount = Math.max(
    0,
    overview.completedCount - resolvedBaseline.completedCount,
  );
  const totalCount = Math.max(
    completedCount,
    overview.totalCount - resolvedBaseline.completedCount,
  );
  const completedBytes = Math.max(
    0,
    overview.completedBytes - resolvedBaseline.completedBytes,
  );

  return {
    shouldTrack: true,
    baseline: resolvedBaseline,
    completedCount,
    totalCount,
    completedBytes,
  };
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
  const isScreenFocused = useIsFocused();
  const { t } = useTranslation();
  const isGlobalBuild = isGlobalMarket();
  const auth = useAuth();
  const [overview, setOverview] = useState<SyncOverview>(EMPTY_OVERVIEW);
  const [bindingState, setBindingState] = useState<BindingState | null>(null);
  const [todayStats, setTodayStats] = useState<TodayStats>({
    fileCount: 0,
    totalBytes: 0,
    latestUpdatedAt: undefined,
  });
  const [initialLoading, setInitialLoading] = useState(true);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [historyRecords, setHistoryRecords] = useState<DesktopSyncRecordDTO[]>(
    [],
  );

  const refreshQueue = useCallback(async () => {
    try {
      const { NativeSyncEngine } = NativeModules;
      if (!NativeSyncEngine) return;
      const queueData = await NativeSyncEngine.getReadOnlyQueue();
      if (queueData) {
        setQueue(
          queueData.map((item: any, index: number) => ({
            id: String(item.id ?? index),
            name: (item.originalFilename as string) || 'Unknown',
            fileKey: (item.fileKey as string) || '',
            rawFileSize: (item.fileSize as number) ?? 0,
            ackedOffset: (item.ackedOffset as number) ?? 0,
            type: (item.mediaType as string) === 'video' ? 'video' : 'image',
            status: ((item.status as string) ?? 'queued') as any,
            isCloudAsset: Boolean(item.isCloudAsset),
          })),
        );
      }
    } catch (e) {
      console.warn('[SyncActivity] Failed to get read-only queue:', e);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const { NativeSyncEngine } = NativeModules;
      if (!NativeSyncEngine) return;
      const binding = await NativeSyncEngine.getBindingState();
      if (!binding || !binding.host) {
        setHistoryRecords([]);
        return;
      }
      const desktop = { host: binding.host, port: 39394 };
      const result = await listHistory(desktop);
      setHistoryRecords(result || []);
    } catch (e) {
      console.warn('[SyncActivityScreen] Failed to load history:', e);
    }
  }, []);

  useEffect(() => {
    if (isScreenFocused) {
      void refreshQueue();
      void loadHistory();
    }
  }, [isScreenFocused, refreshQueue, loadHistory]);

  const [showSyncActivityTour, setShowSyncActivityTour] = useState(false);
  const [syncActivityTourChecked, setSyncActivityTourChecked] = useState(false);
  const [syncActivityTourTargetLayouts, setSyncActivityTourTargetLayouts] =
    useState<Partial<Record<TourTarget, TourTargetLayout>>>({});
  const [autoRoundDisplayBaseline, setAutoRoundDisplayBaseline] =
    useState<AutoRoundDisplayBaseline | null>(null);
  const mainCardRef = useRef<View>(null);
  const albumQuickEntryTargetRef = useRef<View>(null);
  const helpHeaderActionRef =
    useRef<React.ElementRef<typeof TouchableOpacity>>(null);
  const historyHeaderActionRef =
    useRef<React.ElementRef<typeof TouchableOpacity>>(null);
  const settingsHeaderActionRef =
    useRef<React.ElementRef<typeof TouchableOpacity>>(null);

  // Offline debounce: stabilize isOffline to avoid rapid UI flicker
  const [stableOffline, setStableOffline] = useState(false);
  const [connectionGraceActive, setConnectionGraceActive] = useState(true);
  const offlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const autoUploadGateKickAttemptedRef = useRef(false);
  const lastAutoUploadingVisualRef = useRef<{
    currentFilename?: string;
    currentSpeedMbps: number;
  } | null>(null);
  const featureAccessAllowed = isFeatureAccessAllowed(
    auth.subscription?.status ?? auth.user?.status,
  );
  const trialUpgradeEntryDays = getTrialUpgradeEntryDays({
    subscription: auth.subscription,
    user: auth.user,
  });

  const measureSyncActivityTourTarget = useCallback(
    (
      target: TourTarget,
      ref: React.RefObject<MeasurableTourRef | null>,
      attempt = 0,
    ) => {
      const node = ref.current;
      if (!node) return;

      requestAnimationFrame(() => {
        node.measureInWindow((x, y, measuredWidth, measuredHeight) => {
          const next: TourTargetLayout = {
            left: x,
            top: y,
            width: measuredWidth,
            height: measuredHeight,
          };

          if (!isValidTourTargetLayout(next)) {
            if (attempt < SYNC_ACTIVITY_TOUR_MEASURE_RETRY_LIMIT) {
              setTimeout(() => {
                measureSyncActivityTourTarget(target, ref, attempt + 1);
              }, SYNC_ACTIVITY_TOUR_MEASURE_RETRY_DELAY_MS);
            }
            return;
          }

          setSyncActivityTourTargetLayouts(prev => {
            const current = prev[target];
            if (
              current &&
              Math.abs(current.left - next.left) < 0.5 &&
              Math.abs(current.top - next.top) < 0.5 &&
              Math.abs(current.width - next.width) < 0.5 &&
              Math.abs(current.height - next.height) < 0.5
            ) {
              return prev;
            }

            return {
              ...prev,
              [target]: next,
            };
          });
        });
      });
    },
    [],
  );

  useEffect(() => {
    if (!showSyncActivityTour) return;

    measureSyncActivityTourTarget('help', helpHeaderActionRef);
    measureSyncActivityTourTarget('history', historyHeaderActionRef);
    measureSyncActivityTourTarget('settings', settingsHeaderActionRef);
    measureSyncActivityTourTarget('panel', mainCardRef);
    measureSyncActivityTourTarget('album', albumQuickEntryTargetRef);
  }, [measureSyncActivityTourTarget, showSyncActivityTour]);

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  const loadTodayStats = useCallback(
    async (engine?: Record<string, Function>) => {
      try {
        const mod = engine ?? NativeModules.NativeSyncEngine;
        if (!mod) return;
        const history = await mod.getHistoryDays('');
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
        syncSub = emitter.addListener(
          'onSyncStateChanged',
          (state: Record<string, unknown>) => {
            setOverview(prev => {
              const next = buildOverview(state, prev);
              rememberAutoUploadRoundProgress(next);
              return next;
            });
            void refreshQueue();
            if (state.uploadState === 'completed') {
              void loadTodayStats();
              void loadHistory();
            }
          },
        );
        errorSub = emitter.addListener('onError', (error: SyncErrorEvent) => {
          const msg = resolveSyncErrorAlertMessage(error, t);
          Alert.alert(t('syncActivity.dialogs.syncError.title'), msg);
        });

        const binding = await NativeSyncEngine.getBindingState();
        applyBindingState(binding);

        await loadTodayStats(NativeSyncEngine);
        await refreshQueue();

        const syncData = await NativeSyncEngine.getSyncOverview();
        if (syncData) {
          setOverview(prev => {
            const next = buildOverview(syncData, prev);
            rememberAutoUploadRoundProgress(next);
            return next;
          });
        }

        setInitialLoading(false);

        await NativeSyncEngine.startDiscovery();
        // Do not unconditionally call triggerSync() here. Auto upload still
        // needs an explicit active config; a focused effect below resumes only
        // that already-enabled state after subscription/paywall navigation.
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
  }, [loadTodayStats, navigation, t, refreshQueue]);

  useEffect(() => {
    if (initialLoading || !bindingState?.deviceId || syncActivityTourChecked) {
      return;
    }

    let cancelled = false;
    setSyncActivityTourChecked(true);
    void hasSeenSyncActivityTour().then(seen => {
      if (!cancelled && !seen) {
        setShowSyncActivityTour(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [bindingState?.deviceId, initialLoading, syncActivityTourChecked]);

  useEffect(() => {
    if (
      !isScreenFocused ||
      !featureAccessAllowed ||
      !bindingState?.deviceId ||
      overview.autoUploadState !== 'active'
    ) {
      if (
        shouldResetAutoUploadGateKickAttempt({
          autoUploadState: overview.autoUploadState,
          featureAccessAllowed,
          bindingDeviceId: bindingState?.deviceId,
        })
      ) {
        autoUploadGateKickAttemptedRef.current = false;
      }
      return;
    }

    if (
      autoUploadGateKickAttemptedRef.current ||
      !shouldKickAutoUploadSyncAfterGateRelease({
        ...overview,
        localEnableInProgress: autoUploadPreparing,
      })
    ) {
      return;
    }

    const { NativeSyncEngine } = NativeModules;
    if (!NativeSyncEngine) return;

    autoUploadGateKickAttemptedRef.current = true;
    void Promise.resolve(NativeSyncEngine.startDiscovery?.())
      .catch((e: Error) => {
        console.warn(
          '[SyncActivity] auto-upload gate release discovery failed:',
          e,
        );
      })
      .finally(() => {
        NativeSyncEngine.triggerSync?.().catch((e: Error) => {
          console.warn(
            '[SyncActivity] auto-upload gate release trigger failed:',
            e,
          );
        });
      });
  }, [
    isScreenFocused,
    featureAccessAllowed,
    bindingState?.deviceId,
    overview.autoUploadState,
    overview.uploadState,
    overview.currentTaskSource,
    overview.autoPending,
    overview.lastErrorCode,
    autoUploadPreparing,
  ]);

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
        setConnectionGraceActive(true);
        setStableOffline(false);
        if (foregroundGraceTimer) clearTimeout(foregroundGraceTimer);
        foregroundGraceTimer = setTimeout(() => {
          setConnectionGraceActive(false);
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
      setConnectionGraceActive(false);
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
              await disableAutoUpload();
              // Reload overview to reflect the new state
              const syncData =
                await NativeModules.NativeSyncEngine?.getSyncOverview();
              if (syncData) {
                setOverview(prev => buildOverview(syncData, prev));
              }
            } catch (e) {
              console.warn('[SyncActivity] disableAutoUpload error:', e);
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
      await retryLanReconnect({ allowWake: true });
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

  const handleEnableAutoUpload = useCallback(() => {
    navigation.navigate('AutoUploadSettings');
  }, [navigation]);

  const handleDismissSyncActivityTour = useCallback(() => {
    void markSyncActivityTourSeen();
    setShowSyncActivityTour(false);
  }, []);

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
  const shouldBypassOfflineDelay = shouldBypassOfflineDisplayDelay(overview);

  // Debounce offline transitions: delay going offline, instant recovery
  useEffect(() => {
    if (isOffline && shouldBypassOfflineDelay) {
      if (offlineTimerRef.current) {
        clearTimeout(offlineTimerRef.current);
        offlineTimerRef.current = null;
      }
      setStableOffline(true);
    } else if (isOffline && !connectionGraceActive) {
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
  }, [connectionGraceActive, isOffline, shouldBypassOfflineDelay]);

  const isAutoUploadActive = overview.autoUploadState === 'active';
  const currentTaskSource = overview.currentTaskSource;
  const hasManualUploadWork = hasPendingManualWork({
    manualPending: overview.manualPending,
    currentTaskSource,
  });

  // ---------------------------------------------------------------------------
  // Card state determination
  // ---------------------------------------------------------------------------

  // State 1: Upload Running — auto or manual upload active
  // State 2: Auto Upload Not Started — device online, no upload active
  // State 3: Device Offline

  const isManualUploading = hasManualUploadWork;

  const rawMainCardState = getSyncActivityMainCardState(
    overview,
    stableOffline || (isOffline && shouldBypassOfflineDelay),
  );
  const shouldDelayAutoCompletion = false;
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
  const isBetweenItems = shouldTreatSyncActivityAsBetweenItems(
    overview.uploadState,
    overview.totalCount,
    overview.completedCount,
  );
  const shouldFreezeItemVisuals = shouldDelayAutoCompletion || isBetweenItems;
  const displayCurrentFilename = shouldFreezeItemVisuals
    ? (lastAutoUploadingVisualRef.current?.currentFilename ??
      overview.currentFilename)
    : overview.currentFilename;
  const displayCurrentSpeedMbps = shouldFreezeItemVisuals
    ? (lastAutoUploadingVisualRef.current?.currentSpeedMbps ??
      overview.currentSpeedMbps)
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
  const autoRoundDisplayMetrics = getSyncActivityAutoRoundDisplayMetrics({
    overview,
    isManualUploading,
    rawMainCardState,
    baseline: autoRoundDisplayBaseline,
  });
  const displayCompletedCount = autoRoundDisplayMetrics.completedCount;
  const displayTotalCount = autoRoundDisplayMetrics.totalCount;
  const displayCompletedBytes = autoRoundDisplayMetrics.completedBytes;
  const latestSyncLabel = todayStats.latestUpdatedAt
    ? formatDateTimeLabel(todayStats.latestUpdatedAt, t)
    : undefined;
  const autoUploadEnabledForDisplay =
    isAutoUploadActive ||
    autoUploadPreparing ||
    mainCardState === 'running' ||
    mainCardState === 'standby' ||
    mainCardState === 'auto_completed';
  const recentDownloadItems = historyRecords.slice(0, 4);
  const recentDownloadPlaceholders: RecentDownloadPlaceholder[] = [
    {
      key: 'photo',
      label: t('syncActivity.home.recentDownloadPhoto'),
      iconName: 'image-outline',
      iconColor: BLUE,
      iconBackground: '#B8DDF8',
    },
    {
      key: 'video',
      label: t('syncActivity.home.recentDownloadVideo'),
      iconName: 'play-circle-outline',
      iconColor: '#ffffff',
      iconBackground: '#AAB7FF',
    },
    {
      key: 'file-1',
      label: t('syncActivity.home.recentDownloadFile'),
      iconName: 'document-outline',
      iconColor: '#315E8C',
      iconBackground: '#EEF3FA',
    },
    {
      key: 'file-2',
      label: t('syncActivity.home.recentDownloadFile'),
      iconName: 'document-outline',
      iconColor: '#315E8C',
      iconBackground: '#EEF3FA',
    },
  ];
  const showSubscriptionExpiredOverlay = shouldShowSubscriptionExpiredOverlay({
    subscriptionEnforcement: FEATURES.SUBSCRIPTION_ENFORCEMENT,
    isFocused: isScreenFocused,
    isLoggedIn: auth.isLoggedIn,
    featureAccessAllowed,
  });

  useEffect(() => {
    if (autoRoundDisplayMetrics.shouldTrack) {
      const nextBaseline = autoRoundDisplayMetrics.baseline;
      if (
        nextBaseline &&
        (autoRoundDisplayBaseline?.completedCount !==
          nextBaseline.completedCount ||
          autoRoundDisplayBaseline?.completedBytes !==
            nextBaseline.completedBytes)
      ) {
        setAutoRoundDisplayBaseline(nextBaseline);
      }
      return;
    }

    if (autoRoundDisplayBaseline !== null) {
      setAutoRoundDisplayBaseline(null);
    }
  }, [autoRoundDisplayBaseline, autoRoundDisplayMetrics]);

  useEffect(() => {
    // Cache the last known uploading visual regardless of task source.
    // Used to freeze filename/speed during inter-item transitions, where
    // uploadState briefly flips to 'completed' and clears current file fields.
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
    <GradientBackground>
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
                ref={helpHeaderActionRef}
                testID="sync-activity-tour-target-help"
                style={styles.headerActionButton}
                accessibilityRole="button"
                accessibilityLabel={t('syncActivity.header.help')}
                activeOpacity={0.7}
                onLayout={() =>
                  measureSyncActivityTourTarget('help', helpHeaderActionRef)
                }
                onPress={() => navigation.navigate('Help')}
              >
                <Icon
                  name="help-circle-outline"
                  size={24}
                  color={HEADER_ICON}
                />
              </TouchableOpacity>
              <TouchableOpacity
                ref={historyHeaderActionRef}
                testID="sync-activity-tour-target-history"
                style={styles.headerActionButton}
                accessibilityRole="button"
                accessibilityLabel={t('syncActivity.header.history')}
                activeOpacity={0.7}
                onLayout={() =>
                  measureSyncActivityTourTarget(
                    'history',
                    historyHeaderActionRef,
                  )
                }
                onPress={() => navigation.navigate('History')}
              >
                <Icon name="time-outline" size={24} color={HEADER_ICON} />
              </TouchableOpacity>
              <TouchableOpacity
                ref={settingsHeaderActionRef}
                testID="sync-activity-tour-target-settings"
                style={styles.headerActionButton}
                accessibilityRole="button"
                accessibilityLabel={t('syncActivity.header.settings')}
                activeOpacity={0.7}
                onLayout={() =>
                  measureSyncActivityTourTarget(
                    'settings',
                    settingsHeaderActionRef,
                  )
                }
                onPress={() => navigation.navigate('Settings')}
              >
                <Icon name="settings-outline" size={24} color={HEADER_ICON} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Unified main card */}
          <View
            ref={mainCardRef}
            testID="sync-activity-tour-target-panel"
            style={styles.mainCard}
            onLayout={() => measureSyncActivityTourTarget('panel', mainCardRef)}
          >
            <View testID="sync-activity-device-row" style={styles.deviceRow}>
              <View style={styles.deviceIconBox}>
                <Icon name="desktop-outline" size={22} color={BLUE} />
              </View>
              <View style={styles.deviceInfo}>
                <Text style={styles.deviceName} numberOfLines={1}>
                  {boundDeviceName}
                </Text>
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

            {mainCardState === 'offline' ? (
              <View style={styles.cardBodyCentered}>
                <View style={styles.offlineIconCircle}>
                  <Icon
                    name="cloud-offline-outline"
                    size={32}
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
                    style={[styles.rowButton, styles.rowButtonOutlined]}
                    activeOpacity={0.75}
                    onPress={handleSwitchDevice}
                  >
                    <Text style={styles.rowButtonOutlinedText}>
                      {t('syncActivity.offline.switchDevice')}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.rowButton, styles.rowButtonPrimary]}
                    activeOpacity={0.75}
                    onPress={handleReconnect}
                  >
                    <Text style={styles.rowButtonPrimaryText}>
                      {t('syncActivity.offline.reconnect')}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : mainCardState === 'not_started' ? (
              <View style={styles.cardBodyCentered}>
                <View style={styles.notStartedIconCircle}>
                  <Icon
                    name="information-circle-outline"
                    size={32}
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
                    activeOpacity={0.75}
                    onPress={() => navigation.navigate('AlbumWorkbench')}
                  >
                    <Text style={styles.rowButtonOutlinedText}>
                      {t('syncActivity.notStarted.goToAlbum')}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.rowButton, styles.rowButtonPrimary]}
                    activeOpacity={0.75}
                    onPress={handleEnableAutoUpload}
                  >
                    <Text style={styles.rowButtonPrimaryText}>
                      {t('syncActivity.notStarted.enableAuto')}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : mainCardState === 'auto_interrupted' ? (
              <View style={styles.cardBodyCentered}>
                <View style={styles.offlineIconCircle}>
                  <Icon
                    name="pause-circle-outline"
                    size={32}
                    color={EMPTY_OFFLINE_ICON}
                  />
                </View>
                <Text style={styles.centeredTitle}>
                  {t('syncActivity.interrupted.title')}
                </Text>
                <Text style={styles.centeredSubtitle}>
                  {t('syncActivity.interrupted.subtitle')}
                </Text>
                <View style={styles.twoButtonRow}>
                  <TouchableOpacity
                    style={[styles.rowButton, styles.rowButtonOutlined]}
                    activeOpacity={0.75}
                    onPress={() => navigation.navigate('AlbumWorkbench')}
                  >
                    <Text style={styles.rowButtonOutlinedText}>
                      {t('syncActivity.interrupted.goToAlbum')}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.rowButton, styles.rowButtonPrimary]}
                    activeOpacity={0.75}
                    onPress={handleEnableAutoUpload}
                  >
                    <Text style={styles.rowButtonPrimaryText}>
                      {t('syncActivity.interrupted.resumeAuto')}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : mainCardState === 'manual_completed' ? (
              <View style={styles.cardBody}>
                <View style={styles.badgeRow}>
                  <View style={styles.manualBadge}>
                    <Text style={styles.manualBadgeText}>
                      {t('syncActivity.badges.manual')}
                    </Text>
                  </View>
                </View>
                <View style={styles.runningTitleRow}>
                  <Text style={styles.runningTitle}>
                    {t('syncActivity.completed.manual.title')}
                  </Text>
                  <Text
                    style={[styles.runningPercent, styles.completionPercent]}
                  >
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
                    completed: displayCompletedCount,
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
                      completed: displayCompletedCount,
                      total: completedProgressTotal,
                    })}
                  />
                  <CompletionStatCard
                    label={t('syncActivity.stats.transferred')}
                    value={formatBytes(displayCompletedBytes)}
                  />
                </View>
                <Text style={styles.completionHintText}>
                  {t('syncActivity.completed.manual.hint')}
                </Text>
                <View style={styles.twoButtonRowCompact}>
                  <TouchableOpacity
                    style={[styles.rowButton, styles.rowButtonOutlined]}
                    activeOpacity={0.75}
                    onPress={() => navigation.navigate('AlbumWorkbench')}
                  >
                    <Text style={styles.rowButtonOutlinedText}>
                      {t('syncActivity.completed.manual.goToAlbum')}
                    </Text>
                  </TouchableOpacity>
                  {!autoUploadEnabledForDisplay && (
                    <TouchableOpacity
                      style={[styles.rowButton, styles.rowButtonPrimary]}
                      activeOpacity={0.75}
                      onPress={handleEnableAutoUpload}
                    >
                      <Text style={styles.rowButtonPrimaryText}>
                        {t('syncActivity.completed.manual.enableAuto')}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ) : mainCardState === 'auto_completed' ? (
              <View style={styles.cardBody}>
                <View style={styles.badgeRow}>
                  <View style={styles.autoBadge}>
                    <Text style={styles.autoBadgeText}>
                      {t('syncActivity.badges.auto')}
                    </Text>
                  </View>
                </View>
                <View style={styles.runningTitleRow}>
                  <Text style={styles.runningTitle}>
                    {t('syncActivity.completed.auto.title')}
                  </Text>
                  <Text
                    style={[styles.runningPercent, styles.completionPercent]}
                  >
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
                    count: displayCompletedCount,
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
                      count: displayCompletedCount,
                    })}
                  />
                  <CompletionStatCard
                    label={t('syncActivity.stats.transferred')}
                    value={formatBytes(displayCompletedBytes)}
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
                    activeOpacity={0.75}
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
                    activeOpacity={0.75}
                    onPress={handleCloseAutoUpload}
                  >
                    <Text style={styles.completionDangerButtonText}>
                      {t('syncActivity.actions.closeAutoUpload')}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={styles.cardBody}>
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
                  {!isManualUploading && (
                    <Text style={styles.badgeLabel}>
                      {t('syncActivity.badges.autoEnabled')}
                    </Text>
                  )}
                </View>
                <View style={styles.runningTitleRow}>
                  <Text style={styles.runningTitle}>
                    {shouldRenderPreparationPhase
                      ? getPreparationTitle(overview.uploadState, t)
                      : mainCardState === 'standby'
                        ? t('syncActivity.standby.title')
                        : isManualUploading
                          ? t('syncActivity.running.manualTitle')
                          : t('syncActivity.running.autoTitle')}
                  </Text>
                  <Text style={styles.runningPercent}>
                    {displayProgressPercent}%
                  </Text>
                </View>
                <View style={styles.progressBarTrack}>
                  <View
                    style={[
                      styles.progressBarFill,
                      {
                        width: `${Math.min(100, displayProgressPercent)}%`,
                      },
                    ]}
                  />
                </View>
                {displayCurrentFilename ? (
                  <Text style={styles.currentFileName} numberOfLines={1}>
                    {displayCurrentFilename}
                  </Text>
                ) : shouldRenderPreparationPhase ? (
                  <Text style={styles.currentFileName}>
                    {getPreparationSubtitle(overview, t)}
                  </Text>
                ) : mainCardState === 'standby' ? (
                  <Text style={styles.currentFileName}>
                    {t('syncActivity.standby.subtitle')}
                  </Text>
                ) : null}
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
                      {`${displayCompletedCount} / ${Math.max(
                        displayTotalCount,
                        displayCompletedCount,
                      )}`}
                    </Text>
                  </View>
                  <View style={styles.statDivider} />
                  <View style={styles.statItem}>
                    <Text style={styles.statLabel}>
                      {t('syncActivity.stats.transferred')}
                    </Text>
                    <Text style={styles.statValue}>
                      {formatBytes(displayCompletedBytes)}
                    </Text>
                  </View>
                </View>
                <Text style={styles.queueInfoText}>
                  {t('syncActivity.running.queueInfo', {
                    queued: Math.max(
                      queue.length,
                      overview.manualPending ?? 0,
                      overview.autoPending ?? 0,
                    ),
                  })}
                </Text>
                {!isManualUploading && (
                  <TouchableOpacity
                    style={styles.outlinedButton}
                    activeOpacity={0.75}
                    onPress={handleCloseAutoUpload}
                  >
                    <Text style={styles.outlinedButtonText}>
                      {t('syncActivity.actions.closeAutoUpload')}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>

          {queue.length > 0 && (
            <View style={styles.queueSection}>
              <Text style={styles.sectionLabel}>
                {t('syncActivity.queue.title') || '待同步佇列'} ({queue.length})
              </Text>
              <View style={styles.queueList}>
                {queue.map((item, index) => {
                  const isActive =
                    item.status === 'uploading' ||
                    (item.fileKey.length > 0 &&
                      item.fileKey === overview.currentFile);
                  const showItemProgress =
                    isActive && overview.currentFileTotalBytes > 0;
                  const progressPercent = showItemProgress
                    ? Math.round(
                        (overview.currentFileConfirmedBytes /
                          overview.currentFileTotalBytes) *
                          100,
                      )
                    : 0;

                  return (
                    <View
                      key={item.id}
                      style={[
                        styles.queueRow,
                        index !== queue.length - 1 && styles.queueRowBorder,
                        isActive && styles.queueRowUploading,
                      ]}
                    >
                      <View style={styles.queueIcon}>
                        <Icon
                          name={
                            item.type === 'video'
                              ? 'videocam-outline'
                              : 'image-outline'
                          }
                          size={18}
                          color={BLUE}
                        />
                      </View>
                      <View style={styles.queueInfo}>
                        <Text style={styles.queueFileName} numberOfLines={1}>
                          {item.name}
                        </Text>
                        <View style={styles.queueFileMeta}>
                          <Text style={styles.queueFileSize}>
                            {formatBytes(item.rawFileSize)}
                          </Text>
                          {isActive && (
                            <View style={styles.uploadingBadge}>
                              <View style={styles.uploadingDot} />
                              <Text style={styles.uploadingLabel}>
                                {t('syncStatus.queue.itemStatus.transferring', {
                                  percent: progressPercent,
                                }) || `傳輸中 ${progressPercent}%`}
                              </Text>
                            </View>
                          )}
                          {item.status === 'cloud_downloading' && (
                            <View style={styles.uploadingBadge}>
                              <View style={styles.uploadingDot} />
                              <Text style={styles.uploadingLabel}>
                                {t(
                                  'syncStatus.queue.itemStatus.cloudDownloading',
                                ) || 'iCloud 下載中'}
                              </Text>
                            </View>
                          )}
                          {item.status === 'preparing' && (
                            <View style={styles.uploadingBadge}>
                              <View style={styles.uploadingDot} />
                              <Text style={styles.uploadingLabel}>
                                {t('syncStatus.queue.itemStatus.preparing') ||
                                  '準備中'}
                              </Text>
                            </View>
                          )}
                          {item.isCloudAsset && (
                            <View style={styles.cloudAssetBadge}>
                              <Icon
                                name="cloud-outline"
                                size={11}
                                color={BLUE}
                              />
                              <Text style={styles.cloudAssetLabel}>
                                {'iCloud'}
                              </Text>
                            </View>
                          )}
                        </View>
                        {showItemProgress && (
                          <View style={styles.itemProgressGroup}>
                            <View style={styles.itemProgressTrack}>
                              <View
                                style={[
                                  styles.itemProgressFill,
                                  {
                                    width: `${progressPercent}%`,
                                  },
                                ]}
                              />
                            </View>
                          </View>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {/* Quick entry cards */}
          <View style={styles.quickEntrySection}>
            <Text style={styles.sectionLabel}>
              {t('syncActivity.quickEntry.title')}
            </Text>
            <View style={styles.quickEntryRow}>
              <View
                ref={albumQuickEntryTargetRef}
                collapsable={false}
                testID="sync-activity-tour-target-album"
                style={styles.quickEntryTarget}
                onLayout={() =>
                  measureSyncActivityTourTarget(
                    'album',
                    albumQuickEntryTargetRef,
                  )
                }
              >
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
              </View>

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
                  {t(
                    isGlobalBuild
                      ? 'syncActivity.quickEntry.globalSharedFilesTitle'
                      : 'syncActivity.quickEntry.sharedFilesTitle',
                  )}
                </Text>
                <Text style={styles.quickEntryDesc}>
                  {t(
                    isGlobalBuild
                      ? 'syncActivity.quickEntry.globalSharedFilesDesc'
                      : 'syncActivity.quickEntry.sharedFilesDesc',
                  )}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <RecentDownloadsSection
            records={recentDownloadItems}
            placeholders={recentDownloadPlaceholders}
            t={t}
            onPressViewAll={() => navigation.navigate('History')}
          />

          <SyncRecordSummarySection
            boundDeviceName={boundDeviceName}
            fileCount={todayStats.fileCount}
            isSyncing={mainCardState === 'running'}
            t={t}
            totalBytes={todayStats.totalBytes}
          />

          {trialUpgradeEntryDays > 0 && (
            <TouchableOpacity
              style={styles.trialUpgradeEntry}
              activeOpacity={0.75}
              onPress={() => navigation.navigate('Subscription')}
            >
              <View style={styles.trialUpgradeIcon}>
                <SubscriptionStatusIcon tone="trial" size={22} />
              </View>
              <Text style={styles.trialUpgradeText}>
                {t('syncActivity.trialUpgrade.entry', {
                  days: trialUpgradeEntryDays,
                })}
              </Text>
              <Icon name="chevron-forward" size={18} color="#d97706" />
            </TouchableOpacity>
          )}
        </ScrollView>

        {/* Trial / Subscription expired overlay — gated by FEATURES until real
          IAP is wired (otherwise the overlay sends users to a dead-end
          subscription screen with no working purchase flow). */}
        {showSubscriptionExpiredOverlay && (
          <Modal visible transparent animationType="fade" statusBarTranslucent>
            <View style={styles.expiredOverlay}>
              <View style={styles.expiredCard}>
                <View style={styles.expiredIconCircle}>
                  <SubscriptionStatusIcon tone="expired" size={34} />
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
        <SyncActivityTour
          visible={showSyncActivityTour}
          onSkip={() => void handleDismissSyncActivityTour()}
          onFinish={() => void handleDismissSyncActivityTour()}
          targetLayouts={syncActivityTourTargetLayouts}
          targetFallbackMode="ratio"
        />
      </SafeAreaView>
      <BottomTabBar activeTab="home" />
    </GradientBackground>
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
  const hasLastCompletedTaskSource = Object.prototype.hasOwnProperty.call(
    payload,
    'lastCompletedTaskSource',
  );
  const payloadLastCompletedTaskSource =
    payload.lastCompletedTaskSource === 'auto' ||
    payload.lastCompletedTaskSource === 'manual'
      ? payload.lastCompletedTaskSource
      : undefined;
  const hasLastErrorCode = Object.prototype.hasOwnProperty.call(
    payload,
    'lastErrorCode',
  );
  const payloadLastErrorCode =
    typeof payload.lastErrorCode === 'string'
      ? payload.lastErrorCode
      : undefined;
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
    ? ((payload.currentTaskSource as UploadTaskSource | undefined) ?? undefined)
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
  const isSettledUploadState =
    uploadState === 'idle' || uploadState === 'paused_auto_upload';
  const isManualUploadCancelled =
    payload.manualUploadCancelled === true ||
    (prev.manualUploadCancelled === true &&
      isSettledUploadState &&
      nextManualPending === 0);
  const isManualFinalFileSettlingToIdle =
    !isManualUploadCancelled &&
    isSettledUploadState &&
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
    : isManualUploadCancelled
      ? 0
      : nextCompletedCount;
  const effectiveTotalCount = isManualFinalFileSettlingToIdle
    ? prev.totalCount
    : isManualUploadCancelled
      ? 0
      : nextTotalCount;
  const effectiveCompletedBytes = isManualFinalFileSettlingToIdle
    ? prev.completedCount >= prev.totalCount
      ? Math.max(prev.totalBytes, prev.completedBytes)
      : Math.max(
          prev.totalBytes,
          prev.completedBytes + prev.currentFileConfirmedBytes,
        )
    : isManualUploadCancelled
      ? 0
      : ((payload.completedBytes as number | undefined) ?? prev.completedBytes);
  const effectiveTotalBytes = isManualFinalFileSettlingToIdle
    ? Math.max(prev.totalBytes, effectiveCompletedBytes)
    : isManualUploadCancelled
      ? 0
      : ((payload.totalBytes as number | undefined) ??
        (payload.queueTotalBytes as number | undefined) ??
        prev.totalBytes);
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
  const inferredCompletedTaskSource =
    nextCurrentTaskSource ??
    payloadLastCompletedTaskSource ??
    prev.currentTaskSource ??
    (nextAutoUploadState === 'active'
      ? ('auto' as UploadTaskSource)
      : undefined) ??
    prev.lastCompletedTaskSource ??
    ((prev.autoUploadState === 'active'
      ? 'auto'
      : 'manual') as UploadTaskSource);
  const derivedLastCompletedTaskSource = isManualUploadCancelled
    ? undefined
    : hasLastCompletedTaskSource
      ? payloadLastCompletedTaskSource
      : uploadState === 'completed'
        ? inferredCompletedTaskSource
        : roundFinishedWithoutCompletedPulse
          ? inferredCompletedTaskSource
          : prev.lastCompletedTaskSource;

  return {
    progressPercent: isManualUploadCancelled
      ? 0
      : ((payload.progressPercent as number | undefined) ??
        (currentFileTotalBytes > 0
          ? Math.round(
              (currentFileConfirmedBytes / currentFileTotalBytes) * 100,
            )
          : prev.progressPercent)),
    currentSpeedMbps:
      uploadState === 'reconnecting'
        ? 0
        : ((payload.currentSpeedMbps as number | undefined) ??
          prev.currentSpeedMbps),
    uploadState,
    completedCount: effectiveCompletedCount,
    totalCount: effectiveTotalCount,
    completedBytes: effectiveCompletedBytes,
    totalBytes: effectiveTotalBytes,
    roundBaselineCompletedCount:
      (payload.roundBaselineCompletedCount as number | undefined) ??
      prev.roundBaselineCompletedCount,
    roundBaselineCompletedBytes:
      (payload.roundBaselineCompletedBytes as number | undefined) ??
      prev.roundBaselineCompletedBytes,
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
    manualUploadCancelled: isManualUploadCancelled ? true : undefined,
    autoUploadState: nextAutoUploadState,
    manualPending: nextManualPending,
    autoPending: nextAutoPending,
    lastErrorCode: hasLastErrorCode ? payloadLastErrorCode : prev.lastErrorCode,
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
    gap: 8,
  },
  headerActionButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: DARK,
  },

  // Unified main card
  mainCard: {
    marginHorizontal: 16,
    marginBottom: 0,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.9)',
    shadowColor: '#3b82d2',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 4,
  },

  // Device row (top of card)
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f6fb',
  },
  deviceIconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#e8f4fc',
  },
  deviceInfo: {
    flex: 1,
    minWidth: 0,
  },
  deviceName: {
    fontSize: 15,
    fontWeight: '700',
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
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
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
    fontSize: 22,
    fontWeight: '700',
    color: DARK,
    lineHeight: 27,
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
    height: 8,
    borderRadius: 4,
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
    gap: 8,
    paddingVertical: 0,
    paddingHorizontal: 0,
    borderRadius: 0,
    backgroundColor: 'transparent',
    borderWidth: 0,
    marginBottom: 12,
  },
  statItem: {
    flex: 1,
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(240,248,255,0.8)',
    borderWidth: 1,
    borderColor: 'rgba(59,159,216,0.10)',
  },
  statDivider: {
    display: 'none',
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
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
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
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 16,
    alignItems: 'center',
  },
  emptyIconBox: {
    marginBottom: 14,
  },
  notStartedIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: EMPTY_INFO_BG,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  offlineIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: EMPTY_OFFLINE_BG,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  centeredTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: DARK,
    marginBottom: 6,
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
    paddingHorizontal: 16,
    marginTop: 12,
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
  quickEntryTarget: {
    flex: 1,
  },
  quickEntryCard: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(255,255,255,0.9)',
    shadowColor: '#3b82d2',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
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
  trialUpgradeEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 20,
    marginTop: 18,
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 18,
    backgroundColor: 'rgba(255, 251, 235, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(217, 119, 6, 0.28)',
  },
  trialUpgradeIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(217, 119, 6, 0.1)',
  },
  trialUpgradeText: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
    color: '#92400e',
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
    backgroundColor: colors.card,
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
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
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
  queueSection: {
    paddingHorizontal: 20,
    marginTop: 20,
  },
  queueList: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    marginTop: 8,
  },
  queueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
  },
  queueRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  queueRowUploading: {
    backgroundColor: 'rgba(59, 159, 216, 0.05)',
    marginHorizontal: -16,
    paddingHorizontal: 16,
  },
  queueIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.secondary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  queueInfo: {
    flex: 1,
    minWidth: 0,
  },
  queueFileName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  queueFileMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  queueFileSize: {
    fontSize: 12,
    color: colors.mutedForeground,
  },
  uploadingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(59, 159, 216, 0.1)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  uploadingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
  uploadingLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.accent,
  },
  cloudAssetBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  cloudAssetLabel: {
    fontSize: 11,
    color: colors.accent,
  },
  itemProgressGroup: {
    marginTop: 8,
  },
  itemProgressTrack: {
    height: 4,
    backgroundColor: colors.background,
    borderRadius: 2,
    overflow: 'hidden',
  },
  itemProgressFill: {
    height: '100%',
    backgroundColor: colors.accent,
    borderRadius: 2,
  },
});
