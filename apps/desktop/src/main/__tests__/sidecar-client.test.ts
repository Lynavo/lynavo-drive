import { describe, expect, it } from 'vitest';
import { sidecarClient, type SidecarHealth } from '../sidecar-client';

const allowedSidecarClientKeys = [
  'addSharedResource',
  'blockDevice',
  'clearBlockedClient',
  'getAccessRecords',
  'getConnectionDevices',
  'getDashboardDevices',
  'getDashboardSummary',
  'getDeviceDates',
  'getDeviceFiles',
  'getHealth',
  'getManagedDevices',
  'getReceivedLibrary',
  'getSettings',
  'getShareStatus',
  'getSharedList',
  'getSharedResources',
  'getSyncRecords',
  'getTransferActive',
  'regenerateConnectionCode',
  'removeSharedResource',
  'revokeConnectionDevice',
  'setConnectionCode',
  'unblockDevice',
  'updatePowerState',
  'updateSettings',
  'validateShare',
];

describe('sidecarClient OSS removed-service boundary', () => {
  it('exposes only the public OSS sidecar client surface', () => {
    expect(Object.keys(sidecarClient).sort()).toEqual(allowedSidecarClientKeys);
  });

  it('does not model tunnel health in the OSS desktop client', () => {
    const health: SidecarHealth = {
      ok: true,
      service: 'lynavo-drive-sidecar',
    };

    expect(health).not.toHaveProperty('tunnel');
  });
});
