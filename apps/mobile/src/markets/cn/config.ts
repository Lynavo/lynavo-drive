import type { MobileMarketConfig } from '../types';

export const cnMarketConfig: MobileMarketConfig = {
  market: 'cn',
  appName: 'Vivi Drop',
  bundleId: 'com.vividrop.mobile.china',
  apiBaseUrl: 'https://api.vividrop.cn',
  reviewApiBaseUrl: 'https://review-api.vividrop.cn',
  appReviewPhone: '17000000002',
  privacyUrl: 'https://www.vividrop.cn/privacy',
  termsUrl: 'https://www.vividrop.cn/terms',
  loginProviders: ['phone'],
  theme: {
    primary: '#2a6cb5',
    primaryForeground: '#ffffff',
    background: '#f2f5f8',
    foreground: '#1a2a3c',
    accent: '#b8d4ec',
  },
};
