import { NativeModules, Platform } from 'react-native';
import type {
  AlbumAssetDTO,
  AssetPreviewSourceDTO,
  AutoUploadConfigDTO,
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
  const result = await NativeSyncEngine.submitManualUpload({ assetLocalIds });
  return result as ManualUploadResult;
}

export async function cancelManualBatch(batchId: string): Promise<void> {
  await NativeSyncEngine.cancelManualBatch(batchId);
}

export async function cancelAllManualUploads(): Promise<void> {
  await NativeSyncEngine.cancelAllManualUploads();
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
  const result = await NativeSyncEngine.browseSharedFiles(path ?? '');
  return result as SharedDirectoryDTO;
}

export interface DownloadResult {
  savedToPhotos: boolean;
  localPath: string | null;
}

export async function downloadSharedFile(
  path: string,
): Promise<DownloadResult> {
  const result = await NativeSyncEngine.downloadSharedFile(path);
  return result as DownloadResult;
}

export async function getSharedFileStreamUrl(path: string): Promise<string> {
  const result = await NativeSyncEngine.getSharedFileStreamUrl(path);
  return result as string;
}

export async function shareFile(localPath: string): Promise<boolean> {
  const result = await NativeSyncEngine.shareFile(localPath);
  return result as boolean;
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
