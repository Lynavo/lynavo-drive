import type { SettingsDTO } from '@lynavo-drive/contracts';

export const mockSettings: SettingsDTO = {
  deviceName: 'Alice 的 MacBook Pro',
  connectionCode: '839274',
  rootPath: '/Users/alice/SyncFlow',
  receivePath: '/Users/alice/SyncFlow/Received',
  personalPath: '/Users/alice/SyncFlow/personal',
  sharedPath: '/Users/alice/SyncFlow/shared',
  shareAddress: 'smb://192.168.1.100/SyncFlow',
  shareStatus: 'ready',
  shareName: 'SyncFlow',
  allowCrossDeviceReceivedAccess: true,
};
