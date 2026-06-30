import { create } from 'zustand';
import type { ConnectionDevicesSettingsDTO } from '@lynavo-drive/contracts';

const emptyConnectionDevices: ConnectionDevicesSettingsDTO = {
  authorizedDevices: [],
  blockedClients: [],
  recentAttempts: [],
};

export interface ConnectionDevicesState {
  data: ConnectionDevicesSettingsDTO;
  loading: boolean;
  error: string | null;
  busyClientId: string | null;
  fetchConnectionDevices(): Promise<void>;
  revokeDevice(clientId: string): Promise<void>;
  clearBlock(clientId: string): Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useConnectionDevicesStore = create<ConnectionDevicesState>((set, get) => ({
  data: emptyConnectionDevices,
  loading: false,
  error: null,
  busyClientId: null,

  fetchConnectionDevices: async () => {
    const api = window.electronAPI;
    if (!api) return;

    set({ loading: true, error: null });
    try {
      const data = await api.sidecar.getConnectionDevices();
      set({ data, loading: false });
    } catch (error) {
      set({ loading: false, error: errorMessage(error) });
    }
  },

  revokeDevice: async (clientId) => {
    const api = window.electronAPI;
    if (!api) return;

    set({ busyClientId: clientId, error: null });
    try {
      await api.sidecar.revokeConnectionDevice(clientId);
      await get().fetchConnectionDevices();
    } catch (error) {
      set({ error: errorMessage(error) });
    } finally {
      set({ busyClientId: null });
    }
  },

  clearBlock: async (clientId) => {
    const api = window.electronAPI;
    if (!api) return;

    set({ busyClientId: clientId, error: null });
    try {
      await api.sidecar.clearBlockedClient(clientId);
      await get().fetchConnectionDevices();
    } catch (error) {
      set({ error: errorMessage(error) });
    } finally {
      set({ busyClientId: null });
    }
  },
}));
