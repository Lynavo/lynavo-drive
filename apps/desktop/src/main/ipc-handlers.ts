import { ipcMain } from 'electron';
import { sidecarClient } from './sidecar-client';
import { openFolder, openFile, selectFolder, copyToClipboard } from './file-operations';
import type { SidecarManager } from './sidecar-manager';
import { exportDiagnostics, getAppInfo } from './diagnostics';

// Channel constants — shared between main and preload
export const IPC = {
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

export function registerIpcHandlers(sidecarManager: SidecarManager): void {
  // Sidecar — real HTTP calls
  ipcMain.handle(IPC.SIDECAR_HEALTH, () => sidecarClient.getHealth());
  ipcMain.handle(IPC.SIDECAR_DASHBOARD_SUMMARY, () => sidecarClient.getDashboardSummary());
  ipcMain.handle(IPC.SIDECAR_DASHBOARD_DEVICES, () => sidecarClient.getDashboardDevices());
  ipcMain.handle(IPC.SIDECAR_DEVICE_FILES, (_e, deviceId: string, date: string) =>
    sidecarClient.getDeviceFiles(deviceId, date),
  );
  ipcMain.handle(IPC.SIDECAR_DEVICE_DATES, (_e, deviceId: string) =>
    sidecarClient.getDeviceDates(deviceId),
  );
  ipcMain.handle(IPC.SIDECAR_SETTINGS, () => sidecarClient.getSettings());
  ipcMain.handle(IPC.SIDECAR_UPDATE_SETTINGS, (_e, partial) =>
    sidecarClient.updateSettings(partial),
  );
  ipcMain.handle(IPC.SIDECAR_REGENERATE_CODE, () => sidecarClient.regenerateConnectionCode());
  ipcMain.handle(IPC.SIDECAR_RUNTIME_STATE, () => sidecarManager.getState());
  ipcMain.handle(IPC.SIDECAR_RETRY_START, () => sidecarManager.retryStart());
  ipcMain.handle(IPC.SIDECAR_SHARE_STATUS, () => sidecarClient.getShareStatus());
  ipcMain.handle(IPC.SIDECAR_VALIDATE_SHARE, () => sidecarClient.validateShare());
  ipcMain.handle(IPC.SUPPORT_EXPORT_DIAGNOSTICS, () => exportDiagnostics(sidecarManager));
  ipcMain.handle(IPC.SUPPORT_APP_INFO, () => getAppInfo());

  // File operations — real Electron APIs
  ipcMain.handle(IPC.FILES_OPEN_FOLDER, (_e, path: string) => openFolder(path));
  ipcMain.handle(IPC.FILES_OPEN_FILE, (_e, path: string) => openFile(path));
  ipcMain.handle(IPC.FILES_SELECT_FOLDER, () => selectFolder());
  ipcMain.handle(IPC.FILES_COPY_CLIPBOARD, (_e, text: string) => copyToClipboard(text));
}
