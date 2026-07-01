import { app, BrowserWindow, powerMonitor, powerSaveBlocker, screen } from 'electron';
import log from 'electron-log';
import { join } from 'path';
import { registerIpcHandlers } from './ipc-handlers';
import { attachPowerEventLogging } from './power-event-logging';
import { PowerSaveCoordinator } from './power-save-coordinator';
import { PowerSaveManager } from './power-save-manager';
import { PowerSavePreferences } from './power-save-preferences';
import { PowerSaveSettingsController } from './power-save-settings-controller';
import { requestMacFilesAndFoldersPermissionsOnStartup } from './macos-files-folders-permissions';
import { attachRendererLogging } from './renderer-logging';
import { SidecarManager } from './sidecar-manager';
import { sidecarClient } from './sidecar-client';
import { createVideoThumbnailEventHandler } from './video-thumbnail-generator';
import { WsBridge } from './ws-bridge';
import { getMainWindowChromeOptions, getMainWindowSizeOptions } from './window-chrome';
import type { SidecarRuntimeState } from '../shared/sidecar-runtime';
import { APP_STORAGE_IDENTITY_NAME, getProductName } from '../shared/product';
import { shouldHideApplicationMenu } from '../shared/platform-capabilities';

// Prevent crash on broken pipe (sidecar stdout/stderr)
process.on('uncaughtException', (err) => {
  if (err.message.includes('write EIO') || err.message.includes('EPIPE')) return;
  log.error('Uncaught exception:', err);
});

let mainWindow: BrowserWindow | null = null;

app.setPath('userData', join(app.getPath('appData'), APP_STORAGE_IDENTITY_NAME));
const sidecar = new SidecarManager();
let wsBridge: WsBridge;
const powerSaveManager = new PowerSaveManager(powerSaveBlocker);
let powerSaveCoordinator: PowerSaveCoordinator | null = null;
const isDev = !app.isPackaged;

function broadcastSidecarRuntimeState(state: SidecarRuntimeState) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('sidecar:runtime-state', state);
    }
  }
}

function syncWsBridgeWithRuntimeState(state: SidecarRuntimeState) {
  if (!wsBridge || !powerSaveCoordinator) {
    return;
  }

  const action = powerSaveCoordinator.handleRuntimeState(state);
  if (action === 'connect') {
    wsBridge.connect();
    return;
  }

  wsBridge.disconnect();
}

sidecar.on('state', (state: SidecarRuntimeState) => {
  broadcastSidecarRuntimeState(state);
  syncWsBridgeWithRuntimeState(state);
});

export async function createMainWindow() {
  const { workAreaSize } = screen.getPrimaryDisplay();
  mainWindow = new BrowserWindow({
    title: getProductName(),
    ...getMainWindowSizeOptions(workAreaSize),
    backgroundColor: '#f4f8fb',
    ...getMainWindowChromeOptions(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  attachRendererLogging(mainWindow);
  if (shouldHideApplicationMenu()) {
    mainWindow.setMenuBarVisibility(false);
  }

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    await mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    await mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  log.info(
    `[App] ready version=${app.getVersion()} packaged=${app.isPackaged} platform=${process.platform} arch=${process.arch}`,
  );
  attachPowerEventLogging(powerMonitor, (snapshot) => {
    sidecarClient.updatePowerState(snapshot).catch((error) => {
      log.warn('[power] failed to sync state to sidecar', error);
    });
  });
  void requestMacFilesAndFoldersPermissionsOnStartup();
  const powerSavePreferences = new PowerSavePreferences(app.getPath('userData'));
  powerSaveManager.setEnabled(powerSavePreferences.read().preventSleepDuringTransfer);
  const powerSaveSettingsController = new PowerSaveSettingsController(
    powerSaveManager,
    powerSavePreferences,
  );
  registerIpcHandlers(sidecar, powerSaveSettingsController);
  powerSaveCoordinator = new PowerSaveCoordinator(
    powerSaveManager,
    () => sidecarClient.getTransferActive(),
    (message, err) => log.warn(message, err),
  );
  const handleVideoThumbnailEvent = createVideoThumbnailEventHandler();
  wsBridge = new WsBridge(
    () => mainWindow,
    (event) => {
      powerSaveCoordinator?.handleSidecarEvent(event);
      void handleVideoThumbnailEvent(event);
    },
  );
  void sidecar.start().catch((err) => {
    log.error('Failed to start sidecar:', err);
  });
  await createMainWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

let isQuitting = false;
app.on('before-quit', (event) => {
  if (isQuitting) return;
  event.preventDefault();
  isQuitting = true;
  powerSaveManager.stop();
  wsBridge?.disconnect();
  sidecar.stop({ killExternal: true, killBonjourBroadcasts: true }).finally(() => app.quit());
});
