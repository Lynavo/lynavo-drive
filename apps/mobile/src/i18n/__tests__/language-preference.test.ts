import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  LANGUAGE_PREFERENCE_STORAGE_KEY,
  loadStoredLanguagePreference,
  resolveLanguagePreference,
  saveLanguagePreference,
} from '../language-preference';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

type Locale = {
  languageCode: string;
  scriptCode?: string;
  countryCode: string;
  languageTag: string;
  isRTL: boolean;
};

const locale = (
  tag: string,
  languageCode: string,
  countryCode: string,
  scriptCode?: string,
): Locale => ({
  languageTag: tag,
  languageCode,
  scriptCode,
  countryCode,
  isRTL: false,
});

describe('language preference', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('falls back to system when no valid stored preference exists', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce('fr');

    await expect(loadStoredLanguagePreference()).resolves.toBe('system');
  });

  it('loads a stored manual language preference', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce('zh-Hant');

    await expect(loadStoredLanguagePreference()).resolves.toBe('zh-Hant');
  });

  it('resolves system preference from device locales', () => {
    expect(
      resolveLanguagePreference('system', [
        locale('zh-Hant-TW', 'zh', 'TW', 'Hant'),
      ]),
    ).toBe('zh-Hant');
  });

  it('uses manual preference before device locales', () => {
    expect(
      resolveLanguagePreference('en', [
        locale('zh-Hant-TW', 'zh', 'TW', 'Hant'),
      ]),
    ).toBe('en');
  });

  it('persists manual language preferences', async () => {
    await saveLanguagePreference('en');

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      LANGUAGE_PREFERENCE_STORAGE_KEY,
      'en',
    );
  });

  it('removes the stored override when switching back to system', async () => {
    await saveLanguagePreference('system');

    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(
      LANGUAGE_PREFERENCE_STORAGE_KEY,
    );
  });
});
