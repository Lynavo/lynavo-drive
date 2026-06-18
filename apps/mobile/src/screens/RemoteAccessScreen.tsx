import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Image,
  Modal,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  NativeModules,
} from 'react-native';
import { viewDocument } from '@react-native-documents/viewer';
import Video from 'react-native-video';
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
import {
  listSharedResources,
  listSharedFolderContents,
  downloadResource,
  getResourcePreviewUrl,
  prepareResourcePreview,
  shareResources,
} from '../services/desktop-local-service';
import { recordDownloadedFile } from '../services/download-records-service';
import type {
  DesktopSharedResourceDTO,
  DirectoryFileDTO,
} from '@syncflow/contracts';
import {
  canPreviewDocumentFile,
  documentMimeType,
  documentPreviewUri,
  isImageFile,
  isVideoFile,
  openFileWithOtherApp,
} from '../utils/file-preview';

type NavigationProp = StackNavigationProp<RootStackParamList, 'RemoteAccess'>;

interface RemoteAccessItem {
  resourceId: string;
  displayName: string;
  kind: 'shared_file' | 'shared_folder';
  fileSize?: number;
  mediaType?: string;
  thumbnailUrl?: string;
  previewUrl?: string;
  streamUrl?: string;
  rootResourceId?: string;
  remotePath?: string;
}

type RemoteAccessIconConfig = {
  name: string;
  color: string;
  bg: string;
};

type RemoteAccessResourceDTO = DesktopSharedResourceDTO & {
  thumbnailUrl?: string;
  previewUrl?: string;
  streamUrl?: string;
};

interface RemotePreviewState {
  item: RemoteAccessItem;
  url: string;
}

const SHARED_DIRECTORY_RESOURCE_PREFIX = 'shared-dir:';

function sharedResourceToRemoteItem(
  resource: RemoteAccessResourceDTO,
): RemoteAccessItem | null {
  if (resource.kind !== 'shared_file' && resource.kind !== 'shared_folder') {
    return null;
  }

  return {
    resourceId: resource.resourceId,
    displayName: resource.displayName,
    kind: resource.kind,
    fileSize: resource.fileSize,
    mediaType: resource.mediaType,
    thumbnailUrl: resource.thumbnailUrl,
    previewUrl: resource.previewUrl,
    streamUrl: resource.streamUrl,
  };
}

function encodeRemotePath(path: string): string {
  return path
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(segment => segment.trim().length > 0)
    .map(segment => encodeURIComponent(segment))
    .join('/');
}

function directoryFileToRemoteItem(
  file: DirectoryFileDTO,
  folder: RemoteAccessItem,
): RemoteAccessItem {
  const isSharedDirectory = folder.resourceId.startsWith(
    SHARED_DIRECTORY_RESOURCE_PREFIX,
  );
  const rootResourceId = folder.rootResourceId ?? folder.resourceId;
  const resourceId = isSharedDirectory
    ? `${SHARED_DIRECTORY_RESOURCE_PREFIX}${encodeRemotePath(file.path)}`
    : `shared-folder-entry:${rootResourceId}:${file.path}`;
  return {
    resourceId,
    displayName: file.name,
    kind: file.isDirectory ? 'shared_folder' : 'shared_file',
    fileSize: file.isDirectory ? undefined : file.size,
    mediaType: file.isDirectory ? undefined : file.type,
    thumbnailUrl: file.isDirectory ? undefined : file.thumbnailUrl,
    previewUrl: file.isDirectory ? undefined : file.streamUrl,
    streamUrl: file.isDirectory ? undefined : file.streamUrl,
    rootResourceId: isSharedDirectory ? resourceId : rootResourceId,
    remotePath: isSharedDirectory ? '' : file.path,
  };
}

export function RemoteAccessScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [rootItems, setRootItems] = useState<RemoteAccessItem[]>([]);
  const [folderItems, setFolderItems] = useState<RemoteAccessItem[]>([]);
  const [currentFolder, setCurrentFolder] = useState<RemoteAccessItem | null>(
    null,
  );
  const [folderHistory, setFolderHistory] = useState<RemoteAccessItem[]>([]);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [sharing, setSharing] = useState(false);
  const [sortDesc, setSortDesc] = useState(true);
  const [preview, setPreview] = useState<RemotePreviewState | null>(null);

  const getBoundDesktop = useCallback(async () => {
    const { NativeSyncEngine } = NativeModules;
    if (!NativeSyncEngine) return null;
    const binding = await NativeSyncEngine.getBindingState();
    if (!binding || !binding.host) return null;
    return { host: binding.host, port: 39394 };
  }, []);

  const loadData = useCallback(async () => {
    try {
      const desktop = await getBoundDesktop();
      if (!desktop) {
        setRootItems([]);
        setFolderItems([]);
        setCurrentFolder(null);
        setFolderHistory([]);
        setSelectionMode(false);
        setSelectedIds(new Set());
        setLoading(false);
        return;
      }

      const result = await listSharedResources(desktop);
      setRootItems(
        (result || []).flatMap(resource => {
          const item = sharedResourceToRemoteItem(resource);
          return item ? [item] : [];
        }),
      );
      setFolderItems([]);
      setCurrentFolder(null);
      setFolderHistory([]);
      setSelectionMode(false);
      setSelectedIds(new Set());
    } catch (e) {
      console.warn('[RemoteAccessScreen] Failed to load data:', e);
    } finally {
      setLoading(false);
    }
  }, [getBoundDesktop]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      loadData();
    }, [loadData]),
  );

  const currentItems = currentFolder ? folderItems : rootItems;

  const handleDownload = useCallback(
    async (item: RemoteAccessItem) => {
      const { resourceId, displayName: filename } = item;
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

        // Keep 「最近下載」 in sync with remote-access downloads.
        await recordDownloadedFile({
          resourceId,
          filename,
          fileSize: item.fileSize,
          mediaType: item.mediaType,
          localPath: null,
          thumbnailUrl: item.thumbnailUrl,
          previewUrl: item.previewUrl,
          streamUrl: item.streamUrl,
          savedToPhotos: false,
        });

        const isPhotoOrVideo =
          isImageFile(item.mediaType, filename) ||
          isVideoFile(item.mediaType, filename);

        Alert.alert(
          t('sharedFiles.dialogs.downloadComplete') || '下載完成',
          isPhotoOrVideo
            ? t('sharedFiles.dialogs.downloadSavedToPhotos', {
                name: filename,
                location:
                  t('sharedFiles.dialogs.savedLocationPhotos') || '相簿',
              }) || `${filename} 已儲存至相簿`
            : t('sharedFiles.dialogs.downloadSavedToFiles', {
                name: filename,
              }) || `${filename} 已保存到文件`,
        );
      } catch (err) {
        console.warn('[RemoteAccessScreen] Download failed:', err);
        Alert.alert(
          t('sharedFiles.dialogs.downloadFailed') || '下載失敗',
          t('sharedFiles.dialogs.downloadFailedMessage') ||
            '無法下載檔案，請稍後重試',
        );
      } finally {
        setDownloadingId(null);
      }
    },
    [downloadingId, t],
  );

  const handleSelect = useCallback(() => {
    setSelectionMode(prev => {
      if (prev) {
        setSelectedIds(new Set());
        return false;
      }
      return true;
    });
  }, []);

  const toggleSelected = useCallback((resourceId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(resourceId)) {
        next.delete(resourceId);
      } else {
        next.add(resourceId);
      }
      return next;
    });
  }, []);

  const handleSelectedDownload = useCallback(async () => {
    if (downloadingId) return;
    const selectedFiles = currentItems.filter(
      item => selectedIds.has(item.resourceId) && item.kind === 'shared_file',
    );
    for (const item of selectedFiles) {
      await handleDownload(item);
    }
  }, [currentItems, downloadingId, handleDownload, selectedIds]);

  const handleShareSelected = useCallback(async () => {
    if (sharing) return;
    const selectedFiles = currentItems.filter(
      item => selectedIds.has(item.resourceId) && item.kind === 'shared_file',
    );
    if (selectedFiles.length === 0) {
      Alert.alert(
        t('sharedFiles.remoteAccess.shareNoSelectionTitle') || '尚未選擇檔案',
        t('sharedFiles.remoteAccess.shareNoSelectionMessage') ||
          '請先選擇要分享的檔案',
      );
      return;
    }

    setSharing(true);
    try {
      const desktop = await getBoundDesktop();
      if (!desktop) {
        Alert.alert(t('sharedFiles.deviceUnavailable.title') || '設備不可用');
        return;
      }
      await shareResources(
        desktop,
        selectedFiles.map(item => ({
          resourceId: item.resourceId,
          displayName: item.displayName,
        })),
      );
      setSelectionMode(false);
      setSelectedIds(new Set());
    } catch (err) {
      console.warn('[RemoteAccessScreen] Share failed:', err);
      Alert.alert(
        t('sharedFiles.remoteAccess.shareFailedTitle') || '分享失敗',
        t('sharedFiles.remoteAccess.shareFailedMessage') ||
          '無法開啟系統分享，請稍後重試',
      );
    } finally {
      setSharing(false);
    }
  }, [currentItems, getBoundDesktop, selectedIds, sharing, t]);

  const handleOpenFile = useCallback(
    async (item: RemoteAccessItem) => {
      if (item.kind !== 'shared_file') return;

      try {
        const desktop = await getBoundDesktop();
        if (!desktop) {
          Alert.alert(t('sharedFiles.deviceUnavailable.title') || '設備不可用');
          return;
        }

        if (
          isImageFile(item.mediaType, item.displayName) ||
          isVideoFile(item.mediaType, item.displayName)
        ) {
          const url = await getResourcePreviewUrl(desktop, item.resourceId);
          setPreview({ item, url });
          return;
        }

        if (!canPreviewDocumentFile(item.mediaType, item.displayName)) {
          try {
            const localPath = await prepareResourcePreview(
              desktop,
              item.resourceId,
              item.displayName,
            );
            await openFileWithOtherApp(localPath, item.displayName);
          } catch (err) {
            console.warn(
              '[RemoteAccessScreen] Open with other app failed:',
              err,
            );
            Alert.alert(
              t('sharedFiles.dialogs.previewFailed') || '預覽失敗',
              t('sharedFiles.dialogs.previewFailedMessage') ||
                '無法取得檔案預覽',
            );
          }
          return;
        }

        const localPath = await prepareResourcePreview(
          desktop,
          item.resourceId,
          item.displayName,
        );
        await viewDocument({
          uri: documentPreviewUri(localPath),
          headerTitle: item.displayName,
          mimeType: documentMimeType(item.displayName),
        });
      } catch (err) {
        console.warn('[RemoteAccessScreen] Preview failed:', err);
        Alert.alert(
          t('sharedFiles.dialogs.previewFailed') || '預覽失敗',
          t('sharedFiles.dialogs.previewFailedMessage') || '無法取得檔案預覽',
        );
      }
    },
    [getBoundDesktop, t],
  );

  const navigateIntoFolder = useCallback(
    async (folder: RemoteAccessItem) => {
      const desktop = await getBoundDesktop();
      if (!desktop) {
        setFolderItems([]);
        return;
      }

      setLoading(true);
      try {
        const rootResourceId = folder.rootResourceId ?? folder.resourceId;
        const listing = await listSharedFolderContents(
          desktop,
          rootResourceId,
          folder.remotePath ?? '',
        );
        setFolderItems(
          listing.files.map(file => directoryFileToRemoteItem(file, folder)),
        );
        setSelectedIds(new Set());
        if (currentFolder) {
          setFolderHistory(prev => [...prev, currentFolder]);
        }
        setCurrentFolder(folder);
      } catch (e) {
        console.warn('[RemoteAccessScreen] Failed to load folder contents:', e);
        setFolderItems([]);
      } finally {
        setLoading(false);
      }
    },
    [currentFolder, getBoundDesktop],
  );

  const reloadFolder = useCallback(
    async (folder: RemoteAccessItem) => {
      const desktop = await getBoundDesktop();
      if (!desktop) {
        setFolderItems([]);
        return;
      }
      setLoading(true);
      try {
        const listing = await listSharedFolderContents(
          desktop,
          folder.rootResourceId ?? folder.resourceId,
          folder.remotePath ?? '',
        );
        setFolderItems(
          listing.files.map(file => directoryFileToRemoteItem(file, folder)),
        );
        setSelectedIds(new Set());
      } catch (e) {
        console.warn(
          '[RemoteAccessScreen] Failed to reload folder contents:',
          e,
        );
        setFolderItems([]);
      } finally {
        setLoading(false);
      }
    },
    [getBoundDesktop],
  );

  const navigateBackFolder = () => {
    if (folderHistory.length > 0) {
      const prev = folderHistory[folderHistory.length - 1];
      setFolderHistory(folderHistory.slice(0, -1));
      setCurrentFolder(prev);
      setSelectedIds(new Set());
      void reloadFolder(prev);
    } else {
      setCurrentFolder(null);
      setFolderItems([]);
      setSelectedIds(new Set());
    }
  };

  const getFileIcon = (kind: string, mediaType?: string, filename?: string) => {
    if (kind === 'shared_folder') {
      return { name: 'folder', color: '#eab308', bg: 'rgba(234,179,8,0.08)' };
    }
    const isVideo =
      mediaType === 'video' ||
      (filename && /\.(mp4|mov|avi|mkv|webm)$/i.test(filename));
    const isImage =
      mediaType === 'image' ||
      (filename && /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(filename));
    if (isVideo) {
      return { name: 'play', color: '#8b5cf6', bg: 'rgba(139,92,246,0.08)' };
    }
    if (isImage) {
      return { name: 'image', color: '#3b82f6', bg: 'rgba(59,130,246,0.08)' };
    }
    return {
      name: 'document-text',
      color: '#10b981',
      bg: 'rgba(16,185,129,0.08)',
    };
  };

  const sortedItems = [...currentItems].sort((a, b) => {
    const nameA = a.displayName.toLowerCase();
    const nameB = b.displayName.toLowerCase();
    // Folders always sorted first
    if (a.kind === 'shared_folder' && b.kind !== 'shared_folder') return -1;
    if (a.kind !== 'shared_folder' && b.kind === 'shared_folder') return 1;
    return sortDesc ? nameB.localeCompare(nameA) : nameA.localeCompare(nameB);
  });

  const renderItem = ({ item }: { item: RemoteAccessItem }) => {
    const iconConfig = getFileIcon(item.kind, item.mediaType, item.displayName);
    const isFolder = item.kind === 'shared_folder';
    const isDownloading = downloadingId === item.resourceId;
    const isSelected = selectedIds.has(item.resourceId);

    return (
      <TouchableOpacity
        style={[styles.card, isSelected && styles.cardSelected]}
        activeOpacity={isFolder || selectionMode ? 0.7 : 1}
        onPress={() => {
          if (selectionMode && !isFolder) {
            toggleSelected(item.resourceId);
            return;
          }
          if (isFolder) {
            void navigateIntoFolder(item);
            return;
          }
          void handleOpenFile(item);
        }}
      >
        <RemoteAccessThumbnail item={item} iconConfig={iconConfig} />
        <View style={styles.infoWrapper}>
          <Text style={styles.filename} numberOfLines={1}>
            {item.displayName}
          </Text>
          {!isFolder && item.fileSize && (
            <Text style={styles.metaText}>{formatBytes(item.fileSize)}</Text>
          )}
        </View>
        <View style={styles.rightWrapper}>
          {selectionMode ? (
            <View
              style={[
                styles.selectionCircle,
                isSelected && styles.selectionCircleSelected,
                isFolder && styles.selectionCircleDisabled,
              ]}
            >
              {isSelected && (
                <Icon name="checkmark" size={14} color="#ffffff" />
              )}
            </View>
          ) : isFolder ? (
            <Icon name="chevron-forward" size={20} color="#94a3b8" />
          ) : (
            <TouchableOpacity
              style={[
                styles.downloadButton,
                isDownloading && styles.downloadButtonDisabled,
              ]}
              onPress={() => handleDownload(item)}
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
            {currentFolder
              ? `${currentFolder.displayName}`
              : t('sharedFiles.remoteAccess.title') || '遠端訪問電腦'}
          </Text>
          <TouchableOpacity
            style={styles.selectButton}
            onPress={handleSelect}
            activeOpacity={0.7}
          >
            <Text style={styles.selectButtonText}>
              {selectionMode
                ? t('sharedFiles.remoteAccess.done') || '完成'
                : t('sharedFiles.remoteAccess.select') || '選擇'}
            </Text>
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
            <Text style={styles.emptyText}>
              {t('sharedFiles.remoteAccess.empty') || '此資料夾為空'}
            </Text>
          </View>
        ) : (
          <FlatList
            data={sortedItems}
            keyExtractor={item => item.resourceId}
            renderItem={renderItem}
            contentContainerStyle={[
              styles.listContent,
              selectionMode && styles.listContentSelecting,
            ]}
            showsVerticalScrollIndicator={false}
          />
        )}
        {selectionMode && (
          <View style={styles.selectionBar}>
            <Text style={styles.selectionCount}>
              {t('sharedFiles.remoteAccess.selectedCount', {
                count: selectedIds.size,
              }) || `已選擇 ${selectedIds.size} 個`}
            </Text>
            <View style={styles.selectionActions}>
              <TouchableOpacity
                style={[
                  styles.selectionDownloadButton,
                  (selectedIds.size === 0 || downloadingId) &&
                    styles.selectionDownloadButtonDisabled,
                ]}
                activeOpacity={0.75}
                disabled={selectedIds.size === 0 || downloadingId !== null}
                onPress={handleSelectedDownload}
              >
                {downloadingId ? (
                  <ActivityIndicator size="small" color="#2563eb" />
                ) : (
                  <>
                    <Icon name="download-outline" size={17} color="#2563eb" />
                    <Text style={styles.selectionDownloadButtonText}>
                      {t('sharedFiles.remoteAccess.download') || '下載'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.shareButton,
                  (selectedIds.size === 0 || sharing) &&
                    styles.shareButtonDisabled,
                ]}
                activeOpacity={0.75}
                disabled={selectedIds.size === 0 || sharing}
                onPress={handleShareSelected}
              >
                {sharing ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <>
                    <Icon name="share-outline" size={17} color="#ffffff" />
                    <Text style={styles.shareButtonText}>
                      {t('sharedFiles.remoteAccess.share') || '分享'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}
      </SafeAreaView>
      <RemoteAccessPreviewModal
        preview={preview}
        onClose={() => setPreview(null)}
      />
      <BottomTabBar activeTab="files" />
    </GradientBackground>
  );
}

function RemoteAccessThumbnail({
  item,
  iconConfig,
}: {
  item: RemoteAccessItem;
  iconConfig: RemoteAccessIconConfig;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const imagePreviewUrl =
    item.thumbnailUrl || item.previewUrl || item.streamUrl;
  const videoPreviewUrl = item.streamUrl || item.previewUrl;

  if (
    item.kind !== 'shared_folder' &&
    isImageFile(item.mediaType, item.displayName) &&
    imagePreviewUrl &&
    !imageFailed
  ) {
    return (
      <View style={[styles.iconWrapper, styles.thumbnailWrapper]}>
        <Image
          testID="remote-access-thumbnail-image"
          source={{ uri: imagePreviewUrl }}
          style={styles.thumbnailMedia}
          resizeMode="cover"
          accessibilityLabel={`${item.displayName} 縮圖`}
          onError={() => setImageFailed(true)}
        />
      </View>
    );
  }

  if (
    item.kind !== 'shared_folder' &&
    isVideoFile(item.mediaType, item.displayName) &&
    videoPreviewUrl &&
    !videoFailed
  ) {
    return (
      <View style={[styles.iconWrapper, styles.thumbnailWrapper]}>
        <Video
          testID="remote-access-thumbnail-video"
          source={{ uri: videoPreviewUrl }}
          style={styles.thumbnailMedia}
          resizeMode="cover"
          paused
          muted
          repeat={false}
          onError={() => setVideoFailed(true)}
        />
        <View style={styles.thumbnailPlayBadge}>
          <Icon name="play" size={10} color="#ffffff" />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.iconWrapper, { backgroundColor: iconConfig.bg }]}>
      <Icon name={iconConfig.name} size={24} color={iconConfig.color} />
    </View>
  );
}

function RemoteAccessPreviewModal({
  preview,
  onClose,
}: {
  preview: RemotePreviewState | null;
  onClose: () => void;
}) {
  if (!preview) return null;

  const video = isVideoFile(preview.item.mediaType, preview.item.displayName);

  return (
    <Modal
      animationType="fade"
      presentationStyle="fullScreen"
      visible={preview != null}
      onRequestClose={onClose}
    >
      <View style={styles.previewModalRoot}>
        <View style={styles.previewHeader}>
          <Text style={styles.previewTitle} numberOfLines={1}>
            {preview.item.displayName}
          </Text>
          <TouchableOpacity
            style={styles.previewCloseButton}
            accessibilityRole="button"
            accessibilityLabel="關閉預覽"
            activeOpacity={0.7}
            onPress={onClose}
          >
            <Icon name="close" size={18} color="#ffffff" />
          </TouchableOpacity>
        </View>
        <View style={styles.previewBody}>
          {video ? (
            <Video
              testID="remote-access-preview-video"
              source={{ uri: preview.url }}
              style={styles.previewMedia}
              resizeMode="contain"
              controls
              paused={false}
              muted={false}
            />
          ) : (
            <Image
              testID="remote-access-preview-image"
              source={{ uri: preview.url }}
              style={styles.previewMedia}
              resizeMode="contain"
            />
          )}
        </View>
      </View>
    </Modal>
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
  listContentSelecting: {
    paddingBottom: 172,
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
  cardSelected: {
    borderWidth: 1,
    borderColor: '#3b82f6',
    backgroundColor: '#eff6ff',
  },
  iconWrapper: {
    width: 48,
    height: 48,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbnailWrapper: {
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: '#e2e8f0',
  },
  thumbnailMedia: {
    width: '100%',
    height: '100%',
  },
  thumbnailPlayBadge: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
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
  selectionCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  selectionCircleSelected: {
    borderColor: '#3b82f6',
    backgroundColor: '#3b82f6',
  },
  selectionCircleDisabled: {
    opacity: 0.35,
  },
  selectionBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 92,
    minHeight: 56,
    borderRadius: 18,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dbeafe',
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 5,
  },
  selectionCount: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
  },
  selectionActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  selectionDownloadButton: {
    minWidth: 88,
    height: 40,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: '#eff6ff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
  },
  selectionDownloadButtonDisabled: {
    borderColor: '#cbd5e1',
    backgroundColor: '#f1f5f9',
  },
  selectionDownloadButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#2563eb',
  },
  shareButton: {
    minWidth: 96,
    height: 40,
    borderRadius: 14,
    backgroundColor: '#2563eb',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 14,
  },
  shareButtonDisabled: {
    backgroundColor: '#94a3b8',
  },
  shareButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
  },
  previewModalRoot: {
    flex: 1,
    backgroundColor: '#000000',
  },
  previewHeader: {
    minHeight: 84,
    paddingHorizontal: 16,
    paddingTop: 46,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  previewTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  previewCloseButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  previewBody: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewMedia: {
    width: '100%',
    height: '100%',
  },
});
