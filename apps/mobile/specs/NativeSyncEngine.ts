import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';
import type {
  BindingStateDTO,
  DiscoveredDeviceDTO,
  HistoryLedgerCardDTO,
  ReadOnlyQueueItemDTO,
  DirectoryListingDTO,
  DirectoryScope,
  ReceivedLibraryItemDTO,
  SharedFilesReachabilityDTO,
  SyncSummaryDTO,
} from '@lynavo-drive/contracts';

export interface Spec extends TurboModule {
  // 权限
  requestPhotoPermission(): Promise<'granted' | 'limited' | 'denied'>;
  // 发现 (同时触发本地网络权限)
  startDiscovery(): Promise<void>;
  stopDiscovery(): Promise<void>;
  // 绑定
  pairDevice(params: {
    deviceId: string;
    host: string;
    port: number;
    connectionCode: string;
  }): Promise<void>;
  disconnectAndUnbind(): Promise<void>;
  // 状态查询
  getBindingState(): Promise<BindingStateDTO | null>;
  getSyncOverview(): Promise<SyncSummaryDTO>;
  getReadOnlyQueue(): Promise<ReadOnlyQueueItemDTO[]>;
  getHistoryDays(
    cursor?: string,
  ): Promise<{ items: HistoryLedgerCardDTO[]; nextCursor: string | null }>;
  getAppInfo(): Promise<{ appName: string; version: string; build: string }>;
  exportDiagnostics(): Promise<string>;
  browseSharedFiles(
    scope: DirectoryScope,
    path: string,
    accessToken: string,
  ): Promise<DirectoryListingDTO>;
  downloadSharedFile(
    scope: DirectoryScope,
    path: string,
    accessToken: string,
  ): Promise<{
    savedToPhotos: boolean;
    localPath: string | null;
    savedLocation?: string | null;
  }>;
  downloadReceivedFile(
    fileKey: string,
    filename: string,
    mediaType?: string | null,
  ): Promise<{
    savedToPhotos: boolean;
    localPath: string | null;
    savedLocation?: string | null;
  }>;
  listReceivedFiles(): Promise<ReceivedLibraryItemDTO[]>;
  getReceivedFilePreviewUrl(
    fileKey: string,
    kind: 'download' | 'preview' | 'thumbnail' | 'stream',
  ): Promise<string>;
  getSharedFileStreamUrl(
    scope: DirectoryScope,
    path: string,
    accessToken: string,
  ): Promise<string>;
  prepareSharedFilePreview(
    scope: DirectoryScope,
    path: string,
    accessToken: string,
    filename: string,
  ): Promise<string>;
  downloadUrlToShareCache(url: string, filename: string): Promise<string>;
  downloadUrlToLocal(
    url: string,
    filename: string,
    mediaType?: string | null,
  ): Promise<{
    savedToPhotos: boolean;
    localPath: string | null;
    savedLocation?: string | null;
  }>;
  shareFile(localPath: string): Promise<boolean>;
  shareFiles(localPaths: string[]): Promise<boolean>;
  recordDiagnosticsLog(category: string, message: string): void;
  getClientDisplayName(): Promise<string>;
  setClientDisplayName(name: string): Promise<void>;
  triggerSync(): Promise<void>;
  pauseAutoUpload(): Promise<void>;
  disableAutoUpload(): Promise<void>;
  resumeAutoUpload(): Promise<void>;
  // 设置
  renameBoundDeviceAlias(alias: string): Promise<void>;
  // 事件 (Codegen EventEmitter)
  readonly onDiscoveredDevicesChanged: (devices: DiscoveredDeviceDTO[]) => void;
  readonly onSyncStateChanged: (summary: SyncSummaryDTO) => void;
  readonly onQueueUpdated: (queue: ReadOnlyQueueItemDTO[]) => void;
  readonly onHistoryUpdated: (card: HistoryLedgerCardDTO) => void;
  readonly onBindingStateChanged: (state: BindingStateDTO | null) => void;
  readonly onSharedFilesReachabilityChanged: (
    state: SharedFilesReachabilityDTO | null,
  ) => void;
  readonly onError: (error: { code: string; message: string }) => void;
}

export default TurboModuleRegistry.getEnforcing<Spec>('NativeSyncEngine');
