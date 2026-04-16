import { create } from 'zustand';
import { toast } from 'sonner';
import type { DashboardDeviceDTO, DashboardSummaryDTO } from '@syncflow/contracts';
import type { DeviceDashboardStatus } from '@syncflow/contracts';
import { useSidecarRuntimeStore } from './sidecar-runtime-store';

const OFFLINE_STATUS_DEBOUNCE_MS = 3_000;

const STATUS_PRIORITY: Record<DeviceDashboardStatus, number> = {
  transferring: 0,
  connected_idle: 1,
  offline: 2,
};

const pendingOfflineStatusTimers = new Map<string, ReturnType<typeof setTimeout>>();

function sortDevices(devices: DashboardDeviceDTO[]): DashboardDeviceDTO[] {
  return [...devices].sort(
    (a, b) => STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status],
  );
}

function isSidecarHealthy(): boolean {
  return useSidecarRuntimeStore.getState().runtime.status === 'healthy';
}

function shouldPreserveRealtimeTransfer(
  existing: DashboardDeviceDTO,
  snapshot: DashboardDeviceDTO,
): boolean {
  if (existing.status !== 'transferring' || snapshot.status === 'transferring') {
    return false;
  }

  if (!existing.currentFile) {
    return true;
  }

  return existing.currentFile.progress < 100;
}

function clearPendingOfflineStatus(deviceId: string): void {
  const timer = pendingOfflineStatusTimers.get(deviceId);
  if (!timer) return;
  clearTimeout(timer);
  pendingOfflineStatusTimers.delete(deviceId);
}

function scheduleOfflineStatus(
  deviceId: string,
  set: (partial:
    | Partial<DashboardState>
    | ((state: DashboardState) => Partial<DashboardState>),
  ) => void,
): void {
  clearPendingOfflineStatus(deviceId);

  const timer = setTimeout(() => {
    pendingOfflineStatusTimers.delete(deviceId);
    set((state) => ({
      devices: applyDeviceStatus(state.devices, deviceId, 'offline'),
    }));
  }, OFFLINE_STATUS_DEBOUNCE_MS);

  pendingOfflineStatusTimers.set(deviceId, timer);
}

function applyDeviceStatus(
  devices: DashboardDeviceDTO[],
  deviceId: string,
  status: DeviceDashboardStatus,
): DashboardDeviceDTO[] {
  return sortDevices(
    devices.map((d) =>
      d.deviceId === deviceId
        ? {
            ...d,
            status,
            currentFile: status === 'transferring' ? d.currentFile : undefined,
          }
        : d,
    ),
  );
}

export function resetPendingOfflineStatusDebounceForTests(): void {
  pendingOfflineStatusTimers.forEach((timer) => clearTimeout(timer));
  pendingOfflineStatusTimers.clear();
}

export interface DashboardState {
  summary: DashboardSummaryDTO;
  devices: DashboardDeviceDTO[];
  diskWarningDismissed: boolean;
  error: string | null;
  fetchDashboard(): Promise<void>;
  dismissDiskWarning(): void;
  updateSummary(summary: DashboardSummaryDTO): void;
  updateDevices(devices: DashboardDeviceDTO[]): void;
  updateDeviceProgress(deviceId: string, fileKey: string, progress: number): void;
  updateDeviceStatus(deviceId: string, status: DeviceDashboardStatus): void;
}

function reconcileIncomingDevices(
  incomingDevices: DashboardDeviceDTO[],
  currentDevices: DashboardDeviceDTO[],
  set: (partial:
    | Partial<DashboardState>
    | ((state: DashboardState) => Partial<DashboardState>),
  ) => void,
): DashboardDeviceDTO[] {
  return incomingDevices.map((device) => {
    const existing = currentDevices.find((current) => current.deviceId === device.deviceId);
    if (!existing) {
      return device;
    }

    const patched = { ...device };
    const preserveRealtimeTransfer = shouldPreserveRealtimeTransfer(existing, device);

    if (preserveRealtimeTransfer) {
      patched.status = existing.status;
    }

    if (
      preserveRealtimeTransfer &&
      existing.currentFile &&
      existing.currentFile.progress > (device.currentFile?.progress ?? 0)
    ) {
      patched.currentFile = existing.currentFile;
    }

    if (device.status === 'offline' && existing.status !== 'offline') {
      scheduleOfflineStatus(device.deviceId, set);
      patched.status = existing.status;
      patched.currentFile = existing.status === 'transferring' ? existing.currentFile : undefined;
      return patched;
    }

    clearPendingOfflineStatus(device.deviceId);
    return patched;
  });
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  summary: {
    todayUploadCount: 0,
    todayOccupiedBytes: 0,
    remainingBytes: 0,
    isDiskLow: false,
    lastSuccessfulSyncAt: undefined,
    lastSuccessfulDeviceName: undefined,
  },
  devices: [],
  diskWarningDismissed: false,
  error: null,

  fetchDashboard: async () => {
    const api = window.electronAPI;
    if (!api || !isSidecarHealthy()) return;
    set({ error: null });
    try {
      const [summary, devices] = await Promise.all([
        api.sidecar.getDashboardSummary(),
        api.sidecar.getDashboardDevices(),
      ]);
      if (summary) set({ summary });
      if (devices) {
        const merged = reconcileIncomingDevices(devices, get().devices, set);
        set({ devices: sortDevices(merged) });
      }
    } catch (err) {
      console.error('Failed to fetch dashboard:', err);
      set({ error: '加载设备列表失败' });
      toast.error('加载设备列表失败', { description: '请检查网络连接后重试' });
    }
  },

  dismissDiskWarning: () => set({ diskWarningDismissed: true }),

  updateSummary: (summary) => { if (summary) set({ summary }); },

  updateDevices: (devices) => {
    const merged = reconcileIncomingDevices(devices, get().devices, set);
    set({ devices: sortDevices(merged) });
  },

  updateDeviceProgress: (deviceId, fileKey, progress) => {
    if (progress <= 0) return; // ignore zero-progress events
    set((state) => ({
      devices: state.devices.map((d) =>
        d.deviceId === deviceId
          ? {
              ...d,
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
    if (status === 'offline') {
      scheduleOfflineStatus(deviceId, set);
      return;
    }

    clearPendingOfflineStatus(deviceId);
    set((state) => ({
      devices: applyDeviceStatus(state.devices, deviceId, status),
    }));
  },
}));
