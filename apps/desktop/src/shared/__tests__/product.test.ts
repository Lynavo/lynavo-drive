import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  APP_STORAGE_IDENTITY_NAME,
  PRODUCT_DISTRIBUTION,
  PRODUCT_NAME,
  getProductName,
  getProductReleaseChannel,
  isLynavoGlobalProduct,
  resolveLynavoApiBaseUrl,
  shouldUseLynavoReviewTarget,
} from '../product';

describe('desktop product helper', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses Lynavo Drive as the visible product name', () => {
    expect(PRODUCT_NAME).toBe('Lynavo Drive');
    expect(getProductName()).toBe('Lynavo Drive');
  });

  it('preserves the existing Electron storage identity for this commercial removal task', () => {
    expect(APP_STORAGE_IDENTITY_NAME).toBe('Vivi Drop');
    expect(APP_STORAGE_IDENTITY_NAME).not.toBe(getProductName());
  });

  it('does not let the legacy market env affect product identity', () => {
    vi.stubEnv('SYNCFLOW_MARKET', 'cn');

    expect(getProductName()).toBe('Lynavo Drive');
    expect(isLynavoGlobalProduct()).toBe(true);
  });

  it('resolves release channel from Lynavo env only', () => {
    vi.stubEnv('SYNCFLOW_MARKET', 'global');
    vi.stubEnv('LYNAVO_RELEASE_CHANNEL', 'review');

    expect(getProductReleaseChannel()).toBe('review');
    expect(PRODUCT_DISTRIBUTION).toBe('community');
  });

  it('resolves the plain API base from Lynavo env or the Lynavo default only', () => {
    expect(
      resolveLynavoApiBaseUrl({
        LYNAVO_API_BASE_URL: 'https://api.lynavo.example',
        VIVIDROP_API_BASE_URL: 'https://api.vividrop-legacy.example',
        SYNCFLOW_API_BASE_URL: 'https://api.syncflow-legacy.example',
      }),
    ).toBe('https://api.lynavo.example');

    expect(
      resolveLynavoApiBaseUrl({
        VIVIDROP_API_BASE_URL: 'https://api.vividrop-legacy.example',
        SYNCFLOW_API_BASE_URL: 'https://api.syncflow-legacy.example',
      }),
    ).toBe('https://api.lynavo.com');

    expect(
      resolveLynavoApiBaseUrl({
        SYNCFLOW_API_BASE_URL: 'https://api.syncflow-legacy.example',
      }),
    ).toBe('https://api.lynavo.com');
  });

  it('uses only Lynavo release channel or plain Lynavo API URL for review target selection', () => {
    expect(shouldUseLynavoReviewTarget({ LYNAVO_RELEASE_CHANNEL: 'review' })).toBe(true);
    expect(
      shouldUseLynavoReviewTarget({ LYNAVO_API_BASE_URL: 'https://review-api.lynavo.com' }),
    ).toBe(true);

    expect(
      shouldUseLynavoReviewTarget({
        SYNCFLOW_RELEASE_PROFILE: 'global-review',
        VIVIDROP_API_BASE_URL: 'https://review-api.vividrop.cn',
        SYNCFLOW_API_BASE_URL: 'https://review-api.vividrop.cn',
        SYNCFLOW_AUTH_BASE_URL: 'https://review-api.vividrop.cn',
        SYNCFLOW_AUTH_REVIEW_BASE_URL: 'https://review-api.vividrop.cn',
      }),
    ).toBe(false);
  });
});
