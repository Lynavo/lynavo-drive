import type { Locale } from 'react-native-localize';

export type SupportedLocale = 'zh' | 'en';

/**
 * Picks the first locale in the user's preference list that matches a language
 * we support. Simplified Chinese (zh-Hans or bare zh) -> 'zh'. Everything else
 * (including Traditional Chinese) -> 'en'.
 */
export function resolveLocale(locales: readonly Locale[]): SupportedLocale {
  for (const l of locales) {
    if (l.languageCode === 'zh' && l.scriptCode !== 'Hant') {
      return 'zh';
    }
    if (l.languageCode === 'en') {
      return 'en';
    }
  }
  return 'en';
}
