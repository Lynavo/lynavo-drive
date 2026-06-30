import { create } from 'zustand';
import type {
  DeviceFileLedgerDTO,
  DashboardDeviceDTO,
  SharedFileDTO,
  SortDirection,
} from '@lynavo-drive/contracts';
import i18n from '@renderer/i18n';
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

function isStorageUnavailableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '');
  return message.includes('storage path unavailable');
}

export interface DirectoryState {
  activeTab: DirectoryTab;
  receivedFiles: ReceivedFileEntry[];
  sharedFiles: SharedFileEntry[];
  receivedTotalBytes: number;
  loading: boolean;
  receivedError: string | null;
  sharedError: string | null;
  sortField: DirectorySortField;
  sortDirection: SortDirection;

  setTab(tab: DirectoryTab): void;
  setSortField(field: DirectorySortField): void;
  toggleSort(field: DirectorySortField): void;
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
  receivedError: null,
  sharedError: null,
  sortField: 'completedAt',
  sortDirection: 'desc',

  setTab: (tab) => set({ activeTab: tab }),

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

    // Only show loading indicator on initial load (no files yet)
    const isInitialLoad = get().receivedFiles.length === 0;
    if (isInitialLoad) {
      set({ loading: true, receivedError: null });
    }

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
                  deviceName: device.displayName,
                  deviceId: device.deviceId,
                });
              }
            }
          } catch {
            // Skip devices that fail
          }
        }),
      );

      // Build fingerprint from fileKeys to detect actual changes
      const newFingerprint = allFiles.map((f) => f.fileKey).join('\n');
      const oldFingerprint = get().receivedFiles.map((f) => f.fileKey).join('\n');

      if (newFingerprint !== oldFingerprint || totalBytes !== get().receivedTotalBytes) {
        set({
          receivedFiles: allFiles,
          receivedTotalBytes: totalBytes,
          loading: false,
          receivedError: null,
        });
      } else if (isInitialLoad) {
        set({ loading: false, receivedError: null });
      }
    } catch (err) {
      console.error('Failed to fetch received files:', err);
      set({
        loading: false,
        receivedError: isStorageUnavailableError(err)
          ? i18n.t('errors.directory.receiveDirectoryUnavailable')
          : i18n.t('errors.directory.loadReceivedFailed'),
      });
    }
  },

  fetchSharedFiles: async () => {
    const api = window.electronAPI;
    if (!api || !isSidecarHealthy()) return;

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

      // Only update state if the file list actually changed
      const newFingerprint = entries.map((f) => f.path).join('\n');
      const oldFingerprint = get().sharedFiles.map((f) => f.path).join('\n');

      if (newFingerprint !== oldFingerprint) {
        set({ sharedFiles: entries, sharedError: null });
      } else if (get().sharedError) {
        set({ sharedError: null });
      }
    } catch (err) {
      console.error('Failed to fetch shared files:', err);
      set({
        sharedFiles: [],
        sharedError: isStorageUnavailableError(err)
          ? i18n.t('errors.directory.sharedDirectoryUnavailable')
          : i18n.t('errors.directory.loadSharedFailed'),
      });
    }
  },

  fetchAll: async () => {
    const state = get();
    await Promise.all([state.fetchReceivedFiles(), state.fetchSharedFiles()]);
  },
}));
