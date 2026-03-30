import { PROTOCOL_PORT } from '@syncflow/contracts';

import {
  buildManualPairDevice,
  normalizeManualPairHost,
} from '../deviceDiscoveryManualPairing';

describe('deviceDiscoveryManualPairing', () => {
  it('normalizes a valid IPv4 address', () => {
    expect(normalizeManualPairHost(' 172.16.8.83 ')).toBe('172.16.8.83');
  });

  it('rejects an invalid IPv4 address', () => {
    expect(normalizeManualPairHost('172.16.8.999')).toBeNull();
    expect(normalizeManualPairHost('desktop.local')).toBeNull();
  });

  it('builds a manual pairing device from a valid IPv4 address', () => {
    expect(buildManualPairDevice('172.16.8.83')).toEqual({
      deviceId: 'manual-172.16.8.83',
      name: '172.16.8.83',
      ip: '172.16.8.83',
      type: 'win',
      port: PROTOCOL_PORT,
    });
  });

  it('returns null when building a manual pairing device from invalid input', () => {
    expect(buildManualPairDevice('172.16.8')).toBeNull();
  });
});
