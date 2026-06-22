import type { SettingsDTO } from '@syncflow/contracts';
import type { ElectronAPI } from '../../preload/api';
import { BONJOUR_WINDOWS_SUPPORT_URL } from '../../shared/bonjour';
import { INITIAL_SIDECAR_RUNTIME_STATE } from '../../shared/sidecar-runtime';

const defaultSettings: SettingsDTO = {
  deviceName: 'SyncFlow',
  connectionCode: '000000',
  rootPath: '',
  receivePath: '',
  personalPath: '',
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
  getConnectionDevices: async () => ({
    authorizedDevices: [],
    blockedClients: [],
    recentAttempts: [],
  }),
  revokeConnectionDevice: async () => ({ ok: true }),
  clearBlockedClient: async () => ({ ok: true }),
  getClientConfig: async () => ({ features: { giftCard: { enabled: false } } }),
  redeemGiftCard: async () => ({ ok: true }),
  setConnectionCode: async (code: string) => ({ code }),
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
  getManagedDevices: async () => ({ items: [] }),
  unblockDevice: async () => ({ ok: true }),
  blockDevice: async () => ({ ok: true }),
  getSyncRecords: async () => ({ items: [] }),
  getAccessRecords: async () => ({ items: [] }),
  getSharedResources: async () => ({ items: [] }),
  addSharedResource: async (payload) => ({
    resourceId: 'local-mock-resource',
    desktopDeviceId: 'local-mock-desktop',
    kind: payload.kind,
    displayName: payload.displayName,
    status: payload.status ?? 'available',
    fileSize: payload.fileSize,
    mediaType: payload.mediaType,
    addedAt: new Date().toISOString(),
    downloadCount: 0,
  }),
  removeSharedResource: async () => ({ ok: true }),
  getReceivedLibrary: async (options) => ({
    items: [],
    page: options?.page ?? 1,
    pageSize: options?.pageSize ?? 30,
    totalItems: 0,
    totalBytes: 0,
    deviceStats: [],
  }),
};

const mockFiles: ElectronAPI['files'] = {
  openFolder: async () => {},
  openFile: async () => {},
  revealPath: async () => {},
  openExternal: async () => {},
  selectFile: async () => null,
  selectFolder: async () => null,
  copyToClipboard: async () => {},
  checkFolderPermission: async () => ({ granted: true }),
  requestFolderPermission: async () => ({ granted: true }),
};

const mockAuth: ElectronAPI['auth'] = {
  sendSMSCode: async () => ({ ok: true }),
  loginWithSMSCode: async () => ({ ok: true }),
  sendEmailCode: async () => ({ ok: true }),
  loginWithEmailCode: async () => ({ ok: true }),
  getAuthSession: async () => null,
  logout: async () => ({ ok: true }),
  loginWithOAuth: async () => ({ ok: true }),
};

const mockEvents: ElectronAPI['events'] = {
  onSidecarEvent: () => () => {},
  onSidecarRuntimeState: () => () => {},
};

const mockPlatform: ElectronAPI['platform'] = {
  isMac: () => true,
  isWindows: () => false,
  supportsAppleAuth: () => true,
  usesTitleBarOverlayControls: () => false,
  isAuthBypassEnabled: () => false,
  getHomeDir: () => '/Users/alice',
  getHostName: () => 'localhost',
  getLocalIPs: () => ['192.168.1.100'],
};

const mockPower: ElectronAPI['power'] = {
  getState: async () => ({
    preventSleepDuringTransfer: true,
    blockingSleep: false,
  }),
  setPreventSleepDuringTransfer: async (enabled) => ({
    preventSleepDuringTransfer: enabled,
    blockingSleep: false,
  }),
};

const mockAPI: ElectronAPI = {
  sidecar: mockSidecar,
  files: mockFiles,
  auth: mockAuth,
  events: mockEvents,
  platform: mockPlatform,
  power: mockPower,
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
