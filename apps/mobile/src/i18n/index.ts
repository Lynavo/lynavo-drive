import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as RNLocalize from 'react-native-localize';

import { resolveLocale } from './locale-resolver';
import { resources } from './resources';

const lng = resolveLocale(RNLocalize.getLocales());

void i18next.use(initReactI18next).init({
  resources,
  lng,
  supportedLngs: ['zh-Hans', 'zh-Hant', 'en'],
  fallbackLng: 'en',
  // RN Hermes may not expose a complete `Intl.PluralRules`. Our JSON already
  // uses the `_one` / `_other` v3 format, so pin v3 compatibility explicitly
  // to silence the runtime warning and keep plural resolution stable.
  compatibilityJSON: 'v3',
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
