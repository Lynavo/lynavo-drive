import { create } from 'zustand';
import { toast } from 'sonner';
import type {
  DeviceFileLedgerDTO,
  DeviceFileSortField,
  SortDirection,
} from '@lynavo-drive/contracts';
import i18n from '@renderer/i18n';

export type SortField = DeviceFileSortField;

const DEFAULT_PAGE_SIZE = 200;

export interface DeviceDetailState {
  files: DeviceFileLedgerDTO[];
  selectedDate: string;
  startDate: string;
  endDate: string;
  availableDates: string[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalBytes: number;
  totalTransmissionMs: number;
  sortField: SortField;
  sortDirection: SortDirection;
  loading: boolean;
  error: string | null;
  fetchDeviceFiles(
    deviceId: string,
    options?: {
      date?: string;
      page?: number;
      silent?: boolean;
    },
  ): Promise<void>;
  setDate(date: string): void;
  setDateRange(start: string, end: string): void;
  setAvailableDates(dates: string[]): void;
  toggleSort(deviceId: string, field: SortField): Promise<void>;
  setFiles(files: DeviceFileLedgerDTO[]): void;
  reset(): void;
}

export const useDeviceDetailStore = create<DeviceDetailState>((set, get) => ({
  files: [],
  selectedDate: '',
  startDate: '',
  endDate: '',
  availableDates: [],
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  totalItems: 0,
  totalBytes: 0,
  totalTransmissionMs: 0,
  sortField: 'completedAt',
  sortDirection: 'desc',
  loading: false,
  error: null,

  fetchDeviceFiles: async (deviceId, options) => {
    const api = window.electronAPI;
    if (!api) return;
    const silent = options?.silent ?? false;
    if (!silent) {
      set({ loading: true, error: null });
    }
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
      // Use date range if both start and end are set
      const currentStartDate = get().startDate;
      const currentEndDate = get().endDate;
      const startDate = currentStartDate || selectedDate;
      const endDate = currentEndDate || selectedDate;

      const pageData = await api.sidecar.getDeviceFiles(deviceId, selectedDate, {
        page: nextPage,
        pageSize: get().pageSize || DEFAULT_PAGE_SIZE,
        sortField: get().sortField,
        sortDirection: get().sortDirection,
        endDate: endDate !== selectedDate ? endDate : undefined,
      });

      set({
        files: pageData.items,
        availableDates: dates,
        selectedDate,
        startDate,
        endDate,
        page: pageData.page,
        pageSize: pageData.pageSize,
        totalItems: pageData.totalItems,
        totalBytes: pageData.totalBytes,
        totalTransmissionMs: pageData.totalActiveTransmissionMs,
        loading: false,
        error: null,
      });
    } catch (err) {
      console.error('Failed to fetch device files:', err);
      if (silent) return;
      set({ loading: false, error: i18n.t('errors.deviceDetail.loadFileLedgerFailed') });
      toast.error(i18n.t('errors.deviceDetail.loadFileLedgerFailed'), {
        description: i18n.t('errors.common.retryLater'),
      });
    }
  },

  setDate: (date) => set({ selectedDate: date }),

  setDateRange: (start, end) => set({ startDate: start, endDate: end }),

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
      startDate: '',
      endDate: '',
      availableDates: [],
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      totalItems: 0,
      totalBytes: 0,
      totalTransmissionMs: 0,
      sortField: 'completedAt',
      sortDirection: 'desc',
      loading: false,
      error: null,
    }),
}));
