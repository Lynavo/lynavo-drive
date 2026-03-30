export const BONJOUR_WINDOWS_SUPPORT_URL = 'https://support.apple.com/en-us/106380';
export const BONJOUR_WINDOWS_INSTALLER_URL =
  'https://download.info.apple.com/Mac_OS_X/061-8098.20100603.gthyu/BonjourPSSetup.exe';
export const BONJOUR_WINDOWS_INSTALLER_NAME = 'BonjourPSSetup.exe';

export type BonjourInstallStatus = 'installed' | 'already_installed';

export interface BonjourInstallResult {
  status: BonjourInstallStatus;
  message: string;
  supportUrl: string;
  installerPath: string | null;
  bonjourPath: string | null;
}
