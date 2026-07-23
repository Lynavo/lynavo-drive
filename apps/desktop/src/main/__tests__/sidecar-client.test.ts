import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceReceiveLocationDTO } from '@lynavo-drive/contracts';
import { sidecarClient, type SidecarHealth } from '../sidecar-client';

const httpMock = vi.hoisted(() => ({
  request: vi.fn(),
}));

vi.mock('node:http', () => ({
  default: {
    request: httpMock.request,
  },
}));

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
  'getDeviceReceiveLocations',
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
  beforeEach(() => {
    httpMock.request.mockReset();
  });

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

  it('encodes the client ID and forwards device receive locations', async () => {
    const response: DeviceReceiveLocationDTO[] = [
      {
        path: '/Volumes/Archive/received/My iPhone',
        available: true,
        isCurrent: false,
        lastUsedAt: '2026-07-20T08:30:00Z',
      },
    ];
    httpMock.request.mockImplementation((options, callback) => {
      const request = {
        on: vi.fn().mockReturnThis(),
        setTimeout: vi.fn().mockReturnThis(),
        write: vi.fn(),
        end: vi.fn(),
      };
      const sidecarResponse = {
        statusCode: 200,
        on: vi.fn((event: string, handler: (value?: string) => void) => {
          if (event === 'data') handler(JSON.stringify(response));
          if (event === 'end') handler();
        }),
      };
      callback(sidecarResponse);
      return request;
    });

    await expect(sidecarClient.getDeviceReceiveLocations('phone/a b')).resolves.toEqual(response);
    expect(httpMock.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/devices/phone%2Fa%20b/receive-locations',
      }),
      expect.any(Function),
    );
  });
});
