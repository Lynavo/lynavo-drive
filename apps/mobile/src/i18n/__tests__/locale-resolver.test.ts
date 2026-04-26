import { resolveLocale } from '../locale-resolver';

type Locale = {
  languageCode: string;
  scriptCode?: string;
  countryCode: string;
  languageTag: string;
  isRTL: boolean;
};

const locale = (tag: string, languageCode: string, countryCode: string, scriptCode?: string): Locale => ({
  languageTag: tag,
  languageCode,
  scriptCode,
  countryCode,
  isRTL: false,
});

describe('resolveLocale', () => {
  it('returns zh-Hans for simplified Chinese (mainland)', () => {
    expect(resolveLocale([locale('zh-Hans-CN', 'zh', 'CN', 'Hans')])).toBe('zh-Hans');
  });

  it('returns zh-Hans for bare zh-CN without scriptCode', () => {
    expect(resolveLocale([locale('zh-CN', 'zh', 'CN')])).toBe('zh-Hans');
  });

  it('returns zh-Hant for traditional Chinese (Taiwan)', () => {
    expect(resolveLocale([locale('zh-Hant-TW', 'zh', 'TW', 'Hant')])).toBe('zh-Hant');
  });

  it('returns zh-Hant for traditional Chinese (Hong Kong)', () => {
    expect(resolveLocale([locale('zh-Hant-HK', 'zh', 'HK', 'Hant')])).toBe('zh-Hant');
  });

  it('uses region as a fallback when traditional Chinese has no scriptCode', () => {
    expect(resolveLocale([locale('zh-TW', 'zh', 'TW')])).toBe('zh-Hant');
  });

  it('returns en for US English', () => {
    expect(resolveLocale([locale('en-US', 'en', 'US')])).toBe('en');
  });

  it('returns en for unsupported languages (ja, ko, fr)', () => {
    expect(resolveLocale([locale('ja-JP', 'ja', 'JP')])).toBe('en');
    expect(resolveLocale([locale('ko-KR', 'ko', 'KR')])).toBe('en');
    expect(resolveLocale([locale('fr-FR', 'fr', 'FR')])).toBe('en');
  });

  it('respects user preference order: picks en when English comes first', () => {
    expect(resolveLocale([
      locale('en-US', 'en', 'US'),
      locale('zh-Hans-CN', 'zh', 'CN', 'Hans'),
    ])).toBe('en');
  });

  it('picks zh-Hans when simplified Chinese comes before English', () => {
    expect(resolveLocale([
      locale('zh-Hans-CN', 'zh', 'CN', 'Hans'),
      locale('en-US', 'en', 'US'),
    ])).toBe('zh-Hans');
  });

  it('picks zh-Hant when traditional Chinese is the highest preference', () => {
    expect(resolveLocale([
      locale('zh-Hant-TW', 'zh', 'TW', 'Hant'),
      locale('zh-Hans-CN', 'zh', 'CN', 'Hans'),
    ])).toBe('zh-Hant');
  });

  it('returns en for empty list', () => {
    expect(resolveLocale([])).toBe('en');
  });
});
