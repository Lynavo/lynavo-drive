import { create } from 'zustand';
import type {
  DesktopSharedResourceDTO,
  ReceivedLibraryDeviceStatDTO,
  ReceivedLibraryItemDTO,
  AddSharedResourcePayload,
} from '@lynavo-drive/contracts';

const RECEIVED_LIBRARY_PAGE_SIZE = 30;

type LoadReceivedLibraryOptions = {
  page?: number;
  append?: boolean;
};

interface ResourcesState {
  sharedResources: DesktopSharedResourceDTO[];
  receivedItems: ReceivedLibraryItemDTO[];
  receivedPage: number;
  receivedPageSize: number;
  receivedTotalItems: number;
  receivedTotalBytes: number;
  receivedDeviceStats: ReceivedLibraryDeviceStatDTO[];
  receivedHasMore: boolean;
  sharedLoading: boolean;
  receivedLoading: boolean;
  receivedLoadingMore: boolean;
  sharedError: string | null;
  receivedError: string | null;
  loadSharedResources(): Promise<void>;
  loadReceivedLibrary(options?: LoadReceivedLibraryOptions): Promise<void>;
  loadMoreReceivedLibrary(): Promise<void>;
  addSharedResource(payload: AddSharedResourcePayload): Promise<void>;
  removeSharedResource(resourceId: string): Promise<void>;
  addSharedFromReceived(item: ReceivedLibraryItemDTO): Promise<void>;
  shareFile(): Promise<void>;
  shareFolder(): Promise<void>;
}

function getBasename(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error ?? 'Unknown error');
}

function getReceivedItemIdentity(item: ReceivedLibraryItemDTO): string {
  return item.fileKey || item.resourceId || `${item.clientId}:${item.filename}:${item.completedAt}`;
}

function mergeReceivedItems(
  existing: ReceivedLibraryItemDTO[],
  incoming: ReceivedLibraryItemDTO[],
): ReceivedLibraryItemDTO[] {
  const merged = [...existing];
  const indexByKey = new Map<string, number>();
  merged.forEach((item, index) => {
    indexByKey.set(getReceivedItemIdentity(item), index);
  });

  for (const item of incoming) {
    const key = getReceivedItemIdentity(item);
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, merged.length);
      merged.push(item);
    } else {
      merged[existingIndex] = item;
    }
  }

  return merged;
}

export const useResourcesStore = create<ResourcesState>((set, get) => ({
  sharedResources: [],
  receivedItems: [],
  receivedPage: 1,
  receivedPageSize: RECEIVED_LIBRARY_PAGE_SIZE,
  receivedTotalItems: 0,
  receivedTotalBytes: 0,
  receivedDeviceStats: [],
  receivedHasMore: false,
  sharedLoading: false,
  receivedLoading: false,
  receivedLoadingMore: false,
  sharedError: null,
  receivedError: null,

  loadSharedResources: async () => {
    const api = window.electronAPI;
    if (!api) return;
    set({ sharedLoading: true, sharedError: null });
    try {
      const res = await api.sidecar.getSharedResources();
      set({ sharedResources: res.items, sharedLoading: false });
    } catch (err) {
      set({ sharedLoading: false, sharedError: errorMessage(err) });
    }
  },

  loadReceivedLibrary: async (options) => {
    const api = window.electronAPI;
    if (!api) return;
    const page = options?.page ?? 1;
    const append = options?.append ?? false;
    const pageSize = get().receivedPageSize || RECEIVED_LIBRARY_PAGE_SIZE;
    set(
      append
        ? { receivedLoadingMore: true, receivedError: null }
        : { receivedLoading: true, receivedError: null },
    );
    try {
      const res = await api.sidecar.getReceivedLibrary({ page, pageSize });
      set((state) => ({
        receivedItems: append ? mergeReceivedItems(state.receivedItems, res.items) : res.items,
        receivedPage: res.page,
        receivedPageSize: res.pageSize,
        receivedTotalItems: res.totalItems,
        receivedTotalBytes: res.totalBytes,
        receivedDeviceStats: res.deviceStats ?? [],
        receivedHasMore: res.page * res.pageSize < res.totalItems,
        receivedLoading: false,
        receivedLoadingMore: false,
        receivedError: null,
      }));
    } catch (err) {
      set({ receivedLoading: false, receivedLoadingMore: false, receivedError: errorMessage(err) });
    }
  },

  loadMoreReceivedLibrary: async () => {
    const state = get();
    if (state.receivedLoading || state.receivedLoadingMore || !state.receivedHasMore) {
      return;
    }
    await state.loadReceivedLibrary({ page: state.receivedPage + 1, append: true });
  },

  addSharedResource: async (payload) => {
    const api = window.electronAPI;
    if (!api) return;
    try {
      await api.sidecar.addSharedResource(payload);
      await get().loadSharedResources();
    } catch (err) {
      console.error('Failed to add shared resource:', err);
      throw err;
    }
  },

  removeSharedResource: async (resourceId) => {
    const api = window.electronAPI;
    if (!api) return;
    try {
      await api.sidecar.removeSharedResource(resourceId);
      await get().loadSharedResources();
    } catch (err) {
      console.error('Failed to remove shared resource:', err);
      throw err;
    }
  },

  addSharedFromReceived: async (item) => {
    await get().addSharedResource({
      kind: 'received_file',
      displayName: item.filename,
      receivedFileKey: item.fileKey,
      fileSize: item.fileSize,
      mediaType: item.mediaType,
    });
    await get().loadReceivedLibrary();
  },

  shareFile: async () => {
    const api = window.electronAPI;
    if (!api) return;
    const path = await api.files.selectFile();
    if (!path) return;
    await get().addSharedResource({
      kind: 'shared_file',
      displayName: getBasename(path),
      localPath: path,
    });
  },

  shareFolder: async () => {
    const api = window.electronAPI;
    if (!api) return;
    const path = await api.files.selectFolder();
    if (!path) return;
    await get().addSharedResource({
      kind: 'shared_folder',
      displayName: getBasename(path),
      localPath: path,
    });
  },
}));
