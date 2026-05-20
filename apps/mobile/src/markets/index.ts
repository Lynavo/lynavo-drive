import { cnMarketConfig } from './cn/config';
import { globalMarketConfig } from './global/config';
import type { Market, MobileMarketConfig } from './types';

const rawMarket = process.env.SYNCFLOW_MARKET;

export const activeMarket: Market = rawMarket === 'global' || rawMarket === 'cn' ? rawMarket : 'cn';

export const marketConfig: MobileMarketConfig =
  activeMarket === 'global' ? globalMarketConfig : cnMarketConfig;

export function isGlobalMarket(): boolean {
  return activeMarket === 'global';
}

export function isChinaMarket(): boolean {
  return activeMarket === 'cn';
}
