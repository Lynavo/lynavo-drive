import { create } from 'zustand';
import type { SettingsDTO } from '@syncflow/contracts';

export interface SettingsState {
  settings: SettingsDTO;
  copiedField: string | null;
  fetchSettings(): Promise<void>;
  updateSettings(settings: SettingsDTO): void;
  setCopied(field: string | null): void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: {
    deviceName: '',
    connectionCode: '',
    receivePath: '',
    shareAddress: '',
    shareStatus: 'unknown' as const,
    shareName: '',
  },
  copiedField: null,

  fetchSettings: async () => {
    const api = window.electronAPI;
    if (!api) return;
    try {
      const settings = await api.sidecar.getSettings();
      set({ settings });
    } catch (err) {
      console.error('Failed to fetch settings:', err);
    }
  },

  updateSettings: (settings) => set({ settings }),

  setCopied: (field) => set({ copiedField: field }),
}));
