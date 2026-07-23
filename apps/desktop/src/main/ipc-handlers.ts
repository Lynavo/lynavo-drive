import { ipcMain, BrowserWindow } from 'electron';
import log from 'electron-log';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AddSharedResourcePayload } from '@lynavo-drive/contracts';
import { sidecarClient } from './sidecar-client';
import {
  openFolder,
  openFile,
  revealPath,
  openExternal,
  selectFile,
  selectFolder,
  copyToClipboard,
} from './file-operations';
import type { SidecarManager } from './sidecar-manager';
import { exportDiagnostics, getAppInfo } from './diagnostics';
import { usesTitleBarOverlayControls } from '../shared/platform-capabilities';
import { getTitleBarOverlayOptions } from './window-chrome';

// Channel constants — shared between main and preload
export const IPC = {
  SIDECAR_HEALTH: 'sidecar:health',
  SIDECAR_DASHBOARD_SUMMARY: 'sidecar:dashboard-summary',
  SIDECAR_DASHBOARD_DEVICES: 'sidecar:dashboard-devices',
  SIDECAR_DEVICE_FILES: 'sidecar:device-files',
  SIDECAR_DEVICE_DATES: 'sidecar:device-dates',
  SIDECAR_DEVICE_RECEIVE_LOCATIONS: 'sidecar:device-receive-locations',
  SIDECAR_SETTINGS: 'sidecar:settings',
  SIDECAR_UPDATE_SETTINGS: 'sidecar:update-settings',
  SIDECAR_CONNECTION_DEVICES: 'sidecar:connection-devices',
  SIDECAR_REVOKE_CONNECTION_DEVICE: 'sidecar:revoke-connection-device',
  SIDECAR_CLEAR_BLOCKED_CLIENT: 'sidecar:clear-blocked-client',
  SIDECAR_SET_CONNECTION_CODE: 'sidecar:set-connection-code',
  SIDECAR_REGENERATE_CODE: 'sidecar:regenerate-code',
  SIDECAR_RUNTIME_STATE: 'sidecar:runtime-state',
  SIDECAR_RETRY_START: 'sidecar:retry-start',
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

type PowerSaveState = {
  preventSleepDuringTransfer: boolean;
  blockingSleep: boolean;
};

type PowerSaveController = {
  getState(): PowerSaveState;
  setPreventSleepDuringTransfer(enabled: boolean): PowerSaveState;
};

async function regenerateConnectionCodeSafely(): Promise<{ code: string }> {
  return sidecarClient.regenerateConnectionCode();
}

export function registerIpcHandlers(
  sidecarManager: SidecarManager,
  powerSave?: PowerSaveController,
): void {
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
        sortField?: import('@lynavo-drive/contracts').DeviceFileSortField;
        sortDirection?: import('@lynavo-drive/contracts').SortDirection;
      },
    ) => sidecarClient.getDeviceFiles(deviceId, date, options),
  );
  ipcMain.handle(IPC.SIDECAR_DEVICE_DATES, (_e, deviceId: string) =>
    sidecarClient.getDeviceDates(deviceId),
  );
  ipcMain.handle(IPC.SIDECAR_DEVICE_RECEIVE_LOCATIONS, (_e, clientId: string) =>
    sidecarClient.getDeviceReceiveLocations(clientId),
  );
  ipcMain.handle(IPC.SIDECAR_SETTINGS, () => sidecarClient.getSettings());
  ipcMain.handle(IPC.SIDECAR_UPDATE_SETTINGS, (_e, partial) =>
    sidecarClient.updateSettings(partial),
  );
  ipcMain.handle(IPC.SIDECAR_CONNECTION_DEVICES, () => sidecarClient.getConnectionDevices());
  ipcMain.handle(IPC.SIDECAR_REVOKE_CONNECTION_DEVICE, (_e, clientId: string) =>
    sidecarClient.revokeConnectionDevice(clientId),
  );
  ipcMain.handle(IPC.SIDECAR_CLEAR_BLOCKED_CLIENT, (_e, clientId: string) =>
    sidecarClient.clearBlockedClient(clientId),
  );
  ipcMain.handle(IPC.SIDECAR_SET_CONNECTION_CODE, (_e, code: string) =>
    sidecarClient.setConnectionCode(code),
  );
  ipcMain.handle(IPC.SIDECAR_REGENERATE_CODE, () => regenerateConnectionCodeSafely());
  ipcMain.handle(IPC.SIDECAR_RUNTIME_STATE, () => sidecarManager.getState());
  ipcMain.handle(IPC.SIDECAR_RETRY_START, () => sidecarManager.retryStart());
  ipcMain.handle(IPC.SIDECAR_SHARE_STATUS, () => sidecarClient.getShareStatus());
  ipcMain.handle(IPC.SIDECAR_VALIDATE_SHARE, () => sidecarClient.validateShare());
  ipcMain.handle(IPC.SIDECAR_TRANSFER_ACTIVE, () => sidecarClient.getTransferActive());
  ipcMain.handle(IPC.SIDECAR_SHARED_LIST, (_e, path?: string) => sidecarClient.getSharedList(path));
  ipcMain.handle(IPC.SIDECAR_MANAGED_DEVICES, () => sidecarClient.getManagedDevices());
  ipcMain.handle(IPC.SIDECAR_UNBLOCK_DEVICE, (_e, clientId: string) =>
    sidecarClient.unblockDevice(clientId),
  );
  ipcMain.handle(IPC.SIDECAR_BLOCK_DEVICE, (_e, clientId: string) =>
    sidecarClient.blockDevice(clientId),
  );
  ipcMain.handle(IPC.SIDECAR_SYNC_RECORDS, () => sidecarClient.getSyncRecords());
  ipcMain.handle(IPC.SIDECAR_ACCESS_RECORDS, () => sidecarClient.getAccessRecords());
  ipcMain.handle(IPC.SIDECAR_SHARED_RESOURCES, () => sidecarClient.getSharedResources());
  ipcMain.handle(IPC.SIDECAR_ADD_SHARED_RESOURCE, (_e, payload: AddSharedResourcePayload) =>
    sidecarClient.addSharedResource(payload),
  );
  ipcMain.handle(IPC.SIDECAR_REMOVE_SHARED_RESOURCE, (_e, resourceId: string) =>
    sidecarClient.removeSharedResource(resourceId),
  );
  ipcMain.handle(
    IPC.SIDECAR_RECEIVED_LIBRARY,
    (_e, options?: { page?: number; pageSize?: number }) =>
      sidecarClient.getReceivedLibrary(options),
  );
  if (powerSave) {
    ipcMain.handle(IPC.POWER_SAVE_GET_STATE, async () => powerSave.getState());
    ipcMain.handle(IPC.POWER_SAVE_SET_PREVENT_SLEEP, async (_e, enabled: boolean) =>
      powerSave.setPreventSleepDuringTransfer(enabled),
    );
  }
  ipcMain.handle(IPC.SUPPORT_EXPORT_DIAGNOSTICS, (_e, locale?: string, description?: string) =>
    exportDiagnostics(sidecarManager, locale, description),
  );
  ipcMain.handle(IPC.SUPPORT_APP_INFO, () => getAppInfo());
  ipcMain.handle(IPC.WINDOW_SET_MODAL_OVERLAY_ACTIVE, async (event, active: boolean) => {
    if (!usesTitleBarOverlayControls()) {
      return;
    }
    BrowserWindow.fromWebContents(event.sender)?.setTitleBarOverlay(
      getTitleBarOverlayOptions(Boolean(active)),
    );
  });

  // File operations — real Electron APIs
  ipcMain.handle(IPC.FILES_OPEN_FOLDER, (_e, path: string) => openFolder(path));
  ipcMain.handle(IPC.FILES_OPEN_FILE, (_e, path: string) => openFile(path));
  ipcMain.handle(IPC.FILES_REVEAL_PATH, (_e, path: string) => revealPath(path));
  ipcMain.handle(IPC.FILES_OPEN_EXTERNAL, (_e, target: string) => openExternal(target));
  ipcMain.handle(IPC.FILES_SELECT_FILE, () => selectFile());
  ipcMain.handle(IPC.FILES_SELECT_FOLDER, () => selectFolder());
  ipcMain.handle(IPC.FILES_COPY_CLIPBOARD, (_e, text: string) => copyToClipboard(text));

  // Folder permission check / request (macOS TCC probe)
  ipcMain.handle(IPC.FILES_CHECK_FOLDER_PERMISSION, async (): Promise<{ granted: boolean }> => {
    if (process.platform !== 'darwin') return { granted: true };
    try {
      await readdir(join(homedir(), 'Desktop'), { withFileTypes: true });
      return { granted: true };
    } catch {
      return { granted: false };
    }
  });
  ipcMain.handle(IPC.FILES_REQUEST_FOLDER_PERMISSION, async (): Promise<{ granted: boolean }> => {
    if (process.platform !== 'darwin') return { granted: true };
    try {
      // Probing a TCC-protected directory triggers the macOS permission prompt.
      await readdir(join(homedir(), 'Desktop'), { withFileTypes: true });
      return { granted: true };
    } catch (err) {
      log.warn('[Permissions] folder permission request failed', err);
      return { granted: false };
    }
  });
}
