import { PROTOCOL_PORT, type DiscoveredDeviceDTO } from '@syncflow/contracts';

export type ManualPairDevice = Pick<DiscoveredDeviceDTO, 'deviceId' | 'name' | 'ip' | 'type' | 'port'>;

const IPV4_SEGMENT_PATTERN = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

export function normalizeManualPairHost(rawHost: string): string | null {
  const host = rawHost.trim();
  const segments = host.split('.');

  if (segments.length !== 4) {
    return null;
  }

  if (!segments.every((segment) => IPV4_SEGMENT_PATTERN.test(segment))) {
    return null;
  }

  return host;
}

export function buildManualPairDevice(rawHost: string): ManualPairDevice | null {
  const host = normalizeManualPairHost(rawHost);

  if (!host) {
    return null;
  }

  return {
    deviceId: `manual-${host}`,
    name: host,
    ip: host,
    type: 'win',
    port: PROTOCOL_PORT,
  };
}
