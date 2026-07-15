import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useResourcesStore } from '../resources-store';
import { useSidecarRuntimeStore } from '../sidecar-runtime-store';
import type { ElectronAPI } from '../../../preload/api';

const testWindow = window as Window & { electronAPI: ElectronAPI };

describe('resources-store', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, 'electronAPI');

    useSidecarRuntimeStore.setState((state) => ({
      runtime: {
        ...state.runtime,
        status: 'healthy',
      },
    }));

    useResourcesStore.setState({
      sharedResources: [],
      receivedItems: [],
      receivedPage: 1,
      receivedPageSize: 30,
      receivedTotalItems: 0,
      receivedTotalBytes: 0,
      receivedDeviceStats: [],
      receivedHasMore: false,
      receivedLoadingMore: false,
      sharedLoading: false,
      receivedLoading: false,
      sharedError: null,
      receivedError: null,
    });
  });

  it('loads shared resources successfully', async () => {
    const mockShared = {
      items: [
        {
          resourceId: 'res-1',
          desktopDeviceId: 'dev-1',
          kind: 'shared_file' as const,
          displayName: 'file.txt',
          status: 'available' as const,
          addedAt: '2026-06-15T00:00:00Z',
          downloadCount: 0,
        },
      ],
    };

    testWindow.electronAPI = {
      sidecar: {
        getSharedResources: vi.fn().mockResolvedValue(mockShared),
      },
    } as unknown as ElectronAPI;

    await useResourcesStore.getState().loadSharedResources();

    expect(useResourcesStore.getState().sharedResources).toEqual(mockShared.items);
    expect(useResourcesStore.getState().sharedLoading).toBe(false);
    expect(useResourcesStore.getState().sharedError).toBeNull();
  });

  it('handles shared resources fetch error', async () => {
    testWindow.electronAPI = {
      sidecar: {
        getSharedResources: vi.fn().mockRejectedValue(new Error('Network failure')),
      },
    } as unknown as ElectronAPI;

    await useResourcesStore.getState().loadSharedResources();

    expect(useResourcesStore.getState().sharedResources).toEqual([]);
    expect(useResourcesStore.getState().sharedLoading).toBe(false);
    expect(useResourcesStore.getState().sharedError).toBe('Network failure');
  });

  it('loads received library successfully', async () => {
    const mockReceived = {
      items: [
        {
          resourceId: 'rec-1',
          desktopDeviceId: 'dev-1',
          clientId: 'client-1',
          displayName: 'image.png',
          fileKey: 'key-1',
          filename: 'image.png',
          mediaType: 'image/png',
          fileSize: 1024,
          completedAt: '2026-06-15T00:00:00Z',
          shareStatus: 'not_shared' as const,
        },
      ],
      page: 1,
      pageSize: 30,
      totalItems: 45,
      totalBytes: 46080,
      deviceStats: [
        {
          clientId: 'client-1',
          photoCount: 42,
          fileCount: 3,
          totalBytes: 46080,
        },
      ],
    };

    testWindow.electronAPI = {
      sidecar: {
        getReceivedLibrary: vi.fn().mockResolvedValue(mockReceived),
      },
    } as unknown as ElectronAPI;

    await useResourcesStore.getState().loadReceivedLibrary();

    expect(testWindow.electronAPI.sidecar.getReceivedLibrary).toHaveBeenCalledWith({
      page: 1,
      pageSize: 30,
    });
    expect(useResourcesStore.getState().receivedItems).toEqual(mockReceived.items);
    expect(useResourcesStore.getState().receivedPage).toBe(1);
    expect(useResourcesStore.getState().receivedPageSize).toBe(30);
    expect(useResourcesStore.getState().receivedTotalItems).toBe(45);
    expect(useResourcesStore.getState().receivedTotalBytes).toBe(46080);
    expect(useResourcesStore.getState().receivedDeviceStats).toEqual(mockReceived.deviceStats);
    expect(useResourcesStore.getState().receivedHasMore).toBe(true);
    expect(useResourcesStore.getState().receivedLoading).toBe(false);
    expect(useResourcesStore.getState().receivedLoadingMore).toBe(false);
    expect(useResourcesStore.getState().receivedError).toBeNull();
  });

  it('appends the next received library page', async () => {
    const firstItem = {
      resourceId: 'rec-1',
      desktopDeviceId: 'dev-1',
      clientId: 'client-1',
      displayName: 'first.png',
      fileKey: 'key-1',
      filename: 'first.png',
      mediaType: 'image/png',
      fileSize: 1024,
      completedAt: '2026-06-15T00:00:00Z',
      shareStatus: 'not_shared' as const,
    };
    const secondItem = {
      ...firstItem,
      resourceId: 'rec-2',
      displayName: 'second.png',
      fileKey: 'key-2',
      filename: 'second.png',
    };
    useResourcesStore.setState({
      receivedItems: [firstItem],
      receivedPage: 1,
      receivedPageSize: 30,
      receivedTotalItems: 2,
      receivedHasMore: true,
    });
    const secondPage = {
      items: [secondItem],
      page: 2,
      pageSize: 30,
      totalItems: 2,
      totalBytes: 2048,
      deviceStats: [
        {
          clientId: 'client-1',
          photoCount: 2,
          fileCount: 0,
          totalBytes: 2048,
        },
      ],
    };

    testWindow.electronAPI = {
      sidecar: {
        getReceivedLibrary: vi.fn().mockResolvedValue(secondPage),
      },
    } as unknown as ElectronAPI;

    await useResourcesStore.getState().loadMoreReceivedLibrary();

    expect(testWindow.electronAPI.sidecar.getReceivedLibrary).toHaveBeenCalledWith({
      page: 2,
      pageSize: 30,
    });
    expect(useResourcesStore.getState().receivedItems).toEqual([firstItem, secondItem]);
    expect(useResourcesStore.getState().receivedPage).toBe(2);
    expect(useResourcesStore.getState().receivedHasMore).toBe(false);
    expect(useResourcesStore.getState().receivedLoadingMore).toBe(false);
  });

  it('handles received library fetch error', async () => {
    testWindow.electronAPI = {
      sidecar: {
        getReceivedLibrary: vi.fn().mockRejectedValue(new Error('Network failure')),
      },
    } as unknown as ElectronAPI;

    await useResourcesStore.getState().loadReceivedLibrary();

    expect(useResourcesStore.getState().receivedItems).toEqual([]);
    expect(useResourcesStore.getState().receivedLoading).toBe(false);
    expect(useResourcesStore.getState().receivedError).toBe('Network failure');
  });

  it('removes shared resource successfully', async () => {
    testWindow.electronAPI = {
      sidecar: {
        removeSharedResource: vi.fn().mockResolvedValue({ ok: true }),
        getSharedResources: vi.fn().mockResolvedValue({ items: [] }),
      },
    } as unknown as ElectronAPI;

    await useResourcesStore.getState().removeSharedResource('res-1');

    expect(testWindow.electronAPI.sidecar.removeSharedResource).toHaveBeenCalledWith('res-1');
  });

  it('shares a file using file picker', async () => {
    testWindow.electronAPI = {
      files: {
        selectFile: vi.fn().mockResolvedValue('/path/to/my-file.zip'),
      },
      sidecar: {
        addSharedResource: vi.fn().mockResolvedValue({ resourceId: 'new-res-1' }),
        getSharedResources: vi.fn().mockResolvedValue({ items: [] }),
      },
    } as unknown as ElectronAPI;

    await useResourcesStore.getState().shareFile();

    expect(testWindow.electronAPI.files.selectFile).toHaveBeenCalled();
    expect(testWindow.electronAPI.sidecar.addSharedResource).toHaveBeenCalledWith({
      kind: 'shared_file',
      displayName: 'my-file.zip',
      localPath: '/path/to/my-file.zip',
    });
  });

  it('shares a folder using folder picker', async () => {
    testWindow.electronAPI = {
      files: {
        selectFolder: vi.fn().mockResolvedValue('/path/to/my-folder'),
      },
      sidecar: {
        addSharedResource: vi.fn().mockResolvedValue({ resourceId: 'new-res-2' }),
        getSharedResources: vi.fn().mockResolvedValue({ items: [] }),
      },
    } as unknown as ElectronAPI;

    await useResourcesStore.getState().shareFolder();

    expect(testWindow.electronAPI.files.selectFolder).toHaveBeenCalled();
    expect(testWindow.electronAPI.sidecar.addSharedResource).toHaveBeenCalledWith({
      kind: 'shared_folder',
      displayName: 'my-folder',
      localPath: '/path/to/my-folder',
    });
  });

  it('shares a received library item', async () => {
    const mockItem = {
      resourceId: 'rec-1',
      desktopDeviceId: 'dev-1',
      clientId: 'client-1',
      displayName: 'image.png',
      fileKey: 'key-1',
      filename: 'image.png',
      mediaType: 'image/png',
      fileSize: 1024,
      completedAt: '2026-06-15T00:00:00Z',
      shareStatus: 'not_shared' as const,
    };

    testWindow.electronAPI = {
      sidecar: {
        addSharedResource: vi.fn().mockResolvedValue({ resourceId: 'new-res-3' }),
        getSharedResources: vi.fn().mockResolvedValue({ items: [] }),
        getReceivedLibrary: vi.fn().mockResolvedValue({
          items: [],
          page: 1,
          pageSize: 30,
          totalItems: 0,
          totalBytes: 0,
          deviceStats: [],
        }),
      },
    } as unknown as ElectronAPI;

    await useResourcesStore.getState().addSharedFromReceived(mockItem);

    expect(testWindow.electronAPI.sidecar.addSharedResource).toHaveBeenCalledWith({
      kind: 'received_file',
      displayName: 'image.png',
      receivedFileKey: 'key-1',
      fileSize: 1024,
      mediaType: 'image/png',
    });
  });
});
