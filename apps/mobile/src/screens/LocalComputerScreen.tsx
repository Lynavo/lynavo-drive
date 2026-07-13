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
} from '@lynavo-drive/contracts';

import type { RootStackParamList } from '../navigation/RootNavigator';
import { colors } from '../theme/globalColors';
import { androidBoxShadow } from '../utils/androidShadow';
import { formatBytes } from '../utils/format';
import { Icon } from '../components/Icon';
import { GradientBackground } from '../components/GradientBackground';
import { ModalBlurBackdrop } from '../components/shared/ModalBlurBackdrop';
import {
  downloadGlobalLocalComputerResource,
  getGlobalLocalComputerPreviewUrl,
  isDownloadSavedLocally,
  listGlobalLocalComputerFolderContents,
  listGlobalLocalComputerResources,
  prepareGlobalLocalComputerPreview,
  prepareGlobalLocalComputerShareFile,
  shareGlobalLocalComputerResources,
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
import { recordDiagnosticsLog } from '../services/diagnostics-log-service';

type NavigationProp = StackNavigationProp<RootStackParamList, 'LocalComputer'>;
type LayoutMode = 'list' | 'grid';
type SortKey = 'name' | 'time' | 'size';
type LocalComputerResourceItem = DesktopSharedResourceDTO & {
  countLabel?: string;
  modifiedLabel?: string;
  preview?: 'blue' | 'dark' | 'settings';
  thumbnailUrl?: string;
  previewUrl?: string;
  streamUrl?: string;
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
type LocalComputerResourceIconType = 'photo' | 'video' | 'file' | 'folder';
type LocalComputerResourceGradientStop = {
  offset: string;
  color: string;
};
type LocalComputerResourcePreviewState = {
  item: LocalComputerResourceItem;
  url: string;
};
type RouteStatusTone = 'online' | 'pending' | 'offline';
type RouteStatusViewModel = {
  label: string;
  tone: RouteStatusTone;
};
type LocalComputerDisabledReason = 'desktop';

const SORT_OPTIONS: Array<{ id: SortKey; label: string }> = [
  { id: 'name', label: 'Name' },
  { id: 'time', label: 'Time' },
  { id: 'size', label: 'File Size' },
];

const PREVIEW_DESKTOP_NAME = 'MacBook Pro';
const ROOT_DIRECTORY_LABEL = 'User Directory';
const UNBOUND_LOCAL_COMPUTER_SUBTITLE = 'Not connected to computer';
const FALLBACK_DESKTOP_LABEL = 'Current Computer';
const LOCAL_SAVE_UNSUPPORTED_TITLE = 'Save Not Supported Yet';
const LOCAL_SAVE_UNSUPPORTED_MESSAGE =
  'Local client saving is not integrated in the current version. Please wait for a future release.';
const LOCAL_COMPUTER_REQUEST_TIMEOUT_MS = 30_000;
const LOCAL_COMPUTER_TIMEOUT_ERROR_MESSAGE = 'Local computer request timed out';
const LOCAL_COMPUTER_READY_RETRY_ATTEMPTS = 2;
const LOCAL_COMPUTER_READY_RETRY_DELAY_MS = 1_200;
const DEFAULT_SHARE_TARGETS = ['Save', 'Copy Link', 'Email', 'More'];
const REMOTE_RESOURCE_ICON_GRADIENTS: Record<
  LocalComputerResourceIconType,
  LocalComputerResourceGradientStop[]
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
    LocalComputerResourceItem,
    'desktopDeviceId' | 'status' | 'addedAt' | 'downloadCount'
  > & {
    addedOffsetHours?: number;
    desktopDeviceId?: string;
    downloadCount?: number;
    status?: LocalComputerResourceItem['status'];
  },
): LocalComputerResourceItem {
  const { addedOffsetHours = 24, ...rest } = item;
  return {
    desktopDeviceId: rest.desktopDeviceId ?? PREVIEW_DESKTOP_NAME,
    status: rest.status ?? 'available',
    addedAt: new Date(now - addedOffsetHours * 60 * 60 * 1000).toISOString(),
    downloadCount: rest.downloadCount ?? 0,
    ...rest,
  };
}

const MOCK_ROOT_ITEMS: LocalComputerResourceItem[] = [
  resource({
    resourceId: 'codex',
    kind: 'shared_folder',
    displayName: 'Codex',
    countLabel: 'Folder',
    addedOffsetHours: 14,
  }),
  resource({
    resourceId: 'mac-manual',
    kind: 'shared_file',
    displayName: 'Mac Client Setup Guide-2506.docx',
    fileSize: 1992294,
    mediaType: 'document',
    modifiedLabel: 'Modified 1 day ago',
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
    modifiedLabel: 'Modified 2 days ago',
    preview: 'settings',
    addedOffsetHours: 48,
  }),
  resource({
    resourceId: 'abc',
    kind: 'shared_file',
    displayName: 'abc.txt',
    fileSize: 13,
    mediaType: 'document',
    modifiedLabel: 'Modified 3 days ago',
    preview: 'blue',
    addedOffsetHours: 72,
  }),
  resource({
    resourceId: 'imsdk',
    kind: 'shared_file',
    displayName: 'imsdk.har',
    fileSize: 15728640,
    mediaType: 'document',
    modifiedLabel: 'Modified 1 day ago',
    preview: 'settings',
    addedOffsetHours: 25,
  }),
  resource({
    resourceId: 'community-docs',
    kind: 'shared_folder',
    displayName: 'community-docs',
    countLabel: 'Folder',
    addedOffsetHours: 30,
  }),
  resource({
    resourceId: 'promo-video',
    kind: 'shared_folder',
    displayName: 'Lynavo Drive demo video',
    countLabel: 'Folder',
    addedOffsetHours: 38,
  }),
  resource({
    resourceId: 'ui-design',
    kind: 'shared_folder',
    displayName: 'Global UI Design',
    countLabel: 'Folder',
    addedOffsetHours: 42,
  }),
  resource({
    resourceId: 'empty-folder',
    kind: 'shared_folder',
    displayName: 'To Organize',
    countLabel: 'Empty Folder',
    addedOffsetHours: 96,
  }),
];

const MOCK_FOLDER_CONTENTS: Record<string, LocalComputerResourceItem[]> = {
  codex: [
    resource({
      resourceId: 'codex-readme',
      kind: 'shared_file',
      displayName: 'README.md',
      fileSize: 12288,
      mediaType: 'document',
      modifiedLabel: 'Modified 1 day ago',
      preview: 'settings',
      addedOffsetHours: 28,
    }),
    resource({
      resourceId: 'codex-plan',
      kind: 'shared_file',
      displayName: 'project-plan.pdf',
      fileSize: 700416,
      mediaType: 'document',
      modifiedLabel: 'Modified 2 days ago',
      preview: 'blue',
      addedOffsetHours: 49,
    }),
    resource({
      resourceId: 'codex-shot',
      kind: 'shared_file',
      displayName: 'screen-recording.mov',
      fileSize: 1932735283,
      mediaType: 'video',
      modifiedLabel: 'Modified 1 day ago',
      preview: 'dark',
      addedOffsetHours: 21,
      downloadCount: 1,
    }),
    resource({
      resourceId: 'codex-archive',
      kind: 'shared_folder',
      displayName: 'Archive',
      countLabel: 'Folder',
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
      modifiedLabel: 'Modified 5 days ago',
      preview: 'settings',
      addedOffsetHours: 122,
    }),
  ],
  'community-docs': [
    resource({
      resourceId: 'community-guide',
      kind: 'shared_file',
      displayName: 'brand-guide.pdf',
      fileSize: 6710886,
      mediaType: 'document',
      modifiedLabel: 'Modified 3 days ago',
      preview: 'blue',
      addedOffsetHours: 72,
    }),
    resource({
      resourceId: 'community-release',
      kind: 'shared_file',
      displayName: 'release-note.docx',
      fileSize: 1258291,
      mediaType: 'document',
      modifiedLabel: 'Modified 1 day ago',
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
      modifiedLabel: 'Modified 2 days ago',
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
      modifiedLabel: 'Modified 4 days ago',
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
      modifiedLabel: 'Modified 2 days ago',
      preview: 'blue',
      addedOffsetHours: 50,
    }),
    resource({
      resourceId: 'ui-history',
      kind: 'shared_file',
      displayName: 'history-screen.png',
      fileSize: 201728,
      mediaType: 'image',
      modifiedLabel: 'Modified 1 day ago',
      preview: 'settings',
      addedOffsetHours: 23,
    }),
    resource({
      resourceId: 'ui-settings',
      kind: 'shared_file',
      displayName: 'settings-screen.png',
      fileSize: 139264,
      mediaType: 'image',
      modifiedLabel: 'Modified 1 day ago',
      preview: 'blue',
      addedOffsetHours: 22,
    }),
  ],
  'empty-folder': [],
};

type SharedFilesPreviewGlobal = typeof globalThis & {
  __LYNAVO_SHARED_FILES_PREVIEW__?: boolean;
};

function isSharedFilesPreviewMode() {
  return (
    (globalThis as SharedFilesPreviewGlobal).__LYNAVO_SHARED_FILES_PREVIEW__ ===
    true
  );
}

function getPreviewRootItems() {
  return isSharedFilesPreviewMode() ? MOCK_ROOT_ITEMS : [];
}

function withLocalComputerTimeout<T>(operation: Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(LOCAL_COMPUTER_TIMEOUT_ERROR_MESSAGE));
    }, LOCAL_COMPUTER_REQUEST_TIMEOUT_MS);
  });

  return Promise.race([operation, timeout]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

function isLocalComputerTimeoutError(error: unknown) {
  return (
    error instanceof Error &&
    error.message === LOCAL_COMPUTER_TIMEOUT_ERROR_MESSAGE
  );
}

function getNormalizedErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return message.toLowerCase();
}

function isLocalComputerDisabledError(error: unknown) {
  const normalizedMessage = getNormalizedErrorMessage(error);
  const legacyPersonalDisabledMessage = [
    're' + 'mote',
    'access',
    'is',
    'disabled',
  ].join(' ');
  return (
    normalizedMessage.includes('local computer access is disabled') ||
    normalizedMessage.includes(legacyPersonalDisabledMessage) ||
    normalizedMessage.includes('sidecar returned http 403 for /personal/list')
  );
}

function translateOrFallback(
  t: (key: string) => string,
  key: string,
  fallback: string,
) {
  const value = t(key);
  return typeof value === 'string' && value.trim().length > 0 && value !== key
    ? value
    : fallback;
}

function isLocalComputerReadyRetryableError(error: unknown) {
  const normalizedMessage = getNormalizedErrorMessage(error);
  return (
    normalizedMessage.includes('shared files route unavailable') ||
    normalizedMessage.includes('no shared files route available')
  );
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

async function withLocalComputerReadyRetry<T>(
  operation: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (
    let attempt = 1;
    attempt <= LOCAL_COMPUTER_READY_RETRY_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await withLocalComputerTimeout(operation());
    } catch (error) {
      lastError = error;
      if (
        isLocalComputerDisabledError(error) ||
        isLocalComputerTimeoutError(error) ||
        !isLocalComputerReadyRetryableError(error) ||
        attempt >= LOCAL_COMPUTER_READY_RETRY_ATTEMPTS
      ) {
        throw error;
      }
      await delay(LOCAL_COMPUTER_READY_RETRY_DELAY_MS);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Local computer request failed');
}

function isFolder(item: LocalComputerResourceItem) {
  return item.kind === 'shared_folder';
}

function isVideo(item: LocalComputerResourceItem) {
  return (
    item.mediaType === 'video' ||
    /\.(mp4|mov|m4v|avi|mkv|webm)$/i.test(item.displayName)
  );
}

function isImage(item: LocalComputerResourceItem) {
  return (
    item.mediaType === 'image' ||
    /\.(jpg|jpeg|png|gif|webp|heic|fig)$/i.test(item.displayName)
  );
}

function getItemIconType(
  item: LocalComputerResourceItem,
): LocalComputerResourceIconType {
  if (isFolder(item)) return 'folder';
  if (isVideo(item)) return 'video';
  if (isImage(item)) return 'photo';
  return 'file';
}

function getItemSize(item: LocalComputerResourceItem) {
  return isFolder(item) ? Number.POSITIVE_INFINITY : (item.fileSize ?? 0);
}

function getItemTime(item: LocalComputerResourceItem) {
  const timestamp = new Date(item.addedAt).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function getItemMeta(item: LocalComputerResourceItem, t: any) {
  if (isFolder(item)) {
    if (item.countLabel === 'Empty Folder') {
      return t('sharedFiles.files.emptyFolder') || 'Empty Folder';
    }
    return t('sharedFiles.files.folder') || 'Folder';
  }
  const size = formatBytes(item.fileSize ?? 0);
  let modified = t('sharedFiles.files.justNow') || 'Just now';
  if (item.modifiedLabel) {
    if (
      item.modifiedLabel.includes('Today') ||
      item.modifiedLabel.includes('Today')
    ) {
      modified = t('sharedFiles.files.modifiedToday') || 'Today';
    } else {
      const match = item.modifiedLabel.match(/(\d+)/);
      if (match) {
        const days = match[1];
        modified =
          t('sharedFiles.files.modifiedDaysAgo', {
            count: parseInt(days, 10),
          }) || `${days} days ago`;
      }
    }
  } else if (item.addedAt) {
    const timestamp = new Date(item.addedAt).getTime();
    if (!Number.isNaN(timestamp)) {
      const diffMs = Math.max(0, Date.now() - timestamp);
      const dayMs = 24 * 60 * 60 * 1000;
      if (diffMs < dayMs) {
        modified = t('sharedFiles.files.modifiedToday') || 'Today';
      } else {
        const days = Math.floor(diffMs / dayMs);
        modified =
          t('sharedFiles.files.modifiedDaysAgo', { count: days }) ||
          `${days} days ago`;
      }
    }
  }
  return `${size} - ${modified}`;
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

function normalizeShareTargets(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return DEFAULT_SHARE_TARGETS;
  }

  const targets = value
    .filter(
      (target): target is string =>
        typeof target === 'string' && target.trim().length > 0,
    )
    .map(target => target.trim());

  return targets.length > 0 ? targets : DEFAULT_SHARE_TARGETS;
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
  if (route && route !== 'lan') return null;
  const normalizedRoute = route === 'lan' ? route : null;

  if (
    state !== 'unknown' &&
    state !== 'available' &&
    state !== 'unavailable' &&
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

  if (current.state === 'unknown') {
    return lastSuccessful;
  }

  return current;
}

function getRouteStatusViewModel(
  reachability: SharedFilesReachabilityDTO | null,
  t: any,
): RouteStatusViewModel | null {
  if (!reachability) return null;

  if (reachability.state === 'available') {
    if (reachability.route === 'lan') {
      return {
        label: t('sharedFiles.connectionStatus.lan') || 'LAN',
        tone: 'online',
      };
    }
    return null;
  }

  if (
    reachability.state === 'unavailable' ||
    reachability.state === 'wake_unavailable'
  ) {
    return {
      label: t('sharedFiles.connectionStatus.unavailable') || 'Unreachable',
      tone: 'offline',
    };
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

function getResourceDesktopDisplayName(items: LocalComputerResourceItem[]) {
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
  if (diffMs < dayMs) return 'Modified Today';
  return `Modified ${Math.floor(diffMs / dayMs)} days ago`;
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
}): LocalComputerResourceItem {
  const resourceId = personalDirectoryResourceId(file.path);
  const mediaType =
    file.isDirectory || file.type === 'other' ? undefined : file.type;
  const streamUrl =
    !file.isDirectory &&
    typeof file.streamUrl === 'string' &&
    file.streamUrl.trim().length > 0
      ? file.streamUrl.trim()
      : undefined;
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
    countLabel: file.isDirectory ? 'Folder' : undefined,
    modifiedLabel: getModifiedLabel(file.modifiedAt),
    sharedRootResourceId: file.isDirectory ? resourceId : undefined,
    relativePath: '',
    thumbnailUrl:
      !file.isDirectory &&
      typeof file.thumbnailUrl === 'string' &&
      file.thumbnailUrl.trim().length > 0
        ? file.thumbnailUrl.trim()
        : undefined,
    previewUrl: streamUrl,
    streamUrl,
  };
}

function getLocalComputerSubtitle({
  currentFolder,
  desktopDisplayName,
  previewMode,
  t,
}: {
  currentFolder: FolderCrumb | null;
  desktopDisplayName: string | null;
  previewMode: boolean;
  t: any;
}) {
  const rootDirectoryLabel =
    t('sharedFiles.localComputer.rootDirectoryLabel') || ROOT_DIRECTORY_LABEL;
  const fallbackDesktopLabel =
    t('sharedFiles.localComputer.fallbackDesktopLabel') ||
    FALLBACK_DESKTOP_LABEL;
  const unboundLocalComputerSubtitle =
    t('sharedFiles.localComputer.unboundLocalComputerSubtitle') ||
    UNBOUND_LOCAL_COMPUTER_SUBTITLE;
  const directoryLabel = currentFolder?.name ?? rootDirectoryLabel;

  if (previewMode) {
    return `${PREVIEW_DESKTOP_NAME} / ${directoryLabel}`;
  }

  if (desktopDisplayName) {
    return `${desktopDisplayName} / ${directoryLabel}`;
  }

  if (currentFolder) {
    return `${fallbackDesktopLabel} / ${directoryLabel}`;
  }

  return unboundLocalComputerSubtitle;
}

export function LocalComputerScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [networkDisconnected, setNetworkDisconnected] = useState(false);
  const [localComputerDisabledReason, setLocalComputerDisabledReason] =
    useState<LocalComputerDisabledReason | null>(null);
  const [rootItems, setRootItems] = useState<LocalComputerResourceItem[]>([]);
  const [folderItemsByKey, setFolderItemsByKey] = useState<
    Record<string, LocalComputerResourceItem[]>
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
    useState<LocalComputerResourcePreviewState | null>(null);

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
    setLocalComputerDisabledReason(null);
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

      const result = await withLocalComputerReadyRetry(() =>
        listGlobalLocalComputerResources(),
      );
      const localComputerItems = result ?? [];
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
          getResourceDesktopDisplayName(localComputerItems),
        ),
      );
      const previewItems = getPreviewRootItems();
      if (localComputerItems.length > 0 || previewItems.length === 0) {
        setPreviewMode(false);
        setRootItems(localComputerItems);
      } else {
        setPreviewMode(true);
        setRootItems(previewItems);
      }
    } catch (e) {
      console.warn('[LocalComputerScreen] Failed to load data:', e);
      const previewItems = getPreviewRootItems();
      if (previewItems.length > 0) {
        setPreviewMode(true);
        setRootItems(previewItems);
      } else {
        setPreviewMode(false);
        setRootItems([]);
        if (isLocalComputerDisabledError(e)) {
          setLocalComputerDisabledReason('desktop');
        } else {
          setNetworkDisconnected(true);
        }
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
        const listing = await withLocalComputerReadyRetry(() =>
          listGlobalLocalComputerFolderContents(rootResourceId, folderPath),
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
        console.warn(
          '[LocalComputerScreen] Failed to load folder contents:',
          e,
        );
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
    async (item: LocalComputerResourceItem) => {
      if (downloadingId) return;
      setDownloadingId(item.resourceId);

      try {
        const { NativeSyncEngine } = NativeModules;
        const binding = await NativeSyncEngine?.getBindingState();
        if (!binding || !binding.host) {
          Alert.alert(
            t('sharedFiles.deviceUnavailable.title') || 'Device Unavailable',
          );
          return;
        }

        const result = await downloadGlobalLocalComputerResource(
          item.resourceId,
        );
        if (!isDownloadSavedLocally(result)) {
          Alert.alert(
            t('sharedFiles.localSaveUnsupported.title') ||
              LOCAL_SAVE_UNSUPPORTED_TITLE,
            t('sharedFiles.localSaveUnsupported.message') ||
              LOCAL_SAVE_UNSUPPORTED_MESSAGE,
          );
          return;
        }

        recordDiagnosticsLog('LocalComputer', 'record download source', {
          resourceId: item.resourceId,
          filename: item.displayName,
          mediaType: item.mediaType,
          savedToPhotos: result.savedToPhotos,
          hasLocalPath: Boolean(result.localPath?.trim()),
          hasThumbnailUrl: Boolean(item.thumbnailUrl?.trim()),
          hasPreviewUrl: Boolean(item.previewUrl?.trim()),
          hasStreamUrl: Boolean(item.streamUrl?.trim()),
        });
        await recordDownloadedFile({
          resourceId: item.resourceId,
          filename: item.displayName,
          fileSize: item.fileSize,
          mediaType: item.mediaType,
          localPath: result.localPath,
          thumbnailUrl: item.thumbnailUrl,
          previewUrl: item.previewUrl,
          streamUrl: item.streamUrl,
          savedToPhotos: result.savedToPhotos,
        });

        Alert.alert(
          t('sharedFiles.dialogs.downloadComplete') || 'Download complete',
          result.savedToPhotos
            ? t('sharedFiles.dialogs.downloadSavedToPhotos', {
                name: item.displayName,
                location:
                  t('sharedFiles.dialogs.savedLocationPhotos') || 'Photos',
              }) || `${item.displayName} saved to Photos`
            : t('sharedFiles.dialogs.downloadSavedToFiles', {
                name: item.displayName,
              }) || `${item.displayName} saved to Files`,
        );
      } catch (err) {
        console.warn('[LocalComputerScreen] Download failed:', err);
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
    (item: LocalComputerResourceItem) => {
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
    async (item: LocalComputerResourceItem) => {
      if (isFolder(item)) return;

      try {
        const bound = await isDesktopBound();
        if (!bound) {
          Alert.alert(
            t('sharedFiles.deviceUnavailable.title') || 'Device Unavailable',
          );
          return;
        }

        if (
          isImageFile(item.mediaType, item.displayName) ||
          isVideoFile(item.mediaType, item.displayName)
        ) {
          const url = await getGlobalLocalComputerPreviewUrl(item.resourceId);
          setResourcePreview({ item, url });
          return;
        }

        if (!canPreviewDocumentFile(item.mediaType, item.displayName)) {
          try {
            const localPath = await prepareGlobalLocalComputerShareFile(
              item.resourceId,
              item.displayName,
            );
            await openFileWithOtherApp(localPath, item.displayName);
          } catch (err) {
            console.warn(
              '[LocalComputerScreen] Open with other app failed:',
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

        const localPath = await prepareGlobalLocalComputerPreview(
          item.resourceId,
          item.displayName,
        );
        await viewDocument({
          uri: documentPreviewUri(localPath),
          headerTitle: item.displayName,
          mimeType: documentMimeType(item.displayName),
        });
      } catch (err) {
        console.warn('[LocalComputerScreen] Preview failed:', err);
        Alert.alert(
          t('sharedFiles.dialogs.previewFailed') || 'Preview Failed',
          t('sharedFiles.dialogs.previewFailedMessage') ||
            'Could not load file preview',
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

  const toggleSelection = useCallback((item: LocalComputerResourceItem) => {
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
        Alert.alert(
          t('sharedFiles.deviceUnavailable.title') || 'Device Unavailable',
        );
        return;
      }

      await shareGlobalLocalComputerResources(
        selectedItems.map(item => ({
          resourceId: item.resourceId,
          displayName: item.displayName,
        })),
      );
      resetSelection();
    } catch (err) {
      console.warn('[LocalComputerScreen] Share failed:', err);
      Alert.alert(
        t('sharedFiles.localComputer.shareFailedTitle') || 'Share Failed',
        t('sharedFiles.localComputer.shareFailedMessage') ||
          'Could not open the system share sheet. Please try again later',
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

  const localizedSortOptions = useMemo(
    () => [
      { id: 'name' as SortKey, label: t('sharedFiles.sortBy.name') || 'Name' },
      { id: 'time' as SortKey, label: t('sharedFiles.sortBy.time') || 'Time' },
      {
        id: 'size' as SortKey,
        label: t('sharedFiles.sortBy.size') || 'File Size',
      },
    ],
    [t],
  );

  const sortLabel =
    localizedSortOptions.find(option => option.id === sortBy)?.label ?? 'Name';
  const queryActive = searchQuery.trim().length > 0;
  const title = currentFolder
    ? currentFolder.name
    : t('sharedFiles.localComputer.title') || 'Computer Files';
  const subtitle = getLocalComputerSubtitle({
    currentFolder,
    desktopDisplayName,
    previewMode,
    t,
  });
  const routeStatus = getRouteStatusViewModel(
    networkDisconnected || localComputerDisabledReason
      ? null
      : getDisplayedSharedFilesReachability(
          sharedFilesReachability,
          lastSuccessfulSharedFilesReachability,
        ),
    t,
  );

  const renderItem = ({ item }: { item: LocalComputerResourceItem }) => {
    const itemProps: LocalComputerResourceItemProps = {
      item,
      downloadingId,
      onDownload: handleDownload,
      onOpenFile: handleOpenFile,
      onOpenFolder: openFolder,
      onToggleSelection: toggleSelection,
      selected: selectedIds.includes(item.resourceId),
      selectionMode,
    };

    return layoutMode === 'grid' ? (
      <LocalComputerResourceGridItem {...itemProps} />
    ) : (
      <LocalComputerResourceListItem {...itemProps} />
    );
  };

  return (
    <GradientBackground>
      <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel={t('common.back') || 'Back'}
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
                <LocalComputerRouteBadge
                  status={routeStatus}
                  variant="inline"
                />
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
                  ? t('sharedFiles.localComputer.done') || 'Done'
                  : t('sharedFiles.localComputer.select') || 'Select'}
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
            placeholder={
              currentFolder
                ? t('sharedFiles.localComputer.searchFolderPlaceholder') ||
                  'Search current folder'
                : t('sharedFiles.localComputer.searchFilesPlaceholder') ||
                  'Search computer files'
            }
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
              testID="local-computer-toolbar-sort-icon"
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
                  {t('sharedFiles.localComputer.download') || 'Download'}
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
                    {t('sharedFiles.localComputer.share') || 'Share'}
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
                accessibilityLabel={
                  t('sharedFiles.localComputer.listView') || 'List View'
                }
                activeOpacity={0.7}
                onPress={() => setLayoutMode('list')}
              >
                <Rows3
                  testID="local-computer-toolbar-list-icon"
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
                accessibilityLabel={
                  t('sharedFiles.localComputer.gridView') || 'Grid View'
                }
                activeOpacity={0.7}
                onPress={() => setLayoutMode('grid')}
              >
                <Grid2X2
                  testID="local-computer-toolbar-grid-icon"
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
            <Text style={styles.centeredTitle}>
              {t('sharedFiles.localComputer.loadingTitle') ||
                'Computer files loading'}
            </Text>
            <Text style={styles.centeredSubtitle}>
              {t('sharedFiles.localComputer.loadingSubtitle') ||
                'Reading the computer shared directory.'}
            </Text>
          </View>
        ) : localComputerDisabledReason ? (
          <LocalComputerDisabledState
            reason={localComputerDisabledReason}
            onRetry={retryLoadData}
          />
        ) : networkDisconnected ? (
          <NetworkDisconnectedState onRetry={retryLoadData} />
        ) : folderLoading ? (
          <View style={styles.centeredCard}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.centeredTitle}>
              {t('sharedFiles.localComputer.folderLoadingTitle') ||
                'Folder loading'}
            </Text>
            <Text style={styles.centeredSubtitle}>
              {t('sharedFiles.localComputer.folderLoadingSubtitle') ||
                'Reading computer directory contents.'}
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
        options={localizedSortOptions}
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
      <LocalComputerResourcePreviewModal
        preview={resourcePreview}
        onClose={() => setResourcePreview(null)}
      />
    </GradientBackground>
  );
}

function LocalComputerRouteBadge({
  status,
  variant = 'default',
}: {
  status: RouteStatusViewModel;
  variant?: 'default' | 'inline';
}) {
  const { t } = useTranslation();
  const inline = variant === 'inline';
  return (
    <View
      accessibilityLabel={`${t('sharedFiles.localComputer.connectionStatePrefix') || 'Computer connection method:'}${status.label}`}
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
  const { t } = useTranslation();
  return (
    <View style={styles.centeredCard}>
      <View style={styles.disconnectedIcon}>
        <Icon name="cloud-offline-outline" size={28} color="#DC2626" />
      </View>
      <Text style={styles.centeredTitle}>
        {t('sharedFiles.localComputer.networkDisconnectedTitle') ||
          'Network Disconnected'}
      </Text>
      <Text style={styles.centeredSubtitle}>
        {t('sharedFiles.localComputer.networkDisconnectedSubtitle') ||
          'The current path will be kept. You can continue after the network is restored or the computer is online.'}
      </Text>
      <TouchableOpacity
        style={styles.retryButton}
        activeOpacity={0.75}
        accessibilityRole="button"
        onPress={onRetry}
      >
        <Text style={styles.retryButtonText}>
          {t('sharedFiles.localComputer.retryConnection') || 'Retry Connection'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function LocalComputerDisabledState({
  reason,
  onRetry,
}: {
  reason: LocalComputerDisabledReason;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const translate = t as (key: string) => string;
  return (
    <View style={styles.centeredCard}>
      <View style={styles.disconnectedIcon}>
        <Icon name="lock-closed-outline" size={28} color="#DC2626" />
      </View>
      <Text style={styles.centeredTitle}>
        {translateOrFallback(
          translate,
          'sharedFiles.localComputer.localComputerDisabledTitle',
          'LAN Sharing Unavailable',
        )}
      </Text>
      <Text style={styles.centeredSubtitle}>
        {translateOrFallback(
          translate,
          'sharedFiles.localComputer.localComputerDisabledSubtitle',
          'Enable local sharing on the computer, then return to the phone and refresh.',
        )}
      </Text>
      <TouchableOpacity
        style={styles.retryButton}
        activeOpacity={0.75}
        accessibilityRole="button"
        onPress={onRetry}
      >
        <Text style={styles.retryButtonText}>
          {translateOrFallback(
            translate,
            'sharedFiles.localComputer.recheckPermission',
            'Check Again',
          )}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function FolderLoadErrorState({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.centeredCard}>
      <View style={styles.disconnectedIcon}>
        <Icon name="alert-circle-outline" size={28} color="#DC2626" />
      </View>
      <Text style={styles.centeredTitle}>
        {t('sharedFiles.localComputer.folderLoadErrorTitle') ||
          'Folder Load Failed'}
      </Text>
      <Text style={styles.centeredSubtitle}>
        {t('sharedFiles.localComputer.folderLoadErrorSubtitle') ||
          'Unable to read this shared folder. Make sure the files still exist on the computer.'}
      </Text>
      <TouchableOpacity
        style={styles.retryButton}
        activeOpacity={0.75}
        accessibilityRole="button"
        onPress={onRetry}
      >
        <Text style={styles.retryButtonText}>
          {t('sharedFiles.localComputer.reload') || 'Reload'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function LocalComputerResourceTypeIcon({
  type,
  style,
}: {
  type: LocalComputerResourceIconType;
  style: StyleProp<ViewStyle>;
}) {
  const gradientId = `localComputerResource${type}Gradient`;

  return (
    <View
      testID={`local-computer-resource-icon-${type}`}
      style={[styles.localComputerResourceIcon, style]}
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
      <LocalComputerResourceGlyph type={type} />
    </View>
  );
}

function LocalComputerResourceGlyph({
  type,
}: {
  type: LocalComputerResourceIconType;
}) {
  if (type === 'photo') {
    return (
      <>
        <View style={styles.photoIconDot} />
        <View style={styles.photoIconHillLight} />
        <View style={styles.photoIconHillBlue} />
        <View style={styles.localComputerResourceGlyphCenter}>
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
      <View style={styles.localComputerResourceGlyphCenter}>
        <FolderOpen size={22} color="#AD761D" strokeWidth={1.8} />
      </View>
    );
  }

  return (
    <>
      <View style={styles.fileIconCorner} />
      <View style={styles.localComputerResourceGlyphCenter}>
        <FileText size={20} color="#59616D" strokeWidth={1.8} />
      </View>
    </>
  );
}

type LocalComputerResourceItemProps = {
  item: LocalComputerResourceItem;
  downloadingId: string | null;
  onDownload: (item: LocalComputerResourceItem) => void;
  onOpenFile: (item: LocalComputerResourceItem) => void;
  onOpenFolder: (item: LocalComputerResourceItem) => void;
  onToggleSelection: (item: LocalComputerResourceItem) => void;
  selected: boolean;
  selectionMode: boolean;
};

function LocalComputerResourceListItem({
  item,
  downloadingId,
  onDownload,
  onOpenFile,
  onOpenFolder,
  onToggleSelection,
  selected,
  selectionMode,
}: LocalComputerResourceItemProps) {
  const { t } = useTranslation();
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
      <LocalComputerResourceVisual
        item={item}
        iconType={iconType}
        style={styles.iconWrapper}
      />
      <View style={styles.infoWrapper}>
        <Text style={styles.filename} numberOfLines={1}>
          {item.displayName}
        </Text>
        <Text style={styles.metaText} numberOfLines={1}>
          {getItemMeta(item, t)}
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

function LocalComputerResourceGridItem({
  item,
  downloadingId,
  onDownload,
  onOpenFile,
  onOpenFolder,
  onToggleSelection,
  selected,
  selectionMode,
}: LocalComputerResourceItemProps) {
  const { t } = useTranslation();
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
        <LocalComputerResourceVisual
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
        {folder ? getItemMeta(item, t) : formatBytes(item.fileSize ?? 0)}
      </Text>
    </View>
  );
}

function LocalComputerResourceVisual({
  item,
  iconType,
  style,
}: {
  item: LocalComputerResourceItem;
  iconType: LocalComputerResourceIconType;
  style: StyleProp<ViewStyle>;
}) {
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const supportsThumbnail =
    isImage(item) || isVideoFile(item.mediaType, item.displayName);
  const thumbnailUrl =
    supportsThumbnail && !thumbnailFailed
      ? item.thumbnailUrl?.trim()
      : undefined;

  useEffect(() => {
    if (!supportsThumbnail) {
      return;
    }
    console.info('[video-thumbnail][mobile] shared resource thumbnail state', {
      name: item.displayName,
      mediaType: item.mediaType,
      supportsThumbnail,
      hasThumbnailUrl: Boolean(item.thumbnailUrl?.trim()),
      renderingImage: Boolean(thumbnailUrl),
      thumbnailFailed,
      thumbnailUrl: item.thumbnailUrl?.trim() || null,
    });
  }, [
    item.displayName,
    item.mediaType,
    item.thumbnailUrl,
    supportsThumbnail,
    thumbnailFailed,
    thumbnailUrl,
  ]);

  if (thumbnailUrl) {
    return (
      <View style={style}>
        <Image
          testID="local-computer-resource-thumbnail-image"
          source={{ uri: thumbnailUrl }}
          style={styles.localComputerResourceThumbnail}
          resizeMode="cover"
          onError={() => {
            console.warn(
              '[video-thumbnail][mobile] shared resource image load failed',
              {
                name: item.displayName,
                mediaType: item.mediaType,
                thumbnailUrl,
              },
            );
            setThumbnailFailed(true);
          }}
        />
      </View>
    );
  }

  return <LocalComputerResourceTypeIcon type={iconType} style={style} />;
}

function LocalComputerResourcePreviewModal({
  preview,
  onClose,
}: {
  preview: LocalComputerResourcePreviewState | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
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
            accessibilityLabel={
              t('sharedFiles.localComputer.closePreview') || 'Close Preview'
            }
            activeOpacity={0.7}
            onPress={onClose}
          >
            <Icon name="close" size={18} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
        <View style={styles.mediaPreviewBody}>
          {video ? (
            <Video
              testID="local-computer-resource-preview-video"
              source={{ uri: preview.url }}
              style={styles.mediaPreviewFullMedia}
              resizeMode="contain"
              controls
              paused={false}
              muted={false}
            />
          ) : (
            <Image
              testID="local-computer-resource-preview-image"
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
  const { t } = useTranslation();
  if (queryActive) {
    return (
      <View style={styles.centeredCard}>
        <LocalComputerEmptyArtwork variant="search" />
        <Text style={styles.centeredTitle}>
          {t('sharedFiles.localComputer.noMatchTitle') || 'No Matching Results'}
        </Text>
        <Text style={styles.centeredSubtitle}>
          {t('sharedFiles.localComputer.noMatchSubtitle') ||
            'Try another keyword'}
        </Text>
      </View>
    );
  }

  if (currentFolder) {
    return (
      <View style={styles.centeredCard}>
        <LocalComputerEmptyArtwork variant="folder" />
        <Text style={styles.centeredTitle}>
          {t('sharedFiles.localComputer.emptyFolderTitle') || 'Empty Folder'}
        </Text>
        <Text style={styles.centeredSubtitle}>
          {t('sharedFiles.localComputer.emptyFolderSubtitle') ||
            'This directory has no files available for download or sharing.'}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.centeredCard}>
      <LocalComputerEmptyArtwork variant="computer" />
      <Text style={styles.centeredTitle}>
        {t('sharedFiles.localComputer.noFilesTitle') || 'No Files'}
      </Text>
      <Text style={styles.centeredSubtitle}>
        {t('sharedFiles.localComputer.noFilesSubtitle') ||
          'The computer has not opened any accessible file directories yet.'}
      </Text>
    </View>
  );
}

function LocalComputerEmptyArtwork({
  variant,
}: {
  variant: 'computer' | 'folder' | 'search';
}) {
  const isFolder = variant === 'folder';
  const isSearch = variant === 'search';
  const gradientId = `localComputerEmpty${variant}Gradient`;
  const iconColor = isFolder ? '#AD761D' : isSearch ? '#59616D' : '#1677D2';
  const stops = isFolder
    ? ['#FFFDF4', '#FFEAB7', '#F7C76F']
    : isSearch
      ? ['#FFFFFF', '#EFF5FB', '#D7E2F0']
      : ['#F8FCFF', '#DFF3FF', '#B6E3FF'];

  return (
    <View
      testID={`local-computer-empty-icon-${variant}`}
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
  const { t } = useTranslation();
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
          <Text style={styles.sheetTitle}>
            {t('sharedFiles.localComputer.sortTitle') || 'Sort By'}
          </Text>
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
  const { t } = useTranslation();
  const targets = normalizeShareTargets(
    t('sharedFiles.localComputer.shareTargets', { returnObjects: true }),
  );

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
          <Text style={styles.shareTitle}>
            {t('sharedFiles.localComputer.shareTitle') ||
              'Share Selected Files'}
          </Text>
          <Text style={styles.shareSubtitle}>
            {t('sharedFiles.localComputer.shareSubtitle', {
              count: selectedCount,
            }) || `Selected ${selectedCount}  files`}
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
  localComputerResourceThumbnail: {
    width: '100%',
    height: '100%',
  },
  localComputerResourceIcon: {
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
  localComputerResourceGlyphCenter: {
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
