import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useDirectoryStore } from '../directory-store';
import { useSidecarRuntimeStore } from '../sidecar-runtime-store';
import type {
  DashboardDeviceDTO,
  DeviceFileLedgerPageDTO,
  SharedDirectoryDTO,
} from '@syncflow/contracts';

describe('directory-store', () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, 'electronAPI');
    useDirectoryStore.setState(useDirectoryStore.getInitialState());
    useSidecarRuntimeStore.setState((state) => ({
      runtime: {
        ...state.runtime,
        status: 'healthy',
        message: null,
      },
    }));
  });

  it('has correct initial state', () => {
    const state = useDirectoryStore.getState();
    expect(state.activeTab).toBe('received');
    expect(state.receivedFiles).toEqual([]);
    expect(state.sharedFiles).toEqual([]);
    expect(state.loading).toBe(false);
    expect(state.sortField).toBe('completedAt');
    expect(state.sortDirection).toBe('desc');
  });

  it('setTab switches active tab', () => {
    useDirectoryStore.getState().setTab('shared');
    expect(useDirectoryStore.getState().activeTab).toBe('shared');
  });

  it('setTab switches back to received', () => {
    useDirectoryStore.getState().setTab('shared');
    useDirectoryStore.getState().setTab('received');
    expect(useDirectoryStore.getState().activeTab).toBe('received');
  });

  it('toggleSort sets new field with desc direction', () => {
    // Initial field is 'completedAt', toggling to 'size' should reset direction to desc
    useDirectoryStore.getState().toggleSort('size');
    const state = useDirectoryStore.getState();
    expect(state.sortField).toBe('size');
    expect(state.sortDirection).toBe('desc');
  });

  it('toggleSort flips direction when same field toggled again', () => {
    useDirectoryStore.getState().toggleSort('size');
    expect(useDirectoryStore.getState().sortDirection).toBe('desc');

    useDirectoryStore.getState().toggleSort('size');
    expect(useDirectoryStore.getState().sortDirection).toBe('asc');
  });

  it('toggleSort resets direction to desc when switching to different field', () => {
    // Start on completedAt (default), toggle to size, then toggle size to get asc
    useDirectoryStore.getState().toggleSort('size');
    useDirectoryStore.getState().toggleSort('size'); // now asc
    expect(useDirectoryStore.getState().sortDirection).toBe('asc');

    // Switch back to completedAt — should reset to desc
    useDirectoryStore.getState().toggleSort('completedAt');
    expect(useDirectoryStore.getState().sortField).toBe('completedAt');
    expect(useDirectoryStore.getState().sortDirection).toBe('desc');
  });

  it('fetchReceivedFiles merges device name into file entries', async () => {
    const mockDevices: DashboardDeviceDTO[] = [
      {
        deviceId: 'dev-1',
        displayName: 'iPhone 15',
        clientName: 'iPhone 15',
        platform: 'ios',
        ip: '192.168.1.20',
        status: 'connected_idle',
        todayFileCount: 2,
        todayBytes: 5000,
        storagePath: '/tmp/dev-1',
        devicePath: '/tmp/dev-1',
        storageLeft: '10GB',
      },
    ];

    const mockFilePage: DeviceFileLedgerPageDTO = {
      items: [
        {
          fileKey: 'fk-1',
          originalFilename: 'sunset.jpg',
          mediaType: 'image/jpeg',
          fileSize: 2048,
          completedAt: '2026-04-10T09:00:00Z',
          activeTransmissionMs: 300,
          finalPath: '/tmp/dev-1/sunset.jpg',
        },
      ],
      page: 1,
      pageSize: 500,
      totalItems: 1,
      totalBytes: 2048,
      totalActiveTransmissionMs: 300,
    };

    (window as Window & { electronAPI?: unknown }).electronAPI = {
      sidecar: {
        getDashboardDevices: vi.fn().mockResolvedValue(mockDevices),
        getDeviceDates: vi.fn().mockResolvedValue({ dates: ['2026-04-10'] }),
        getDeviceFiles: vi.fn().mockResolvedValue(mockFilePage),
      },
    } as unknown as Window['electronAPI'];

    await useDirectoryStore.getState().fetchReceivedFiles();

    const state = useDirectoryStore.getState();
    expect(state.loading).toBe(false);
    expect(state.receivedFiles).toHaveLength(1);
    expect(state.receivedFiles[0].deviceName).toBe('iPhone 15');
    expect(state.receivedFiles[0].deviceId).toBe('dev-1');
    expect(state.receivedFiles[0].originalFilename).toBe('sunset.jpg');
    expect(state.receivedTotalBytes).toBe(2048);
  });

  it('fetchReceivedFiles skips when sidecar is not healthy', async () => {
    const getDashboardDevices = vi.fn();
    (window as Window & { electronAPI?: unknown }).electronAPI = {
      sidecar: { getDashboardDevices },
    } as unknown as Window['electronAPI'];

    useSidecarRuntimeStore.setState((state) => ({
      runtime: { ...state.runtime, status: 'starting' },
    }));

    await useDirectoryStore.getState().fetchReceivedFiles();

    expect(getDashboardDevices).not.toHaveBeenCalled();
    expect(useDirectoryStore.getState().receivedFiles).toEqual([]);
  });

  it('fetchSharedFiles populates shared file entries', async () => {
    const mockSharedDir: SharedDirectoryDTO = {
      path: '/Users/alice/SyncFlow/shared',
      files: [
        {
          name: 'notes.pdf',
          path: '/Users/alice/SyncFlow/shared/notes.pdf',
          type: 'document',
          size: 4096,
          modifiedAt: '2026-04-09T15:00:00Z',
          isDirectory: false,
        },
        {
          name: 'subdir',
          path: '/Users/alice/SyncFlow/shared/subdir',
          type: 'other',
          size: 0,
          modifiedAt: '2026-04-09T14:00:00Z',
          isDirectory: true,
        },
      ],
      totalCount: 2,
    };

    (window as Window & { electronAPI?: unknown }).electronAPI = {
      sidecar: {
        getSharedList: vi.fn().mockResolvedValue(mockSharedDir),
      },
    } as unknown as Window['electronAPI'];

    await useDirectoryStore.getState().fetchSharedFiles();

    const state = useDirectoryStore.getState();
    // Directories are filtered out
    expect(state.sharedFiles).toHaveLength(1);
    expect(state.sharedFiles[0].name).toBe('notes.pdf');
    expect(state.sharedFiles[0].size).toBe(4096);
  });

  it('fetchSharedFiles skips when sidecar is not healthy', async () => {
    const getSharedList = vi.fn();
    (window as Window & { electronAPI?: unknown }).electronAPI = {
      sidecar: { getSharedList },
    } as unknown as Window['electronAPI'];

    useSidecarRuntimeStore.setState((state) => ({
      runtime: { ...state.runtime, status: 'starting' },
    }));

    await useDirectoryStore.getState().fetchSharedFiles();

    expect(getSharedList).not.toHaveBeenCalled();
  });

  it('fetchSharedFiles sets empty array and sharedError on error', async () => {
    (window as Window & { electronAPI?: unknown }).electronAPI = {
      sidecar: {
        getSharedList: vi.fn().mockRejectedValue(new Error('network error')),
      },
    } as unknown as Window['electronAPI'];

    // Pre-populate to verify it gets cleared
    useDirectoryStore.setState({
      sharedFiles: [{ name: 'old.txt', path: '/old.txt', type: 'other', size: 1, modifiedAt: '' }],
    });

    await useDirectoryStore.getState().fetchSharedFiles();

    expect(useDirectoryStore.getState().sharedFiles).toEqual([]);
    expect(useDirectoryStore.getState().sharedError).toBe('加载共享文件列表失败');
  });

  it('fetchSharedFiles uses storage unavailable copy when the directory is missing', async () => {
    (window as Window & { electronAPI?: unknown }).electronAPI = {
      sidecar: {
        getSharedList: vi
          .fn()
          .mockRejectedValue(new Error('Sidecar GET /shared/list: 503 {"error":"storage path unavailable"}')),
      },
    } as unknown as Window['electronAPI'];

    await useDirectoryStore.getState().fetchSharedFiles();

    expect(useDirectoryStore.getState().sharedFiles).toEqual([]);
    expect(useDirectoryStore.getState().sharedError).toBe(
      '共享目录不可用，请重新选择或恢复文件夹',
    );
  });

  it('fetchReceivedFiles uses storage unavailable copy when the receive directory is missing', async () => {
    (window as Window & { electronAPI?: unknown }).electronAPI = {
      sidecar: {
        getDashboardDevices: vi
          .fn()
          .mockRejectedValue(new Error('Sidecar GET /dashboard/devices: 503 {"error":"storage path unavailable"}')),
      },
    } as unknown as Window['electronAPI'];

    await useDirectoryStore.getState().fetchReceivedFiles();

    expect(useDirectoryStore.getState().receivedError).toBe(
      '接收目录不可用，请重新选择或恢复文件夹',
    );
  });

  it('fetchSharedFiles clears sharedError on success', async () => {
    const mockSharedDir: SharedDirectoryDTO = {
      path: '',
      files: [],
      totalCount: 0,
    };

    (window as Window & { electronAPI?: unknown }).electronAPI = {
      sidecar: {
        getSharedList: vi.fn().mockResolvedValue(mockSharedDir),
      },
    } as unknown as Window['electronAPI'];

    // Pre-set an error to verify it gets cleared
    useDirectoryStore.setState({ sharedError: '加载共享文件列表失败' });

    await useDirectoryStore.getState().fetchSharedFiles();

    expect(useDirectoryStore.getState().sharedError).toBeNull();
  });
});
