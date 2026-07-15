import { appConfig } from '../app-config';

const token = (parts: string[]) => parts.join('');

describe('appConfig', () => {
  test('uses the single LynavoDriveDemo mobile identity', () => {
    expect(appConfig.productName).toBe('LynavoDriveDemo');
    expect(appConfig.bundleId).toBe('com.lynavo.drive.mobile.demo');
  });

  test('uses OSS repository links without official service endpoints', () => {
    expect(appConfig.endpoints).toEqual({
      webBaseUrl: 'https://github.com/lynavo/lynavo-drive',
      supportUrl: 'https://github.com/lynavo/lynavo-drive/issues',
      securityAdvisoryUrl:
        'https://github.com/lynavo/lynavo-drive/security/advisories/new',
    });
    expect('turnUrl' in appConfig.endpoints).toBe(false);
    expect('apiBaseUrl' in appConfig.endpoints).toBe(false);
    expect('reviewApiBaseUrl' in appConfig.endpoints).toBe(false);
    expect('supportEmail' in appConfig.endpoints).toBe(false);
    expect(token(['support', 'ApiBaseUrl']) in appConfig.endpoints).toBe(false);
    expect(
      token(['review', 'Support', 'ApiBaseUrl']) in appConfig.endpoints,
    ).toBe(false);
    expect(appConfig.legal).toEqual({
      privacyUrl: 'https://github.com/lynavo/lynavo-drive/blob/main/PRIVACY.md',
      termsUrl: 'https://github.com/lynavo/lynavo-drive/blob/main/LICENSE',
    });
  });

  test('does not expose official login provider configuration in the OSS runtime', () => {
    expect('loginProviders' in appConfig).toBe(false);
    expect('appReview' in appConfig).toBe(false);
    expect('appleRedirectUri' in appConfig.endpoints).toBe(false);
  });

  test('does not expose IAP product configuration in the OSS runtime', () => {
    expect('iap' in appConfig).toBe(false);
  });
});
