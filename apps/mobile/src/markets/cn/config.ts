import {
  VIVIDROP_API_BASE_URL,
  VIVIDROP_REVIEW_API_BASE_URL,
  VIVIDROP_SUPPORT_EMAIL,
  VIVIDROP_WEB_BASE_URL,
} from '@syncflow/contracts';
import type { MobileMarketConfig } from '../types';

export const cnMarketConfig: MobileMarketConfig = {
  market: 'cn',
  appName: 'Vivi Drop',
  bundleId: 'com.vividrop.mobile.china',
  apiBaseUrl: VIVIDROP_API_BASE_URL,
  reviewApiBaseUrl: VIVIDROP_REVIEW_API_BASE_URL,
  appReviewPhone: '17000000002',
  privacyUrl: `${VIVIDROP_WEB_BASE_URL}/privacy`,
  termsUrl: `${VIVIDROP_WEB_BASE_URL}/terms`,
  loginProviders: ['phone'],
  theme: {
    primary: '#2a6cb5',
    primaryForeground: '#ffffff',
    background: '#f2f5f8',
    foreground: '#1a2a3c',
    accent: '#b8d4ec',
  },
  downloadUrl: VIVIDROP_WEB_BASE_URL,
  supportEmail: VIVIDROP_SUPPORT_EMAIL,
};
