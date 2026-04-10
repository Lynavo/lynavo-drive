import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
  Dimensions,
  NativeModules,
  NativeEventEmitter,
  TextInput,
  Modal,
  type ListRenderItemInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { AlbumAssetDTO, AutoUploadConfigDTO } from '@syncflow/contracts';
import { Icon } from '../components/Icon';
import {
  browseAlbum,
  getAlbumStats,
  getAlbumCollections,
  submitManualUpload,
  pauseAutoUpload,
  resumeAutoUpload,
  getAutoUploadConfig,
  saveAutoUploadConfig,
  type AlbumStats,
  type AlbumCollectionInfo,
} from '../services/SyncEngineModule';
import { formatBytes } from '../utils/format';
import { sortAlbumAssetsForDisplay } from '../utils/sortAlbumAssets';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCREEN_WIDTH = Dimensions.get('window').width;
const GRID_COLUMNS = 3;
const GRID_GAP = 2;
const GRID_ITEM_SIZE = (SCREEN_WIDTH - GRID_GAP * (GRID_COLUMNS + 1)) / GRID_COLUMNS;
const PAGE_SIZE = 60;

const BLUE = '#3b9fd8';
const DARK = '#1a3a5c';
const SCREEN_BG = '#d6ecf8';

type MediaFilter = 'all' | 'photos' | 'videos';
type TransferFilter = 'all' | 'untransferred' | 'transferred';
type ViewMode = 'grid' | 'list';

const TRANSFER_FILTER_TABS: { key: TransferFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'untransferred', label: '未传输' },
  { key: 'transferred', label: '已传输' },
];

const MEDIA_FILTER_TABS: { key: MediaFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'photos', label: '图片' },
  { key: 'videos', label: '视频' },
];

const TIME_RANGE_OPTIONS: {
  key: AutoUploadConfigDTO['timeRangeMode'];
  label: string;
}[] = [
  { key: 'from_now', label: '此时此刻' },
  { key: 'from_today', label: '今天开始' },
  { key: 'all', label: '所有素材' },
  { key: 'custom', label: '自定义时间点' },
];

const MEDIA_FILTER_OPTIONS: {
  key: AutoUploadConfigDTO['mediaFilter'];
  label: string;
}[] = [
  { key: 'all', label: '全部' },
  { key: 'videos', label: '仅视频' },
  { key: 'photos', label: '仅照片' },
];

// ---------------------------------------------------------------------------
// AlbumWorkbenchScreen
// ---------------------------------------------------------------------------

export function AlbumWorkbenchScreen() {
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

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [multiSelectMode, setMultiSelectMode] = useState(false);

  // Auto-upload config
  const [autoUploadConfig, setAutoUploadConfig] =
    useState<AutoUploadConfigDTO | null>(null);
  const [configExpanded, setConfigExpanded] = useState(false);

  // Album collection filter (subfolder)
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [collectionTitle, setCollectionTitle] = useState<string | null>(null);
  const [collections, setCollections] = useState<AlbumCollectionInfo[]>([]);
  const [collectionSheetVisible, setCollectionSheetVisible] = useState(false);
  const [collectionsLoading, setCollectionsLoading] = useState(false);

  // Upload
  const [uploading, setUploading] = useState(false);

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
        if (reset) {
          setLoading(true);
        } else {
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
  }, [mediaFilter, transferFilter, collectionId, loadAssets, loadStats, loadConfig]);

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
    return () => {
      queueSub.remove();
      stateSub.remove();
    };
  }, [mediaFilter, refreshVisibleAssets, loadStats]);

  // ---------------------------------------------------------------------------
  // Selection handlers
  // ---------------------------------------------------------------------------

  const handleToggleSelect = useCallback(
    (assetLocalId: string) => {
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
    },
    [],
  );

  const handleLongPress = useCallback(
    (assetLocalId: string) => {
      setMultiSelectMode(true);
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.add(assetLocalId);
        return next;
      });
    },
    [],
  );

  const handleSelectAll = useCallback(() => {
    const selectableAssets = assets.filter(a => !a.isTransferred);
    if (selectedIds.size === selectableAssets.length && selectableAssets.length > 0) {
      // Deselect all
      setSelectedIds(new Set());
      setMultiSelectMode(false);
    } else {
      // Select all non-transferred
      setMultiSelectMode(true);
      setSelectedIds(new Set(selectableAssets.map(a => a.assetLocalId)));
    }
  }, [assets, selectedIds.size]);

  // ---------------------------------------------------------------------------
  // Upload handler
  // ---------------------------------------------------------------------------

  const handleUpload = useCallback(async () => {
    if (selectedIds.size === 0) return;

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
    } catch (e) {
      Alert.alert('提交失败', '无法提交上传任务，请稍后重试');
      console.warn('[AlbumWorkbench] submitManualUpload error:', e);
    } finally {
      setUploading(false);
    }
  }, [selectedIds, loadAssets, mediaFilter, transferFilter, collectionId, loadStats]);

  // ---------------------------------------------------------------------------
  // Auto-upload config handlers
  // ---------------------------------------------------------------------------

  const handleToggleAutoUpload = useCallback(async () => {
    if (!autoUploadConfig) return;
    try {
      if (autoUploadConfig.state === 'active') {
        await pauseAutoUpload();
      } else if (autoUploadConfig.state === 'paused') {
        await resumeAutoUpload();
      } else {
        // disabled → enable: check connection first
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
        // Validate custom time range before enabling
        if (
          autoUploadConfig.timeRangeMode === 'custom' &&
          !autoUploadConfig.customTimeFrom
        ) {
          Alert.alert('配置不完整', '请先设置自定义时间点');
          return;
        }
        await saveAutoUploadConfig({
          ...autoUploadConfig,
          enabled: true,
        });
      }
      await loadConfig();
    } catch (e) {
      console.warn('[AlbumWorkbench] toggleAutoUpload error:', e);
      Alert.alert('操作失败', '自动上传状态切换失败，请重试');
    }
  }, [autoUploadConfig, loadConfig]);

  const handleConfigChange = useCallback(
    async (
      key: 'mediaFilter' | 'timeRangeMode' | 'enabled' | 'customTimeFrom',
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
  }, [loadingMore, hasMore, loading, loadAssets, mediaFilter, transferFilter, collectionId]);

  // ---------------------------------------------------------------------------
  // Collection filter handlers
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

  // Total count across all collections (for "全部照片" row)
  const collectionTotalCount = stats?.totalCount ?? 0;

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
              {isSelected && (
                <Icon name="checkmark" size={14} color="#fff" />
              )}
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
                  <Text style={styles.listTransferredText}>已传输</Text>
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
              {isSelected && (
                <Icon name="checkmark" size={14} color="#fff" />
              )}
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

  const selectableCount = assets.filter(a => !a.isTransferred).length;
  const allSelected = selectableCount > 0 && selectedIds.size === selectableCount;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          {collectionTitle ?? '相册工作台'}
        </Text>
        <TouchableOpacity
          style={styles.headerFilterBtn}
          activeOpacity={0.7}
          onPress={() => void handleOpenCollectionSheet()}
        >
          <Icon
            name="albums-outline"
            size={18}
            color={collectionId ? BLUE : DARK}
          />
          {collectionId != null && (
            <View style={styles.headerFilterDot} />
          )}
        </TouchableOpacity>
      </View>

      {/* Auto-upload config section */}
      {autoUploadConfig && (
        <View style={styles.configSection}>
          <TouchableOpacity
            style={styles.configHeader}
            activeOpacity={0.7}
            onPress={() => setConfigExpanded(prev => !prev)}
          >
            <View style={styles.configTitleRow}>
              <Icon name="flash-outline" size={16} color={BLUE} />
              <Text style={styles.configTitle}>自动上传</Text>
              <View
                style={[
                  styles.configStateBadge,
                  autoUploadConfig.state === 'active'
                    ? styles.configStateActive
                    : autoUploadConfig.state === 'paused'
                      ? styles.configStatePaused
                      : styles.configStateDisabled,
                ]}
              >
                <Text
                  style={[
                    styles.configStateText,
                    autoUploadConfig.state === 'active'
                      ? styles.configStateTextActive
                      : autoUploadConfig.state === 'paused'
                        ? styles.configStateTextPaused
                        : styles.configStateTextDisabled,
                  ]}
                >
                  {autoUploadConfig.state === 'active'
                    ? '运行中'
                    : autoUploadConfig.state === 'paused'
                      ? '已暂停'
                      : '未启用'}
                </Text>
              </View>
            </View>
            <Icon
              name={configExpanded ? 'chevron-up' : 'chevron-down'}
              size={16}
              color="#8aabbd"
            />
          </TouchableOpacity>

          {configExpanded && (
            <View style={styles.configBody}>
              {/* Enable/Disable toggle */}
              <TouchableOpacity
                style={styles.configRow}
                activeOpacity={0.7}
                onPress={handleToggleAutoUpload}
              >
                <Text style={styles.configLabel}>
                  {autoUploadConfig.state === 'active'
                    ? '暂停自动上传'
                    : autoUploadConfig.state === 'paused'
                      ? '恢复自动上传'
                      : '启用自动上传'}
                </Text>
                <View
                  style={[
                    styles.toggleTrack,
                    autoUploadConfig.state === 'active' && styles.toggleTrackOn,
                  ]}
                >
                  <View
                    style={[
                      styles.toggleThumb,
                      autoUploadConfig.state === 'active' &&
                        styles.toggleThumbOn,
                    ]}
                  />
                </View>
              </TouchableOpacity>

              {/* Media filter */}
              <View style={styles.configGroup}>
                <Text style={styles.configGroupLabel}>素材类型</Text>
                <View style={styles.configChips}>
                  {MEDIA_FILTER_OPTIONS.map(opt => (
                    <TouchableOpacity
                      key={opt.key}
                      style={[
                        styles.configChip,
                        autoUploadConfig.mediaFilter === opt.key &&
                          styles.configChipActive,
                      ]}
                      activeOpacity={0.7}
                      onPress={() =>
                        void handleConfigChange('mediaFilter', opt.key)
                      }
                    >
                      <Text
                        style={[
                          styles.configChipText,
                          autoUploadConfig.mediaFilter === opt.key &&
                            styles.configChipTextActive,
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

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
                {/* Custom time input — shown when timeRangeMode is 'custom' */}
                {autoUploadConfig.timeRangeMode === 'custom' && (
                  <TextInput
                    style={styles.customTimeInput}
                    placeholder="YYYY-MM-DDTHH:mm:ss"
                    placeholderTextColor="#8aabbd"
                    defaultValue={autoUploadConfig.customTimeFrom ?? ''}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="done"
                    onEndEditing={e => {
                      const text = e.nativeEvent.text.trim();
                      if (text.length > 0) {
                        const parsed = new Date(text);
                        if (isNaN(parsed.getTime())) {
                          Alert.alert('时间格式无效', '请使用 YYYY-MM-DDTHH:mm:ss 格式');
                          return;
                        }
                        void handleConfigChange('customTimeFrom', parsed.toISOString());
                      }
                    }}
                  />
                )}
              </View>
            </View>
          )}
        </View>
      )}

      {/* Transfer filter */}
      <View style={styles.filterRow}>
        {TRANSFER_FILTER_TABS.map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[
              styles.filterTab,
              transferFilter === tab.key && styles.filterTabActive,
            ]}
            activeOpacity={0.7}
            onPress={() => {
              setTransferFilter(tab.key);
              setSelectedIds(new Set());
              setMultiSelectMode(false);
            }}
          >
            <Text
              style={[
                styles.filterTabText,
                transferFilter === tab.key && styles.filterTabTextActive,
              ]}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
        <View style={styles.filterSpacer} />
        <View style={styles.viewModeGroup}>
          <TouchableOpacity
            style={[
              styles.viewModeBtn,
              viewMode === 'grid' && styles.viewModeBtnActive,
            ]}
            activeOpacity={0.7}
            onPress={() => setViewMode('grid')}
          >
            <Icon
              name="grid-outline"
              size={16}
              color={viewMode === 'grid' ? BLUE : '#8aabbd'}
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.viewModeBtn,
              viewMode === 'list' && styles.viewModeBtnActive,
            ]}
            activeOpacity={0.7}
            onPress={() => setViewMode('list')}
          >
            <Icon
              name="list-outline"
              size={16}
              color={viewMode === 'list' ? BLUE : '#8aabbd'}
            />
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={styles.selectAllBtn}
          activeOpacity={0.7}
          onPress={handleSelectAll}
        >
          <Text style={styles.selectAllText}>
            {allSelected ? '取消全选' : '全选'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Media filter */}
      <View style={styles.filterRowSecondary}>
        {MEDIA_FILTER_TABS.map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[
              styles.filterTab,
              mediaFilter === tab.key && styles.filterTabActive,
            ]}
            activeOpacity={0.7}
            onPress={() => {
              setMediaFilter(tab.key);
              setCollectionId(null);
              setCollectionTitle(null);
              setSelectedIds(new Set());
              setMultiSelectMode(false);
            }}
          >
            <Text
              style={[
                styles.filterTabText,
                mediaFilter === tab.key && styles.filterTabTextActive,
              ]}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Stats bar */}
      {stats && (
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
            <Text style={[styles.statValue, { color: BLUE }]}>
              {Math.max(0, stats.totalCount - stats.transferredCount - stats.queuedCount)}
            </Text>
            <Text style={styles.statLabel}>新增</Text>
          </View>
        </View>
      )}

      {/* Asset list */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={BLUE} />
          <Text style={styles.loadingText}>正在加载相册...</Text>
        </View>
      ) : assets.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Icon name="image-outline" size={48} color="#b0c8da" />
          <Text style={styles.emptyText}>暂无素材</Text>
          <Text style={styles.emptySubText}>
            请确保已授予照片访问权限
          </Text>
        </View>
      ) : viewMode === 'grid' ? (
        <FlatList
          key="grid"
          data={assets}
          renderItem={renderGridItem}
          keyExtractor={keyExtractor}
          extraData={selectedIds}
          numColumns={GRID_COLUMNS}
          contentContainerStyle={styles.gridContent}
          columnWrapperStyle={styles.gridRow}
          showsVerticalScrollIndicator={false}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.5}
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
          data={assets}
          renderItem={renderListItem}
          keyExtractor={keyExtractor}
          extraData={selectedIds}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.5}
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

      {/* Bottom floating upload bar — always visible, disabled when nothing selected */}
      <View style={styles.uploadBar}>
        <Text style={styles.uploadBarText}>
          {selectedIds.size > 0 ? `已选 ${selectedIds.size} 项` : '未选择素材'}
        </Text>
        <TouchableOpacity
          style={[
            styles.uploadButton,
            (uploading || selectedIds.size === 0) && styles.uploadButtonDisabled,
          ]}
          activeOpacity={0.7}
          onPress={() => void handleUpload()}
          disabled={uploading || selectedIds.size === 0}
        >
          {uploading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.uploadButtonText}>开始上传</Text>
          )}
        </TouchableOpacity>
      </View>
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
              <Text style={styles.collectionSheetTitle}>相册工作台</Text>
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
                  <>
                    {/* "全部照片" — clears the collection filter */}
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
                    <View style={styles.collectionDivider} />
                  </>
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
  },
  headerFilterBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
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
    marginHorizontal: 20,
    marginBottom: 8,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.75)',
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
  configStatePaused: {
    backgroundColor: 'rgba(245,158,11,0.12)',
  },
  configStateDisabled: {
    backgroundColor: 'rgba(148,163,184,0.12)',
  },
  configStateText: {
    fontSize: 11,
    fontWeight: '600',
  },
  configStateTextActive: {
    color: '#16a34a',
  },
  configStateTextPaused: {
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
  configLabel: {
    fontSize: 14,
    color: DARK,
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
    backgroundColor: BLUE,
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
  customTimeInput: {
    marginTop: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    fontSize: 13,
    color: DARK,
    fontVariant: ['tabular-nums'],
  },

  // Filter tabs
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 8,
    gap: 4,
  },
  filterRowSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 0,
    paddingBottom: 8,
    gap: 4,
  },
  filterTab: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 14,
  },
  filterTabActive: {
    backgroundColor: 'rgba(59,159,216,0.15)',
  },
  filterTabText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#8aabbd',
  },
  filterTabTextActive: {
    color: BLUE,
    fontWeight: '700',
  },
  filterSpacer: {
    flex: 1,
  },
  viewModeGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.6)',
    borderRadius: 8,
    padding: 2,
    gap: 2,
  },
  viewModeBtn: {
    width: 30,
    height: 28,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewModeBtnActive: {
    backgroundColor: 'rgba(59,159,216,0.12)',
  },
  selectAllBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  selectAllText: {
    fontSize: 13,
    fontWeight: '600',
    color: BLUE,
  },

  // Stats bar
  statsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.6)',
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
    paddingHorizontal: GRID_GAP,
    paddingBottom: 100,
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
    paddingHorizontal: 20,
    paddingBottom: 100,
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
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.06)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
  },
  uploadBarText: {
    fontSize: 14,
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
    opacity: 0.6,
  },
  uploadButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
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
  collectionDivider: {
    height: 1,
    backgroundColor: 'rgba(0,0,0,0.06)',
    marginHorizontal: 16,
  },
});
