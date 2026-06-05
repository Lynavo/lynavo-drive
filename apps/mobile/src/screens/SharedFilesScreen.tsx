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
  NativeModules,
  NativeEventEmitter,
  Modal,
  Platform,
  type ListRenderItemInfo,
} from 'react-native';
import { viewDocument } from '@react-native-documents/viewer';
import Video from 'react-native-video';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { TFunction } from 'i18next';
import type {
  DirectoryScope,
  SharedFileDTO,
  SharedFilesReachabilityDTO,
} from '@syncflow/contracts';
import { FEATURES } from '../constants/features';
import { useAuth, isFeatureAccessAllowed } from '../stores/auth-store';
import { Icon } from '../components/Icon';
import {
  browseDirectory,
  downloadDirectoryFile,
  getDirectoryFileStreamUrl,
  prepareDirectoryFilePreview,
} from '../services/SyncEngineModule';
import { formatBytes } from '../utils/format';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ErrorKind =
  | 'device_unavailable'
  | 'directory_inaccessible'
  | 'personal_unauthorized'
  | 'network_error';

interface DeviceAvailability {
  available: boolean;
  deviceId: string | null;
}

interface BindingStatePayload {
  deviceId?: unknown;
  connectionState?: unknown;
  sharedFilesReachability?: unknown;
}

interface SharedFileDownloadProgress {
  path: string;
  bytesWritten: number;
  totalBytes: number;
  progress: number;
}

type SharedFilesConnectionStatus =
  | 'lan'
  | 'p2p'
  | 'relay'
  | 'unavailable'
  | 'offline';

interface LoadFilesOptions {
  showLoading?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCREEN_BG = '#d6ecf8';
const DARK = '#1a3a5c';
const BLUE = '#3b9fd8';
const SHARED_FILES_RECOVERY_RETRY_MS = 3000;
const SHARED_FILES_COMPLETED_DOWNLOADS_STORAGE_PREFIX =
  '@syncflow/shared-files/completed-downloads/v2';
const DIRECTORY_SCOPES: DirectoryScope[] = ['team', 'personal'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fileTypeIcon(file: SharedFileDTO): { name: string; color: string } {
  if (file.isDirectory) return { name: 'folder-outline', color: '#f59e0b' };
  if (file.type === 'video')
    return { name: 'videocam-outline', color: '#3b82f6' };
  if (file.type === 'image') return { name: 'image-outline', color: '#06b6d4' };
  return { name: 'document-outline', color: '#8b5cf6' };
}

function documentMimeType(file: SharedFileDTO): string | undefined {
  const ext = file.name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'pdf':
      return 'application/pdf';
    case 'txt':
    case 'log':
      return 'text/plain';
    case 'csv':
      return 'text/csv';
    case 'doc':
      return 'application/msword';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'xls':
      return 'application/vnd.ms-excel';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'ppt':
      return 'application/vnd.ms-powerpoint';
    case 'pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    case 'zip':
      return 'application/zip';
    default:
      return undefined;
  }
}

function clampDownloadProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function formatDownloadPercent(value: number): string {
  return `${Math.round(clampDownloadProgress(value) * 100)}%`;
}

export function normalizeDirectoryPath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
}

export function parentDirectoryPath(path: string): string {
  const normalized = normalizeDirectoryPath(path);
  if (!normalized) return '';

  const parts = normalized.split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

function sharedFilesCompletedDownloadsStorageKey(
  deviceId: string,
  scope: DirectoryScope,
): string {
  return `${SHARED_FILES_COMPLETED_DOWNLOADS_STORAGE_PREFIX}:${deviceId}:${scope}`;
}

function sharedFileCompletedDownloadId(
  scope: DirectoryScope,
  file: SharedFileDTO,
): string {
  return JSON.stringify([scope, file.path, file.size, file.modifiedAt]);
}

function sharedFileOperationId(scope: DirectoryScope, path: string): string {
  return `${scope}:${path}`;
}

function isPersonalUnauthorizedError(
  scope: DirectoryScope,
  message: string,
): boolean {
  if (scope !== 'personal') return false;
  return (
    message.includes('401') || message.toLowerCase().includes('unauthorized')
  );
}

function completedDownloadsFromIds(ids: string[]): Record<string, true> {
  return ids.reduce<Record<string, true>>((acc, id) => {
    const normalizedId = id.trim();
    if (normalizedId) {
      acc[normalizedId] = true;
    }
    return acc;
  }, {});
}

function parseCompletedDownloads(raw: string | null): Record<string, true> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return {};
    return completedDownloadsFromIds(
      parsed.filter((id): id is string => typeof id === 'string'),
    );
  } catch {
    return {};
  }
}

function serializeCompletedDownloads(downloads: Record<string, true>): string {
  return JSON.stringify(Object.keys(downloads).sort());
}

function isSharedFilesReachabilityAvailable(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { state?: unknown }).state === 'available'
  );
}

function isRetainedOfflineTunnelReachability(value: unknown): boolean {
  if (!isSharedFilesReachabilityAvailable(value)) return false;
  const route = (value as { route?: unknown }).route;
  const reason = (value as { reason?: unknown }).reason;
  return (
    (route === 'tunnel' || route === 'relay') &&
    reason === 'presence_recovery_exhausted_tunnel_retained'
  );
}

function sharedFilesConnectionStatusFromReachability(
  value: unknown,
): SharedFilesConnectionStatus | null {
  if (typeof value !== 'object' || value === null) return 'offline';
  const state = (value as { state?: unknown }).state;
  if (state === 'unavailable') return 'unavailable';
  if (state !== 'available') return 'offline';
  const route = (value as { route?: unknown }).route;
  if (route === 'lan') return 'lan';
  if (route === 'tunnel') return 'p2p';
  if (route === 'relay') return 'relay';
  return null;
}

function fallbackSavedLocation(
  file: SharedFileDTO,
  result: {
    savedToPhotos: boolean;
    localPath: string | null;
    savedLocation?: string | null;
  },
  t: TFunction,
): string | null {
  if (result.savedToPhotos) {
    if (Platform.OS === 'android') {
      if (file.type === 'video') return 'Movies/Vivi Drop';
      if (file.type === 'image') return 'Pictures/Vivi Drop';
    }
    return t('sharedFiles.dialogs.savedLocationPhotos', {
      defaultValue: 'Photos',
    });
  }

  if (result.savedLocation) {
    return result.savedLocation;
  }
  if (result.localPath) {
    return result.localPath;
  }

  if (Platform.OS === 'ios') {
    return t('sharedFiles.dialogs.savedLocationDocuments', {
      defaultValue: 'Files App -> Vivi Drop',
    });
  } else {
    return t('sharedFiles.dialogs.savedLocationDownloads', {
      defaultValue: 'Download/Vivi Drop',
    });
  }
}

async function getDeviceAvailability(): Promise<DeviceAvailability> {
  try {
    const { NativeSyncEngine } = NativeModules;
    if (!NativeSyncEngine) return { available: false, deviceId: null };
    const binding = await NativeSyncEngine.getBindingState();
    const deviceId =
      typeof binding?.deviceId === 'string' ? binding.deviceId : null;
    // For P2P / IPv6 WAN connections, mDNS multicast auto-discovery does not run,
    // so connectionState might be cached as 'offline'.
    // If a device is paired (has deviceId), we should allow trying to fetch the files anyway.
    return { available: deviceId !== null, deviceId };
  } catch {
    return { available: false, deviceId: null };
  }
}

// ---------------------------------------------------------------------------
// SharedFilesScreen
// ---------------------------------------------------------------------------

export function SharedFilesScreen() {
  const navigation = useNavigation();
  const { t } = useTranslation();
  const { subscription } = useAuth();
  const [activeDirectoryScope, setActiveDirectoryScope] =
    useState<DirectoryScope>('team');
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState<SharedFileDTO[]>([]);
  const [currentPath, setCurrentPath] = useState('');
  const [errorKind, setErrorKind] = useState<ErrorKind | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  const [sharedFilesConnectionStatus, setSharedFilesConnectionStatus] =
    useState<SharedFilesConnectionStatus>('offline');
  const downloadingRef = useRef<string | null>(null);
  const activeLoadRef = useRef<{
    scope: DirectoryScope;
    path: string;
    promise: Promise<void>;
  } | null>(null);
  const loadRequestSeqRef = useRef(0);
  const previewRequestSeqRef = useRef(0);
  const recoveryRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const completedDownloadsStorageRef = useRef<{
    deviceId: string | null;
    scope: DirectoryScope;
  }>({ deviceId: null, scope: 'team' });
  const completedDownloadsRef = useRef<Record<string, true>>({});
  const bindingAvailabilityRef = useRef<{
    deviceId: string | null;
    available: boolean | null;
  }>({ deviceId: null, available: null });
  const [downloadProgress, setDownloadProgress] = useState<
    Record<string, SharedFileDownloadProgress>
  >({});
  const [completedDownloads, setCompletedDownloads] = useState<
    Record<string, true>
  >({});

  // Preview state
  const [previewFile, setPreviewFile] = useState<SharedFileDTO | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const updateCompletedDownloads = useCallback((next: Record<string, true>) => {
    completedDownloadsRef.current = next;
    setCompletedDownloads(next);
  }, []);

  // ---------------------------------------------------------------------------
  // Load files via native bridge
  // ---------------------------------------------------------------------------

  const clearRecoveryRetryTimer = useCallback(() => {
    if (recoveryRetryTimerRef.current) {
      clearTimeout(recoveryRetryTimerRef.current);
      recoveryRetryTimerRef.current = null;
    }
  }, []);

  const loadFiles = useCallback(
    (path: string, options: LoadFilesOptions = {}): Promise<void> => {
      const loadPath = normalizeDirectoryPath(path);
      const showLoading = options.showLoading !== false;
      const activeLoad = activeLoadRef.current;
      if (
        activeLoad?.scope === activeDirectoryScope &&
        activeLoad.path === loadPath
      ) {
        if (showLoading) {
          setLoading(true);
        }
        return activeLoad.promise;
      }

      const loadScope = activeDirectoryScope;
      const loadRequestSeq = loadRequestSeqRef.current + 1;
      loadRequestSeqRef.current = loadRequestSeq;
      const isCurrentLoad = () => loadRequestSeqRef.current === loadRequestSeq;

      const loadPromise = (async () => {
        if (showLoading) {
          setLoading(true);
          setErrorKind(null);
        }

        // P1#3: Pre-check device availability
        const availability = await getDeviceAvailability();
        if (!isCurrentLoad()) {
          return;
        }
        if (!availability.available) {
          bindingAvailabilityRef.current = { deviceId: null, available: false };
          setActiveDeviceId(null);
          setSharedFilesConnectionStatus('offline');
          setErrorKind('device_unavailable');
          setFiles([]);
          setLoading(false);
          return;
        }

        bindingAvailabilityRef.current = {
          deviceId: availability.deviceId,
          available: true,
        };
        setActiveDeviceId(availability.deviceId);

        try {
          const result = await browseDirectory(loadScope, loadPath);
          if (!isCurrentLoad()) {
            return;
          }
          setFiles(result.files ?? []);
          setErrorKind(null);
        } catch (e: unknown) {
          if (!isCurrentLoad()) {
            return;
          }
          const msg = e instanceof Error ? e.message : String(e);
          // 404 / 403 → directory genuinely missing or access denied.
          // 400 is intentionally excluded: sidecar returns 400 for path
          // traversal rejects, "not a directory", and resolve failures —
          // none of which mean the active directory scope is inaccessible.
          if (isPersonalUnauthorizedError(loadScope, msg)) {
            setErrorKind('personal_unauthorized');
          } else if (
            msg.includes('403') ||
            msg.includes('404') ||
            msg.includes('not found')
          ) {
            setErrorKind('directory_inaccessible');
          } else {
            setSharedFilesConnectionStatus('unavailable');
            setErrorKind('network_error');
          }
          setFiles([]);
          console.warn('[SharedFiles] loadFiles error:', e);
        } finally {
          if (isCurrentLoad()) {
            setLoading(false);
          }
        }
      })();

      activeLoadRef.current = {
        scope: loadScope,
        path: loadPath,
        promise: loadPromise,
      };
      const clearActiveLoad = () => {
        if (activeLoadRef.current?.promise === loadPromise) {
          activeLoadRef.current = null;
        }
      };
      void loadPromise.then(clearActiveLoad, clearActiveLoad);

      return loadPromise;
    },
    [activeDirectoryScope],
  );

  // ---------------------------------------------------------------------------
  // Initial load
  // ---------------------------------------------------------------------------

  useEffect(() => {
    void loadFiles(currentPath);
  }, [currentPath, loadFiles]);

  useEffect(() => {
    completedDownloadsStorageRef.current = {
      deviceId: activeDeviceId,
      scope: activeDirectoryScope,
    };
    if (!activeDeviceId) {
      updateCompletedDownloads({});
      return;
    }

    updateCompletedDownloads({});
    let cancelled = false;
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(
          sharedFilesCompletedDownloadsStorageKey(
            activeDeviceId,
            activeDirectoryScope,
          ),
        );
        if (
          cancelled ||
          completedDownloadsStorageRef.current.deviceId !== activeDeviceId ||
          completedDownloadsStorageRef.current.scope !== activeDirectoryScope
        ) {
          return;
        }
        const loaded = parseCompletedDownloads(raw);
        updateCompletedDownloads({
          ...loaded,
          ...completedDownloadsRef.current,
        });
      } catch (e) {
        console.warn('[SharedFiles] load completed downloads failed:', e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeDeviceId, activeDirectoryScope, updateCompletedDownloads]);

  useEffect(() => {
    const shouldRetry =
      errorKind === 'device_unavailable' || errorKind === 'network_error';
    if (!shouldRetry) {
      clearRecoveryRetryTimer();
      return;
    }

    if (
      !bindingAvailabilityRef.current.deviceId ||
      recoveryRetryTimerRef.current
    ) {
      return;
    }

    recoveryRetryTimerRef.current = setTimeout(() => {
      recoveryRetryTimerRef.current = null;
      void loadFiles(currentPath, { showLoading: false });
    }, SHARED_FILES_RECOVERY_RETRY_MS);

    return clearRecoveryRetryTimer;
  }, [clearRecoveryRetryTimer, currentPath, errorKind, loadFiles]);

  // ---------------------------------------------------------------------------
  // P1#3: Subscribe to binding state changes
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const { NativeSyncEngine } = NativeModules;
    if (!NativeSyncEngine) return;

    const emitter = new NativeEventEmitter(NativeSyncEngine);
    const sub = emitter.addListener(
      'onBindingStateChanged',
      (state: BindingStatePayload | null) => {
        const deviceId =
          typeof state?.deviceId === 'string' ? state.deviceId : null;
        if (!state || !deviceId) {
          bindingAvailabilityRef.current = { deviceId: null, available: false };
          setActiveDeviceId(null);
          setSharedFilesConnectionStatus('offline');
          setErrorKind('device_unavailable');
          setFiles([]);
          setLoading(false);
          return;
        }

        const nextSharedFilesConnectionStatus =
          sharedFilesConnectionStatusFromReachability(
            state.sharedFilesReachability,
          );
        if (nextSharedFilesConnectionStatus) {
          setSharedFilesConnectionStatus(nextSharedFilesConnectionStatus);
        }
        const connState = (state.connectionState as string) || 'bound';
        const sharedFilesAvailable = isSharedFilesReachabilityAvailable(
          state.sharedFilesReachability,
        );
        const retainedOfflineTunnel = isRetainedOfflineTunnelReachability(
          state.sharedFilesReachability,
        );
        if (
          connState === 'connected' ||
          connState === 'bound' ||
          (sharedFilesAvailable &&
            (connState !== 'offline' || retainedOfflineTunnel))
        ) {
          const previousAvailability = bindingAvailabilityRef.current;
          const shouldReload =
            previousAvailability.available === false ||
            (previousAvailability.available === true &&
              previousAvailability.deviceId !== null &&
              previousAvailability.deviceId !== deviceId);

          bindingAvailabilityRef.current = { deviceId, available: true };
          setActiveDeviceId(deviceId);
          if (shouldReload) {
            void loadFiles(currentPath);
          }
        } else if (connState === 'offline') {
          bindingAvailabilityRef.current = { deviceId, available: false };
          setActiveDeviceId(deviceId);
          setSharedFilesConnectionStatus('unavailable');
          setErrorKind('network_error');
          setFiles([]);
          setLoading(false);
        } else if (connState === 'connecting') {
          const previousAvailability = bindingAvailabilityRef.current;
          if (
            previousAvailability.available === true &&
            previousAvailability.deviceId === deviceId
          ) {
            bindingAvailabilityRef.current = { deviceId, available: true };
          }
        } else {
          bindingAvailabilityRef.current = { deviceId, available: false };
          setSharedFilesConnectionStatus('offline');
          setErrorKind('device_unavailable');
          setFiles([]);
          setLoading(false);
        }
      },
    );

    return () => sub.remove();
  }, [loadFiles, currentPath]);

  useEffect(() => {
    const { NativeSyncEngine } = NativeModules;
    if (!NativeSyncEngine) return;

    const emitter = new NativeEventEmitter(NativeSyncEngine);
    const sub = emitter.addListener(
      'onSharedFilesReachabilityChanged',
      (state: SharedFilesReachabilityDTO | null) => {
        const nextSharedFilesConnectionStatus =
          sharedFilesConnectionStatusFromReachability(state);
        if (nextSharedFilesConnectionStatus === 'offline') {
          if (bindingAvailabilityRef.current.deviceId) {
            setSharedFilesConnectionStatus('unavailable');
          } else {
            setSharedFilesConnectionStatus('offline');
          }
        } else if (nextSharedFilesConnectionStatus) {
          setSharedFilesConnectionStatus(nextSharedFilesConnectionStatus);
        }

        if (!state?.deviceId) return;
        if (state.state !== 'available') return;

        const previousAvailability = bindingAvailabilityRef.current;
        const shouldReload =
          previousAvailability.available === false ||
          previousAvailability.deviceId !== state.deviceId ||
          errorKind === 'device_unavailable' ||
          errorKind === 'network_error';

        bindingAvailabilityRef.current = {
          deviceId: state.deviceId,
          available: true,
        };
        setActiveDeviceId(state.deviceId);
        if (shouldReload) {
          void loadFiles(currentPath);
        }
      },
    );

    return () => sub.remove();
  }, [currentPath, errorKind, loadFiles]);

  useEffect(() => {
    const { NativeSyncEngine } = NativeModules;
    if (!NativeSyncEngine) return;

    const emitter = new NativeEventEmitter(NativeSyncEngine);
    const sub = emitter.addListener(
      'onSharedFileDownloadProgress',
      (progress: SharedFileDownloadProgress | null) => {
        if (!progress?.path) return;
        const progressKey = downloadingRef.current ?? progress.path;
        setDownloadProgress(previous => ({
          ...previous,
          [progressKey]: {
            ...progress,
            progress: clampDownloadProgress(progress.progress),
          },
        }));
      },
    );

    return () => sub.remove();
  }, []);

  // ---------------------------------------------------------------------------
  // Directory navigation
  // ---------------------------------------------------------------------------

  const navigateIntoDir = useCallback((path: string) => {
    setCurrentPath(normalizeDirectoryPath(path));
  }, []);

  const navigateBack = useCallback(() => {
    setCurrentPath(previous => parentDirectoryPath(previous));
  }, []);

  const selectDirectoryScope = useCallback(
    (scope: DirectoryScope) => {
      if (scope === activeDirectoryScope) return;
      if (downloadingRef.current) return;
      loadRequestSeqRef.current += 1;
      previewRequestSeqRef.current += 1;
      activeLoadRef.current = null;
      setActiveDirectoryScope(scope);
      setCurrentPath('');
      setFiles([]);
      setErrorKind(null);
      setPreviewFile(null);
      setPreviewUrl(null);
    },
    [activeDirectoryScope],
  );

  // ---------------------------------------------------------------------------
  // Download handler
  // ---------------------------------------------------------------------------

  const handleDownload = useCallback(
    async (file: SharedFileDTO) => {
      if (downloadingRef.current) return;

      // --- PRD §7.1 — downloads require active subscription ---
      if (!FEATURES.SUBSCRIPTION_ENFORCEMENT) {
        // Soft-off: skip the gate until enforcement is globally enabled.
      } else if (!isFeatureAccessAllowed(subscription?.status)) {
        Alert.alert(
          t('subscription.gate.downloadTitle'),
          t('subscription.gate.downloadBody'),
          [
            { text: t('subscription.gate.cancel'), style: 'cancel' },
            {
              text: t('subscription.gate.goSubscribe'),
              onPress: () => navigation.navigate('Subscription' as never),
            },
          ],
        );
        return;
      }

      const downloadOperationId = sharedFileOperationId(
        activeDirectoryScope,
        file.path,
      );
      downloadingRef.current = downloadOperationId;
      setDownloading(downloadOperationId);
      setDownloadProgress(previous => {
        const next = { ...previous };
        delete next[downloadOperationId];
        return next;
      });
      try {
        const result = await downloadDirectoryFile(
          activeDirectoryScope,
          file.path,
        );
        const completedDownloadId = sharedFileCompletedDownloadId(
          activeDirectoryScope,
          file,
        );
        const nextCompletedDownloads: Record<string, true> = {
          ...completedDownloadsRef.current,
          [completedDownloadId]: true as const,
        };
        updateCompletedDownloads(nextCompletedDownloads);
        const deviceId =
          activeDeviceId ?? bindingAvailabilityRef.current.deviceId;
        if (deviceId) {
          void AsyncStorage.setItem(
            sharedFilesCompletedDownloadsStorageKey(
              deviceId,
              activeDirectoryScope,
            ),
            serializeCompletedDownloads(nextCompletedDownloads),
          ).catch(e => {
            console.warn('[SharedFiles] persist completed download failed:', e);
          });
        }
        if (result.savedToPhotos) {
          const savedLocation = fallbackSavedLocation(file, result, t);
          Alert.alert(
            t('sharedFiles.dialogs.downloadComplete'),
            t('sharedFiles.dialogs.downloadSavedToPhotos', {
              name: file.name,
              location: savedLocation,
            }),
          );
        } else {
          Alert.alert(
            t('sharedFiles.dialogs.downloadComplete'),
            t('sharedFiles.dialogs.downloadSavedToFiles', {
              name: file.name,
            }),
          );
        }
      } catch (e) {
        Alert.alert(
          t('sharedFiles.dialogs.downloadFailed'),
          t('sharedFiles.dialogs.downloadFailedMessage'),
        );
        console.warn('[SharedFiles] download error:', e);
      } finally {
        downloadingRef.current = null;
        setDownloading(null);
        setDownloadProgress(previous => {
          const next = { ...previous };
          delete next[downloadOperationId];
          return next;
        });
      }
    },
    [
      activeDeviceId,
      activeDirectoryScope,
      subscription?.status,
      t,
      navigation,
      updateCompletedDownloads,
    ],
  );

  // ---------------------------------------------------------------------------
  // Preview handler
  // ---------------------------------------------------------------------------

  const handlePreview = useCallback(
    async (file: SharedFileDTO) => {
      const previewRequestSeq = previewRequestSeqRef.current + 1;
      previewRequestSeqRef.current = previewRequestSeq;
      const previewScope = activeDirectoryScope;
      try {
        if (file.type === 'image' || file.type === 'video') {
          const url =
            file.streamUrl ??
            (await getDirectoryFileStreamUrl(previewScope, file.path));
          if (previewRequestSeqRef.current !== previewRequestSeq) return;
          setPreviewFile(file);
          setPreviewUrl(url);
          return;
        }
        const documentUrl =
          Platform.OS === 'ios'
            ? await prepareDirectoryFilePreview(previewScope, file.path)
            : (file.streamUrl ??
              (await getDirectoryFileStreamUrl(previewScope, file.path)));
        if (previewRequestSeqRef.current !== previewRequestSeq) return;
        await viewDocument({
          uri: documentUrl,
          headerTitle: file.name,
          mimeType: documentMimeType(file),
        });
      } catch (e) {
        if (previewRequestSeqRef.current !== previewRequestSeq) return;
        Alert.alert(
          t('sharedFiles.dialogs.previewFailed'),
          t('sharedFiles.dialogs.previewFailedMessage'),
        );
        console.warn('[SharedFiles] getStreamUrl error:', e);
      }
    },
    [activeDirectoryScope, t],
  );

  const closePreview = useCallback(() => {
    setPreviewFile(null);
    setPreviewUrl(null);
  }, []);

  // ---------------------------------------------------------------------------
  // Render item
  // ---------------------------------------------------------------------------

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<SharedFileDTO>) => {
      const icon = fileTypeIcon(item);
      const operationId = sharedFileOperationId(
        activeDirectoryScope,
        item.path,
      );
      const isDownloading = downloading === operationId;
      const isDownloadDisabled = downloading !== null;
      const isDownloaded =
        completedDownloads[
          sharedFileCompletedDownloadId(activeDirectoryScope, item)
        ] === true;
      const progress = downloadProgress[operationId]?.progress ?? 0;
      let fileMeta = formatBytes(item.size);
      if (isDownloading) {
        fileMeta = formatDownloadPercent(progress);
      } else if (isDownloaded) {
        fileMeta = t('sharedFiles.files.downloaded');
      } else if (item.isDirectory) {
        fileMeta = t('sharedFiles.files.folder');
      }

      return (
        <TouchableOpacity
          style={styles.fileRow}
          activeOpacity={0.7}
          onPress={() => {
            if (item.isDirectory) {
              navigateIntoDir(item.path);
            } else {
              void handlePreview(item);
            }
          }}
        >
          {/* Thumbnail or icon */}
          {item.thumbnailUrl ? (
            <Image
              source={{ uri: item.thumbnailUrl }}
              style={styles.fileThumbnail}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.fileIconWrapper}>
              <Icon name={icon.name} size={18} color={icon.color} />
            </View>
          )}

          {/* File info */}
          <View style={styles.fileInfo}>
            <Text style={styles.fileName} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.fileMeta}>{fileMeta}</Text>
            {isDownloading && (
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${Math.round(clampDownloadProgress(progress) * 100)}%`,
                    },
                  ]}
                />
              </View>
            )}
          </View>

          {/* Actions */}
          {item.isDirectory ? (
            <Icon name="chevron-forward" size={16} color="#8aabbd" />
          ) : (
            <TouchableOpacity
              style={[
                styles.downloadBtn,
                isDownloaded ? styles.downloadBtnCompleted : null,
                isDownloadDisabled && !isDownloading
                  ? styles.downloadBtnDisabled
                  : null,
              ]}
              activeOpacity={0.7}
              disabled={isDownloadDisabled}
              testID="shared-file-download-button"
              onPress={() => void handleDownload(item)}
            >
              {isDownloading ? (
                <ActivityIndicator size="small" color={BLUE} />
              ) : isDownloaded ? (
                <Icon name="checkmark-circle" size={18} color="#16a34a" />
              ) : (
                <Icon name="download-outline" size={18} color={BLUE} />
              )}
            </TouchableOpacity>
          )}
        </TouchableOpacity>
      );
    },
    [
      completedDownloads,
      downloading,
      downloadProgress,
      activeDirectoryScope,
      t,
      navigateIntoDir,
      handlePreview,
      handleDownload,
    ],
  );

  const keyExtractor = useCallback((item: SharedFileDTO) => item.path, []);
  const canNavigateToParent = currentPath !== '';
  const renderParentDirectory = canNavigateToParent ? (
    <TouchableOpacity
      style={[styles.fileRow, styles.parentDirectoryRow]}
      activeOpacity={0.7}
      onPress={navigateBack}
      testID="shared-file-parent-directory"
    >
      <View style={styles.fileIconWrapper}>
        <Icon name="arrow-up-outline" size={18} color={DARK} />
      </View>
      <View style={styles.fileInfo}>
        <Text style={styles.fileName} numberOfLines={1}>
          {t('sharedFiles.files.parentFolder')}
        </Text>
        <Text style={styles.fileMeta}>
          {t('sharedFiles.files.parentFolderMeta')}
        </Text>
      </View>
    </TouchableOpacity>
  ) : null;

  // ---------------------------------------------------------------------------
  // Content
  // ---------------------------------------------------------------------------

  let content: React.ReactElement;

  if (loading) {
    content = (
      <View style={styles.stateContainer}>
        <ActivityIndicator size="large" color={BLUE} />
        <Text style={styles.loadingText}>{t('sharedFiles.loading')}</Text>
      </View>
    );
  } else if (errorKind === 'device_unavailable') {
    content = (
      <View style={styles.stateContainer}>
        <View style={styles.stateIconCircle}>
          <Icon name="desktop-outline" size={32} color="#9ab8cc" />
        </View>
        <Text style={styles.stateTitle}>
          {t('sharedFiles.deviceUnavailable.title')}
        </Text>
        <Text style={styles.stateMessage}>
          {t('sharedFiles.deviceUnavailable.message')}
        </Text>
        <TouchableOpacity
          style={styles.retryButton}
          activeOpacity={0.7}
          onPress={() => void loadFiles(currentPath)}
        >
          <Icon name="refresh-outline" size={16} color="#fff" />
          <Text style={styles.retryButtonText}>
            {t('sharedFiles.deviceUnavailable.recheck')}
          </Text>
        </TouchableOpacity>
      </View>
    );
  } else if (errorKind === 'directory_inaccessible') {
    content = (
      <View style={styles.stateContainer}>
        <View style={styles.stateIconCircle}>
          <Icon name="folder-outline" size={32} color="#9ab8cc" />
        </View>
        <Text style={styles.stateTitle}>
          {t('sharedFiles.directoryInaccessible.title')}
        </Text>
        <Text style={styles.stateMessage}>
          {t('sharedFiles.directoryInaccessible.message')}
        </Text>
        <TouchableOpacity
          style={styles.retryButton}
          activeOpacity={0.7}
          onPress={() => void loadFiles(currentPath)}
        >
          <Icon name="refresh-outline" size={16} color="#fff" />
          <Text style={styles.retryButtonText}>{t('common.retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  } else if (errorKind === 'personal_unauthorized') {
    content = (
      <View style={styles.stateContainer}>
        <View style={styles.stateIconCircle}>
          <Icon name="person-circle-outline" size={32} color="#9ab8cc" />
        </View>
        <Text style={styles.stateTitle}>
          {t('sharedFiles.personalUnauthorized.title')}
        </Text>
        <Text style={styles.stateMessage}>
          {t('sharedFiles.personalUnauthorized.message')}
        </Text>
        <TouchableOpacity
          style={styles.retryButton}
          activeOpacity={0.7}
          onPress={() => void loadFiles(currentPath)}
        >
          <Icon name="refresh-outline" size={16} color="#fff" />
          <Text style={styles.retryButtonText}>{t('common.retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  } else if (errorKind === 'network_error') {
    content = (
      <View style={styles.stateContainer}>
        <View style={styles.stateIconCircle}>
          <Icon name="alert-circle-outline" size={32} color="#9ab8cc" />
        </View>
        <Text style={styles.stateTitle}>
          {t('sharedFiles.networkError.title')}
        </Text>
        <Text style={styles.stateMessage}>
          {t('sharedFiles.networkError.message')}
        </Text>
        <TouchableOpacity
          style={styles.retryButton}
          activeOpacity={0.7}
          onPress={() => void loadFiles(currentPath)}
        >
          <Icon name="refresh-outline" size={16} color="#fff" />
          <Text style={styles.retryButtonText}>{t('common.retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  } else if (files.length === 0 && !canNavigateToParent) {
    content = (
      <View style={styles.stateContainer}>
        <View style={styles.stateIconCircle}>
          <Icon name="folder-outline" size={32} color="#9ab8cc" />
        </View>
        <Text style={styles.stateTitle}>
          {t('sharedFiles.emptyState.title')}
        </Text>
        <Text style={styles.stateMessage}>
          {t('sharedFiles.emptyState.message')}
        </Text>
      </View>
    );
  } else {
    content = (
      <FlatList
        data={files}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={renderParentDirectory}
        ListEmptyComponent={
          canNavigateToParent ? (
            <View style={styles.inlineEmptyState}>
              <Text style={styles.stateTitle}>
                {t('sharedFiles.emptyState.title')}
              </Text>
              <Text style={styles.stateMessage}>
                {t('sharedFiles.emptyState.message')}
              </Text>
            </View>
          ) : null
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    );
  }

  // Current folder name for header
  const folderName = currentPath
    ? (currentPath.split('/').filter(Boolean).pop() ??
      t('sharedFiles.defaultFolderName'))
    : activeDirectoryScope === 'personal'
      ? t('sharedFiles.personalFolderName')
      : t('sharedFiles.teamFolderName');
  const sharedFilesConnectionLabel = t(
    `sharedFiles.connectionStatus.${sharedFilesConnectionStatus}`,
  );
  const sharedFilesConnectionStatusStyle =
    sharedFilesConnectionStatus === 'lan'
      ? styles.connectionStatusLan
      : sharedFilesConnectionStatus === 'relay'
        ? styles.connectionStatusRelay
        : sharedFilesConnectionStatus === 'p2p'
          ? styles.connectionStatusP2P
          : sharedFilesConnectionStatus === 'unavailable'
            ? styles.connectionStatusUnavailable
            : styles.connectionStatusOffline;
  const sharedFilesConnectionTextStyle =
    sharedFilesConnectionStatus === 'offline'
      ? styles.connectionStatusTextOffline
      : sharedFilesConnectionStatus === 'unavailable'
        ? styles.connectionStatusTextUnavailable
        : sharedFilesConnectionStatus === 'relay'
          ? styles.connectionStatusTextRelay
          : sharedFilesConnectionStatus === 'p2p'
            ? styles.connectionStatusTextP2P
            : styles.connectionStatusTextLan;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            activeOpacity={0.7}
            testID="shared-files-back-button"
            onPress={
              currentPath !== '' ? navigateBack : () => navigation.goBack()
            }
          >
            <Icon name="chevron-back" size={18} color={DARK} />
          </TouchableOpacity>
          <Text style={styles.title} numberOfLines={1}>
            {folderName}
          </Text>
          <View style={{ flex: 1 }} />
          <View
            style={[
              styles.connectionStatusBadge,
              sharedFilesConnectionStatusStyle,
            ]}
          >
            <Text
              style={[
                styles.connectionStatusText,
                sharedFilesConnectionTextStyle,
              ]}
              numberOfLines={1}
            >
              {sharedFilesConnectionLabel}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.refreshButton}
            activeOpacity={0.7}
            onPress={() => void loadFiles(currentPath)}
          >
            <Icon name="refresh-outline" size={18} color={DARK} />
          </TouchableOpacity>
        </View>

        <View style={styles.scopeTabs} testID="shared-files-scope-tabs">
          {DIRECTORY_SCOPES.map(scope => {
            const isActive = scope === activeDirectoryScope;
            const isDisabled = downloading !== null;
            return (
              <TouchableOpacity
                key={scope}
                style={[
                  styles.scopeTab,
                  isActive ? styles.scopeTabActive : null,
                  isDisabled ? styles.scopeTabDisabled : null,
                ]}
                activeOpacity={0.75}
                disabled={isDisabled}
                onPress={() => selectDirectoryScope(scope)}
              >
                <Text
                  style={[
                    styles.scopeTabText,
                    isActive ? styles.scopeTabTextActive : null,
                    isDisabled && !isActive
                      ? styles.scopeTabTextDisabled
                      : null,
                  ]}
                  numberOfLines={1}
                >
                  {t(`sharedFiles.scopes.${scope}`)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {content}
      </View>

      {/* Preview modal */}
      {previewFile && previewUrl && (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={closePreview}
        >
          <View style={styles.previewOverlay}>
            <View style={styles.previewHeader}>
              <TouchableOpacity onPress={closePreview} activeOpacity={0.7}>
                <Icon name="close" size={24} color="#fff" />
              </TouchableOpacity>
              <Text style={styles.previewTitle} numberOfLines={1}>
                {previewFile.name}
              </Text>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => void handleDownload(previewFile)}
              >
                <Icon name="download-outline" size={22} color="#fff" />
              </TouchableOpacity>
            </View>

            <View style={styles.previewBody}>
              {previewFile.type === 'image' ? (
                <Image
                  source={{ uri: previewUrl }}
                  style={styles.previewImage}
                  resizeMode="contain"
                  testID="shared-file-image-preview"
                />
              ) : previewFile.type === 'video' ? (
                <Video
                  source={{ uri: previewUrl }}
                  style={styles.previewImage}
                  controls
                  resizeMode="contain"
                  playInBackground
                  playWhenInactive
                  enterPictureInPictureOnLeave
                  ignoreSilentSwitch="ignore"
                  testID="shared-file-video-preview"
                />
              ) : (
                <View style={styles.filePreviewFallback}>
                  <Icon name="document-outline" size={48} color="#fff" />
                  <Text style={styles.filePreviewFallbackText}>
                    {previewFile.name}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: SCREEN_BG,
  },
  container: {
    flex: 1,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 12,
    gap: 8,
  },
  backButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: DARK,
    flexShrink: 1,
  },
  connectionStatusBadge: {
    minWidth: 76,
    height: 28,
    borderRadius: 14,
    paddingHorizontal: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  connectionStatusLan: {
    backgroundColor: 'rgba(22,163,74,0.14)',
  },
  connectionStatusP2P: {
    backgroundColor: 'rgba(59,130,246,0.14)',
  },
  connectionStatusRelay: {
    backgroundColor: 'rgba(147,51,234,0.14)',
  },
  connectionStatusUnavailable: {
    backgroundColor: 'rgba(245,158,11,0.16)',
  },
  connectionStatusOffline: {
    backgroundColor: 'rgba(71,85,105,0.12)',
  },
  connectionStatusText: {
    fontSize: 12,
    fontWeight: '700',
  },
  connectionStatusTextLan: {
    color: '#166534',
  },
  connectionStatusTextP2P: {
    color: '#1d4ed8',
  },
  connectionStatusTextRelay: {
    color: '#7e22ce',
  },
  connectionStatusTextUnavailable: {
    color: '#92400e',
  },
  connectionStatusTextOffline: {
    color: '#475569',
  },
  refreshButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scopeTabs: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.56)',
    gap: 4,
  },
  scopeTab: {
    flex: 1,
    height: 34,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scopeTabActive: {
    backgroundColor: '#fff',
  },
  scopeTabDisabled: {
    opacity: 0.72,
  },
  scopeTabText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6f91a6',
  },
  scopeTabTextActive: {
    color: DARK,
  },
  scopeTabTextDisabled: {
    color: '#9ab8cc',
  },

  // List
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },

  // File row
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  parentDirectoryRow: {
    marginBottom: 8,
  },
  fileThumbnail: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#eef6fc',
  },
  fileIconWrapper: {
    width: 44,
    height: 44,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#eef6fc',
  },
  fileInfo: {
    flex: 1,
    minWidth: 0,
  },
  fileName: {
    fontSize: 14,
    fontWeight: '600',
    color: DARK,
  },
  fileMeta: {
    fontSize: 12,
    color: '#9ab8cc',
    marginTop: 2,
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(59,159,216,0.15)',
    marginTop: 6,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: BLUE,
  },
  downloadBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(59,159,216,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  downloadBtnCompleted: {
    backgroundColor: 'rgba(22,163,74,0.1)',
  },
  downloadBtnDisabled: {
    opacity: 0.4,
  },
  separator: {
    height: 8,
  },

  // State views
  stateContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingBottom: 60,
  },
  stateIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  stateTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: DARK,
    marginBottom: 6,
  },
  stateMessage: {
    fontSize: 13,
    color: '#8aabbd',
    textAlign: 'center',
    lineHeight: 18,
  },
  inlineEmptyState: {
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingTop: 48,
  },
  loadingText: {
    fontSize: 14,
    color: '#8aabbd',
    marginTop: 12,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: BLUE,
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginTop: 20,
  },
  retryButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },

  // Preview modal
  previewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
  },
  previewTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    textAlign: 'center',
    marginHorizontal: 12,
  },
  previewBody: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  filePreviewFallback: {
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 32,
  },
  filePreviewFallbackText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
  },
});
