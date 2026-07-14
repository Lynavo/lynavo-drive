import { describe, it, expect } from 'vitest';
// @ts-expect-error Vite resolves raw source imports for this regression test.
import typesSource from '../types.ts?raw';
import {
  ErrorCode,
  type BlockedPairingClientDTO,
  type ConnectionDeviceDTO,
  type ConnectionDevicesSettingsDTO,
  type SettingsDTO,
  type PairingAttemptDTO,
  type PairingErrorMetadataDTO,
} from '../index';
import * as contracts from '../index';
import {
  SIDECAR_EVENT_TYPES,
  type ReleaseChannel,
  type DesktopDeviceAuthorizationStatus,
  type DesktopDeviceBlockStatus,
  type DesktopResourceKind,
  type DesktopResourceStatus,
  type DesktopAccessAction,
  type DesktopRecordResult,
  type DesktopManagedDeviceDTO,
  type DesktopConnectionAttemptDTO,
  type DesktopBlockStateDTO,
  type DesktopSharedResourceDTO,
  type DesktopAccessRecordDTO,
  type DesktopSyncRecordDTO,
  type DesktopLocalListResponse,
  type AddSharedResourcePayload,
  type ReceivedLibraryItemDTO,
  type RecentDesktopDTO,
  type PairingFailureDTO,
  type SidecarEvent,
} from '../index';
import type {
  BindingStateDTO,
  SharedFilesReachabilityDTO,
  WakeCapabilityDTO,
  WakeTargetDTO,
} from '../types';

function expectWakeTypes(
  target: WakeTargetDTO,
  wake: WakeCapabilityDTO,
  binding: BindingStateDTO,
  reachability: SharedFilesReachabilityDTO,
): void {
  expect(target.macAddress).toBe('aa:bb:cc:dd:ee:ff');
  expect(wake.targets[0]?.broadcastAddress).toBe('192.168.1.255');
  expect(binding.wake?.supported).toBe(true);
  expect(reachability.state).toBe('waking');
}

function assertTypeExports(
  _authorizationStatus: DesktopDeviceAuthorizationStatus,
  _blockStatus: DesktopDeviceBlockStatus,
  _resourceKind: DesktopResourceKind,
  _resourceStatus: DesktopResourceStatus,
  _accessAction: DesktopAccessAction,
  _recordResult: DesktopRecordResult,
  _device: DesktopManagedDeviceDTO,
  _connectionAttempt: DesktopConnectionAttemptDTO,
  _blockState: DesktopBlockStateDTO,
  _shared: DesktopSharedResourceDTO,
  _access: DesktopAccessRecordDTO,
  _sync: DesktopSyncRecordDTO,
  _listResponse: DesktopLocalListResponse<DesktopManagedDeviceDTO>,
  _addSharedResource: AddSharedResourcePayload,
  _library: ReceivedLibraryItemDTO,
  _recent: RecentDesktopDTO,
  _pairingFailure: PairingFailureDTO,
) {
  return true;
}

describe('@lynavo-drive/contracts exports', () => {
  it('does not model non-OSS distribution variants', () => {
    expect(typesSource).not.toMatch(/export type Distribution\b/);
  });

  it('exports PROTOCOL_VERSION', () => {
    expect(contracts.PROTOCOL_VERSION).toBe('LMUP/2');
  });
  it('exports APP_COMPATIBILITY_VERSION', () => {
    expect(contracts.APP_COMPATIBILITY_VERSION).toBe(1);
  });
  it('exports PROTOCOL_PORT', () => {
    expect(contracts.PROTOCOL_PORT).toBe(39393);
  });
  it('exports SIDECAR_HTTP_PORT', () => {
    expect(contracts.SIDECAR_HTTP_PORT).toBe(39394);
  });
  it('exports BONJOUR_SERVICE_TYPE', () => {
    expect(contracts.BONJOUR_SERVICE_TYPE).toBe('_lynavodrive._tcp');
  });
  it('exports all MessageType values', () => {
    expect(contracts.MessageType.HELLO_REQ).toBe(0x0001);
    expect(contracts.MessageType.ERROR).toBe(0x0011);
    expect(contracts.MessageType.PAIRING_INVALIDATED).toBe(0x0014);
    expect(Object.keys(contracts.MessageType)).toHaveLength(20);
  });
  it('exports all ErrorCode values', () => {
    expect(contracts.ErrorCode.PAIR_CODE_INVALID).toBe('PAIR_CODE_INVALID');
    expect(contracts.ErrorCode.APP_VERSION_INCOMPATIBLE).toBe('APP_VERSION_INCOMPATIBLE');
    expect(Object.keys(contracts.ErrorCode)).toHaveLength(15);
  });
  it('exports connection device management DTOs and pairing error codes', () => {
    const device: ConnectionDeviceDTO = {
      clientId: 'phone-a',
      displayName: 'Nick iPhone',
      clientName: 'Nick iPhone',
      platform: 'ios',
      ip: '192.168.1.20',
      status: 'authorized',
      authorizedAt: '2026-06-10T01:00:00Z',
      lastSeenAt: '2026-06-10T01:10:00Z',
    };
    const blocked: BlockedPairingClientDTO = {
      clientId: 'phone-a',
      displayName: 'Nick iPhone',
      clientName: 'Nick iPhone',
      platform: 'ios',
      lastIp: '192.168.1.20',
      failedAttempts: 3,
      blockedAt: '2026-06-10T01:11:00Z',
      lastAttemptAt: '2026-06-10T01:11:00Z',
      reason: 'wrong_connection_code_limit',
    };
    const attempt: PairingAttemptDTO = {
      id: 1,
      clientId: 'phone-a',
      displayName: 'Nick iPhone',
      clientName: 'Nick iPhone',
      platform: 'ios',
      ip: '192.168.1.20',
      result: 'wrong_code',
      failureReason: 'PAIRING_CODE_INVALID',
      createdAt: '2026-06-10T01:11:00Z',
    };
    const meta: PairingErrorMetadataDTO = {
      failedAttempts: 2,
      remainingAttempts: 1,
      maxAttempts: 3,
    };
    const settings: ConnectionDevicesSettingsDTO = {
      authorizedDevices: [device],
      blockedClients: [blocked],
      recentAttempts: [attempt],
    };

    expect(settings.authorizedDevices[0]?.clientId).toBe('phone-a');
    expect(meta.remainingAttempts).toBe(1);
    expect(ErrorCode.PAIRING_CODE_INVALID).toBe('PAIRING_CODE_INVALID');
    expect(ErrorCode.PAIRING_CLIENT_BLOCKED).toBe('PAIRING_CLIENT_BLOCKED');
    expect(ErrorCode.PAIR_TOKEN_INVALID).toBe('PAIR_TOKEN_INVALID');
    expect(ErrorCode.APP_VERSION_INCOMPATIBLE).toBe('APP_VERSION_INCOMPATIBLE');
  });
  it('exports BACKOFF_RETRY_MS', () => {
    expect(contracts.BACKOFF_RETRY_MS).toEqual([5000, 15000, 30000]);
  });
  it('exports desktop settings DTOs', () => {
    const settings: SettingsDTO = {
      deviceName: 'Office Mac',
      connectionCode: '123456',
      rootPath: '/Users/alice/Lynavo Drive',
      receivePath: '/Users/alice/Lynavo Drive/received',
      personalPath: '/Users/alice',
      sharedPath: '/Users/alice/Lynavo Drive/shared',
      shareAddress: '',
      shareStatus: 'ready',
      shareName: 'Office Mac',
      allowCrossDeviceReceivedAccess: true,
    };

    expect(settings.allowCrossDeviceReceivedAccess).toBe(true);
  });
  it('exports OSS repository support links without official API endpoints', () => {
    expect(contracts.LYNAVO_REPOSITORY_URL).toBe('https://github.com/lynavo/lynavo-drive');
    expect(contracts.LYNAVO_WEB_BASE_URL).toBe('https://github.com/lynavo/lynavo-drive');
    expect(contracts.LYNAVO_SUPPORT_URL).toBe('https://github.com/lynavo/lynavo-drive/issues');
    expect(contracts.LYNAVO_SECURITY_ADVISORY_URL).toBe(
      'https://github.com/lynavo/lynavo-drive/security/advisories/new',
    );
    expect(contracts.LYNAVO_PRIVACY_URL).toBe(
      'https://github.com/lynavo/lynavo-drive/blob/main/PRIVACY.md',
    );
    expect(contracts.LYNAVO_LICENSE_URL).toBe(
      'https://github.com/lynavo/lynavo-drive/blob/main/LICENSE',
    );
    expect('LYNAVO_API_BASE_URL' in contracts).toBe(false);
    expect('LYNAVO_REVIEW_API_BASE_URL' in contracts).toBe(false);
    expect('LYNAVO_SUPPORT_API_BASE_URL' in contracts).toBe(false);
    expect('LYNAVO_REVIEW_SUPPORT_API_BASE_URL' in contracts).toBe(false);
    expect('LYNAVO_SERVICE_ENDPOINTS' in contracts).toBe(false);
    expect('LYNAVO_SUPPORT_ENDPOINTS' in contracts).toBe(false);
    expect('LYNAVO_SUPPORT_EMAIL' in contracts).toBe(false);
    expect('LYNAVO_REVIEW_EMAIL' in contracts).toBe(false);
    const iosRedirectKey = ['LYNAVO', 'APPLE_REDIRECT_URI'].join('_');
    expect(iosRedirectKey in contracts).toBe(false);
    expect('LYNAVO_TURN_URL' in contracts).toBe(false);
  });

  it('exports the Lynavo Drive release channel type', () => {
    const channel: ReleaseChannel = 'prod';

    expect(channel).toBe('prod');
  });

  it('exports wake metadata DTOs and wake reachability states', () => {
    const target: WakeTargetDTO = {
      interfaceName: 'en0',
      macAddress: 'aa:bb:cc:dd:ee:ff',
      ipv4Address: '192.168.1.20',
      broadcastAddress: '192.168.1.255',
      ports: [9, 7],
    };
    const wake: WakeCapabilityDTO = {
      supported: true,
      targets: [target],
      updatedAt: '2026-06-09T03:00:00.000Z',
    };
    const binding: BindingStateDTO = {
      deviceId: 'desktop-1',
      deviceName: 'Studio Mac',
      deviceAlias: 'Studio Mac',
      host: '192.168.1.20',
      port: 39393,
      connectionState: 'offline',
      pairingId: 'pair-1',
      shareEnabled: true,
      shareName: 'My Computer',
      lastBoundAt: '2026-06-09T03:00:00.000Z',
      wake,
    };
    const reachability: SharedFilesReachabilityDTO = {
      deviceId: 'desktop-1',
      state: 'waking',
      route: null,
      reason: 'wake_attempt_started',
      updatedAt: '2026-06-09T03:00:01.000Z',
    };
    const setupRequired: SharedFilesReachabilityDTO = {
      ...reachability,
      state: 'wake_setup_required',
      reason: 'public_wake_requires_setup',
    };
    const unavailable: SharedFilesReachabilityDTO = {
      ...reachability,
      state: 'wake_unavailable',
      reason: 'wake_metadata_missing',
    };

    expectWakeTypes(target, wake, binding, reachability);
    expect(setupRequired.state).toBe('wake_setup_required');
    expect(unavailable.state).toBe('wake_unavailable');
  });
});

describe('desktop-local product exports', () => {
  it('exports management event constants', () => {
    expect(SIDECAR_EVENT_TYPES.DEVICE_MANAGEMENT_UPDATED).toBe('device.management.updated');
    expect(SIDECAR_EVENT_TYPES.SHARED_RESOURCES_UPDATED).toBe('shared.resources.updated');
    expect(SIDECAR_EVENT_TYPES.ACCESS_RECORDS_UPDATED).toBe('access.records.updated');
  });

  it('exports the video thumbnail request event type', () => {
    expect(SIDECAR_EVENT_TYPES.VIDEO_THUMBNAIL_REQUEST).toBe('video.thumbnail.request');

    const event: SidecarEvent = {
      type: SIDECAR_EVENT_TYPES.VIDEO_THUMBNAIL_REQUEST,
      payload: {
        requestId: 'req-1',
        sourcePath: '/tmp/source.mov',
        cachePath: '/tmp/thumbnail-cache/aa/cache.jpg',
        sourceVersion: '1024-123-v1',
        maxEdge: 256,
        quality: 80,
      },
    };

    expect(event.payload.maxEdge).toBe(256);
  });
});
