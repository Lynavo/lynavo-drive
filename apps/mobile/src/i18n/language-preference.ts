import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Locale } from 'react-native-localize';

import { resolveLocale, type SupportedLocale } from './locale-resolver';

export type LanguagePreference = 'system' | SupportedLocale;

export const LANGUAGE_PREFERENCE_STORAGE_KEY =
  '@vividrop/i18n/language_preference';

const LANGUAGE_PREFERENCES: readonly LanguagePreference[] = [
  'system',
  'zh-Hant',
  'zh-Hans',
  'en',
];

export function isLanguagePreference(
  value: unknown,
): value is LanguagePreference {
  return (
    typeof value === 'string' &&
    LANGUAGE_PREFERENCES.includes(value as LanguagePreference)
  );
}

export function resolveLanguagePreference(
  preference: LanguagePreference,
  locales: readonly Locale[],
): SupportedLocale {
  if (preference === 'system') {
    return resolveLocale(locales);
  }
  return preference;
}

export async function loadStoredLanguagePreference(): Promise<LanguagePreference> {
  try {
    const stored = await AsyncStorage.getItem(LANGUAGE_PREFERENCE_STORAGE_KEY);
    return isLanguagePreference(stored) ? stored : 'system';
  } catch (error) {
    console.warn('[i18n] failed to load language preference', error);
    return 'system';
  }
}

export async function saveLanguagePreference(
  preference: LanguagePreference,
): Promise<void> {
  try {
    if (preference === 'system') {
      await AsyncStorage.removeItem(LANGUAGE_PREFERENCE_STORAGE_KEY);
      return;
    }
    await AsyncStorage.setItem(LANGUAGE_PREFERENCE_STORAGE_KEY, preference);
  } catch (error) {
    console.warn('[i18n] failed to save language preference', error);
    throw error;
  }
}
