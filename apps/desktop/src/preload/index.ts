import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import os from 'node:os';
import type { ElectronAPI } from './api';
import type { SidecarEvent } from '@syncflow/contracts';
import type { SidecarRuntimeState } from '../shared/sidecar-runtime';

// IPC channel constants — duplicated from main/ipc-handlers.ts
// because electron-vite builds preload and main as separate targets.
const IPC = {
  SIDECAR_HEALTH: 'sidecar:health',
  SIDECAR_DASHBOARD_SUMMARY: 'sidecar:dashboard-summary',
  SIDECAR_DASHBOARD_DEVICES: 'sidecar:dashboard-devices',
  SIDECAR_DEVICE_FILES: 'sidecar:device-files',
  SIDECAR_DEVICE_DATES: 'sidecar:device-dates',
  SIDECAR_SETTINGS: 'sidecar:settings',
  SIDECAR_UPDATE_SETTINGS: 'sidecar:update-settings',
  SIDECAR_RESET_STATE: 'sidecar:reset-state',
  SIDECAR_REDEEM_GIFT_CARD: 'sidecar:redeem-gift-card',
  AUTH_SEND_SMS_CODE: 'auth:send-sms-code',
  AUTH_LOGIN_WITH_SMS_CODE: 'auth:login-with-sms-code',
  SIDECAR_REGENERATE_CODE: 'sidecar:regenerate-code',
  SIDECAR_RUNTIME_STATE: 'sidecar:runtime-state',
  SIDECAR_RETRY_START: 'sidecar:retry-start',
  SIDECAR_INSTALL_BONJOUR: 'sidecar:install-bonjour',
  SIDECAR_SHARE_STATUS: 'sidecar:share-status',
  SIDECAR_VALIDATE_SHARE: 'sidecar:validate-share',
  SIDECAR_TRANSFER_ACTIVE: 'sidecar:transfer-active',
  SIDECAR_SHARED_LIST: 'sidecar:shared-list',
  SUPPORT_UPLOAD_DIAGNOSTICS: 'support:upload-diagnostics',
  SUPPORT_EXPORT_DIAGNOSTICS: 'support:export-diagnostics',
  SUPPORT_CHECK_FOR_UPDATES: 'support:check-for-updates',
  SUPPORT_APP_INFO: 'support:app-info',
  FILES_OPEN_FOLDER: 'files:open-folder',
  FILES_OPEN_FILE: 'files:open-file',
  FILES_OPEN_EXTERNAL: 'files:open-external',
  FILES_SELECT_FOLDER: 'files:select-folder',
  FILES_COPY_CLIPBOARD: 'files:copy-clipboard',
} as const;

const electronAPI: ElectronAPI = {
  sidecar: {
    getHealth: () => ipcRenderer.invoke(IPC.SIDECAR_HEALTH),
    getDashboardSummary: () => ipcRenderer.invoke(IPC.SIDECAR_DASHBOARD_SUMMARY),
    getDashboardDevices: () => ipcRenderer.invoke(IPC.SIDECAR_DASHBOARD_DEVICES),
    getDeviceFiles: (
      deviceId: string,
      date: string,
      options?: {
        page?: number;
        pageSize?: number;
        sortField?: import('@syncflow/contracts').DeviceFileSortField;
        sortDirection?: import('@syncflow/contracts').SortDirection;
      },
    ) => ipcRenderer.invoke(IPC.SIDECAR_DEVICE_FILES, deviceId, date, options),
    getDeviceDates: (deviceId: string) => ipcRenderer.invoke(IPC.SIDECAR_DEVICE_DATES, deviceId),
    getSettings: () => ipcRenderer.invoke(IPC.SIDECAR_SETTINGS),
    updateSettings: (settings) => ipcRenderer.invoke(IPC.SIDECAR_UPDATE_SETTINGS, settings),
    resetState: () => ipcRenderer.invoke(IPC.SIDECAR_RESET_STATE),
    redeemGiftCard: (payload: { code: string }) =>
      ipcRenderer.invoke(IPC.SIDECAR_REDEEM_GIFT_CARD, payload),
    regenerateConnectionCode: () => ipcRenderer.invoke(IPC.SIDECAR_REGENERATE_CODE),
    getRuntimeState: () => ipcRenderer.invoke(IPC.SIDECAR_RUNTIME_STATE),
    retryStart: () => ipcRenderer.invoke(IPC.SIDECAR_RETRY_START),
    installBonjour: () => ipcRenderer.invoke(IPC.SIDECAR_INSTALL_BONJOUR),
    getShareStatus: () => ipcRenderer.invoke(IPC.SIDECAR_SHARE_STATUS),
    validateShare: () => ipcRenderer.invoke(IPC.SIDECAR_VALIDATE_SHARE),
    getTransferActive: () => ipcRenderer.invoke(IPC.SIDECAR_TRANSFER_ACTIVE),
    getSharedList: (path?: string) => ipcRenderer.invoke(IPC.SIDECAR_SHARED_LIST, path),
  },
  files: {
    openFolder: (path: string) => ipcRenderer.invoke(IPC.FILES_OPEN_FOLDER, path),
    openFile: (path: string) => ipcRenderer.invoke(IPC.FILES_OPEN_FILE, path),
    openExternal: (target: string) => ipcRenderer.invoke(IPC.FILES_OPEN_EXTERNAL, target),
    selectFolder: () => ipcRenderer.invoke(IPC.FILES_SELECT_FOLDER),
    copyToClipboard: (text: string) => ipcRenderer.invoke(IPC.FILES_COPY_CLIPBOARD, text),
  },
  auth: {
    sendSMSCode: (payload: { phone: string }) =>
      ipcRenderer.invoke(IPC.AUTH_SEND_SMS_CODE, payload),
    loginWithSMSCode: (payload: { phone: string; code: string }) =>
      ipcRenderer.invoke(IPC.AUTH_LOGIN_WITH_SMS_CODE, payload),
  },
  events: {
    onSidecarEvent: (callback) => {
      const handler = (_event: IpcRendererEvent, data: SidecarEvent) => callback(data);
      ipcRenderer.on('sidecar:event', handler);
      return () => {
        ipcRenderer.removeListener('sidecar:event', handler);
      };
    },
    onSidecarRuntimeState: (callback) => {
      const handler = (_event: IpcRendererEvent, data: SidecarRuntimeState) => callback(data);
      ipcRenderer.on('sidecar:runtime-state', handler);
      return () => {
        ipcRenderer.removeListener('sidecar:runtime-state', handler);
      };
    },
  },
  platform: {
    isMac: () => process.platform === 'darwin',
    isWindows: () => process.platform === 'win32',
    getHostName: () => os.hostname(),
    getLocalIPs: () => {
      const interfaces = os.networkInterfaces();
      const addresses: string[] = [];
      for (const k in interfaces) {
        const addrs = interfaces[k];
        if (!addrs) continue;
        for (const address of addrs) {
          if (address.family === 'IPv4' && !address.internal) {
            addresses.push(address.address);
          }
        }
      }
      return addresses;
    },
  },
  support: {
    uploadDiagnostics: (request) => ipcRenderer.invoke(IPC.SUPPORT_UPLOAD_DIAGNOSTICS, request),
    exportDiagnostics: (locale?: string, description?: string) =>
      ipcRenderer.invoke(IPC.SUPPORT_EXPORT_DIAGNOSTICS, locale, description),
    checkForUpdates: () => ipcRenderer.invoke(IPC.SUPPORT_CHECK_FOR_UPDATES),
    getAppInfo: () => ipcRenderer.invoke(IPC.SUPPORT_APP_INFO),
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
