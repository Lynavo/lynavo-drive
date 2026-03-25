import { create } from 'zustand';
import type {
  DeviceFileLedgerDTO,
  DeviceFileSortField,
  SortDirection,
} from '@syncflow/contracts';

export type SortField = DeviceFileSortField;

const DEFAULT_PAGE_SIZE = 200;

export interface DeviceDetailState {
  files: DeviceFileLedgerDTO[];
  selectedDate: string;
  availableDates: string[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalBytes: number;
  totalTransmissionMs: number;
  sortField: SortField;
  sortDirection: SortDirection;
  loading: boolean;
  fetchDeviceFiles(
    deviceId: string,
    options?: {
      date?: string;
      page?: number;
    },
  ): Promise<void>;
  setDate(date: string): void;
  setAvailableDates(dates: string[]): void;
  toggleSort(deviceId: string, field: SortField): Promise<void>;
  setFiles(files: DeviceFileLedgerDTO[]): void;
  reset(): void;
}

export const useDeviceDetailStore = create<DeviceDetailState>((set, get) => ({
  files: [],
  selectedDate: '',
  availableDates: [],
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  totalItems: 0,
  totalBytes: 0,
  totalTransmissionMs: 0,
  sortField: 'completedAt',
  sortDirection: 'desc',
  loading: false,

  fetchDeviceFiles: async (deviceId, options) => {
    const api = window.electronAPI;
    if (!api) return;
    set({ loading: true });
    try {
      const datesRes = await api.sidecar.getDeviceDates(deviceId);
      const dates = datesRes.dates ?? [];
      const today = new Date().toLocaleDateString('sv-SE');
      const currentSelectedDate = get().selectedDate;
      const nextDate = options?.date;
      const selectedDate =
        nextDate ||
        (currentSelectedDate && dates.includes(currentSelectedDate)
          ? currentSelectedDate
          : dates.includes(today)
            ? today
            : dates[0] ?? today);
      const nextPage =
        options?.page ??
        (nextDate && nextDate !== currentSelectedDate ? 1 : get().page || 1);
      const pageData = await api.sidecar.getDeviceFiles(deviceId, selectedDate, {
        page: nextPage,
        pageSize: get().pageSize || DEFAULT_PAGE_SIZE,
        sortField: get().sortField,
        sortDirection: get().sortDirection,
      });
      set({
        files: pageData.items,
        availableDates: dates,
        selectedDate,
        page: pageData.page,
        pageSize: pageData.pageSize,
        totalItems: pageData.totalItems,
        totalBytes: pageData.totalBytes,
        totalTransmissionMs: pageData.totalActiveTransmissionMs,
        loading: false,
      });
    } catch (err) {
      console.error('Failed to fetch device files:', err);
      set({ loading: false });
    }
  },

  setDate: (date) => set({ selectedDate: date }),

  setAvailableDates: (dates) => set({ availableDates: dates }),

  toggleSort: async (deviceId, field) => {
    const state = get();
    const nextDirection: SortDirection =
      state.sortField === field && state.sortDirection === 'asc'
        ? 'desc'
        : 'asc';
    set({
      sortField: field,
      sortDirection: nextDirection,
    });
    await get().fetchDeviceFiles(deviceId, { page: 1 });
  },

  setFiles: (files) => set({ files }),

  reset: () =>
    set({
      files: [],
      selectedDate: '',
      availableDates: [],
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      totalItems: 0,
      totalBytes: 0,
      totalTransmissionMs: 0,
      sortField: 'completedAt',
      sortDirection: 'desc',
      loading: false,
    }),
}));
