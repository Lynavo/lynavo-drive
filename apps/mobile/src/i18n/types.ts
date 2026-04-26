import 'i18next';
import type { translationSchema } from './resources';

// Plural keys (e.g., `selectedCount`) require a "base" entry in the Chinese schema
// in addition to the `_other` variant. The base entry anchors the TypeScript
// literal type so calls like `t('albumWorkbench.selectedCount', { count })`
// typecheck. At runtime, i18next resolves the correct `_one` / `_other` variant
// by count; the base value is only consulted as a final fallback. Keep base and
// `_other` values identical in both Chinese locale files (Chinese has no
// singular/plural distinction per CLDR).
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: {
      translation: typeof translationSchema;
    };
    returnNull: false;
  }
}
