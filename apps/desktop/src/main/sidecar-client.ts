import http from 'node:http';
import { SIDECAR_HTTP_PORT } from '@syncflow/contracts';
import type {
  DeviceFileLedgerPageDTO,
  DeviceFileSortField,
  SortDirection,
} from '@syncflow/contracts';

const BASE = `http://127.0.0.1:${SIDECAR_HTTP_PORT}`;

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options: http.RequestOptions = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json' },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data) as T);
        } else {
          reject(new Error(`Sidecar ${method} ${path}: ${res.statusCode} ${data}`));
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

export const sidecarClient = {
  getHealth: () => request<{ ok: boolean; service: string }>('GET', '/health'),
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
    },
  ) => {
    const params = new URLSearchParams({ date });
    if (options?.page) params.set('page', String(options.page));
    if (options?.pageSize) params.set('pageSize', String(options.pageSize));
    if (options?.sortField) params.set('sortField', options.sortField);
    if (options?.sortDirection) params.set('sortDirection', options.sortDirection);
    return request<DeviceFileLedgerPageDTO>(
      'GET',
      `/devices/${id}/files?${params.toString()}`,
    );
  },
  getDeviceDates: (id: string) =>
    request<{ dates: string[] }>('GET', `/devices/${id}/dates`),
  getSettings: () =>
    request<import('@syncflow/contracts').SettingsDTO>('GET', '/settings'),
  updateSettings: (s: Partial<import('@syncflow/contracts').SettingsDTO>) =>
    request<import('@syncflow/contracts').SettingsDTO>('PUT', '/settings', s),
  regenerateConnectionCode: () =>
    request<{ code: string }>('POST', '/connection-code/regenerate'),
  getShareStatus: () =>
    request<import('@syncflow/contracts').ShareStatusDTO>('GET', '/share/status'),
  validateShare: () =>
    request<import('@syncflow/contracts').ShareStatusDTO>('POST', '/share/validate'),
};
