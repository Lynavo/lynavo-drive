import { create } from 'zustand';
import { toast } from 'sonner';
import type { DashboardDeviceDTO, DashboardSummaryDTO } from '@lynavo-drive/contracts';
import type { DeviceDashboardStatus } from '@lynavo-drive/contracts';
import i18n from '@renderer/i18n';
import { useSidecarRuntimeStore } from './sidecar-runtime-store';

const OFFLINE_STATUS_DEBOUNCE_MS = 3_000;

const STATUS_PRIORITY: Record<DeviceDashboardStatus, number> = {
  transferring: 0,
  connected_idle: 1,
  offline: 2,
};

const pendingOfflineStatusTimers = new Map<string, ReturnType<typeof setTimeout>>();

function sortDevices(devices: DashboardDeviceDTO[]): DashboardDeviceDTO[] {
  return [...devices].sort((a, b) => STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status]);
}

function legacyDashboardIdentityKey(device: DashboardDeviceDTO): string {
  return `${device.platform}\x00${device.displayName}`;
}

export function filterVisibleDashboardDevices(devices: DashboardDeviceDTO[]): DashboardDeviceDTO[] {
  const visibleStableDeviceIds = new Set<string>();
  const hiddenOfflineLegacyKeys = new Set<string>();
  const visible: DashboardDeviceDTO[] = [];

  for (const device of devices) {
    const stableDeviceId = device.stableDeviceId?.trim();
    const legacyKey = legacyDashboardIdentityKey(device);

    if (stableDeviceId) {
      if (visibleStableDeviceIds.has(stableDeviceId)) {
        continue;
      }

      visibleStableDeviceIds.add(stableDeviceId);
      hiddenOfflineLegacyKeys.add(legacyKey);
      visible.push(device);
      continue;
    }

    if (device.status === 'offline' && hiddenOfflineLegacyKeys.has(legacyKey)) {
      continue;
    }

    visible.push(device);
  }

  return visible;
}

function isSidecarHealthy(): boolean {
  return useSidecarRuntimeStore.getState().runtime.status === 'healthy';
}

function isStorageUnavailableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '');
  return message.includes('storage path unavailable');
}

function shouldPreserveRealtimeTransfer(
  existing: DashboardDeviceDTO,
  snapshot: DashboardDeviceDTO,
): boolean {
  if (existing.status !== 'transferring') {
    return false;
  }

  // Only preserve transferring when we have real-time evidence of an in-flight
  // transfer (currentFile set AND progress < 100). If currentFile is missing
  // the snapshot is the only source of truth, otherwise a stale transferring
  // state without any currentFile locks the UI indefinitely (see M14).
  // Fresh BG HTTP transfers populate currentFile via updateDeviceProgress
  // before the next snapshot arrives, so legitimate in-flight uploads are
  // still preserved.
  if (!existing.currentFile) {
    return false;
  }

  if (snapshot.status !== 'transferring') {
    return existing.currentFile.progress < 100;
  }

  if (!snapshot.currentFile) {
    return false;
  }

  return (
    snapshot.currentFile.filename === existing.currentFile.filename &&
    snapshot.currentFile.progress <= 0 &&
    existing.currentFile.progress > 0
  );
}

function clearPendingOfflineStatus(deviceId: string): void {
  const timer = pendingOfflineStatusTimers.get(deviceId);
  if (!timer) return;
  clearTimeout(timer);
  pendingOfflineStatusTimers.delete(deviceId);
}

function scheduleOfflineStatus(
  deviceId: string,
  set: (
    partial: Partial<DashboardState> | ((state: DashboardState) => Partial<DashboardState>),
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
  set: (
    partial: Partial<DashboardState> | ((state: DashboardState) => Partial<DashboardState>),
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
        set({ devices: sortDevices(filterVisibleDashboardDevices(merged)) });
      }
    } catch (err) {
      console.error('Failed to fetch dashboard:', err);
      const storageUnavailable = isStorageUnavailableError(err);
      const message = storageUnavailable
        ? i18n.t('errors.dashboard.receiveDirectoryUnavailable')
        : i18n.t('errors.dashboard.loadDevicesFailed');
      set({ error: message });
      toast.error(message, {
        description: storageUnavailable
          ? i18n.t('errors.dashboard.receiveDirectoryUnavailableDescription')
          : i18n.t('errors.dashboard.checkNetworkAndRetry'),
      });
    }
  },

  dismissDiskWarning: () => set({ diskWarningDismissed: true }),

  updateSummary: (summary) => {
    if (summary) set({ summary });
  },

  updateDevices: (devices) => {
    const merged = reconcileIncomingDevices(devices, get().devices, set);
    set({ devices: sortDevices(filterVisibleDashboardDevices(merged)) });
  },

  updateDeviceProgress: (deviceId, fileKey, progress) => {
    if (progress <= 0) return; // ignore zero-progress events
    // Receiving an upload.progress tick (foreground TCP session or
    // background HTTP without sessionId) is itself proof that the device is
    // actively transferring. Promote status so DeviceCard renders the
    // transferring affordance even when a fresh device.state.changed event
    // hasn't arrived yet. Also cancel any pending offline-debounce timer
    // because a progress tick is a definitive liveness signal.
    clearPendingOfflineStatus(deviceId);
    set((state) => ({
      devices: sortDevices(
        state.devices.map((d) =>
          d.deviceId === deviceId
            ? {
                ...d,
                status: 'transferring',
                currentFile: {
                  filename: d.currentFile?.filename ?? fileKey,
                  progress,
                  fileSize: d.currentFile?.fileSize ?? 0,
                },
              }
            : d,
        ),
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
