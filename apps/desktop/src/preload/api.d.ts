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
  ReceivedLibraryPageDTO,
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

export type AuthLoginResult = {
  ok: boolean;
  message?: string;
  reason?: string;
  userId?: number;
  isNewUser?: boolean;
  merged?: boolean;
};

export type AuthSessionView = {
  loggedIn: true;
  phone?: string;
  email?: string;
  accountLabel?: string;
};

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
    getSettings(): Promise<SettingsDTO>;
    updateSettings(settings: Partial<SettingsDTO>): Promise<SettingsDTO>;
    resetState(): Promise<{ ok: boolean }>;
    getConnectionDevices(): Promise<ConnectionDevicesSettingsDTO>;
    revokeConnectionDevice(clientId: string): Promise<{ ok: boolean }>;
    clearBlockedClient(clientId: string): Promise<{ ok: boolean }>;
    getClientConfig(): Promise<{
      features: {
        giftCard: {
          enabled: boolean;
        };
      };
    }>;
    redeemGiftCard(payload: { code: string }): Promise<{
      ok: boolean;
      message?: string;
      reason?:
        | 'auth_required'
        | 'invalid_code'
        | 'expired'
        | 'not_available'
        | 'already_redeemed'
        | 'plan_mismatch';
    }>;
    setConnectionCode(code: string): Promise<{ code: string }>;
    regenerateConnectionCode(): Promise<{ code: string }>;
    getRuntimeState(): Promise<SidecarRuntimeState>;
    retryStart(): Promise<void>;
    installBonjour(): Promise<BonjourInstallResult>;
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

  auth: {
    sendSMSCode(payload: { phone: string }): Promise<{
      ok: boolean;
      message?: string;
      reason?: 'phone_invalid' | 'sms_too_frequent' | 'sms_send_failed';
    }>;
    loginWithSMSCode(payload: { phone: string; code: string }): Promise<AuthLoginResult>;
    sendEmailCode(payload: { email: string }): Promise<{
      ok: boolean;
      message?: string;
      reason?: 'email_invalid' | 'email_too_frequent' | 'email_send_failed';
    }>;
    loginWithEmailCode(payload: { email: string; code: string }): Promise<AuthLoginResult>;
    getAuthSession(): Promise<AuthSessionView | null>;
    logout(): Promise<{ ok: boolean }>;
    loginWithOAuth(payload: { provider: 'google' | 'apple' }): Promise<AuthLoginResult>;
  };
  events: {
    onSidecarEvent(callback: (event: SidecarEvent) => void): () => void;
    onSidecarRuntimeState(callback: (state: SidecarRuntimeState) => void): () => void;
  };
  platform: {
    isMac(): boolean;
    isWindows(): boolean;
    supportsAppleAuth(): boolean;
    usesTitleBarOverlayControls(): boolean;
    isAuthBypassEnabled(): boolean;
    getHomeDir(): string;
    getHostName(): string;
    getLocalIPs(): string[];
  };
  support: {
    uploadDiagnostics(request: DiagnosticsUploadRequest): Promise<DiagnosticsUploadResult>;
    exportDiagnostics(locale?: string, description?: string): Promise<string | null>;
    checkForUpdates(): Promise<UpdateCheckResult>;
    getAppInfo(): Promise<{ name: string; version: string; buildNumber: string }>;
  };
  power: {
    getState(): Promise<PowerSaveState>;
    setPreventSleepDuringTransfer(enabled: boolean): Promise<PowerSaveState>;
  };
}
