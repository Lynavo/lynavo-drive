import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import { isSupportedLocale, type SupportedLocale } from './locale-resolver';
import { resources } from './resources';

export const LOCALE_STORAGE_KEY = 'syncflow.desktop.locale';

export function getPersistedLocale(): SupportedLocale | null {
  const value = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  return isSupportedLocale(value) ? value : null;
}

export function persistLocale(locale: SupportedLocale): void {
  window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
}

const lng = getPersistedLocale() ?? 'zh-Hans';

void i18next.use(initReactI18next).init({
  resources,
  lng,
  supportedLngs: ['zh-Hans', 'zh-Hant', 'en'],
  fallbackLng: 'zh-Hans',
  interpolation: { escapeValue: false },
  returnNull: false,
  missingInterpolationHandler:
    import.meta.env.DEV
      ? (text, value, _options) => {
          console.warn('[i18n] missing interpolation', { text, value });
        }
      : undefined,
});

export default i18next;
