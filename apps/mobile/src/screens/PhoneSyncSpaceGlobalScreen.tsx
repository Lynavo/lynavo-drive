import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  NativeModules,
  Platform,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { viewDocument } from '@react-native-documents/viewer';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useTranslation } from 'react-i18next';
import Video from 'react-native-video';
import {
  Check,
  ChevronLeft,
  CloudUpload,
  Download,
  Eye,
  FileImage,
  FileText,
  Play,
  Rows3,
  X,
} from 'lucide-react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { SIDECAR_HTTP_PORT, type BindingStateDTO } from '@syncflow/contracts';

import type { RootStackParamList } from '../navigation/RootNavigator';
import { colors } from '../theme/globalColors';
import { androidBoxShadow } from '../utils/androidShadow';
import { formatBytes } from '../utils/format';
import { GlobalGradientBackground } from '../components/GlobalGradientBackground';
import { ModalBlurBackdrop } from '../components/shared/ModalBlurBackdrop';
import {
  type DesktopInfo,
  downloadReceivedLibraryItem,
  getReceivedLibraryPreviewUrl,
  isDownloadSavedLocally,
  isDownloadSavedToPhotos,
  listCurrentClientReceivedLibraryPage,
  prepareReceivedLibraryPreview,
  type ReceivedLibraryMediaPage,
  type ReceivedLibraryMediaItem,
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

type NavigationProp = StackNavigationProp<RootStackParamList, 'PhoneSyncSpace'>;
type ReceivedSection = {
  title: string;
  key: string;
  data: ReceivedLibraryMediaItem[];
};
type SortKey = 'time' | 'name' | 'size';
type MediaTypeIconKind = 'photo' | 'video' | 'file';
type MediaTypeGradientStop = {
  offset: string;
  color: string;
};
type ReceivedPreviewState = {
  item: ReceivedLibraryMediaItem;
  url: string;
};
type IdleCallbackHandle = number;
type IdleCallbackOptions = {
  timeout?: number;
};
type IdleDeadlineLike = {
  didTimeout: boolean;
  timeRemaining: () => number;
};
type GlobalIdleCallbacks = typeof globalThis & {
  requestIdleCallback?: (
    callback: (deadline: IdleDeadlineLike) => void,
    options?: IdleCallbackOptions,
  ) => IdleCallbackHandle;
  cancelIdleCallback?: (handle: IdleCallbackHandle) => void;
};

const SORT_OPTIONS: Array<{ id: SortKey; label: string }> = [
  { id: 'time', label: '时间' },
  { id: 'name', label: '名称' },
  { id: 'size', label: '文件大小' },
];
const RECEIVED_LIBRARY_PAGE_SIZE = 20;
const MEDIA_TYPE_ICON_GRADIENTS: Record<
  MediaTypeIconKind,
  MediaTypeGradientStop[]
> = {
  photo: [
    { offset: '0%', color: '#F7FCFF' },
    { offset: '54%', color: '#D8F0FF' },
    { offset: '100%', color: '#9FD6FF' },
  ],
  video: [
    { offset: '0%', color: '#F8F6FF' },
    { offset: '48%', color: '#E3E6FF' },
    { offset: '100%', color: '#9AAEFF' },
  ],
  file: [
    { offset: '0%', color: '#FFFFFF' },
    { offset: '56%', color: '#EFF5FB' },
    { offset: '100%', color: '#D7E2F0' },
  ],
};

const now = Date.now();
const MOCK_RECEIVED_ITEMS: ReceivedLibraryMediaItem[] = [
  {
    resourceId: 'mock-received-1',
    desktopDeviceId: '剪辑工作站-A',
    clientId: 'iphone-15-pro',
    displayName: 'IMG_8421.JPG',
    fileKey: 'mock/IMG_8421.JPG',
    filename: 'IMG_8421.JPG',
    mediaType: 'image',
    fileSize: 9017753,
    completedAt: new Date(now - 9 * 60 * 1000).toISOString(),
    shareStatus: 'shared',
  },
  {
    resourceId: 'mock-received-2',
    desktopDeviceId: '剪辑工作站-A',
    clientId: 'iphone-15-pro',
    displayName: 'IMG_8420.JPG',
    fileKey: 'mock/IMG_8420.JPG',
    filename: 'IMG_8420.JPG',
    mediaType: 'image',
    fileSize: 8283750,
    completedAt: new Date(now - 14 * 60 * 1000).toISOString(),
    shareStatus: 'shared',
  },
  {
    resourceId: 'mock-received-3',
    desktopDeviceId: '剪辑工作站-A',
    clientId: 'iphone-15-pro',
    displayName: 'VID_3018.MP4',
    fileKey: 'mock/VID_3018.MP4',
    filename: 'VID_3018.MP4',
    mediaType: 'video',
    fileSize: 1717986918,
    completedAt: new Date(now - 18 * 60 * 1000).toISOString(),
    shareStatus: 'missing',
  },
  {
    resourceId: 'mock-received-4',
    desktopDeviceId: 'MacBook Pro',
    clientId: 'iphone-15-pro',
    displayName: 'ScreenRecording_0615.mov',
    fileKey: 'mock/ScreenRecording_0615.mov',
    filename: 'ScreenRecording_0615.mov',
    mediaType: 'video',
    fileSize: 3006477107,
    completedAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
    shareStatus: 'missing',
  },
  {
    resourceId: 'mock-received-5',
    desktopDeviceId: 'MacBook Pro',
    clientId: 'iphone-15-pro',
    displayName: 'Contract-Final.pdf',
    fileKey: 'mock/Contract-Final.pdf',
    filename: 'Contract-Final.pdf',
    mediaType: 'document',
    fileSize: 6501171,
    completedAt: new Date(now - 5 * 60 * 60 * 1000).toISOString(),
    shareStatus: 'shared',
  },
  {
    resourceId: 'mock-received-6',
    desktopDeviceId: '剪辑工作站-A',
    clientId: 'iphone-15-pro',
    displayName: 'IMG_8393.PNG',
    fileKey: 'mock/IMG_8393.PNG',
    filename: 'IMG_8393.PNG',
    mediaType: 'image',
    fileSize: 4299161,
    completedAt: new Date(now - 25 * 60 * 60 * 1000).toISOString(),
    shareStatus: 'shared',
  },
  {
    resourceId: 'mock-received-7',
    desktopDeviceId: '剪辑工作站-A',
    clientId: 'iphone-15-pro',
    displayName: 'ProjectAssets.zip',
    fileKey: 'mock/ProjectAssets.zip',
    filename: 'ProjectAssets.zip',
    mediaType: 'document',
    fileSize: 3650722202,
    completedAt: new Date(now - 26 * 60 * 60 * 1000).toISOString(),
    shareStatus: 'missing',
  },
  {
    resourceId: 'mock-received-8',
    desktopDeviceId: '剪辑工作站-A',
    clientId: 'iphone-15-pro',
    displayName: 'VID_2981.MP4',
    fileKey: 'mock/VID_2981.MP4',
    filename: 'VID_2981.MP4',
    mediaType: 'video',
    fileSize: 1033895936,
    completedAt: new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString(),
    shareStatus: 'shared',
  },
  {
    resourceId: 'mock-received-9',
    desktopDeviceId: 'Windows Workstation',
    clientId: 'iphone-15-pro',
    displayName: 'B-roll_Studio_A.heic',
    fileKey: 'mock/B-roll_Studio_A.heic',
    filename: 'B-roll_Studio_A.heic',
    mediaType: 'image',
    fileSize: 11240735,
    completedAt: new Date(
      now - 3 * 24 * 60 * 60 * 1000 - 90 * 60 * 1000,
    ).toISOString(),
    shareStatus: 'shared',
  },
];

type RemoteResourcesPreviewGlobal = typeof globalThis & {
  __SYNCFLOW_REMOTE_RESOURCES_PREVIEW__?: boolean;
};

function isRemoteResourcesPreviewMode() {
  return (
    (globalThis as RemoteResourcesPreviewGlobal)
      .__SYNCFLOW_REMOTE_RESOURCES_PREVIEW__ === true
  );
}

function getPreviewReceivedItems() {
  return isRemoteResourcesPreviewMode() ? MOCK_RECEIVED_ITEMS : [];
}

function getSectionTitle(isoString: string) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '未知时间';

  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return '今天';
  if (date.toDateString() === yesterday.toDateString()) return '昨天';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    '0',
  )}-${String(date.getDate()).padStart(2, '0')}`;
}

function getItemTimestamp(item: ReceivedLibraryMediaItem) {
  const timestamp = new Date(item.completedAt).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function isVideo(mediaType: string, filename: string) {
  return mediaType === 'video' || /\.(mp4|mov|avi|mkv|webm)$/i.test(filename);
}

function isImage(mediaType: string, filename: string) {
  return (
    mediaType === 'image' || /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(filename)
  );
}

function getFileTypeText(mediaType: string, filename: string) {
  if (isVideo(mediaType, filename)) return '视频';
  if (isImage(mediaType, filename)) return '照片';
  return '文件';
}

function getFileIconType(
  mediaType: string,
  filename: string,
): MediaTypeIconKind {
  if (isVideo(mediaType, filename)) return 'video';
  if (isImage(mediaType, filename)) return 'photo';
  return 'file';
}

function getReceivedFileTitle(item: ReceivedLibraryMediaItem) {
  return item.filename || item.displayName || item.fileKey || '未命名文件';
}

function getReceivedItemKey(item: ReceivedLibraryMediaItem, index: number) {
  return (
    item.fileKey ||
    item.resourceId ||
    `${getReceivedFileTitle(item)}-${item.completedAt}-${index}`
  );
}

function formatClock(isoString: string) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function hasNextReceivedLibraryPage(page: ReceivedLibraryMediaPage) {
  if (page.totalItems <= 0) return false;
  return page.page * page.pageSize < page.totalItems;
}

function mergeReceivedLibraryItems(
  current: ReceivedLibraryMediaItem[],
  next: ReceivedLibraryMediaItem[],
) {
  const seen = new Set(
    current.map((item, index) => getReceivedItemKey(item, index)),
  );
  const merged = [...current];
  for (const item of next) {
    const key = getReceivedItemKey(item, merged.length);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

export function PhoneSyncSpaceGlobalScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [items, setItems] = useState<ReceivedLibraryMediaItem[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMorePages, setHasMorePages] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [libraryTotalItems, setLibraryTotalItems] = useState(0);
  const [libraryTotalBytes, setLibraryTotalBytes] = useState(0);
  const [sortBy, setSortBy] = useState<SortKey>('time');
  const [showSortSheet, setShowSortSheet] = useState(false);
  const [preview, setPreview] = useState<ReceivedPreviewState | null>(null);
  const [binding, setBinding] = useState<BindingStateDTO | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [remoteThumbnailsEnabled, setRemoteThumbnailsEnabled] = useState(
    Platform.OS !== 'android',
  );
  const hasDeferredAndroidThumbnails = useRef(Platform.OS !== 'android');

  const loadData = useCallback(async () => {
    setLoadError(false);
    setLoadingMore(false);
    try {
      const { NativeSyncEngine } = NativeModules;
      if (!NativeSyncEngine) {
        const previewItems = getPreviewReceivedItems();
        setItems(previewItems);
        setCurrentPage(1);
        setHasMorePages(false);
        setLibraryTotalItems(previewItems.length);
        setLibraryTotalBytes(
          previewItems.reduce((total, item) => total + item.fileSize, 0),
        );
        setLoadError(false);
        setLoading(false);
        return;
      }

      const bindingState = await NativeSyncEngine.getBindingState();
      setBinding(bindingState);
      if (!bindingState || !bindingState.host) {
        const previewItems = getPreviewReceivedItems();
        setItems(previewItems);
        setCurrentPage(1);
        setHasMorePages(false);
        setLibraryTotalItems(previewItems.length);
        setLibraryTotalBytes(
          previewItems.reduce((total, item) => total + item.fileSize, 0),
        );
        setLoadError(false);
        setLoading(false);
        return;
      }

      const desktop = { host: bindingState.host, port: SIDECAR_HTTP_PORT };
      const result = await listCurrentClientReceivedLibraryPage(desktop, {
        page: 1,
        pageSize: RECEIVED_LIBRARY_PAGE_SIZE,
      });
      const receivedItems = result.items ?? [];
      const previewItems = getPreviewReceivedItems();
      const nextItems = receivedItems.length > 0 ? receivedItems : previewItems;
      setItems(nextItems);
      setCurrentPage(result.page);
      setHasMorePages(
        receivedItems.length > 0 ? hasNextReceivedLibraryPage(result) : false,
      );
      setLibraryTotalItems(
        receivedItems.length > 0 ? result.totalItems : previewItems.length,
      );
      setLibraryTotalBytes(
        receivedItems.length > 0
          ? result.totalBytes
          : previewItems.reduce((total, item) => total + item.fileSize, 0),
      );
      setLoadError(false);
    } catch (e) {
      console.warn('[PhoneSyncSpaceGlobalScreen] Failed to load data:', e);
      const previewItems = getPreviewReceivedItems();
      setItems(previewItems);
      setCurrentPage(1);
      setHasMorePages(false);
      setLibraryTotalItems(previewItems.length);
      setLibraryTotalBytes(
        previewItems.reduce((total, item) => total + item.fileSize, 0),
      );
      setLoadError(previewItems.length === 0);
    } finally {
      setLoading(false);
      setHasLoadedOnce(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let idleTask: IdleCallbackHandle | null = null;
      let fallbackTask: ReturnType<typeof setTimeout> | null = null;
      const idleCallbacks = globalThis as GlobalIdleCallbacks;
      if (Platform.OS === 'android' && !hasDeferredAndroidThumbnails.current) {
        setRemoteThumbnailsEnabled(false);
        const enableThumbnails = () => {
          hasDeferredAndroidThumbnails.current = true;
          setRemoteThumbnailsEnabled(true);
        };
        if (typeof idleCallbacks.requestIdleCallback === 'function') {
          idleTask = idleCallbacks.requestIdleCallback(enableThumbnails, {
            timeout: 600,
          });
        } else {
          fallbackTask = setTimeout(enableThumbnails, 240);
        }
      } else {
        setRemoteThumbnailsEnabled(true);
      }

      setLoading(true);
      setLoadError(false);
      loadData();

      return () => {
        if (
          idleTask !== null &&
          typeof idleCallbacks.cancelIdleCallback === 'function'
        ) {
          idleCallbacks.cancelIdleCallback(idleTask);
        }
        if (fallbackTask !== null) {
          clearTimeout(fallbackTask);
        }
      };
    }, [loadData]),
  );

  const loadNextPage = useCallback(async () => {
    if (loading || loadingMore || !hasMorePages || !binding?.host) {
      return;
    }
    setLoadingMore(true);
    try {
      const desktop = { host: binding.host, port: SIDECAR_HTTP_PORT };
      const result = await listCurrentClientReceivedLibraryPage(desktop, {
        page: currentPage + 1,
        pageSize: RECEIVED_LIBRARY_PAGE_SIZE,
      });
      setItems(currentItems =>
        mergeReceivedLibraryItems(currentItems, result.items ?? []),
      );
      setCurrentPage(result.page);
      setHasMorePages(hasNextReceivedLibraryPage(result));
      setLibraryTotalItems(result.totalItems);
      setLibraryTotalBytes(result.totalBytes);
      setLoadError(false);
    } catch (e) {
      console.warn('[PhoneSyncSpaceGlobalScreen] Failed to load next page:', e);
    } finally {
      setLoadingMore(false);
    }
  }, [binding?.host, currentPage, hasMorePages, loading, loadingMore]);

  const goBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.reset({ index: 0, routes: [{ name: 'SharedFiles' }] });
  }, [navigation]);

  const handleDownload = useCallback(
    async (item: ReceivedLibraryMediaItem) => {
      if (downloadingId !== null) return;
      const itemKey = item.fileKey || item.resourceId;
      setDownloadingId(itemKey);
      try {
        const { NativeSyncEngine } = NativeModules;
        const bindingState = await NativeSyncEngine?.getBindingState();
        if (!bindingState || !bindingState.host) {
          Alert.alert(t('sharedFiles.deviceUnavailable.title') || '设备不可用');
          return;
        }
        const desktop: DesktopInfo = {
          host: bindingState.host,
          port: SIDECAR_HTTP_PORT,
        };
        const result = await downloadReceivedLibraryItem(desktop, item);
        if (!isDownloadSavedLocally(result)) {
          Alert.alert(
            '暂不支持保存',
            '当前版本还没有接入客户端本地保存能力，请等待后续版本。',
          );
          return;
        }
        const savedToPhotos = isDownloadSavedToPhotos(result);
        await recordDownloadedFile({
          resourceId: itemKey,
          filename: item.filename || item.displayName,
          fileSize: item.fileSize,
          mediaType: item.mediaType,
          localPath: result.localPath,
          thumbnailUrl: item.thumbnailUrl,
          previewUrl: item.previewUrl,
          streamUrl: item.streamUrl,
          savedToPhotos,
        });
        Alert.alert(
          t('sharedFiles.dialogs.downloadComplete') || '下載完成',
          savedToPhotos
            ? t('sharedFiles.dialogs.downloadSavedToPhotos', {
                name: item.filename || item.displayName,
                location:
                  t('sharedFiles.dialogs.savedLocationPhotos') || '相簿',
              }) || `${item.filename || item.displayName} 已儲存至相簿`
            : t('sharedFiles.dialogs.downloadSavedToFiles', {
                name: item.filename || item.displayName,
              }) || `${item.filename || item.displayName} 已保存到文件`,
        );
      } catch (err) {
        console.warn('[PhoneSyncSpaceGlobalScreen] Download failed:', err);
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

  const handleOpenReceivedItem = useCallback(
    async (item: ReceivedLibraryMediaItem) => {
      const filename = getReceivedFileTitle(item);
      const image = isImageFile(item.mediaType, filename);
      const video = isVideoFile(item.mediaType, filename);

      try {
        const { NativeSyncEngine } = NativeModules;
        const bindingState = await NativeSyncEngine?.getBindingState();
        if (!bindingState || !bindingState.host) {
          Alert.alert(t('sharedFiles.deviceUnavailable.title') || '設備不可用');
          return;
        }

        const desktop: DesktopInfo = {
          host: bindingState.host,
          port: SIDECAR_HTTP_PORT,
        };

        if (image || video) {
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
              '[PhoneSyncSpaceGlobalScreen] Open with other app failed:',
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

        const localPath = await prepareReceivedLibraryPreview(desktop, item);
        await viewDocument({
          uri: documentPreviewUri(localPath),
          headerTitle: filename,
          mimeType: documentMimeType(filename),
        });
      } catch (err) {
        console.warn('[PhoneSyncSpaceGlobalScreen] Preview failed:', err);
        Alert.alert(
          t('sharedFiles.dialogs.previewFailed') || '預覽失敗',
          t('sharedFiles.dialogs.previewFailedMessage') || '無法取得檔案預覽',
        );
      }
    },
    [t],
  );

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => {
      if (sortBy === 'name') {
        return getReceivedFileTitle(a).localeCompare(
          getReceivedFileTitle(b),
          'zh-CN',
        );
      }
      if (sortBy === 'size') return b.fileSize - a.fileSize;
      return getItemTimestamp(b) - getItemTimestamp(a);
    });
  }, [items, sortBy]);

  const sections = useMemo(
    () =>
      sortedItems.reduce<ReceivedSection[]>((acc, item) => {
        const title = getSectionTitle(item.completedAt);
        const section = acc.find(group => group.title === title);
        if (section) {
          section.data.push(item);
        } else {
          acc.push({ title, key: title, data: [item] });
        }
        return acc;
      }, []),
    [sortedItems],
  );

  const totalSizeLabel = formatBytes(libraryTotalBytes);
  const totalItemCount = libraryTotalItems;
  const sortLabel =
    SORT_OPTIONS.find(option => option.id === sortBy)?.label ?? '时间';
  const showBlockingLoading = loading && !hasLoadedOnce;
  const showBlockingError = loadError && sortedItems.length === 0;
  const listFooter = loadingMore ? (
    <View style={styles.listFooter}>
      <ActivityIndicator size="small" color={colors.primary} />
    </View>
  ) : null;

  const renderItem = ({ item }: { item: ReceivedLibraryMediaItem }) => {
    const iconType = getFileIconType(item.mediaType, item.filename);
    const displayName = getReceivedFileTitle(item);
    const fileType = getFileTypeText(item.mediaType, item.filename);
    const clock = formatClock(item.completedAt);
    const isDownloading = downloadingId === (item.fileKey || item.resourceId);

    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.75}
        onPress={() => handleOpenReceivedItem(item)}
        accessibilityRole="button"
        accessibilityLabel="预览已同步文件"
      >
        <ReceivedMediaThumbnail
          item={item}
          iconType={iconType}
          loadRemoteThumbnail={remoteThumbnailsEnabled}
        />
        <View style={styles.infoWrapper}>
          <Text style={styles.filename} numberOfLines={1}>
            {displayName}
          </Text>
          <Text style={styles.metaText} numberOfLines={1}>
            {`${fileType} · ${formatBytes(item.fileSize)}${
              clock ? ` · ${clock}` : ''
            }`}
          </Text>
        </View>
        <TouchableOpacity
          style={[
            styles.downloadButton,
            isDownloading && styles.downloadButtonDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel="下载已同步文件"
          disabled={isDownloading || downloadingId !== null}
          onPress={() => handleDownload(item)}
          activeOpacity={0.72}
        >
          {isDownloading ? (
            <ActivityIndicator
              testID="phone-sync-download-icon"
              size="small"
              color={colors.primary}
            />
          ) : (
            <Download
              testID="phone-sync-download-icon"
              size={16}
              color={colors.primary}
              strokeWidth={2}
            />
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  return (
    <GlobalGradientBackground>
      <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel="返回"
            onPress={goBack}
            activeOpacity={0.7}
          >
            <ChevronLeft
              testID="phone-sync-back-icon"
              size={20}
              color="#59616D"
              strokeWidth={2}
            />
          </TouchableOpacity>
          <View style={styles.headerText}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {t('sharedFiles.phoneSyncSpace.title') || '手機同步空間'}
            </Text>
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              已同步到电脑的手机素材
            </Text>
          </View>
        </View>

        <View style={styles.toolbarCard}>
          <TouchableOpacity
            style={styles.sortButton}
            activeOpacity={0.7}
            onPress={() => setShowSortSheet(true)}
          >
            <Rows3
              testID="phone-sync-sort-icon"
              size={16}
              color={colors.primary}
              strokeWidth={2}
            />
            <Text style={styles.sortButtonText}>{sortLabel}</Text>
          </TouchableOpacity>
          <View style={styles.summaryBadge}>
            {loading && hasLoadedOnce ? (
              <ActivityIndicator
                size="small"
                color="#7B8490"
                style={styles.summarySpinner}
              />
            ) : null}
            <Text style={styles.summaryText}>
              {totalItemCount} 个 · {totalSizeLabel}
            </Text>
          </View>
        </View>

        {showBlockingLoading ? (
          <View style={styles.centeredCard}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.centeredTitle}>正在加载</Text>
            <Text style={styles.centeredSubtitle}>
              同步空间列表会在这里刷新。
            </Text>
          </View>
        ) : showBlockingError ? (
          <View style={styles.centeredCard}>
            <Text style={styles.centeredTitle}>
              {t('sharedFiles.networkError.title') || '載入失敗'}
            </Text>
            <Text style={styles.centeredSubtitle}>
              {t('sharedFiles.networkError.message') || '請稍後重試'}
            </Text>
          </View>
        ) : sortedItems.length === 0 ? (
          <View style={styles.centeredCard}>
            <PhoneSyncEmptyArtwork />
            <Text style={styles.centeredTitle}>
              {t('sharedFiles.phoneSyncSpace.empty') || '尚無同步檔案'}
            </Text>
            <Text style={styles.centeredSubtitle}>
              开启自动上传后，同步到电脑的素材会出现在这里。
            </Text>
          </View>
        ) : (
          <SectionList
            testID="phone-sync-section-list"
            sections={sections}
            keyExtractor={(item, index) => getReceivedItemKey(item, index)}
            renderItem={renderItem}
            renderSectionHeader={({ section }) => (
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{section.title}</Text>
                <Text style={styles.sectionCount}>
                  {section.data.length} 个文件
                </Text>
              </View>
            )}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            stickySectionHeadersEnabled={false}
            ListFooterComponent={listFooter}
            onEndReached={loadNextPage}
            onEndReachedThreshold={0.45}
          />
        )}
      </SafeAreaView>

      <SortSheet
        visible={showSortSheet}
        value={sortBy}
        options={SORT_OPTIONS}
        onClose={() => setShowSortSheet(false)}
        onSelect={value => {
          setSortBy(value);
          setShowSortSheet(false);
        }}
      />
      <ReceivedMediaPreviewModal
        preview={preview}
        onClose={() => setPreview(null)}
      />
    </GlobalGradientBackground>
  );
}

function PhoneSyncEmptyArtwork() {
  return (
    <View testID="phone-sync-empty-icon" style={styles.emptyArtwork}>
      <View style={[styles.emptyArtworkSheet, styles.emptyArtworkSheetBack]} />
      <View style={[styles.emptyArtworkSheet, styles.emptyArtworkSheetFront]}>
        <Svg
          pointerEvents="none"
          style={StyleSheet.absoluteFillObject}
          width="100%"
          height="100%"
          viewBox="0 0 72 72"
        >
          <Defs>
            <LinearGradient
              id="phoneSyncEmptyGradient"
              x1="0%"
              y1="0%"
              x2="100%"
              y2="100%"
            >
              <Stop offset="0%" stopColor="#F8FCFF" />
              <Stop offset="54%" stopColor="#DFF3FF" />
              <Stop offset="100%" stopColor="#B6E3FF" />
            </LinearGradient>
          </Defs>
          <Rect
            x="0"
            y="0"
            width="72"
            height="72"
            rx="22"
            fill="url(#phoneSyncEmptyGradient)"
          />
        </Svg>
        <View style={styles.emptyArtworkCorner} />
        <View style={styles.emptyArtworkPulse} />
        <CloudUpload size={30} color="#1677D2" strokeWidth={1.9} />
      </View>
    </View>
  );
}

function MediaTypeIcon({ type }: { type: MediaTypeIconKind }) {
  const gradientId = `phoneSync${type}Gradient`;

  return (
    <View testID={`phone-sync-media-icon-${type}`} style={styles.mediaTypeIcon}>
      <Svg
        style={StyleSheet.absoluteFillObject}
        width="100%"
        height="100%"
        viewBox="0 0 46 46"
      >
        <Defs>
          <LinearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            {MEDIA_TYPE_ICON_GRADIENTS[type].map(stop => (
              <Stop
                key={stop.offset}
                offset={stop.offset}
                stopColor={stop.color}
              />
            ))}
          </LinearGradient>
        </Defs>
        <Rect width="46" height="46" rx="14" fill={`url(#${gradientId})`} />
      </Svg>
      <MediaTypeGlyph type={type} />
    </View>
  );
}

function ReceivedMediaThumbnail({
  item,
  iconType,
  loadRemoteThumbnail,
}: {
  item: ReceivedLibraryMediaItem;
  iconType: MediaTypeIconKind;
  loadRemoteThumbnail: boolean;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const displayName = getReceivedFileTitle(item);

  if (
    loadRemoteThumbnail &&
    iconType === 'photo' &&
    item.thumbnailUrl &&
    !imageFailed
  ) {
    return (
      <View style={styles.mediaPreviewThumb}>
        <Image
          testID="phone-sync-thumbnail-image"
          source={{ uri: item.thumbnailUrl }}
          style={styles.mediaPreviewImage}
          resizeMode="cover"
          fadeDuration={Platform.OS === 'android' ? 0 : undefined}
          accessibilityLabel={`${displayName} 缩略图`}
          onError={() => setImageFailed(true)}
        />
      </View>
    );
  }

  return <MediaTypeIcon type={iconType} />;
}

function MediaTypeGlyph({ type }: { type: MediaTypeIconKind }) {
  if (type === 'photo') {
    return (
      <>
        <View style={styles.photoIconDot} />
        <View style={styles.photoIconHillLight} />
        <View style={styles.photoIconHillBlue} />
        <View style={styles.mediaTypeGlyphCenter}>
          <FileImage size={20} color="#1677D2" strokeWidth={1.8} />
        </View>
      </>
    );
  }

  if (type === 'video') {
    return (
      <>
        <View style={styles.videoDotRowTop}>
          {[0, 1, 2].map(item => (
            <View key={item} style={styles.videoDotTop} />
          ))}
        </View>
        <View style={styles.videoDotRowBottom}>
          {[0, 1, 2].map(item => (
            <View key={item} style={styles.videoDotBottom} />
          ))}
        </View>
        <View style={styles.videoPlayCircle}>
          <Play
            size={14}
            color="#746AA8"
            fill="#746AA8"
            strokeWidth={1.8}
            style={styles.videoPlayIcon}
          />
        </View>
      </>
    );
  }

  return (
    <>
      <View style={styles.fileIconCorner} />
      <View style={styles.mediaTypeGlyphCenter}>
        <FileText size={20} color="#59616D" strokeWidth={1.8} />
      </View>
    </>
  );
}

function SortSheet({
  visible,
  value,
  options,
  onClose,
  onSelect,
}: {
  visible: boolean;
  value: SortKey;
  options: Array<{ id: SortKey; label: string }>;
  onClose: () => void;
  onSelect: (value: SortKey) => void;
}) {
  if (!visible) return null;

  const content = (
    <View
      testID="phone-sync-sort-sheet-layer"
      pointerEvents="box-none"
      style={styles.sheetLayer}
    >
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <ModalBlurBackdrop overlayColor="rgba(23,25,28,0.18)" />
      </Pressable>
      <View style={styles.sheetCard}>
        <Text style={styles.sheetTitle}>排序方式</Text>
        {options.map(option => {
          const active = option.id === value;
          return (
            <TouchableOpacity
              key={option.id}
              style={styles.sheetOption}
              activeOpacity={0.7}
              onPress={() => onSelect(option.id)}
            >
              <Text style={styles.sheetOptionText}>{option.label}</Text>
              {active ? (
                <Check
                  testID="phone-sync-sort-check-icon"
                  size={20}
                  color={colors.primary}
                  strokeWidth={2.4}
                />
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  if (Platform.OS === 'android') {
    return content;
  }

  return (
    <Modal
      animationType="fade"
      transparent
      statusBarTranslucent
      visible={visible}
      onRequestClose={onClose}
    >
      {content}
    </Modal>
  );
}

function ReceivedMediaPreviewModal({
  preview,
  onClose,
}: {
  preview: ReceivedPreviewState | null;
  onClose: () => void;
}) {
  if (!preview) return null;

  const { item } = preview;
  const displayName = getReceivedFileTitle(item);
  const imagePreview = isImage(item.mediaType, item.filename);
  const videoPreview = isVideo(item.mediaType, item.filename);

  return (
    <Modal
      animationType="fade"
      presentationStyle="fullScreen"
      statusBarTranslucent
      visible={preview != null}
      onRequestClose={onClose}
    >
      <View style={styles.mediaPreviewModalRoot}>
        <View style={styles.mediaPreviewHeader}>
          <Text style={styles.mediaPreviewTitle} numberOfLines={1}>
            {displayName}
          </Text>
          <TouchableOpacity
            style={styles.mediaPreviewCloseButton}
            accessibilityRole="button"
            accessibilityLabel="关闭预览"
            activeOpacity={0.7}
            onPress={onClose}
          >
            <X size={18} color="#FFFFFF" strokeWidth={2.2} />
          </TouchableOpacity>
        </View>

        <View style={styles.mediaPreviewBody}>
          {imagePreview ? (
            <Image
              testID="phone-sync-preview-image"
              source={{ uri: preview.url }}
              style={styles.mediaPreviewFullMedia}
              resizeMode="contain"
            />
          ) : null}
          {videoPreview ? (
            <Video
              testID="phone-sync-preview-video"
              source={{ uri: preview.url }}
              style={styles.mediaPreviewFullMedia}
              resizeMode="contain"
              controls
              paused={false}
              muted={false}
              playInBackground
              playWhenInactive
              ignoreSilentSwitch="ignore"
            />
          ) : null}
          {!imagePreview && !videoPreview ? (
            <View style={styles.mediaPreviewErrorBox}>
              <Text style={styles.mediaPreviewErrorText}>
                无法加载预览，请确认电脑在线且文件仍存在。
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const glassShadow = {
  shadowColor: '#46608A',
  shadowOffset: { width: 0, height: 12 },
  shadowOpacity: 0.08,
  shadowRadius: 34,
  elevation: 3,
  ...androidBoxShadow({
    offsetY: 12,
    blurRadius: 34,
    color: 'rgba(70, 96, 138, 0.08)',
  }),
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 18,
    marginBottom: 20,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.62)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.70)',
    ...glassShadow,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.foreground,
  },
  headerSubtitle: {
    marginTop: 2,
    fontSize: 11,
    color: '#59616D',
  },
  toolbarCard: {
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.70)',
    backgroundColor: 'rgba(255,255,255,0.50)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...glassShadow,
  },
  sortButton: {
    minHeight: 36,
    borderRadius: 10,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sortButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.foreground,
  },
  summaryBadge: {
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.62)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  summarySpinner: {
    transform: [{ scale: 0.72 }],
  },
  summaryText: {
    fontSize: 10,
    fontWeight: '500',
    color: '#7B8490',
  },
  listContent: {
    paddingBottom: 34,
  },
  listFooter: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#59616D',
  },
  sectionCount: {
    fontSize: 10,
    color: '#9AA3AE',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.70)',
    backgroundColor: 'rgba(255,255,255,0.50)',
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 10,
    ...glassShadow,
  },
  mediaTypeIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.75)',
    shadowColor: '#46608A',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.1,
    shadowRadius: 28,
    elevation: 2,
    ...androidBoxShadow({
      offsetY: 12,
      blurRadius: 28,
      color: 'rgba(70, 96, 138, 0.10)',
    }),
  },
  mediaPreviewThumb: {
    width: 46,
    height: 46,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.78)',
    backgroundColor: 'rgba(255,255,255,0.54)',
    shadowColor: '#46608A',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.1,
    shadowRadius: 28,
    elevation: 2,
    ...androidBoxShadow({
      offsetY: 12,
      blurRadius: 28,
      color: 'rgba(70, 96, 138, 0.10)',
    }),
  },
  mediaPreviewImage: {
    width: '100%',
    height: '100%',
  },
  mediaTypeGlyphCenter: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoIconDot: {
    position: 'absolute',
    left: 8,
    top: 8,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.86)',
  },
  photoIconHillLight: {
    position: 'absolute',
    left: 4,
    bottom: -4,
    width: 32,
    height: 20,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.62)',
    transform: [{ rotate: '-8deg' }],
  },
  photoIconHillBlue: {
    position: 'absolute',
    right: 0,
    bottom: -4,
    width: 36,
    height: 24,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    backgroundColor: 'rgba(191,227,255,0.78)',
    transform: [{ rotate: '10deg' }],
  },
  videoDotRowTop: {
    position: 'absolute',
    left: 8,
    right: 8,
    top: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  videoDotRowBottom: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  videoDotTop: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.72)',
  },
  videoDotBottom: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.54)',
  },
  videoPlayCircle: {
    position: 'absolute',
    left: 9,
    top: 9,
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.74)',
    shadowColor: '#46608A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
    ...androidBoxShadow({
      offsetY: 1,
      blurRadius: 2,
      color: 'rgba(70, 96, 138, 0.08)',
    }),
  },
  videoPlayIcon: {
    marginLeft: 2,
  },
  fileIconCorner: {
    position: 'absolute',
    right: 8,
    top: 8,
    width: 12,
    height: 12,
    borderBottomLeftRadius: 8,
    borderLeftWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#C6D2DF',
    backgroundColor: 'rgba(255,255,255,0.76)',
  },
  infoWrapper: {
    flex: 1,
    minWidth: 0,
    marginLeft: 12,
    marginRight: 8,
  },
  filename: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.foreground,
  },
  metaText: {
    marginTop: 5,
    fontSize: 11,
    lineHeight: 16,
    color: '#59616D',
  },
  rightWrapper: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginRight: 8,
  },
  deviceText: {
    fontSize: 11,
    color: '#1677D2',
    fontWeight: '600',
  },
  missingText: {
    marginTop: 4,
    fontSize: 10,
    color: '#9AA3AE',
  },
  previewButton: {
    width: 32,
    height: 32,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.64)',
    marginRight: 6,
  },
  downloadButton: {
    width: 32,
    height: 32,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.64)',
  },
  downloadButtonDisabled: {
    opacity: 0.5,
  },
  centeredCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.70)',
    backgroundColor: 'rgba(255,255,255,0.50)',
    paddingHorizontal: 24,
    paddingVertical: 34,
    alignItems: 'center',
    ...glassShadow,
  },
  emptyArtwork: {
    width: 84,
    height: 78,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyArtworkSheet: {
    position: 'absolute',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.82)',
    shadowColor: '#46608A',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.12,
    shadowRadius: 30,
    elevation: 2,
    ...androidBoxShadow({
      offsetY: 16,
      blurRadius: 30,
      color: 'rgba(70, 96, 138, 0.12)',
    }),
  },
  emptyArtworkSheetBack: {
    width: 58,
    height: 58,
    left: 8,
    top: 11,
    backgroundColor: 'rgba(255,255,255,0.50)',
    transform: [{ rotate: '-8deg' }],
  },
  emptyArtworkSheetFront: {
    width: 72,
    height: 72,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyArtworkCorner: {
    position: 'absolute',
    right: 13,
    top: 13,
    width: 14,
    height: 14,
    borderLeftWidth: 1,
    borderBottomWidth: 1,
    borderBottomLeftRadius: 9,
    borderColor: 'rgba(22,119,210,0.18)',
    backgroundColor: 'rgba(255,255,255,0.68)',
  },
  emptyArtworkPulse: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.58)',
  },
  centeredTitle: {
    marginTop: 12,
    fontSize: 14,
    fontWeight: '700',
    color: colors.foreground,
  },
  centeredSubtitle: {
    marginTop: 6,
    fontSize: 11,
    lineHeight: 18,
    textAlign: 'center',
    color: '#59616D',
  },
  sheetLayer: {
    ...StyleSheet.absoluteFillObject,
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingBottom: 16,
    zIndex: 30,
    elevation: 30,
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheetCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.70)',
    backgroundColor: 'rgba(255,255,255,0.88)',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
    ...glassShadow,
  },
  sheetTitle: {
    paddingHorizontal: 12,
    paddingBottom: 8,
    fontSize: 13,
    fontWeight: '700',
    color: colors.foreground,
  },
  mediaPreviewModalRoot: {
    flex: 1,
    backgroundColor: '#000000',
  },
  mediaPreviewHeader: {
    minHeight: 86,
    paddingHorizontal: 16,
    paddingTop: 48,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  mediaPreviewCloseButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  mediaPreviewTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  mediaPreviewBody: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mediaPreviewFullMedia: {
    width: '100%',
    height: '100%',
  },
  mediaPreviewErrorBox: {
    paddingHorizontal: 26,
  },
  mediaPreviewErrorText: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    color: 'rgba(255,255,255,0.78)',
  },
  sheetOption: {
    minHeight: 48,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetOptionText: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.foreground,
  },
});
