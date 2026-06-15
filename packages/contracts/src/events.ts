import type { DeviceDashboardStatus } from './enums';
import type {
  DashboardSummaryDTO,
  ShareStatusDTO,
  SyncSummaryDTO,
} from './types';

export const SIDECAR_EVENT_TYPES = {
  DEVICE_STATE_CHANGED: 'device.state.changed',
  DASHBOARD_UPDATED: 'dashboard.updated',
  DEVICE_MANAGEMENT_UPDATED: 'device.management.updated',
  SHARED_RESOURCES_UPDATED: 'shared.resources.updated',
  ACCESS_RECORDS_UPDATED: 'access.records.updated',
} as const;

export type SidecarEvent =
  | { type: 'dashboard.updated'; payload: DashboardSummaryDTO }
  | { type: 'device.state.changed'; payload: { deviceId: string; status: DeviceDashboardStatus } }
  | { type: 'upload.progress'; payload: { deviceId: string; fileKey: string; progress: number } }
  | { type: 'upload.completed'; payload: { deviceId: string; fileKey: string } }
  | { type: 'upload.failed'; payload: { deviceId: string; fileKey: string; errorCode: string } }
  | { type: 'disk.low'; payload: { remainingBytes: number } }
  | { type: 'share.status.changed'; payload: ShareStatusDTO }
  | { type: 'sync.summary.updated'; payload: SyncSummaryDTO }
  | { type: 'history.updated'; payload: { dateKey: string; deviceId: string } }
  | { type: 'shared.directory.changed'; payload: { path: string } }
  | { type: 'transfer.active.changed'; payload: { isActive: boolean } };
