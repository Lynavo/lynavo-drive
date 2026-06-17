import { NativeModules } from 'react-native';
import type {
  DesktopSharedResourceDTO,
  DirectoryFileDTO,
  ReceivedLibraryItemDTO,
  DesktopSyncRecordDTO,
  SharedDirectoryDTO,
} from '@syncflow/contracts';
import { getClientId } from './SyncEngineModule';

const { NativeSyncEngine } = NativeModules;

export interface DesktopInfo {
  host: string;
  port: number;
}

export interface ResourceDownloadResult {
  savedToPhotos: boolean;
  localPath: string | null;
}

const SHARED_DIRECTORY_RESOURCE_PREFIX = 'shared-dir:';
const SHARED_DIRECTORY_DESKTOP_ID = 'shared-dir';

export function isDownloadSavedLocally(result: ResourceDownloadResult): boolean {
  return (
    result.savedToPhotos ||
    (typeof result.localPath === 'string' && result.localPath.trim().length > 0)
  );
}

async function requestResourceDownload(
  desktop: DesktopInfo,
  resourceId: string,
): Promise<void> {
  if (isSharedDirectoryResourceId(resourceId)) {
    const sharedPath = getSharedDirectoryPathFromResourceId(resourceId);
    const encodedPath = encodeRemotePath(sharedPath);
    const url = `http://${desktop.host}:${desktop.port}/shared/download/${encodedPath}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to download shared file: ${res.statusText}`);
    }
    return;
  }

  const clientId = await getClientId();
  const clientName = (await NativeSyncEngine?.getClientDisplayName?.()) || clientId;
  const url = `http://${desktop.host}:${desktop.port}/resources/mobile/download/${resourceId}?clientId=${clientId}&clientName=${encodeURIComponent(
    clientName
  )}`;
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

function getSharedDirectoryPathFromResourceId(resourceId: string): string {
  const encodedPath = resourceId.slice(SHARED_DIRECTORY_RESOURCE_PREFIX.length);
  return normalizeRemotePath(decodeRemotePath(encodedPath));
}

function sharedDirectoryResourceId(path: string): string {
  return `${SHARED_DIRECTORY_RESOURCE_PREFIX}${encodeRemotePath(path)}`;
}

function directoryFileToSharedResource(
  file: DirectoryFileDTO,
): DesktopSharedResourceDTO {
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

export async function listSharedResources(
  desktop: DesktopInfo
): Promise<DesktopSharedResourceDTO[]> {
  const clientId = await getClientId();
  const clientName = (await NativeSyncEngine?.getClientDisplayName?.()) || clientId;
  const url = `http://${desktop.host}:${desktop.port}/resources/mobile/shared?clientId=${clientId}&clientName=${encodeURIComponent(
    clientName
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
  const clientName = (await NativeSyncEngine?.getClientDisplayName?.()) || clientId;
  const encodedPath = encodeRemotePath(path);
  const pathSuffix = encodedPath ? `/${encodedPath}` : '';
  const url = `http://${desktop.host}:${desktop.port}/resources/mobile/shared/${encodeURIComponent(
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

export async function listReceivedLibrary(
  desktop: DesktopInfo
): Promise<ReceivedLibraryItemDTO[]> {
  const clientId = await getClientId();
  const clientName = (await NativeSyncEngine?.getClientDisplayName?.()) || clientId;
  const url = `http://${desktop.host}:${desktop.port}/resources/mobile/received?clientId=${clientId}&clientName=${encodeURIComponent(
    clientName
  )}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to list received library: ${res.statusText}`);
  }
  const data = await res.json();
  return (data.items || []) as ReceivedLibraryItemDTO[];
}

export async function downloadResource(
  desktop: DesktopInfo,
  resourceId: string
): Promise<ResourceDownloadResult> {
  await requestResourceDownload(desktop, resourceId);

  // CN legacy screens only await completion and do not inspect this result.
  // Keep the HTTP request behavior, but do not manufacture a local file path.
  return {
    savedToPhotos: false,
    localPath: null,
  };
}

export async function downloadResourceForGlobal(
  _desktop: DesktopInfo,
  _resourceId: string,
): Promise<ResourceDownloadResult> {
  // Global must not report a successful local save until native persistence
  // returns a real localPath or confirms the asset was saved to Photos. Do not
  // hit the sidecar download endpoint yet, otherwise desktop-side counters may
  // treat an unsupported client action as a real download.
  return {
    savedToPhotos: false,
    localPath: null,
  };
}

export async function listHistory(
  desktop: DesktopInfo
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
