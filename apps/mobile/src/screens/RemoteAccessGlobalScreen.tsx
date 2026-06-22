import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
  Modal,
  NativeEventEmitter,
  NativeModules,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  type StyleProp,
  type ViewStyle,
  View,
} from 'react-native';
import { viewDocument } from '@react-native-documents/viewer';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useTranslation } from 'react-i18next';
import {
  FileImage,
  FileText,
  FolderOpen,
  Grid2X2,
  Monitor,
  Play,
  Rows3,
  Search,
} from 'lucide-react-native';
import Video from 'react-native-video';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import {
  type BindingStateDTO,
  type DirectoryFileDTO,
  type DesktopSharedResourceDTO,
  type SharedFilesReachabilityDTO,
} from '@syncflow/contracts';

import type { RootStackParamList } from '../navigation/RootNavigator';
import { colors } from '../theme/globalColors';
import { androidBoxShadow } from '../utils/androidShadow';
import { formatBytes } from '../utils/format';
import { Icon } from '../components/Icon';
import { GlobalGradientBackground } from '../components/GlobalGradientBackground';
import { ModalBlurBackdrop } from '../components/shared/ModalBlurBackdrop';
import {
  downloadGlobalRemoteAccessResource,
  getGlobalRemoteAccessPreviewUrl,
  isDownloadSavedLocally,
  listGlobalRemoteAccessFolderContents,
  listGlobalRemoteAccessResources,
  prepareGlobalRemoteAccessPreview,
  prepareGlobalRemoteAccessShareFile,
  shareGlobalRemoteAccessResources,
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

type NavigationProp = StackNavigationProp<RootStackParamList, 'RemoteAccess'>;
type LayoutMode = 'list' | 'grid';
type SortKey = 'name' | 'time' | 'size';
type RemoteResourceItem = DesktopSharedResourceDTO & {
  countLabel?: string;
  modifiedLabel?: string;
  preview?: 'blue' | 'dark' | 'settings';
  thumbnailUrl?: string;
  sharedRootResourceId?: string;
  relativePath?: string;
};
type FolderCrumb = {
  id: string;
  name: string;
  rootResourceId?: string;
  path?: string;
  preview?: boolean;
};
type RemoteResourceIconType = 'photo' | 'video' | 'file' | 'folder';
type RemoteResourceGradientStop = {
  offset: string;
  color: string;
};
type RemoteResourcePreviewState = {
  item: RemoteResourceItem;
  url: string;
};
type RouteStatusTone = 'online' | 'pending' | 'offline';
type RouteStatusViewModel = {
  label: string;
  tone: RouteStatusTone;
};

const SORT_OPTIONS: Array<{ id: SortKey; label: string }> = [
  { id: 'name', label: '名称' },
  { id: 'time', label: '时间' },
  { id: 'size', label: '文件大小' },
];

const PREVIEW_DESKTOP_NAME = 'MacBook Pro';
const ROOT_DIRECTORY_LABEL = '用户目录';
const UNBOUND_REMOTE_SUBTITLE = '尚未连接电脑';
const FALLBACK_DESKTOP_LABEL = '当前电脑';
const LOCAL_SAVE_UNSUPPORTED_TITLE = '暂不支持保存';
const LOCAL_SAVE_UNSUPPORTED_MESSAGE =
  '当前版本还没有接入客户端本地保存能力，请等待后续版本。';
const REMOTE_ACCESS_REQUEST_TIMEOUT_MS = 30_000;
const REMOTE_ACCESS_TIMEOUT_ERROR_MESSAGE = 'Remote access request timed out';
const REMOTE_ACCESS_READY_RETRY_ATTEMPTS = 2;
const REMOTE_ACCESS_READY_RETRY_DELAY_MS = 1_200;
const REMOTE_RESOURCE_ICON_GRADIENTS: Record<
  RemoteResourceIconType,
  RemoteResourceGradientStop[]
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
  folder: [
    { offset: '0%', color: '#FFFDF4' },
    { offset: '58%', color: '#FFE7A9' },
    { offset: '100%', color: '#F7B955' },
  ],
  file: [
    { offset: '0%', color: '#FFFFFF' },
    { offset: '56%', color: '#EFF5FB' },
    { offset: '100%', color: '#D7E2F0' },
  ],
};

const now = Date.now();

function resource(
  item: Omit<
    RemoteResourceItem,
    'desktopDeviceId' | 'status' | 'addedAt' | 'downloadCount'
  > & {
    addedOffsetHours?: number;
    desktopDeviceId?: string;
    downloadCount?: number;
    status?: RemoteResourceItem['status'];
  },
): RemoteResourceItem {
  const { addedOffsetHours = 24, ...rest } = item;
  return {
    desktopDeviceId: rest.desktopDeviceId ?? PREVIEW_DESKTOP_NAME,
    status: rest.status ?? 'available',
    addedAt: new Date(now - addedOffsetHours * 60 * 60 * 1000).toISOString(),
    downloadCount: rest.downloadCount ?? 0,
    ...rest,
  };
}

const MOCK_ROOT_ITEMS: RemoteResourceItem[] = [
  resource({
    resourceId: 'codex',
    kind: 'shared_folder',
    displayName: 'Codex',
    countLabel: '文件夹',
    addedOffsetHours: 14,
  }),
  resource({
    resourceId: 'mac-manual',
    kind: 'shared_file',
    displayName: 'Mac 客户端安装手册-2506.docx',
    fileSize: 1992294,
    mediaType: 'document',
    modifiedLabel: '上次修改时间 1天前',
    preview: 'settings',
    addedOffsetHours: 24,
    downloadCount: 2,
  }),
  resource({
    resourceId: 'reply-template',
    kind: 'shared_file',
    displayName: 'REPLY_TEMPLATE_API.md',
    fileSize: 5120,
    mediaType: 'document',
    modifiedLabel: '上次修改时间 2天前',
    preview: 'settings',
    addedOffsetHours: 48,
  }),
  resource({
    resourceId: 'abc',
    kind: 'shared_file',
    displayName: 'abc.txt',
    fileSize: 13,
    mediaType: 'document',
    modifiedLabel: '上次修改时间 3天前',
    preview: 'blue',
    addedOffsetHours: 72,
  }),
  resource({
    resourceId: 'imsdk',
    kind: 'shared_file',
    displayName: 'imsdk.har',
    fileSize: 15728640,
    mediaType: 'document',
    modifiedLabel: '上次修改时间 1天前',
    preview: 'settings',
    addedOffsetHours: 25,
  }),
  resource({
    resourceId: 'vividrop-official',
    kind: 'shared_folder',
    displayName: 'vividrop-official',
    countLabel: '文件夹',
    addedOffsetHours: 30,
  }),
  resource({
    resourceId: 'promo-video',
    kind: 'shared_folder',
    displayName: 'vividrop 宣传视频',
    countLabel: '文件夹',
    addedOffsetHours: 38,
  }),
  resource({
    resourceId: 'ui-design',
    kind: 'shared_folder',
    displayName: '海外版 UI 设计',
    countLabel: '文件夹',
    addedOffsetHours: 42,
  }),
  resource({
    resourceId: 'empty-folder',
    kind: 'shared_folder',
    displayName: '待整理',
    countLabel: '空文件夹',
    addedOffsetHours: 96,
  }),
];

const MOCK_FOLDER_CONTENTS: Record<string, RemoteResourceItem[]> = {
  codex: [
    resource({
      resourceId: 'codex-readme',
      kind: 'shared_file',
      displayName: 'README.md',
      fileSize: 12288,
      mediaType: 'document',
      modifiedLabel: '上次修改时间 1天前',
      preview: 'settings',
      addedOffsetHours: 28,
    }),
    resource({
      resourceId: 'codex-plan',
      kind: 'shared_file',
      displayName: 'project-plan.pdf',
      fileSize: 700416,
      mediaType: 'document',
      modifiedLabel: '上次修改时间 2天前',
      preview: 'blue',
      addedOffsetHours: 49,
    }),
    resource({
      resourceId: 'codex-shot',
      kind: 'shared_file',
      displayName: 'screen-recording.mov',
      fileSize: 1932735283,
      mediaType: 'video',
      modifiedLabel: '上次修改时间 1天前',
      preview: 'dark',
      addedOffsetHours: 21,
      downloadCount: 1,
    }),
    resource({
      resourceId: 'codex-archive',
      kind: 'shared_folder',
      displayName: 'Archive',
      countLabel: '文件夹',
      addedOffsetHours: 120,
    }),
  ],
  'codex-archive': [
    resource({
      resourceId: 'archive-backup',
      kind: 'shared_file',
      displayName: 'old-backup.tar.gz',
      fileSize: 104857600,
      mediaType: 'document',
      modifiedLabel: '上次修改时间 5天前',
      preview: 'settings',
      addedOffsetHours: 122,
    }),
  ],
  'vividrop-official': [
    resource({
      resourceId: 'official-guide',
      kind: 'shared_file',
      displayName: 'brand-guide.pdf',
      fileSize: 6710886,
      mediaType: 'document',
      modifiedLabel: '上次修改时间 3天前',
      preview: 'blue',
      addedOffsetHours: 72,
    }),
    resource({
      resourceId: 'official-release',
      kind: 'shared_file',
      displayName: 'release-note.docx',
      fileSize: 1258291,
      mediaType: 'document',
      modifiedLabel: '上次修改时间 1天前',
      preview: 'settings',
      addedOffsetHours: 24,
    }),
  ],
  'promo-video': [
    resource({
      resourceId: 'promo-launch',
      kind: 'shared_file',
      displayName: 'launch-trailer.mp4',
      fileSize: 897581056,
      mediaType: 'video',
      modifiedLabel: '上次修改时间 2天前',
      preview: 'dark',
      addedOffsetHours: 51,
      downloadCount: 4,
    }),
    resource({
      resourceId: 'promo-behind',
      kind: 'shared_file',
      displayName: 'behind-scenes.mov',
      fileSize: 1181116006,
      mediaType: 'video',
      modifiedLabel: '上次修改时间 4天前',
      preview: 'settings',
      addedOffsetHours: 99,
    }),
  ],
  'ui-design': [
    resource({
      resourceId: 'ui-home',
      kind: 'shared_file',
      displayName: 'home-screen.fig',
      fileSize: 29360128,
      mediaType: 'image',
      modifiedLabel: '上次修改时间 2天前',
      preview: 'blue',
      addedOffsetHours: 50,
    }),
    resource({
      resourceId: 'ui-history',
      kind: 'shared_file',
      displayName: 'history-screen.png',
      fileSize: 201728,
      mediaType: 'image',
      modifiedLabel: '上次修改时间 1天前',
      preview: 'settings',
      addedOffsetHours: 23,
    }),
    resource({
      resourceId: 'ui-settings',
      kind: 'shared_file',
      displayName: 'settings-screen.png',
      fileSize: 139264,
      mediaType: 'image',
      modifiedLabel: '上次修改时间 1天前',
      preview: 'blue',
      addedOffsetHours: 22,
    }),
  ],
  'empty-folder': [],
};

type RemoteResourcesPreviewGlobal = typeof globalThis & {
  __SYNCFLOW_REMOTE_RESOURCES_PREVIEW__?: boolean;
};

function isRemoteResourcesPreviewMode() {
  return (
    (globalThis as RemoteResourcesPreviewGlobal)
      .__SYNCFLOW_REMOTE_RESOURCES_PREVIEW__ === true
  );
}

function getPreviewRootItems() {
  return isRemoteResourcesPreviewMode() ? MOCK_ROOT_ITEMS : [];
}

function withRemoteAccessTimeout<T>(operation: Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(REMOTE_ACCESS_TIMEOUT_ERROR_MESSAGE));
    }, REMOTE_ACCESS_REQUEST_TIMEOUT_MS);
  });

  return Promise.race([operation, timeout]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

function isRemoteAccessTimeoutError(error: unknown) {
  return (
    error instanceof Error &&
    error.message === REMOTE_ACCESS_TIMEOUT_ERROR_MESSAGE
  );
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

async function withRemoteAccessReadyRetry<T>(
  operation: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (
    let attempt = 1;
    attempt <= REMOTE_ACCESS_READY_RETRY_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await withRemoteAccessTimeout(operation());
    } catch (error) {
      lastError = error;
      if (
        isRemoteAccessTimeoutError(error) ||
        attempt >= REMOTE_ACCESS_READY_RETRY_ATTEMPTS
      ) {
        throw error;
      }
      await delay(REMOTE_ACCESS_READY_RETRY_DELAY_MS);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Remote access request failed');
}

function isFolder(item: RemoteResourceItem) {
  return item.kind === 'shared_folder';
}

function isVideo(item: RemoteResourceItem) {
  return (
    item.mediaType === 'video' ||
    /\.(mp4|mov|m4v|avi|mkv|webm)$/i.test(item.displayName)
  );
}

function isImage(item: RemoteResourceItem) {
  return (
    item.mediaType === 'image' ||
    /\.(jpg|jpeg|png|gif|webp|heic|fig)$/i.test(item.displayName)
  );
}

function getItemIconType(item: RemoteResourceItem): RemoteResourceIconType {
  if (isFolder(item)) return 'folder';
  if (isVideo(item)) return 'video';
  if (isImage(item)) return 'photo';
  return 'file';
}

function getItemSize(item: RemoteResourceItem) {
  return isFolder(item) ? Number.POSITIVE_INFINITY : (item.fileSize ?? 0);
}

function getItemTime(item: RemoteResourceItem) {
  const timestamp = new Date(item.addedAt).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function getItemMeta(item: RemoteResourceItem) {
  if (isFolder(item)) return item.countLabel ?? '文件夹';
  const size = formatBytes(item.fileSize ?? 0);
  const modified = item.modifiedLabel?.replace('上次修改时间 ', '') ?? '刚刚';
  return `${size} · ${modified}`;
}

function firstNonEmptyString(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const normalized = value?.trim();
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function normalizeSharedFilesReachability(
  value: unknown,
): SharedFilesReachabilityDTO | null {
  const record = asRecord(value);
  if (!record) return null;

  const deviceId = nonEmptyString(record.deviceId);
  const state = nonEmptyString(record.state);
  if (!deviceId || !state) return null;

  const route = nonEmptyString(record.route);
  const normalizedRoute =
    route === 'lan' || route === 'tunnel' || route === 'relay' ? route : null;

  if (
    state !== 'unknown' &&
    state !== 'available' &&
    state !== 'unavailable' &&
    state !== 'waking' &&
    state !== 'wake_setup_required' &&
    state !== 'wake_unavailable'
  ) {
    return null;
  }

  return {
    deviceId,
    state,
    route: normalizedRoute,
    reason: nonEmptyString(record.reason) ?? '',
    updatedAt: nonEmptyString(record.updatedAt) ?? new Date(0).toISOString(),
  };
}

function getBindingSharedFilesReachability(
  binding: unknown,
): SharedFilesReachabilityDTO | null {
  const record = asRecord(binding);
  return normalizeSharedFilesReachability(record?.sharedFilesReachability);
}

function isPrivateIPv4(value: string | null): boolean {
  if (!value) return false;
  const parts = value.split('.').map(part => Number(part));
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part))) {
    return false;
  }
  const [first, second] = parts;
  if (first === 10) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  if (first === 169 && second === 254) return true;
  return false;
}

function getSuccessfulBrowseReachability(
  binding: unknown,
  nativeReachability: SharedFilesReachabilityDTO | null,
): SharedFilesReachabilityDTO | null {
  if (nativeReachability?.route) {
    return {
      ...nativeReachability,
      state: 'available',
      reason: nativeReachability.reason || 'browse_shared_files_success',
      updatedAt: new Date().toISOString(),
    };
  }

  const record = asRecord(binding);
  const host = nonEmptyString(record?.host);
  const isConnectedBinding =
    nonEmptyString(record?.connectionState) === 'connected';
  if ((!host || !isPrivateIPv4(host)) && !isConnectedBinding) {
    return null;
  }

  return {
    deviceId:
      nonEmptyString(record?.deviceId) ??
      nonEmptyString(record?.desktopDeviceId) ??
      host ??
      'bound-desktop',
    state: 'available',
    route: 'lan',
    reason: 'browse_shared_files_success',
    updatedAt: new Date().toISOString(),
  };
}

function getDisplayedSharedFilesReachability(
  current: SharedFilesReachabilityDTO | null,
  lastSuccessful: SharedFilesReachabilityDTO | null,
): SharedFilesReachabilityDTO | null {
  if (!lastSuccessful) return current;
  if (!current) return lastSuccessful;

  if (
    current.state === 'unknown' &&
    (current.route === 'tunnel' || current.route === 'relay')
  ) {
    return current;
  }

  if (current.state === 'unknown' || current.state === 'waking') {
    return lastSuccessful;
  }

  return current;
}

function getRouteStatusViewModel(
  reachability: SharedFilesReachabilityDTO | null,
): RouteStatusViewModel | null {
  if (!reachability) return null;

  if (reachability.state === 'available') {
    if (reachability.route === 'lan') {
      return { label: '局域网', tone: 'online' };
    }
    if (reachability.route === 'tunnel') {
      return { label: 'P2P', tone: 'online' };
    }
    if (reachability.route === 'relay') {
      return { label: '中继服务器', tone: 'online' };
    }
    return null;
  }

  if (reachability.state === 'unknown') {
    if (reachability.route === 'tunnel') {
      return { label: 'P2P 连接中', tone: 'pending' };
    }
    if (reachability.route === 'relay') {
      return { label: '中继服务器连接中', tone: 'pending' };
    }
  }

  if (reachability.state === 'waking') {
    return { label: '唤醒中', tone: 'pending' };
  }

  if (
    reachability.state === 'unavailable' ||
    reachability.state === 'wake_unavailable'
  ) {
    return { label: '不可达', tone: 'offline' };
  }

  if (reachability.state === 'wake_setup_required') {
    return { label: '需设置唤醒', tone: 'pending' };
  }

  return null;
}

function getBindingDesktopDisplayName(
  binding: Partial<BindingStateDTO> | null | undefined,
) {
  if (!binding) return null;
  return firstNonEmptyString(
    binding.deviceAlias,
    binding.deviceName,
    binding.host,
    binding.deviceId,
  );
}

function getResourceDesktopDisplayName(items: RemoteResourceItem[]) {
  for (const item of items) {
    const desktopDisplayName = firstNonEmptyString(item.desktopDeviceId);
    if (desktopDisplayName) {
      return desktopDisplayName;
    }
  }
  return null;
}

function getFolderKey(folder: FolderCrumb) {
  return `${folder.rootResourceId ?? folder.id}::${folder.path ?? ''}`;
}

function getModifiedLabel(modifiedAt: string) {
  const timestamp = new Date(modifiedAt).getTime();
  if (Number.isNaN(timestamp)) return undefined;
  const diffMs = Math.max(0, Date.now() - timestamp);
  const dayMs = 24 * 60 * 60 * 1000;
  if (diffMs < dayMs) return '上次修改时间 今天';
  return `上次修改时间 ${Math.floor(diffMs / dayMs)}天前`;
}

function personalDirectoryResourceId(path: string) {
  const encodedPath = path
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(segment => segment.trim().length > 0)
    .map(segment => encodeURIComponent(segment))
    .join('/');
  return `personal-dir:${encodedPath}`;
}

function directoryFileToResourceItem({
  file,
  desktopDisplayName,
}: {
  file: DirectoryFileDTO;
  desktopDisplayName: string | null;
}): RemoteResourceItem {
  const resourceId = personalDirectoryResourceId(file.path);
  const mediaType =
    file.isDirectory || file.type === 'other' ? undefined : file.type;
  return {
    resourceId,
    desktopDeviceId: desktopDisplayName ?? FALLBACK_DESKTOP_LABEL,
    kind: file.isDirectory ? 'shared_folder' : 'shared_file',
    displayName: file.name,
    fileSize: file.isDirectory ? undefined : file.size,
    mediaType,
    status: 'available',
    addedAt: file.modifiedAt,
    downloadCount: 0,
    countLabel: file.isDirectory ? '文件夹' : undefined,
    modifiedLabel: getModifiedLabel(file.modifiedAt),
    sharedRootResourceId: file.isDirectory ? resourceId : undefined,
    relativePath: '',
    thumbnailUrl:
      !file.isDirectory &&
      file.type === 'image' &&
      typeof file.thumbnailUrl === 'string' &&
      file.thumbnailUrl.trim().length > 0
        ? file.thumbnailUrl.trim()
        : undefined,
  };
}

function getRemoteAccessSubtitle({
  currentFolder,
  desktopDisplayName,
  previewMode,
}: {
  currentFolder: FolderCrumb | null;
  desktopDisplayName: string | null;
  previewMode: boolean;
}) {
  const directoryLabel = currentFolder?.name ?? ROOT_DIRECTORY_LABEL;

  if (previewMode) {
    return `${PREVIEW_DESKTOP_NAME} / ${directoryLabel}`;
  }

  if (desktopDisplayName) {
    return `${desktopDisplayName} / ${directoryLabel}`;
  }

  if (currentFolder) {
    return `${FALLBACK_DESKTOP_LABEL} / ${directoryLabel}`;
  }

  return UNBOUND_REMOTE_SUBTITLE;
}

export function RemoteAccessGlobalScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [networkDisconnected, setNetworkDisconnected] = useState(false);
  const [rootItems, setRootItems] = useState<RemoteResourceItem[]>([]);
  const [folderItemsByKey, setFolderItemsByKey] = useState<
    Record<string, RemoteResourceItem[]>
  >({});
  const [folderLoading, setFolderLoading] = useState(false);
  const [folderLoadError, setFolderLoadError] = useState(false);
  const [desktopDisplayName, setDesktopDisplayName] = useState<string | null>(
    null,
  );
  const [previewMode, setPreviewMode] = useState(false);
  const [folderStack, setFolderStack] = useState<FolderCrumb[]>([]);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>('name');
  const [searchQuery, setSearchQuery] = useState('');
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('list');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sharing, setSharing] = useState(false);
  const [showSortSheet, setShowSortSheet] = useState(false);
  const [showShareSheet, setShowShareSheet] = useState(false);
  const [sharedFilesReachability, setSharedFilesReachability] =
    useState<SharedFilesReachabilityDTO | null>(null);
  const [
    lastSuccessfulSharedFilesReachability,
    setLastSuccessfulSharedFilesReachability,
  ] = useState<SharedFilesReachabilityDTO | null>(null);
  const [resourcePreview, setResourcePreview] =
    useState<RemoteResourcePreviewState | null>(null);

  const currentFolder = folderStack[folderStack.length - 1] ?? null;

  useEffect(() => {
    const nativeSyncEngine = NativeModules.NativeSyncEngine;
    if (!nativeSyncEngine) {
      setSharedFilesReachability(null);
      return undefined;
    }

    const emitter = new NativeEventEmitter(nativeSyncEngine);
    const subscription = emitter.addListener(
      'onSharedFilesReachabilityChanged',
      payload => {
        setSharedFilesReachability(normalizeSharedFilesReachability(payload));
      },
    );

    return () => {
      subscription.remove();
    };
  }, []);

  const loadData = useCallback(async () => {
    setNetworkDisconnected(false);
    setFolderLoadError(false);
    setFolderLoading(false);
    setFolderItemsByKey({});
    setDesktopDisplayName(null);
    try {
      const { NativeSyncEngine } = NativeModules;
      if (!NativeSyncEngine) {
        const previewItems = getPreviewRootItems();
        setPreviewMode(previewItems.length > 0);
        setRootItems(previewItems);
        setLoading(false);
        return;
      }

      const binding = await NativeSyncEngine.getBindingState();
      setSharedFilesReachability(getBindingSharedFilesReachability(binding));
      if (!binding || !binding.host) {
        const previewItems = getPreviewRootItems();
        setPreviewMode(previewItems.length > 0);
        setRootItems(previewItems);
        if (previewItems.length === 0) {
          setSharedFilesReachability(null);
          setLastSuccessfulSharedFilesReachability(null);
        }
        setLoading(false);
        return;
      }

      const bindingDisplayName = getBindingDesktopDisplayName(
        binding as Partial<BindingStateDTO>,
      );
      setDesktopDisplayName(bindingDisplayName);

      const result = await withRemoteAccessReadyRetry(() =>
        listGlobalRemoteAccessResources(),
      );
      const remoteItems = result ?? [];
      const refreshedBinding = await NativeSyncEngine.getBindingState?.();
      const refreshedReachability =
        getBindingSharedFilesReachability(refreshedBinding);
      const successfulReachability = getSuccessfulBrowseReachability(
        refreshedBinding ?? binding,
        refreshedReachability ?? getBindingSharedFilesReachability(binding),
      );
      if (successfulReachability) {
        setLastSuccessfulSharedFilesReachability(successfulReachability);
        setSharedFilesReachability(
          refreshedReachability?.state === 'available'
            ? refreshedReachability
            : successfulReachability,
        );
      } else if (refreshedReachability) {
        setSharedFilesReachability(refreshedReachability);
      }
      setDesktopDisplayName(
        firstNonEmptyString(
          bindingDisplayName,
          getResourceDesktopDisplayName(remoteItems),
        ),
      );
      const previewItems = getPreviewRootItems();
      if (remoteItems.length > 0 || previewItems.length === 0) {
        setPreviewMode(false);
        setRootItems(remoteItems);
      } else {
        setPreviewMode(true);
        setRootItems(previewItems);
      }
    } catch (e) {
      console.warn('[RemoteAccessScreen] Failed to load data:', e);
      const previewItems = getPreviewRootItems();
      if (previewItems.length > 0) {
        setPreviewMode(true);
        setRootItems(previewItems);
      } else {
        setPreviewMode(false);
        setRootItems([]);
        setNetworkDisconnected(true);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFolderContents = useCallback(
    async (folder: FolderCrumb) => {
      if (folder.preview || previewMode) return;
      if (!folder.rootResourceId) {
        setFolderLoadError(true);
        return;
      }

      const folderKey = getFolderKey(folder);
      const rootResourceId = folder.rootResourceId;
      const folderPath = folder.path ?? '';
      setFolderLoading(true);
      setFolderLoadError(false);
      try {
        const listing = await withRemoteAccessReadyRetry(() =>
          listGlobalRemoteAccessFolderContents(rootResourceId, folderPath),
        );
        const folderItems = listing.files.map(file =>
          directoryFileToResourceItem({
            file,
            desktopDisplayName,
          }),
        );
        const binding =
          await NativeModules.NativeSyncEngine?.getBindingState?.();
        const successfulReachability = getSuccessfulBrowseReachability(
          binding,
          getBindingSharedFilesReachability(binding),
        );
        if (successfulReachability) {
          setLastSuccessfulSharedFilesReachability(successfulReachability);
        }
        setFolderItemsByKey(prev => ({
          ...prev,
          [folderKey]: folderItems,
        }));
      } catch (e) {
        console.warn('[RemoteAccessScreen] Failed to load folder contents:', e);
        setFolderItemsByKey(prev => ({
          ...prev,
          [folderKey]: [],
        }));
        setFolderLoadError(true);
      } finally {
        setFolderLoading(false);
      }
    },
    [desktopDisplayName, previewMode],
  );

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      loadData();
    }, [loadData]),
  );

  const resetSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds([]);
    setShowShareSheet(false);
  }, []);

  const handleDownload = useCallback(
    async (item: RemoteResourceItem) => {
      if (downloadingId) return;
      setDownloadingId(item.resourceId);

      try {
        const { NativeSyncEngine } = NativeModules;
        const binding = await NativeSyncEngine?.getBindingState();
        if (!binding || !binding.host) {
          Alert.alert(t('sharedFiles.deviceUnavailable.title') || '設備不可用');
          return;
        }

        const result = await downloadGlobalRemoteAccessResource(
          item.resourceId,
        );
        if (!isDownloadSavedLocally(result)) {
          Alert.alert(
            LOCAL_SAVE_UNSUPPORTED_TITLE,
            LOCAL_SAVE_UNSUPPORTED_MESSAGE,
          );
          return;
        }

        await recordDownloadedFile({
          resourceId: item.resourceId,
          filename: item.displayName,
          fileSize: item.fileSize,
          mediaType: item.mediaType,
          localPath: result.localPath,
          thumbnailUrl: item.thumbnailUrl,
          savedToPhotos: result.savedToPhotos,
        });

        Alert.alert(
          t('sharedFiles.dialogs.downloadComplete') || '下載完成',
          result.savedToPhotos
            ? t('sharedFiles.dialogs.downloadSavedToPhotos', {
                name: item.displayName,
                location:
                  t('sharedFiles.dialogs.savedLocationPhotos') || '相簿',
              }) || `${item.displayName} 已儲存至相簿`
            : t('sharedFiles.dialogs.downloadSavedToFiles', {
                name: item.displayName,
              }) || `${item.displayName} 已保存到文件`,
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

  const currentItems = useMemo(() => {
    if (!currentFolder) return rootItems;
    if (previewMode || currentFolder.preview) {
      return MOCK_FOLDER_CONTENTS[currentFolder.id] ?? [];
    }
    return folderItemsByKey[getFolderKey(currentFolder)] ?? [];
  }, [currentFolder, folderItemsByKey, previewMode, rootItems]);

  const visibleItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const filtered = query
      ? currentItems.filter(item =>
          item.displayName.toLowerCase().includes(query),
        )
      : currentItems;

    return [...filtered].sort((a, b) => {
      if (sortBy === 'name')
        return a.displayName.localeCompare(b.displayName, 'zh-CN');
      if (sortBy === 'size') return getItemSize(b) - getItemSize(a);
      if (isFolder(a) && !isFolder(b)) return -1;
      if (!isFolder(a) && isFolder(b)) return 1;
      return getItemTime(b) - getItemTime(a);
    });
  }, [currentItems, searchQuery, sortBy]);

  const selectedItems = useMemo(
    () =>
      currentItems.filter(
        item => selectedIds.includes(item.resourceId) && !isFolder(item),
      ),
    [currentItems, selectedIds],
  );

  const openFolder = useCallback(
    (item: RemoteResourceItem) => {
      const nextFolder: FolderCrumb = {
        id: item.resourceId,
        name: item.displayName,
        rootResourceId: item.sharedRootResourceId ?? item.resourceId,
        path: item.relativePath ?? '',
        preview: previewMode,
      };
      setFolderStack(stack => [...stack, nextFolder]);
      setLayoutMode('list');
      setSearchQuery('');
      setFolderLoadError(false);
      resetSelection();
      void loadFolderContents(nextFolder);
    },
    [loadFolderContents, previewMode, resetSelection],
  );

  const isDesktopBound = useCallback(async (): Promise<boolean> => {
    const { NativeSyncEngine } = NativeModules;
    const binding = await NativeSyncEngine?.getBindingState();
    return Boolean(binding?.host);
  }, []);

  const handleOpenFile = useCallback(
    async (item: RemoteResourceItem) => {
      if (isFolder(item)) return;

      try {
        const bound = await isDesktopBound();
        if (!bound) {
          Alert.alert(t('sharedFiles.deviceUnavailable.title') || '設備不可用');
          return;
        }

        if (
          isImageFile(item.mediaType, item.displayName) ||
          isVideoFile(item.mediaType, item.displayName)
        ) {
          const url = await getGlobalRemoteAccessPreviewUrl(item.resourceId);
          setResourcePreview({ item, url });
          return;
        }

        if (!canPreviewDocumentFile(item.mediaType, item.displayName)) {
          try {
            const localPath = await prepareGlobalRemoteAccessShareFile(
              item.resourceId,
              item.displayName,
            );
            await openFileWithOtherApp(localPath, item.displayName);
          } catch (err) {
            console.warn(
              '[RemoteAccessGlobalScreen] Open with other app failed:',
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

        const localPath = await prepareGlobalRemoteAccessPreview(
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
    [isDesktopBound, t],
  );

  const goBack = useCallback(() => {
    if (currentFolder) {
      setFolderStack(stack => stack.slice(0, -1));
      setSearchQuery('');
      setFolderLoadError(false);
      setFolderLoading(false);
      resetSelection();
      return;
    }
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.reset({ index: 0, routes: [{ name: 'SharedFiles' }] });
  }, [currentFolder, navigation, resetSelection]);

  const toggleSelection = useCallback((item: RemoteResourceItem) => {
    if (isFolder(item)) return;
    setSelectedIds(prev =>
      prev.includes(item.resourceId)
        ? prev.filter(id => id !== item.resourceId)
        : [...prev, item.resourceId],
    );
  }, []);

  const handleSelectionButton = useCallback(() => {
    if (selectionMode) {
      resetSelection();
      return;
    }
    setSelectionMode(true);
    setSelectedIds([]);
  }, [resetSelection, selectionMode]);

  const handleSelectedDownload = useCallback(async () => {
    if (selectedItems.length === 0 || downloadingId) return;
    for (const item of selectedItems) {
      await handleDownload(item);
    }
  }, [downloadingId, handleDownload, selectedItems]);

  const handleSelectedShare = useCallback(async () => {
    if (selectedItems.length === 0 || sharing) return;
    setSharing(true);
    try {
      const { NativeSyncEngine } = NativeModules;
      const binding = await NativeSyncEngine?.getBindingState();
      if (!binding || !binding.host) {
        Alert.alert(t('sharedFiles.deviceUnavailable.title') || '設備不可用');
        return;
      }

      await shareGlobalRemoteAccessResources(
        selectedItems.map(item => ({
          resourceId: item.resourceId,
          displayName: item.displayName,
        })),
      );
      resetSelection();
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
  }, [resetSelection, selectedItems, sharing, t]);

  const retryLoadData = useCallback(() => {
    setLoading(true);
    loadData();
  }, [loadData]);

  const retryLoadFolder = useCallback(() => {
    if (currentFolder) {
      void loadFolderContents(currentFolder);
    }
  }, [currentFolder, loadFolderContents]);

  const sortLabel =
    SORT_OPTIONS.find(option => option.id === sortBy)?.label ?? '名称';
  const queryActive = searchQuery.trim().length > 0;
  const title = currentFolder
    ? currentFolder.name
    : t('sharedFiles.remoteAccess.title') || '遠端訪問電腦';
  const subtitle = getRemoteAccessSubtitle({
    currentFolder,
    desktopDisplayName,
    previewMode,
  });
  const routeStatus = getRouteStatusViewModel(
    networkDisconnected
      ? null
      : getDisplayedSharedFilesReachability(
          sharedFilesReachability,
          lastSuccessfulSharedFilesReachability,
        ),
  );

  const renderItem = ({ item }: { item: RemoteResourceItem }) => {
    return layoutMode === 'grid'
      ? renderGridItem({
          item,
          downloadingId,
          onDownload: handleDownload,
          onOpenFile: handleOpenFile,
          onOpenFolder: openFolder,
          onToggleSelection: toggleSelection,
          selected: selectedIds.includes(item.resourceId),
          selectionMode,
        })
      : renderListItem({
          item,
          downloadingId,
          onDownload: handleDownload,
          onOpenFile: handleOpenFile,
          onOpenFolder: openFolder,
          onToggleSelection: toggleSelection,
          selected: selectedIds.includes(item.resourceId),
          selectionMode,
        });
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
            <Icon name="chevron-back" size={22} color="#59616D" />
          </TouchableOpacity>
          <View style={styles.headerText}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {title}
            </Text>
            <View style={styles.headerSubtitleRow}>
              <Text style={styles.headerSubtitle} numberOfLines={1}>
                {subtitle}
              </Text>
              {routeStatus ? (
                <RemoteAccessRouteBadge status={routeStatus} variant="inline" />
              ) : null}
            </View>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={[
                styles.selectionButton,
                selectionMode ? styles.selectionButtonActive : null,
              ]}
              onPress={handleSelectionButton}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.selectionButtonText,
                  selectionMode ? styles.selectionButtonActiveText : null,
                ]}
              >
                {selectionMode
                  ? '完成'
                  : t('sharedFiles.remoteAccess.select') || '選擇'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.searchBox}>
          <Icon name="search-outline" size={16} color="#7B8490" />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={currentFolder ? '搜索当前文件夹' : '搜索电脑文件'}
            placeholderTextColor="#9AA3AE"
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
        </View>

        <View style={styles.toolbarCard}>
          <TouchableOpacity
            style={styles.sortButton}
            activeOpacity={0.7}
            onPress={() => setShowSortSheet(true)}
          >
            <Rows3
              testID="remote-toolbar-sort-icon"
              size={16}
              color={colors.primary}
              strokeWidth={2}
            />
            <Text style={styles.sortButtonText}>{sortLabel}</Text>
          </TouchableOpacity>

          {selectionMode ? (
            <View style={styles.selectionActions}>
              <TouchableOpacity
                style={[
                  styles.actionButton,
                  selectedItems.length === 0
                    ? styles.actionButtonDisabled
                    : null,
                ]}
                disabled={selectedItems.length === 0}
                activeOpacity={0.7}
                onPress={handleSelectedDownload}
              >
                <Text
                  style={[
                    styles.actionButtonText,
                    selectedItems.length === 0
                      ? styles.actionButtonDisabledText
                      : null,
                  ]}
                >
                  下载
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.actionButtonSecondary,
                  selectedItems.length === 0 || sharing
                    ? styles.actionButtonDisabled
                    : null,
                ]}
                disabled={selectedItems.length === 0 || sharing}
                activeOpacity={0.7}
                onPress={handleSelectedShare}
              >
                {sharing ? (
                  <ActivityIndicator size="small" color="#9AA3AE" />
                ) : (
                  <Text
                    style={[
                      styles.actionButtonSecondaryText,
                      selectedItems.length === 0
                        ? styles.actionButtonDisabledText
                        : null,
                    ]}
                  >
                    分享
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.layoutToggle}>
              <TouchableOpacity
                style={[
                  styles.layoutButton,
                  layoutMode === 'list' ? styles.layoutButtonActive : null,
                ]}
                accessibilityLabel="列表视图"
                activeOpacity={0.7}
                onPress={() => setLayoutMode('list')}
              >
                <Rows3
                  testID="remote-toolbar-list-icon"
                  size={17}
                  color={layoutMode === 'list' ? colors.primary : '#7B8490'}
                  strokeWidth={2}
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.layoutButton,
                  layoutMode === 'grid' ? styles.layoutButtonActive : null,
                ]}
                accessibilityLabel="网格视图"
                activeOpacity={0.7}
                onPress={() => setLayoutMode('grid')}
              >
                <Grid2X2
                  testID="remote-toolbar-grid-icon"
                  size={17}
                  color={layoutMode === 'grid' ? colors.primary : '#7B8490'}
                  strokeWidth={2}
                />
              </TouchableOpacity>
            </View>
          )}
        </View>

        {loading ? (
          <View style={styles.centeredCard}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.centeredTitle}>远程资源加载中</Text>
            <Text style={styles.centeredSubtitle}>
              正在读取电脑端共享目录。
            </Text>
          </View>
        ) : networkDisconnected ? (
          <NetworkDisconnectedState onRetry={retryLoadData} />
        ) : folderLoading ? (
          <View style={styles.centeredCard}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.centeredTitle}>文件夹加载中</Text>
            <Text style={styles.centeredSubtitle}>
              正在读取电脑端目录内容。
            </Text>
          </View>
        ) : folderLoadError ? (
          <FolderLoadErrorState onRetry={retryLoadFolder} />
        ) : visibleItems.length === 0 ? (
          <EmptyState queryActive={queryActive} currentFolder={currentFolder} />
        ) : (
          <FlatList
            key={layoutMode}
            data={visibleItems}
            keyExtractor={item => item.resourceId}
            renderItem={renderItem}
            initialNumToRender={10}
            maxToRenderPerBatch={10}
            windowSize={7}
            numColumns={layoutMode === 'grid' ? 3 : 1}
            columnWrapperStyle={
              layoutMode === 'grid' ? styles.gridRow : undefined
            }
            contentContainerStyle={[
              styles.listContent,
              layoutMode === 'grid' ? styles.gridContent : null,
            ]}
            showsVerticalScrollIndicator={false}
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
      <ShareSheet
        visible={showShareSheet}
        selectedCount={selectedItems.length}
        onClose={() => setShowShareSheet(false)}
      />
      <RemoteResourcePreviewModal
        preview={resourcePreview}
        onClose={() => setResourcePreview(null)}
      />
    </GlobalGradientBackground>
  );
}

function RemoteAccessRouteBadge({
  status,
  variant = 'default',
}: {
  status: RouteStatusViewModel;
  variant?: 'default' | 'inline';
}) {
  const inline = variant === 'inline';
  return (
    <View
      accessibilityLabel={`远端访问连接方式：${status.label}`}
      style={[
        styles.routeBadge,
        status.tone === 'pending' ? styles.routeBadgePending : null,
        status.tone === 'offline' ? styles.routeBadgeOffline : null,
        inline ? styles.routeBadgeInline : null,
      ]}
    >
      <View
        style={[
          styles.routeBadgeDot,
          inline ? styles.routeBadgeDotInline : null,
          status.tone === 'pending' ? styles.routeBadgeDotPending : null,
          status.tone === 'offline' ? styles.routeBadgeDotOffline : null,
        ]}
      />
      <Text
        style={[
          styles.routeBadgeText,
          inline ? styles.routeBadgeTextInline : null,
          status.tone === 'pending' ? styles.routeBadgeTextPending : null,
          status.tone === 'offline' ? styles.routeBadgeTextOffline : null,
        ]}
        numberOfLines={1}
      >
        {status.label}
      </Text>
    </View>
  );
}

function NetworkDisconnectedState({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={styles.centeredCard}>
      <View style={styles.disconnectedIcon}>
        <Icon name="cloud-offline-outline" size={28} color="#DC2626" />
      </View>
      <Text style={styles.centeredTitle}>网络断开</Text>
      <Text style={styles.centeredSubtitle}>
        当前路径会保留，恢复网络或电脑端在线后可以继续访问。
      </Text>
      <TouchableOpacity
        style={styles.retryButton}
        activeOpacity={0.75}
        accessibilityRole="button"
        onPress={onRetry}
      >
        <Text style={styles.retryButtonText}>重试连接</Text>
      </TouchableOpacity>
    </View>
  );
}

function FolderLoadErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={styles.centeredCard}>
      <View style={styles.disconnectedIcon}>
        <Icon name="alert-circle-outline" size={28} color="#DC2626" />
      </View>
      <Text style={styles.centeredTitle}>目录加载失败</Text>
      <Text style={styles.centeredSubtitle}>
        无法读取这个共享文件夹，请确认电脑端文件仍然存在。
      </Text>
      <TouchableOpacity
        style={styles.retryButton}
        activeOpacity={0.75}
        accessibilityRole="button"
        onPress={onRetry}
      >
        <Text style={styles.retryButtonText}>重新加载</Text>
      </TouchableOpacity>
    </View>
  );
}

function RemoteResourceTypeIcon({
  type,
  style,
}: {
  type: RemoteResourceIconType;
  style: StyleProp<ViewStyle>;
}) {
  const gradientId = `remoteResource${type}Gradient`;

  return (
    <View
      testID={`remote-resource-icon-${type}`}
      style={[styles.remoteResourceIcon, style]}
    >
      <Svg
        style={StyleSheet.absoluteFillObject}
        width="100%"
        height="100%"
        viewBox="0 0 46 46"
      >
        <Defs>
          <LinearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            {REMOTE_RESOURCE_ICON_GRADIENTS[type].map(stop => (
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
      <RemoteResourceGlyph type={type} />
    </View>
  );
}

function RemoteResourceGlyph({ type }: { type: RemoteResourceIconType }) {
  if (type === 'photo') {
    return (
      <>
        <View style={styles.photoIconDot} />
        <View style={styles.photoIconHillLight} />
        <View style={styles.photoIconHillBlue} />
        <View style={styles.remoteResourceGlyphCenter}>
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

  if (type === 'folder') {
    return (
      <View style={styles.remoteResourceGlyphCenter}>
        <FolderOpen size={22} color="#AD761D" strokeWidth={1.8} />
      </View>
    );
  }

  return (
    <>
      <View style={styles.fileIconCorner} />
      <View style={styles.remoteResourceGlyphCenter}>
        <FileText size={20} color="#59616D" strokeWidth={1.8} />
      </View>
    </>
  );
}

function renderListItem({
  item,
  downloadingId,
  onDownload,
  onOpenFile,
  onOpenFolder,
  onToggleSelection,
  selected,
  selectionMode,
}: {
  item: RemoteResourceItem;
  downloadingId: string | null;
  onDownload: (item: RemoteResourceItem) => void;
  onOpenFile: (item: RemoteResourceItem) => void;
  onOpenFolder: (item: RemoteResourceItem) => void;
  onToggleSelection: (item: RemoteResourceItem) => void;
  selected: boolean;
  selectionMode: boolean;
}) {
  const folder = isFolder(item);
  const iconType = getItemIconType(item);
  const downloading = downloadingId === item.resourceId;

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={folder || selectionMode ? 0.7 : 1}
      onPress={() => {
        if (folder) {
          onOpenFolder(item);
          return;
        }
        if (selectionMode) {
          onToggleSelection(item);
          return;
        }
        onOpenFile(item);
      }}
    >
      <RemoteResourceVisual
        item={item}
        iconType={iconType}
        style={styles.iconWrapper}
      />
      <View style={styles.infoWrapper}>
        <Text style={styles.filename} numberOfLines={1}>
          {item.displayName}
        </Text>
        <Text style={styles.metaText} numberOfLines={1}>
          {getItemMeta(item)}
        </Text>
      </View>
      {selectionMode && !folder ? (
        <SelectionMark
          selected={selected}
          onPress={() => onToggleSelection(item)}
        />
      ) : folder ? (
        <TouchableOpacity
          style={styles.iconActionButton}
          activeOpacity={0.7}
          onPress={() => onOpenFolder(item)}
        >
          <Icon name="chevron-forward" size={16} color="#9AA3AE" />
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={styles.iconActionButton}
          activeOpacity={0.7}
          disabled={downloading}
          onPress={() => onDownload(item)}
        >
          {downloading ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Icon name="download-outline" size={18} color={colors.primary} />
          )}
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

function renderGridItem({
  item,
  downloadingId,
  onDownload,
  onOpenFile,
  onOpenFolder,
  onToggleSelection,
  selected,
  selectionMode,
}: {
  item: RemoteResourceItem;
  downloadingId: string | null;
  onDownload: (item: RemoteResourceItem) => void;
  onOpenFile: (item: RemoteResourceItem) => void;
  onOpenFolder: (item: RemoteResourceItem) => void;
  onToggleSelection: (item: RemoteResourceItem) => void;
  selected: boolean;
  selectionMode: boolean;
}) {
  const folder = isFolder(item);
  const iconType = getItemIconType(item);
  const downloading = downloadingId === item.resourceId;

  return (
    <View style={styles.gridCard}>
      <TouchableOpacity
        style={styles.gridPreview}
        activeOpacity={folder || selectionMode ? 0.7 : 1}
        onPress={() => {
          if (folder) {
            onOpenFolder(item);
            return;
          }
          if (selectionMode) {
            onToggleSelection(item);
            return;
          }
          onOpenFile(item);
        }}
      >
        <RemoteResourceVisual
          item={item}
          iconType={iconType}
          style={styles.gridIconWrapper}
        />
        {selectionMode && !folder ? (
          <SelectionMark
            selected={selected}
            onPress={() => onToggleSelection(item)}
            style={styles.gridSelectionMark}
          />
        ) : null}
        {!selectionMode && !folder ? (
          <TouchableOpacity
            style={styles.gridDownloadButton}
            activeOpacity={0.7}
            disabled={downloading}
            onPress={() => onDownload(item)}
          >
            {downloading ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Icon name="download-outline" size={15} color={colors.primary} />
            )}
          </TouchableOpacity>
        ) : null}
      </TouchableOpacity>
      <Text style={styles.gridName} numberOfLines={2}>
        {item.displayName}
      </Text>
      <Text style={styles.gridMeta} numberOfLines={1}>
        {folder ? getItemMeta(item) : formatBytes(item.fileSize ?? 0)}
      </Text>
    </View>
  );
}

function RemoteResourceVisual({
  item,
  iconType,
  style,
}: {
  item: RemoteResourceItem;
  iconType: RemoteResourceIconType;
  style: StyleProp<ViewStyle>;
}) {
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const thumbnailUrl =
    isImage(item) && !thumbnailFailed ? item.thumbnailUrl?.trim() : undefined;

  if (thumbnailUrl) {
    return (
      <View style={style}>
        <Image
          testID="remote-resource-thumbnail-image"
          source={{ uri: thumbnailUrl }}
          style={styles.remoteResourceThumbnail}
          resizeMode="cover"
          onError={() => setThumbnailFailed(true)}
        />
      </View>
    );
  }

  return <RemoteResourceTypeIcon type={iconType} style={style} />;
}

function RemoteResourcePreviewModal({
  preview,
  onClose,
}: {
  preview: RemoteResourcePreviewState | null;
  onClose: () => void;
}) {
  if (!preview) return null;

  const video = isVideoFile(preview.item.mediaType, preview.item.displayName);

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
            {preview.item.displayName}
          </Text>
          <TouchableOpacity
            style={styles.mediaPreviewCloseButton}
            accessibilityRole="button"
            accessibilityLabel="关闭预览"
            activeOpacity={0.7}
            onPress={onClose}
          >
            <Icon name="close" size={18} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
        <View style={styles.mediaPreviewBody}>
          {video ? (
            <Video
              testID="remote-resource-preview-video"
              source={{ uri: preview.url }}
              style={styles.mediaPreviewFullMedia}
              resizeMode="contain"
              controls
              paused={false}
              muted={false}
            />
          ) : (
            <Image
              testID="remote-resource-preview-image"
              source={{ uri: preview.url }}
              style={styles.mediaPreviewFullMedia}
              resizeMode="contain"
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

function SelectionMark({
  selected,
  onPress,
  style,
}: {
  selected: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.selectionMark,
        selected ? styles.selectionMarkActive : null,
        style,
      ]}
      activeOpacity={0.7}
      onPress={onPress}
    >
      {selected ? <Icon name="checkmark" size={14} color="#FFFFFF" /> : null}
    </TouchableOpacity>
  );
}

function EmptyState({
  queryActive,
  currentFolder,
}: {
  queryActive: boolean;
  currentFolder: FolderCrumb | null;
}) {
  if (queryActive) {
    return (
      <View style={styles.centeredCard}>
        <RemoteEmptyArtwork variant="search" />
        <Text style={styles.centeredTitle}>没有匹配结果</Text>
        <Text style={styles.centeredSubtitle}>换个关键词再试一次</Text>
      </View>
    );
  }

  if (currentFolder) {
    return (
      <View style={styles.centeredCard}>
        <RemoteEmptyArtwork variant="folder" />
        <Text style={styles.centeredTitle}>空文件夹</Text>
        <Text style={styles.centeredSubtitle}>
          这个目录暂时没有可下载或分享的文件。
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.centeredCard}>
      <RemoteEmptyArtwork variant="remote" />
      <Text style={styles.centeredTitle}>暂无文件</Text>
      <Text style={styles.centeredSubtitle}>
        电脑端还没有开放可访问的文件目录。
      </Text>
    </View>
  );
}

function RemoteEmptyArtwork({
  variant,
}: {
  variant: 'folder' | 'remote' | 'search';
}) {
  const isFolder = variant === 'folder';
  const isSearch = variant === 'search';
  const gradientId = `remoteEmpty${variant}Gradient`;
  const iconColor = isFolder ? '#AD761D' : isSearch ? '#59616D' : '#1677D2';
  const stops = isFolder
    ? ['#FFFDF4', '#FFEAB7', '#F7C76F']
    : isSearch
      ? ['#FFFFFF', '#EFF5FB', '#D7E2F0']
      : ['#F8FCFF', '#DFF3FF', '#B6E3FF'];

  return (
    <View
      testID={`remote-access-empty-icon-${variant}`}
      style={styles.emptyArtwork}
    >
      <View
        style={[
          styles.emptyArtworkHalo,
          isFolder && styles.emptyArtworkHaloFolder,
        ]}
      />
      <View style={styles.emptyArtworkTile}>
        <Svg
          pointerEvents="none"
          style={StyleSheet.absoluteFillObject}
          width="100%"
          height="100%"
          viewBox="0 0 72 72"
        >
          <Defs>
            <LinearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
              <Stop offset="0%" stopColor={stops[0]} />
              <Stop offset="56%" stopColor={stops[1]} />
              <Stop offset="100%" stopColor={stops[2]} />
            </LinearGradient>
          </Defs>
          <Rect
            x="0"
            y="0"
            width="72"
            height="72"
            rx="22"
            fill={`url(#${gradientId})`}
          />
        </Svg>
        <View style={styles.emptyArtworkCorner} />
        <View style={styles.emptyArtworkPulse} />
        {isFolder ? (
          <FolderOpen size={30} color={iconColor} strokeWidth={1.9} />
        ) : isSearch ? (
          <Search size={29} color={iconColor} strokeWidth={1.9} />
        ) : (
          <>
            <Monitor size={30} color={iconColor} strokeWidth={1.9} />
            <View style={styles.emptyArtworkMiniFolder}>
              <FolderOpen size={13} color="#1677D2" strokeWidth={2} />
            </View>
          </>
        )}
      </View>
    </View>
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
  return (
    <Modal
      animationType="fade"
      transparent
      statusBarTranslucent
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.sheetLayer}>
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
                  <Icon name="checkmark" size={18} color={colors.primary} />
                ) : null}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </Modal>
  );
}

function ShareSheet({
  visible,
  selectedCount,
  onClose,
}: {
  visible: boolean;
  selectedCount: number;
  onClose: () => void;
}) {
  const targets = ['微信', 'QQ', '企业微信', '更多'];

  return (
    <Modal
      animationType="fade"
      transparent
      statusBarTranslucent
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.sheetLayer}>
        <Pressable style={styles.sheetBackdrop} onPress={onClose}>
          <ModalBlurBackdrop overlayColor="rgba(23,25,28,0.18)" />
        </Pressable>
        <View style={styles.shareCard}>
          <Text style={styles.shareTitle}>分享所选文件</Text>
          <Text style={styles.shareSubtitle}>
            已选择 {selectedCount} 个文件
          </Text>
          <View style={styles.shareTargets}>
            {targets.map(target => (
              <TouchableOpacity
                key={target}
                style={styles.shareTarget}
                activeOpacity={0.7}
                onPress={onClose}
              >
                <View style={styles.shareTargetIcon}>
                  <Text style={styles.shareTargetMark}>
                    {target.slice(0, 2)}
                  </Text>
                </View>
                <Text style={styles.shareTargetText}>{target}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GRID_PADDING = 20;
const GRID_COLUMN_GAP = 10;
const GRID_COLUMNS = 3;
const GRID_CARD_WIDTH =
  (SCREEN_WIDTH - GRID_PADDING * 2 - GRID_COLUMN_GAP * (GRID_COLUMNS - 1)) /
  GRID_COLUMNS;

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
    gap: 12,
    marginTop: 18,
    marginBottom: 14,
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
  headerSubtitleRow: {
    marginTop: 3,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  headerSubtitle: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: 11,
    color: '#59616D',
  },
  headerActions: {
    alignItems: 'flex-end',
    gap: 6,
  },
  routeBadge: {
    minHeight: 24,
    maxWidth: 96,
    borderRadius: 999,
    paddingHorizontal: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(219,241,255,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(40,132,214,0.18)',
  },
  routeBadgePending: {
    backgroundColor: 'rgba(255,248,222,0.94)',
    borderColor: 'rgba(217,158,28,0.20)',
  },
  routeBadgeOffline: {
    backgroundColor: 'rgba(255,232,232,0.94)',
    borderColor: 'rgba(220,38,38,0.18)',
  },
  routeBadgeInline: {
    minHeight: 18,
    maxWidth: 88,
    paddingHorizontal: 0,
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
  routeBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  routeBadgeDotPending: {
    backgroundColor: '#D99E1C',
  },
  routeBadgeDotOffline: {
    backgroundColor: '#DC2626',
  },
  routeBadgeDotInline: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  routeBadgeText: {
    flexShrink: 1,
    fontSize: 10,
    fontWeight: '700',
    color: colors.primary,
  },
  routeBadgeTextInline: {
    fontSize: 11,
  },
  routeBadgeTextPending: {
    color: '#9A6A11',
  },
  routeBadgeTextOffline: {
    color: '#B91C1C',
  },
  selectionButton: {
    minWidth: 52,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.70)',
    backgroundColor: 'rgba(255,255,255,0.58)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    ...glassShadow,
  },
  selectionButtonActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  selectionButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#59616D',
  },
  selectionButtonActiveText: {
    color: '#FFFFFF',
  },
  searchBox: {
    minHeight: 46,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.70)',
    backgroundColor: 'rgba(255,255,255,0.50)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    marginBottom: 12,
    ...glassShadow,
  },
  searchInput: {
    flex: 1,
    minHeight: 42,
    padding: 0,
    fontSize: 13,
    color: colors.foreground,
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
  layoutToggle: {
    flexDirection: 'row',
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.58)',
    padding: 4,
  },
  layoutButton: {
    width: 32,
    height: 32,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
  },
  layoutButtonActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#46608A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 2,
    ...androidBoxShadow({
      offsetY: 4,
      blurRadius: 8,
      color: 'rgba(70, 96, 138, 0.12)',
    }),
  },
  selectionActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionButton: {
    borderRadius: 10,
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  actionButtonSecondary: {
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.74)',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  actionButtonDisabled: {
    backgroundColor: '#E5ECF4',
  },
  actionButtonText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  actionButtonSecondaryText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
  },
  actionButtonDisabledText: {
    color: '#9AA3AE',
  },
  listContent: {
    paddingBottom: 34,
  },
  gridContent: {
    gap: 10,
  },
  gridRow: {
    gap: 10,
    justifyContent: 'flex-start',
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
  gridCard: {
    width: GRID_CARD_WIDTH,
    flexGrow: 0,
    flexShrink: 0,
    minWidth: 0,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.70)',
    backgroundColor: 'rgba(255,255,255,0.50)',
    padding: 8,
    ...glassShadow,
  },
  gridPreview: {
    position: 'relative',
    aspectRatio: 1,
    marginBottom: 8,
  },
  iconWrapper: {
    width: 46,
    height: 46,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.75)',
    overflow: 'hidden',
  },
  gridIconWrapper: {
    width: '100%',
    height: '100%',
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.75)',
    overflow: 'hidden',
  },
  remoteResourceThumbnail: {
    width: '100%',
    height: '100%',
  },
  remoteResourceIcon: {
    position: 'relative',
    overflow: 'hidden',
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
  remoteResourceGlyphCenter: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
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
    bottom: -3,
    width: 32,
    height: 20,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.62)',
    transform: [{ rotate: '-8deg' }],
  },
  photoIconHillBlue: {
    position: 'absolute',
    right: -1,
    bottom: -3,
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
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.74)',
    shadowColor: '#46608A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 2,
    elevation: 1,
    ...androidBoxShadow({
      offsetY: 1,
      blurRadius: 2,
      color: 'rgba(70, 96, 138, 0.12)',
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
    borderLeftWidth: 1,
    borderBottomWidth: 1,
    borderBottomLeftRadius: 8,
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
    color: '#59616D',
  },
  iconActionButton: {
    width: 32,
    height: 32,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.64)',
  },
  selectionMark: {
    width: 24,
    height: 24,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#C9D6E4',
    backgroundColor: 'rgba(255,255,255,0.72)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectionMarkActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  gridSelectionMark: {
    position: 'absolute',
    right: 4,
    top: 4,
  },
  gridDownloadButton: {
    position: 'absolute',
    right: 4,
    top: 4,
    width: 26,
    height: 26,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.78)',
  },
  gridName: {
    minHeight: 32,
    fontSize: 10,
    lineHeight: 16,
    fontWeight: '700',
    color: colors.foreground,
  },
  gridMeta: {
    marginTop: 2,
    fontSize: 9,
    color: '#7B8490',
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
  emptyArtworkHalo: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderRadius: 20,
    backgroundColor: 'rgba(228,245,255,0.70)',
    transform: [{ rotate: '-8deg' }],
  },
  emptyArtworkHaloFolder: {
    backgroundColor: 'rgba(255,246,216,0.76)',
  },
  emptyArtworkTile: {
    width: 72,
    height: 72,
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.82)',
    alignItems: 'center',
    justifyContent: 'center',
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
  emptyArtworkCorner: {
    position: 'absolute',
    right: 13,
    top: 13,
    width: 14,
    height: 14,
    borderLeftWidth: 1,
    borderBottomWidth: 1,
    borderBottomLeftRadius: 9,
    borderColor: 'rgba(89,97,109,0.16)',
    backgroundColor: 'rgba(255,255,255,0.68)',
  },
  emptyArtworkPulse: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.58)',
  },
  emptyArtworkMiniFolder: {
    position: 'absolute',
    right: 11,
    bottom: 11,
    width: 24,
    height: 20,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.78)',
    alignItems: 'center',
    justifyContent: 'center',
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
  disconnectedIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.75)',
  },
  retryButton: {
    marginTop: 16,
    borderRadius: 10,
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 3,
  },
  retryButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  sheetLayer: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingBottom: 16,
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
  mediaPreviewTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  mediaPreviewCloseButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
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
  shareCard: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.75)',
    backgroundColor: 'rgba(255,255,255,0.88)',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 24,
    ...glassShadow,
  },
  shareTitle: {
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '700',
    color: colors.foreground,
  },
  shareSubtitle: {
    marginTop: 4,
    textAlign: 'center',
    fontSize: 11,
    color: '#59616D',
  },
  shareTargets: {
    marginTop: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  shareTarget: {
    flex: 1,
    alignItems: 'center',
    gap: 8,
  },
  shareTargetIcon: {
    width: 48,
    height: 48,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E4F5FF',
  },
  shareTargetMark: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
  },
  shareTargetText: {
    fontSize: 11,
    color: '#59616D',
  },
});
