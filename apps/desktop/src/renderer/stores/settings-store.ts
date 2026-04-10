import { create } from 'zustand';
import type { SettingsDTO, ShareStatusDTO } from '@syncflow/contracts';
import { useSidecarRuntimeStore } from './sidecar-runtime-store';

function toShareStatusSnapshot(settings: SettingsDTO): ShareStatusDTO {
  return {
    enabled: settings.shareAddress !== '',
    smbUrl: settings.shareAddress || null,
    status: settings.shareStatus,
    shareName: settings.shareName || undefined,
  };
}

function isSidecarHealthy(): boolean {
  return useSidecarRuntimeStore.getState().runtime.status === 'healthy';
}

export interface SettingsState {
  settings: SettingsDTO;
  shareStatusInfo: ShareStatusDTO;
  validatingShare: boolean;
  copiedField: string | null;
  fetchSettings(): Promise<void>;
  updateSettings(settings: SettingsDTO): void;
  refreshShareStatus(silent?: boolean): Promise<void>;
  setCopied(field: string | null): void;
}

const initialSettings: SettingsDTO = {
  deviceName: '',
  connectionCode: '',
  rootPath: '',
  receivePath: '',
  sharedPath: '',
  shareAddress: '',
  shareStatus: 'unknown' as const,
  shareName: '',
};

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: initialSettings,
  shareStatusInfo: toShareStatusSnapshot(initialSettings),
  validatingShare: false,
  copiedField: null,

  fetchSettings: async () => {
    const api = window.electronAPI;
    if (!api || !isSidecarHealthy()) return;
    try {
      const settings = await api.sidecar.getSettings();
      set({
        settings,
        shareStatusInfo: toShareStatusSnapshot(settings),
      });
    } catch (err) {
      console.error('Failed to fetch settings:', err);
    }
  },

  updateSettings: (settings) =>
    set({
      settings,
      shareStatusInfo: toShareStatusSnapshot(settings),
    }),

  refreshShareStatus: async (silent = false) => {
    const api = window.electronAPI;
    if (!api || !isSidecarHealthy()) return;

    set({ validatingShare: true });
    try {
      const result = await api.sidecar.validateShare();
      set((state) => ({
        validatingShare: false,
        shareStatusInfo: result,
        settings: {
          ...state.settings,
          shareAddress: result.smbUrl ?? '',
          shareStatus: result.status,
          shareName: result.shareName ?? state.settings.shareName,
        },
      }));
    } catch (err) {
      console.error('Failed to validate share status:', err);
      if (!silent) {
        set((state) => ({
          shareStatusInfo: {
            ...get().shareStatusInfo,
            enabled: state.settings.shareAddress !== '',
            smbUrl: state.settings.shareAddress || null,
            status: 'error',
            shareName: state.settings.shareName || undefined,
            lastError: '共享状态检测失败',
          },
        }));
      }
      set({ validatingShare: false });
    }
  },

  setCopied: (field) => set({ copiedField: field }),
}));
