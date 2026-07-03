import 'i18next';
import type { translationSchema } from './resources';
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: {
      translation: typeof translationSchema;
    };
    returnNull: false;
  }
}
