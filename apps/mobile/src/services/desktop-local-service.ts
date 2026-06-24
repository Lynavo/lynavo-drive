import { NativeModules, Platform } from 'react-native';
import type {
  DesktopSharedResourceDTO,
  DirectoryFileDTO,
  DirectoryListingDTO,
  ReceivedLibraryItemDTO,
  ReceivedLibraryPageDTO,
  DesktopSyncRecordDTO,
  SharedDirectoryDTO,
} from '@syncflow/contracts';
import {
  browseDirectory,
  downloadDirectoryFile,
  downloadReceivedFile,
  getClientId,
  getDirectoryFileStreamUrl,
  getReceivedFilePreviewUrl as getNativeReceivedFilePreviewUrl,
  listGlobalReceivedFiles,
  listReceivedFiles,
  prepareDirectoryFilePreview,
} from './SyncEngineModule';
import { recordDiagnosticsLog } from './diagnostics-log-service';

const { NativeSyncEngine } = NativeModules;

export interface DesktopInfo {
  host: string;
  port: number;
}

export interface ResourceDownloadResult {
  savedToPhotos: boolean;
  localPath: string | null;
  savedLocation?: string | null;
}

export interface ResourceShareItem {
  resourceId: string;
  displayName: string;
}

type DesktopSharedResourceWithPreview = DesktopSharedResourceDTO & {
  previewUrl?: string;
  thumbnailUrl?: string;
  streamUrl?: string;
};

export type ReceivedLibraryMediaItem = ReceivedLibraryItemDTO & {
  previewUrl?: string;
  thumbnailUrl?: string;
  streamUrl?: string;
};

export type ReceivedLibraryMediaPage = Omit<ReceivedLibraryPageDTO, 'items'> & {
  items: ReceivedLibraryMediaItem[];
};

type ReceivedLibraryPageOptions = {
  page?: number;
  pageSize?: number;
};

export type GlobalRemoteAccessResource = DesktopSharedResourceDTO & {
  previewUrl?: string;
  thumbnailUrl?: string;
  streamUrl?: string;
};

const SHARED_DIRECTORY_RESOURCE_PREFIX = 'shared-dir:';
const SHARED_DIRECTORY_DESKTOP_ID = 'shared-dir';
const SHARED_FOLDER_ENTRY_PREFIX = 'shared-folder-entry:';
const PERSONAL_DIRECTORY_RESOURCE_PREFIX = 'personal-dir:';
const PERSONAL_DIRECTORY_DESKTOP_ID = 'personal-dir';
const DIRECT_RECEIVED_LIBRARY_HTTP_TIMEOUT_MS = 1500;

function receivedLibraryErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function isDownloadSavedLocally(
  result: ResourceDownloadResult,
): boolean {
  return (
    result.savedToPhotos ||
    (typeof result.localPath === 'string' &&
      result.localPath.trim().length > 0) ||
    (typeof result.savedLocation === 'string' &&
      result.savedLocation.trim().length > 0)
  );
}

export function isDownloadSavedToPhotos(result: {
  savedToPhotos?: boolean;
  localPath?: string | null;
  savedLocation?: string | null;
}): boolean {
  if (result.savedToPhotos === true) {
    return true;
  }
  const localPath =
    typeof result.localPath === 'string'
      ? result.localPath.trim().toLowerCase()
      : '';
  if (localPath.startsWith('ph://')) {
    return true;
  }
  const savedLocation =
    typeof result.savedLocation === 'string'
      ? result.savedLocation.trim().replace(/\\/g, '/').toLowerCase()
      : '';
  return (
    savedLocation === 'photos' ||
    savedLocation === 'camera roll' ||
    savedLocation === 'pictures' ||
    savedLocation.startsWith('pictures/') ||
    savedLocation === 'movies' ||
    savedLocation.startsWith('movies/')
  );
}

async function resourceDownloadUrl(
  desktop: DesktopInfo,
  resourceId: string,
): Promise<string> {
  if (isSharedDirectoryResourceId(resourceId)) {
    const sharedPath = getSharedDirectoryPathFromResourceId(resourceId);
    const encodedPath = encodeRemotePath(sharedPath);
    return `http://${desktop.host}:${desktop.port}/shared/download/${encodedPath}`;
  }

  // shared-folder-entry:{rootResourceId}:{filePath} — file inside a database-backed folder
  if (resourceId.startsWith(SHARED_FOLDER_ENTRY_PREFIX)) {
    const rest = resourceId.slice(SHARED_FOLDER_ENTRY_PREFIX.length);
    const colonIdx = rest.indexOf(':');
    if (colonIdx === -1) {
      throw new Error('Invalid shared-folder-entry resource ID');
    }
    const rootResourceId = rest.slice(0, colonIdx);
    const filePath = rest.slice(colonIdx + 1);
    const clientId = await getClientId();
    const clientName =
      (await NativeSyncEngine?.getClientDisplayName?.()) || clientId;
    return `http://${desktop.host}:${
      desktop.port
    }/resources/mobile/download/${encodeURIComponent(
      rootResourceId,
    )}?path=${encodeURIComponent(
      filePath,
    )}&clientId=${clientId}&clientName=${encodeURIComponent(clientName)}`;
  }

  const clientId = await getClientId();
  const clientName =
    (await NativeSyncEngine?.getClientDisplayName?.()) || clientId;
  return `http://${desktop.host}:${
    desktop.port
  }/resources/mobile/download/${resourceId}?clientId=${clientId}&clientName=${encodeURIComponent(
    clientName,
  )}`;
}

export async function getResourcePreviewUrl(
  desktop: DesktopInfo,
  resourceId: string,
): Promise<string> {
  return resourceDownloadUrl(desktop, resourceId);
}

export async function prepareResourcePreview(
  desktop: DesktopInfo,
  resourceId: string,
  filename?: string,
): Promise<string> {
  if (typeof NativeSyncEngine?.downloadUrlToShareCache !== 'function') {
    throw new Error('System preview is not available');
  }

  const url = await resourceDownloadUrl(desktop, resourceId);
  const localPath = await NativeSyncEngine.downloadUrlToShareCache(
    url,
    filename?.trim() || 'remote-file',
  );
  if (typeof localPath !== 'string' || localPath.trim().length === 0) {
    throw new Error('Remote file was not prepared for preview');
  }
  return localPath;
}

async function requestResourceDownload(
  desktop: DesktopInfo,
  resourceId: string,
): Promise<void> {
  const url = await resourceDownloadUrl(desktop, resourceId);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download resource: ${res.statusText}`);
  }
}

function encodeRemotePath(path?: string): string {
  return (path ?? '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(segment => segment.trim().length > 0)
    .map(segment => encodeURIComponent(segment))
    .join('/');
}

function decodeRemotePath(path: string): string {
  return path
    .split('/')
    .map(segment => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join('/');
}

function normalizeRemotePath(path?: string): string {
  return (path ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(segment => segment.trim().length > 0)
    .join('/');
}

function joinRemotePath(basePath: string, childPath?: string): string {
  const normalizedBase = normalizeRemotePath(basePath);
  const normalizedChild = normalizeRemotePath(childPath);
  if (!normalizedBase) return normalizedChild;
  if (!normalizedChild) return normalizedBase;
  return `${normalizedBase}/${normalizedChild}`;
}

function isSharedDirectoryResourceId(resourceId: string): boolean {
  return resourceId.startsWith(SHARED_DIRECTORY_RESOURCE_PREFIX);
}

function isPersonalDirectoryResourceId(resourceId: string): boolean {
  return resourceId.startsWith(PERSONAL_DIRECTORY_RESOURCE_PREFIX);
}

function getSharedDirectoryPathFromResourceId(resourceId: string): string {
  const encodedPath = resourceId.slice(SHARED_DIRECTORY_RESOURCE_PREFIX.length);
  return normalizeRemotePath(decodeRemotePath(encodedPath));
}

function getPersonalDirectoryPathFromResourceId(resourceId: string): string {
  if (!isPersonalDirectoryResourceId(resourceId)) {
    throw new Error('Invalid personal directory resource ID');
  }
  const encodedPath = resourceId.slice(
    PERSONAL_DIRECTORY_RESOURCE_PREFIX.length,
  );
  return normalizeRemotePath(decodeRemotePath(encodedPath));
}

function sharedDirectoryResourceId(path: string): string {
  return `${SHARED_DIRECTORY_RESOURCE_PREFIX}${encodeRemotePath(path)}`;
}

function personalDirectoryResourceId(path: string): string {
  return `${PERSONAL_DIRECTORY_RESOURCE_PREFIX}${encodeRemotePath(path)}`;
}

function directoryFileToSharedResource(
  file: DirectoryFileDTO,
): DesktopSharedResourceWithPreview {
  return {
    resourceId: sharedDirectoryResourceId(file.path),
    desktopDeviceId: SHARED_DIRECTORY_DESKTOP_ID,
    kind: file.isDirectory ? 'shared_folder' : 'shared_file',
    displayName: file.name,
    status: 'available',
    fileSize: file.size,
    mediaType: file.type,
    addedAt: file.modifiedAt,
    downloadCount: 0,
    ...directoryFilePreviewUrls(file),
  };
}

function personalDirectoryFileToSharedResource(
  file: DirectoryFileDTO,
): GlobalRemoteAccessResource {
  return {
    resourceId: personalDirectoryResourceId(file.path),
    desktopDeviceId: PERSONAL_DIRECTORY_DESKTOP_ID,
    kind: file.isDirectory ? 'shared_folder' : 'shared_file',
    displayName: file.name,
    status: 'available',
    fileSize: file.size,
    mediaType: file.type,
    addedAt: file.modifiedAt,
    downloadCount: 0,
    ...directoryFilePreviewUrls(file),
  };
}

function directoryFilePreviewUrls(
  file: DirectoryFileDTO,
): Pick<
  DesktopSharedResourceWithPreview,
  'previewUrl' | 'thumbnailUrl' | 'streamUrl'
> {
  if (file.isDirectory) {
    return {};
  }

  const thumbnailUrl = file.thumbnailUrl?.trim();
  const streamUrl = file.streamUrl?.trim();

  if (file.type === 'video') {
    console.info('[video-thumbnail][mobile] directory video urls', {
      name: file.name,
      path: file.path,
      hasThumbnailUrl: Boolean(thumbnailUrl),
      hasStreamUrl: Boolean(streamUrl),
      thumbnailUrl: thumbnailUrl ?? null,
      streamUrl: streamUrl ?? null,
    });
  }

  return {
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    ...(streamUrl ? { previewUrl: streamUrl, streamUrl } : {}),
  };
}

async function requestSharedDirectory(
  desktop: DesktopInfo,
  path?: string,
): Promise<SharedDirectoryDTO> {
  const encodedPath = encodeRemotePath(path);
  const pathSuffix = encodedPath ? `/${encodedPath}` : '';
  const url = `http://${desktop.host}:${desktop.port}/shared/list${pathSuffix}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to list shared directory: ${res.statusText}`);
  }
  return (await res.json()) as SharedDirectoryDTO;
}

function isImageMedia(mediaType: string, filename: string) {
  return (
    mediaType === 'image' ||
    mediaType.startsWith('image/') ||
    /\.(jpg|jpeg|png|gif|webp|heic|heif|bmp|tiff|tif)$/i.test(filename)
  );
}

function isVideoMedia(mediaType: string, filename: string) {
  return (
    mediaType === 'video' ||
    mediaType.startsWith('video/') ||
    /\.(mp4|mov|avi|mkv|webm|m4v)$/i.test(filename)
  );
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<T>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
    }
  }
}

function absoluteDesktopUrl(
  desktop: DesktopInfo,
  value?: string,
): string | undefined {
  if (!value || value.trim().length === 0) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  const normalized = value.startsWith('/') ? value : `/${value}`;
  return `http://${desktop.host}:${desktop.port}${normalized}`;
}

function buildReceivedMediaUrl(
  desktop: DesktopInfo,
  kind: 'download' | 'preview' | 'thumbnail' | 'stream',
  clientId: string,
  clientName: string,
  fileKey: string,
) {
  const query = `clientId=${encodeURIComponent(
    clientId,
  )}&clientName=${encodeURIComponent(clientName)}&fileKey=${encodeURIComponent(
    fileKey,
  )}`;
  return `http://${desktop.host}:${desktop.port}/resources/mobile/received/${kind}?${query}`;
}

async function receivedLibraryFileUrl(
  desktop: DesktopInfo,
  item: ReceivedLibraryItemDTO,
  kind: 'download' | 'preview' | 'stream',
): Promise<string> {
  const fileKey = item.fileKey?.trim();
  if (!fileKey) {
    throw new Error('Received file key is required');
  }
  const clientId = await getClientId();
  const clientName =
    (await NativeSyncEngine?.getClientDisplayName?.()) || clientId;
  return buildReceivedMediaUrl(desktop, kind, clientId, clientName, fileKey);
}

async function nativeReceivedLibraryFileUrl(
  item: ReceivedLibraryItemDTO,
  kind: 'download' | 'preview' | 'stream',
): Promise<string> {
  const fileKey = item.fileKey?.trim();
  if (!fileKey) {
    throw new Error('Received file key is required');
  }
  const url = await getNativeReceivedFilePreviewUrl(fileKey, kind);
  if (typeof url !== 'string' || url.trim().length === 0) {
    throw new Error('Received file preview URL is unavailable');
  }
  return url;
}

function normalizeLocalDownloadResult(result: {
  savedToPhotos?: boolean;
  localPath?: string | null;
  savedLocation?: string | null;
}): ResourceDownloadResult {
  return {
    savedToPhotos: isDownloadSavedToPhotos(result),
    localPath:
      typeof result.localPath === 'string' && result.localPath.trim().length > 0
        ? result.localPath
        : null,
    savedLocation:
      typeof result.savedLocation === 'string' &&
      result.savedLocation.trim().length > 0
        ? result.savedLocation
        : null,
  };
}

function withReceivedMediaUrlsForPairedClient(
  desktop: DesktopInfo,
  items: ReceivedLibraryMediaItem[],
  clientId: string,
  clientName: string,
  currentClientOnly: boolean,
): ReceivedLibraryMediaItem[] {
  const needsMediaUrl = (url: string | undefined): boolean =>
    typeof url !== 'string' || url.trim().length === 0;

  return items.map(item => {
    const fileKey = item.fileKey?.trim();
    if (!fileKey || (currentClientOnly && item.clientId !== clientId)) {
      return item;
    }
    const next: ReceivedLibraryMediaItem = {
      ...item,
    };
    if (isImageMedia(item.mediaType, item.filename)) {
      if (needsMediaUrl(next.previewUrl)) {
        next.previewUrl = buildReceivedMediaUrl(
          desktop,
          'preview',
          clientId,
          clientName,
          fileKey,
        );
      }
      if (needsMediaUrl(next.thumbnailUrl)) {
        next.thumbnailUrl = buildReceivedMediaUrl(
          desktop,
          'thumbnail',
          clientId,
          clientName,
          fileKey,
        );
      }
    }
    if (isVideoMedia(item.mediaType, item.filename)) {
      if (needsMediaUrl(next.previewUrl)) {
        next.previewUrl = buildReceivedMediaUrl(
          desktop,
          'preview',
          clientId,
          clientName,
          fileKey,
        );
      }
      if (needsMediaUrl(next.thumbnailUrl)) {
        next.thumbnailUrl = buildReceivedMediaUrl(
          desktop,
          'thumbnail',
          clientId,
          clientName,
          fileKey,
        );
      }
      if (needsMediaUrl(next.streamUrl)) {
        next.streamUrl = buildReceivedMediaUrl(
          desktop,
          'stream',
          clientId,
          clientName,
          fileKey,
        );
      }
    }
    return next;
  });
}

function withCurrentClientReceivedMediaUrls(
  desktop: DesktopInfo,
  items: ReceivedLibraryMediaItem[],
  clientId: string,
  clientName: string,
): ReceivedLibraryMediaItem[] {
  return withReceivedMediaUrlsForPairedClient(
    desktop,
    items,
    clientId,
    clientName,
    true,
  );
}

function withGlobalReceivedMediaUrls(
  desktop: DesktopInfo,
  items: ReceivedLibraryMediaItem[],
  clientId: string,
  clientName: string,
): ReceivedLibraryMediaItem[] {
  return withReceivedMediaUrlsForPairedClient(
    desktop,
    items,
    clientId,
    clientName,
    false,
  );
}

function receivedLibraryListUrl(
  desktop: DesktopInfo,
  clientId: string,
  clientName: string,
  scope?: 'client',
  options?: ReceivedLibraryPageOptions,
): string {
  const params = [
    `clientId=${encodeURIComponent(clientId)}`,
    `clientName=${encodeURIComponent(clientName)}`,
  ];
  if (scope) {
    params.push(`scope=${encodeURIComponent(scope)}`);
  }
  if (typeof options?.page === 'number') {
    params.push(`page=${Math.max(1, Math.floor(options.page))}`);
  }
  if (typeof options?.pageSize === 'number') {
    params.push(`pageSize=${Math.max(1, Math.floor(options.pageSize))}`);
  }
  return `http://${desktop.host}:${desktop.port}/resources/mobile/received?${params.join(
    '&',
  )}`;
}

function normalizeReceivedLibraryPage(
  data: Partial<ReceivedLibraryPageDTO> & {
    items?: ReceivedLibraryMediaItem[];
  },
  options?: ReceivedLibraryPageOptions,
): ReceivedLibraryMediaPage {
  const items = data.items || [];
  const totalBytes =
    typeof data.totalBytes === 'number'
      ? data.totalBytes
      : items.reduce((total, item) => total + item.fileSize, 0);
  return {
    items,
    page:
      typeof data.page === 'number'
        ? data.page
        : Math.max(1, Math.floor(options?.page ?? 1)),
    pageSize:
      typeof data.pageSize === 'number'
        ? data.pageSize
        : Math.max(1, Math.floor(options?.pageSize ?? items.length)),
    totalItems:
      typeof data.totalItems === 'number' ? data.totalItems : items.length,
    totalBytes,
    deviceStats: data.deviceStats || [],
  };
}

export async function listSharedResources(
  desktop: DesktopInfo,
): Promise<DesktopSharedResourceDTO[]> {
  const clientId = await getClientId();
  const clientName =
    (await NativeSyncEngine?.getClientDisplayName?.()) || clientId;
  const url = `http://${desktop.host}:${
    desktop.port
  }/resources/mobile/shared?clientId=${clientId}&clientName=${encodeURIComponent(
    clientName,
  )}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to list shared resources: ${res.statusText}`);
    }
    const data = await res.json();
    const items = (data.items || []) as DesktopSharedResourceDTO[];
    if (items.length > 0) {
      return items;
    }
  } catch {
    // Older or minimally configured desktops may expose only the legacy
    // shared directory route. Fall through to that browseable directory.
  }

  const sharedDirectory = await requestSharedDirectory(desktop);
  return sharedDirectory.files.map(directoryFileToSharedResource);
}

export async function listGlobalRemoteAccessResources(): Promise<
  GlobalRemoteAccessResource[]
> {
  const listing = await browseDirectory('personal');
  return listing.files.map(personalDirectoryFileToSharedResource);
}

export async function listSharedFolderContents(
  desktop: DesktopInfo,
  resourceId: string,
  path?: string,
): Promise<SharedDirectoryDTO> {
  if (isSharedDirectoryResourceId(resourceId)) {
    const rootPath = getSharedDirectoryPathFromResourceId(resourceId);
    return requestSharedDirectory(desktop, joinRemotePath(rootPath, path));
  }

  const clientId = await getClientId();
  const clientName =
    (await NativeSyncEngine?.getClientDisplayName?.()) || clientId;
  const encodedPath = encodeRemotePath(path);
  const pathSuffix = encodedPath ? `/${encodedPath}` : '';
  const url = `http://${desktop.host}:${
    desktop.port
  }/resources/mobile/shared/${encodeURIComponent(
    resourceId,
  )}/list${pathSuffix}?clientId=${clientId}&clientName=${encodeURIComponent(
    clientName,
  )}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to list shared folder contents: ${res.statusText}`);
  }
  return (await res.json()) as SharedDirectoryDTO;
}

export async function listGlobalRemoteAccessFolderContents(
  resourceId: string,
  path?: string,
): Promise<DirectoryListingDTO> {
  const rootPath = getPersonalDirectoryPathFromResourceId(resourceId);
  return browseDirectory('personal', joinRemotePath(rootPath, path));
}

async function listReceivedLibraryWithScope(
  desktop: DesktopInfo,
  scope?: 'client',
  timeoutMs?: number,
): Promise<ReceivedLibraryItemDTO[]> {
  const clientId = await getClientId();
  const clientName =
    (await NativeSyncEngine?.getClientDisplayName?.()) || clientId;
  const url = receivedLibraryListUrl(desktop, clientId, clientName, scope);
  const responsePromise = fetch(url);
  const res =
    typeof timeoutMs === 'number'
      ? await withTimeout(
          responsePromise,
          timeoutMs,
          'Timed out listing received library over direct HTTP',
        )
      : await responsePromise;
  if (!res.ok) {
    throw new Error(`Failed to list received library: ${res.statusText}`);
  }
  const data = await res.json();
  const items = (data.items || []) as ReceivedLibraryMediaItem[];
  if (scope !== 'client') {
    return items;
  }
  return withCurrentClientReceivedMediaUrls(
    desktop,
    items,
    clientId,
    clientName,
  );
}

async function listReceivedLibraryPageWithScope(
  desktop: DesktopInfo,
  scope: 'client' | undefined,
  options: ReceivedLibraryPageOptions,
  timeoutMs?: number,
): Promise<ReceivedLibraryMediaPage> {
  const clientId = await getClientId();
  const clientName =
    (await NativeSyncEngine?.getClientDisplayName?.()) || clientId;
  const diagnosticScope = scope ?? 'all';
  const url = receivedLibraryListUrl(
    desktop,
    clientId,
    clientName,
    scope,
    options,
  );
  recordDiagnosticsLog('PhoneSyncSpace', 'direct received page start', {
    host: desktop.host,
    port: desktop.port,
    scope: diagnosticScope,
    page: options.page ?? 1,
    pageSize: options.pageSize ?? 0,
  });
  const responsePromise = fetch(url);
  const res =
    typeof timeoutMs === 'number'
      ? await withTimeout(
          responsePromise,
          timeoutMs,
          'Timed out listing received library page over direct HTTP',
        )
      : await responsePromise;
  if (!res.ok) {
    recordDiagnosticsLog('PhoneSyncSpace', 'direct received page failed', {
      host: desktop.host,
      scope: diagnosticScope,
      status: res.status,
    });
    throw new Error(`Failed to list received library: ${res.statusText}`);
  }
  const data = (await res.json()) as Partial<ReceivedLibraryPageDTO> & {
    items?: ReceivedLibraryMediaItem[];
  };
  const page = normalizeReceivedLibraryPage(data, options);
  recordDiagnosticsLog('PhoneSyncSpace', 'direct received page success', {
    host: desktop.host,
    scope: diagnosticScope,
    page: page.page,
    pageSize: page.pageSize,
    itemCount: page.items.length,
    totalItems: page.totalItems,
    deviceStats: page.deviceStats.length,
  });
  return {
    ...page,
    items:
      scope === 'client'
        ? withCurrentClientReceivedMediaUrls(
            desktop,
            page.items,
            clientId,
            clientName,
          )
        : withGlobalReceivedMediaUrls(desktop, page.items, clientId, clientName),
  };
}

function isMissingListReceivedFilesBridgeError(error: unknown): boolean {
  if (!(error instanceof TypeError)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    (message.includes('listreceivedfiles') ||
      message.includes('listglobalreceivedfiles')) &&
    message.includes('is not a function')
  );
}

export async function listReceivedLibrary(
  desktop: DesktopInfo,
): Promise<ReceivedLibraryItemDTO[]> {
  return listReceivedLibraryWithScope(desktop);
}

function nativeReceivedLibraryPage(
  items: ReceivedLibraryMediaItem[],
  options: ReceivedLibraryPageOptions = {},
): ReceivedLibraryMediaPage {
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const pageSize = Math.max(1, Math.floor(options.pageSize ?? items.length));
  const start = (page - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);
  return normalizeReceivedLibraryPage(
    {
      items: pageItems,
      page,
      pageSize,
      totalItems: items.length,
      totalBytes: items.reduce((total, item) => total + item.fileSize, 0),
      deviceStats: [],
    },
    options,
  );
}

export async function listCurrentClientReceivedLibraryPage(
  desktop: DesktopInfo,
  options: ReceivedLibraryPageOptions = {},
): Promise<ReceivedLibraryMediaPage> {
  try {
    return await listReceivedLibraryPageWithScope(
      desktop,
      'client',
      options,
      DIRECT_RECEIVED_LIBRARY_HTTP_TIMEOUT_MS,
    );
  } catch (directHttpError) {
    recordDiagnosticsLog('PhoneSyncSpace', 'native current received fallback', {
      reason: receivedLibraryErrorMessage(directHttpError),
    });
    try {
      const page = nativeReceivedLibraryPage(await listReceivedFiles(), options);
      recordDiagnosticsLog('PhoneSyncSpace', 'native current received success', {
        itemCount: page.items.length,
        totalItems: page.totalItems,
      });
      return page;
    } catch (nativeError) {
      if (isMissingListReceivedFilesBridgeError(nativeError)) {
        throw directHttpError;
      }
      throw nativeError;
    }
  }
}

export async function listGlobalReceivedLibraryPage(
  desktop: DesktopInfo,
  options: ReceivedLibraryPageOptions = {},
): Promise<ReceivedLibraryMediaPage> {
  try {
    return await listReceivedLibraryPageWithScope(
      desktop,
      undefined,
      options,
      DIRECT_RECEIVED_LIBRARY_HTTP_TIMEOUT_MS,
    );
  } catch (directHttpError) {
    recordDiagnosticsLog('PhoneSyncSpace', 'native global received fallback', {
      reason: receivedLibraryErrorMessage(directHttpError),
    });
    try {
      const page = nativeReceivedLibraryPage(
        await listGlobalReceivedFiles(),
        options,
      );
      recordDiagnosticsLog('PhoneSyncSpace', 'native global received success', {
        itemCount: page.items.length,
        totalItems: page.totalItems,
      });
      return page;
    } catch (nativeError) {
      if (isMissingListReceivedFilesBridgeError(nativeError)) {
        throw directHttpError;
      }
      throw nativeError;
    }
  }
}

export async function listCurrentClientReceivedLibrary(
  desktop: DesktopInfo,
): Promise<ReceivedLibraryMediaItem[]> {
  if (Platform.OS !== 'android') {
    try {
      return await listReceivedFiles();
    } catch (error) {
      if (!isMissingListReceivedFilesBridgeError(error)) {
        throw error;
      }
      return listReceivedLibraryWithScope(desktop, 'client');
    }
  }

  try {
    return (await listReceivedLibraryWithScope(
      desktop,
      'client',
      DIRECT_RECEIVED_LIBRARY_HTTP_TIMEOUT_MS,
    )) as ReceivedLibraryMediaItem[];
  } catch (directHttpError) {
    try {
      return await listReceivedFiles();
    } catch (nativeError) {
      if (isMissingListReceivedFilesBridgeError(nativeError)) {
        throw directHttpError;
      }
      throw nativeError;
    }
  }
}

export async function downloadResource(
  desktop: DesktopInfo,
  resourceId: string,
): Promise<ResourceDownloadResult> {
  await requestResourceDownload(desktop, resourceId);

  // CN legacy screens only await completion and do not inspect this result.
  // Keep the HTTP request behavior, but do not manufacture a local file path.
  return {
    savedToPhotos: false,
    localPath: null,
  };
}

export async function shareResources(
  desktop: DesktopInfo,
  resources: ResourceShareItem[],
): Promise<void> {
  if (resources.length === 0) {
    return;
  }
  if (
    typeof NativeSyncEngine?.downloadUrlToShareCache !== 'function' ||
    typeof NativeSyncEngine?.shareFiles !== 'function'
  ) {
    throw new Error('System share is not available');
  }

  const localPaths: string[] = [];
  for (const resource of resources) {
    const url = await resourceDownloadUrl(desktop, resource.resourceId);
    const localPath = await NativeSyncEngine.downloadUrlToShareCache(
      url,
      resource.displayName,
    );
    if (typeof localPath !== 'string' || localPath.trim().length === 0) {
      throw new Error('Remote file was not prepared for sharing');
    }
    localPaths.push(localPath);
  }

  await NativeSyncEngine.shareFiles(localPaths);
}

export async function downloadResourceForGlobal(
  desktop: DesktopInfo,
  resourceId: string,
  filename?: string,
  mediaType?: string | null,
): Promise<ResourceDownloadResult> {
  if (typeof NativeSyncEngine?.downloadUrlToLocal !== 'function') {
    throw new Error('Native local download is not available');
  }
  const url = await resourceDownloadUrl(desktop, resourceId);
  const result = await NativeSyncEngine.downloadUrlToLocal(
    url,
    filename?.trim() || 'remote-file',
    mediaType ?? null,
  );
  return normalizeLocalDownloadResult(result);
}

export async function downloadReceivedLibraryItem(
  _desktop: DesktopInfo,
  item: ReceivedLibraryItemDTO,
): Promise<ResourceDownloadResult> {
  const fileKey = item.fileKey?.trim();
  if (!fileKey) {
    throw new Error('Received file key is required');
  }
  const filename =
    (item.filename || item.displayName || '').trim() || 'remote-file';
  const mediaType = item.mediaType ?? null;
  const result = await downloadReceivedFile(fileKey, filename, mediaType);
  return normalizeLocalDownloadResult(result);
}

export async function getReceivedLibraryPreviewUrl(
  desktop: DesktopInfo,
  item: ReceivedLibraryMediaItem,
): Promise<string> {
  void desktop;
  const filename = item.filename || item.displayName;
  if (isVideoMedia(item.mediaType, filename)) {
    return nativeReceivedLibraryFileUrl(item, 'stream');
  }
  if (isImageMedia(item.mediaType, filename)) {
    return nativeReceivedLibraryFileUrl(item, 'preview');
  }
  return nativeReceivedLibraryFileUrl(item, 'download');
}

export async function prepareReceivedLibraryPreview(
  desktop: DesktopInfo,
  item: ReceivedLibraryItemDTO,
): Promise<string> {
  void desktop;
  const fileKey = item.fileKey?.trim();
  if (!fileKey) {
    throw new Error('Received file key is required');
  }
  const filename =
    (item.filename || item.displayName || '').trim() || 'remote-file';
  const result = await downloadReceivedFile(
    fileKey,
    filename,
    item.mediaType ?? null,
  );
  const localPath =
    typeof result.localPath === 'string' && result.localPath.trim().length > 0
      ? result.localPath
      : typeof result.savedLocation === 'string' &&
          result.savedLocation.trim().length > 0
        ? result.savedLocation
        : null;
  if (typeof localPath !== 'string' || localPath.trim().length === 0) {
    throw new Error('Remote file was not prepared for preview');
  }
  return localPath;
}

export async function downloadGlobalRemoteAccessResource(
  resourceId: string,
): Promise<ResourceDownloadResult> {
  const result = await downloadDirectoryFile(
    'personal',
    getPersonalDirectoryPathFromResourceId(resourceId),
  );
  return normalizeLocalDownloadResult(result);
}

export async function getGlobalRemoteAccessPreviewUrl(
  resourceId: string,
): Promise<string> {
  return getDirectoryFileStreamUrl(
    'personal',
    getPersonalDirectoryPathFromResourceId(resourceId),
  );
}

export async function prepareGlobalRemoteAccessPreview(
  resourceId: string,
  filename?: string,
): Promise<string> {
  const localPath = await prepareDirectoryFilePreview(
    'personal',
    getPersonalDirectoryPathFromResourceId(resourceId),
    filename?.trim(),
  );
  if (typeof localPath !== 'string' || localPath.trim().length === 0) {
    throw new Error('Remote file was not prepared for preview');
  }
  return localPath;
}

export async function prepareGlobalRemoteAccessShareFile(
  resourceId: string,
  filename?: string,
): Promise<string> {
  if (typeof NativeSyncEngine?.downloadUrlToShareCache !== 'function') {
    throw new Error('System share is not available');
  }

  const remotePath = getPersonalDirectoryPathFromResourceId(resourceId);
  const url = await getDirectoryFileStreamUrl('personal', remotePath);
  const fallbackFilename =
    remotePath
      .split('/')
      .filter(segment => segment.trim().length > 0)
      .pop()
      ?.trim() || 'remote-file';
  const localPath = await NativeSyncEngine.downloadUrlToShareCache(
    url,
    filename?.trim() || fallbackFilename,
  );
  if (typeof localPath !== 'string' || localPath.trim().length === 0) {
    throw new Error('Remote file was not prepared for sharing');
  }
  return localPath;
}

export async function shareGlobalRemoteAccessResources(
  resources: ResourceShareItem[],
): Promise<void> {
  if (resources.length === 0) {
    return;
  }
  if (typeof NativeSyncEngine?.shareFiles !== 'function') {
    throw new Error('System share is not available');
  }

  const localPaths: string[] = [];
  for (const resource of resources) {
    const localPath = await prepareGlobalRemoteAccessShareFile(
      resource.resourceId,
      resource.displayName,
    );
    localPaths.push(localPath);
  }

  await NativeSyncEngine.shareFiles(localPaths);
}

export async function listHistory(
  desktop: DesktopInfo,
): Promise<DesktopSyncRecordDTO[]> {
  const clientId = await getClientId();
  const url = `http://${desktop.host}:${desktop.port}/management/records/sync?clientId=${clientId}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to list history: ${res.statusText}`);
  }
  const data = await res.json();
  return (data.items || []) as DesktopSyncRecordDTO[];
}
