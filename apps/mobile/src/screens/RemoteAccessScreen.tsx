import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  NativeModules,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useTranslation } from 'react-i18next';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { colors } from '../theme/colors';
import { formatBytes } from '../utils/format';
import { Icon } from '../components/Icon';
import { GradientBackground } from '../components/GradientBackground';
import { BottomTabBar } from '../components/BottomTabBar';
import { listSharedResources, downloadResource } from '../services/desktop-local-service';
import type { DesktopSharedResourceDTO } from '@syncflow/contracts';

type NavigationProp = StackNavigationProp<RootStackParamList, 'RemoteAccess'>;

interface MockFile {
  resourceId: string;
  displayName: string;
  kind: 'shared_file' | 'shared_folder';
  fileSize?: number;
  mediaType?: string;
}

const MOCK_FOLDER_CONTENTS: Record<string, MockFile[]> = {
  'Projects': [
    { resourceId: 'mock-proj-1', displayName: 'vividrop-presentation.pdf', kind: 'shared_file', fileSize: 13002342, mediaType: 'document' },
    { resourceId: 'mock-proj-2', displayName: 'SourceCode.zip', kind: 'shared_file', fileSize: 47392100, mediaType: 'document' },
    { resourceId: 'mock-proj-3', displayName: 'Design-v2.fig', kind: 'shared_file', fileSize: 3984512, mediaType: 'document' },
    { resourceId: 'mock-proj-sub', displayName: 'Archive', kind: 'shared_folder' },
  ],
  'Photos': [
    { resourceId: 'mock-photo-1', displayName: 'family_gathering.jpg', kind: 'shared_file', fileSize: 2516582, mediaType: 'image' },
    { resourceId: 'mock-photo-2', displayName: 'summer_vacation.mp4', kind: 'shared_file', fileSize: 130023420, mediaType: 'video' },
    { resourceId: 'mock-photo-3', displayName: 'profile_picture.png', kind: 'shared_file', fileSize: 1048576, mediaType: 'image' },
  ],
  'Archive': [
    { resourceId: 'mock-arc-1', displayName: 'old-backup.tar.gz', kind: 'shared_file', fileSize: 104857600, mediaType: 'document' },
  ]
};

export function RemoteAccessScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [rootItems, setRootItems] = useState<DesktopSharedResourceDTO[]>([]);
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [folderHistory, setFolderHistory] = useState<string[]>([]);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [sortDesc, setSortDesc] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const { NativeSyncEngine } = NativeModules;
      if (!NativeSyncEngine) {
        setLoading(false);
        return;
      }

      const binding = await NativeSyncEngine.getBindingState();
      if (!binding || !binding.host) {
        setRootItems([]);
        setLoading(false);
        return;
      }

      const desktop = { host: binding.host, port: 39394 };
      const result = await listSharedResources(desktop);
      setRootItems(result || []);
    } catch (e) {
      console.warn('[RemoteAccessScreen] Failed to load data:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      loadData();
    }, [loadData])
  );

  const handleDownload = useCallback(
    async (resourceId: string, filename: string) => {
      if (downloadingId) return;
      setDownloadingId(resourceId);

      try {
        const { NativeSyncEngine } = NativeModules;
        const binding = await NativeSyncEngine?.getBindingState();
        if (!binding || !binding.host) {
          Alert.alert(t('sharedFiles.deviceUnavailable.title') || '設備不可用');
          return;
        }

        const desktop = { host: binding.host, port: 39394 };
        await downloadResource(desktop, resourceId);

        Alert.alert(
          t('sharedFiles.dialogs.downloadComplete') || '下載完成',
          t('sharedFiles.dialogs.downloadSavedToPhotos', { name: filename }) ||
            `${filename} 已儲存至相簿`
        );
      } catch (err) {
        console.warn('[RemoteAccessScreen] Download failed:', err);
        Alert.alert(
          t('sharedFiles.dialogs.downloadFailed') || '下載失敗',
          t('sharedFiles.dialogs.downloadFailedMessage') ||
            '無法下載檔案，請稍後重試'
        );
      } finally {
        setDownloadingId(null);
      }
    },
    [downloadingId, t]
  );

  const handleSelect = () => {
    Alert.alert(t('sharedFiles.remoteAccess.select') || '選擇檔案', t('sharedFiles.remoteAccess.selectFeature') || '該功能正在開發中');
  };

  const navigateIntoFolder = (folderName: string) => {
    if (currentFolder) {
      setFolderHistory([...folderHistory, currentFolder]);
    }
    setCurrentFolder(folderName);
  };

  const navigateBackFolder = () => {
    if (folderHistory.length > 0) {
      const prev = folderHistory[folderHistory.length - 1];
      setFolderHistory(folderHistory.slice(0, -1));
      setCurrentFolder(prev);
    } else {
      setCurrentFolder(null);
    }
  };

  const getFileIcon = (kind: string, mediaType?: string, filename?: string) => {
    if (kind === 'shared_folder') {
      return { name: 'folder', color: '#eab308', bg: 'rgba(234,179,8,0.08)' };
    }
    const isVideo = mediaType === 'video' || (filename && /\.(mp4|mov|avi|mkv|webm)$/i.test(filename));
    const isImage = mediaType === 'image' || (filename && /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(filename));
    if (isVideo) {
      return { name: 'play', color: '#8b5cf6', bg: 'rgba(139,92,246,0.08)' };
    }
    if (isImage) {
      return { name: 'image', color: '#3b82f6', bg: 'rgba(59,130,246,0.08)' };
    }
    return { name: 'document-text', color: '#10b981', bg: 'rgba(16,185,129,0.08)' };
  };

  const currentItems = currentFolder
    ? (MOCK_FOLDER_CONTENTS[currentFolder] || [])
    : rootItems;

  const sortedItems = [...currentItems].sort((a, b) => {
    const nameA = a.displayName.toLowerCase();
    const nameB = b.displayName.toLowerCase();
    // Folders always sorted first
    if (a.kind === 'shared_folder' && b.kind !== 'shared_folder') return -1;
    if (a.kind !== 'shared_folder' && b.kind === 'shared_folder') return 1;
    return sortDesc ? nameB.localeCompare(nameA) : nameA.localeCompare(nameB);
  });

  const renderItem = ({ item }: { item: MockFile | DesktopSharedResourceDTO }) => {
    const iconConfig = getFileIcon(item.kind, item.mediaType, item.displayName);
    const isFolder = item.kind === 'shared_folder';
    const isDownloading = downloadingId === item.resourceId;

    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={isFolder ? 0.7 : 1}
        onPress={() => {
          if (isFolder) {
            navigateIntoFolder(item.displayName);
          }
        }}
      >
        <View style={[styles.iconWrapper, { backgroundColor: iconConfig.bg }]}>
          <Icon name={iconConfig.name} size={24} color={iconConfig.color} />
        </View>
        <View style={styles.infoWrapper}>
          <Text style={styles.filename} numberOfLines={1}>
            {item.displayName}
          </Text>
          {!isFolder && item.fileSize && (
            <Text style={styles.metaText}>
              {formatBytes(item.fileSize)}
            </Text>
          )}
        </View>
        <View style={styles.rightWrapper}>
          {isFolder ? (
            <Icon name="chevron-forward" size={20} color="#94a3b8" />
          ) : (
            <TouchableOpacity
              style={[styles.downloadButton, isDownloading && styles.downloadButtonDisabled]}
              onPress={() => handleDownload(item.resourceId, item.displayName)}
              activeOpacity={0.7}
              disabled={isDownloading}
            >
              {isDownloading ? (
                <ActivityIndicator size="small" color="#3b82f6" />
              ) : (
                <Icon name="download-outline" size={18} color="#3b82f6" />
              )}
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <GradientBackground>
      <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
        {/* Top bar */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => {
              if (currentFolder) {
                navigateBackFolder();
              } else {
                navigation.goBack();
              }
            }}
            activeOpacity={0.7}
          >
            <Icon name="arrow-back" size={24} color="#1e293b" />
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {currentFolder ? `${currentFolder}` : (t('sharedFiles.remoteAccess.title') || '遠端訪問電腦')}
          </Text>
          <TouchableOpacity
            style={styles.selectButton}
            onPress={handleSelect}
            activeOpacity={0.7}
          >
            <Text style={styles.selectButtonText}>{t('sharedFiles.remoteAccess.select') || '選擇'}</Text>
          </TouchableOpacity>
        </View>

        {/* Action Panel for navigation & sorting */}
        <View style={styles.actionPanel}>
          <TouchableOpacity
            style={styles.filterButton}
            activeOpacity={0.7}
            onPress={() => setSortDesc(!sortDesc)}
          >
            <Text style={styles.filterButtonText}>
              {sortDesc ? '名稱 ⬇' : '名稱 ⬆'}
            </Text>
          </TouchableOpacity>

          {currentFolder && (
            <TouchableOpacity
              style={styles.upButton}
              activeOpacity={0.7}
              onPress={navigateBackFolder}
            >
              <Icon name="arrow-up" size={14} color="#475569" />
              <Text style={styles.upButtonText}>返回上級</Text>
            </TouchableOpacity>
          )}
        </View>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color="#3b82f6" />
          </View>
        ) : sortedItems.length === 0 ? (
          <View style={styles.centered}>
            <Icon name="folder-open-outline" size={48} color="#94a3b8" />
            <Text style={styles.emptyText}>{t('sharedFiles.remoteAccess.empty') || '此資料夾為空'}</Text>
          </View>
        ) : (
          <FlatList
            data={sortedItems}
            keyExtractor={item => item.resourceId}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />
        )}
      </SafeAreaView>
      <BottomTabBar activeTab="files" />
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginTop: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0f172a',
    flex: 1,
    textAlign: 'center',
    marginHorizontal: 12,
  },
  selectButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: 'rgba(59, 130, 246, 0.08)',
  },
  selectButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#3b82f6',
  },
  actionPanel: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  filterButton: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  filterButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  upButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(71, 85, 105, 0.08)',
  },
  upButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 80,
  },
  emptyText: {
    marginTop: 12,
    fontSize: 15,
    color: '#64748b',
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 100,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 1.5,
  },
  iconWrapper: {
    width: 48,
    height: 48,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoWrapper: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  filename: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1e293b',
    marginBottom: 4,
  },
  metaText: {
    fontSize: 12,
    color: '#64748b',
  },
  rightWrapper: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  downloadButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(59, 130, 246, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  downloadButtonDisabled: {
    backgroundColor: 'rgba(148, 163, 184, 0.08)',
  },
});
