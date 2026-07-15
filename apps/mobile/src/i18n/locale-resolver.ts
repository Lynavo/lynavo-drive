import type { Locale } from 'react-native-localize';

export type SupportedLocale = 'zh-Hans' | 'zh-Hant' | 'en';

const TRADITIONAL_CHINESE_REGIONS = new Set(['TW', 'HK', 'MO']);

/**
 * Picks the first locale in the user's preference list that matches a language
 * we support. Chinese locales split into Simplified (`zh-Hans`) and Traditional
 * (`zh-Hant`); bare `zh` falls back by region when scriptCode is missing.
 */
export function resolveLocale(locales: readonly Locale[]): SupportedLocale {
  for (const l of locales) {
    if (l.languageCode === 'zh') {
      if (l.scriptCode === 'Hant') {
        return 'zh-Hant';
      }
      if (l.scriptCode === 'Hans') {
        return 'zh-Hans';
      }
      if (TRADITIONAL_CHINESE_REGIONS.has(l.countryCode)) {
        return 'zh-Hant';
      }
      return 'zh-Hans';
    }
    if (l.languageCode === 'en') {
      return 'en';
    }
  }
  return 'en';
}
