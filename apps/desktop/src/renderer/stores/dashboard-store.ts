import { create } from 'zustand';
import type { DashboardDeviceDTO, DashboardSummaryDTO } from '@syncflow/contracts';
import type { DeviceDashboardStatus } from '@syncflow/contracts';

const STATUS_PRIORITY: Record<DeviceDashboardStatus, number> = {
  transferring: 0,
  connected_idle: 1,
  offline: 2,
};

function sortDevices(devices: DashboardDeviceDTO[]): DashboardDeviceDTO[] {
  return [...devices].sort(
    (a, b) => STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status],
  );
}

export interface DashboardState {
  summary: DashboardSummaryDTO;
  devices: DashboardDeviceDTO[];
  diskWarningDismissed: boolean;
  fetchDashboard(): Promise<void>;
  dismissDiskWarning(): void;
  updateSummary(summary: DashboardSummaryDTO): void;
  updateDevices(devices: DashboardDeviceDTO[]): void;
  updateDeviceProgress(deviceId: string, fileKey: string, progress: number): void;
  updateDeviceStatus(deviceId: string, status: DeviceDashboardStatus): void;
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  summary: {
    todayUploadCount: 0,
    todayOccupiedBytes: 0,
    remainingBytes: 0,
    isDiskLow: false,
  },
  devices: [],
  diskWarningDismissed: false,

  fetchDashboard: async () => {
    const api = window.electronAPI;
    if (!api) return;
    try {
      const [summary, devices] = await Promise.all([
        api.sidecar.getDashboardSummary(),
        api.sidecar.getDashboardDevices(),
      ]);
      if (summary) set({ summary });
      if (devices) {
        // Preserve real-time progress from WebSocket events during poll refresh
        const current = get().devices;
        const merged = devices.map((d) => {
          const existing = current.find((c) => c.deviceId === d.deviceId);
          if (existing?.currentFile && existing.currentFile.progress > 0 && !d.currentFile) {
            return { ...d, currentFile: existing.currentFile, status: existing.status };
          }
          return d;
        });
        set({ devices: sortDevices(merged) });
      }
    } catch (err) {
      console.error('Failed to fetch dashboard:', err);
    }
  },

  dismissDiskWarning: () => set({ diskWarningDismissed: true }),

  updateSummary: (summary) => { if (summary) set({ summary }); },

  updateDevices: (devices) => set({ devices: sortDevices(devices) }),

  updateDeviceProgress: (deviceId, fileKey, progress) => {
    set((state) => ({
      devices: state.devices.map((d) =>
        d.deviceId === deviceId
          ? {
              ...d,
              status: 'transferring' as DeviceDashboardStatus,
              currentFile: {
                filename: d.currentFile?.filename ?? fileKey,
                progress,
                fileSize: d.currentFile?.fileSize ?? 0,
              },
            }
          : d,
      ),
    }));
  },

  updateDeviceStatus: (deviceId, status) => {
    set((state) => ({
      devices: sortDevices(
        state.devices.map((d) =>
          d.deviceId === deviceId ? { ...d, status } : d,
        ),
      ),
    }));
  },
}));
