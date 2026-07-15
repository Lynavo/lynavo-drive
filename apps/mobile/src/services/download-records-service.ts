import AsyncStorage from '@react-native-async-storage/async-storage';

import { recordDiagnosticsLog } from './diagnostics-log-service';

export interface DownloadRecord {
  id: string;
  resourceId: string;
  filename: string;
  fileSize?: number;
  mediaType?: string;
  downloadedAt: string;
  localPath?: string | null;
  thumbnailUrl?: string | null;
  previewUrl?: string | null;
  streamUrl?: string | null;
  savedToPhotos?: boolean;
}

interface RecordDownloadedFileInput {
  resourceId: string;
  filename: string;
  fileSize?: number;
  mediaType?: string;
  localPath?: string | null;
  thumbnailUrl?: string | null;
  previewUrl?: string | null;
  streamUrl?: string | null;
  savedToPhotos?: boolean;
}

export const DOWNLOAD_RECORDS_STORAGE_KEY = 'lynavo-drive:download-records:v1';
const MAX_RECORDS = 50;
const LEGACY_MOCK_PATH_PREFIX = '/mock/path/';

/**
 * personal-dir: records carry time-limited HMAC signatures
 * (X-LynavoDrive-Auth / X-LynavoDrive-Auth-Timestamp) that expire after
 * 5 minutes.  Persisting those URLs causes permanent thumbnail and
 * preview failures once the signature window closes.  For these
 * records we rely on localPath for display instead.
 */
export function isPersonalDirRecord(resourceId: string): boolean {
  return resourceId.startsWith('personal-dir:');
}

function isDownloadRecord(value: unknown): value is DownloadRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<DownloadRecord>;
  return (
    typeof record.id === 'string' &&
    typeof record.resourceId === 'string' &&
    typeof record.filename === 'string' &&
    typeof record.downloadedAt === 'string'
  );
}

function normalizeLocalPath(
  value: DownloadRecord['localPath'],
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  if (
    !trimmed ||
    trimmed === '/mock/path' ||
    trimmed.startsWith(LEGACY_MOCK_PATH_PREFIX)
  ) {
    return null;
  }
  return trimmed;
}

function normalizeOptionalString(value?: string | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeDownloadRecord(record: DownloadRecord): DownloadRecord {
  const localPath = normalizeLocalPath(record.localPath);
  // personal-dir: URLs carry short-lived HMAC signatures — strip them even
  // when reading from storage, so stale data written by older app versions
  // does not cause permanent thumbnail failures.
  const isPersonalDir = isPersonalDirRecord(record.resourceId);
  const thumbnailUrl = isPersonalDir
    ? undefined
    : normalizeOptionalString(record.thumbnailUrl);
  const previewUrl = isPersonalDir
    ? undefined
    : normalizeOptionalString(record.previewUrl);
  const streamUrl = isPersonalDir
    ? undefined
    : normalizeOptionalString(record.streamUrl);
  const rest = { ...record };
  delete rest.localPath;
  delete rest.thumbnailUrl;
  delete rest.previewUrl;
  delete rest.streamUrl;

  const normalized: DownloadRecord = {
    ...rest,
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    ...(previewUrl ? { previewUrl } : {}),
    ...(streamUrl ? { streamUrl } : {}),
  };

  if (localPath === undefined) {
    return normalized;
  }
  return { ...normalized, localPath };
}

export async function listDownloadRecords(): Promise<DownloadRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(DOWNLOAD_RECORDS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isDownloadRecord)
      .map(normalizeDownloadRecord)
      .sort(
        (a, b) =>
          new Date(b.downloadedAt).getTime() -
          new Date(a.downloadedAt).getTime(),
      );
  } catch {
    return [];
  }
}

export async function recordDownloadedFile(
  input: RecordDownloadedFileInput,
): Promise<DownloadRecord> {
  // personal-dir: URLs carry short-lived HMAC signatures — do not persist.
  const isPersonalDir = isPersonalDirRecord(input.resourceId);
  const thumbnailUrl = isPersonalDir
    ? undefined
    : normalizeOptionalString(input.thumbnailUrl);
  const previewUrl = isPersonalDir
    ? undefined
    : normalizeOptionalString(input.previewUrl);
  const streamUrl = isPersonalDir
    ? undefined
    : normalizeOptionalString(input.streamUrl);
  const record: DownloadRecord = {
    id: input.resourceId,
    resourceId: input.resourceId,
    filename: input.filename,
    fileSize: input.fileSize,
    mediaType: input.mediaType,
    downloadedAt: new Date().toISOString(),
    localPath: normalizeLocalPath(input.localPath) ?? null,
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    ...(previewUrl ? { previewUrl } : {}),
    ...(streamUrl ? { streamUrl } : {}),
    savedToPhotos: input.savedToPhotos,
  };
  const records = await listDownloadRecords();
  const nextRecords = [
    record,
    ...records.filter(item => item.resourceId !== input.resourceId),
  ].slice(0, MAX_RECORDS);
  await AsyncStorage.setItem(
    DOWNLOAD_RECORDS_STORAGE_KEY,
    JSON.stringify(nextRecords),
  );
  recordDiagnosticsLog('DownloadRecords', 'record persisted', {
    resourceId: record.resourceId,
    filename: record.filename,
    mediaType: record.mediaType,
    savedToPhotos: record.savedToPhotos,
    hasLocalPath: Boolean(record.localPath?.trim()),
    hasThumbnailUrl: Boolean(record.thumbnailUrl?.trim()),
    hasPreviewUrl: Boolean(record.previewUrl?.trim()),
    hasStreamUrl: Boolean(record.streamUrl?.trim()),
    recordCount: nextRecords.length,
  });
  return record;
}

export async function clearDownloadRecords(): Promise<void> {
  await AsyncStorage.removeItem(DOWNLOAD_RECORDS_STORAGE_KEY);
}
