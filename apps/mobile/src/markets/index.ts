declare const process: { env: { [key: string]: string | undefined } };

import { NativeModules } from 'react-native';
import { cnMarketConfig } from './cn/config';
import { globalMarketConfig } from './global/config';
import type { Market, MobileMarketConfig } from './types';

const appleAuth = NativeModules?.AppleAuthModule;
const nativeMarket = appleAuth?.SYNCFLOW_MARKET;

console.log('[SYNCFLOW MARKET DEBUG]', {
  hasAppleAuthModule: !!appleAuth,
  appleAuthKeys: appleAuth ? Object.keys(appleAuth) : [],
  nativeMarket,
  processEnvMarket: process.env.SYNCFLOW_MARKET
});

const rawMarket = nativeMarket || process.env.SYNCFLOW_MARKET;

export const activeMarket: Market =
  rawMarket === 'global' || rawMarket === 'cn' ? rawMarket : 'cn';

export const marketConfig: MobileMarketConfig =
  activeMarket === 'global' ? globalMarketConfig : cnMarketConfig;

export function isGlobalMarket(): boolean {
  return activeMarket === 'global';
}

export function isChinaMarket(): boolean {
  return activeMarket === 'cn';
}
