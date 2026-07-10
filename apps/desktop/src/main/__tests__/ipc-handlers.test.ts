import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APP_COMPATIBILITY_VERSION,
  type DesktopAccessRecordDTO,
  type DesktopManagedDeviceDTO,
  type DesktopSharedResourceDTO,
  type DesktopSyncRecordDTO,
  type ReceivedLibraryItemDTO,
} from '@lynavo-drive/contracts';
import { IPC, registerIpcHandlers } from '../ipc-handlers';
import { exportDiagnostics } from '../diagnostics';
import { sidecarClient } from '../sidecar-client';

type IpcHandler = (...args: unknown[]) => unknown;

const handlers = new Map<string, IpcHandler>();

const registeredIpcChannelsWithoutPowerSave = Object.values(IPC)
  .filter(
    (channel) =>
      channel !== IPC.POWER_SAVE_GET_STATE && channel !== IPC.POWER_SAVE_SET_PREVENT_SLEEP,
  )
  .sort();

const platformCapabilitiesMock = vi.hoisted(() => ({
  usesTitleBarOverlayControls: vi.fn(() => true),
}));

const managedDeviceFixture: DesktopManagedDeviceDTO = {
  desktopDeviceId: 'desktop-1',
  clientId: 'client-1',
  clientIdShort: 'client',
  displayName: 'iPhone 15 Pro',
  platform: 'ios',
  authorizationStatus: 'authorized',
  blockStatus: 'none',
  failedAttemptCount: 0,
  todayFileCount: 0,
  todayBytes: 0,
  totalFileCount: 0,
  totalBytes: 0,
};

const syncRecordFixture: DesktopSyncRecordDTO = {
  recordId: 'sync-1',
  desktopDeviceId: 'desktop-1',
  clientId: 'client-1',
  displayName: 'iPhone 15 Pro',
  fileKey: 'file-1',
  filename: 'IMG_0001.JPG',
  mediaType: 'image/jpeg',
  fileSize: 1024,
  status: 'completed',
  completedAt: '2026-06-15T00:00:00.000Z',
};

const accessRecordFixture: DesktopAccessRecordDTO = {
  recordId: 'access-1',
  desktopDeviceId: 'desktop-1',
  clientId: 'client-1',
  displayName: 'iPhone 15 Pro',
  resourceId: 'res-1',
  resourceKind: 'shared_folder',
  resourceName: 'Exports',
  action: 'list',
  result: 'ok',
  accessedAt: '2026-06-15T00:00:00.000Z',
};

const sharedResourceFixture: DesktopSharedResourceDTO = {
  resourceId: 'res-1',
  desktopDeviceId: 'desktop-1',
  kind: 'shared_folder',
  displayName: 'Exports',
  status: 'available',
  addedAt: '2026-06-15T00:00:00.000Z',
  downloadCount: 0,
};

const addedSharedResourceFixture: DesktopSharedResourceDTO = {
  ...sharedResourceFixture,
  resourceId: 'res-2',
};

const receivedLibraryFixture: ReceivedLibraryItemDTO = {
  resourceId: 'received-1',
  desktopDeviceId: 'desktop-1',
  clientId: 'client-1',
  displayName: 'iPhone 15 Pro',
  fileKey: 'file-1',
  filename: 'IMG_0001.JPG',
  mediaType: 'image/jpeg',
  fileSize: 1024,
  completedAt: '2026-06-15T00:00:00.000Z',
  shareStatus: 'not_shared',
};

const electronMockState = vi.hoisted(() => {
  const browserWindowInstance = {
    once: vi.fn((event: string, callback: () => void) => {
      if (event === 'ready-to-show') {
        callback();
      }
    }),
    show: vi.fn(),
    on: vi.fn(),
    destroy: vi.fn(),
    loadURL: vi.fn().mockResolvedValue(undefined),
    setTitleBarOverlay: vi.fn(),
  };
  return {
    BrowserWindow: vi.fn(function BrowserWindowMock() {
      return browserWindowInstance;
    }),
    fromWebContents: vi.fn(() => browserWindowInstance),
    browserWindowInstance,
  };
});

vi.mock('electron', () => ({
  app: {
    getName: () => 'Lynavo Drive',
    getPath: () => '/tmp/lynavo-drive-test',
    getVersion: () => '0.1.0',
  },
  BrowserWindow: Object.assign(electronMockState.BrowserWindow, {
    fromWebContents: electronMockState.fromWebContents,
  }),
  clipboard: { writeText: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      handlers.set(channel, handler);
    }),
  },
  shell: { openExternal: vi.fn(), openPath: vi.fn() },
}));

vi.mock('electron-log', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../../shared/platform-capabilities', () => platformCapabilitiesMock);

vi.mock('../sidecar-client', async () => {
  const actual = await vi.importActual<typeof import('../sidecar-client')>('../sidecar-client');
  return {
    ...actual,
    sidecarClient: {
      ...actual.sidecarClient,
      getHealth: vi.fn(),
      getDashboardSummary: vi.fn(),
      getDashboardDevices: vi.fn(),
      getDeviceFiles: vi.fn(),
      getDeviceDates: vi.fn(),
      getSettings: vi.fn(),
      updateSettings: vi.fn(),
      regenerateConnectionCode: vi.fn(),
      setConnectionCode: vi.fn(),
      getShareStatus: vi.fn(),
      validateShare: vi.fn(),
      getTransferActive: vi.fn(),
      getSharedList: vi.fn(),
      getConnectionDevices: vi.fn(),
      revokeConnectionDevice: vi.fn(),
      clearBlockedClient: vi.fn(),
      getManagedDevices: vi.fn(),
      unblockDevice: vi.fn(),
      getSyncRecords: vi.fn(),
      getAccessRecords: vi.fn(),
      getSharedResources: vi.fn(),
      addSharedResource: vi.fn(),
      removeSharedResource: vi.fn(),
      getReceivedLibrary: vi.fn(),
    },
  };
});

function compatibleHealth(capabilities?: { connectionDeviceManagement?: boolean }) {
  return {
    ok: true,
    service: 'lynavo-drive-sidecar',
    appCompatibilityVersion: APP_COMPATIBILITY_VERSION,
    ...(capabilities ? { capabilities } : {}),
  };
}

vi.mock('../diagnostics', () => ({
  exportDiagnostics: vi.fn(),
  getAppInfo: vi.fn(() => ({ name: 'Lynavo Drive', version: '0.1.0', buildNumber: '1' })),
}));

describe('registerIpcHandlers', () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    platformCapabilitiesMock.usesTitleBarOverlayControls.mockReset();
    platformCapabilitiesMock.usesTitleBarOverlayControls.mockReturnValue(true);
  });

  function registerWithManager() {
    const manager = {
      retryStart: vi.fn().mockResolvedValue(undefined),
    };
    registerIpcHandlers(manager as never);
    const handler = handlers.get(IPC.SIDECAR_REGENERATE_CODE);
    if (!handler) {
      throw new Error('missing regenerate connection code handler');
    }
    return { handler, manager };
  }

  it('regenerates connection code without revocation compatibility restart', async () => {
    vi.mocked(sidecarClient.regenerateConnectionCode).mockResolvedValue({ code: '123456' });

    const { handler, manager } = registerWithManager();

    await expect(handler()).resolves.toEqual({ code: '123456' });
    expect(manager.retryStart).not.toHaveBeenCalled();
    expect(sidecarClient.regenerateConnectionCode).toHaveBeenCalledTimes(1);
  });

  it('sets the connection code through IPC', async () => {
    vi.mocked(sidecarClient.setConnectionCode).mockResolvedValue({ code: '238416' });

    const manager = { retryStart: vi.fn() };
    registerIpcHandlers(manager as never);
    const handler = handlers.get(IPC.SIDECAR_SET_CONNECTION_CODE);
    if (!handler) {
      throw new Error('missing set connection code handler');
    }

    await expect(handler({}, '238416')).resolves.toEqual({ code: '238416' });
    expect(sidecarClient.setConnectionCode).toHaveBeenCalledWith('238416');
  });

  it('registers diagnostics export IPC with description payload', async () => {
    const manager = { retryStart: vi.fn(), getState: vi.fn() };
    vi.mocked(exportDiagnostics).mockResolvedValue('/tmp/lynavo-drive-diagnostics.zip');

    registerIpcHandlers(manager as never);
    const handler = handlers.get(IPC.SUPPORT_EXPORT_DIAGNOSTICS);

    await expect(handler?.(undefined, 'zh-Hans', 'Wi-Fi disconnected')).resolves.toBe(
      '/tmp/lynavo-drive-diagnostics.zip',
    );
    expect(exportDiagnostics).toHaveBeenCalledWith(manager, 'zh-Hans', 'Wi-Fi disconnected');
  });

  it('does not register stale support network IPC handlers', async () => {
    registerIpcHandlers({ retryStart: vi.fn() } as never);

    expect(handlers.has(['support:check-for', '-updates'].join(''))).toBe(false);
    expect(handlers.has(['support:upload', '-diagnostics'].join(''))).toBe(false);
  });

  it('registers only the public OSS IPC surface', async () => {
    registerIpcHandlers({ retryStart: vi.fn() } as never);

    expect([...handlers.keys()].sort()).toEqual(registeredIpcChannelsWithoutPowerSave);
  });

  it('updates the native title bar overlay while renderer modals are open', async () => {
    registerIpcHandlers({ retryStart: vi.fn() } as never);
    const handler = handlers.get('window:set-modal-overlay-active');

    await expect(handler?.({ sender: {} }, true)).resolves.toBeUndefined();

    expect(electronMockState.fromWebContents).toHaveBeenCalledWith({});
    expect(electronMockState.browserWindowInstance.setTitleBarOverlay).toHaveBeenCalledWith({
      color: '#7b7f82',
      symbolColor: '#eef4fa',
      height: 44,
    });
  });

  it('registers desktop-local management and resource IPC handlers', async () => {
    vi.mocked(sidecarClient.getConnectionDevices).mockResolvedValue({
      authorizedDevices: [],
      blockedClients: [],
      recentAttempts: [],
    });
    vi.mocked(sidecarClient.revokeConnectionDevice).mockResolvedValue({ ok: true });
    vi.mocked(sidecarClient.clearBlockedClient).mockResolvedValue({ ok: true });
    vi.mocked(sidecarClient.getManagedDevices).mockResolvedValue({
      items: [managedDeviceFixture],
    });
    vi.mocked(sidecarClient.unblockDevice).mockResolvedValue({ ok: true });
    vi.mocked(sidecarClient.getSyncRecords).mockResolvedValue({
      items: [syncRecordFixture],
    });
    vi.mocked(sidecarClient.getAccessRecords).mockResolvedValue({
      items: [accessRecordFixture],
    });
    vi.mocked(sidecarClient.getSharedResources).mockResolvedValue({
      items: [sharedResourceFixture],
    });
    vi.mocked(sidecarClient.addSharedResource).mockResolvedValue(addedSharedResourceFixture);
    vi.mocked(sidecarClient.removeSharedResource).mockResolvedValue({ ok: true });
    vi.mocked(sidecarClient.getReceivedLibrary).mockResolvedValue({
      items: [receivedLibraryFixture],
      page: 2,
      pageSize: 30,
      totalItems: 31,
      totalBytes: 1024,
      deviceStats: [
        {
          clientId: 'client-1',
          photoCount: 1,
          fileCount: 0,
          totalBytes: 1024,
        },
      ],
    });

    registerIpcHandlers({ retryStart: vi.fn() } as never);

    await expect(handlers.get(IPC.SIDECAR_CONNECTION_DEVICES)?.(undefined)).resolves.toEqual({
      authorizedDevices: [],
      blockedClients: [],
      recentAttempts: [],
    });
    await expect(
      handlers.get(IPC.SIDECAR_REVOKE_CONNECTION_DEVICE)?.(undefined, 'phone-a'),
    ).resolves.toEqual({ ok: true });
    await expect(
      handlers.get(IPC.SIDECAR_CLEAR_BLOCKED_CLIENT)?.(undefined, 'phone-a'),
    ).resolves.toEqual({ ok: true });
    await expect(handlers.get(IPC.SIDECAR_MANAGED_DEVICES)?.()).resolves.toEqual({
      items: [managedDeviceFixture],
    });
    await expect(
      handlers.get(IPC.SIDECAR_UNBLOCK_DEVICE)?.(undefined, 'client-1'),
    ).resolves.toEqual({ ok: true });
    await expect(handlers.get(IPC.SIDECAR_SYNC_RECORDS)?.()).resolves.toEqual({
      items: [syncRecordFixture],
    });
    await expect(handlers.get(IPC.SIDECAR_ACCESS_RECORDS)?.()).resolves.toEqual({
      items: [accessRecordFixture],
    });
    await expect(handlers.get(IPC.SIDECAR_SHARED_RESOURCES)?.()).resolves.toEqual({
      items: [sharedResourceFixture],
    });
    await expect(
      handlers.get(IPC.SIDECAR_ADD_SHARED_RESOURCE)?.(undefined, {
        kind: 'shared_folder',
        displayName: 'Exports',
        localPath: '/tmp/exports',
      }),
    ).resolves.toEqual(addedSharedResourceFixture);
    await expect(
      handlers.get(IPC.SIDECAR_REMOVE_SHARED_RESOURCE)?.(undefined, 'res-1'),
    ).resolves.toEqual({ ok: true });
    await expect(
      handlers.get(IPC.SIDECAR_RECEIVED_LIBRARY)?.(undefined, { page: 2, pageSize: 30 }),
    ).resolves.toEqual({
      items: [receivedLibraryFixture],
      page: 2,
      pageSize: 30,
      totalItems: 31,
      totalBytes: 1024,
      deviceStats: [
        {
          clientId: 'client-1',
          photoCount: 1,
          fileCount: 0,
          totalBytes: 1024,
        },
      ],
    });

    expect(sidecarClient.getConnectionDevices).toHaveBeenCalledTimes(1);
    expect(sidecarClient.revokeConnectionDevice).toHaveBeenCalledWith('phone-a');
    expect(sidecarClient.clearBlockedClient).toHaveBeenCalledWith('phone-a');
    expect(sidecarClient.unblockDevice).toHaveBeenCalledWith('client-1');
    expect(sidecarClient.addSharedResource).toHaveBeenCalledWith({
      kind: 'shared_folder',
      displayName: 'Exports',
      localPath: '/tmp/exports',
    });
    expect(sidecarClient.removeSharedResource).toHaveBeenCalledWith('res-1');
    expect(sidecarClient.getReceivedLibrary).toHaveBeenCalledWith({ page: 2, pageSize: 30 });
  });

  it('registers power-save preference IPC', async () => {
    const powerSave = {
      getState: vi.fn(() => ({
        preventSleepDuringTransfer: true,
        blockingSleep: false,
      })),
      setPreventSleepDuringTransfer: vi.fn((enabled: boolean) => ({
        preventSleepDuringTransfer: enabled,
        blockingSleep: enabled,
      })),
    };

    registerIpcHandlers({ retryStart: vi.fn() } as never, powerSave);

    await expect(handlers.get(IPC.POWER_SAVE_GET_STATE)?.()).resolves.toEqual({
      preventSleepDuringTransfer: true,
      blockingSleep: false,
    });
    await expect(
      handlers.get(IPC.POWER_SAVE_SET_PREVENT_SLEEP)?.(undefined, false),
    ).resolves.toEqual({
      preventSleepDuringTransfer: false,
      blockingSleep: false,
    });
    expect(powerSave.setPreventSleepDuringTransfer).toHaveBeenCalledWith(false);
  });
});
