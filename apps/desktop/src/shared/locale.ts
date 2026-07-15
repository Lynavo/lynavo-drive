export type SupportedLocale = 'zh-Hans' | 'zh-Hant' | 'en';

export const SUPPORTED_LOCALES: SupportedLocale[] = ['en', 'zh-Hans', 'zh-Hant'];

const TRADITIONAL_CHINESE_REGIONS = new Set(['TW', 'HK', 'MO']);

export function isSupportedLocale(value: string | null | undefined): value is SupportedLocale {
  return value === 'en' || value === 'zh-Hans' || value === 'zh-Hant';
}

function parseLocale(tag: string): { language: string; script?: string; region?: string } | null {
  try {
    const locale = new Intl.Locale(tag);
    return {
      language: locale.language.toLowerCase(),
      script: locale.script,
      region: locale.region,
    };
  } catch {
    return null;
  }
}

export function resolveLocale(languageTags: readonly string[]): SupportedLocale {
  for (const tag of languageTags) {
    const locale = parseLocale(tag);
    if (!locale) continue;

    if (locale.language === 'zh') {
      if (locale.script === 'Hant') return 'zh-Hant';
      if (locale.script === 'Hans') return 'zh-Hans';
      if (locale.region && TRADITIONAL_CHINESE_REGIONS.has(locale.region)) {
        return 'zh-Hant';
      }
      return 'zh-Hans';
    }

    if (locale.language === 'en') {
      return 'en';
    }
  }

  return 'en';
}
