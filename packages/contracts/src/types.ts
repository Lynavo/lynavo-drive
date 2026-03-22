import type {
  ConnectionState,
  DeviceDashboardStatus,
  DeviceType,
  ShareStatus,
  UploadState,
} from './enums';

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
}

export interface DashboardDeviceDTO {
  deviceId: string;
  clientName: string;
  ip: string;
  status: DeviceDashboardStatus;
  todayFileCount: number;
  todayBytes: number;
  /** Pre-formatted display value such as "1.2 TB" */
  storageLeft: string;
  storagePath: string;
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

// ── Desktop Settings ──

export interface SettingsDTO {
  deviceName: string;
  connectionCode: string;
  receivePath: string;
  shareAddress: string;
  shareStatus: ShareStatus;
  shareName: string;
}

export interface ShareStatusDTO {
  enabled: boolean;
  smbUrl: string | null;
  status: ShareStatus;
  lastValidatedAt?: string;
  lastError?: string;
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
}

export interface ReadOnlyQueueItemDTO {
  fileKey: string;
  filename: string;
  fileSize: number;
  mediaType: string;
  /** Simplified status for RN display; failed/skipped items are excluded from the read-only queue */
  status: 'uploading' | 'waiting' | 'completed';
  progress?: number;
}

// ── Mobile Binding State ──

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
