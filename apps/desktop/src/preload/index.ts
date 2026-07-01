import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import os from 'node:os';
import type { ElectronAPI } from './api';
import type { SidecarEvent } from '@lynavo-drive/contracts';
import type { SidecarRuntimeState } from '../shared/sidecar-runtime';
import { isLinuxPlatform, usesTitleBarOverlayControls } from '../shared/platform-capabilities';

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
  SIDECAR_CONNECTION_DEVICES: 'sidecar:connection-devices',
  SIDECAR_REVOKE_CONNECTION_DEVICE: 'sidecar:revoke-connection-device',
  SIDECAR_CLEAR_BLOCKED_CLIENT: 'sidecar:clear-blocked-client',
  SIDECAR_SET_CONNECTION_CODE: 'sidecar:set-connection-code',
  SIDECAR_REGENERATE_CODE: 'sidecar:regenerate-code',
  SIDECAR_RUNTIME_STATE: 'sidecar:runtime-state',
  SIDECAR_RETRY_START: 'sidecar:retry-start',
  SIDECAR_INSTALL_BONJOUR: 'sidecar:install-bonjour',
  SIDECAR_SHARE_STATUS: 'sidecar:share-status',
  SIDECAR_VALIDATE_SHARE: 'sidecar:validate-share',
  SIDECAR_TRANSFER_ACTIVE: 'sidecar:transfer-active',
  SIDECAR_SHARED_LIST: 'sidecar:shared-list',
  SIDECAR_MANAGED_DEVICES: 'sidecar:managed-devices',
  SIDECAR_UNBLOCK_DEVICE: 'sidecar:unblock-device',
  SIDECAR_BLOCK_DEVICE: 'sidecar:block-device',
  SIDECAR_SYNC_RECORDS: 'sidecar:sync-records',
  SIDECAR_ACCESS_RECORDS: 'sidecar:access-records',
  SIDECAR_SHARED_RESOURCES: 'sidecar:shared-resources',
  SIDECAR_ADD_SHARED_RESOURCE: 'sidecar:add-shared-resource',
  SIDECAR_REMOVE_SHARED_RESOURCE: 'sidecar:remove-shared-resource',
  SIDECAR_RECEIVED_LIBRARY: 'sidecar:received-library',
  SUPPORT_EXPORT_DIAGNOSTICS: 'support:export-diagnostics',
  SUPPORT_APP_INFO: 'support:app-info',
  FILES_OPEN_FOLDER: 'files:open-folder',
  FILES_OPEN_FILE: 'files:open-file',
  FILES_REVEAL_PATH: 'files:reveal-path',
  FILES_OPEN_EXTERNAL: 'files:open-external',
  FILES_SELECT_FILE: 'files:select-file',
  FILES_SELECT_FOLDER: 'files:select-folder',
  FILES_COPY_CLIPBOARD: 'files:copy-clipboard',
  FILES_CHECK_FOLDER_PERMISSION: 'files:check-folder-permission',
  FILES_REQUEST_FOLDER_PERMISSION: 'files:request-folder-permission',
  WINDOW_SET_MODAL_OVERLAY_ACTIVE: 'window:set-modal-overlay-active',
  POWER_SAVE_GET_STATE: 'power-save:get-state',
  POWER_SAVE_SET_PREVENT_SLEEP: 'power-save:set-prevent-sleep',
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
        sortField?: import('@lynavo-drive/contracts').DeviceFileSortField;
        sortDirection?: import('@lynavo-drive/contracts').SortDirection;
      },
    ) => ipcRenderer.invoke(IPC.SIDECAR_DEVICE_FILES, deviceId, date, options),
    getDeviceDates: (deviceId: string) => ipcRenderer.invoke(IPC.SIDECAR_DEVICE_DATES, deviceId),
    getSettings: () => ipcRenderer.invoke(IPC.SIDECAR_SETTINGS),
    updateSettings: (settings) => ipcRenderer.invoke(IPC.SIDECAR_UPDATE_SETTINGS, settings),
    resetState: () => ipcRenderer.invoke(IPC.SIDECAR_RESET_STATE),
    getConnectionDevices: () => ipcRenderer.invoke(IPC.SIDECAR_CONNECTION_DEVICES),
    revokeConnectionDevice: (clientId: string) =>
      ipcRenderer.invoke(IPC.SIDECAR_REVOKE_CONNECTION_DEVICE, clientId),
    clearBlockedClient: (clientId: string) =>
      ipcRenderer.invoke(IPC.SIDECAR_CLEAR_BLOCKED_CLIENT, clientId),
    setConnectionCode: (code: string) => ipcRenderer.invoke(IPC.SIDECAR_SET_CONNECTION_CODE, code),
    regenerateConnectionCode: () => ipcRenderer.invoke(IPC.SIDECAR_REGENERATE_CODE),
    getRuntimeState: () => ipcRenderer.invoke(IPC.SIDECAR_RUNTIME_STATE),
    retryStart: () => ipcRenderer.invoke(IPC.SIDECAR_RETRY_START),
    installBonjour: () => ipcRenderer.invoke(IPC.SIDECAR_INSTALL_BONJOUR),
    getShareStatus: () => ipcRenderer.invoke(IPC.SIDECAR_SHARE_STATUS),
    validateShare: () => ipcRenderer.invoke(IPC.SIDECAR_VALIDATE_SHARE),
    getTransferActive: () => ipcRenderer.invoke(IPC.SIDECAR_TRANSFER_ACTIVE),
    getSharedList: (path?: string) => ipcRenderer.invoke(IPC.SIDECAR_SHARED_LIST, path),
    getManagedDevices: () => ipcRenderer.invoke(IPC.SIDECAR_MANAGED_DEVICES),
    unblockDevice: (clientId: string) => ipcRenderer.invoke(IPC.SIDECAR_UNBLOCK_DEVICE, clientId),
    blockDevice: (clientId: string) => ipcRenderer.invoke(IPC.SIDECAR_BLOCK_DEVICE, clientId),
    getSyncRecords: () => ipcRenderer.invoke(IPC.SIDECAR_SYNC_RECORDS),
    getAccessRecords: () => ipcRenderer.invoke(IPC.SIDECAR_ACCESS_RECORDS),
    getSharedResources: () => ipcRenderer.invoke(IPC.SIDECAR_SHARED_RESOURCES),
    addSharedResource: (payload) => ipcRenderer.invoke(IPC.SIDECAR_ADD_SHARED_RESOURCE, payload),
    removeSharedResource: (resourceId: string) =>
      ipcRenderer.invoke(IPC.SIDECAR_REMOVE_SHARED_RESOURCE, resourceId),
    getReceivedLibrary: (options?: { page?: number; pageSize?: number }) =>
      ipcRenderer.invoke(IPC.SIDECAR_RECEIVED_LIBRARY, options),
  },
  files: {
    openFolder: (path: string) => ipcRenderer.invoke(IPC.FILES_OPEN_FOLDER, path),
    openFile: (path: string) => ipcRenderer.invoke(IPC.FILES_OPEN_FILE, path),
    revealPath: (path: string) => ipcRenderer.invoke(IPC.FILES_REVEAL_PATH, path),
    openExternal: (target: string) => ipcRenderer.invoke(IPC.FILES_OPEN_EXTERNAL, target),
    selectFile: () => ipcRenderer.invoke(IPC.FILES_SELECT_FILE),
    selectFolder: () => ipcRenderer.invoke(IPC.FILES_SELECT_FOLDER),
    copyToClipboard: (text: string) => ipcRenderer.invoke(IPC.FILES_COPY_CLIPBOARD, text),
    checkFolderPermission: () => ipcRenderer.invoke(IPC.FILES_CHECK_FOLDER_PERMISSION),
    requestFolderPermission: () => ipcRenderer.invoke(IPC.FILES_REQUEST_FOLDER_PERMISSION),
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
    isLinux: () => isLinuxPlatform(),
    usesTitleBarOverlayControls: () => usesTitleBarOverlayControls(),
    getHomeDir: () => os.homedir(),
    getHostName: () => os.hostname(),
    setModalOverlayActive: (active: boolean) =>
      ipcRenderer.invoke(IPC.WINDOW_SET_MODAL_OVERLAY_ACTIVE, active),
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
    exportDiagnostics: (locale?: string, description?: string) =>
      ipcRenderer.invoke(IPC.SUPPORT_EXPORT_DIAGNOSTICS, locale, description),
    getAppInfo: () => ipcRenderer.invoke(IPC.SUPPORT_APP_INFO),
  },
  power: {
    getState: () => ipcRenderer.invoke(IPC.POWER_SAVE_GET_STATE),
    setPreventSleepDuringTransfer: (enabled: boolean) =>
      ipcRenderer.invoke(IPC.POWER_SAVE_SET_PREVENT_SLEEP, enabled),
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
