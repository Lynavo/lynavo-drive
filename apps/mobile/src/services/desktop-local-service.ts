import { NativeModules } from 'react-native';
import type {
  DesktopSharedResourceDTO,
  ReceivedLibraryItemDTO,
  DesktopSyncRecordDTO,
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

export async function listSharedResources(
  desktop: DesktopInfo
): Promise<DesktopSharedResourceDTO[]> {
  const clientId = await getClientId();
  const clientName = (await NativeSyncEngine?.getClientDisplayName?.()) || clientId;
  const url = `http://${desktop.host}:${desktop.port}/resources/mobile/shared?clientId=${clientId}&clientName=${encodeURIComponent(
    clientName
  )}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to list shared resources: ${res.statusText}`);
  }
  const data = await res.json();
  return (data.items || []) as DesktopSharedResourceDTO[];
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
  const clientId = await getClientId();
  const clientName = (await NativeSyncEngine?.getClientDisplayName?.()) || clientId;
  const url = `http://${desktop.host}:${desktop.port}/resources/mobile/download/${resourceId}?clientId=${clientId}&clientName=${encodeURIComponent(
    clientName
  )}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download resource: ${res.statusText}`);
  }
  return {
    savedToPhotos: true,
    localPath: `/mock/path/${resourceId}`,
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
