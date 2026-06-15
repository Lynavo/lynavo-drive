import { create } from 'zustand';
import type {
  DesktopSharedResourceDTO,
  ReceivedLibraryItemDTO,
  AddSharedResourcePayload,
} from '@syncflow/contracts';

interface ResourcesState {
  sharedResources: DesktopSharedResourceDTO[];
  receivedItems: ReceivedLibraryItemDTO[];
  sharedLoading: boolean;
  receivedLoading: boolean;
  sharedError: string | null;
  receivedError: string | null;
  loadSharedResources(): Promise<void>;
  loadReceivedLibrary(): Promise<void>;
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

export const useResourcesStore = create<ResourcesState>((set, get) => ({
  sharedResources: [],
  receivedItems: [],
  sharedLoading: false,
  receivedLoading: false,
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

  loadReceivedLibrary: async () => {
    const api = window.electronAPI;
    if (!api) return;
    set({ receivedLoading: true, receivedError: null });
    try {
      const res = await api.sidecar.getReceivedLibrary();
      set({ receivedItems: res.items, receivedLoading: false });
    } catch (err) {
      set({ receivedLoading: false, receivedError: errorMessage(err) });
    }
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
