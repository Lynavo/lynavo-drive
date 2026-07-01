import { NativeModules, Platform } from 'react-native';
import type { DocumentPickerResponse } from '@react-native-documents/picker';
import {
  ErrorCode,
  type ErrorCode as NativeSyncErrorCode,
} from '@lynavo-drive/contracts';
import type {
  AlbumAssetDTO,
  AssetPreviewSourceDTO,
  AutoUploadConfigDTO,
  BindingStateDTO,
  DirectoryListingDTO,
  HistoryLedgerCardDTO,
  PairingErrorMetadataDTO,
  ReadOnlyQueueItemDTO,
  DirectoryScope,
  ReceivedLibraryItemDTO,
  SharedDirectoryDTO,
  SyncSummaryDTO,
  AutoUploadTimeRangeMode,
} from '@lynavo-drive/contracts';
import {
  clearAutoUploadSessionBestEffort,
  startAutoUploadSessionBestEffort,
} from '../utils/autoUploadRoundProgress';

// ---------------------------------------------------------------------------
// Raw native module reference
// ---------------------------------------------------------------------------

const { NativeSyncEngine } = NativeModules;

export const PAIRING_INVALIDATED_EVENT = 'onPairingInvalidated';

export const PAIRING_INVALIDATED_ROUTE_REASON = 'pairing_invalidated' as const;

export type PairingInvalidatedRouteReason =
  typeof PAIRING_INVALIDATED_ROUTE_REASON;

export type PairingInvalidatedEvent = {
  reason?: string;
};

export function isPairingInvalidatedEvent(
  payload: unknown,
): payload is PairingInvalidatedEvent {
  if (payload === null || payload === undefined) {
    return true;
  }
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(payload);
  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }
  const reason = (payload as { reason?: unknown }).reason;
  return reason === undefined || typeof reason === 'string';
}

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

export interface DocumentUploadFile {
  name: string;
  size: number;
  mimeType?: string | null;
  uri?: string;
}

export interface DocumentUploadResult extends ManualUploadResult {
  files: DocumentUploadFile[];
}

// ---------------------------------------------------------------------------
// Typed wrappers for Lynavo Drive native bridge methods
// ---------------------------------------------------------------------------

export interface HistoryDaysResult {
  items: HistoryLedgerCardDTO[];
  nextCursor: string | null;
}

export interface AppInfo {
  appName: string;
  version: string;
  build: string;
}

export interface EnableAutoUploadOptions {
  skipPermissionPreflight?: boolean;
}

type DocumentPickerCancelledError = Error & {
  code: 'DOCUMENT_PICKER_CANCELLED';
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readStringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

function readNumberField(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeHistoryLedgerCard(
  item: unknown,
): HistoryLedgerCardDTO | null {
  if (!isRecord(item)) {
    return null;
  }

  const activeTransmissionMs =
    readNumberField(item, 'activeTransmissionMs') ??
    readNumberField(item, 'transmissionMs') ??
    0;
  const activeTransmissionSeconds =
    readNumberField(item, 'activeTransmissionSeconds') ??
    activeTransmissionMs / 1000;

  return {
    dateKey:
      readStringField(item, 'dateKey') || readStringField(item, 'ledgerDate'),
    deviceId: readStringField(item, 'deviceId'),
    deviceName: readStringField(item, 'deviceName'),
    deviceIp: readStringField(item, 'deviceIp'),
    totalFileCount:
      readNumberField(item, 'totalFileCount') ??
      readNumberField(item, 'fileCount') ??
      0,
    totalBytes: readNumberField(item, 'totalBytes') ?? 0,
    activeTransmissionSeconds,
  };
}

function normalizePickedDocument(
  document: DocumentPickerResponse,
): DocumentUploadFile {
  return {
    name: document.name?.trim() || 'Document',
    size: document.size ?? 0,
    mimeType: document.type ?? null,
    uri: document.uri,
  };
}

function createDocumentPickerCancelledError(): DocumentPickerCancelledError {
  const error = new Error(
    'Document picker was cancelled',
  ) as DocumentPickerCancelledError;
  error.code = 'DOCUMENT_PICKER_CANCELLED';
  return error;
}

function loadDocumentPicker(): typeof import('@react-native-documents/picker') {
  return require('@react-native-documents/picker') as typeof import('@react-native-documents/picker');
}

export async function getBindingState(): Promise<BindingStateDTO | null> {
  if (typeof NativeSyncEngine?.getBindingState !== 'function') {
    return null;
  }
  const result = await NativeSyncEngine.getBindingState();
  return result as BindingStateDTO | null;
}

export async function getSyncOverview(): Promise<SyncSummaryDTO> {
  const result = await NativeSyncEngine.getSyncOverview();
  return result as SyncSummaryDTO;
}

export async function getReadOnlyQueue(): Promise<ReadOnlyQueueItemDTO[]> {
  const result = await NativeSyncEngine.getReadOnlyQueue();
  return result as ReadOnlyQueueItemDTO[];
}

export async function getHistoryDays(
  cursor?: string | null,
): Promise<HistoryDaysResult> {
  const result = await NativeSyncEngine.getHistoryDays(cursor ?? null);
  if (!isRecord(result)) {
    return { items: [], nextCursor: null };
  }
  const rawItems = Array.isArray(result.items) ? result.items : [];
  const items = rawItems.reduce<HistoryLedgerCardDTO[]>((acc, item) => {
    const normalized = normalizeHistoryLedgerCard(item);
    if (normalized) {
      acc.push(normalized);
    }
    return acc;
  }, []);
  return {
    items,
    nextCursor:
      typeof result.nextCursor === 'string' ? result.nextCursor : null,
  };
}

export async function getClientDisplayName(): Promise<string | null> {
  if (typeof NativeSyncEngine?.getClientDisplayName !== 'function') {
    return null;
  }
  const result = await NativeSyncEngine.getClientDisplayName();
  return typeof result === 'string' ? result : null;
}

export async function setClientDisplayName(name: string): Promise<void> {
  if (typeof NativeSyncEngine?.setClientDisplayName !== 'function') {
    return;
  }
  await NativeSyncEngine.setClientDisplayName(name);
}

export async function getAppInfo(): Promise<AppInfo | null> {
  if (typeof NativeSyncEngine?.getAppInfo !== 'function') {
    return null;
  }
  const result = await NativeSyncEngine.getAppInfo();
  return result ? (result as AppInfo) : null;
}

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

export async function pickDocumentUploads(): Promise<DocumentUploadResult> {
  const {
    errorCodes: documentPickerErrorCodes,
    isErrorWithCode: isDocumentPickerErrorWithCode,
    pick: pickDocuments,
  } = loadDocumentPicker();
  try {
    const documents = await pickDocuments({
      allowMultiSelection: true,
      mode: 'open',
      requestLongTermAccess: true,
    });
    return {
      queuedCount: 0,
      skippedCount: 0,
      batchId: '',
      files: documents.map(normalizePickedDocument),
    };
  } catch (error) {
    if (
      isDocumentPickerErrorWithCode(error) &&
      error.code === documentPickerErrorCodes.OPERATION_CANCELED
    ) {
      throw createDocumentPickerCancelledError();
    }
    throw error;
  }
}

export async function submitDocumentUploads(
  files: DocumentUploadFile[],
): Promise<DocumentUploadResult> {
  const result = await NativeSyncEngine.submitDocumentUploads({ files });
  return result as DocumentUploadResult;
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

/** Interrupt auto upload: stops processing auto items, persists 'interrupted' state. */
export async function interruptAutoUpload(): Promise<void> {
  await NativeSyncEngine.pauseAutoUpload();
}

/** Disable auto upload: turns the feature off, persists 'disabled' state. */
export async function disableAutoUpload(): Promise<void> {
  await NativeSyncEngine.disableAutoUpload();
  await clearAutoUploadSessionBestEffort();
}

export async function prepareAutoUploadEnable(): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }

  const status = await requestPhotoPermission();
  if (status !== 'authorized' && status !== 'limited') {
    throw new Error('Android photo library access is required for auto upload');
  }
}

/** Re-enable auto upload from interrupted/disabled state, persists 'active' state. */
export async function enableAutoUpload(
  options: EnableAutoUploadOptions = {},
): Promise<void> {
  if (!options.skipPermissionPreflight) {
    await prepareAutoUploadEnable();
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
  const result = await browseDirectory('team', path);
  return result as SharedDirectoryDTO;
}

export async function browseDirectory(
  scope: DirectoryScope,
  path?: string,
): Promise<DirectoryListingDTO> {
  const result = await NativeSyncEngine.browseSharedFiles(
    scope,
    path ?? '',
    '',
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
  const result = await NativeSyncEngine.downloadSharedFile(scope, path, '');
  return result as DownloadResult;
}

export async function downloadReceivedFile(
  fileKey: string,
  filename: string,
  mediaType?: string | null,
): Promise<DownloadResult> {
  const result = await NativeSyncEngine.downloadReceivedFile(
    fileKey,
    filename,
    mediaType ?? null,
  );
  return result as DownloadResult;
}

export async function listReceivedFiles(): Promise<ReceivedLibraryItemDTO[]> {
  const result = await NativeSyncEngine.listReceivedFiles();
  return (result ?? []) as ReceivedLibraryItemDTO[];
}

export async function listGlobalReceivedFiles(): Promise<
  ReceivedLibraryItemDTO[]
> {
  const result = await NativeSyncEngine.listGlobalReceivedFiles();
  return (result ?? []) as ReceivedLibraryItemDTO[];
}

export async function getReceivedFilePreviewUrl(
  fileKey: string,
  kind: 'download' | 'preview' | 'thumbnail' | 'stream',
): Promise<string> {
  const result = await NativeSyncEngine.getReceivedFilePreviewUrl(
    fileKey,
    kind,
  );
  return result as string;
}

export async function getDirectoryFileStreamUrl(
  scope: DirectoryScope,
  path: string,
): Promise<string> {
  const result = await NativeSyncEngine.getSharedFileStreamUrl(scope, path, '');
  return result as string;
}

export async function getPersonalFileThumbnailUrl(
  path: string,
): Promise<string> {
  const result = await NativeSyncEngine.getPersonalFileThumbnailUrl(path, '');
  return result as string;
}

export async function prepareDirectoryFilePreview(
  scope: DirectoryScope,
  path: string,
  filename?: string,
): Promise<string> {
  const result = await NativeSyncEngine.prepareSharedFilePreview(
    scope,
    path,
    '',
    filename?.trim() ?? '',
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
// Sync Identity Reset (Phase 1 / 2 / 3)
//
// Single native entry point for clearing everything the sync layer has ever
// persisted about the current local identity: binding, pairing tokens,
// clientId, upload queue, sessions, daily ledger, auto-upload config.
// `clientDisplayName` is preserved as a device preference. See the native
// SyncEngineManager.wipeSyncIdentity (iOS) / performWipeSyncIdentity
// companion (Android) implementations for the authoritative cleared-vs-kept
// list.
// ---------------------------------------------------------------------------

/** Run the full native wipe. Awaited — the caller MUST hold navigation /
 *  local identity state until this resolves or rejects, otherwise a new
 *  pairing flow can race into residual state. */
export async function wipeSyncIdentity(): Promise<void> {
  await NativeSyncEngine.wipeSyncIdentity();
}

export async function getClientId(): Promise<string> {
  const result = await NativeSyncEngine.getClientId();
  return String(result);
}

/**
 * Ask the native layer to collect logs, snapshots, and the local SQLite
 * database into a zip archive.  Returns the local file-system path to the
 * generated archive, which can be passed directly to
 * `diagnosticUploadService.upload()` or shared via the system share sheet.
 */
export async function exportDiagnostics(): Promise<string> {
  const result = await NativeSyncEngine.exportDiagnostics();
  return String(result);
}

export async function getKnownDeviceIds(): Promise<string[]> {
  const result = await NativeSyncEngine.getKnownDeviceIds();
  return (result ?? []) as string[];
}

export class PairingError extends Error {
  code: 'wrong_code' | 'blocked' | 'version_incompatible' | 'unknown';
  remainingAttempts?: number;
  blocked?: boolean;
  nativeCode?: NativeSyncErrorCode;
  meta?: PairingErrorMetadataDTO;

  constructor(
    message: string,
    code: 'wrong_code' | 'blocked' | 'version_incompatible' | 'unknown',
    remainingAttempts?: number,
    blocked?: boolean,
    nativeCode?: NativeSyncErrorCode,
    meta?: PairingErrorMetadataDTO,
  ) {
    super(message);
    this.name = 'PairingError';
    this.code = code;
    this.remainingAttempts = remainingAttempts;
    this.blocked = blocked;
    this.nativeCode = nativeCode;
    this.meta = meta;
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
    let code: 'wrong_code' | 'blocked' | 'version_incompatible' | 'unknown' =
      'unknown';

    const rawCode = err?.code || '';
    const nativeCode = Object.values(ErrorCode).includes(
      rawCode as NativeSyncErrorCode,
    )
      ? (rawCode as NativeSyncErrorCode)
      : undefined;
    const rawMeta = err?.meta ?? err?.userInfo?.meta ?? err?.userInfo;
    const meta: PairingErrorMetadataDTO | undefined = rawMeta
      ? {
          failedAttempts:
            typeof rawMeta.failedAttempts === 'number'
              ? rawMeta.failedAttempts
              : undefined,
          remainingAttempts:
            typeof rawMeta.remainingAttempts === 'number'
              ? rawMeta.remainingAttempts
              : undefined,
          maxAttempts:
            typeof rawMeta.maxAttempts === 'number'
              ? rawMeta.maxAttempts
              : undefined,
        }
      : undefined;
    if (
      rawCode === 'WRONG_CODE' ||
      rawCode === 'wrong_code' ||
      rawCode === ErrorCode.PAIR_CODE_INVALID ||
      rawCode === ErrorCode.PAIRING_CODE_INVALID ||
      errMsg.includes('wrong_code') ||
      errMsg.includes('Pairing rejected')
    ) {
      code = 'wrong_code';
    } else if (
      rawCode === 'BLOCKED' ||
      rawCode === 'blocked' ||
      rawCode === ErrorCode.PAIRING_CLIENT_BLOCKED ||
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

    const remainingAttempts =
      err?.remainingAttempts !== undefined
        ? Number(err.remainingAttempts)
        : meta?.remainingAttempts !== undefined
          ? Number(meta.remainingAttempts)
          : undefined;

    const blocked =
      err?.blocked !== undefined
        ? Boolean(err.blocked)
        : err?.userInfo?.blocked !== undefined
          ? Boolean(err.userInfo.blocked)
          : undefined;

    throw new PairingError(
      errMsg,
      code,
      remainingAttempts,
      blocked || code === 'blocked',
      nativeCode,
      meta,
    );
  }
}
