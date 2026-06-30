import { PROTOCOL_PORT } from '@lynavo-drive/contracts';

import {
  buildManualPairDevice,
  normalizeManualPairHost,
} from '../deviceDiscoveryManualPairing';

describe('deviceDiscoveryManualPairing', () => {
  it('normalizes a valid IPv4 address', () => {
    expect(normalizeManualPairHost(' 192.168.0.1 ')).toBe('192.168.0.1');
  });

  it('rejects an invalid IPv4 address', () => {
    expect(normalizeManualPairHost('172.16.8.999')).toBeNull();
  });

  it('normalizes a valid hostname/local domain name', () => {
    expect(normalizeManualPairHost('desktop.local')).toBe('desktop.local');
    expect(normalizeManualPairHost('macbook.tailscale.net')).toBe('macbook.tailscale.net');
    expect(normalizeManualPairHost(' localhost ')).toBe('localhost');
  });

  it('rejects invalid hostnames/URLs', () => {
    expect(normalizeManualPairHost('desktop/local')).toBeNull();
    expect(normalizeManualPairHost('http://desktop.local')).toBeNull();
    expect(normalizeManualPairHost('my_mac')).toBeNull();
  });

  it('builds a manual pairing device from a valid IPv4 address', () => {
    expect(buildManualPairDevice('192.168.0.1')).toEqual({
      deviceId: 'manual-192.168.0.1',
      name: '192.168.0.1',
      ip: '192.168.0.1',
      type: 'win',
      port: PROTOCOL_PORT,
    });
  });

  it('returns null when building a manual pairing device from invalid input', () => {
    expect(buildManualPairDevice('172.16.8')).toBeNull();
  });

  it('normalizes a valid IPv6 address (with or without brackets)', () => {
    expect(normalizeManualPairHost(' 2408:8123::100 ')).toBe('2408:8123::100');
    expect(normalizeManualPairHost('[2408:8123::100]')).toBe('2408:8123::100');
  });

  it('builds a manual pairing device from a valid IPv6 address', () => {
    expect(buildManualPairDevice('[240e:476:3c0:9f3b:105e:1834:396d:dbaa]')).toEqual({
      deviceId: 'manual-240e:476:3c0:9f3b:105e:1834:396d:dbaa',
      name: '240e:476:3c0:9f3b:105e:1834:396d:dbaa',
      ip: '240e:476:3c0:9f3b:105e:1834:396d:dbaa',
      type: 'win',
      port: PROTOCOL_PORT,
    });
  });
});
