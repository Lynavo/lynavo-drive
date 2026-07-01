import http from 'node:http';
import { APP_COMPATIBILITY_VERSION, SIDECAR_HTTP_PORT } from '@lynavo-drive/contracts';
import type {
  AddSharedResourcePayload,
  ConnectionDevicesSettingsDTO,
  DesktopAccessRecordDTO,
  DesktopLocalListResponse,
  DesktopManagedDeviceDTO,
  DesktopSharedResourceDTO,
  DesktopSyncRecordDTO,
  DeviceFileLedgerPageDTO,
  DeviceFileSortField,
  ReceivedLibraryItemDTO,
  ReceivedLibraryPageDTO,
  SortDirection,
} from '@lynavo-drive/contracts';

const BASE = `http://127.0.0.1:${SIDECAR_HTTP_PORT}`;
export const SIDECAR_HEALTH_SERVICE_NAMES = ['lynavo-drive-sidecar'] as const;

export function isCompatibleSidecarService(service: string | null | undefined): boolean {
  return SIDECAR_HEALTH_SERVICE_NAMES.some((candidate) => candidate === service);
}

export type PowerEventSnapshot = {
  event: 'suspend' | 'resume' | 'lock-screen' | 'unlock-screen';
  state: 'awake' | 'sleeping' | 'locked' | 'unlocked';
  lastSuspendAt: string | null;
  lastResumeAt: string | null;
  lastLockAt: string | null;
  lastUnlockAt: string | null;
  updatedAt: string;
};

const DEFAULT_SIDECAR_REQUEST_TIMEOUT_MS = 30_000;

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const SIDECAR_REQUEST_TIMEOUT_MS = parsePositiveInteger(
  process.env.LYNAVO_SIDECAR_REQUEST_TIMEOUT_MS,
  DEFAULT_SIDECAR_REQUEST_TIMEOUT_MS,
);

function encodeSharedFilePath(path: string): string {
  return path
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter((segment) => segment.trim().length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export interface SidecarHealth {
  ok: boolean;
  service: string;
  appCompatibilityVersion?: number;
  capabilities?: {
    connectionDeviceManagement?: boolean;
    revokesPairingsOnCodeRotation?: boolean;
    wakeOnLanSupported?: boolean;
  };
}

export function supportsConnectionDeviceManagement(
  health: SidecarHealth | null | undefined,
): boolean {
  return (
    health?.ok === true &&
    isCompatibleSidecarService(health.service) &&
    health.appCompatibilityVersion === APP_COMPATIBILITY_VERSION &&
    health.capabilities?.connectionDeviceManagement === true
  );
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options: http.RequestOptions = {
      method,
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port ? Number(url.port) : undefined,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    };

    let settled = false;
    const rejectOnce = (error: Error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };
    const resolveOnce = (value: T) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolveOnce(JSON.parse(data) as T);
        } else {
          rejectOnce(
            new Error(
              `${method} ${url.origin}${url.pathname}${url.search}: ${res.statusCode} ${data}`,
            ),
          );
        }
      });
    });

    req.on('error', (error) => rejectOnce(error));
    const timeoutMs = SIDECAR_REQUEST_TIMEOUT_MS;
    if (typeof req.setTimeout === 'function') {
      req.setTimeout(timeoutMs, () => {
        const error = new Error(
          `${method} ${url.origin}${url.pathname}${url.search}: request timed out after ${timeoutMs}ms`,
        );
        if (typeof req.destroy === 'function') {
          req.destroy(error);
        } else {
          rejectOnce(error);
        }
      });
    }
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function absoluteSidecarUrl(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return new URL(trimmed, BASE).toString();
}

function normalizeReceivedLibraryItem(item: ReceivedLibraryItemDTO): ReceivedLibraryItemDTO {
  const { thumbnailUrl, previewUrl, streamUrl, ...rest } = item;
  const absoluteThumbnailUrl = absoluteSidecarUrl(thumbnailUrl);
  const absolutePreviewUrl = absoluteSidecarUrl(previewUrl);
  const absoluteStreamUrl = absoluteSidecarUrl(streamUrl);
  return {
    ...rest,
    ...(absoluteThumbnailUrl ? { thumbnailUrl: absoluteThumbnailUrl } : {}),
    ...(absolutePreviewUrl ? { previewUrl: absolutePreviewUrl } : {}),
    ...(absoluteStreamUrl ? { streamUrl: absoluteStreamUrl } : {}),
  };
}

export const sidecarClient = {
  getHealth: () => request<SidecarHealth>('GET', '/health'),
  updatePowerState: (snapshot: PowerEventSnapshot) =>
    request<{ ok: boolean }>('POST', '/power/state', snapshot),
  getDashboardSummary: () =>
    request<import('@lynavo-drive/contracts').DashboardSummaryDTO>('GET', '/dashboard/summary'),
  getDashboardDevices: () =>
    request<import('@lynavo-drive/contracts').DashboardDeviceDTO[]>('GET', '/dashboard/devices'),
  getDeviceFiles: (
    id: string,
    date: string,
    options?: {
      page?: number;
      pageSize?: number;
      sortField?: DeviceFileSortField;
      sortDirection?: SortDirection;
      endDate?: string;
    },
  ) => {
    const params = new URLSearchParams({ date });
    if (options?.page) params.set('page', String(options.page));
    if (options?.pageSize) params.set('pageSize', String(options.pageSize));
    if (options?.sortField) params.set('sortField', options.sortField);
    if (options?.sortDirection) params.set('sortDirection', options.sortDirection);
    if (options?.endDate) params.set('endDate', options.endDate);
    return request<DeviceFileLedgerPageDTO>('GET', `/devices/${id}/files?${params.toString()}`);
  },
  getDeviceDates: (id: string) => request<{ dates: string[] }>('GET', `/devices/${id}/dates`),
  getSettings: () => request<import('@lynavo-drive/contracts').SettingsDTO>('GET', '/settings'),
  updateSettings: (s: Partial<import('@lynavo-drive/contracts').SettingsDTO>) =>
    request<import('@lynavo-drive/contracts').SettingsDTO>('PUT', '/settings', s),
  resetState: () => request<{ ok: boolean }>('POST', '/settings/reset-state', {}),
  setConnectionCode: (code: string) =>
    request<{ code: string }>('POST', '/connection-code', { code }),
  getConnectionDevices: () =>
    request<ConnectionDevicesSettingsDTO>('GET', '/settings/connection-devices'),
  revokeConnectionDevice: (clientId: string) =>
    request<{ ok: boolean }>(
      'POST',
      `/settings/connection-devices/${encodeURIComponent(clientId)}/revoke`,
      {},
    ),
  clearBlockedClient: (clientId: string) =>
    request<{ ok: boolean }>(
      'POST',
      `/settings/blocked-clients/${encodeURIComponent(clientId)}/clear`,
      {},
    ),
  regenerateConnectionCode: () => request<{ code: string }>('POST', '/connection-code/regenerate'),
  getShareStatus: () =>
    request<import('@lynavo-drive/contracts').ShareStatusDTO>('GET', '/share/status'),
  validateShare: () =>
    request<import('@lynavo-drive/contracts').ShareStatusDTO>('POST', '/share/validate'),
  getTransferActive: () => request<{ active: boolean }>('GET', '/transfer/active'),
  getSharedList: (path?: string) => {
    const encodedPath = path ? encodeSharedFilePath(path) : '';
    const endpoint = encodedPath ? `/shared/list/${encodedPath}` : '/shared/list';
    return request<import('@lynavo-drive/contracts').SharedDirectoryDTO>('GET', endpoint);
  },
  getManagedDevices: () =>
    request<DesktopLocalListResponse<DesktopManagedDeviceDTO>>('GET', '/management/devices'),
  unblockDevice: (clientId: string) =>
    request<{ ok: boolean }>('POST', `/management/devices/${encodeURIComponent(clientId)}/unblock`),
  blockDevice: (clientId: string) =>
    request<{ ok: boolean }>('POST', `/management/devices/${encodeURIComponent(clientId)}/block`),
  getSyncRecords: () =>
    request<DesktopLocalListResponse<DesktopSyncRecordDTO>>('GET', '/management/records/sync'),
  getAccessRecords: () =>
    request<DesktopLocalListResponse<DesktopAccessRecordDTO>>('GET', '/management/records/access'),
  getSharedResources: () =>
    request<DesktopLocalListResponse<DesktopSharedResourceDTO>>('GET', '/resources/shared'),
  addSharedResource: (payload: AddSharedResourcePayload) =>
    request<DesktopSharedResourceDTO>('POST', '/resources/shared', payload),
  removeSharedResource: (resourceId: string) =>
    request<{ ok: boolean }>('DELETE', `/resources/shared/${encodeURIComponent(resourceId)}`),
  getReceivedLibrary: async (options?: { page?: number; pageSize?: number }) => {
    const params = new URLSearchParams();
    if (options?.page) params.set('page', String(options.page));
    if (options?.pageSize) params.set('pageSize', String(options.pageSize));
    const endpoint =
      params.size > 0 ? `/resources/received?${params.toString()}` : '/resources/received';
    const response = await request<ReceivedLibraryPageDTO>('GET', endpoint);
    return {
      ...response,
      items: response.items.map(normalizeReceivedLibraryItem),
    };
  },
};
