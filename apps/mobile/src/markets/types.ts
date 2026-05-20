export type Market = 'cn' | 'global';

export type LoginProvider = 'phone' | 'apple' | 'google';

export interface MarketTheme {
  primary: string;
  primaryForeground: string;
  background: string;
  foreground: string;
  accent: string;
}

export interface MobileMarketConfig {
  market: Market;
  appName: string;
  bundleId: string;
  apiBaseUrl: string;
  reviewApiBaseUrl: string;
  appReviewPhone: string;
  privacyUrl: string;
  termsUrl: string;
  loginProviders: readonly LoginProvider[];
  theme: MarketTheme;
}
