import {
  VIVIDROP_GLOBAL_API_BASE_URL,
  VIVIDROP_REVIEW_API_BASE_URL,
  VIVIDROP_SUPPORT_EMAIL,
  VIVIDROP_WEB_BASE_URL,
} from '@syncflow/contracts';
import type { MobileMarketConfig } from '../types';

export const globalMarketConfig: MobileMarketConfig = {
  market: 'global',
  appName: 'Vivi Drop',
  bundleId: 'com.vividrop.mobile.global',
  apiBaseUrl: VIVIDROP_GLOBAL_API_BASE_URL,
  reviewApiBaseUrl: VIVIDROP_REVIEW_API_BASE_URL,
  appReviewPhone: '17000000002',
  privacyUrl: `${VIVIDROP_WEB_BASE_URL}/privacy`,
  termsUrl: `${VIVIDROP_WEB_BASE_URL}/terms`,
  loginProviders: ['apple', 'google'],
  theme: {
    primary: '#3f5fdb',
    primaryForeground: '#ffffff',
    background: '#f7f8fb',
    foreground: '#172033',
    accent: '#18a999',
  },
  downloadUrl: VIVIDROP_WEB_BASE_URL,
  supportEmail: VIVIDROP_SUPPORT_EMAIL,
};
