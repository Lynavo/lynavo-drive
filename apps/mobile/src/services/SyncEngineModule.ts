import { NativeModules } from 'react-native';
import type {
  AlbumAssetDTO,
  AutoUploadConfigDTO,
  SharedDirectoryDTO,
  AutoUploadMediaFilter,
  AutoUploadTimeRangeMode,
} from '@syncflow/contracts';

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

export async function submitManualUpload(
  assetLocalIds: string[],
): Promise<ManualUploadResult> {
  const result = await NativeSyncEngine.submitManualUpload({ assetLocalIds });
  return result as ManualUploadResult;
}

export async function cancelManualBatch(batchId: string): Promise<void> {
  await NativeSyncEngine.cancelManualBatch(batchId);
}

export async function pauseAutoUpload(): Promise<void> {
  await NativeSyncEngine.pauseAutoUpload();
}

export async function resumeAutoUpload(): Promise<void> {
  await NativeSyncEngine.resumeAutoUpload();
}

export async function getAutoUploadConfig(): Promise<AutoUploadConfigDTO> {
  const result = await NativeSyncEngine.getAutoUploadConfig();
  return result as AutoUploadConfigDTO;
}

export async function saveAutoUploadConfig(config: {
  enabled: boolean;
  mediaFilter: AutoUploadMediaFilter;
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

export async function downloadSharedFile(path: string): Promise<DownloadResult> {
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
