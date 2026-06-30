import { appConfig } from '../app-config';

describe('appConfig', () => {
  test('uses the single Lynavo Drive mobile identity without market fields', () => {
    expect(appConfig.productName).toBe('Lynavo Drive');
    expect(appConfig.bundleId).toBe('com.lynavo.drive.mobile');
    expect('market' in appConfig).toBe(false);
    expect(JSON.stringify(appConfig)).not.toContain('"market"');
  });

  test('does not carry a cn fallback in the config payload', () => {
    expect(JSON.stringify(appConfig)).not.toContain('"cn"');
  });

  test('uses Lynavo global service endpoints and support contacts', () => {
    expect(appConfig.endpoints).toEqual({
      webBaseUrl: 'https://www.lynavo.com',
      apiBaseUrl: 'https://api.lynavo.com',
      reviewApiBaseUrl: 'https://review-api.lynavo.com',
      supportEmail: 'support@lynavo.com',
    });
    expect('turnUrl' in appConfig.endpoints).toBe(false);
    expect(appConfig.legal).toEqual({
      privacyUrl: 'https://www.lynavo.com/privacy',
      termsUrl: 'https://www.lynavo.com/terms',
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
