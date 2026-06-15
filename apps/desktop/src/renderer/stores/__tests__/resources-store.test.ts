import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useResourcesStore } from '../resources-store';
import { useSidecarRuntimeStore } from '../sidecar-runtime-store';

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

    (window as any).electronAPI = {
      sidecar: {
        getSharedResources: vi.fn().mockResolvedValue(mockShared),
      },
    };

    await useResourcesStore.getState().loadSharedResources();

    expect(useResourcesStore.getState().sharedResources).toEqual(mockShared.items);
    expect(useResourcesStore.getState().sharedLoading).toBe(false);
    expect(useResourcesStore.getState().sharedError).toBeNull();
  });

  it('handles shared resources fetch error', async () => {
    (window as any).electronAPI = {
      sidecar: {
        getSharedResources: vi.fn().mockRejectedValue(new Error('Network failure')),
      },
    };

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
    };

    (window as any).electronAPI = {
      sidecar: {
        getReceivedLibrary: vi.fn().mockResolvedValue(mockReceived),
      },
    };

    await useResourcesStore.getState().loadReceivedLibrary();

    expect(useResourcesStore.getState().receivedItems).toEqual(mockReceived.items);
    expect(useResourcesStore.getState().receivedLoading).toBe(false);
    expect(useResourcesStore.getState().receivedError).toBeNull();
  });

  it('handles received library fetch error', async () => {
    (window as any).electronAPI = {
      sidecar: {
        getReceivedLibrary: vi.fn().mockRejectedValue(new Error('Network failure')),
      },
    };

    await useResourcesStore.getState().loadReceivedLibrary();

    expect(useResourcesStore.getState().receivedItems).toEqual([]);
    expect(useResourcesStore.getState().receivedLoading).toBe(false);
    expect(useResourcesStore.getState().receivedError).toBe('Network failure');
  });

  it('removes shared resource successfully', async () => {
    (window as any).electronAPI = {
      sidecar: {
        removeSharedResource: vi.fn().mockResolvedValue({ ok: true }),
        getSharedResources: vi.fn().mockResolvedValue({ items: [] }),
      },
    };

    await useResourcesStore.getState().removeSharedResource('res-1');

    expect((window as any).electronAPI.sidecar.removeSharedResource).toHaveBeenCalledWith('res-1');
  });

  it('shares a file using file picker', async () => {
    (window as any).electronAPI = {
      files: {
        selectFile: vi.fn().mockResolvedValue('/path/to/my-file.zip'),
      },
      sidecar: {
        addSharedResource: vi.fn().mockResolvedValue({ resourceId: 'new-res-1' }),
        getSharedResources: vi.fn().mockResolvedValue({ items: [] }),
      },
    };

    await useResourcesStore.getState().shareFile();

    expect((window as any).electronAPI.files.selectFile).toHaveBeenCalled();
    expect((window as any).electronAPI.sidecar.addSharedResource).toHaveBeenCalledWith({
      kind: 'shared_file',
      displayName: 'my-file.zip',
      localPath: '/path/to/my-file.zip',
    });
  });

  it('shares a folder using folder picker', async () => {
    (window as any).electronAPI = {
      files: {
        selectFolder: vi.fn().mockResolvedValue('/path/to/my-folder'),
      },
      sidecar: {
        addSharedResource: vi.fn().mockResolvedValue({ resourceId: 'new-res-2' }),
        getSharedResources: vi.fn().mockResolvedValue({ items: [] }),
      },
    };

    await useResourcesStore.getState().shareFolder();

    expect((window as any).electronAPI.files.selectFolder).toHaveBeenCalled();
    expect((window as any).electronAPI.sidecar.addSharedResource).toHaveBeenCalledWith({
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

    (window as any).electronAPI = {
      sidecar: {
        addSharedResource: vi.fn().mockResolvedValue({ resourceId: 'new-res-3' }),
        getSharedResources: vi.fn().mockResolvedValue({ items: [] }),
        getReceivedLibrary: vi.fn().mockResolvedValue({ items: [] }),
      },
    };

    await useResourcesStore.getState().addSharedFromReceived(mockItem);

    expect((window as any).electronAPI.sidecar.addSharedResource).toHaveBeenCalledWith({
      kind: 'received_file',
      displayName: 'image.png',
      receivedFileKey: 'key-1',
      fileSize: 1024,
      mediaType: 'image/png',
    });
  });
});
