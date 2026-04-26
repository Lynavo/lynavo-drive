import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  resetPendingOfflineStatusDebounceForTests,
  useDashboardStore,
} from '../dashboard-store';
import type { DashboardDeviceDTO, DashboardSummaryDTO } from '@syncflow/contracts';
import { useSidecarRuntimeStore } from '../sidecar-runtime-store';

describe('dashboard-store', () => {
  beforeEach(() => {
    resetPendingOfflineStatusDebounceForTests();
    vi.useRealTimers();
    Reflect.deleteProperty(window, 'electronAPI');
    useSidecarRuntimeStore.setState((state) => ({
      runtime: {
        ...state.runtime,
        status: 'healthy',
        message: null,
      },
    }));
    useDashboardStore.setState({
      devices: [
        {
          deviceId: 'd1',
          displayName: 'iPhone 15 Pro',
          clientName: 'iPhone 15 Pro',
          platform: 'ios',
          ip: '192.168.1.201',
          status: 'transferring',
          todayFileCount: 12,
          todayBytes: 24.5 * 1024 ** 3,
          storageLeft: '1.2 TB',
          storagePath: '/Users/alice/SyncFlow',
          devicePath: '/Users/alice/SyncFlow/iPhone_15_Pro',
          currentFile: { filename: 'DJI_0421_4K_RAW.mp4', progress: 67, fileSize: 3_435_973_837 },
        },
        {
          deviceId: 'd2',
          displayName: 'Galaxy S24 Ultra',
          clientName: 'Galaxy S24 Ultra',
          platform: 'android',
          ip: '192.168.1.205',
          status: 'connected_idle',
          todayFileCount: 8,
          todayBytes: 16.3 * 1024 ** 3,
          storageLeft: '860 GB',
          storagePath: '/Users/alice/SyncFlow',
          devicePath: '/Users/alice/SyncFlow/GalaxyS24',
        },
        {
          deviceId: 'd4',
          displayName: 'GoPro Hero 12',
          clientName: 'GoPro Hero 12',
          platform: 'other',
          ip: '192.168.1.188',
          status: 'offline',
          todayFileCount: 0,
          todayBytes: 0,
          storageLeft: '--',
          storagePath: '/Users/alice/SyncFlow',
          devicePath: '/Users/alice/SyncFlow/GoPro12',
        },
      ],
      diskWarningDismissed: false,
    });
  });

  it('sorts devices: transferring > connected_idle > offline', () => {
    const devices = useDashboardStore.getState().devices;
    expect(devices[0].status).toBe('transferring');
    expect(devices[1].status).toBe('connected_idle');
    expect(devices[2].status).toBe('offline');
  });

  it('sorts devices correctly when updated with new list', () => {
    const unsorted: DashboardDeviceDTO[] = [
      {
        deviceId: 'x1',
        displayName: 'Offline Device',
        clientName: 'Offline Device',
        platform: 'ios',
        ip: '10.0.0.1',
        status: 'offline',
        todayFileCount: 0,
        todayBytes: 0,
        storageLeft: '--',
        storagePath: '/tmp',
        devicePath: '/tmp/Offline Device',
      },
      {
        deviceId: 'x2',
        displayName: 'Active Device',
        clientName: 'Active Device',
        platform: 'android',
        ip: '10.0.0.2',
        status: 'transferring',
        todayFileCount: 5,
        todayBytes: 1024,
        storageLeft: '500 GB',
        storagePath: '/tmp',
        devicePath: '/tmp/Active Device',
        currentFile: { filename: 'test.mp4', progress: 50, fileSize: 100 },
      },
    ];
    useDashboardStore.getState().updateDevices(unsorted);
    const devices = useDashboardStore.getState().devices;
    expect(devices[0].deviceId).toBe('x2');
    expect(devices[1].deviceId).toBe('x1');
  });

  it('dismisses disk warning', () => {
    expect(useDashboardStore.getState().diskWarningDismissed).toBe(false);
    useDashboardStore.getState().dismissDiskWarning();
    expect(useDashboardStore.getState().diskWarningDismissed).toBe(true);
  });

  it('updates summary', () => {
    const newSummary: DashboardSummaryDTO = {
      todayUploadCount: 100,
      todayOccupiedBytes: 50 * 1024 ** 3,
      remainingBytes: 500 * 1024 ** 3,
      isDiskLow: true,
    };
    useDashboardStore.getState().updateSummary(newSummary);
    expect(useDashboardStore.getState().summary).toEqual(newSummary);
  });

  it('updateDeviceProgress updates progress for matching device', () => {
    useDashboardStore.getState().updateDeviceProgress('d1', 'file-key-1', 85);
    const d1 = useDashboardStore.getState().devices.find((d) => d.deviceId === 'd1');
    expect(d1?.currentFile?.progress).toBe(85);
    expect(d1?.currentFile?.filename).toBe('DJI_0421_4K_RAW.mp4');
  });

  it('updateDeviceProgress backfills currentFile when API snapshot is stale', () => {
    useDashboardStore.getState().updateDeviceProgress('d2', 'file-key-2', 50);
    const d2 = useDashboardStore.getState().devices.find((d) => d.deviceId === 'd2');
    expect(d2?.currentFile).toEqual({
      filename: 'file-key-2',
      progress: 50,
      fileSize: 0,
    });
  });

  it('updateDeviceProgress is no-op for unknown device', () => {
    const before = useDashboardStore.getState().devices;
    useDashboardStore.getState().updateDeviceProgress('unknown', 'fk', 99);
    const after = useDashboardStore.getState().devices;
    expect(after).toEqual(before);
  });

  it('updateDeviceStatus changes status and re-sorts', () => {
    // d4 starts as offline (last), promote it to transferring
    useDashboardStore.getState().updateDeviceStatus('d4', 'transferring');
    const devices = useDashboardStore.getState().devices;
    // Both d1 and d4 are now transferring, so they should be first
    expect(devices[0].status).toBe('transferring');
    expect(devices[1].status).toBe('transferring');
    expect(devices[2].status).toBe('connected_idle');
    const d4 = devices.find((d) => d.deviceId === 'd4');
    expect(d4?.status).toBe('transferring');
  });

  it('updateDeviceStatus to offline moves device to end', () => {
    vi.useFakeTimers();

    useDashboardStore.getState().updateDeviceStatus('d1', 'offline');

    let devices = useDashboardStore.getState().devices;
    expect(devices[0].status).toBe('transferring');
    expect(devices[1].status).toBe('connected_idle');

    vi.advanceTimersByTime(3_000);

    devices = useDashboardStore.getState().devices;
    expect(devices[0].status).toBe('connected_idle');
    expect(devices[1].status).toBe('offline');
    expect(devices[2].status).toBe('offline');
  });

  it('cancels a pending offline update when the device reconnects before debounce expires', () => {
    vi.useFakeTimers();

    useDashboardStore.getState().updateDeviceStatus('d2', 'offline');
    useDashboardStore.getState().updateDeviceStatus('d2', 'connected_idle');

    vi.advanceTimersByTime(3_000);

    const d2 = useDashboardStore.getState().devices.find((d) => d.deviceId === 'd2');

    expect(d2?.status).toBe('connected_idle');
  });

  it('cancels a pending offline update when a fresh device snapshot arrives', () => {
    vi.useFakeTimers();

    useDashboardStore.getState().updateDeviceStatus('d2', 'offline');
    useDashboardStore.getState().updateDevices([
      {
        deviceId: 'd4',
        displayName: 'GoPro Hero 12',
        clientName: 'GoPro Hero 12',
        platform: 'other',
        ip: '192.168.1.188',
        status: 'offline',
        todayFileCount: 0,
        todayBytes: 0,
        storageLeft: '--',
        storagePath: '/Users/alice/SyncFlow',
        devicePath: '/Users/alice/SyncFlow/GoPro12',
      },
      {
        deviceId: 'd1',
        displayName: 'iPhone 15 Pro',
        clientName: 'iPhone 15 Pro',
        platform: 'ios',
        ip: '192.168.1.201',
        status: 'transferring',
        todayFileCount: 12,
        todayBytes: 24.5 * 1024 ** 3,
        storageLeft: '1.2 TB',
        storagePath: '/Users/alice/SyncFlow',
        devicePath: '/Users/alice/SyncFlow/iPhone_15_Pro',
        currentFile: { filename: 'DJI_0421_4K_RAW.mp4', progress: 67, fileSize: 3_435_973_837 },
      },
      {
        deviceId: 'd2',
        displayName: 'Galaxy S24 Ultra',
        clientName: 'Galaxy S24 Ultra',
        platform: 'android',
        ip: '192.168.1.205',
        status: 'connected_idle',
        todayFileCount: 8,
        todayBytes: 16.3 * 1024 ** 3,
        storageLeft: '860 GB',
        storagePath: '/Users/alice/SyncFlow',
        devicePath: '/Users/alice/SyncFlow/GalaxyS24',
      },
    ]);

    vi.advanceTimersByTime(3_000);

    const d2 = useDashboardStore.getState().devices.find((d) => d.deviceId === 'd2');

    expect(d2?.status).toBe('connected_idle');
  });

  it('keeps the previous connected status when fetchDashboard briefly returns offline', async () => {
    vi.useFakeTimers();

    (window as Window & { electronAPI?: unknown }).electronAPI = {
      sidecar: {
        getDashboardSummary: vi.fn().mockResolvedValue(null),
        getDashboardDevices: vi.fn().mockResolvedValue([
          {
            deviceId: 'd4',
            displayName: 'GoPro Hero 12',
            clientName: 'GoPro Hero 12',
            platform: 'other',
            ip: '192.168.1.188',
            status: 'offline',
            todayFileCount: 0,
            todayBytes: 0,
            storageLeft: '--',
            storagePath: '/Users/alice/SyncFlow',
            devicePath: '/Users/alice/SyncFlow/GoPro12',
          },
          {
            deviceId: 'd1',
            displayName: 'iPhone 15 Pro',
            clientName: 'iPhone 15 Pro',
            platform: 'ios',
            ip: '192.168.1.201',
            status: 'offline',
            todayFileCount: 12,
            todayBytes: 24.5 * 1024 ** 3,
            storageLeft: '1.2 TB',
            storagePath: '/Users/alice/SyncFlow',
            devicePath: '/Users/alice/SyncFlow/iPhone_15_Pro',
          },
          {
            deviceId: 'd2',
            displayName: 'Galaxy S24 Ultra',
            clientName: 'Galaxy S24 Ultra',
            platform: 'android',
            ip: '192.168.1.205',
            status: 'offline',
            todayFileCount: 8,
            todayBytes: 16.3 * 1024 ** 3,
            storageLeft: '860 GB',
            storagePath: '/Users/alice/SyncFlow',
            devicePath: '/Users/alice/SyncFlow/GalaxyS24',
          },
        ]),
      },
    } as unknown as Window['electronAPI'];

    await useDashboardStore.getState().fetchDashboard();

    let d1 = useDashboardStore.getState().devices.find((d) => d.deviceId === 'd1');
    let d2 = useDashboardStore.getState().devices.find((d) => d.deviceId === 'd2');

    expect(d1?.status).toBe('transferring');
    expect(d2?.status).toBe('connected_idle');

    vi.advanceTimersByTime(3_000);

    d1 = useDashboardStore.getState().devices.find((d) => d.deviceId === 'd1');
    d2 = useDashboardStore.getState().devices.find((d) => d.deviceId === 'd2');

    expect(d1?.status).toBe('offline');
    expect(d2?.status).toBe('offline');
  });

  it('cancels a pending offline snapshot when fetchDashboard recovers before debounce expires', async () => {
    vi.useFakeTimers();

    const getDashboardDevices = vi
      .fn()
      .mockResolvedValueOnce([
        {
          deviceId: 'd4',
          displayName: 'GoPro Hero 12',
          clientName: 'GoPro Hero 12',
          platform: 'other',
          ip: '192.168.1.188',
          status: 'offline',
          todayFileCount: 0,
          todayBytes: 0,
          storageLeft: '--',
          storagePath: '/Users/alice/SyncFlow',
          devicePath: '/Users/alice/SyncFlow/GoPro12',
        },
        {
          deviceId: 'd1',
          displayName: 'iPhone 15 Pro',
          clientName: 'iPhone 15 Pro',
          platform: 'ios',
          ip: '192.168.1.201',
          status: 'offline',
          todayFileCount: 12,
          todayBytes: 24.5 * 1024 ** 3,
          storageLeft: '1.2 TB',
          storagePath: '/Users/alice/SyncFlow',
          devicePath: '/Users/alice/SyncFlow/iPhone_15_Pro',
        },
        {
          deviceId: 'd2',
          displayName: 'Galaxy S24 Ultra',
          clientName: 'Galaxy S24 Ultra',
          platform: 'android',
          ip: '192.168.1.205',
          status: 'offline',
          todayFileCount: 8,
          todayBytes: 16.3 * 1024 ** 3,
          storageLeft: '860 GB',
          storagePath: '/Users/alice/SyncFlow',
          devicePath: '/Users/alice/SyncFlow/GalaxyS24',
        },
      ])
      .mockResolvedValueOnce([
        {
          deviceId: 'd4',
          displayName: 'GoPro Hero 12',
          clientName: 'GoPro Hero 12',
          platform: 'other',
          ip: '192.168.1.188',
          status: 'offline',
          todayFileCount: 0,
          todayBytes: 0,
          storageLeft: '--',
          storagePath: '/Users/alice/SyncFlow',
          devicePath: '/Users/alice/SyncFlow/GoPro12',
        },
        {
          deviceId: 'd1',
          displayName: 'iPhone 15 Pro',
          clientName: 'iPhone 15 Pro',
          platform: 'ios',
          ip: '192.168.1.201',
          status: 'connected_idle',
          todayFileCount: 12,
          todayBytes: 24.5 * 1024 ** 3,
          storageLeft: '1.2 TB',
          storagePath: '/Users/alice/SyncFlow',
          devicePath: '/Users/alice/SyncFlow/iPhone_15_Pro',
        },
        {
          deviceId: 'd2',
          displayName: 'Galaxy S24 Ultra',
          clientName: 'Galaxy S24 Ultra',
          platform: 'android',
          ip: '192.168.1.205',
          status: 'connected_idle',
          todayFileCount: 8,
          todayBytes: 16.3 * 1024 ** 3,
          storageLeft: '860 GB',
          storagePath: '/Users/alice/SyncFlow',
          devicePath: '/Users/alice/SyncFlow/GalaxyS24',
        },
      ]);

    (window as Window & { electronAPI?: unknown }).electronAPI = {
      sidecar: {
        getDashboardSummary: vi.fn().mockResolvedValue(null),
        getDashboardDevices,
      },
    } as unknown as Window['electronAPI'];

    await useDashboardStore.getState().fetchDashboard();
    await useDashboardStore.getState().fetchDashboard();

    vi.advanceTimersByTime(3_000);

    const d1 = useDashboardStore.getState().devices.find((d) => d.deviceId === 'd1');
    const d2 = useDashboardStore.getState().devices.find((d) => d.deviceId === 'd2');

    expect(d1?.status).toBe('transferring');
    expect(d2?.status).toBe('connected_idle');
  });

  it('clears stale currentFile when device leaves transferring state', () => {
    useDashboardStore.getState().updateDeviceStatus('d1', 'connected_idle');

    const d1 = useDashboardStore.getState().devices.find((d) => d.deviceId === 'd1');

    expect(d1?.status).toBe('connected_idle');
    expect(d1?.currentFile).toBeUndefined();
  });

  it('skips dashboard fetch until sidecar is healthy', async () => {
    const getDashboardSummary = vi.fn();
    const getDashboardDevices = vi.fn();
    (window as Window & { electronAPI?: unknown }).electronAPI = {
      sidecar: {
        getDashboardSummary,
        getDashboardDevices,
      },
    } as unknown as Window['electronAPI'];

    useSidecarRuntimeStore.setState((state) => ({
      runtime: {
        ...state.runtime,
        status: 'starting',
      },
    }));

    await useDashboardStore.getState().fetchDashboard();

    expect(getDashboardSummary).not.toHaveBeenCalled();
    expect(getDashboardDevices).not.toHaveBeenCalled();
  });

  it('fetches dashboard when sidecar is healthy', async () => {
    const summary: DashboardSummaryDTO = {
      todayUploadCount: 3,
      todayOccupiedBytes: 2048,
      remainingBytes: 4096,
      isDiskLow: false,
    };
    const devices: DashboardDeviceDTO[] = [
      {
        deviceId: 'fresh-1',
        displayName: 'Fresh Device',
        clientName: 'Fresh Device',
        platform: 'ios',
        ip: '10.0.0.9',
        status: 'connected_idle',
        todayFileCount: 3,
        todayBytes: 2048,
        storageLeft: '4 GB',
        storagePath: '/tmp',
        devicePath: '/tmp/Fresh Device',
      },
    ];

    (window as Window & { electronAPI?: unknown }).electronAPI = {
      sidecar: {
        getDashboardSummary: vi.fn().mockResolvedValue(summary),
        getDashboardDevices: vi.fn().mockResolvedValue(devices),
      },
    } as unknown as Window['electronAPI'];

    await useDashboardStore.getState().fetchDashboard();

    expect(useDashboardStore.getState().summary).toEqual(summary);
    expect(useDashboardStore.getState().devices).toEqual(devices);
  });

  it('reports storage unavailable without treating it as a network failure', async () => {
    useDashboardStore.setState({ devices: [] });
    (window as Window & { electronAPI?: unknown }).electronAPI = {
      sidecar: {
        getDashboardSummary: vi
          .fn()
          .mockRejectedValue(
            new Error('Sidecar GET /dashboard/summary: 503 {"error":"storage path unavailable"}'),
          ),
        getDashboardDevices: vi.fn().mockResolvedValue([]),
      },
    } as unknown as Window['electronAPI'];

    await useDashboardStore.getState().fetchDashboard();

    expect(useDashboardStore.getState().error).toBe(
      '接收目录不可用，请重新选择或恢复文件夹',
    );
  });

  it('does not preserve a stale 100 percent transfer over an idle snapshot', async () => {
    useDashboardStore.getState().updateDevices([
      {
        deviceId: 'd1',
        displayName: 'iPhone 15 Pro',
        clientName: 'iPhone 15 Pro',
        platform: 'ios',
        ip: '192.168.1.201',
        status: 'transferring',
        todayFileCount: 12,
        todayBytes: 24.5 * 1024 ** 3,
        storageLeft: '1.2 TB',
        storagePath: '/Users/alice/SyncFlow',
        devicePath: '/Users/alice/SyncFlow/iPhone_15_Pro',
        currentFile: {
          filename: 'DJI_0421_4K_RAW.mp4',
          progress: 100,
          fileSize: 3_435_973_837,
        },
      },
    ]);

    const devices: DashboardDeviceDTO[] = [
      {
        deviceId: 'd1',
        displayName: 'iPhone 15 Pro',
        clientName: 'iPhone 15 Pro',
        platform: 'ios',
        ip: '192.168.1.201',
        status: 'connected_idle',
        todayFileCount: 12,
        todayBytes: 24.5 * 1024 ** 3,
        storageLeft: '1.2 TB',
        storagePath: '/Users/alice/SyncFlow',
        devicePath: '/Users/alice/SyncFlow/iPhone_15_Pro',
      },
    ];

    (window as Window & { electronAPI?: unknown }).electronAPI = {
      sidecar: {
        getDashboardSummary: vi.fn().mockResolvedValue(null),
        getDashboardDevices: vi.fn().mockResolvedValue(devices),
      },
    } as unknown as Window['electronAPI'];

    await useDashboardStore.getState().fetchDashboard();

    expect(useDashboardStore.getState().devices).toEqual(devices);
  });

  it('still preserves an in-flight transfer when the snapshot lags behind', async () => {
    useDashboardStore.getState().updateDevices([
      {
        deviceId: 'd1',
        displayName: 'iPhone 15 Pro',
        clientName: 'iPhone 15 Pro',
        platform: 'ios',
        ip: '192.168.1.201',
        status: 'transferring',
        todayFileCount: 12,
        todayBytes: 24.5 * 1024 ** 3,
        storageLeft: '1.2 TB',
        storagePath: '/Users/alice/SyncFlow',
        devicePath: '/Users/alice/SyncFlow/iPhone_15_Pro',
        currentFile: {
          filename: 'DJI_0421_4K_RAW.mp4',
          progress: 87,
          fileSize: 3_435_973_837,
        },
      },
    ]);

    const devices: DashboardDeviceDTO[] = [
      {
        deviceId: 'd1',
        displayName: 'iPhone 15 Pro',
        clientName: 'iPhone 15 Pro',
        platform: 'ios',
        ip: '192.168.1.201',
        status: 'connected_idle',
        todayFileCount: 12,
        todayBytes: 24.5 * 1024 ** 3,
        storageLeft: '1.2 TB',
        storagePath: '/Users/alice/SyncFlow',
        devicePath: '/Users/alice/SyncFlow/iPhone_15_Pro',
      },
    ];

    (window as Window & { electronAPI?: unknown }).electronAPI = {
      sidecar: {
        getDashboardSummary: vi.fn().mockResolvedValue(null),
        getDashboardDevices: vi.fn().mockResolvedValue(devices),
      },
    } as unknown as Window['electronAPI'];

    await useDashboardStore.getState().fetchDashboard();

    expect(useDashboardStore.getState().devices).toEqual([
      {
        ...devices[0],
        status: 'transferring',
        currentFile: {
          filename: 'DJI_0421_4K_RAW.mp4',
          progress: 87,
          fileSize: 3_435_973_837,
        },
      },
    ]);
  });

  it('does not let a transferring snapshot reset realtime progress to zero', async () => {
    useDashboardStore.getState().updateDevices([
      {
        deviceId: 'd1',
        displayName: 'iPhone 15 Pro',
        clientName: 'iPhone 15 Pro',
        platform: 'ios',
        ip: '192.168.1.201',
        status: 'transferring',
        todayFileCount: 12,
        todayBytes: 24.5 * 1024 ** 3,
        storageLeft: '1.2 TB',
        storagePath: '/Users/alice/SyncFlow',
        devicePath: '/Users/alice/SyncFlow/iPhone_15_Pro',
        currentFile: {
          filename: 'DJI_0421_4K_RAW.mp4',
          progress: 18,
          fileSize: 3_435_973_837,
        },
      },
    ]);

    const devices: DashboardDeviceDTO[] = [
      {
        deviceId: 'd1',
        displayName: 'iPhone 15 Pro',
        clientName: 'iPhone 15 Pro',
        platform: 'ios',
        ip: '192.168.1.201',
        status: 'transferring',
        todayFileCount: 12,
        todayBytes: 24.5 * 1024 ** 3,
        storageLeft: '1.2 TB',
        storagePath: '/Users/alice/SyncFlow',
        devicePath: '/Users/alice/SyncFlow/iPhone_15_Pro',
        currentFile: {
          filename: 'DJI_0421_4K_RAW.mp4',
          progress: 0,
          fileSize: 0,
        },
      },
    ];

    (window as Window & { electronAPI?: unknown }).electronAPI = {
      sidecar: {
        getDashboardSummary: vi.fn().mockResolvedValue(null),
        getDashboardDevices: vi.fn().mockResolvedValue(devices),
      },
    } as unknown as Window['electronAPI'];

    await useDashboardStore.getState().fetchDashboard();

    expect(useDashboardStore.getState().devices[0]?.currentFile).toEqual({
      filename: 'DJI_0421_4K_RAW.mp4',
      progress: 18,
      fileSize: 3_435_973_837,
    });
  });
});
