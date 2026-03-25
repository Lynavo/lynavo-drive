import type { SettingsDTO } from '@syncflow/contracts';
import type { ElectronAPI } from '../../preload/api';
import { INITIAL_SIDECAR_RUNTIME_STATE } from '../../shared/sidecar-runtime';

const defaultSettings: SettingsDTO = {
  deviceName: 'SyncFlow',
  connectionCode: '000000',
  receivePath: '',
  shareAddress: '',
  shareStatus: 'unknown',
  shareName: 'SyncFlow',
};

const mockSidecar: ElectronAPI['sidecar'] = {
  getHealth: async () => ({ ok: true, service: 'syncflow-sidecar' }),
  getDashboardSummary: async () => ({
    todayUploadCount: 0,
    todayOccupiedBytes: 0,
    remainingBytes: 0,
    isDiskLow: false,
  }),
  getDashboardDevices: async () => [],
  getDeviceFiles: async (_deviceId, _date, options) => ({
    items: [],
    page: options?.page ?? 1,
    pageSize: options?.pageSize ?? 200,
    totalItems: 0,
    totalBytes: 0,
    totalActiveTransmissionMs: 0,
  }),
  getDeviceDates: async () => ({ dates: [] }),
  getSettings: async () => ({ ...defaultSettings }),
  updateSettings: async (s) =>
    ({ ...defaultSettings, ...s }) as SettingsDTO,
  regenerateConnectionCode: async () => ({ code: '000000' }),
  getRuntimeState: async () => ({ ...INITIAL_SIDECAR_RUNTIME_STATE, status: 'healthy', message: null }),
  retryStart: async () => {},
  getShareStatus: async () => ({
    enabled: false,
    smbUrl: null,
    status: 'unknown' as const,
    shareName: 'SyncFlow',
  }),
  validateShare: async () => ({
    enabled: false,
    smbUrl: null,
    status: 'unknown' as const,
    shareName: 'SyncFlow',
  }),
};

const mockFiles: ElectronAPI['files'] = {
  openFolder: async () => {},
  openFile: async () => {},
  selectFolder: async () => null,
  copyToClipboard: async () => {},
};

const mockEvents: ElectronAPI['events'] = {
  onSidecarEvent: () => () => {},
  onSidecarRuntimeState: () => () => {},
};

const mockPlatform: ElectronAPI['platform'] = {
  isMac: () => true,
};

const mockAPI: ElectronAPI = {
  sidecar: mockSidecar,
  files: mockFiles,
  events: mockEvents,
  platform: mockPlatform,
  support: {
    exportDiagnostics: async () => null,
    getAppInfo: async () => ({ name: 'SyncFlow', version: '0.1.0', buildNumber: '4' }),
  },
};

export function useElectronAPI(): ElectronAPI {
  return window.electronAPI ?? mockAPI;
}
