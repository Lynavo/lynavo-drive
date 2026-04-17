import 'i18next';
import type zh from './locales/zh.json';

// Plural keys (e.g., `selectedCount`) require a "base" entry in zh.json in addition
// to the `_other` variant. The base entry anchors the TypeScript literal type so
// calls like `t('albumWorkbench.selectedCount', { count })` typecheck. At runtime,
// i18next resolves the correct `_one` / `_other` variant by count; the base value
// is only consulted as a final fallback. Keep base and `_other` values identical in
// zh.json (Chinese has no singular/plural distinction per CLDR).
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: {
      translation: typeof zh;
    };
    returnNull: false;
  }
}
