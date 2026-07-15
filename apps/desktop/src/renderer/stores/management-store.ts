import { create } from 'zustand';
import type {
  DesktopAccessRecordDTO,
  DesktopManagedDeviceDTO,
  DesktopSyncRecordDTO,
} from '@lynavo-drive/contracts';

export interface RecordFilters {
  clientId?: string;
  query?: string;
}

interface ManagementState {
  devices: DesktopManagedDeviceDTO[];
  syncRecords: DesktopSyncRecordDTO[];
  accessRecords: DesktopAccessRecordDTO[];
  devicesLoading: boolean;
  syncRecordsLoading: boolean;
  accessRecordsLoading: boolean;
  devicesError: string | null;
  syncRecordsError: string | null;
  accessRecordsError: string | null;
  loadDevices(): Promise<void>;
  unblockDevice(clientId: string): Promise<void>;
  blockDevice(clientId: string): Promise<void>;
  loadSyncRecords(filters?: RecordFilters): Promise<void>;
  loadAccessRecords(filters?: RecordFilters): Promise<void>;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error ?? 'Unknown error');
}

function matchesFilters(
  record: Pick<DesktopSyncRecordDTO | DesktopAccessRecordDTO, 'clientId' | 'displayName'>,
  filters?: RecordFilters,
): boolean {
  if (!filters) return true;
  if (filters.clientId && record.clientId !== filters.clientId) return false;
  if (!filters.query) return true;

  const query = filters.query.trim().toLowerCase();
  if (!query) return true;

  return (
    record.clientId.toLowerCase().includes(query) ||
    record.displayName.toLowerCase().includes(query)
  );
}

export const useManagementStore = create<ManagementState>((set, get) => ({
  devices: [],
  syncRecords: [],
  accessRecords: [],
  devicesLoading: false,
  syncRecordsLoading: false,
  accessRecordsLoading: false,
  devicesError: null,
  syncRecordsError: null,
  accessRecordsError: null,

  loadDevices: async () => {
    const api = window.electronAPI;
    if (!api) return;

    set({ devicesLoading: true, devicesError: null });
    try {
      const response = await api.sidecar.getManagedDevices();
      set({ devices: response.items, devicesLoading: false, devicesError: null });
    } catch (error) {
      set({ devicesLoading: false, devicesError: errorMessage(error) });
    }
  },

  unblockDevice: async (clientId: string) => {
    const api = window.electronAPI;
    if (!api) return;

    set({ devicesError: null });
    try {
      await api.sidecar.unblockDevice(clientId);
      await get().loadDevices();
    } catch (error) {
      set({ devicesError: errorMessage(error) });
    }
  },

  blockDevice: async (clientId: string) => {
    const api = window.electronAPI;
    if (!api) return;

    set({ devicesError: null });
    try {
      await api.sidecar.blockDevice(clientId);
      await get().loadDevices();
    } catch (error) {
      set({ devicesError: errorMessage(error) });
    }
  },

  loadSyncRecords: async (filters?: RecordFilters) => {
    const api = window.electronAPI;
    if (!api) return;

    set({ syncRecordsLoading: true, syncRecordsError: null });
    try {
      const response = await api.sidecar.getSyncRecords();
      set({
        syncRecords: response.items.filter((record) => matchesFilters(record, filters)),
        syncRecordsLoading: false,
        syncRecordsError: null,
      });
    } catch (error) {
      set({ syncRecordsLoading: false, syncRecordsError: errorMessage(error) });
    }
  },

  loadAccessRecords: async (filters?: RecordFilters) => {
    const api = window.electronAPI;
    if (!api) return;

    set({ accessRecordsLoading: true, accessRecordsError: null });
    try {
      const response = await api.sidecar.getAccessRecords();
      set({
        accessRecords: response.items.filter((record) => matchesFilters(record, filters)),
        accessRecordsLoading: false,
        accessRecordsError: null,
      });
    } catch (error) {
      set({ accessRecordsLoading: false, accessRecordsError: errorMessage(error) });
    }
  },
}));
