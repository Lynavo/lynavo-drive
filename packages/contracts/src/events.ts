import type { DeviceDashboardStatus } from './enums';
import type { DashboardSummaryDTO, ShareStatusDTO, SyncSummaryDTO } from './types';

export const SIDECAR_EVENT_TYPES = {
  DEVICE_STATE_CHANGED: 'device.state.changed',
  DASHBOARD_UPDATED: 'dashboard.updated',
  DEVICE_MANAGEMENT_UPDATED: 'device.management.updated',
  SHARED_RESOURCES_UPDATED: 'shared.resources.updated',
  ACCESS_RECORDS_UPDATED: 'access.records.updated',
  VIDEO_THUMBNAIL_REQUEST: 'video.thumbnail.request',
} as const;

export type SidecarEvent =
  | { type: typeof SIDECAR_EVENT_TYPES.DASHBOARD_UPDATED; payload: DashboardSummaryDTO }
  | {
      type: typeof SIDECAR_EVENT_TYPES.DEVICE_STATE_CHANGED;
      payload: { deviceId: string; status: DeviceDashboardStatus };
    }
  | {
      type: typeof SIDECAR_EVENT_TYPES.DEVICE_MANAGEMENT_UPDATED;
      payload: { desktopDeviceId?: string; clientId?: string };
    }
  | {
      type: typeof SIDECAR_EVENT_TYPES.SHARED_RESOURCES_UPDATED;
      payload: { desktopDeviceId?: string; resourceId?: string };
    }
  | {
      type: typeof SIDECAR_EVENT_TYPES.ACCESS_RECORDS_UPDATED;
      payload: { desktopDeviceId?: string; clientId?: string; recordId?: string };
    }
  | {
      type: typeof SIDECAR_EVENT_TYPES.VIDEO_THUMBNAIL_REQUEST;
      payload: {
        requestId: string;
        sourcePath: string;
        cachePath: string;
        sourceVersion: string;
        maxEdge: number;
        quality: number;
      };
    }
  | { type: 'upload.progress'; payload: { deviceId: string; fileKey: string; progress: number } }
  | { type: 'upload.completed'; payload: { deviceId: string; fileKey: string } }
  | { type: 'upload.failed'; payload: { deviceId: string; fileKey: string; errorCode: string } }
  | { type: 'disk.low'; payload: { remainingBytes: number } }
  | { type: 'share.status.changed'; payload: ShareStatusDTO }
  | { type: 'sync.summary.updated'; payload: SyncSummaryDTO }
  | { type: 'history.updated'; payload: { dateKey: string; deviceId: string } }
  | { type: 'shared.directory.changed'; payload: { path: string } }
  | { type: 'transfer.active.changed'; payload: { isActive: boolean } };
