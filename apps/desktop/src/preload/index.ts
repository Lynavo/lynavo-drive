import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
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
  SIDECAR_REGENERATE_CODE: 'sidecar:regenerate-code',
  SIDECAR_RUNTIME_STATE: 'sidecar:runtime-state',
  SIDECAR_RETRY_START: 'sidecar:retry-start',
  SIDECAR_SHARE_STATUS: 'sidecar:share-status',
  SIDECAR_VALIDATE_SHARE: 'sidecar:validate-share',
  SUPPORT_EXPORT_DIAGNOSTICS: 'support:export-diagnostics',
  SUPPORT_APP_INFO: 'support:app-info',
  FILES_OPEN_FOLDER: 'files:open-folder',
  FILES_OPEN_FILE: 'files:open-file',
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
    ) =>
      ipcRenderer.invoke(IPC.SIDECAR_DEVICE_FILES, deviceId, date, options),
    getDeviceDates: (deviceId: string) =>
      ipcRenderer.invoke(IPC.SIDECAR_DEVICE_DATES, deviceId),
    getSettings: () => ipcRenderer.invoke(IPC.SIDECAR_SETTINGS),
    updateSettings: (settings) =>
      ipcRenderer.invoke(IPC.SIDECAR_UPDATE_SETTINGS, settings),
    regenerateConnectionCode: () => ipcRenderer.invoke(IPC.SIDECAR_REGENERATE_CODE),
    getRuntimeState: () => ipcRenderer.invoke(IPC.SIDECAR_RUNTIME_STATE),
    retryStart: () => ipcRenderer.invoke(IPC.SIDECAR_RETRY_START),
    getShareStatus: () => ipcRenderer.invoke(IPC.SIDECAR_SHARE_STATUS),
    validateShare: () => ipcRenderer.invoke(IPC.SIDECAR_VALIDATE_SHARE),
  },
  files: {
    openFolder: (path: string) => ipcRenderer.invoke(IPC.FILES_OPEN_FOLDER, path),
    openFile: (path: string) => ipcRenderer.invoke(IPC.FILES_OPEN_FILE, path),
    selectFolder: () => ipcRenderer.invoke(IPC.FILES_SELECT_FOLDER),
    copyToClipboard: (text: string) =>
      ipcRenderer.invoke(IPC.FILES_COPY_CLIPBOARD, text),
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
  },
  support: {
    exportDiagnostics: () => ipcRenderer.invoke(IPC.SUPPORT_EXPORT_DIAGNOSTICS),
    getAppInfo: () => ipcRenderer.invoke(IPC.SUPPORT_APP_INFO),
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
