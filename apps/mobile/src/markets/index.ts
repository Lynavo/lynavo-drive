declare const process: { env: { [key: string]: string | undefined } };

import { NativeModules } from 'react-native';

import { mobileReleaseProfile } from '../release-profile';
import { cnMarketConfig } from './cn/config';
import { globalMarketConfig } from './global/config';
import type { Market, MobileMarketConfig } from './types';

const appleAuth = NativeModules?.AppleAuthModule;
const nativeSyncEngine = NativeModules?.NativeSyncEngine;
const nativeMarket = appleAuth?.SYNCFLOW_MARKET || nativeSyncEngine?.SYNCFLOW_MARKET;
const releaseMarket = mobileReleaseProfile.market;

console.log('[SYNCFLOW MARKET DEBUG]', {
  hasAppleAuthModule: !!appleAuth,
  hasNativeSyncEngine: !!nativeSyncEngine,
  nativeMarket,
  processEnvMarket: process.env.SYNCFLOW_MARKET,
  releaseMarket,
});

const rawMarket = nativeMarket || process.env.SYNCFLOW_MARKET || releaseMarket;

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
