import { describe, it, expect } from 'vitest';
import * as contracts from '../index';
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

describe('@syncflow/contracts exports', () => {
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
  it('exports all MessageType values', () => {
    expect(contracts.MessageType.HELLO_REQ).toBe(0x0001);
    expect(contracts.MessageType.ERROR).toBe(0x0011);
    expect(Object.keys(contracts.MessageType)).toHaveLength(17);
  });
  it('exports all ErrorCode values', () => {
    expect(contracts.ErrorCode.PAIR_CODE_INVALID).toBe('PAIR_CODE_INVALID');
    expect(contracts.ErrorCode.APP_VERSION_INCOMPATIBLE).toBe('APP_VERSION_INCOMPATIBLE');
    expect(Object.keys(contracts.ErrorCode)).toHaveLength(13);
  });
  it('exports BACKOFF_RETRY_MS', () => {
    expect(contracts.BACKOFF_RETRY_MS).toEqual([5000, 15000, 30000]);
  });
  it('exports mobile country code data', () => {
    expect(contracts.COUNTRY_CODES.find((country) => country.iso === 'CN')?.code).toBe('+86');
    expect(contracts.COUNTRY_CODES.find((country) => country.iso === 'TW')?.code).toBe('+886');
  });
  it('exports Vivi Drop service endpoints on vividrop.cn domains', () => {
    expect(contracts.VIVIDROP_WEB_BASE_URL).toBe('https://www.vividrop.cn');
    expect(contracts.VIVIDROP_API_BASE_URL).toBe('https://api.vividrop.cn');
    expect(contracts.VIVIDROP_GLOBAL_API_BASE_URL).toBe('https://global-api.vividrop.cn');
    expect(contracts.VIVIDROP_REVIEW_API_BASE_URL).toBe('https://review-api.vividrop.cn');
    expect(contracts.VIVIDROP_SUPPORT_EMAIL).toBe('support@vividrop.cn');
    expect(contracts.VIVIDROP_APPLE_GLOBAL_REDIRECT_URI).toBe(
      'https://global-api.vividrop.cn/auth/apple/callback',
    );
    expect(JSON.stringify(contracts.VIVIDROP_SERVICE_ENDPOINTS)).not.toContain(
      ['vividrop', 'com'].join('.'),
    );
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
