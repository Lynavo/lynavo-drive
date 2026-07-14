import { PROTOCOL_PORT } from '@lynavo-drive/contracts';

type BaseDiscoveredDevice = {
  deviceId: string;
  name: string;
  ip: string;
  port?: number;
};

type BaseRecentDesktop = {
  desktopDeviceId: string;
  host: string;
  port?: number;
};

const IPV4_WITH_OPTIONAL_PORT = /^(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{1,5}))?$/;

function normalizePort(port: number | undefined): number | undefined {
  if (
    port !== undefined &&
    Number.isInteger(port) &&
    port > 0 &&
    port <= 65535
  ) {
    return port;
  }
  return undefined;
}

function parseIPv4HostPort(value: string): { host: string; port?: number } {
  const trimmed = value.trim();
  const match = IPV4_WITH_OPTIONAL_PORT.exec(trimmed);
  if (!match) {
    return { host: trimmed };
  }

  const parsedPort = match[2] ? Number(match[2]) : undefined;
  return {
    host: match[1],
    port: normalizePort(parsedPort),
  };
}

function looksLikeIPv4(value: string): boolean {
  return IPV4_WITH_OPTIONAL_PORT.test(value.trim());
}

function isFallbackDeviceId(deviceId: string): boolean {
  const normalized = deviceId.trim().toLowerCase();
  return (
    normalized.startsWith('fallback-') ||
    normalized.startsWith('fallback|') ||
    looksLikeIPv4(normalized)
  );
}

function deviceQualityScore(device: BaseDiscoveredDevice): number {
  let score = 0;
  const name = device.name.trim();

  if (name.length > 0 && !looksLikeIPv4(name)) {
    score += 4;
  }
  if (!isFallbackDeviceId(device.deviceId)) {
    score += 2;
  }
  if (device.ip.trim().length > 0) {
    score += 1;
  }
  return score;
}

function normalizeDevice<T extends BaseDiscoveredDevice>(device: T): T {
  const parsed = parseIPv4HostPort(device.ip);
  return {
    ...device,
    ip: parsed.host,
    port: normalizePort(device.port) ?? parsed.port ?? PROTOCOL_PORT,
  };
}

function endpointKey(
  hostValue: string,
  port: number | undefined,
): string | null {
  const parsed = parseIPv4HostPort(hostValue);
  const host = parsed.host.trim().toLowerCase();
  if (!host) {
    return null;
  }
  return `host:${host}:${normalizePort(port) ?? parsed.port ?? PROTOCOL_PORT}`;
}

function dedupeKey(device: BaseDiscoveredDevice): string {
  return endpointKey(device.ip, device.port) ?? `id:${device.deviceId}`;
}

export function normalizeDiscoveredDevices<T extends BaseDiscoveredDevice>(
  devices: T[],
): T[] {
  const deduped = new Map<string, T>();

  for (const rawDevice of devices) {
    const device = normalizeDevice(rawDevice);
    const key = dedupeKey(device);
    const existing = deduped.get(key);

    if (!existing) {
      deduped.set(key, device);
      continue;
    }

    if (deviceQualityScore(device) > deviceQualityScore(existing)) {
      deduped.set(key, device);
    }
  }

  return Array.from(deduped.values());
}

export function recentDesktopMatchesDiscoveredDevice(
  recent: BaseRecentDesktop,
  device: BaseDiscoveredDevice,
): boolean {
  if (recent.desktopDeviceId === device.deviceId) {
    return true;
  }

  const recentEndpointKey = endpointKey(recent.host, recent.port);
  const deviceEndpointKey = endpointKey(device.ip, device.port);
  return recentEndpointKey !== null && recentEndpointKey === deviceEndpointKey;
}
