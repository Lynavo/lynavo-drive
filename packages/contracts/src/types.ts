import type {
  AutoUploadState,
  AutoUploadTimeRangeMode,
  ConnectionState,
  DeviceDashboardStatus,
  DeviceType,
  SharedFilesReachabilityState,
  SharedFilesRouteKind,
  ShareStatus,
  UploadState,
  UploadTaskSource,
} from './enums';

// ── Product / Release ──

export type ReleaseChannel = 'dev' | 'review' | 'prod';

export type Distribution = 'community' | 'official';

// ── Device Discovery ──

export interface DiscoveredDeviceDTO {
  deviceId: string;
  name: string;
  type: DeviceType;
  ip: string;
  port: number;
  protoVersion: number;
  authMode: 'code';
  shareEnabled: boolean;
  shareName?: string;
  lastSeenAt: string;
}

// ── Desktop Dashboard ──

export interface DashboardSummaryDTO {
  todayUploadCount: number;
  todayOccupiedBytes: number;
  remainingBytes: number;
  isDiskLow: boolean;
  lastSuccessfulSyncAt?: string;
  lastSuccessfulDeviceName?: string;
}

export interface DashboardDeviceDTO {
  deviceId: string;
  /** Stable physical-device identity, when reported by mobile */
  stableDeviceId?: string;
  /** Resolved display label: deviceAlias ?? clientName ?? clientId */
  displayName: string;
  /** Raw device name reported at pairing time; kept for diagnostics */
  clientName: string;
  /** Device platform identifier, e.g. "ios", "android" */
  platform: string;
  ip: string;
  status: DeviceDashboardStatus;
  todayFileCount: number;
  todayBytes: number;
  /** Most recent local ledger date that still has visible files, YYYY-MM-DD */
  latestDate?: string;
  /** File count for latestDate, used when today's count is zero */
  latestFileCount?: number;
  /** Byte count for latestDate, used when today's count is zero */
  latestBytes?: number;
  /** Pre-formatted display value such as "1.2 TB" */
  storageLeft: string;
  /** Receive root used to resolve per-file relative paths */
  storagePath: string;
  /** Device-specific directory under receive root */
  devicePath: string;
  /** User-defined alias, if set (observability / diagnostics) */
  deviceAlias?: string;
  /** Stable directory name on disk (observability / diagnostics) */
  receiveDirName?: string;
  currentFile?: {
    filename: string;
    progress: number;
    fileSize: number;
  };
}

// ── Desktop Device Detail ──

export interface DeviceFileLedgerDTO {
  fileKey: string;
  originalFilename: string;
  mediaType: string;
  fileSize: number;
  createdAtRemote?: string;
  completedAt?: string;
  activeTransmissionMs: number;
  finalPath?: string;
}

export type DeviceFileSortField = 'name' | 'size' | 'completedAt' | 'createdAt' | 'duration';

export type SortDirection = 'asc' | 'desc';

export interface DeviceFileLedgerPageDTO {
  items: DeviceFileLedgerDTO[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalBytes: number;
  totalActiveTransmissionMs: number;
}

// ── Desktop Local Management ──

export type DesktopDeviceAuthorizationStatus = 'authorized' | 'revoked';
export type DesktopDeviceBlockStatus = 'active' | 'none';
export type DesktopResourceKind = 'shared_file' | 'shared_folder' | 'received_file';
export type DesktopResourceStatus = 'available' | 'missing' | 'removed';
export type DesktopAccessAction = 'list' | 'view' | 'download' | 'error';
export type DesktopRecordResult = 'ok' | 'denied' | 'missing' | 'error';

export interface DesktopManagedDeviceDTO {
  desktopDeviceId: string;
  clientId: string;
  clientIdShort: string;
  displayName: string;
  platform: string;
  stableDeviceId?: string;
  lastIp?: string;
  authorizedAt?: string;
  lastSeenAt?: string;
  authorizationStatus: DesktopDeviceAuthorizationStatus;
  blockStatus: DesktopDeviceBlockStatus;
  failedAttemptCount: number;
  blockedAt?: string;
  blockReason?: string;
  todayFileCount: number;
  todayBytes: number;
  totalFileCount: number;
  totalBytes: number;
}

export interface DesktopConnectionAttemptDTO {
  desktopDeviceId: string;
  clientId: string;
  displayName?: string;
  result: 'success' | 'wrong_code' | 'blocked';
  failureReason?: string;
  attemptedAt: string;
  remainingAttempts?: number;
}

export interface DesktopBlockStateDTO {
  desktopDeviceId: string;
  clientId: string;
  blocked: boolean;
  failedAttemptCount: number;
  remainingAttempts: number;
  blockedAt?: string;
  reason?: string;
}

export interface DesktopSyncRecordDTO {
  recordId: string;
  desktopDeviceId: string;
  clientId: string;
  displayName: string;
  fileKey: string;
  filename: string;
  mediaType: string;
  fileSize: number;
  status: 'completed' | 'failed';
  completedAt?: string;
  failedAt?: string;
  errorSummary?: string;
}

export interface DesktopAccessRecordDTO {
  recordId: string;
  desktopDeviceId: string;
  clientId: string;
  displayName: string;
  resourceId: string;
  resourceKind: DesktopResourceKind;
  resourceName: string;
  localPath?: string;
  action: DesktopAccessAction;
  result: DesktopRecordResult;
  accessedAt: string;
}

export interface DesktopSharedResourceDTO {
  resourceId: string;
  desktopDeviceId: string;
  kind: DesktopResourceKind;
  displayName: string;
  status: DesktopResourceStatus;
  fileSize?: number;
  mediaType?: string;
  addedAt: string;
  removedAt?: string;
  lastAccessedAt?: string;
  downloadCount: number;
}

export interface ReceivedLibraryItemDTO {
  resourceId: string;
  desktopDeviceId: string;
  clientId: string;
  displayName: string;
  fileKey: string;
  filename: string;
  mediaType: string;
  fileSize: number;
  completedAt: string;
  shareStatus: 'not_shared' | 'shared' | 'missing';
  fileStatus?: 'available' | 'deleted';
  thumbnailUrl?: string;
  previewUrl?: string;
  streamUrl?: string;
}

export interface ReceivedLibraryDeviceStatDTO {
  clientId: string;
  photoCount: number;
  fileCount: number;
  totalBytes: number;
}

export interface DesktopLocalListResponse<T> {
  items: T[];
}

export interface DesktopLocalPageResponse<T> extends DesktopLocalListResponse<T> {
  page: number;
  pageSize: number;
  totalItems: number;
}

export interface ReceivedLibraryPageDTO extends DesktopLocalPageResponse<ReceivedLibraryItemDTO> {
  totalBytes: number;
  deviceStats: ReceivedLibraryDeviceStatDTO[];
}

export interface AddSharedResourcePayload {
  kind: DesktopResourceKind;
  displayName: string;
  localPath?: string;
  receivedFileKey?: string;
  fileSize?: number;
  mediaType?: string;
  status?: DesktopResourceStatus;
}

export interface RecentDesktopDTO {
  desktopDeviceId: string;
  desktopName: string;
  host: string;
  port: number;
  lastConnectedAt: string;
  authorizationStatus?: 'unknown' | 'authorized' | 'requires_code' | 'blocked';
}

export interface PairingFailureDTO {
  code: 'wrong_code' | 'blocked' | 'version_incompatible' | 'unknown';
  message: string;
  remainingAttempts?: number;
  blocked?: boolean;
}

// ── Desktop Settings ──

export interface SettingsDTO {
  deviceName: string;
  connectionCode: string;
  rootPath: string;
  receivePath: string;
  personalPath: string;
  personalPathMode?: 'path' | 'windowsDrives';
  sharedPath: string;
  shareAddress: string;
  shareStatus: ShareStatus;
  shareName: string;
  allowCrossDeviceReceivedAccess?: boolean;
}

export interface ShareStatusDTO {
  enabled: boolean;
  smbUrl: string | null;
  status: ShareStatus;
  shareName?: string;
  lastValidatedAt?: string;
  lastError?: string;
}

export type ConnectionDeviceStatus = 'authorized' | 'connected' | 'offline';

export type PairingAttemptResult =
  | 'success'
  | 'wrong_code'
  | 'blocked'
  | 'incompatible'
  | 'malformed'
  | 'revoked_repair_required';

export interface PairingErrorMetadataDTO {
  failedAttempts?: number;
  remainingAttempts?: number;
  maxAttempts?: number;
}

export interface ConnectionDeviceDTO {
  clientId: string;
  stableDeviceId?: string;
  displayName: string;
  clientName: string;
  deviceAlias?: string;
  platform: string;
  ip?: string;
  status: ConnectionDeviceStatus;
  authorizedAt: string;
  lastSeenAt: string;
  revokedAt?: string;
}

export interface BlockedPairingClientDTO {
  clientId: string;
  stableDeviceId?: string;
  displayName: string;
  clientName?: string;
  deviceAlias?: string;
  platform?: string;
  lastIp?: string;
  failedAttempts: number;
  blockedAt: string;
  lastAttemptAt: string;
  reason: 'wrong_connection_code_limit';
}

export interface PairingAttemptDTO {
  id: number;
  clientId: string;
  stableDeviceId?: string;
  displayName: string;
  clientName?: string;
  deviceAlias?: string;
  platform?: string;
  ip?: string;
  result: PairingAttemptResult;
  failureReason?: string;
  createdAt: string;
}

export interface ConnectionDevicesSettingsDTO {
  authorizedDevices: ConnectionDeviceDTO[];
  blockedClients: BlockedPairingClientDTO[];
  recentAttempts: PairingAttemptDTO[];
}

// ── Mobile Sync ──

export interface SyncSummaryDTO {
  currentDeviceId: string | null;
  currentDeviceName: string | null;
  currentSpeedMbps: number;
  /** Bytes confirmed by sidecar ACK */
  transferredBytes: number;
  /** Equals SYNC_BEGIN_REQ.queueTotalBytes */
  totalBytes: number;
  progressPercent: number;
  uploadState: UploadState;
  performanceHint?: 'none' | 'thermal_limited';
  performanceMessage?: string | null;
  thermalState?: 'nominal' | 'fair' | 'serious' | 'critical' | 'unknown';
  activeTuningProfile?: string | null;
  isThermalLimited?: boolean;
  /** Source of the currently uploading task */
  currentTaskSource?: UploadTaskSource | null;
  /** Source of the most recently completed upload task */
  lastCompletedTaskSource?: UploadTaskSource | null;
  /** Current state of the auto-upload feature */
  autoUploadState?: AutoUploadState;
  /** Number of pending auto-upload items */
  autoPending?: number;
}

export interface ReadOnlyQueueItemDTO {
  fileKey: string;
  filename: string;
  fileSize: number;
  mediaType: string;
  /** Simplified status for RN display; failed/skipped items are excluded from the read-only queue */
  status: 'uploading' | 'waiting' | 'completed' | 'cancelled';
  progress?: number;
  /** Upload source */
  source?: UploadTaskSource;
  batchId?: string;
}

// ── Mobile Binding State ──

export interface WakeTargetDTO {
  interfaceName: string;
  macAddress: string;
  ipv4Address: string;
  broadcastAddress: string;
  ports: number[];
}

export interface WakeCapabilityDTO {
  supported: boolean;
  targets: WakeTargetDTO[];
  updatedAt: string;
}

export interface BindingStateDTO {
  deviceId: string;
  deviceName: string;
  /** User-defined alias, defaults to deviceName */
  deviceAlias: string;
  host: string;
  port: number;
  connectionState: ConnectionState;
  pairingId: string;
  shareEnabled: boolean;
  shareName?: string;
  lastBoundAt: string;
  sharedFilesReachability?: SharedFilesReachabilityDTO | null;
  wake?: WakeCapabilityDTO | null;
}

export interface SharedFilesReachabilityDTO {
  deviceId: string;
  state: SharedFilesReachabilityState;
  route: SharedFilesRouteKind | null;
  reason: string;
  updatedAt: string;
}

// ── History (shared by both sides) ──

/**
 * Desktop: deviceId = iPhone's clientId
 * Mobile: deviceId = Mac's serverId
 * Same fields, different direction.
 */
export interface HistoryLedgerCardDTO {
  dateKey: string; // YYYY-MM-DD
  deviceId: string;
  deviceName: string;
  deviceIp: string;
  totalFileCount: number;
  totalBytes: number;
  activeTransmissionSeconds: number;
}

// ── Lynavo Drive: Album & Shared Files ──

/** Album asset item for the album workbench browser */
export interface AlbumAssetDTO {
  assetLocalId: string;
  filename: string;
  mediaType: 'image' | 'video';
  fileSize: number;
  creationDate: string;
  thumbnailUri: string;
  isTransferred: boolean;
  isQueued: boolean;
}

/**
 * Preview source for a single album asset, fetched on demand from the album
 * workbench. Shape mirrors the iOS native bridge return value.
 *
 * Invariant: when `error` is set, `uri` will be `''`. Consumers should branch
 * on `error` presence first before using `uri`.
 */
export interface AssetPreviewSourceDTO {
  uri: string;
  mediaType: 'image' | 'video';
  error?: 'cloud_unavailable' | 'not_found';
}

/** Auto-upload configuration (single-row persisted on mobile) */
export interface AutoUploadConfigDTO {
  enabled: boolean;
  timeRangeMode: AutoUploadTimeRangeMode;
  /** ISO 8601 timestamp, only used when timeRangeMode is 'custom' */
  customTimeFrom?: string;
  state: AutoUploadState;
}

export type DirectoryScope = 'team' | 'personal';

/** A single file entry in a browseable desktop directory listing */
export interface DirectoryFileDTO {
  name: string;
  path: string;
  type: 'image' | 'video' | 'document' | 'other';
  size: number;
  modifiedAt: string;
  thumbnailUrl?: string;
  streamUrl?: string;
  isDirectory?: boolean;
}

/** Browseable desktop directory listing response */
export interface DirectoryListingDTO {
  scope: DirectoryScope;
  path: string;
  files: DirectoryFileDTO[];
  totalCount: number;
}

/** A single file entry in the shared directory listing */
export type SharedFileDTO = DirectoryFileDTO;

/** Shared directory listing response */
export type SharedDirectoryDTO = Omit<DirectoryListingDTO, 'scope'>;
