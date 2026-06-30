import http from 'node:http';
import https from 'node:https';
import log from 'electron-log';
import { APP_COMPATIBILITY_VERSION, SIDECAR_HTTP_PORT } from '@syncflow/contracts';
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
} from '@syncflow/contracts';
import { desktopClientHeaders } from './app-info';

const BASE = `http://127.0.0.1:${SIDECAR_HTTP_PORT}`;
export type PowerEventSnapshot = {
  event: 'suspend' | 'resume' | 'lock-screen' | 'unlock-screen';
  state: 'awake' | 'sleeping' | 'locked' | 'unlocked';
  lastSuspendAt: string | null;
  lastResumeAt: string | null;
  lastLockAt: string | null;
  lastUnlockAt: string | null;
  updatedAt: string;
};

const DEFAULT_REMOTE_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_SIDECAR_REQUEST_TIMEOUT_MS = 30_000;

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const REMOTE_REQUEST_TIMEOUT_MS = parsePositiveInteger(
  process.env.SYNCFLOW_REMOTE_REQUEST_TIMEOUT_MS,
  DEFAULT_REMOTE_REQUEST_TIMEOUT_MS,
);
const SIDECAR_REQUEST_TIMEOUT_MS = parsePositiveInteger(
  process.env.SYNCFLOW_SIDECAR_REQUEST_TIMEOUT_MS,
  DEFAULT_SIDECAR_REQUEST_TIMEOUT_MS,
);

function remoteApiHeaders(baseUrl: string): Record<string, string> {
  return baseUrl === BASE ? {} : desktopClientHeaders();
}

function requestTimeoutMs(baseUrl: string): number {
  return baseUrl === BASE ? SIDECAR_REQUEST_TIMEOUT_MS : REMOTE_REQUEST_TIMEOUT_MS;
}

function encodeSharedFilePath(path: string): string {
  return path
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter((segment) => segment.trim().length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function errorDiagnostics(error: Error): Record<string, unknown> {
  const diagnostics: Record<string, unknown> = {
    name: error.name,
    message: error.message,
  };
  const record = error as Error & {
    code?: unknown;
    cause?: unknown;
  };
  if (record.code) {
    diagnostics.code = record.code;
  }
  if (record.cause instanceof Error) {
    diagnostics.cause = {
      name: record.cause.name,
      message: record.cause.message,
    };
  } else if (record.cause) {
    diagnostics.cause = String(record.cause);
  }
  return diagnostics;
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
  tunnel?: {
    signalingAuthState?: 'ok' | 'refresh_required' | string;
    credentialRefreshRequired?: boolean;
  };
}

export function supportsConnectionDeviceManagement(
  health: SidecarHealth | null | undefined,
): boolean {
  return (
    health?.ok === true &&
    health.service === 'syncflow-sidecar' &&
    health.appCompatibilityVersion === APP_COMPATIBILITY_VERSION &&
    health.capabilities?.connectionDeviceManagement === true
  );
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  baseUrl = BASE,
  headers?: Record<string, string>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const transport = url.protocol === 'https:' ? https : http;
    const options: http.RequestOptions = {
      method,
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port ? Number(url.port) : undefined,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...remoteApiHeaders(baseUrl),
        ...headers,
      },
    };

    let settled = false;
    const rejectOnce = (error: Error) => {
      if (!settled) {
        settled = true;
        if (baseUrl !== BASE) {
          log.error('[sidecar-client] Remote API request failed.', {
            method,
            url: `${url.origin}${url.pathname}${url.search}`,
            ...errorDiagnostics(error),
          });
        }
        reject(error);
      }
    };
    const resolveOnce = (value: T) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    const req = transport.request(options, (res) => {
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
    const timeoutMs = requestTimeoutMs(baseUrl);
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
    request<import('@syncflow/contracts').DashboardSummaryDTO>('GET', '/dashboard/summary'),
  getDashboardDevices: () =>
    request<import('@syncflow/contracts').DashboardDeviceDTO[]>('GET', '/dashboard/devices'),
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
  getSettings: () => request<import('@syncflow/contracts').SettingsDTO>('GET', '/settings'),
  updateSettings: (s: Partial<import('@syncflow/contracts').SettingsDTO>) =>
    request<import('@syncflow/contracts').SettingsDTO>('PUT', '/settings', s),
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
    request<import('@syncflow/contracts').ShareStatusDTO>('GET', '/share/status'),
  validateShare: () =>
    request<import('@syncflow/contracts').ShareStatusDTO>('POST', '/share/validate'),
  getTransferActive: () => request<{ active: boolean }>('GET', '/transfer/active'),
  getSharedList: (path?: string) => {
    const encodedPath = path ? encodeSharedFilePath(path) : '';
    const endpoint = encodedPath ? `/shared/list/${encodedPath}` : '/shared/list';
    return request<import('@syncflow/contracts').SharedDirectoryDTO>('GET', endpoint);
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

export async function syncCredentialsToSidecar(): Promise<boolean> {
  log.info('[sidecar-client] OSS runtime skips commercial credential sync.');
  return false;
}
