import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  Image,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { NativeModules } from 'react-native';
import { Icon } from '../components/Icon';
import { colors } from '../theme/colors';
import { useAuth } from '../stores/auth-store';
import {
  listSharedResources,
  listReceivedLibrary,
  downloadResource,
} from '../services/desktop-local-service';
import type { DesktopSharedResourceDTO, ReceivedLibraryItemDTO } from '@syncflow/contracts';

const BLUE = '#3b9fd8';
const DARK = '#1a3a5c';

export function SharedFilesScreen() {
  const navigation = useNavigation();
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'shared' | 'received'>('shared');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sharedResources, setSharedResources] = useState<DesktopSharedResourceDTO[]>([]);
  const [receivedItems, setReceivedItems] = useState<ReceivedLibraryItemDTO[]>([]);
  const [hasDevice, setHasDevice] = useState(false);
  const [error, setError] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadedResources, setDownloadedResources] = useState<Record<string, boolean>>({});

  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(false);

    try {
      const binding = await NativeModules.NativeSyncEngine?.getBindingState();
      if (!binding || !binding.host) {
        setHasDevice(false);
        setSharedResources([]);
        setReceivedItems([]);
        return;
      }
      setHasDevice(true);
      const desktop = { host: binding.host, port: 39394 };

      if (activeTab === 'shared') {
        const data = await listSharedResources(desktop);
        setSharedResources(data || []);
      } else {
        const data = await listReceivedLibrary(desktop);
        setReceivedItems(data || []);
      }
    } catch (err) {
      console.warn('[SharedFilesScreen] Failed to load local resources:', err);
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeTab]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const handleDownload = useCallback(async (resourceId: string, filename: string) => {
    if (downloadingId) return;
    setDownloadingId(resourceId);

    try {
      const binding = await NativeModules.NativeSyncEngine?.getBindingState();
      if (!binding || !binding.host) {
        Alert.alert(t('sharedFiles.deviceUnavailable.title') || '設備不可用');
        return;
      }
      const desktop = { host: binding.host, port: 39394 };
      await downloadResource(desktop, resourceId);

      setDownloadedResources(prev => ({ ...prev, [resourceId]: true }));
      Alert.alert(
        t('sharedFiles.dialogs.downloadComplete') || '下載完成',
        t('sharedFiles.dialogs.downloadSavedToPhotos', { name: filename }) || `${filename} 已儲存至相簿`
      );
    } catch (err) {
      console.warn('[SharedFilesScreen] Download failed:', err);
      Alert.alert(
        t('sharedFiles.dialogs.downloadFailed') || '下載失敗',
        t('sharedFiles.dialogs.downloadFailedMessage') || '無法下載檔案，請稍後重試'
      );
    } finally {
      setDownloadingId(null);
    }
  }, [downloadingId, t]);

  const renderSharedResource = ({ item }: { item: DesktopSharedResourceDTO }) => {
    const isDownloading = downloadingId === item.resourceId;
    const isDownloaded = downloadedResources[item.resourceId];
    const isVideo = /\.(mp4|mov|avi|mkv|webm)$/i.test(item.displayName);

    return (
      <TouchableOpacity
        activeOpacity={0.85}
        style={styles.gridCell}
        onPress={() => handleDownload(item.resourceId, item.displayName)}
        disabled={isDownloading || isDownloaded}
      >
        {/* Cell background: dark for video, light blue for others */}
        <View style={[styles.gridCellInner, { backgroundColor: isVideo ? '#1a3a5c' : 'rgba(200,220,240,0.5)' }]}>
          {/* Non-video icon */}
          {!isVideo && (
            <View style={styles.nonVideoIconWrapper}>
              <Icon
                name={item.kind === 'shared_folder' ? 'folder' : 'image'}
                size={32}
                color="#5a9ab8"
              />
            </View>
          )}

          {/* Video gradient vignette */}
          {isVideo && (
            <View style={styles.videoVignette} />
          )}

          {/* Video play button */}
          {isVideo && (
            <View style={styles.playButtonWrapper}>
              <View style={styles.playButton}>
                <Icon name="play" size={16} color="#fff" />
              </View>
            </View>
          )}

          {/* File name */}
          <Text style={[styles.cellFileName, { color: isVideo ? '#fff' : '#1a3a5c' }]} numberOfLines={1}>
            {item.displayName}
          </Text>

          {/* Downloaded badge */}
          {isDownloaded && (
            <View style={styles.downloadedBadge}>
              <Icon name="checkmark-circle" size={12} color="#fff" />
            </View>
          )}

          {/* Downloading spinner */}
          {isDownloading && (
            <ActivityIndicator size="small" color="#fff" style={styles.cellSpinner} />
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const renderReceivedItem = ({ item }: { item: ReceivedLibraryItemDTO }) => {
    const isDownloading = downloadingId === item.resourceId;
    const isDownloaded = downloadedResources[item.resourceId];

    return (
      <TouchableOpacity
        activeOpacity={0.85}
        style={styles.gridCell}
        onPress={() => handleDownload(item.resourceId, item.displayName)}
        disabled={isDownloading || isDownloaded}
      >
        <View style={[styles.gridCellInner, { backgroundColor: 'rgba(200,220,240,0.5)' }]}>
          <View style={styles.nonVideoIconWrapper}>
            <Icon name="document-text" size={32} color="#10b981" />
          </View>
          <Text style={[styles.cellFileName, { color: '#1a3a5c' }]} numberOfLines={1}>
            {item.displayName}
          </Text>
          {isDownloaded && (
            <View style={styles.downloadedBadge}>
              <Icon name="checkmark-circle" size={12} color="#fff" />
            </View>
          )}
          {isDownloading && (
            <ActivityIndicator size="small" color="#3b9fd8" style={styles.cellSpinner} />
          )}
        </View>
      </TouchableOpacity>
    );
  };

  let mainContent: React.ReactNode;

  if (loading) {
    mainContent = (
      <View style={styles.centerSection}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>{t('sharedFiles.loading') || '載入中...'}</Text>
      </View>
    );
  } else if (!hasDevice) {
    mainContent = (
      <View style={styles.centerSection}>
        <Icon name="desktop-outline" size={48} color="#b0c8da" />
        <Text style={styles.emptyTitle}>
          {t('sharedFiles.deviceUnavailable.title') || '設備不可用'}
        </Text>
        <Text style={styles.emptyMessage}>
          {t('sharedFiles.deviceUnavailable.message') || '請先連接設備'}
        </Text>
      </View>
    );
  } else if (error) {
    mainContent = (
      <View style={styles.centerSection}>
        <Icon name="alert-circle-outline" size={48} color="#f87171" />
        <Text style={styles.emptyTitle}>{t('sharedFiles.networkError.title') || '載入失敗'}</Text>
        <Text style={styles.emptyMessage}>
          {t('sharedFiles.networkError.message') || '請稍後重試'}
        </Text>
      </View>
    );
  } else if (activeTab === 'shared' && sharedResources.length === 0) {
    mainContent = (
      <View style={styles.centerSection}>
        <Icon name="folder-open-outline" size={48} color="#b0c8da" />
        <Text style={styles.emptyTitle}>{t('sharedFiles.emptyState.title') || '目前沒有內容'}</Text>
        <Text style={styles.emptyMessage}>
          {t('sharedFiles.emptyState.message') || '同步完成後，檔案將顯示在這裡'}
        </Text>
      </View>
    );
  } else if (activeTab === 'received' && receivedItems.length === 0) {
    mainContent = (
      <View style={styles.centerSection}>
        <Icon name="folder-open-outline" size={48} color="#b0c8da" />
        <Text style={styles.emptyTitle}>{t('sharedFiles.emptyState.title') || '目前沒有內容'}</Text>
        <Text style={styles.emptyMessage}>
          {t('sharedFiles.emptyState.message') || '同步完成後，檔案將顯示在這裡'}
        </Text>
      </View>
    );
  } else {
    mainContent = (
      <FlatList
        data={(activeTab === 'shared' ? sharedResources : receivedItems) as any}
        renderItem={activeTab === 'shared' ? (renderSharedResource as any) : (renderReceivedItem as any)}
        keyExtractor={item => item.resourceId}
        numColumns={3}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.gridContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => loadData(true)} />
        }
      />
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('sharedFiles.scopes.team') || '共享目录'}</Text>
      </View>

      {/* Tabs */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'shared' && styles.tabButtonActive]}
          onPress={() => setActiveTab('shared')}
        >
          <Text style={[styles.tabButtonText, activeTab === 'shared' && styles.tabButtonTextActive]}>
            {t('sharedFiles.scopes.shared') || '已分享'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'received' && styles.tabButtonActive]}
          onPress={() => setActiveTab('received')}
        >
          <Text style={[styles.tabButtonText, activeTab === 'received' && styles.tabButtonTextActive]}>
            {t('sharedFiles.scopes.received') || '已接收'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Content */}
      <View style={styles.contentContainer}>{mainContent}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#dceefa',
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    backgroundColor: '#dceefa',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1a3a5c',
  },
  tabContainer: {
    flexDirection: 'row',
    marginHorizontal: 12,
    marginBottom: 8,
    backgroundColor: 'rgba(255,255,255,0.40)',
    borderRadius: 10,
    padding: 2,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    borderRadius: 8,
  },
  tabButtonActive: {
    backgroundColor: 'rgba(255,255,255,0.80)',
    shadowColor: 'rgba(0,0,0,0.06)',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 3,
    elevation: 1,
  },
  tabButtonText: {
    fontSize: 13,
    color: '#5a7a96',
    fontWeight: '500',
  },
  tabButtonTextActive: {
    color: '#1a3a5c',
    fontWeight: '700',
  },
  contentContainer: {
    flex: 1,
  },
  centerSection: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#5a7a96',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a3a5c',
    marginTop: 16,
  },
  emptyMessage: {
    fontSize: 14,
    color: '#5a7a96',
    marginTop: 8,
    textAlign: 'center',
  },

  // Media grid
  gridContent: {
    paddingBottom: 32,
    paddingHorizontal: 2,
  },
  gridRow: {
    gap: 2,
    marginBottom: 2,
  },
  gridCell: {
    flex: 1 / 3,
    aspectRatio: 1,
  },
  gridCellInner: {
    flex: 1,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  nonVideoIconWrapper: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoVignette: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // Simulate gradient: dark at bottom, transparent at top
    backgroundColor: 'transparent',
    borderBottomWidth: 40,
    borderBottomColor: 'rgba(0,0,0,0)',
  },
  playButtonWrapper: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  playButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.20)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.50)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cellFileName: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    right: 6,
    fontSize: 9,
    fontWeight: '600',
  },
  downloadedBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(34,197,94,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cellSpinner: {
    position: 'absolute',
    top: 6,
    right: 6,
  },
});

export function normalizeDirectoryPath(path: string): string {
  let p = path.trim().replace(/\\/g, '/');
  if (p.startsWith('/')) {
    p = p.substring(1);
  }
  if (p.endsWith('/')) {
    p = p.substring(0, p.length - 1);
  }
  return p;
}

export function parentDirectoryPath(path: string): string {
  const normalized = normalizeDirectoryPath(path);
  if (!normalized) return '';
  const parts = normalized.split('/');
  if (parts.length <= 1) return '';
  parts.pop();
  return parts.join('/');
}
