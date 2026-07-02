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
  downloadReceivedLibraryItem,
  getReceivedLibraryPreviewUrl,
  isDownloadSavedToPhotos,
  listCurrentClientReceivedLibrary,
  prepareReceivedLibraryPreview,
} from '../services/desktop-local-service';
import { recordDownloadedFile } from '../services/download-records-service';
import {
  canPreviewDocumentFile,
  documentMimeType,
  documentPreviewUri,
  isImageFile,
  isVideoFile,
  openFileWithOtherApp,
} from '../utils/file-preview';
import {
  SIDECAR_HTTP_PORT,
  type BindingStateDTO,
  type ReceivedLibraryItemDTO,
} from '@lynavo-drive/contracts';

type NavigationProp = StackNavigationProp<RootStackParamList, 'PhoneSyncSpace'>;
type PhoneSyncPreviewState = {
  item: ReceivedLibraryItemDTO;
  url: string;
};

function isReceivedFileDeleted(item: ReceivedLibraryItemDTO) {
  return item.fileStatus === 'deleted';
}

export function PhoneSyncSpaceScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [items, setItems] = useState<ReceivedLibraryItemDTO[]>([]);
  const [sortDesc, setSortDesc] = useState(true);
  const [binding, setBinding] = useState<BindingStateDTO | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PhoneSyncPreviewState | null>(null);

  const loadData = useCallback(async () => {
    setLoadError(false);
    try {
      const { NativeSyncEngine } = NativeModules;
      if (!NativeSyncEngine) {
        setItems([]);
        setLoading(false);
        return;
      }

      const bindingState = await NativeSyncEngine.getBindingState();
      setBinding(bindingState);
      if (!bindingState || !bindingState.host) {
        setItems([]);
        setLoading(false);
        return;
      }

      const desktop = { host: bindingState.host, port: SIDECAR_HTTP_PORT };
      const result = await listCurrentClientReceivedLibrary(desktop);
      setItems(result || []);
    } catch (e) {
      console.warn('[PhoneSyncSpaceScreen] Failed to load data:', e);
      setItems([]);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      setLoadError(false);
      loadData();
    }, [loadData]),
  );

  const getFileIcon = (mediaType: string, filename: string) => {
    const isVideo =
      mediaType === 'video' || /\.(mp4|mov|avi|mkv|webm)$/i.test(filename);
    const isImage =
      mediaType === 'image' ||
      /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(filename);
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

  const getFileTypeText = (mediaType: string, filename: string) => {
    const isVideo =
      mediaType === 'video' || /\.(mp4|mov|avi|mkv|webm)$/i.test(filename);
    const isImage =
      mediaType === 'image' ||
      /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(filename);
    if (isVideo) return 'Video';
    if (isImage) return 'Photo';
    return 'File';
  };

  const formatItemTime = (isoString?: string) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return '';

    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    const timeString = date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    if (date.toDateString() === today.toDateString()) {
      return `Today ${timeString}`;
    }
    if (date.toDateString() === yesterday.toDateString()) {
      return `Yesterday ${timeString}`;
    }
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${timeString}`;
  };

  const handleSelect = () => {
    Alert.alert(
      t('sharedFiles.phoneSyncSpace.select') || 'SelectFile',
      t('sharedFiles.phoneSyncSpace.selectFeature') ||
        'This feature is under development',
    );
  };

  const handleDownload = useCallback(
    async (item: ReceivedLibraryItemDTO) => {
      if (downloadingId !== null) return;
      if (isReceivedFileDeleted(item)) return;
      const itemKey = item.fileKey || item.resourceId;
      setDownloadingId(itemKey);

      try {
        const { NativeSyncEngine } = NativeModules;
        const bindingState = await NativeSyncEngine?.getBindingState();
        if (!bindingState || !bindingState.host) {
          Alert.alert(
            t('sharedFiles.deviceUnavailable.title') || 'Device Unavailable',
          );
          return;
        }

        const filename = item.filename || item.displayName;
        const desktop = { host: bindingState.host, port: SIDECAR_HTTP_PORT };
        const result = await downloadReceivedLibraryItem(desktop, item);
        const savedToPhotos = isDownloadSavedToPhotos(result);
        await recordDownloadedFile({
          resourceId: itemKey,
          filename,
          fileSize: item.fileSize,
          mediaType: item.mediaType,
          localPath: result.localPath,
          thumbnailUrl: item.thumbnailUrl,
          previewUrl: item.previewUrl,
          streamUrl: item.streamUrl,
          savedToPhotos,
        });

        Alert.alert(
          t('sharedFiles.dialogs.downloadComplete') || 'Download complete',
          savedToPhotos
            ? t('sharedFiles.dialogs.downloadSavedToPhotos', {
                name: filename,
                location:
                  t('sharedFiles.dialogs.savedLocationPhotos') || 'Photos',
              }) || `${filename} saved to Photos`
            : t('sharedFiles.dialogs.downloadSavedToFiles', {
                name: filename,
              }) || `${filename} saved to Files`,
        );
      } catch (err) {
        console.warn('[PhoneSyncSpaceScreen] Download failed:', err);
        Alert.alert(
          t('sharedFiles.dialogs.downloadFailed') || 'Download Failed',
          t('sharedFiles.dialogs.downloadFailedMessage') ||
            'Could not download the file. Please try again later',
        );
      } finally {
        setDownloadingId(null);
      }
    },
    [downloadingId, t],
  );

  const handleOpenItem = useCallback(
    async (item: ReceivedLibraryItemDTO) => {
      if (isReceivedFileDeleted(item)) return;
      try {
        const { NativeSyncEngine } = NativeModules;
        const bindingState = await NativeSyncEngine?.getBindingState();
        if (!bindingState || !bindingState.host) {
          Alert.alert(
            t('sharedFiles.deviceUnavailable.title') || 'Device Unavailable',
          );
          return;
        }

        const filename = item.filename || item.displayName;
        const desktop = { host: bindingState.host, port: SIDECAR_HTTP_PORT };
        if (
          isImageFile(item.mediaType, filename) ||
          isVideoFile(item.mediaType, filename)
        ) {
          const url = await getReceivedLibraryPreviewUrl(desktop, item);
          setPreview({ item, url });
          return;
        }

        if (!canPreviewDocumentFile(item.mediaType, filename)) {
          try {
            const localPath = await prepareReceivedLibraryPreview(
              desktop,
              item,
            );
            await openFileWithOtherApp(localPath, filename);
          } catch (err) {
            console.warn(
              '[PhoneSyncSpaceScreen] Open with other app failed:',
              err,
            );
            Alert.alert(
              t('sharedFiles.dialogs.previewFailed') || 'Preview Failed',
              t('sharedFiles.dialogs.previewFailedMessage') ||
                'Could not load file preview',
            );
          }
          return;
        }

        const localPath = await prepareReceivedLibraryPreview(desktop, item);
        await viewDocument({
          uri: documentPreviewUri(localPath),
          headerTitle: filename,
          mimeType: documentMimeType(filename),
        });
      } catch (err) {
        console.warn('[PhoneSyncSpaceScreen] Preview failed:', err);
        Alert.alert(
          t('sharedFiles.dialogs.previewFailed') || 'Preview Failed',
          t('sharedFiles.dialogs.previewFailedMessage') ||
            'Could not load file preview',
        );
      }
    },
    [t],
  );

  const sortedItems = [...items].sort((a, b) => {
    const timeA = new Date(a.completedAt).getTime();
    const timeB = new Date(b.completedAt).getTime();
    return sortDesc ? timeB - timeA : timeA - timeB;
  });

  const renderItem = ({ item }: { item: ReceivedLibraryItemDTO }) => {
    const iconConfig = getFileIcon(item.mediaType, item.filename);
    const fileType = getFileTypeText(item.mediaType, item.filename);
    const formattedTime = formatItemTime(item.completedAt);
    const displayName = item.filename || item.displayName;
    const isDownloading = downloadingId === (item.fileKey || item.resourceId);
    const isDeleted = isReceivedFileDeleted(item);

    const desktopName = binding
      ? item.desktopDeviceId === binding.deviceId ||
        (item.desktopDeviceId &&
          (item.desktopDeviceId.includes('-') ||
            item.desktopDeviceId.length > 12))
        ? binding.deviceAlias || binding.deviceName || 'Synced computer'
        : item.desktopDeviceId
      : item.desktopDeviceId || 'Unknown device';

    return (
      <TouchableOpacity
        style={[styles.card, isDeleted && styles.cardDisabled]}
        activeOpacity={0.75}
        onPress={() => handleOpenItem(item)}
        disabled={isDeleted}
        accessibilityRole="button"
        accessibilityLabel="Preview synced file"
        accessibilityState={{ disabled: isDeleted }}
      >
        <View style={[styles.iconWrapper, { backgroundColor: iconConfig.bg }]}>
          <Icon name={iconConfig.name} size={24} color={iconConfig.color} />
        </View>
        <View style={styles.infoWrapper}>
          <Text style={styles.filename} numberOfLines={1}>
            {displayName}
          </Text>
          <View style={styles.metaRow}>
            <Text style={styles.metaText}>
              {`${fileType} - ${formatBytes(item.fileSize)}`}
            </Text>
            <Text style={styles.timeText}>{formattedTime}</Text>
          </View>
        </View>
        <View style={styles.rightWrapper}>
          {item.shareStatus === 'missing' && (
            <View style={styles.missingBadge}>
              <Text style={styles.missingText}>Only exists on computer</Text>
            </View>
          )}
          {isDeleted && (
            <View style={styles.missingBadge}>
              <Text style={styles.missingText}>
                {t('sharedFiles.phoneSyncSpace.desktopDeleted') ||
                  'Deleted on computer'}
              </Text>
            </View>
          )}
          <Text style={styles.deviceText} numberOfLines={1}>
            {desktopName}
          </Text>
          <TouchableOpacity
            style={[
              styles.downloadButton,
              (isDownloading || isDeleted) && styles.downloadButtonDisabled,
            ]}
            onPress={() => handleDownload(item)}
            activeOpacity={0.7}
            disabled={isDeleted || isDownloading || downloadingId !== null}
            accessibilityRole="button"
            accessibilityLabel="Download synced file"
            accessibilityState={{ disabled: isDeleted || isDownloading }}
          >
            {isDownloading ? (
              <ActivityIndicator size="small" color="#3b82f6" />
            ) : (
              <Icon
                name="download-outline"
                size={18}
                color={isDeleted ? '#94a3b8' : '#3b82f6'}
              />
            )}
          </TouchableOpacity>
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
            onPress={() => navigation.goBack()}
            activeOpacity={0.7}
          >
            <Icon name="arrow-back" size={24} color="#1e293b" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {t('sharedFiles.phoneSyncSpace.title') || 'Phone Sync Space'}
          </Text>
          <TouchableOpacity
            style={styles.selectButton}
            onPress={handleSelect}
            activeOpacity={0.7}
          >
            <Text style={styles.selectButtonText}>
              {t('sharedFiles.phoneSyncSpace.select') || 'Select'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Sort Filter Button */}
        <View style={styles.filterBar}>
          <TouchableOpacity
            style={styles.filterButton}
            activeOpacity={0.7}
            onPress={() => setSortDesc(!sortDesc)}
          >
            <Text style={styles.filterButtonText}>
              {sortDesc ? 'Time ⬇' : 'Time ⬆'}
            </Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color="#3b82f6" />
          </View>
        ) : loadError ? (
          <View style={styles.centered}>
            <Icon name="alert-circle-outline" size={48} color="#ef4444" />
            <Text style={styles.emptyText}>
              {t('sharedFiles.networkError.title') || 'Failed to Load'}
            </Text>
            <Text style={styles.errorSubtitle}>
              {t('sharedFiles.networkError.message') ||
                'Please try again later'}
            </Text>
          </View>
        ) : sortedItems.length === 0 ? (
          <View style={styles.centered}>
            <Icon name="folder-open-outline" size={48} color="#94a3b8" />
            <Text style={styles.emptyText}>
              {t('sharedFiles.phoneSyncSpace.empty') || 'No synced files yet'}
            </Text>
          </View>
        ) : (
          <FlatList
            data={sortedItems}
            keyExtractor={item => item.fileKey || item.resourceId}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />
        )}
      </SafeAreaView>
      <PhoneSyncPreviewModal
        preview={preview}
        onClose={() => setPreview(null)}
      />
      <BottomTabBar activeTab="files" />
    </GradientBackground>
  );
}

function PhoneSyncPreviewModal({
  preview,
  onClose,
}: {
  preview: PhoneSyncPreviewState | null;
  onClose: () => void;
}) {
  if (!preview) return null;

  const filename = preview.item.filename || preview.item.displayName;
  const video = isVideoFile(preview.item.mediaType, filename);

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
            {filename}
          </Text>
          <TouchableOpacity
            style={styles.previewCloseButton}
            accessibilityRole="button"
            accessibilityLabel="Close Preview"
            activeOpacity={0.7}
            onPress={onClose}
          >
            <Icon name="close" size={18} color="#ffffff" />
          </TouchableOpacity>
        </View>
        <View style={styles.previewBody}>
          {video ? (
            <Video
              testID="phone-sync-preview-video"
              source={{ uri: preview.url }}
              style={styles.previewMedia}
              resizeMode="contain"
              controls
              paused={false}
              muted={false}
            />
          ) : (
            <Image
              testID="phone-sync-preview-image"
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
  filterBar: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    alignItems: 'flex-start',
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
  errorSubtitle: {
    marginTop: 6,
    fontSize: 13,
    color: '#94a3b8',
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
  cardDisabled: {
    opacity: 0.72,
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
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metaText: {
    fontSize: 12,
    color: '#64748b',
    marginRight: 8,
  },
  timeText: {
    fontSize: 12,
    color: '#94a3b8',
  },
  rightWrapper: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  deviceText: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '500',
    marginTop: 4,
    maxWidth: 90,
  },
  downloadButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(59, 130, 246, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  downloadButtonDisabled: {
    backgroundColor: 'rgba(148, 163, 184, 0.08)',
  },
  missingBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
  },
  missingText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#ef4444',
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
