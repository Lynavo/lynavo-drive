import 'react-i18next';
import type { translationSchema } from './resources';

declare module 'react-i18next' {
  interface CustomTypeOptions {
    resources: typeof translationSchema;
  }
}
