import type { SettingsDTO } from '@syncflow/contracts';
import type { ElectronAPI } from '../../preload/api';
import { BONJOUR_WINDOWS_SUPPORT_URL } from '../../shared/bonjour';
import { INITIAL_SIDECAR_RUNTIME_STATE } from '../../shared/sidecar-runtime';

const defaultSettings: SettingsDTO = {
  deviceName: 'SyncFlow',
  connectionCode: '000000',
  rootPath: '',
  receivePath: '',
  sharedPath: '',
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
  updateSettings: async (s) => ({ ...defaultSettings, ...s }) as SettingsDTO,
  resetState: async () => ({ ok: true }),
  regenerateConnectionCode: async () => ({ code: '000000' }),
  getRuntimeState: async () => ({
    ...INITIAL_SIDECAR_RUNTIME_STATE,
    status: 'healthy',
    message: null,
  }),
  retryStart: async () => {},
  installBonjour: async () => ({
    status: 'already_installed' as const,
    message: null,
    messageCode: 'alreadyInstalled',
    supportUrl: BONJOUR_WINDOWS_SUPPORT_URL,
    installerPath: null,
    bonjourPath: 'C:\\Program Files\\Bonjour\\dns-sd.exe',
  }),
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
  getTransferActive: async () => ({ active: false }),
  getSharedList: async () => ({ path: '', files: [], totalCount: 0 }),
};

const mockFiles: ElectronAPI['files'] = {
  openFolder: async () => {},
  openFile: async () => {},
  openExternal: async () => {},
  selectFolder: async () => null,
  copyToClipboard: async () => {},
};

const mockEvents: ElectronAPI['events'] = {
  onSidecarEvent: () => () => {},
  onSidecarRuntimeState: () => () => {},
};

const mockPlatform: ElectronAPI['platform'] = {
  isMac: () => true,
  isWindows: () => false,
  getHostName: () => 'localhost',
  getLocalIPs: () => ['192.168.1.100'],
};

const mockAPI: ElectronAPI = {
  sidecar: mockSidecar,
  files: mockFiles,
  events: mockEvents,
  platform: mockPlatform,
  support: {
    uploadDiagnostics: async () => ({
      refId: 'local-mock',
      uploadedAt: new Date().toISOString(),
    }),
    exportDiagnostics: async () => null,
    checkForUpdates: async () => ({
      updateAvailable: false,
      latestVersion: '0.1.1',
      checkedAt: new Date().toISOString(),
    }),
    getAppInfo: async () => ({ name: 'SyncFlow', version: '0.1.1', buildNumber: '5' }),
  },
};

export function useElectronAPI(): ElectronAPI {
  return window.electronAPI ?? mockAPI;
}
