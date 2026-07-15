import type { SettingsDTO } from '@lynavo-drive/contracts';

export const mockSettings: SettingsDTO = {
  deviceName: "Alice's MacBook Pro",
  connectionCode: '839274',
  rootPath: '/Users/alice/LynavoDrive',
  receivePath: '/Users/alice/LynavoDrive/Received',
  personalPath: '/Users/alice/LynavoDrive/personal',
  sharedPath: '/Users/alice/LynavoDrive/shared',
  shareAddress: 'smb://192.168.1.100/LynavoDrive',
  shareStatus: 'ready',
  shareName: 'LynavoDrive',
  allowCrossDeviceReceivedAccess: true,
};
