import type {
  AddSharedResourcePayload,
  ConnectionDevicesSettingsDTO,
  DashboardSummaryDTO,
  DashboardDeviceDTO,
  DesktopAccessRecordDTO,
  DesktopLocalListResponse,
  DesktopManagedDeviceDTO,
  DesktopSharedResourceDTO,
  DesktopSyncRecordDTO,
  DeviceFileLedgerPageDTO,
  DeviceFileSortField,
  DeviceReceiveLocationDTO,
  ReceivedLibraryPageDTO,
  SettingsDTO,
  SharedDirectoryDTO,
  ShareStatusDTO,
  SortDirection,
} from '@lynavo-drive/contracts';
import type { SidecarEvent } from '@lynavo-drive/contracts';
import type { SidecarRuntimeState } from '../shared/sidecar-runtime';

export type PowerSaveState = {
  preventSleepDuringTransfer: boolean;
  blockingSleep: boolean;
};

export interface ElectronAPI {
  sidecar: {
    getHealth(): Promise<{ ok: boolean; service: string }>;
    getDashboardSummary(): Promise<DashboardSummaryDTO>;
    getDashboardDevices(): Promise<DashboardDeviceDTO[]>;
    getDeviceFiles(
      deviceId: string,
      date: string,
      options?: {
        page?: number;
        pageSize?: number;
        sortField?: DeviceFileSortField;
        sortDirection?: SortDirection;
        endDate?: string;
      },
    ): Promise<DeviceFileLedgerPageDTO>;
    getDeviceDates(deviceId: string): Promise<{ dates: string[] }>;
    getDeviceReceiveLocations(clientId: string): Promise<DeviceReceiveLocationDTO[]>;
    getSettings(): Promise<SettingsDTO>;
    updateSettings(settings: Partial<SettingsDTO>): Promise<SettingsDTO>;
    getConnectionDevices(): Promise<ConnectionDevicesSettingsDTO>;
    revokeConnectionDevice(clientId: string): Promise<{ ok: boolean }>;
    clearBlockedClient(clientId: string): Promise<{ ok: boolean }>;
    setConnectionCode(code: string): Promise<{ code: string }>;
    regenerateConnectionCode(): Promise<{ code: string }>;
    getRuntimeState(): Promise<SidecarRuntimeState>;
    retryStart(): Promise<void>;
    getShareStatus(): Promise<ShareStatusDTO>;
    validateShare(): Promise<ShareStatusDTO>;
    getTransferActive(): Promise<{ active: boolean }>;
    getSharedList(path?: string): Promise<SharedDirectoryDTO>;
    getManagedDevices(): Promise<DesktopLocalListResponse<DesktopManagedDeviceDTO>>;
    unblockDevice(clientId: string): Promise<{ ok: boolean }>;
    blockDevice(clientId: string): Promise<{ ok: boolean }>;
    getSyncRecords(): Promise<DesktopLocalListResponse<DesktopSyncRecordDTO>>;
    getAccessRecords(): Promise<DesktopLocalListResponse<DesktopAccessRecordDTO>>;
    getSharedResources(): Promise<DesktopLocalListResponse<DesktopSharedResourceDTO>>;
    addSharedResource(payload: AddSharedResourcePayload): Promise<DesktopSharedResourceDTO>;
    removeSharedResource(resourceId: string): Promise<{ ok: boolean }>;
    getReceivedLibrary(options?: {
      page?: number;
      pageSize?: number;
    }): Promise<ReceivedLibraryPageDTO>;
  };
  files: {
    openFolder(path: string): Promise<void>;
    openFile(path: string): Promise<void>;
    revealPath(path: string): Promise<void>;
    openExternal(target: string): Promise<void>;
    selectFile(): Promise<string | null>;
    selectFolder(): Promise<string | null>;
    copyToClipboard(text: string): Promise<void>;
    checkFolderPermission(): Promise<{ granted: boolean }>;
    requestFolderPermission(): Promise<{ granted: boolean }>;
  };

  events: {
    onSidecarEvent(callback: (event: SidecarEvent) => void): () => void;
    onSidecarRuntimeState(callback: (state: SidecarRuntimeState) => void): () => void;
  };
  platform: {
    isMac(): boolean;
    isWindows(): boolean;
    isLinux(): boolean;
    usesTitleBarOverlayControls(): boolean;
    getHomeDir(): string;
    getHostName(): string;
    setModalOverlayActive(active: boolean): Promise<void>;
    getLocalIPs(): string[];
  };
  support: {
    exportDiagnostics(locale?: string, description?: string): Promise<string | null>;
    getAppInfo(): Promise<{ name: string; version: string; buildNumber: string }>;
  };
  power: {
    getState(): Promise<PowerSaveState>;
    setPreventSleepDuringTransfer(enabled: boolean): Promise<PowerSaveState>;
  };
}
