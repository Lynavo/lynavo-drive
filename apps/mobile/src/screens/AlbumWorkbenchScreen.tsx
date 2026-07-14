import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  Alert,
  Animated,
  ActivityIndicator,
  AppState,
  Dimensions,
  NativeModules,
  NativeEventEmitter,
  Modal,
  Platform,
  type AppStateStatus,
  type ImageSourcePropType,
  type ListRenderItemInfo,
} from 'react-native';

const IC_ALBUM_PICKER: ImageSourcePropType = require('../assets/icons/album-picker.png');
const IC_SWITCH_GRID: ImageSourcePropType = require('../assets/icons/switch-grid.png');
const IC_SWITCH_LIST: ImageSourcePropType = require('../assets/icons/switch-list.png');
const IC_AUTO_UPLOAD: ImageSourcePropType = require('../assets/icons/auto-upload.png');
const IC_ARROW_DOWN: ImageSourcePropType = require('../assets/icons/arrow-down.png');
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type {
  AlbumAssetDTO,
  AutoUploadConfigDTO,
} from '@lynavo-drive/contracts';
import { AssetPreviewModal } from '../components/AssetPreviewModal';
import { Icon } from '../components/Icon';
import {
  browseAlbum,
  getAlbumStats,
  getAlbumCollections,
  requestPhotoPermission,
  getAutoUploadConfig,
  saveAutoUploadConfig,
  disableAutoUpload,
  enableAutoUpload,
  getPhotoAuthorizationStatus,
  presentLimitedPhotoPicker,
  type AlbumStats,
  type AlbumCollectionInfo,
} from '../services/SyncEngineModule';
import { formatBytes } from '../utils/format';
import { sortAlbumAssetsForDisplay } from '../utils/sortAlbumAssets';
import { deriveDeviceConnected } from '../utils/deriveDeviceConnected';
import {
  buildAutoUploadRoundOverview,
  getAutoUploadRoundCompletedCount,
  getAutoUploadSessionTransferredCount,
  getRememberedAutoUploadRoundProgress,
  rememberAutoUploadRoundProgress,
  type AutoUploadRoundOverview,
} from '../utils/autoUploadRoundProgress';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCREEN_WIDTH = Dimensions.get('window').width;
const GRID_COLUMNS = 3;
const GRID_GAP = 2;
const CONTENT_PADDING = 16;
const GRID_ITEM_SIZE =
  (SCREEN_WIDTH - CONTENT_PADDING * 2 - GRID_GAP * (GRID_COLUMNS - 1)) /
  GRID_COLUMNS;
const PAGE_SIZE = 60;

const BLUE = '#3b9fd8';
const DARK = '#1a3a5c';
const SCREEN_BG = '#d6ecf8';

function formatCustomTime(iso: string, t: TFunction): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hour = String(d.getHours()).padStart(2, '0');
  const minute = String(d.getMinutes()).padStart(2, '0');
  return t('albumWorkbench.dates.full', {
    year,
    month,
    day,
    hour,
    minute,
  });
}

function rememberAndBuildAutoUploadRoundOverview(
  payload: unknown,
  previous: AutoUploadRoundOverview | null,
): AutoUploadRoundOverview | null {
  const overview = buildAutoUploadRoundOverview(
    (payload as Record<string, unknown> | null | undefined) ?? null,
    previous,
  );
  rememberAutoUploadRoundProgress(overview);
  return overview;
}

type MediaFilter = 'all' | 'photos' | 'videos';
type TransferFilter = 'all' | 'untransferred' | 'transferred';
type ViewMode = 'grid' | 'list';

type UnifiedFilter =
  | 'all'
  | 'photos'
  | 'videos'
  | 'untransferred'
  | 'transferred';
const UNIFIED_FILTER_TABS = [
  { key: 'all', labelKey: 'albumWorkbench.tabs.all' },
  { key: 'photos', labelKey: 'albumWorkbench.tabs.photos' },
  { key: 'videos', labelKey: 'albumWorkbench.tabs.videos' },
  { key: 'untransferred', labelKey: 'albumWorkbench.tabs.untransferred' },
  { key: 'transferred', labelKey: 'albumWorkbench.tabs.transferred' },
] as const;

const TIME_RANGE_OPTIONS = [
  { key: 'all', labelKey: 'albumWorkbench.timeFilters.all' },
  { key: 'from_now', labelKey: 'albumWorkbench.timeFilters.fromNow' },
  { key: 'custom', labelKey: 'albumWorkbench.timeFilters.custom' },
] as const satisfies ReadonlyArray<{
  key: AutoUploadConfigDTO['timeRangeMode'];
  labelKey: string;
}>;

function getEmptyStateCopy(
  filter: UnifiedFilter,
  t: TFunction,
): {
  title: string;
  subtitle: string;
} {
  switch (filter) {
    case 'transferred':
      return {
        title: t('albumWorkbench.emptyStates.transferredEmpty.title'),
        subtitle: t('albumWorkbench.emptyStates.transferredEmpty.subtitle'),
      };
    case 'untransferred':
      return {
        title: t('albumWorkbench.emptyStates.untransferredEmpty.title'),
        subtitle: t('albumWorkbench.emptyStates.untransferredEmpty.subtitle'),
      };
    case 'photos':
      return {
        title: t('albumWorkbench.emptyStates.photosEmpty.title'),
        subtitle: t('albumWorkbench.emptyStates.photosEmpty.subtitle'),
      };
    case 'videos':
      return {
        title: t('albumWorkbench.emptyStates.videosEmpty.title'),
        subtitle: t('albumWorkbench.emptyStates.videosEmpty.subtitle'),
      };
    default:
      return {
        title: t('albumWorkbench.emptyStates.genericEmpty.title'),
        subtitle: t('albumWorkbench.emptyStates.genericEmpty.subtitle'),
      };
  }
}

// ---------------------------------------------------------------------------
// AlbumWorkbenchScreen
// ---------------------------------------------------------------------------

export function AlbumWorkbenchScreen() {
  const navigation = useNavigation();
  const { t, i18n } = useTranslation();
  const activeLocale = i18n.resolvedLanguage ?? i18n.language;

  // View state
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all');
  const [transferFilter, setTransferFilter] = useState<TransferFilter>('all');

  // Data
  const [assets, setAssets] = useState<AlbumAssetDTO[]>([]);
  const [stats, setStats] = useState<AlbumStats | null>(null);
  const [autoUploadTransferredBaseline, setAutoUploadTransferredBaselineState] =
    useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const offsetRef = useRef(0);
  const hasLoadedInitialAssetsRef = useRef(false);
  const assetListRequestRef = useRef(0);
  const autoUploadTransferredBaselineRef = useRef<number | null>(null);

  // Preview modal
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);

  // Auto-upload config
  const [autoUploadConfig, setAutoUploadConfig] =
    useState<AutoUploadConfigDTO | null>(null);
  const [configExpanded, setConfigExpanded] = useState(false);
  const [autoUploadRoundOverview, setAutoUploadRoundOverview] =
    useState<AutoUploadRoundOverview | null>(
      getRememberedAutoUploadRoundProgress,
    );
  const [
    autoUploadSessionTransferredCount,
    setAutoUploadSessionTransferredCount,
  ] = useState<number | null>(null);

  // Custom time picker
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [pendingDate, setPendingDate] = useState<Date>(new Date());

  // Album collection filter (sub-album)
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [collectionTitle, setCollectionTitle] = useState<string | null>(null);
  const [collections, setCollections] = useState<AlbumCollectionInfo[]>([]);
  const [collectionSheetVisible, setCollectionSheetVisible] = useState(false);
  const [collectionsLoading, setCollectionsLoading] = useState(false);

  // Device connection state — used to disable upload button when offline
  const [deviceConnected, setDeviceConnected] = useState(false);

  // Photo library authorization status — tracks limited access state
  const [photoAuthStatus, setPhotoAuthStatus] = useState<string>('unknown');
  const isAutoUploadActive = autoUploadConfig?.state === 'active';
  const photoLibraryAccessRequestRef = useRef<Promise<boolean> | null>(null);

  const ensurePhotoLibraryAccess = useCallback(async (): Promise<boolean> => {
    try {
      const currentStatus = await getPhotoAuthorizationStatus();
      if (currentStatus === 'authorized' || currentStatus === 'limited') {
        setPhotoAuthStatus(currentStatus);
        return true;
      }

      if (Platform.OS !== 'android') {
        setPhotoAuthStatus(currentStatus);
        return false;
      }

      if (photoLibraryAccessRequestRef.current) {
        return photoLibraryAccessRequestRef.current;
      }

      const request = requestPhotoPermission()
        .then(requestedStatus => {
          setPhotoAuthStatus(requestedStatus);
          return (
            requestedStatus === 'authorized' || requestedStatus === 'limited'
          );
        })
        .finally(() => {
          photoLibraryAccessRequestRef.current = null;
        });
      photoLibraryAccessRequestRef.current = request;
      return request;
    } catch (e) {
      console.warn('[AlbumWorkbench] ensurePhotoLibraryAccess error:', e);
      return false;
    }
  }, []);

  // Radar pulse animation for auto-upload active icon
  const radarAnims = useRef(
    Array.from({ length: 3 }, () => new Animated.Value(0)),
  ).current;

  useEffect(() => {
    if (autoUploadConfig?.state !== 'active') {
      radarAnims.forEach(a => a.setValue(0));
      return;
    }
    const animations = radarAnims.map((anim, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 600),
          Animated.timing(anim, {
            toValue: 1,
            duration: 1800,
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      ),
    );
    animations.forEach(a => a.start());
    return () => animations.forEach(a => a.stop());
  }, [autoUploadConfig?.state, radarAnims]);

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  const setAutoUploadTransferredBaseline = useCallback(
    (baseline: number | null) => {
      autoUploadTransferredBaselineRef.current = baseline;
      setAutoUploadTransferredBaselineState(baseline);
    },
    [],
  );

  const loadAssets = useCallback(
    async (
      nextMediaFilter: MediaFilter,
      nextTransferFilter: TransferFilter,
      reset: boolean,
      colId?: string | null,
    ) => {
      const requestId = assetListRequestRef.current + 1;
      assetListRequestRef.current = requestId;
      try {
        const offset = reset ? 0 : offsetRef.current;
        if (reset && !hasLoadedInitialAssetsRef.current) {
          // Only show full-screen spinner on the first screen load.
          // Filter switches should keep the current layout visible.
          setLoading(true);
        } else if (!reset) {
          setLoadingMore(true);
        }

        if (Platform.OS === 'android') {
          const canReadLibrary = await ensurePhotoLibraryAccess();
          if (!canReadLibrary) {
            if (reset) {
              setAssets([]);
              offsetRef.current = 0;
            }
            setHasMore(false);
            return;
          }
        }

        const result = await browseAlbum(
          nextMediaFilter,
          nextTransferFilter,
          offset,
          PAGE_SIZE,
          colId ?? undefined,
        );
        if (requestId !== assetListRequestRef.current) {
          return;
        }
        if (reset) {
          setAssets(sortAlbumAssetsForDisplay(result));
          offsetRef.current = result.length;
        } else {
          setAssets(prev => sortAlbumAssetsForDisplay([...prev, ...result]));
          offsetRef.current += result.length;
        }
        setHasMore(result.length >= PAGE_SIZE);
      } catch (e) {
        console.warn('[AlbumWorkbench] loadAssets error:', e);
        if (reset && requestId === assetListRequestRef.current) {
          setAssets([]);
        }
      } finally {
        if (requestId === assetListRequestRef.current) {
          hasLoadedInitialAssetsRef.current = true;
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [ensurePhotoLibraryAccess],
  );

  const loadAutoUploadSessionProgress = useCallback(
    async (active = isAutoUploadActive, transferredCount?: number) => {
      try {
        const count = await getAutoUploadSessionTransferredCount(
          active,
          transferredCount,
        );
        setAutoUploadSessionTransferredCount(count);
      } catch (e) {
        console.warn(
          '[AlbumWorkbench] loadAutoUploadSessionProgress error:',
          e,
        );
      }
    },
    [isAutoUploadActive],
  );

  const loadStats = useCallback(
    async (active = isAutoUploadActive) => {
      try {
        if (Platform.OS === 'android') {
          const canReadLibrary = await ensurePhotoLibraryAccess();
          if (!canReadLibrary) {
            setStats({
              totalCount: 0,
              transferredCount: 0,
              queuedCount: 0,
              pendingCount: 0,
            });
            void loadAutoUploadSessionProgress(active, 0);
            return;
          }
        }
        const result = await getAlbumStats();
        setStats(result);
        void loadAutoUploadSessionProgress(active, result.transferredCount);
      } catch (e) {
        console.warn('[AlbumWorkbench] loadStats error:', e);
      }
    },
    [
      ensurePhotoLibraryAccess,
      isAutoUploadActive,
      loadAutoUploadSessionProgress,
    ],
  );

  const primeAutoUploadRoundBaseline = useCallback(async () => {
    let baseline = stats?.transferredCount ?? 0;
    try {
      const latestStats = await getAlbumStats();
      setStats(latestStats);
      baseline = latestStats.transferredCount;
    } catch (e) {
      console.warn('[AlbumWorkbench] primeAutoUploadRoundBaseline error:', e);
    }
    setAutoUploadTransferredBaseline(baseline);
  }, [setAutoUploadTransferredBaseline, stats?.transferredCount]);

  const loadConfig = useCallback(async () => {
    try {
      const config = await getAutoUploadConfig();
      setAutoUploadConfig(config);
      void loadAutoUploadSessionProgress(config.state === 'active');
      // Auto-expand config panel when auto-upload is enabled/paused
      if (config.enabled) {
        setConfigExpanded(true);
      }
    } catch (e) {
      console.warn('[AlbumWorkbench] loadConfig error:', e);
    }
  }, [loadAutoUploadSessionProgress]);

  const loadSyncOverview = useCallback(async () => {
    try {
      const payload = await NativeModules.NativeSyncEngine?.getSyncOverview?.();
      setAutoUploadRoundOverview(prev =>
        rememberAndBuildAutoUploadRoundOverview(payload, prev),
      );
    } catch (e) {
      console.warn('[AlbumWorkbench] loadSyncOverview error:', e);
    }
  }, []);

  useEffect(() => {
    void loadAssets(mediaFilter, transferFilter, true, collectionId);
    void loadStats();
    void loadConfig();
    void loadSyncOverview();
    // Seed initial connection and photo auth state
    void (async () => {
      try {
        const binding = await NativeModules.NativeSyncEngine?.getBindingState();
        const conn = (binding?.connectionState as string) || '';
        setDeviceConnected(prev => deriveDeviceConnected(conn, prev));
      } catch {
        setDeviceConnected(false);
      }
    })();
    void (async () => {
      try {
        const status = await getPhotoAuthorizationStatus();
        setPhotoAuthStatus(status);
      } catch {
        /* best effort */
      }
    })();
  }, [
    mediaFilter,
    transferFilter,
    collectionId,
    loadAssets,
    loadStats,
    loadConfig,
    loadSyncOverview,
  ]);

  const statsTransferredCount = stats?.transferredCount;

  useEffect(() => {
    if (autoUploadConfig?.state !== 'active') {
      if (autoUploadTransferredBaselineRef.current !== null) {
        setAutoUploadTransferredBaseline(null);
      }
      return;
    }

    if (
      typeof statsTransferredCount === 'number' &&
      autoUploadTransferredBaselineRef.current === null
    ) {
      setAutoUploadTransferredBaseline(statsTransferredCount);
    }
  }, [
    autoUploadConfig?.state,
    setAutoUploadTransferredBaseline,
    statsTransferredCount,
  ]);

  // Refresh all currently visible assets (re-fetch from 0 to current offset)
  // without changing scroll position or loading more pages.
  const refreshVisibleAssets = useCallback(async () => {
    try {
      const currentCount = offsetRef.current;
      if (currentCount <= 0) return;
      const requestId = assetListRequestRef.current + 1;
      assetListRequestRef.current = requestId;
      const result = await browseAlbum(
        mediaFilter,
        transferFilter,
        0,
        currentCount,
        collectionId ?? undefined,
      );
      if (requestId !== assetListRequestRef.current) {
        return;
      }
      setAssets(sortAlbumAssetsForDisplay(result));
    } catch (e) {
      console.warn('[AlbumWorkbench] refreshVisibleAssets error:', e);
    }
  }, [mediaFilter, transferFilter, collectionId]);

  // Subscribe to native events to refresh transferred/queued status in real time
  useEffect(() => {
    const emitter = new NativeEventEmitter(NativeModules.NativeSyncEngine);
    const queueSub = emitter.addListener('onQueueUpdated', () => {
      void refreshVisibleAssets();
      void loadStats();
    });
    const stateSub = emitter.addListener('onSyncStateChanged', payload => {
      setAutoUploadRoundOverview(prev =>
        rememberAndBuildAutoUploadRoundOverview(payload, prev),
      );
      void loadStats();
    });
    const bindingSub = emitter.addListener(
      'onBindingStateChanged',
      (state: Record<string, unknown> | null) => {
        const conn = (state?.connectionState as string) || '';
        setDeviceConnected(prev => deriveDeviceConnected(conn, prev));
      },
    );
    // Reload when photo library changes (e.g. user adds photos via
    // limited picker or takes new photos while permission is limited)
    const photoLibSub = emitter.addListener('onPhotoLibraryChanged', () => {
      void loadAssets(mediaFilter, transferFilter, true, collectionId);
      void loadStats();
      void loadSyncOverview();
      void getPhotoAuthorizationStatus()
        .then(setPhotoAuthStatus)
        .catch(() => {});
    });
    return () => {
      queueSub.remove();
      stateSub.remove();
      bindingSub.remove();
      photoLibSub.remove();
    };
  }, [
    mediaFilter,
    transferFilter,
    collectionId,
    loadAssets,
    refreshVisibleAssets,
    loadStats,
    loadSyncOverview,
  ]);

  // Re-fetch when returning from background / permission dialog.
  // On first install, PHAsset.fetchAssets() triggers the iOS permission
  // prompt but returns empty synchronously. When the user grants access
  // and the app goes back to active, we need to reload.
  const appStateRef = useRef(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (
        appStateRef.current.match(/inactive|background/) &&
        next === 'active'
      ) {
        void loadAssets(mediaFilter, transferFilter, true, collectionId);
        void loadStats();
        void loadSyncOverview();
        // Re-check auth status — may have changed from notDetermined to
        // limited/authorized while the permission dialog was showing.
        void getPhotoAuthorizationStatus()
          .then(setPhotoAuthStatus)
          .catch(() => {});
      }
      appStateRef.current = next;
    });
    return () => sub.remove();
  }, [
    loadAssets,
    mediaFilter,
    transferFilter,
    collectionId,
    loadStats,
    loadSyncOverview,
  ]);

  const handleOpenPreview = useCallback(
    (assetLocalId: string) => {
      const idx = assets.findIndex(a => a.assetLocalId === assetLocalId);
      if (idx < 0) return;
      setPreviewIndex(idx);
      setPreviewVisible(true);
    },
    [assets],
  );

  const handleGridItemPress = useCallback(
    (assetLocalId: string) => {
      handleOpenPreview(assetLocalId);
    },
    [handleOpenPreview],
  );

  // Unified filter: derives both mediaFilter and transferFilter from a single tab
  const [unifiedFilter, setUnifiedFilter] = useState<UnifiedFilter>('all');

  const handleUnifiedFilterPress = useCallback((key: UnifiedFilter) => {
    setUnifiedFilter(key);
    switch (key) {
      case 'all':
        setMediaFilter('all');
        setTransferFilter('all');
        break;
      case 'photos':
        setMediaFilter('photos');
        setTransferFilter('all');
        break;
      case 'videos':
        setMediaFilter('videos');
        setTransferFilter('all');
        break;
      case 'untransferred':
        setMediaFilter('all');
        setTransferFilter('untransferred');
        break;
      case 'transferred':
        setMediaFilter('all');
        setTransferFilter('transferred');
        break;
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Auto-upload config handlers
  // ---------------------------------------------------------------------------

  const handleToggleAutoUpload = useCallback(async () => {
    if (!autoUploadConfig) return;
    try {
      if (autoUploadConfig.state === 'active') {
        // active → disabled: show confirmation dialog per PRD
        Alert.alert(
          t('albumWorkbench.dialogs.closeAuto.title'),
          t('albumWorkbench.dialogs.closeAuto.body'),
          [
            {
              text: t('albumWorkbench.dialogs.closeAuto.keepUploading'),
              style: 'cancel',
            },
            {
              text: t('albumWorkbench.dialogs.closeAuto.confirm'),
              style: 'destructive',
              onPress: async () => {
                try {
                  await disableAutoUpload();
                  await loadConfig();
                } catch (e) {
                  console.warn('[AlbumWorkbench] disableAutoUpload error:', e);
                  Alert.alert(
                    t('albumWorkbench.dialogs.closeAutoFailed.title'),
                    t('albumWorkbench.dialogs.closeAutoFailed.body'),
                  );
                }
              },
            },
          ],
        );
        return;
      } else {
        // interrupted or disabled → active: check mutual exclusion first
        // For disabled state, also validate connection and config
        if (autoUploadConfig.state === 'disabled') {
          try {
            const binding =
              await NativeModules.NativeSyncEngine?.getBindingState();
            if (
              !binding?.deviceId ||
              (binding.connectionState !== 'connected' &&
                binding.connectionState !== 'bound')
            ) {
              Alert.alert(
                t('albumWorkbench.dialogs.cannotEnable.title'),
                t('albumWorkbench.dialogs.cannotEnable.notConnected'),
              );
              return;
            }
          } catch {
            Alert.alert(
              t('albumWorkbench.dialogs.cannotEnable.title'),
              t('albumWorkbench.dialogs.cannotEnable.notConnected'),
            );
            return;
          }
          if (
            autoUploadConfig.timeRangeMode === 'custom' &&
            !autoUploadConfig.customTimeFrom
          ) {
            Alert.alert(
              t('albumWorkbench.dialogs.configIncomplete.title'),
              t('albumWorkbench.dialogs.configIncomplete.body'),
            );
            return;
          }
        }

        await primeAutoUploadRoundBaseline();
        await enableAutoUpload();
      }
      await loadConfig();
    } catch (e) {
      console.warn('[AlbumWorkbench] toggleAutoUpload error:', e);
      Alert.alert(
        t('albumWorkbench.dialogs.toggleAutoFailed.title'),
        t('albumWorkbench.dialogs.toggleAutoFailed.body'),
      );
    }
  }, [autoUploadConfig, loadConfig, primeAutoUploadRoundBaseline, t]);

  const handleConfigChange = useCallback(
    async (
      key: 'timeRangeMode' | 'enabled' | 'customTimeFrom',
      value: string | boolean,
    ) => {
      if (!autoUploadConfig) return;

      // Baseline is locked while auto is active — changing scope mid-flight would
      // expand/contract an in-flight job and leave the pending queue inconsistent.
      if (
        autoUploadConfig.state === 'active' &&
        (key === 'timeRangeMode' || key === 'customTimeFrom')
      ) {
        return;
      }

      // When switching to custom mode with no time set, update UI only (don't save)
      if (
        key === 'timeRangeMode' &&
        value === 'custom' &&
        !autoUploadConfig.customTimeFrom
      ) {
        setAutoUploadConfig(prev =>
          prev ? { ...prev, timeRangeMode: 'custom' } : prev,
        );
        return;
      }

      // Empty customTimeFrom should not be saved
      if (key === 'customTimeFrom' && (value === '' || !value)) {
        Alert.alert(
          t('albumWorkbench.dialogs.configIncomplete.title'),
          t('albumWorkbench.dialogs.configIncomplete.body'),
        );
        return;
      }

      try {
        const updated = { ...autoUploadConfig, [key]: value };
        await saveAutoUploadConfig(updated);
        await loadConfig();
      } catch (e) {
        console.warn('[AlbumWorkbench] saveConfig error:', e);
        Alert.alert(
          t('albumWorkbench.dialogs.saveConfigFailed.title'),
          t('albumWorkbench.dialogs.saveConfigFailed.body'),
        );
      }
    },
    [autoUploadConfig, loadConfig, t],
  );

  // ---------------------------------------------------------------------------
  // Load more
  // ---------------------------------------------------------------------------

  const handleEndReached = useCallback(() => {
    if (!loadingMore && hasMore && !loading) {
      void loadAssets(mediaFilter, transferFilter, false, collectionId);
    }
  }, [
    loadingMore,
    hasMore,
    loading,
    loadAssets,
    mediaFilter,
    transferFilter,
    collectionId,
  ]);

  // ---------------------------------------------------------------------------
  // Collection filter handlers (sub-album picker)
  // ---------------------------------------------------------------------------

  const handleOpenCollectionSheet = useCallback(async () => {
    setCollectionSheetVisible(true);
    setCollectionsLoading(true);
    try {
      const result = await getAlbumCollections(mediaFilter);
      setCollections(result);
    } catch (e) {
      console.warn('[AlbumWorkbench] getAlbumCollections error:', e);
    } finally {
      setCollectionsLoading(false);
    }
  }, [mediaFilter]);

  const handleSelectCollection = useCallback(
    (colId: string | null, title: string | null) => {
      setCollectionId(colId);
      setCollectionTitle(title);
      setCollectionSheetVisible(false);
    },
    [],
  );

  const collectionTotalCount = stats?.totalCount ?? 0;

  // ---------------------------------------------------------------------------
  // Date picker handlers (custom time range)
  // ---------------------------------------------------------------------------

  const handleDatePickerChange = useCallback(
    (_event: DateTimePickerEvent, date?: Date) => {
      if (date) {
        setPendingDate(date);
      }
    },
    [],
  );

  const handleDatePickerConfirm = useCallback(() => {
    setShowDatePicker(false);
    void handleConfigChange('customTimeFrom', pendingDate.toISOString());
  }, [pendingDate, handleConfigChange]);

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const renderGridItem = useCallback(
    ({ item }: ListRenderItemInfo<AlbumAssetDTO>) => {
      return (
        <View
          testID={`album-grid-item-${item.assetLocalId}`}
          style={styles.gridItem}
        >
          <TouchableOpacity
            style={styles.gridItemPressable}
            activeOpacity={0.7}
            onPress={() => handleGridItemPress(item.assetLocalId)}
          >
            <Image
              source={{ uri: item.thumbnailUri }}
              style={styles.gridThumbnail}
              resizeMode="cover"
            />
            {item.isTransferred && (
              <View style={styles.transferredOverlay}>
                <Icon name="checkmark-circle" size={24} color="#fff" />
              </View>
            )}
            {item.isQueued && !item.isTransferred && (
              <View style={styles.queuedBadge}>
                <Text style={styles.queuedBadgeText}>
                  {t('albumWorkbench.badges.queued')}
                </Text>
              </View>
            )}
            {item.mediaType === 'video' && (
              <View style={styles.videoIndicator}>
                <Icon name="play-circle-outline" size={16} color="#fff" />
              </View>
            )}
          </TouchableOpacity>
        </View>
      );
    },
    [handleGridItemPress, t],
  );

  const renderListItem = useCallback(
    ({ item }: ListRenderItemInfo<AlbumAssetDTO>) => {
      return (
        <TouchableOpacity
          style={styles.listRow}
          activeOpacity={0.7}
          onPress={() => handleOpenPreview(item.assetLocalId)}
        >
          <Image
            source={{ uri: item.thumbnailUri }}
            style={styles.listThumbnail}
            resizeMode="cover"
          />
          <View style={styles.listInfo}>
            <Text style={styles.listFileName} numberOfLines={1}>
              {item.filename}
            </Text>
            <View style={styles.listMeta}>
              <Text style={styles.listFileSize}>
                {formatBytes(item.fileSize)}
              </Text>
              <Text style={styles.listFileType}>
                {item.mediaType === 'video'
                  ? t('albumWorkbench.mediaTypes.video')
                  : t('albumWorkbench.mediaTypes.photo')}
              </Text>
              {item.isTransferred && (
                <View style={styles.listTransferredBadge}>
                  <Icon name="checkmark" size={10} color="#22c55e" />
                  <Text style={styles.listTransferredText}>
                    {t('albumWorkbench.badges.transferred')}
                  </Text>
                </View>
              )}
              {item.isQueued && !item.isTransferred && (
                <Text style={styles.listQueuedText}>
                  {t('albumWorkbench.badges.queued')}
                </Text>
              )}
            </View>
          </View>
        </TouchableOpacity>
      );
    },
    [handleOpenPreview, t],
  );

  const keyExtractor = useCallback(
    (item: AlbumAssetDTO) => item.assetLocalId,
    [],
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const autoUploadRoundCompletedCount = getAutoUploadRoundCompletedCount(
    autoUploadRoundOverview,
    isAutoUploadActive,
  );
  const resolvedAutoUploadTransferredCount =
    autoUploadSessionTransferredCount !== null &&
    autoUploadRoundCompletedCount !== null
      ? Math.max(
          autoUploadSessionTransferredCount,
          autoUploadRoundCompletedCount,
        )
      : (autoUploadSessionTransferredCount ?? autoUploadRoundCompletedCount);
  const autoUploadTransferredThisRound =
    resolvedAutoUploadTransferredCount ??
    (isAutoUploadActive && stats
      ? Math.max(
          0,
          stats.transferredCount -
            (autoUploadTransferredBaseline ?? stats.transferredCount),
        )
      : 0);

  // Derive custom time display string for summary card
  const timeRangeDisplayLabel = (() => {
    const fallback = t('albumWorkbench.timeFilters.all');
    if (!autoUploadConfig) return fallback;
    const match = TIME_RANGE_OPTIONS.find(
      o => o.key === autoUploadConfig.timeRangeMode,
    );
    return match ? t(match.labelKey) : fallback;
  })();
  const emptyStateCopy = getEmptyStateCopy(unifiedFilter, t);

  // FlatList header: config card + stats bar + filter tabs
  const renderListHeader = () => (
    <>
      {/* Auto-upload collapsible card */}
      {autoUploadConfig && (
        <View style={styles.configSection}>
          {/* Card header — always visible, tappable */}
          <TouchableOpacity
            style={styles.configHeader}
            activeOpacity={0.7}
            onPress={() => setConfigExpanded(prev => !prev)}
          >
            <View style={styles.configTitleRow}>
              <Image source={IC_AUTO_UPLOAD} style={styles.configTitleIcon} />
              <Text style={styles.configTitle}>
                {t('albumWorkbench.config.sectionTitle')}
              </Text>
              <View
                style={[
                  styles.configStateBadge,
                  isAutoUploadActive
                    ? styles.configStateActive
                    : styles.configStateDisabled,
                ]}
              >
                <Text
                  style={[
                    styles.configStateText,
                    isAutoUploadActive
                      ? styles.configStateTextActive
                      : styles.configStateTextDisabled,
                  ]}
                >
                  {isAutoUploadActive
                    ? t('albumWorkbench.config.stateOn')
                    : t('albumWorkbench.config.stateOff')}
                </Text>
              </View>
              {!deviceConnected && (
                <View style={styles.deviceOfflineBadge}>
                  <Text style={styles.deviceOfflineText}>
                    {t('albumWorkbench.deviceDisconnected')}
                  </Text>
                </View>
              )}
            </View>
            <Image
              source={IC_ARROW_DOWN}
              style={[
                styles.configArrowIcon,
                configExpanded && styles.configArrowIconExpanded,
              ]}
            />
          </TouchableOpacity>

          {/* Expanded body: toggle + time range */}
          {configExpanded && (
            <View style={styles.configBody}>
              {/* Enable/Disable toggle */}
              <TouchableOpacity
                style={[
                  styles.configRow,
                  !isAutoUploadActive &&
                    !deviceConnected &&
                    styles.configRowDisabled,
                ]}
                activeOpacity={0.7}
                onPress={handleToggleAutoUpload}
                disabled={!isAutoUploadActive && !deviceConnected}
              >
                <Text
                  style={[
                    styles.configLabel,
                    !isAutoUploadActive &&
                      !deviceConnected &&
                      styles.configLabelDisabled,
                  ]}
                >
                  {t('albumWorkbench.config.toggleLabel')}
                </Text>
                <View
                  style={[
                    styles.toggleTrack,
                    isAutoUploadActive && styles.toggleTrackOn,
                    !isAutoUploadActive &&
                      !deviceConnected &&
                      styles.toggleTrackDisabled,
                  ]}
                >
                  <View
                    style={[
                      styles.toggleThumb,
                      isAutoUploadActive && styles.toggleThumbOn,
                    ]}
                  />
                </View>
              </TouchableOpacity>

              {/* Time range */}
              <View style={styles.configGroup}>
                <Text style={styles.configGroupLabel}>
                  {t('albumWorkbench.config.timeRangeLabel')}
                </Text>
                <View
                  style={[
                    styles.configChips,
                    isAutoUploadActive && styles.configChipsDisabled,
                  ]}
                >
                  {TIME_RANGE_OPTIONS.map(opt => (
                    <TouchableOpacity
                      key={opt.key}
                      style={[
                        styles.configChip,
                        autoUploadConfig.timeRangeMode === opt.key &&
                          styles.configChipActive,
                      ]}
                      activeOpacity={0.7}
                      disabled={isAutoUploadActive}
                      onPress={() => {
                        void handleConfigChange('timeRangeMode', opt.key);
                      }}
                    >
                      <Text
                        style={[
                          styles.configChipText,
                          autoUploadConfig.timeRangeMode === opt.key &&
                            styles.configChipTextActive,
                        ]}
                      >
                        {t(opt.labelKey)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {/* Custom time display — shown when timeRangeMode is 'custom' */}
                {autoUploadConfig.timeRangeMode === 'custom' && (
                  <TouchableOpacity
                    style={[
                      styles.customTimeCard,
                      isAutoUploadActive && styles.customTimeCardDisabled,
                    ]}
                    activeOpacity={0.7}
                    disabled={isAutoUploadActive}
                    onPress={() => {
                      const initial = autoUploadConfig.customTimeFrom
                        ? new Date(autoUploadConfig.customTimeFrom)
                        : new Date();
                      setPendingDate(
                        isNaN(initial.getTime()) ? new Date() : initial,
                      );
                      setShowDatePicker(true);
                    }}
                  >
                    <Text style={styles.customTimeText}>
                      {autoUploadConfig.customTimeFrom
                        ? formatCustomTime(autoUploadConfig.customTimeFrom, t)
                        : t('albumWorkbench.actions.pickTime')}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}

          {/* Summary area — content depends on auto-upload state */}
          {isAutoUploadActive && stats && (
            <View style={styles.summaryCard}>
              <View style={styles.summaryHeaderRow}>
                <View style={styles.radarContainer}>
                  {radarAnims.map((anim, i) => (
                    <Animated.View
                      key={i}
                      style={[
                        styles.radarRing,
                        {
                          opacity: anim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0.5, 0],
                          }),
                          transform: [
                            {
                              scale: anim.interpolate({
                                inputRange: [0, 1],
                                outputRange: [1, 2.8],
                              }),
                            },
                          ],
                        },
                      ]}
                    />
                  ))}
                  <View style={styles.summaryDot} />
                </View>
                <Text style={styles.summaryTitle}>
                  {t('albumWorkbench.summary.title')}
                </Text>
              </View>
              <Text style={styles.summarySubtitle}>
                {t('albumWorkbench.summary.subtitle')}
              </Text>
              <View style={styles.summaryGrid}>
                <View style={styles.summaryGridItem}>
                  <Text style={styles.summaryGridLabel}>
                    {t('albumWorkbench.summary.transferredThisRound')}
                  </Text>
                  <Text style={styles.summaryGridValue}>
                    <Text style={styles.summaryGridNumber}>
                      {autoUploadTransferredThisRound}
                    </Text>{' '}
                    {t('albumWorkbench.summary.unitCount')}
                  </Text>
                </View>
                <View style={styles.summaryGridItem}>
                  <Text style={styles.summaryGridLabel}>
                    {t('albumWorkbench.summary.pending')}
                  </Text>
                  <Text style={styles.summaryGridValue}>
                    <Text style={styles.summaryGridNumberOrange}>
                      {stats.pendingCount}
                    </Text>{' '}
                    {t('albumWorkbench.summary.unitCount')}
                  </Text>
                </View>
                <View style={styles.summaryGridItem}>
                  <Text style={styles.summaryGridLabel}>
                    {t('albumWorkbench.summary.totalAssets')}
                  </Text>
                  <Text style={styles.summaryGridValue}>
                    <Text style={styles.summaryGridNumberDark}>
                      {stats.totalCount}
                    </Text>{' '}
                    {t('albumWorkbench.summary.unitCount')}
                  </Text>
                </View>
                <View style={styles.summaryGridItem}>
                  <Text style={styles.summaryGridLabel}>
                    {t('albumWorkbench.summary.timeRange')}
                  </Text>
                  <Text style={[styles.summaryGridValue, { color: BLUE }]}>
                    {timeRangeDisplayLabel}
                  </Text>
                </View>
              </View>
            </View>
          )}
        </View>
      )}

      {/* Stats bar — shown only when auto-upload is NOT active */}
      {!isAutoUploadActive && stats && (
        <View style={styles.statsBar}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{stats.totalCount}</Text>
            <Text style={styles.statLabel}>
              {t('albumWorkbench.stats.total')}
            </Text>
          </View>

          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={[styles.statValue, styles.statValueTransferred]}>
              {stats.transferredCount}
            </Text>
            <Text style={styles.statLabel}>
              {t('albumWorkbench.stats.transferred')}
            </Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={[styles.statValue, styles.statValueNew]}>
              {Math.max(
                0,
                stats.totalCount - stats.transferredCount - stats.queuedCount,
              )}
            </Text>
            <Text style={styles.statLabel}>
              {t('albumWorkbench.stats.new')}
            </Text>
          </View>
        </View>
      )}

      {/* Unified filter tabs + view toggle — shown only when auto-upload is NOT active */}
      {!isAutoUploadActive && (
        <View style={styles.filterBarWrap}>
          <View style={styles.filterBar}>
            {UNIFIED_FILTER_TABS.map(tab => (
              <TouchableOpacity
                key={tab.key}
                style={[
                  styles.filterTab,
                  unifiedFilter === tab.key && styles.filterTabActive,
                ]}
                activeOpacity={0.7}
                onPress={() => handleUnifiedFilterPress(tab.key)}
              >
                <Text
                  style={[
                    styles.filterTabText,
                    unifiedFilter === tab.key && styles.filterTabTextActive,
                  ]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.75}
                >
                  {t(tab.labelKey)}
                </Text>
              </TouchableOpacity>
            ))}
            <View style={styles.viewToggleGroup}>
              <TouchableOpacity
                style={[
                  styles.viewToggleBtn,
                  viewMode === 'grid' && styles.viewToggleBtnActive,
                ]}
                activeOpacity={0.7}
                onPress={() => setViewMode('grid')}
              >
                <Image
                  source={IC_SWITCH_GRID}
                  style={[
                    styles.viewToggleIcon,
                    viewMode === 'grid'
                      ? styles.viewToggleIconActive
                      : styles.viewToggleIconInactive,
                  ]}
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.viewToggleBtn,
                  viewMode === 'list' && styles.viewToggleBtnActive,
                ]}
                activeOpacity={0.7}
                onPress={() => setViewMode('list')}
              >
                <Image
                  source={IC_SWITCH_LIST}
                  style={[
                    styles.viewToggleIcon,
                    viewMode === 'list'
                      ? styles.viewToggleIconActive
                      : styles.viewToggleIconInactive,
                  ]}
                />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </>
  );

  const renderListEmptyComponent = () => {
    // Limited access with 0 authorized photos — guide the user to select
    if (photoAuthStatus === 'limited' && unifiedFilter === 'all') {
      return (
        <View style={styles.emptyContainer}>
          <Icon name="images-outline" size={48} color="#b0c8da" />
          <Text style={styles.emptyText}>
            {t('albumWorkbench.emptyStates.limitedAccess.title')}
          </Text>
          <Text style={styles.emptySubText}>
            {t('albumWorkbench.emptyStates.limitedAccess.subtitle')}
          </Text>
          <TouchableOpacity
            style={styles.limitedPickerButton}
            activeOpacity={0.7}
            onPress={() => {
              void presentLimitedPhotoPicker();
            }}
          >
            <Icon name="add-circle-outline" size={16} color="#fff" />
            <Text style={styles.limitedPickerButtonText}>
              {t('albumWorkbench.emptyStates.limitedAccess.selectPhotos')}
            </Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (isAutoUploadActive) {
      return null;
    }

    return (
      <View style={styles.emptyContainer}>
        <Icon name="image-outline" size={48} color="#b0c8da" />
        <Text style={styles.emptyText}>{emptyStateCopy.title}</Text>
        <Text style={styles.emptySubText}>{emptyStateCopy.subtitle}</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => {
            if (navigation.canGoBack()) {
              navigation.goBack();
            } else {
              navigation.reset({
                index: 0,
                routes: [{ name: 'SyncActivity' as never }],
              });
            }
          }}
        >
          <Icon name="chevron-back" size={22} color={DARK} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {collectionTitle ?? t('albumWorkbench.title')}
        </Text>
        <TouchableOpacity
          style={styles.headerFilterBtn}
          activeOpacity={0.7}
          onPress={() => {
            void handleOpenCollectionSheet();
          }}
        >
          <Image source={IC_ALBUM_PICKER} style={styles.headerFilterIcon} />
        </TouchableOpacity>
      </View>

      {/* Asset list */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={BLUE} />
          <Text style={styles.loadingText}>{t('albumWorkbench.loading')}</Text>
        </View>
      ) : viewMode === 'grid' ? (
        <FlatList
          key="grid"
          data={isAutoUploadActive ? [] : assets}
          renderItem={renderGridItem}
          keyExtractor={keyExtractor}
          numColumns={GRID_COLUMNS}
          contentContainerStyle={styles.gridContent}
          columnWrapperStyle={
            !isAutoUploadActive && assets.length > 0
              ? styles.gridRow
              : undefined
          }
          showsVerticalScrollIndicator={false}
          onEndReached={isAutoUploadActive ? undefined : handleEndReached}
          onEndReachedThreshold={0.5}
          ListHeaderComponent={renderListHeader()}
          ListEmptyComponent={renderListEmptyComponent()}
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator
                style={styles.loadMoreIndicator}
                size="small"
                color={BLUE}
              />
            ) : null
          }
        />
      ) : (
        <FlatList
          key="list"
          data={isAutoUploadActive ? [] : assets}
          renderItem={renderListItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onEndReached={isAutoUploadActive ? undefined : handleEndReached}
          onEndReachedThreshold={0.5}
          ListHeaderComponent={renderListHeader()}
          ListEmptyComponent={renderListEmptyComponent()}
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator
                style={styles.loadMoreIndicator}
                size="small"
                color={BLUE}
              />
            ) : null
          }
        />
      )}

      {/* Date/time picker modal for custom time range */}
      <Modal
        visible={showDatePicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowDatePicker(false)}
      >
        <View style={styles.datePickerOverlay}>
          <View style={styles.datePickerSheet}>
            <View style={styles.datePickerHeader}>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => setShowDatePicker(false)}
              >
                <Text style={styles.datePickerCancel}>
                  {t('albumWorkbench.datePicker.cancel')}
                </Text>
              </TouchableOpacity>
              <Text style={styles.datePickerTitle}>
                {t('albumWorkbench.datePicker.title')}
              </Text>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={handleDatePickerConfirm}
              >
                <Text style={styles.datePickerConfirm}>
                  {t('albumWorkbench.datePicker.confirm')}
                </Text>
              </TouchableOpacity>
            </View>
            <DateTimePicker
              value={pendingDate}
              mode="datetime"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={handleDatePickerChange}
              locale={Platform.OS === 'ios' ? activeLocale : undefined}
              style={styles.datePickerSpinner}
            />
          </View>
        </View>
      </Modal>
      {/* Album collection picker modal */}
      <Modal
        visible={collectionSheetVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCollectionSheetVisible(false)}
      >
        <TouchableOpacity
          style={styles.collectionOverlay}
          activeOpacity={1}
          onPress={() => setCollectionSheetVisible(false)}
        >
          <View
            style={styles.collectionSheet}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.collectionSheetHeader}>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => setCollectionSheetVisible(false)}
              >
                <Icon name="chevron-back" size={20} color={DARK} />
              </TouchableOpacity>
              <Text style={styles.collectionSheetTitle}>
                {t('albumWorkbench.collectionSheet.title')}
              </Text>
              <View style={styles.collectionSheetHeaderSpacer} />
            </View>

            {collectionsLoading ? (
              <ActivityIndicator
                style={styles.collectionLoadingIndicator}
                size="small"
                color={BLUE}
              />
            ) : (
              <FlatList
                data={collections}
                keyExtractor={item => item.collectionId}
                style={styles.collectionList}
                ListHeaderComponent={
                  <TouchableOpacity
                    style={styles.collectionRow}
                    activeOpacity={0.7}
                    onPress={() => handleSelectCollection(null, null)}
                  >
                    <Text style={styles.collectionName}>
                      {t('albumWorkbench.collectionSheet.allPhotos')}
                    </Text>
                    <View style={styles.collectionRowRight}>
                      <Text style={styles.collectionCount}>
                        {collectionTotalCount}
                      </Text>
                      {collectionId == null && (
                        <Icon name="checkmark" size={16} color={BLUE} />
                      )}
                    </View>
                  </TouchableOpacity>
                }
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.collectionRow}
                    activeOpacity={0.7}
                    onPress={() =>
                      handleSelectCollection(item.collectionId, item.title)
                    }
                  >
                    <Text style={styles.collectionName}>{item.title}</Text>
                    <View style={styles.collectionRowRight}>
                      <Text style={styles.collectionCount}>{item.count}</Text>
                      {collectionId === item.collectionId && (
                        <Icon name="checkmark" size={16} color={BLUE} />
                      )}
                    </View>
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        </TouchableOpacity>
      </Modal>
      <AssetPreviewModal
        visible={previewVisible}
        assets={assets}
        initialIndex={previewIndex}
        onClose={() => setPreviewVisible(false)}
      />
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
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: DARK,
    flex: 1,
    textAlign: 'center',
  },
  headerFilterBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerFilterIcon: {
    width: 20,
    height: 20,
    tintColor: DARK,
  },
  headerFilterDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: BLUE,
  },

  // Auto-upload config
  configSection: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
    overflow: 'hidden',
  },
  configHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  configTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  configTitleIcon: {
    width: 16,
    height: 16,
  },
  radarContainer: {
    width: 10,
    height: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radarRing: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#22c55e',
  },
  configArrowIcon: {
    width: 14,
    height: 8,
    resizeMode: 'contain',
    tintColor: '#8aabbd',
  },
  configArrowIconExpanded: {
    transform: [{ rotate: '180deg' }],
  },
  configTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: DARK,
  },
  configStateBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  configStateActive: {
    backgroundColor: 'rgba(34,197,94,0.12)',
  },
  configStateInterrupted: {
    backgroundColor: 'rgba(245,158,11,0.12)',
  },
  configStateDisabled: {
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  configStateText: {
    fontSize: 11,
    fontWeight: '600',
  },
  configStateTextActive: {
    color: '#16a34a',
  },
  configStateTextInterrupted: {
    color: '#d97706',
  },
  configStateTextDisabled: {
    color: '#94a3b8',
  },
  configBody: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.04)',
  },
  configRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
  },
  configRowDisabled: {
    opacity: 0.4,
  },
  configLabel: {
    fontSize: 14,
    color: DARK,
  },
  configLabelDisabled: {
    color: '#9ca3af',
  },
  toggleTrack: {
    width: 44,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#d1d5db',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  toggleTrackOn: {
    backgroundColor: '#22c55e',
  },
  toggleTrackDisabled: {
    backgroundColor: '#e5e7eb',
  },
  toggleThumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#fff',
  },
  toggleThumbOn: {
    alignSelf: 'flex-end',
  },
  configGroup: {
    gap: 6,
  },
  configGroupLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: '#6a96b8',
  },
  configChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  configChipsDisabled: {
    opacity: 0.5,
  },
  configChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  configChipActive: {
    backgroundColor: 'rgba(59,159,216,0.12)',
    borderColor: 'rgba(59,159,216,0.3)',
  },
  configChipText: {
    fontSize: 12,
    color: '#6a96b8',
  },
  configChipTextActive: {
    color: BLUE,
    fontWeight: '600',
  },
  customTimeCard: {
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
  },
  customTimeCardDisabled: {
    opacity: 0.5,
  },
  customTimeText: {
    fontSize: 13,
    color: DARK,
    fontVariant: ['tabular-nums'],
  },

  // Summary card (shown when auto-upload is active)
  summaryCard: {
    marginHorizontal: 14,
    marginBottom: 14,
    padding: 16,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.04)',
  },
  summaryHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  summaryDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#22c55e',
  },
  summaryTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: DARK,
  },
  summarySubtitle: {
    fontSize: 12,
    color: '#8aabbd',
    marginBottom: 16,
    marginLeft: 18,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  summaryGridItem: {
    width: '50%',
    paddingVertical: 8,
  },
  summaryGridLabel: {
    fontSize: 11,
    color: '#8aabbd',
    marginBottom: 4,
  },
  summaryGridValue: {
    fontSize: 13,
    fontWeight: '600',
    color: DARK,
  },
  summaryGridNumber: {
    fontSize: 18,
    fontWeight: '700',
    color: '#16a34a',
  },
  summaryGridNumberOrange: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f59e0b',
  },
  summaryGridNumberDark: {
    fontSize: 18,
    fontWeight: '700',
    color: DARK,
  },

  // Unified filter tabs
  filterBarWrap: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
  },
  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 4,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.84)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.92)',
    gap: 4,
  },
  filterTab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterTabActive: {
    backgroundColor: DARK,
  },
  filterTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#7d9cb5',
  },
  filterTabTextActive: {
    color: '#fff',
  },

  // Stats bar
  statsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.75)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 16,
    fontWeight: '700',
    color: DARK,
  },
  statValueTransferred: {
    color: '#22c55e',
  },
  statValueNew: {
    color: '#f59e0b',
  },
  statLabel: {
    fontSize: 10,
    color: '#8aabbd',
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(0,0,0,0.06)',
  },

  // Grid view
  gridContent: {
    paddingHorizontal: CONTENT_PADDING,
    paddingBottom: 80,
  },
  gridRow: {
    gap: GRID_GAP,
    marginBottom: GRID_GAP,
  },
  gridItem: {
    width: GRID_ITEM_SIZE,
    height: GRID_ITEM_SIZE,
    borderRadius: 4,
    overflow: 'hidden',
  },
  gridItemPressable: {
    width: '100%',
    height: '100%',
  },
  gridThumbnail: {
    width: '100%',
    height: '100%',
  },
  transferredOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  queuedBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    backgroundColor: 'rgba(59,159,216,0.85)',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  queuedBadgeText: {
    fontSize: 9,
    fontWeight: '600',
    color: '#fff',
  },
  videoIndicator: {
    position: 'absolute',
    bottom: 4,
    right: 4,
  },
  selectionCircle: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#fff',
    backgroundColor: 'rgba(0,0,0,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectionCircleActive: {
    backgroundColor: BLUE,
    borderColor: BLUE,
  },

  // List view
  listContent: {
    paddingHorizontal: CONTENT_PADDING,
    paddingBottom: 80,
    gap: 2,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.75)',
    borderRadius: 12,
    padding: 8,
    gap: 10,
  },
  listRowSelected: {
    backgroundColor: 'rgba(59,159,216,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(59,159,216,0.2)',
  },
  listThumbnail: {
    width: 52,
    height: 52,
    borderRadius: 8,
  },
  listInfo: {
    flex: 1,
    minWidth: 0,
  },
  listFileName: {
    fontSize: 13,
    fontWeight: '500',
    color: DARK,
  },
  listMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  listFileSize: {
    fontSize: 11,
    color: '#8aabbd',
  },
  listFileType: {
    fontSize: 11,
    color: '#8aabbd',
  },
  listTransferredBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  listTransferredText: {
    fontSize: 10,
    color: '#22c55e',
    fontWeight: '500',
  },
  listQueuedText: {
    fontSize: 10,
    color: BLUE,
    fontWeight: '500',
  },
  listCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#d1d5db',
    alignItems: 'center',
    justifyContent: 'center',
  },
  listCheckboxActive: {
    backgroundColor: BLUE,
    borderColor: BLUE,
  },

  // Loading / Empty
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: '#8aabbd',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 80,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#8aabbd',
  },
  emptySubText: {
    fontSize: 13,
    color: '#aac0d0',
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  limitedPickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: BLUE,
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginTop: 12,
  },
  limitedPickerButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  loadMoreIndicator: {
    paddingVertical: 16,
  },

  // Upload bar
  uploadBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    paddingBottom: 34,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.06)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 6,
  },
  uploadBarText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#8aabbd',
    flexShrink: 1,
  },
  uploadBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  deviceOfflineBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
  },
  deviceOfflineText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#dc2626',
  },
  uploadBarTextActive: {
    fontWeight: '600',
    color: DARK,
  },
  uploadButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: BLUE,
    minWidth: 100,
    alignItems: 'center',
  },
  uploadButtonDisabled: {
    backgroundColor: '#d1d5db',
  },
  uploadButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },

  // Date/time picker modal
  datePickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'flex-end',
  },
  datePickerSheet: {
    backgroundColor: '#eaf4fb',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 32,
  },
  datePickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  datePickerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: DARK,
  },
  datePickerCancel: {
    fontSize: 15,
    color: '#6b8da0',
  },
  datePickerConfirm: {
    fontSize: 15,
    fontWeight: '600',
    color: BLUE,
  },
  datePickerSpinner: {
    height: 200,
  },

  // View toggle segmented control (grid/list) in filter bar
  viewToggleGroup: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.06)',
    borderRadius: 8,
    marginLeft: 8,
    padding: 2,
  },
  viewToggleBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewToggleBtnActive: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  viewToggleIcon: {
    width: 16,
    height: 16,
  },
  viewToggleIconActive: {
    tintColor: DARK,
  },
  viewToggleIconInactive: {
    tintColor: '#8aabbd',
  },

  // Album collection picker modal
  collectionOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'flex-start',
    paddingTop: 80,
    paddingHorizontal: 24,
  },
  collectionSheet: {
    backgroundColor: '#eaf4fb',
    borderRadius: 20,
    overflow: 'hidden',
    maxHeight: '70%',
  },
  collectionSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
  collectionSheetTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: DARK,
  },
  collectionSheetHeaderSpacer: {
    width: 22,
  },
  collectionLoadingIndicator: {
    paddingVertical: 32,
  },
  collectionList: {
    paddingHorizontal: 4,
    paddingBottom: 16,
  },
  collectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  collectionRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  collectionName: {
    fontSize: 15,
    fontWeight: '500',
    color: DARK,
    flex: 1,
  },
  collectionCount: {
    fontSize: 14,
    color: '#6b8da0',
  },
  selectAllBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginLeft: 8,
    alignSelf: 'center',
  },
  selectAllBtnText: {
    color: '#93c5fd',
    fontSize: 12,
    fontWeight: '500',
  },
});
