import {
  getAppConfig,
  normalizePublicIPv4,
  refreshNativeAppFeatureSettings,
} from '../app-config-service';
import { setBackgroundSilentAudioEnabled } from '../SyncEngineModule';

jest.mock('../SyncEngineModule', () => ({
  setBackgroundSilentAudioEnabled: jest.fn(),
}));

describe('app-config-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns OSS local defaults without commercial feature switches', async () => {
    await expect(getAppConfig()).resolves.toEqual({
      backgroundSilentAudio: { enabled: false },
      network: { callerPublicIp: null },
    });
  });

  it('does not ship the unused remote tunnel credentials service module', () => {
    const modulePath = [
      '..',
      ['tunnel', 'credentials', 'service'].join('-'),
    ].join('/');

    expect(() => jest.requireActual(modulePath)).toThrow(/Cannot find module/);
  });

  it('normalizes only routable public IPv4 addresses for legacy callers', () => {
    expect(normalizePublicIPv4('8.8.8.8')).toBe('8.8.8.8');
    expect(normalizePublicIPv4('192.168.1.10')).toBeNull();
    expect(normalizePublicIPv4('bad')).toBeNull();
  });

  it('always disables native background silent audio in the OSS runtime', async () => {
    await refreshNativeAppFeatureSettings();

    expect(setBackgroundSilentAudioEnabled).toHaveBeenCalledWith(false);
  });
});
