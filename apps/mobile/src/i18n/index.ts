import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as RNLocalize from 'react-native-localize';

import en from './locales/en.json';
import zh from './locales/zh.json';
import { resolveLocale } from './locale-resolver';


const lng = resolveLocale(RNLocalize.getLocales());

void i18next.use(initReactI18next).init({
  resources: {
    zh: { translation: zh },
    en: { translation: en },
  },
  lng,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
  missingInterpolationHandler: __DEV__
    ? (text, value, _options) => {
        // eslint-disable-next-line no-console
        console.warn('[i18n] missing interpolation', { text, value });
      }
    : undefined,
});

export default i18next;
