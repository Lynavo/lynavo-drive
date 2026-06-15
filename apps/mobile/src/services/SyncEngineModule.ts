import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import type {
  AlbumAssetDTO,
  AssetPreviewSourceDTO,
  AutoUploadConfigDTO,
  DirectoryListingDTO,
  DirectoryScope,
  SharedDirectoryDTO,
  AutoUploadTimeRangeMode,
} from '@syncflow/contracts';
import {
  clearAutoUploadSessionBestEffort,
  startAutoUploadSessionBestEffort,
} from '../utils/autoUploadRoundProgress';

// ---------------------------------------------------------------------------
// Raw native module reference
// ---------------------------------------------------------------------------

const { NativeSyncEngine } = NativeModules;

// ---------------------------------------------------------------------------
// Album stats — returned by getAlbumStats bridge method
// ---------------------------------------------------------------------------

export interface AlbumStats {
  totalCount: number;
  transferredCount: number;
  queuedCount: number;
  /**
   * Remaining assets that still need to be uploaded. Honours the auto-upload
   * time range filter when it is active; otherwise equals
   * `totalCount - transferredCount`.
   */
  pendingCount: number;
}

// ---------------------------------------------------------------------------
// Manual upload result — returned by submitManualUpload bridge method
// ---------------------------------------------------------------------------

export interface ManualUploadResult {
  queuedCount: number;
  skippedCount: number;
  batchId: string;
}

export interface AndroidBackgroundKeepaliveStatus {
  backgroundKeepaliveStrategy:
    | 'android_cn_foreground_service_battery_whitelist'
    | 'android_global_foreground_service_play_compliant';
  foregroundServiceActive: boolean;
  foregroundServiceStopRequested: boolean;
  batteryOptimizationIgnored: boolean;
  postNotificationsGranted: boolean;
  lastBackgroundStopReason: string | null;
}

// ---------------------------------------------------------------------------
// Typed wrappers for Vivi Drop native bridge methods
// ---------------------------------------------------------------------------

export async function browseAlbum(
  mediaFilter: string,
  transferFilter: string,
  offset: number,
  limit: number,
  collectionId?: string,
): Promise<AlbumAssetDTO[]> {
  const result = await NativeSyncEngine.browseAlbum({
    mediaFilter,
    transferFilter,
    offset,
    limit,
    collectionId: collectionId ?? undefined,
  });
  return (result ?? []) as AlbumAssetDTO[];
}

export async function getAlbumStats(): Promise<AlbumStats> {
  const result = await NativeSyncEngine.getAlbumStats();
  return result as AlbumStats;
}

export interface AlbumCollectionInfo {
  collectionId: string;
  title: string;
  count: number;
}

export async function getAlbumCollections(
  mediaFilter: string,
): Promise<AlbumCollectionInfo[]> {
  const result = await NativeSyncEngine.getAlbumCollections(mediaFilter);
  return (result ?? []) as AlbumCollectionInfo[];
}

export async function getAssetPreviewSource(
  assetLocalId: string,
): Promise<AssetPreviewSourceDTO> {
  const result = await NativeSyncEngine.getAssetPreviewSource(assetLocalId);
  return result as AssetPreviewSourceDTO;
}

export async function submitManualUpload(
  assetLocalIds: string[],
): Promise<ManualUploadResult> {
  if (assetLocalIds.length > 0) {
    await requestAndroidBackgroundSyncNotificationPermission();
  }
  const result = await NativeSyncEngine.submitManualUpload({ assetLocalIds });
  return result as ManualUploadResult;
}

export async function cancelManualBatch(batchId: string): Promise<void> {
  await NativeSyncEngine.cancelManualBatch(batchId);
}

export async function cancelAllManualUploads(): Promise<void> {
  await NativeSyncEngine.cancelAllManualUploads();
}

export async function retryLanReconnect(params: {
  allowWake: boolean;
}): Promise<void> {
  if (typeof NativeSyncEngine.retryLanReconnect === 'function') {
    await NativeSyncEngine.retryLanReconnect(params);
    return;
  }
  await NativeSyncEngine.startDiscovery?.();
  await NativeSyncEngine.triggerSync?.();
}

export async function savePublicWakeTarget(config: {
  host: string;
  port: number;
  enabled: boolean;
}): Promise<void> {
  await NativeSyncEngine.savePublicWakeTarget(config);
}

/** Interrupt auto upload: stops processing auto items, persists 'interrupted' state. */
export async function interruptAutoUpload(): Promise<void> {
  await NativeSyncEngine.pauseAutoUpload();
}

/** Disable auto upload: turns the feature off, persists 'disabled' state. */
export async function disableAutoUpload(): Promise<void> {
  await NativeSyncEngine.disableAutoUpload();
  await clearAutoUploadSessionBestEffort();
}

/** Re-enable auto upload from interrupted/disabled state, persists 'active' state. */
export async function enableAutoUpload(): Promise<void> {
  if (Platform.OS === 'android') {
    const status = await requestPhotoPermission();
    if (status !== 'authorized' && status !== 'limited') {
      throw new Error(
        'Android photo library access is required for auto upload',
      );
    }
    await requestAndroidBackgroundSyncNotificationPermission();
  }

  let currentConfig: AutoUploadConfigDTO | undefined;
  try {
    currentConfig = (await NativeSyncEngine.getAutoUploadConfig?.()) as
      | AutoUploadConfigDTO
      | undefined;
  } catch (e) {
    console.warn(
      '[SyncEngineModule] getAutoUploadConfig before enable failed:',
      e,
    );
  }
  if (currentConfig?.state === 'disabled') {
    await clearAutoUploadSessionBestEffort();
  }
  await startAutoUploadSessionBestEffort();
  await NativeSyncEngine.resumeAutoUpload();
}

export async function getAutoUploadConfig(): Promise<AutoUploadConfigDTO> {
  const result = await NativeSyncEngine.getAutoUploadConfig();
  return result as AutoUploadConfigDTO;
}

export async function getAndroidBackgroundKeepaliveStatus(): Promise<AndroidBackgroundKeepaliveStatus> {
  const result = await NativeSyncEngine.getAndroidBackgroundKeepaliveStatus();
  return result as AndroidBackgroundKeepaliveStatus;
}

export async function isIgnoringBatteryOptimizations(): Promise<boolean> {
  const result = await NativeSyncEngine.isIgnoringBatteryOptimizations();
  return Boolean(result);
}

export async function requestIgnoreBatteryOptimizations(): Promise<boolean> {
  const result = await NativeSyncEngine.requestIgnoreBatteryOptimizations();
  return Boolean(result);
}

export async function saveAutoUploadConfig(config: {
  enabled: boolean;
  timeRangeMode: AutoUploadTimeRangeMode;
  customTimeFrom?: string;
}): Promise<void> {
  await NativeSyncEngine.saveAutoUploadConfig(config);
}

export async function browseSharedFiles(
  path?: string,
): Promise<SharedDirectoryDTO> {
  const result = await browseDirectory('team', path);
  return result as SharedDirectoryDTO;
}

function getCurrentAccessToken(): string {
  const authStore =
    require('../stores/auth-store') as typeof import('../stores/auth-store');
  return authStore.getAccessToken() ?? '';
}

export async function browseDirectory(
  scope: DirectoryScope,
  path?: string,
): Promise<DirectoryListingDTO> {
  const result = await NativeSyncEngine.browseSharedFiles(
    scope,
    path ?? '',
    scope === 'personal' ? getCurrentAccessToken() : '',
  );
  return result as DirectoryListingDTO;
}

export interface DownloadResult {
  savedToPhotos: boolean;
  localPath: string | null;
  savedLocation?: string | null;
}

export async function downloadDirectoryFile(
  scope: DirectoryScope,
  path: string,
): Promise<DownloadResult> {
  const result = await NativeSyncEngine.downloadSharedFile(
    scope,
    path,
    scope === 'personal' ? getCurrentAccessToken() : '',
  );
  return result as DownloadResult;
}

export async function getDirectoryFileStreamUrl(
  scope: DirectoryScope,
  path: string,
): Promise<string> {
  const result = await NativeSyncEngine.getSharedFileStreamUrl(
    scope,
    path,
    scope === 'personal' ? getCurrentAccessToken() : '',
  );
  return result as string;
}

export async function prepareDirectoryFilePreview(
  scope: DirectoryScope,
  path: string,
): Promise<string> {
  const result = await NativeSyncEngine.prepareSharedFilePreview(
    scope,
    path,
    scope === 'personal' ? getCurrentAccessToken() : '',
  );
  return result as string;
}

export async function downloadSharedFile(
  path: string,
): Promise<DownloadResult> {
  return downloadDirectoryFile('team', path);
}

export async function getSharedFileStreamUrl(path: string): Promise<string> {
  return getDirectoryFileStreamUrl('team', path);
}

export async function shareFile(localPath: string): Promise<boolean> {
  const result = await NativeSyncEngine.shareFile(localPath);
  return result as boolean;
}

export async function startBackgroundSyncService(
  reason: string,
): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }
  if (typeof NativeSyncEngine.startBackgroundSyncService !== 'function') {
    return;
  }
  await NativeSyncEngine.startBackgroundSyncService(reason);
}

export async function stopBackgroundSyncService(): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }
  if (typeof NativeSyncEngine.stopBackgroundSyncService !== 'function') {
    return;
  }
  await NativeSyncEngine.stopBackgroundSyncService();
}

async function requestAndroidBackgroundSyncNotificationPermission(): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }

  const version =
    typeof Platform.Version === 'number'
      ? Platform.Version
      : Number.parseInt(String(Platform.Version), 10);
  if (!Number.isFinite(version) || version < 33) {
    return;
  }

  const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
  if (!permission) {
    return;
  }

  if (await PermissionsAndroid.check(permission)) {
    return;
  }

  const result = await PermissionsAndroid.request(permission);
  if (result !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new Error(
      'Android notification permission is required for background sync',
    );
  }
}

export async function setBackgroundSilentAudioEnabled(
  enabled: boolean,
): Promise<void> {
  if (Platform.OS !== 'ios') {
    return;
  }
  if (typeof NativeSyncEngine.setBackgroundSilentAudioEnabled !== 'function') {
    return;
  }
  await NativeSyncEngine.setBackgroundSilentAudioEnabled(enabled);
}

// ---------------------------------------------------------------------------
// Photo library permission helpers
// ---------------------------------------------------------------------------

export type PhotoAuthorizationStatus =
  | 'authorized'
  | 'limited'
  | 'denied'
  | 'restricted'
  | 'notDetermined'
  | 'unknown';

function normalizePhotoAuthorizationStatus(
  status: unknown,
): PhotoAuthorizationStatus {
  switch (status) {
    case 'authorized':
    case 'granted':
      return 'authorized';
    case 'limited':
      return 'limited';
    case 'denied':
      return 'denied';
    case 'restricted':
      return 'restricted';
    case 'notDetermined':
    case 'not_determined':
      return 'notDetermined';
    default:
      return 'unknown';
  }
}

/** Check current photo library authorization without prompting. */
export async function getPhotoAuthorizationStatus(): Promise<PhotoAuthorizationStatus> {
  const result = await NativeSyncEngine.getPhotoAuthorizationStatus();
  return normalizePhotoAuthorizationStatus(result);
}

/** Request photo library authorization. Android needs this before MediaStore reads. */
export async function requestPhotoPermission(): Promise<PhotoAuthorizationStatus> {
  const result = await NativeSyncEngine.requestPhotoPermission();
  return normalizePhotoAuthorizationStatus(result);
}

/** Present the iOS limited photo picker so the user can add more photos. */
export async function presentLimitedPhotoPicker(): Promise<void> {
  await NativeSyncEngine.presentLimitedPhotoPicker();
}

// ---------------------------------------------------------------------------
// Account Identity Reset (Phase 1 / 2 / 3)
//
// Single native entry point for clearing everything the sync layer has ever
// persisted about the current account: binding, pairing tokens, clientId,
// upload queue, sessions, daily ledger, auto-upload config. `clientDisplayName`
// is preserved as a device preference. See the native
// SyncEngineManager.wipeSyncIdentity (iOS) / performWipeSyncIdentity
// companion (Android) implementations for the authoritative cleared-vs-kept
// list.
// ---------------------------------------------------------------------------

/** Run the full native wipe. Awaited — the caller MUST hold navigation /
 *  auth state until this resolves or rejects, otherwise the next login flow
 *  can race into residual state. */
export async function wipeSyncIdentity(): Promise<void> {
  await NativeSyncEngine.wipeSyncIdentity();
}

/** Read the auth user-id last bound to the sync identity on this device.
 *  `null` means "no owner recorded yet" (fresh install, post-wipe, or an
 *  older build that never wrote the field).
 *
 *  Returned as a string so backend ids above 2^53 round-trip losslessly —
 *  the native bridge would otherwise demote through `Double` on both
 *  iOS (`NSNumber`) and Android (`Long`). Callers compare against
 *  `String(profile.id)`. */
export async function getOwnerUserId(): Promise<string | null> {
  const result = await NativeSyncEngine.getOwnerUserId();
  if (typeof result !== 'string' || result.length === 0) {
    return null;
  }
  return result;
}

export async function getClientId(): Promise<string> {
  const result = await NativeSyncEngine.getClientId();
  return String(result);
}

/** Record the auth user-id now bound to the sync identity on this device.
 *  Written after a successful login + owner-check, so a later login by a
 *  different user can be detected via owner mismatch and force a wipe.
 *
 *  Accepts either `number | string` for caller convenience; we stringify
 *  before the native call so the bridge layer never sees `Double` and
 *  can't lose precision on ids above 2^53. */
export async function setOwnerUserId(userId: number | string): Promise<void> {
  await NativeSyncEngine.setOwnerUserId(String(userId));
}

export async function getKnownDeviceIds(): Promise<string[]> {
  const result = await NativeSyncEngine.getKnownDeviceIds();
  return (result ?? []) as string[];
}

export async function setTunnelCredentials(
  signalingUrl: string,
  accessToken: string,
  iceServersJSON: string,
): Promise<void> {
  await NativeSyncEngine.setTunnelCredentials(
    signalingUrl,
    accessToken,
    iceServersJSON,
  );
}

export class PairingError extends Error {
  code: 'wrong_code' | 'blocked' | 'version_incompatible' | 'unknown';
  remainingAttempts?: number;
  blocked?: boolean;

  constructor(
    message: string,
    code: 'wrong_code' | 'blocked' | 'version_incompatible' | 'unknown',
    remainingAttempts?: number,
    blocked?: boolean
  ) {
    super(message);
    this.name = 'PairingError';
    this.code = code;
    this.remainingAttempts = remainingAttempts;
    this.blocked = blocked;
  }
}

export async function pairDevice(params: {
  deviceId: string;
  host: string;
  port: number;
  connectionCode: string;
}): Promise<void> {
  try {
    await NativeSyncEngine.pairDevice(params);
  } catch (err: any) {
    const errMsg = err?.message || 'Unknown pairing error';
    let code: 'wrong_code' | 'blocked' | 'version_incompatible' | 'unknown' = 'unknown';
    
    const rawCode = err?.code || '';
    if (
      rawCode === 'WRONG_CODE' ||
      rawCode === 'wrong_code' ||
      errMsg.includes('wrong_code') ||
      errMsg.includes('Pairing rejected')
    ) {
      code = 'wrong_code';
    } else if (
      rawCode === 'BLOCKED' ||
      rawCode === 'blocked' ||
      errMsg.includes('blocked')
    ) {
      code = 'blocked';
    } else if (
      rawCode === 'APP_VERSION_INCOMPATIBLE' ||
      rawCode === 'version_incompatible' ||
      errMsg.includes('版本不相容') ||
      errMsg.includes('APP_VERSION_INCOMPATIBLE') ||
      errMsg.includes('版本不兼容')
    ) {
      code = 'version_incompatible';
    }

    const remainingAttempts = err?.remainingAttempts !== undefined
      ? Number(err.remainingAttempts)
      : (err?.userInfo?.remainingAttempts !== undefined ? Number(err.userInfo.remainingAttempts) : undefined);

    const blocked = err?.blocked !== undefined
      ? Boolean(err.blocked)
      : (err?.userInfo?.blocked !== undefined ? Boolean(err.userInfo.blocked) : undefined);

    throw new PairingError(errMsg, code, remainingAttempts, blocked || (code === 'blocked'));
  }
}

