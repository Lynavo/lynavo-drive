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

// eslint-disable-next-line @typescript-eslint/no-var-requires
const IC_ALBUM_PICKER: ImageSourcePropType = require('../assets/icons/album-picker.png');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const IC_SWITCH_GRID: ImageSourcePropType = require('../assets/icons/switch-grid.png');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const IC_SWITCH_LIST: ImageSourcePropType = require('../assets/icons/switch-list.png');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const IC_AUTO_UPLOAD: ImageSourcePropType = require('../assets/icons/auto-upload.png');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const IC_ARROW_DOWN: ImageSourcePropType = require('../assets/icons/arrow-down.png');
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import type { AlbumAssetDTO, AutoUploadConfigDTO } from '@syncflow/contracts';
import { Icon } from '../components/Icon';
import {
  browseAlbum,
  getAlbumStats,
  getAlbumCollections,
  submitManualUpload,
  cancelAllManualUploads,
  getAutoUploadConfig,
  saveAutoUploadConfig,
  interruptAutoUpload,
  enableAutoUpload,
  type AlbumStats,
  type AlbumCollectionInfo,
} from '../services/SyncEngineModule';
import { formatBytes } from '../utils/format';
import { sortAlbumAssetsForDisplay } from '../utils/sortAlbumAssets';
import { hasPendingManualWork } from '../utils/manualUploadState';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCREEN_WIDTH = Dimensions.get('window').width;
const GRID_COLUMNS = 3;
const GRID_GAP = 2;
const CONTENT_PADDING = 16;
const GRID_ITEM_SIZE =
  (SCREEN_WIDTH - CONTENT_PADDING * 2 - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS;
const PAGE_SIZE = 60;

const BLUE = '#3b9fd8';
const DARK = '#1a3a5c';
const SCREEN_BG = '#d6ecf8';

function formatCustomTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}年${m}月${day}日 ${h}:${min}`;
}

type MediaFilter = 'all' | 'photos' | 'videos';
type TransferFilter = 'all' | 'untransferred' | 'transferred';
type ViewMode = 'grid' | 'list';

type UnifiedFilter = 'all' | 'photos' | 'videos' | 'untransferred' | 'transferred';
const UNIFIED_FILTER_TABS: { key: UnifiedFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'photos', label: '照片' },
  { key: 'videos', label: '视频' },
  { key: 'untransferred', label: '未传' },
  { key: 'transferred', label: '已传' },
];

const TIME_RANGE_OPTIONS: {
  key: AutoUploadConfigDTO['timeRangeMode'];
  label: string;
}[] = [
  { key: 'all', label: '全部' },
  { key: 'from_now', label: '此时此刻' },
  { key: 'custom', label: '自定义时间' },
];

function getEmptyStateCopy(filter: UnifiedFilter): {
  title: string;
  subtitle: string;
} {
  switch (filter) {
    case 'transferred':
      return {
        title: '暂无已传素材',
        subtitle: '已上传完成的素材会显示在这里',
      };
    case 'untransferred':
      return {
        title: '暂无待上传素材',
        subtitle: '当前没有符合条件的未传素材',
      };
    case 'photos':
      return {
        title: '暂无照片',
        subtitle: '当前筛选下没有可显示的照片',
      };
    case 'videos':
      return {
        title: '暂无视频',
        subtitle: '当前筛选下没有可显示的视频',
      };
    default:
      return {
        title: '暂无素材',
        subtitle: '请确保已授予照片访问权限',
      };
  }
}

// ---------------------------------------------------------------------------
// AlbumWorkbenchScreen
// ---------------------------------------------------------------------------

export function AlbumWorkbenchScreen() {
  const navigation = useNavigation();

  // View state
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all');
  const [transferFilter, setTransferFilter] = useState<TransferFilter>('all');

  // Data
  const [assets, setAssets] = useState<AlbumAssetDTO[]>([]);
  const [stats, setStats] = useState<AlbumStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const offsetRef = useRef(0);
  const hasLoadedInitialAssetsRef = useRef(false);

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [multiSelectMode, setMultiSelectMode] = useState(false);

  // Auto-upload config
  const [autoUploadConfig, setAutoUploadConfig] =
    useState<AutoUploadConfigDTO | null>(null);
  const [configExpanded, setConfigExpanded] = useState(false);

  // Custom time picker
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [pendingDate, setPendingDate] = useState<Date>(new Date());

  // Album collection filter (sub-album)
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [collectionTitle, setCollectionTitle] = useState<string | null>(null);
  const [collections, setCollections] = useState<AlbumCollectionInfo[]>([]);
  const [collectionSheetVisible, setCollectionSheetVisible] = useState(false);
  const [collectionsLoading, setCollectionsLoading] = useState(false);

  // Upload
  const [uploading, setUploading] = useState(false);

  // Device connection state — used to disable upload button when offline
  const [deviceConnected, setDeviceConnected] = useState(false);

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

  const loadAssets = useCallback(
    async (
      nextMediaFilter: MediaFilter,
      nextTransferFilter: TransferFilter,
      reset: boolean,
      colId?: string | null,
    ) => {
      try {
        const offset = reset ? 0 : offsetRef.current;
        if (reset && !hasLoadedInitialAssetsRef.current) {
          // Only show full-screen spinner on the first screen load.
          // Filter switches should keep the current layout visible.
          setLoading(true);
        } else if (!reset) {
          setLoadingMore(true);
        }

        const result = await browseAlbum(
          nextMediaFilter,
          nextTransferFilter,
          offset,
          PAGE_SIZE,
          colId ?? undefined,
        );
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
        if (reset) {
          setAssets([]);
        }
      } finally {
        hasLoadedInitialAssetsRef.current = true;
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [],
  );

  const loadStats = useCallback(async () => {
    try {
      const result = await getAlbumStats();
      setStats(result);
    } catch (e) {
      console.warn('[AlbumWorkbench] loadStats error:', e);
    }
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const config = await getAutoUploadConfig();
      setAutoUploadConfig(config);
      // Auto-expand config panel when auto-upload is enabled/paused
      if (config.enabled) {
        setConfigExpanded(true);
      }
    } catch (e) {
      console.warn('[AlbumWorkbench] loadConfig error:', e);
    }
  }, []);

  useEffect(() => {
    void loadAssets(mediaFilter, transferFilter, true, collectionId);
    void loadStats();
    void loadConfig();
    // Seed initial connection state
    void (async () => {
      try {
        const binding =
          await NativeModules.NativeSyncEngine?.getBindingState();
        const conn = (binding?.connectionState as string) || '';
        setDeviceConnected(conn === 'connected' || conn === 'bound');
      } catch {
        setDeviceConnected(false);
      }
    })();
  }, [
    mediaFilter,
    transferFilter,
    collectionId,
    loadAssets,
    loadStats,
    loadConfig,
  ]);

  // Refresh all currently visible assets (re-fetch from 0 to current offset)
  // without changing scroll position or loading more pages.
  const refreshVisibleAssets = useCallback(async () => {
    try {
      const currentCount = offsetRef.current;
      if (currentCount <= 0) return;
      const result = await browseAlbum(
        mediaFilter,
        transferFilter,
        0,
        currentCount,
        collectionId ?? undefined,
      );
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
    const stateSub = emitter.addListener('onSyncStateChanged', () => {
      void loadStats();
    });
    const bindingSub = emitter.addListener(
      'onBindingStateChanged',
      (state: Record<string, unknown> | null) => {
        const conn = (state?.connectionState as string) || '';
        setDeviceConnected(conn === 'connected' || conn === 'bound');
      },
    );
    return () => {
      queueSub.remove();
      stateSub.remove();
      bindingSub.remove();
    };
  }, [mediaFilter, refreshVisibleAssets, loadStats]);

  // Re-fetch when returning from background / permission dialog.
  // On first install, PHAsset.fetchAssets() triggers the iOS permission
  // prompt but returns empty synchronously. When the user grants access
  // and the app goes back to active, we need to reload.
  const appStateRef = useRef(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener(
      'change',
      (next: AppStateStatus) => {
        if (
          appStateRef.current.match(/inactive|background/) &&
          next === 'active'
        ) {
          void loadAssets(mediaFilter, transferFilter, true, collectionId);
          void loadStats();
        }
        appStateRef.current = next;
      },
    );
    return () => sub.remove();
  }, [loadAssets, mediaFilter, transferFilter, loadStats]);

  // ---------------------------------------------------------------------------
  // Selection handlers
  // ---------------------------------------------------------------------------

  const handleToggleSelect = useCallback((assetLocalId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(assetLocalId)) {
        next.delete(assetLocalId);
      } else {
        next.add(assetLocalId);
      }
      if (next.size === 0) {
        setMultiSelectMode(false);
      }
      return next;
    });
  }, []);

  const handleLongPress = useCallback((assetLocalId: string) => {
    setMultiSelectMode(true);
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.add(assetLocalId);
      return next;
    });
  }, []);

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
    setSelectedIds(new Set());
    setMultiSelectMode(false);
  }, []);

  // ---------------------------------------------------------------------------
  // Upload handler
  // ---------------------------------------------------------------------------

  const handleUpload = useCallback(async () => {
    if (selectedIds.size === 0) return;

    if (autoUploadConfig?.state === 'active') {
      Alert.alert('无法上传', '请先关闭自动上传');
      return;
    }

    // Check device connection before submitting
    try {
      const binding = await NativeModules.NativeSyncEngine?.getBindingState();
      if (
        !binding?.deviceId ||
        (binding.connectionState !== 'connected' &&
          binding.connectionState !== 'bound')
      ) {
        Alert.alert('无法上传', '请先连接设备');
        return;
      }
    } catch {
      Alert.alert('无法上传', '请先连接设备');
      return;
    }

    try {
      setUploading(true);
      const result = await submitManualUpload(Array.from(selectedIds));
      if (result.skippedCount === 0) {
        // All succeeded
        Alert.alert('已提交', `已入队 ${result.queuedCount} 个文件`);
      } else if (result.queuedCount > 0) {
        // Partial duplicates
        Alert.alert(
          '已提交',
          `已入队 ${result.queuedCount} 个文件，${result.skippedCount} 个重复素材已自动跳过`,
        );
      } else {
        // All duplicates
        Alert.alert(
          '全部重复',
          `所选 ${result.skippedCount} 个素材已存在于上传队列中，无需重复提交`,
        );
      }
      setSelectedIds(new Set());
      setMultiSelectMode(false);
      // Reload assets to update transferred/queued states
      void loadAssets(mediaFilter, transferFilter, true, collectionId);
      void loadStats();
      // Kick off the sync pipeline so queued items actually upload
      NativeModules.NativeSyncEngine?.triggerSync?.();
    } catch (e) {
      Alert.alert('提交失败', '无法提交上传任务，请稍后重试');
      console.warn('[AlbumWorkbench] submitManualUpload error:', e);
    } finally {
      setUploading(false);
    }
  }, [
    autoUploadConfig?.state,
    selectedIds,
    loadAssets,
    mediaFilter,
    transferFilter,
    loadStats,
  ]);

  // ---------------------------------------------------------------------------
  // Auto-upload config handlers
  // ---------------------------------------------------------------------------

  const handleToggleAutoUpload = useCallback(async () => {
    if (!autoUploadConfig) return;
    try {
      if (autoUploadConfig.state === 'active') {
        // active → interrupted: show confirmation dialog per PRD
        Alert.alert(
          '关闭自动上传',
          '确认关闭自动上传？关闭后新素材将不再自动传输到 PC 端。',
          [
            { text: '继续上传', style: 'cancel' },
            {
              text: '确认关闭',
              style: 'destructive',
              onPress: async () => {
                try {
                  await interruptAutoUpload();
                  await loadConfig();
                } catch (e) {
                  console.warn('[AlbumWorkbench] interruptAutoUpload error:', e);
                  Alert.alert('操作失败', '关闭自动上传失败，请重试');
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
              Alert.alert('无法开启', '请先连接设备');
              return;
            }
          } catch {
            Alert.alert('无法开启', '请先连接设备');
            return;
          }
          if (
            autoUploadConfig.timeRangeMode === 'custom' &&
            !autoUploadConfig.customTimeFrom
          ) {
            Alert.alert('配置不完整', '请先设置自定义时间点');
            return;
          }
        }

        // Check if manual upload is in progress — per PRD, must confirm first
        try {
          const syncData =
            await NativeModules.NativeSyncEngine?.getSyncOverview();
          if (hasPendingManualWork(syncData)) {
            Alert.alert(
              '切换上传模式',
              '当前正在上传，继续自动上传将中断手动上传，是否继续？',
              [
                { text: '取消', style: 'cancel' },
                {
                  text: '确认切换',
                  onPress: async () => {
                    try {
                      await cancelAllManualUploads();
                      await enableAutoUpload();
                      await NativeModules.NativeSyncEngine?.triggerSync();
                      await loadConfig();
                    } catch (e) {
                      console.warn('[AlbumWorkbench] enableAutoUpload error:', e);
                      Alert.alert('操作失败', '自动上传开启失败，请重试');
                    }
                  },
                },
              ],
            );
            return;
          }
        } catch {
          // If we can't check, proceed — sync overview unavailable
        }

        await enableAutoUpload();
        // Ensure sync loop is running after enabling auto upload
        await NativeModules.NativeSyncEngine?.triggerSync();
      }
      await loadConfig();
    } catch (e) {
      console.warn('[AlbumWorkbench] toggleAutoUpload error:', e);
      Alert.alert('操作失败', '自动上传状态切换失败，请重试');
    }
  }, [autoUploadConfig, loadConfig]);

  const handleConfigChange = useCallback(
    async (
      key: 'timeRangeMode' | 'enabled' | 'customTimeFrom',
      value: string | boolean,
    ) => {
      if (!autoUploadConfig) return;

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
        Alert.alert('配置不完整', '请先设置自定义时间点');
        return;
      }

      try {
        const updated = { ...autoUploadConfig, [key]: value };
        await saveAutoUploadConfig(updated);
        await loadConfig();
      } catch (e) {
        console.warn('[AlbumWorkbench] saveConfig error:', e);
        Alert.alert('保存失败', '自动上传配置保存失败，请重试');
      }
    },
    [autoUploadConfig, loadConfig],
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
      setSelectedIds(new Set());
      setMultiSelectMode(false);
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
      const isSelected = selectedIds.has(item.assetLocalId);
      return (
        <TouchableOpacity
          style={styles.gridItem}
          activeOpacity={item.isTransferred ? 1 : 0.7}
          onPress={() => {
            if (!item.isTransferred) {
              handleToggleSelect(item.assetLocalId);
            }
          }}
          onLongPress={() => {
            if (!item.isTransferred) {
              handleLongPress(item.assetLocalId);
            }
          }}
        >
          <Image
            source={{ uri: item.thumbnailUri }}
            style={styles.gridThumbnail}
            resizeMode="cover"
          />
          {/* Transferred overlay */}
          {item.isTransferred && (
            <View style={styles.transferredOverlay}>
              <Icon name="checkmark-circle" size={24} color="#fff" />
            </View>
          )}
          {/* Queued badge */}
          {item.isQueued && !item.isTransferred && (
            <View style={styles.queuedBadge}>
              <Text style={styles.queuedBadgeText}>排队中</Text>
            </View>
          )}
          {/* Video indicator */}
          {item.mediaType === 'video' && (
            <View style={styles.videoIndicator}>
              <Icon name="play-circle-outline" size={16} color="#fff" />
            </View>
          )}
          {/* Selection indicator — only for non-transferred items */}
          {!item.isTransferred && (multiSelectMode || isSelected) && (
            <View
              style={[
                styles.selectionCircle,
                isSelected && styles.selectionCircleActive,
              ]}
            >
              {isSelected && <Icon name="checkmark" size={14} color="#fff" />}
            </View>
          )}
        </TouchableOpacity>
      );
    },
    [selectedIds, multiSelectMode, handleToggleSelect, handleLongPress],
  );

  const renderListItem = useCallback(
    ({ item }: ListRenderItemInfo<AlbumAssetDTO>) => {
      const isSelected = selectedIds.has(item.assetLocalId);
      return (
        <TouchableOpacity
          style={[styles.listRow, isSelected && styles.listRowSelected]}
          activeOpacity={item.isTransferred ? 1 : 0.7}
          onPress={() => {
            if (!item.isTransferred) {
              handleToggleSelect(item.assetLocalId);
            }
          }}
          onLongPress={() => {
            if (!item.isTransferred) {
              handleLongPress(item.assetLocalId);
            }
          }}
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
                {item.mediaType === 'video' ? '视频' : '图片'}
              </Text>
              {item.isTransferred && (
                <View style={styles.listTransferredBadge}>
                  <Icon name="checkmark" size={10} color="#22c55e" />
                  <Text style={styles.listTransferredText}>已传</Text>
                </View>
              )}
              {item.isQueued && !item.isTransferred && (
                <Text style={styles.listQueuedText}>排队中</Text>
              )}
            </View>
          </View>
          {!item.isTransferred && (
            <View
              style={[
                styles.listCheckbox,
                isSelected && styles.listCheckboxActive,
              ]}
            >
              {isSelected && <Icon name="checkmark" size={14} color="#fff" />}
            </View>
          )}
        </TouchableOpacity>
      );
    },
    [selectedIds, handleToggleSelect, handleLongPress],
  );

  const keyExtractor = useCallback(
    (item: AlbumAssetDTO) => item.assetLocalId,
    [],
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const isAutoUploadActive = autoUploadConfig?.state === 'active';

  // Derive custom time display string for summary card
  const timeRangeDisplayLabel = autoUploadConfig
    ? TIME_RANGE_OPTIONS.find(o => o.key === autoUploadConfig.timeRangeMode)
        ?.label ?? '全部'
    : '全部';
  const emptyStateCopy = getEmptyStateCopy(unifiedFilter);

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
              <Text style={styles.configTitle}>自动上传</Text>
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
                  {isAutoUploadActive ? '运行中' : '已关闭'}
                </Text>
              </View>
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
                  !isAutoUploadActive && !deviceConnected && styles.configRowDisabled,
                ]}
                activeOpacity={0.7}
                onPress={handleToggleAutoUpload}
                disabled={!isAutoUploadActive && !deviceConnected}
              >
                <Text
                  style={[
                    styles.configLabel,
                    !isAutoUploadActive && !deviceConnected && styles.configLabelDisabled,
                  ]}
                >
                  {isAutoUploadActive ? '暂停自动上传' : '恢复自动上传'}
                </Text>
                <View
                  style={[
                    styles.toggleTrack,
                    isAutoUploadActive && styles.toggleTrackOn,
                    !isAutoUploadActive && !deviceConnected && styles.toggleTrackDisabled,
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
                <Text style={styles.configGroupLabel}>时间范围</Text>
                <View style={styles.configChips}>
                  {TIME_RANGE_OPTIONS.map(opt => (
                    <TouchableOpacity
                      key={opt.key}
                      style={[
                        styles.configChip,
                        autoUploadConfig.timeRangeMode === opt.key &&
                          styles.configChipActive,
                      ]}
                      activeOpacity={0.7}
                      onPress={() =>
                        void handleConfigChange('timeRangeMode', opt.key)
                      }
                    >
                      <Text
                        style={[
                          styles.configChipText,
                          autoUploadConfig.timeRangeMode === opt.key &&
                            styles.configChipTextActive,
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {/* Custom time display — shown when timeRangeMode is 'custom' */}
                {autoUploadConfig.timeRangeMode === 'custom' && (
                  <TouchableOpacity
                    style={styles.customTimeCard}
                    activeOpacity={0.7}
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
                        ? formatCustomTime(autoUploadConfig.customTimeFrom)
                        : '点击设置时间'}
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
                <Text style={styles.summaryTitle}>自动上传运行中</Text>
              </View>
              <Text style={styles.summarySubtitle}>
                新素材将自动传输到 PC 端
              </Text>
              <View style={styles.summaryGrid}>
                <View style={styles.summaryGridItem}>
                  <Text style={styles.summaryGridLabel}>本次已传</Text>
                  <Text style={styles.summaryGridValue}>
                    <Text style={styles.summaryGridNumber}>
                      {stats.transferredCount}
                    </Text>{' '}
                    个
                  </Text>
                </View>
                <View style={styles.summaryGridItem}>
                  <Text style={styles.summaryGridLabel}>待上传</Text>
                  <Text style={styles.summaryGridValue}>
                    <Text style={styles.summaryGridNumberOrange}>
                      {Math.max(
                        0,
                        stats.totalCount -
                          stats.transferredCount -
                          stats.queuedCount,
                      ) + stats.queuedCount}
                    </Text>{' '}
                    个
                  </Text>
                </View>
                <View style={styles.summaryGridItem}>
                  <Text style={styles.summaryGridLabel}>素材总数</Text>
                  <Text style={styles.summaryGridValue}>
                    <Text style={styles.summaryGridNumberDark}>
                      {stats.totalCount}
                    </Text>{' '}
                    个
                  </Text>
                </View>
                <View style={styles.summaryGridItem}>
                  <Text style={styles.summaryGridLabel}>时间范围</Text>
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
            <Text style={styles.statLabel}>总数</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{selectedIds.size}</Text>
            <Text style={styles.statLabel}>已选</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: '#22c55e' }]}>
              {stats.transferredCount}
            </Text>
            <Text style={styles.statLabel}>已传</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: '#f59e0b' }]}>
              {Math.max(
                0,
                stats.totalCount -
                  stats.transferredCount -
                  stats.queuedCount,
              )}
            </Text>
            <Text style={styles.statLabel}>新增</Text>
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
                >
                  {tab.label}
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
                    { tintColor: viewMode === 'grid' ? DARK : '#8aabbd' },
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
                    { tintColor: viewMode === 'list' ? DARK : '#8aabbd' },
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
        <TouchableOpacity activeOpacity={0.7} onPress={() => navigation.goBack()}>
          <Icon name="chevron-back" size={22} color={DARK} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {collectionTitle ?? '相册'}
        </Text>
        <TouchableOpacity
          style={styles.headerFilterBtn}
          activeOpacity={0.7}
          onPress={() => void handleOpenCollectionSheet()}
        >
          <Image source={IC_ALBUM_PICKER} style={styles.headerFilterIcon} />
        </TouchableOpacity>
      </View>

      {/* Asset list */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={BLUE} />
          <Text style={styles.loadingText}>正在加载相册...</Text>
        </View>
      ) : viewMode === 'grid' ? (
        <FlatList
          key="grid"
          data={isAutoUploadActive ? [] : assets}
          renderItem={renderGridItem}
          keyExtractor={keyExtractor}
          extraData={selectedIds}
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
          ListHeaderComponent={renderListHeader}
          ListEmptyComponent={renderListEmptyComponent}
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
          extraData={selectedIds}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onEndReached={isAutoUploadActive ? undefined : handleEndReached}
          onEndReachedThreshold={0.5}
          ListHeaderComponent={renderListHeader}
          ListEmptyComponent={renderListEmptyComponent}
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

      {/* Bottom bar — always visible, button disabled when auto-upload active / offline */}
      <View style={styles.uploadBar}>
        <Text
          style={[
            styles.uploadBarText,
            selectedIds.size > 0 && !isAutoUploadActive && styles.uploadBarTextActive,
          ]}
        >
          {isAutoUploadActive
            ? '自动上传中，手动上传不可用'
            : selectedIds.size > 0
              ? `已选 ${selectedIds.size} 个素材`
              : '未选择素材'}
        </Text>
        <TouchableOpacity
          style={[
            styles.uploadButton,
            (uploading || selectedIds.size === 0 || !deviceConnected || isAutoUploadActive) &&
              styles.uploadButtonDisabled,
          ]}
          activeOpacity={0.7}
          onPress={() => void handleUpload()}
          disabled={uploading || selectedIds.size === 0 || !deviceConnected || isAutoUploadActive}
        >
          {uploading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.uploadButtonText}>开始上传</Text>
          )}
        </TouchableOpacity>
      </View>
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
                <Text style={styles.datePickerCancel}>取消</Text>
              </TouchableOpacity>
              <Text style={styles.datePickerTitle}>选择时间</Text>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={handleDatePickerConfirm}
              >
                <Text style={styles.datePickerConfirm}>确认</Text>
              </TouchableOpacity>
            </View>
            <DateTimePicker
              value={pendingDate}
              mode="datetime"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={handleDatePickerChange}
              locale="zh-Hans"
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
              <Text style={styles.collectionSheetTitle}>选择相册</Text>
              <View style={{ width: 22 }} />
            </View>

            {collectionsLoading ? (
              <ActivityIndicator
                style={{ paddingVertical: 32 }}
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
                    <Text style={styles.collectionName}>全部照片</Text>
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
});
