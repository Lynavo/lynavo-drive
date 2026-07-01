import { describe, it, expect } from 'vitest';
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
  type Distribution,
  type DriveEntitlements,
  type DriveFeatureKey,
  type EntitlementSource,
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
      remoteAccessEnabled: true,
      allowCrossDeviceReceivedAccess: true,
    };

    expect(settings.allowCrossDeviceReceivedAccess).toBe(true);
  });
  it('exports mobile country code data', () => {
    expect(contracts.COUNTRY_CODES.find((country) => country.iso === 'CN')?.code).toBe('+86');
    expect(contracts.COUNTRY_CODES.find((country) => country.iso === 'TW')?.code).toBe('+886');
  });
  it('does not export legacy Lynavo Drive commercial endpoint constants', () => {
    const legacyPrefix = ['VIVI', 'DROP_'].join('');
    const legacyEndpoints = ['VIVI', 'DROP_SERVICE_ENDPOINTS'].join('');
    expect(Object.keys(contracts).filter((key) => key.startsWith(legacyPrefix))).toEqual([]);
    expect(legacyEndpoints in contracts).toBe(false);
  });

  it('exports Lynavo Drive service endpoints on lynavo.com domains', () => {
    expect(contracts.LYNAVO_ROOT_DOMAIN).toBe('lynavo.com');
    expect(contracts.LYNAVO_WEB_BASE_URL).toBe('https://www.lynavo.com');
    expect(contracts.LYNAVO_API_BASE_URL).toBe('https://api.lynavo.com');
    expect(contracts.LYNAVO_REVIEW_API_BASE_URL).toBe('https://review-api.lynavo.com');
    expect(contracts.LYNAVO_SUPPORT_EMAIL).toBe('support@lynavo.com');
    expect(contracts.LYNAVO_REVIEW_EMAIL).toBe('review@lynavo.com');
    expect(contracts.LYNAVO_APPLE_REDIRECT_URI).toBe('https://api.lynavo.com/auth/apple/callback');
    expect('LYNAVO_TURN_URL' in contracts).toBe(false);
    expect(contracts.LYNAVO_SERVICE_ENDPOINTS).toEqual({
      webBaseUrl: 'https://www.lynavo.com',
      apiBaseUrl: 'https://api.lynavo.com',
      reviewApiBaseUrl: 'https://review-api.lynavo.com',
      supportEmail: 'support@lynavo.com',
      reviewEmail: 'review@lynavo.com',
      appleRedirectUri: 'https://api.lynavo.com/auth/apple/callback',
    });
  });

  it('exports Lynavo Drive release, distribution, feature, and entitlement types', () => {
    const channel: ReleaseChannel = 'prod';
    const distribution: Distribution = 'official';
    const features: DriveFeatureKey[] = ['lan_foreground_auto_upload'];
    const sources: EntitlementSource[] = [
      'guest',
      'free_account',
      'subscription',
      'trial',
      'gift_card',
      'legacy',
      'official_override',
      'unknown',
    ];
    const entitlements: DriveEntitlements = {
      canUseLanForegroundAutoUpload: true,
      source: 'free_account',
      expiresAt: null,
      checkedAt: '2026-06-29T00:00:00.000Z',
    };

    expect(channel).toBe('prod');
    expect(distribution).toBe('official');
    expect(features).toEqual(['lan_foreground_auto_upload']);
    expect(sources).toEqual([
      'guest',
      'free_account',
      'subscription',
      'trial',
      'gift_card',
      'legacy',
      'official_override',
      'unknown',
    ]);
    expect(entitlements).not.toHaveProperty('canUseRemoteTunnel');
    expect(entitlements).not.toHaveProperty('canUseBackgroundContinuation');
  });

  it('resolves guest entitlements with foreground LAN fail-open and no commercial capability fields', () => {
    expect(
      contracts.resolveDriveEntitlements({
        isAuthenticated: false,
        serverEntitlements: null,
        now: '2026-06-29T00:00:00.000Z',
      }),
    ).toEqual({
      canUseLanForegroundAutoUpload: true,
      source: 'guest',
      expiresAt: null,
      checkedAt: '2026-06-29T00:00:00.000Z',
    });
  });

  it('resolves free authenticated users without server entitlements as foreground-only', () => {
    expect(
      contracts.resolveDriveEntitlements({
        isAuthenticated: true,
        serverEntitlements: null,
        now: '2026-06-29T00:00:00.000Z',
      }),
    ).toEqual({
      canUseLanForegroundAutoUpload: true,
      source: 'free_account',
      expiresAt: null,
      checkedAt: '2026-06-29T00:00:00.000Z',
    });
  });

  it('keeps background and remote disabled even when server paid entitlements are active', () => {
    expect(
      contracts.resolveDriveEntitlements({
        isAuthenticated: true,
        serverEntitlements: {
          source: 'subscription',
          expiresAt: '2026-07-29T00:00:00.000Z',
          checkedAt: '2026-06-29T00:00:00.000Z',
        },
        now: '2026-06-29T00:00:00.000Z',
      }),
    ).toEqual({
      canUseLanForegroundAutoUpload: true,
      source: 'subscription',
      expiresAt: '2026-07-29T00:00:00.000Z',
      checkedAt: '2026-06-29T00:00:00.000Z',
    });
  });

  it('fails paid features closed for expired server entitlements', () => {
    expect(
      contracts.resolveDriveEntitlements({
        isAuthenticated: true,
        serverEntitlements: {
          source: 'trial',
          expiresAt: '2026-06-28T23:59:59.999Z',
          checkedAt: '2026-06-28T00:00:00.000Z',
        },
        now: '2026-06-29T00:00:00.000Z',
      }),
    ).toEqual({
      canUseLanForegroundAutoUpload: true,
      source: 'trial',
      expiresAt: '2026-06-28T23:59:59.999Z',
      checkedAt: '2026-06-29T00:00:00.000Z',
    });
  });

  it('fails paid features closed when expiresAt is invalid', () => {
    expect(
      contracts.resolveDriveEntitlements({
        isAuthenticated: true,
        serverEntitlements: {
          source: 'subscription',
          expiresAt: 'not-a-date',
          checkedAt: '2026-06-29T00:00:00.000Z',
        },
        now: '2026-06-29T00:00:00.000Z',
      }),
    ).toEqual({
      canUseLanForegroundAutoUpload: true,
      source: 'subscription',
      expiresAt: 'not-a-date',
      checkedAt: '2026-06-29T00:00:00.000Z',
    });
  });

  it('fails paid features closed when now is invalid', () => {
    expect(
      contracts.resolveDriveEntitlements({
        isAuthenticated: true,
        serverEntitlements: {
          source: 'subscription',
          expiresAt: '2026-07-29T00:00:00.000Z',
          checkedAt: '2026-06-29T00:00:00.000Z',
        },
        now: new Date('not-a-date'),
      }),
    ).toEqual({
      canUseLanForegroundAutoUpload: true,
      source: 'subscription',
      expiresAt: '2026-07-29T00:00:00.000Z',
      checkedAt: null,
    });
  });

  it('fails subscription paid features closed when expiresAt is null', () => {
    expect(
      contracts.resolveDriveEntitlements({
        isAuthenticated: true,
        serverEntitlements: {
          source: 'subscription',
          expiresAt: null,
          checkedAt: '2026-06-29T00:00:00.000Z',
        },
        now: '2026-06-29T00:00:00.000Z',
      }),
    ).toEqual({
      canUseLanForegroundAutoUpload: true,
      source: 'subscription',
      expiresAt: null,
      checkedAt: '2026-06-29T00:00:00.000Z',
    });
  });

  it('fails trial paid features closed when expiresAt is null', () => {
    expect(
      contracts.resolveDriveEntitlements({
        isAuthenticated: true,
        serverEntitlements: {
          source: 'trial',
          expiresAt: null,
          checkedAt: '2026-06-29T00:00:00.000Z',
        },
        now: '2026-06-29T00:00:00.000Z',
      }),
    ).toEqual({
      canUseLanForegroundAutoUpload: true,
      source: 'trial',
      expiresAt: null,
      checkedAt: '2026-06-29T00:00:00.000Z',
    });
  });

  const nullablePaidSources: EntitlementSource[] = ['gift_card', 'legacy', 'official_override'];

  for (const source of nullablePaidSources) {
    it(`fails ${source} paid features closed when expiresAt is missing`, () => {
      expect(
        contracts.resolveDriveEntitlements({
          isAuthenticated: true,
          serverEntitlements: {
            source,
            checkedAt: '2026-06-29T00:00:00.000Z',
          },
          now: '2026-06-29T00:00:00.000Z',
        }),
      ).toEqual({
        canUseLanForegroundAutoUpload: true,
        source,
        expiresAt: null,
        checkedAt: '2026-06-29T00:00:00.000Z',
      });
    });
  }

  it('fails gift card paid features closed when expiresAt is null', () => {
    expect(
      contracts.resolveDriveEntitlements({
        isAuthenticated: true,
        serverEntitlements: {
          source: 'gift_card',
          expiresAt: null,
          checkedAt: '2026-06-29T00:00:00.000Z',
        },
        now: '2026-06-29T00:00:00.000Z',
      }),
    ).toEqual({
      canUseLanForegroundAutoUpload: true,
      source: 'gift_card',
      expiresAt: null,
      checkedAt: '2026-06-29T00:00:00.000Z',
    });
  });

  it('fails legacy paid features closed when expiresAt is null', () => {
    expect(
      contracts.resolveDriveEntitlements({
        isAuthenticated: true,
        serverEntitlements: {
          source: 'legacy',
          expiresAt: null,
          checkedAt: '2026-06-29T00:00:00.000Z',
        },
        now: '2026-06-29T00:00:00.000Z',
      }),
    ).toEqual({
      canUseLanForegroundAutoUpload: true,
      source: 'legacy',
      expiresAt: null,
      checkedAt: '2026-06-29T00:00:00.000Z',
    });
  });

  it('fails official override paid features closed when expiresAt is null', () => {
    expect(
      contracts.resolveDriveEntitlements({
        isAuthenticated: true,
        serverEntitlements: {
          source: 'official_override',
          expiresAt: null,
          checkedAt: '2026-06-29T00:00:00.000Z',
        },
        now: '2026-06-29T00:00:00.000Z',
      }),
    ).toEqual({
      canUseLanForegroundAutoUpload: true,
      source: 'official_override',
      expiresAt: null,
      checkedAt: '2026-06-29T00:00:00.000Z',
    });
  });

  it('fails gift card paid features closed when expiresAt is invalid', () => {
    expect(
      contracts.resolveDriveEntitlements({
        isAuthenticated: true,
        serverEntitlements: {
          source: 'gift_card',
          expiresAt: 'not-a-date',
          checkedAt: '2026-06-29T00:00:00.000Z',
        },
        now: '2026-06-29T00:00:00.000Z',
      }),
    ).toEqual({
      canUseLanForegroundAutoUpload: true,
      source: 'gift_card',
      expiresAt: 'not-a-date',
      checkedAt: '2026-06-29T00:00:00.000Z',
    });
  });

  it('fails paid features closed when now string is invalid', () => {
    expect(
      contracts.resolveDriveEntitlements({
        isAuthenticated: true,
        serverEntitlements: {
          source: 'gift_card',
          expiresAt: null,
          checkedAt: '2026-06-29T00:00:00.000Z',
        },
        now: 'not-a-date',
      }),
    ).toEqual({
      canUseLanForegroundAutoUpload: true,
      source: 'gift_card',
      expiresAt: null,
      checkedAt: null,
    });
  });

  it('fails paid features closed when expiresAt equals now', () => {
    expect(
      contracts.resolveDriveEntitlements({
        isAuthenticated: true,
        serverEntitlements: {
          source: 'gift_card',
          expiresAt: '2026-06-29T00:00:00.000Z',
          checkedAt: '2026-06-29T00:00:00.000Z',
        },
        now: '2026-06-29T00:00:00.000Z',
      }),
    ).toEqual({
      canUseLanForegroundAutoUpload: true,
      source: 'gift_card',
      expiresAt: '2026-06-29T00:00:00.000Z',
      checkedAt: '2026-06-29T00:00:00.000Z',
    });
  });

  it('fails paid features closed when checkedAt is missing', () => {
    expect(
      contracts.resolveDriveEntitlements({
        isAuthenticated: true,
        serverEntitlements: {
          source: 'subscription',
          expiresAt: '2026-07-29T00:00:00.000Z',
        },
        now: '2026-06-29T00:00:00.000Z',
      }),
    ).toEqual({
      canUseLanForegroundAutoUpload: true,
      source: 'subscription',
      expiresAt: '2026-07-29T00:00:00.000Z',
      checkedAt: '2026-06-29T00:00:00.000Z',
    });
  });

  it('fails paid features closed when checkedAt is invalid', () => {
    expect(
      contracts.resolveDriveEntitlements({
        isAuthenticated: true,
        serverEntitlements: {
          source: 'subscription',
          expiresAt: '2026-07-29T00:00:00.000Z',
          checkedAt: 'not-a-date',
        },
        now: '2026-06-29T00:00:00.000Z',
      }),
    ).toEqual({
      canUseLanForegroundAutoUpload: true,
      source: 'subscription',
      expiresAt: '2026-07-29T00:00:00.000Z',
      checkedAt: '2026-06-29T00:00:00.000Z',
    });
  });

  it('fails paid features closed when checkedAt is stale', () => {
    expect(
      contracts.resolveDriveEntitlements({
        isAuthenticated: true,
        serverEntitlements: {
          source: 'subscription',
          expiresAt: '2026-07-29T00:00:00.000Z',
          checkedAt: '2026-06-27T23:59:59.999Z',
        },
        now: '2026-06-29T00:00:00.000Z',
      }),
    ).toEqual({
      canUseLanForegroundAutoUpload: true,
      source: 'subscription',
      expiresAt: '2026-07-29T00:00:00.000Z',
      checkedAt: '2026-06-29T00:00:00.000Z',
    });
  });

  it('fails paid features closed when checkedAt is in the future', () => {
    expect(
      contracts.resolveDriveEntitlements({
        isAuthenticated: true,
        serverEntitlements: {
          source: 'subscription',
          expiresAt: '2026-07-29T00:00:00.000Z',
          checkedAt: '2026-06-29T00:00:00.001Z',
        },
        now: '2026-06-29T00:00:00.000Z',
      }),
    ).toEqual({
      canUseLanForegroundAutoUpload: true,
      source: 'subscription',
      expiresAt: '2026-07-29T00:00:00.000Z',
      checkedAt: '2026-06-29T00:00:00.000Z',
    });
  });

  it('treats unknown server entitlement data as free foreground-only access', () => {
    expect(
      contracts.resolveDriveEntitlements({
        isAuthenticated: true,
        serverEntitlements: { plan: 'unknown' },
        now: '2026-06-29T00:00:00.000Z',
      }),
    ).toEqual({
      canUseLanForegroundAutoUpload: true,
      source: 'unknown',
      expiresAt: null,
      checkedAt: '2026-06-29T00:00:00.000Z',
    });
  });

  it('fails paid features closed when server source is invalid', () => {
    expect(
      contracts.resolveDriveEntitlements({
        isAuthenticated: true,
        serverEntitlements: {
          source: '__invalid__',
          expiresAt: '2026-07-29T00:00:00.000Z',
          checkedAt: '2026-06-29T00:00:00.000Z',
        },
        now: '2026-06-29T00:00:00.000Z',
      }),
    ).toEqual({
      canUseLanForegroundAutoUpload: true,
      source: 'unknown',
      expiresAt: '2026-07-29T00:00:00.000Z',
      checkedAt: '2026-06-29T00:00:00.000Z',
    });
  });

  it('fails official-only capabilities closed when the module is unavailable', () => {
    expect(
      contracts.resolveDriveEntitlements({
        isAuthenticated: true,
        serverEntitlements: {
          source: 'subscription',
          expiresAt: '2026-07-29T00:00:00.000Z',
          checkedAt: '2026-06-29T00:00:00.000Z',
        },
        now: '2026-06-29T00:00:00.000Z',
      }),
    ).toEqual({
      canUseLanForegroundAutoUpload: true,
      source: 'subscription',
      expiresAt: '2026-07-29T00:00:00.000Z',
      checkedAt: '2026-06-29T00:00:00.000Z',
    });
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
