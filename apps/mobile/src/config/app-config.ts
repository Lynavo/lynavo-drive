import {
  LYNAVO_LICENSE_URL,
  LYNAVO_PRIVACY_URL,
  LYNAVO_SECURITY_ADVISORY_URL,
  LYNAVO_SUPPORT_URL,
  LYNAVO_WEB_BASE_URL,
} from '@lynavo-drive/contracts';

interface AppConfigEndpoints {
  readonly webBaseUrl: string;
  readonly supportUrl: string;
  readonly securityAdvisoryUrl: string;
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
  supportUrl: LYNAVO_SUPPORT_URL,
  securityAdvisoryUrl: LYNAVO_SECURITY_ADVISORY_URL,
};

export const appConfig: AppConfig = Object.freeze({
  productName: 'LynavoDriveDemo',
  bundleId: 'com.lynavo.drive.mobile.demo',
  endpoints: LYNAVO_ENDPOINTS,
  legal: {
    privacyUrl: LYNAVO_PRIVACY_URL,
    termsUrl: LYNAVO_LICENSE_URL,
  },
});
