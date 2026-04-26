import React from 'react';
import { Text } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { I18nextProvider, useTranslation } from 'react-i18next';

jest.mock('react-native-localize', () => ({
  getLocales: () => [
    { languageCode: 'zh', scriptCode: 'Hans', countryCode: 'CN', languageTag: 'zh-Hans-CN', isRTL: false },
  ],
}));

import i18n from '../index';

function Demo() {
  const { t } = useTranslation();
  return <Text testID="demo">{t('errors.networkTitle')}</Text>;
}

describe('i18n bootstrap', () => {
  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('zh-Hans');
    });
  });

  it('renders the simplified Chinese label when language is zh-Hans', async () => {
    await act(async () => {
      await i18n.changeLanguage('zh-Hans');
    });
    const { getByTestId } = render(
      <I18nextProvider i18n={i18n}>
        <Demo />
      </I18nextProvider>,
    );
    expect(getByTestId('demo').props.children).toBe('网路错误');
  });

  it('renders the traditional Chinese label when language is zh-Hant', async () => {
    await act(async () => {
      await i18n.changeLanguage('zh-Hant');
    });
    const { getByTestId } = render(
      <I18nextProvider i18n={i18n}>
        <Demo />
      </I18nextProvider>,
    );
    expect(getByTestId('demo').props.children).toBe('網路錯誤');
  });

  it('renders the English label when language is en', async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    const { getByTestId } = render(
      <I18nextProvider i18n={i18n}>
        <Demo />
      </I18nextProvider>,
    );
    expect(getByTestId('demo').props.children).toBe('Network Error');
  });

  it('falls back to English when the key exists only in en', async () => {
    // Add a key to en only — zh-Hans does not define it, so at zh-Hans lookup time
    // i18next should fall back to en per fallbackLng configuration.
    i18n.addResource('en', 'translation', 'common.onlyInEn', 'Only in EN');

    await act(async () => {
      await i18n.changeLanguage('zh-Hans');
    });

    // Cast through unknown to bypass typed-key enforcement — the key is intentionally
    // outside the Chinese schema to exercise the fallbackLng path.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tAny = i18n.t.bind(i18n) as (key: string) => string;
    const { getByTestId } = render(
      <I18nextProvider i18n={i18n}>
        <Text testID="demo">{tAny('common.onlyInEn')}</Text>
      </I18nextProvider>,
    );
    expect(getByTestId('demo').props.children).toBe('Only in EN');
  });
});
