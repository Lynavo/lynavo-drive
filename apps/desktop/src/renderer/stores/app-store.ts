import { create } from 'zustand';
import type { DashboardDeviceDTO } from '@syncflow/contracts';

export type AppView = 'dashboard' | 'directory' | 'settings' | 'help' | 'device-detail';

export interface AppState {
  currentView: AppView;
  selectedDevice: DashboardDeviceDTO | null;
  /** @deprecated Kept for backward compatibility. Use `currentView === 'device-detail'` instead. */
  isModalOpen: boolean;
  setView(view: AppView): void;
  openDeviceDetail(device: DashboardDeviceDTO): void;
  closeDeviceDetail(): void;
}

export const useAppStore = create<AppState>((set) => ({
  currentView: 'dashboard',
  selectedDevice: null,
  isModalOpen: false,

  setView: (view) => set({ currentView: view }),

  openDeviceDetail: (device) =>
    set({ selectedDevice: device, currentView: 'device-detail', isModalOpen: true }),

  closeDeviceDetail: () =>
    set({ selectedDevice: null, currentView: 'dashboard', isModalOpen: false }),
}));
