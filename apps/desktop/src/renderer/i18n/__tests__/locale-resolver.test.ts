import { describe, expect, it } from 'vitest';
import { resolveLocale } from '../locale-resolver';

describe('resolveLocale', () => {
  it('resolves Chinese scripts and regions', () => {
    expect(resolveLocale(['zh-Hans'])).toBe('zh-Hans');
    expect(resolveLocale(['zh'])).toBe('zh-Hans');
    expect(resolveLocale(['zh-Hant-TW'])).toBe('zh-Hant');
    expect(resolveLocale(['zh-TW'])).toBe('zh-Hant');
    expect(resolveLocale(['zh-HK'])).toBe('zh-Hant');
  });

  it('resolves English and falls back to English', () => {
    expect(resolveLocale(['en-US'])).toBe('en');
    expect(resolveLocale(['ja-JP', 'en-GB'])).toBe('en');
    expect(resolveLocale(['ja-JP'])).toBe('en');
    expect(resolveLocale([])).toBe('en');
  });
});
