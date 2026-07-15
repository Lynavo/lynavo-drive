import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCALE_STORAGE_KEY } from '../index';

function setNavigatorLanguages(languages: readonly string[]): void {
  Object.defineProperty(window.navigator, 'languages', {
    configurable: true,
    get: () => languages,
  });
}

async function importFreshI18n() {
  vi.resetModules();
  return import('../index');
}

describe('renderer i18n initialization', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
    setNavigatorLanguages(['en-US']);
  });

  it('uses a persisted locale before system language preferences', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en');
    setNavigatorLanguages(['zh-TW']);

    const { default: i18n } = await importFreshI18n();

    expect(i18n.language).toBe('en');
  });

  it('defaults to Traditional Chinese for Taiwan system language', async () => {
    setNavigatorLanguages(['zh-TW', 'en-US']);

    const { default: i18n } = await importFreshI18n();

    expect(i18n.language).toBe('zh-Hant');
    expect(document.documentElement.lang).toBe('zh-Hant');

    await i18n.changeLanguage('zh-Hans');

    expect(document.documentElement.lang).toBe('zh-Hans');
  });

  it('falls back to English when no supported system language is present', async () => {
    setNavigatorLanguages(['ja-JP']);

    const { default: i18n } = await importFreshI18n();

    expect(i18n.language).toBe('en');
  });
});
