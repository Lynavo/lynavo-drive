import {
  LYNAVO_SUPPORT_EMAIL,
  LYNAVO_WEB_BASE_URL,
} from '@lynavo-drive/contracts';

interface AppConfigEndpoints {
  readonly webBaseUrl: string;
  readonly supportEmail: string;
}

interface AppConfigLegal {
  readonly privacyUrl: string;
  readonly termsUrl: string;
}

export interface AppConfig {
  readonly productName: string;
  readonly bundleId: string;
  readonly endpoints: AppConfigEndpoints;
  readonly legal: AppConfigLegal;
}

const LYNAVO_ENDPOINTS: AppConfigEndpoints = {
  webBaseUrl: LYNAVO_WEB_BASE_URL,
  supportEmail: LYNAVO_SUPPORT_EMAIL,
};

export const appConfig: AppConfig = Object.freeze({
  productName: 'Lynavo Drive',
  bundleId: 'com.lynavo.drive.mobile',
  endpoints: LYNAVO_ENDPOINTS,
  legal: {
    privacyUrl: `${LYNAVO_ENDPOINTS.webBaseUrl}/privacy`,
    termsUrl: `${LYNAVO_ENDPOINTS.webBaseUrl}/terms`,
  },
});
