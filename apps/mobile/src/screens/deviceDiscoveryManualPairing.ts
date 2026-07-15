import {
  PROTOCOL_PORT,
  type DiscoveredDeviceDTO,
} from '@lynavo-drive/contracts';

export type ManualPairDevice = Pick<
  DiscoveredDeviceDTO,
  'deviceId' | 'name' | 'ip' | 'type' | 'port'
>;

const HOSTNAME_PATTERN =
  /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
const IPV4_SEGMENT_PATTERN = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

export function normalizeManualPairHost(rawHost: string): string | null {
  let host = rawHost.trim();
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }

  // If it only contains digits and dots, it must be validated strictly as a 4-segment IPv4
  const isNumericOnly = /^[0-9.]+$/.test(host);
  if (isNumericOnly) {
    const segments = host.split('.');
    if (
      segments.length === 4 &&
      segments.every(segment => IPV4_SEGMENT_PATTERN.test(segment))
    ) {
      return host;
    }
    return null;
  }

  // IPv6 validation
  const ipv6Regex = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}(%.+)?$/;
  if (host.includes(':') && ipv6Regex.test(host)) {
    return host;
  }

  // Hostname/FQDN validation (e.g. desktop.local, macbook.tailscale.net)
  if (HOSTNAME_PATTERN.test(host)) {
    return host.toLowerCase();
  }

  return null;
}

export function buildManualPairDevice(
  rawHost: string,
): ManualPairDevice | null {
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
