import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DesktopAccessRecordDTO,
  DesktopManagedDeviceDTO,
  DesktopSyncRecordDTO,
} from '@lynavo-drive/contracts';
import { useManagementStore } from '../management-store';

const authorizedDevice: DesktopManagedDeviceDTO = {
  desktopDeviceId: 'desktop-1',
  clientId: 'client-abcdefghijklmnopqrstuvwxyz',
  clientIdShort: 'client-abcd',
  displayName: 'iPhone 15 Pro',
  platform: 'ios',
  lastIp: '192.168.1.20',
  authorizedAt: '2026-06-01T08:00:00Z',
  lastSeenAt: '2026-06-15T09:30:00Z',
  authorizationStatus: 'authorized',
  blockStatus: 'none',
  failedAttemptCount: 0,
  todayFileCount: 4,
  todayBytes: 4096,
  totalFileCount: 20,
  totalBytes: 8192,
};

const syncRecord: DesktopSyncRecordDTO = {
  recordId: 'sync-1',
  desktopDeviceId: 'desktop-1',
  clientId: 'client-1',
  displayName: 'iPhone 15 Pro',
  fileKey: '2026/06/15/img.heic',
  filename: 'IMG_0001.HEIC',
  mediaType: 'image/heic',
  fileSize: 12345,
  status: 'completed',
  completedAt: '2026-06-15T10:00:00Z',
};

const accessRecord: DesktopAccessRecordDTO = {
  recordId: 'access-1',
  desktopDeviceId: 'desktop-1',
  clientId: 'client-1',
  displayName: 'iPhone 15 Pro',
  resourceId: 'res-1',
  resourceKind: 'received_file',
  resourceName: 'IMG_0001.HEIC',
  action: 'download',
  result: 'ok',
  accessedAt: '2026-06-15T10:10:00Z',
};

function setSidecarMock(overrides: Partial<Window['electronAPI']['sidecar']> = {}) {
  const sidecar = {
    getManagedDevices: vi.fn().mockResolvedValue({ items: [authorizedDevice] }),
    unblockDevice: vi.fn().mockResolvedValue({ ok: true }),
    getSyncRecords: vi.fn().mockResolvedValue({ items: [syncRecord] }),
    getAccessRecords: vi.fn().mockResolvedValue({ items: [accessRecord] }),
    ...overrides,
  } as unknown as Window['electronAPI']['sidecar'];

  (window as Window & { electronAPI?: unknown }).electronAPI = {
    sidecar,
  } as unknown as Window['electronAPI'];
  return sidecar;
}

describe('management-store', () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, 'electronAPI');
    useManagementStore.setState({
      devices: [],
      syncRecords: [],
      accessRecords: [],
      devicesLoading: false,
      syncRecordsLoading: false,
      accessRecordsLoading: false,
      devicesError: null,
      syncRecordsError: null,
      accessRecordsError: null,
    });
  });

  it('loadDevices sets loading then devices', async () => {
    const sidecar = setSidecarMock();
    const pending = useManagementStore.getState().loadDevices();

    expect(useManagementStore.getState().devicesLoading).toBe(true);

    await pending;

    expect(sidecar.getManagedDevices).toHaveBeenCalledTimes(1);
    expect(useManagementStore.getState().devicesLoading).toBe(false);
    expect(useManagementStore.getState().devices).toEqual([authorizedDevice]);
    expect(useManagementStore.getState().devicesError).toBeNull();
  });

  it('failed load sets error and does not fake empty success', async () => {
    setSidecarMock({
      getManagedDevices: vi.fn().mockRejectedValue(new Error('sidecar offline')),
    });
    useManagementStore.setState({ devices: [authorizedDevice] });

    await useManagementStore.getState().loadDevices();

    expect(useManagementStore.getState().devices).toEqual([authorizedDevice]);
    expect(useManagementStore.getState().devicesLoading).toBe(false);
    expect(useManagementStore.getState().devicesError).toBe('sidecar offline');
  });

  it('unblockDevice calls bridge then reloads devices', async () => {
    const sidecar = setSidecarMock({
      getManagedDevices: vi
        .fn()
        .mockResolvedValueOnce({ items: [authorizedDevice] })
        .mockResolvedValueOnce({
          items: [{ ...authorizedDevice, blockStatus: 'none', failedAttemptCount: 0 }],
        }),
    });

    await useManagementStore.getState().unblockDevice(authorizedDevice.clientId);

    expect(sidecar.unblockDevice).toHaveBeenCalledWith(authorizedDevice.clientId);
    expect(sidecar.getManagedDevices).toHaveBeenCalledTimes(1);
    expect(useManagementStore.getState().devices[0]?.blockStatus).toBe('none');
  });

  it('unblockDevice sets visible error and does not reload when bridge fails', async () => {
    const sidecar = setSidecarMock({
      unblockDevice: vi.fn().mockRejectedValue(new Error('unblock denied')),
      getManagedDevices: vi.fn().mockResolvedValue({ items: [authorizedDevice] }),
    });
    useManagementStore.setState({ devices: [authorizedDevice] });

    await useManagementStore.getState().unblockDevice(authorizedDevice.clientId);

    expect(sidecar.unblockDevice).toHaveBeenCalledWith(authorizedDevice.clientId);
    expect(sidecar.getManagedDevices).not.toHaveBeenCalled();
    expect(useManagementStore.getState().devices).toEqual([authorizedDevice]);
    expect(useManagementStore.getState().devicesError).toBe('unblock denied');
  });

  it('loadRecords scopes sync and access records', async () => {
    const sidecar = setSidecarMock();

    await useManagementStore.getState().loadSyncRecords();
    await useManagementStore.getState().loadAccessRecords();

    expect(sidecar.getSyncRecords).toHaveBeenCalledTimes(1);
    expect(sidecar.getAccessRecords).toHaveBeenCalledTimes(1);
    expect(useManagementStore.getState().syncRecords).toEqual([syncRecord]);
    expect(useManagementStore.getState().accessRecords).toEqual([accessRecord]);
    expect(useManagementStore.getState().syncRecordsError).toBeNull();
    expect(useManagementStore.getState().accessRecordsError).toBeNull();
  });
});
