import { create } from 'zustand';
import type {
  DeviceFileLedgerDTO,
  DashboardDeviceDTO,
  SharedFileDTO,
  SortDirection,
} from '@syncflow/contracts';
import { useSidecarRuntimeStore } from './sidecar-runtime-store';

export type DirectoryTab = 'received' | 'shared';

export type DirectorySortField = 'size' | 'completedAt';

/** Received file enriched with the source device name */
export interface ReceivedFileEntry extends DeviceFileLedgerDTO {
  deviceName: string;
  deviceId: string;
}

/** Shared file entry derived from contracts SharedFileDTO */
export type SharedFileEntry = Pick<SharedFileDTO, 'name' | 'path' | 'type' | 'size' | 'modifiedAt'>;

function isSidecarHealthy(): boolean {
  return useSidecarRuntimeStore.getState().runtime.status === 'healthy';
}

/** File preview descriptor */
export interface PreviewFile {
  name: string;
  /** media:// URL usable in <img>/<video> src */
  url: string;
  mediaType: 'image' | 'video';
}

export interface DirectoryState {
  activeTab: DirectoryTab;
  receivedFiles: ReceivedFileEntry[];
  sharedFiles: SharedFileEntry[];
  receivedTotalBytes: number;
  loading: boolean;
  error: string | null;
  sortField: DirectorySortField;
  sortDirection: SortDirection;
  /** Currently visible preview file (derived from previewList + previewIndex) */
  previewFile: PreviewFile | null;
  /** All previewable files in the current list context */
  previewList: PreviewFile[];
  /** Index into previewList */
  previewIndex: number;

  setTab(tab: DirectoryTab): void;
  setSortField(field: DirectorySortField): void;
  toggleSort(field: DirectorySortField): void;
  openPreview(file: PreviewFile, list: PreviewFile[]): void;
  closePreview(): void;
  prevPreview(): void;
  nextPreview(): void;
  fetchReceivedFiles(): Promise<void>;
  fetchSharedFiles(): Promise<void>;
  fetchAll(): Promise<void>;
}

export const useDirectoryStore = create<DirectoryState>((set, get) => ({
  activeTab: 'received',
  receivedFiles: [],
  sharedFiles: [],
  receivedTotalBytes: 0,
  loading: false,
  error: null,
  sortField: 'completedAt',
  sortDirection: 'desc',
  previewFile: null,
  previewList: [],
  previewIndex: 0,

  setTab: (tab) => set({ activeTab: tab }),

  openPreview: (file, list) => {
    const index = list.findIndex((f) => f.url === file.url);
    set({ previewFile: file, previewList: list, previewIndex: index >= 0 ? index : 0 });
  },
  closePreview: () => set({ previewFile: null, previewList: [], previewIndex: 0 }),
  prevPreview: () => {
    const { previewList, previewIndex } = get();
    if (previewList.length === 0) return;
    const newIndex = previewIndex > 0 ? previewIndex - 1 : previewList.length - 1;
    set({ previewIndex: newIndex, previewFile: previewList[newIndex] });
  },
  nextPreview: () => {
    const { previewList, previewIndex } = get();
    if (previewList.length === 0) return;
    const newIndex = previewIndex < previewList.length - 1 ? previewIndex + 1 : 0;
    set({ previewIndex: newIndex, previewFile: previewList[newIndex] });
  },

  setSortField: (field) => set({ sortField: field }),

  toggleSort: (field) => {
    const state = get();
    if (state.sortField === field) {
      set({ sortDirection: state.sortDirection === 'asc' ? 'desc' : 'asc' });
    } else {
      set({ sortField: field, sortDirection: 'desc' });
    }
  },

  fetchReceivedFiles: async () => {
    const api = window.electronAPI;
    if (!api || !isSidecarHealthy()) return;

    set({ loading: true, error: null });

    try {
      const devices: DashboardDeviceDTO[] = await api.sidecar.getDashboardDevices();

      const allFiles: ReceivedFileEntry[] = [];
      let totalBytes = 0;

      // For each device, fetch dates then files for each date
      await Promise.all(
        devices.map(async (device) => {
          try {
            const { dates } = await api.sidecar.getDeviceDates(device.deviceId);

            // Fetch files for all available dates (limit to recent 30 to avoid overwhelming)
            const recentDates = dates.slice(0, 30);

            const dateResults = await Promise.all(
              recentDates.map((date) =>
                api.sidecar
                  .getDeviceFiles(device.deviceId, date, {
                    page: 1,
                    pageSize: 500,
                  })
                  .catch(() => null),
              ),
            );

            for (const result of dateResults) {
              if (!result) continue;
              totalBytes += result.totalBytes;
              for (const file of result.items) {
                allFiles.push({
                  ...file,
                  deviceName: device.clientName,
                  deviceId: device.deviceId,
                });
              }
            }
          } catch {
            // Skip devices that fail
          }
        }),
      );

      set({
        receivedFiles: allFiles,
        receivedTotalBytes: totalBytes,
        loading: false,
      });
    } catch (err) {
      console.error('Failed to fetch received files:', err);
      set({ loading: false, error: '加载接收文件列表失败' });
    }
  },

  fetchSharedFiles: async () => {
    const api = window.electronAPI;
    if (!api || !isSidecarHealthy()) return;

    set({ error: null });
    try {
      const result = await api.sidecar.getSharedList();
      const entries: SharedFileEntry[] = result.files
        .filter((f) => !f.isDirectory)
        .map((f) => ({
          name: f.name,
          path: f.path,
          type: f.type,
          size: f.size,
          modifiedAt: f.modifiedAt,
        }));
      set({ sharedFiles: entries });
    } catch (err) {
      console.error('Failed to fetch shared files:', err);
      set({ sharedFiles: [], error: '加载共享文件列表失败' });
    }
  },

  fetchAll: async () => {
    const state = get();
    await Promise.all([state.fetchReceivedFiles(), state.fetchSharedFiles()]);
  },
}));
