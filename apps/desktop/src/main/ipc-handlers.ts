import { ipcMain } from 'electron';
import { sidecarClient, supportsPairingRevocationOnCodeRotation } from './sidecar-client';
import {
  openFolder,
  openFile,
  openExternal,
  selectFolder,
  copyToClipboard,
} from './file-operations';
import type { SidecarManager } from './sidecar-manager';
import { exportDiagnostics, getAppInfo } from './diagnostics';
import { installBonjourForWindows } from './bonjour-installer';

// Channel constants — shared between main and preload
export const IPC = {
  SIDECAR_HEALTH: 'sidecar:health',
  SIDECAR_DASHBOARD_SUMMARY: 'sidecar:dashboard-summary',
  SIDECAR_DASHBOARD_DEVICES: 'sidecar:dashboard-devices',
  SIDECAR_DEVICE_FILES: 'sidecar:device-files',
  SIDECAR_DEVICE_DATES: 'sidecar:device-dates',
  SIDECAR_SETTINGS: 'sidecar:settings',
  SIDECAR_UPDATE_SETTINGS: 'sidecar:update-settings',
  SIDECAR_RESET_STATE: 'sidecar:reset-state',
  SIDECAR_REGENERATE_CODE: 'sidecar:regenerate-code',
  SIDECAR_RUNTIME_STATE: 'sidecar:runtime-state',
  SIDECAR_RETRY_START: 'sidecar:retry-start',
  SIDECAR_INSTALL_BONJOUR: 'sidecar:install-bonjour',
  SIDECAR_SHARE_STATUS: 'sidecar:share-status',
  SIDECAR_VALIDATE_SHARE: 'sidecar:validate-share',
  SIDECAR_TRANSFER_ACTIVE: 'sidecar:transfer-active',
  SIDECAR_SHARED_LIST: 'sidecar:shared-list',
  SUPPORT_EXPORT_DIAGNOSTICS: 'support:export-diagnostics',
  SUPPORT_APP_INFO: 'support:app-info',
  FILES_OPEN_FOLDER: 'files:open-folder',
  FILES_OPEN_FILE: 'files:open-file',
  FILES_OPEN_EXTERNAL: 'files:open-external',
  FILES_SELECT_FOLDER: 'files:select-folder',
  FILES_COPY_CLIPBOARD: 'files:copy-clipboard',
} as const;

async function regenerateConnectionCodeSafely(sidecarManager: SidecarManager): Promise<{ code: string }> {
  let health = null;
  try {
    health = await sidecarClient.getHealth();
  } catch {
    // Regeneration is a foreground user action; recover the sidecar here so
    // the UI cannot report a fresh code from a stale or missing service.
  }
  if (!supportsPairingRevocationOnCodeRotation(health)) {
    await sidecarManager.retryStart();
  }
  return sidecarClient.regenerateConnectionCode();
}

export function registerIpcHandlers(sidecarManager: SidecarManager): void {
  // Sidecar — real HTTP calls
  ipcMain.handle(IPC.SIDECAR_HEALTH, () => sidecarClient.getHealth());
  ipcMain.handle(IPC.SIDECAR_DASHBOARD_SUMMARY, () => sidecarClient.getDashboardSummary());
  ipcMain.handle(IPC.SIDECAR_DASHBOARD_DEVICES, () => sidecarClient.getDashboardDevices());
  ipcMain.handle(
    IPC.SIDECAR_DEVICE_FILES,
    (
      _e,
      deviceId: string,
      date: string,
      options?: {
        page?: number;
        pageSize?: number;
        sortField?: import('@syncflow/contracts').DeviceFileSortField;
        sortDirection?: import('@syncflow/contracts').SortDirection;
      },
    ) => sidecarClient.getDeviceFiles(deviceId, date, options),
  );
  ipcMain.handle(IPC.SIDECAR_DEVICE_DATES, (_e, deviceId: string) =>
    sidecarClient.getDeviceDates(deviceId),
  );
  ipcMain.handle(IPC.SIDECAR_SETTINGS, () => sidecarClient.getSettings());
  ipcMain.handle(IPC.SIDECAR_UPDATE_SETTINGS, (_e, partial) =>
    sidecarClient.updateSettings(partial),
  );
  ipcMain.handle(IPC.SIDECAR_RESET_STATE, () => sidecarClient.resetState());
  ipcMain.handle(IPC.SIDECAR_REGENERATE_CODE, () =>
    regenerateConnectionCodeSafely(sidecarManager),
  );
  ipcMain.handle(IPC.SIDECAR_RUNTIME_STATE, () => sidecarManager.getState());
  ipcMain.handle(IPC.SIDECAR_RETRY_START, () => sidecarManager.retryStart());
  ipcMain.handle(IPC.SIDECAR_INSTALL_BONJOUR, () => installBonjourForWindows(sidecarManager));
  ipcMain.handle(IPC.SIDECAR_SHARE_STATUS, () => sidecarClient.getShareStatus());
  ipcMain.handle(IPC.SIDECAR_VALIDATE_SHARE, () => sidecarClient.validateShare());
  ipcMain.handle(IPC.SIDECAR_TRANSFER_ACTIVE, () => sidecarClient.getTransferActive());
  ipcMain.handle(IPC.SIDECAR_SHARED_LIST, (_e, path?: string) =>
    sidecarClient.getSharedList(path),
  );
  ipcMain.handle(IPC.SUPPORT_EXPORT_DIAGNOSTICS, () => exportDiagnostics(sidecarManager));
  ipcMain.handle(IPC.SUPPORT_APP_INFO, () => getAppInfo());

  // File operations — real Electron APIs
  ipcMain.handle(IPC.FILES_OPEN_FOLDER, (_e, path: string) => openFolder(path));
  ipcMain.handle(IPC.FILES_OPEN_FILE, (_e, path: string) => openFile(path));
  ipcMain.handle(IPC.FILES_OPEN_EXTERNAL, (_e, target: string) => openExternal(target));
  ipcMain.handle(IPC.FILES_SELECT_FOLDER, () => selectFolder());
  ipcMain.handle(IPC.FILES_COPY_CLIPBOARD, (_e, text: string) => copyToClipboard(text));
}
