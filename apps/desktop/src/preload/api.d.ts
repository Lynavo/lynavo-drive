import type {
  DashboardSummaryDTO,
  DashboardDeviceDTO,
  DeviceFileLedgerPageDTO,
  DeviceFileSortField,
  SettingsDTO,
  SharedDirectoryDTO,
  ShareStatusDTO,
  SortDirection,
} from '@syncflow/contracts';
import type { SidecarEvent } from '@syncflow/contracts';
import type { BonjourInstallResult } from '../shared/bonjour';
import type { SidecarRuntimeState } from '../shared/sidecar-runtime';

export type DiagnosticsUploadRequest = {
  description: string;
  locale?: string;
};

export type DiagnosticsUploadResult = {
  refId: string;
  uploadedAt: string;
};

export type UpdateCheckResult = {
  updateAvailable: boolean;
  latestVersion: string;
  latestBuildNumber?: string;
  minimumRequired?: boolean;
  downloadUrl?: string;
  releaseNotes?: string;
  checkedAt: string;
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
    getSettings(): Promise<SettingsDTO>;
    updateSettings(settings: Partial<SettingsDTO>): Promise<SettingsDTO>;
    resetState(): Promise<{ ok: boolean }>;
    regenerateConnectionCode(): Promise<{ code: string }>;
    getRuntimeState(): Promise<SidecarRuntimeState>;
    retryStart(): Promise<void>;
    installBonjour(): Promise<BonjourInstallResult>;
    getShareStatus(): Promise<ShareStatusDTO>;
    validateShare(): Promise<ShareStatusDTO>;
    getTransferActive(): Promise<{ active: boolean }>;
    getSharedList(path?: string): Promise<SharedDirectoryDTO>;
  };
  files: {
    openFolder(path: string): Promise<void>;
    openFile(path: string): Promise<void>;
    openExternal(target: string): Promise<void>;
    selectFolder(): Promise<string | null>;
    copyToClipboard(text: string): Promise<void>;
  };
  events: {
    onSidecarEvent(callback: (event: SidecarEvent) => void): () => void;
    onSidecarRuntimeState(callback: (state: SidecarRuntimeState) => void): () => void;
  };
  platform: {
    isMac(): boolean;
    isWindows(): boolean;
    getHostName(): string;
    getLocalIPs(): string[];
  };
  support: {
    uploadDiagnostics(request: DiagnosticsUploadRequest): Promise<DiagnosticsUploadResult>;
    exportDiagnostics(locale?: string, description?: string): Promise<string | null>;
    checkForUpdates(): Promise<UpdateCheckResult>;
    getAppInfo(): Promise<{ name: string; version: string; buildNumber: string }>;
  };
}
