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

    return (
      <View style={styles.fileRow}>
        <View style={styles.fileIconWrapper}>
          <Icon
            name={item.kind === 'shared_folder' ? 'folder' : 'document'}
            size={20}
            color="#3b9fd8"
          />
        </View>
        <View style={styles.fileInfo}>
          <Text style={styles.fileName} numberOfLines={1}>
            {item.displayName}
          </Text>
          <Text style={styles.fileMeta}>
            {item.fileSize ? `${(item.fileSize / 1024 / 1024).toFixed(2)} MB` : ''}
          </Text>
        </View>
        <TouchableOpacity
          style={[
            styles.downloadBtn,
            isDownloaded && styles.downloadBtnCompleted,
            isDownloading && styles.downloadBtnDisabled,
          ]}
          disabled={isDownloading || isDownloaded}
          onPress={() => handleDownload(item.resourceId, item.displayName)}
        >
          {isDownloading ? (
            <ActivityIndicator size="small" color={BLUE} />
          ) : isDownloaded ? (
            <Icon name="checkmark-circle" size={18} color="#16a34a" />
          ) : (
            <Icon name="download-outline" size={18} color={BLUE} />
          )}
        </TouchableOpacity>
      </View>
    );
  };

  const renderReceivedItem = ({ item }: { item: ReceivedLibraryItemDTO }) => {
    const isDownloading = downloadingId === item.resourceId;
    const isDownloaded = downloadedResources[item.resourceId];

    return (
      <View style={styles.fileRow}>
        <View style={styles.fileIconWrapper}>
          <Icon name="document-text" size={20} color="#10b981" />
        </View>
        <View style={styles.fileInfo}>
          <Text style={styles.fileName} numberOfLines={1}>
            {item.displayName}
          </Text>
          <Text style={styles.fileMeta}>
            {`${(item.fileSize / 1024 / 1024).toFixed(2)} MB`}
          </Text>
        </View>
        <TouchableOpacity
          style={[
            styles.downloadBtn,
            isDownloaded && styles.downloadBtnCompleted,
            isDownloading && styles.downloadBtnDisabled,
          ]}
          disabled={isDownloading || isDownloaded}
          onPress={() => handleDownload(item.resourceId, item.displayName)}
        >
          {isDownloading ? (
            <ActivityIndicator size="small" color={BLUE} />
          ) : isDownloaded ? (
            <Icon name="checkmark-circle" size={18} color="#16a34a" />
          ) : (
            <Icon name="download-outline" size={18} color={BLUE} />
          )}
        </TouchableOpacity>
      </View>
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
        contentContainerStyle={styles.listContent}
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
        <Text style={styles.headerTitle}>{t('sharedFiles.scopes.team') || '檔案共享'}</Text>
      </View>

      {/* Tabs */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'shared' && styles.tabButtonActive]}
          onPress={() => setActiveTab('shared')}
        >
          <Text style={[styles.tabButtonText, activeTab === 'shared' && styles.tabButtonTextActive]}>
            {t('sharedFiles.scopes.shared') || '已分享的資源'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'received' && styles.tabButtonActive]}
          onPress={() => setActiveTab('received')}
        >
          <Text style={[styles.tabButtonText, activeTab === 'received' && styles.tabButtonTextActive]}>
            {t('sharedFiles.scopes.received') || '已接收的檔案'}
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
    backgroundColor: '#f8fafc',
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
    backgroundColor: '#ffffff',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: DARK,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    margin: 12,
    borderRadius: 8,
    padding: 2,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 6,
  },
  tabButtonActive: {
    backgroundColor: '#ffffff',
    shadowColor: 'rgba(0,0,0,0.05)',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 2,
    elevation: 1,
  },
  tabButtonText: {
    fontSize: 14,
    color: '#64748b',
    fontWeight: '500',
  },
  tabButtonTextActive: {
    color: DARK,
    fontWeight: '600',
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
    color: '#64748b',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: DARK,
    marginTop: 16,
  },
  emptyMessage: {
    fontSize: 14,
    color: '#64748b',
    marginTop: 8,
    textAlign: 'center',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  fileIconWrapper: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  fileInfo: {
    flex: 1,
    marginRight: 8,
  },
  fileName: {
    fontSize: 14,
    fontWeight: '500',
    color: DARK,
  },
  fileMeta: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 4,
  },
  downloadBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f0f9ff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  downloadBtnCompleted: {
    backgroundColor: '#f0fdf4',
  },
  downloadBtnDisabled: {
    opacity: 0.5,
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
