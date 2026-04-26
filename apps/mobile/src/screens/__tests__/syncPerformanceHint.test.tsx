import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text } from 'react-native';
import { act } from '@testing-library/react-native';

jest.mock('react-native-localize', () => ({
  getLocales: () => [
    { languageCode: 'zh', scriptCode: 'Hans', countryCode: 'CN', languageTag: 'zh-Hans-CN', isRTL: false },
  ],
}));

import i18n from '../../i18n';
import {
  getSyncPerformanceHintMessage,
  SyncPerformanceHint,
} from '../components/SyncPerformanceHint';

describe('SyncPerformanceHint', () => {
  beforeAll(async () => {
    await act(async () => {
      await i18n.changeLanguage('zh-Hans');
    });
  });

  it('renders the thermal hint while upload is active', async () => {
    let tree: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(
        <SyncPerformanceHint
          uploadState="uploading"
          performanceHint="thermal_limited"
          performanceMessage="设备温度较高，已降低传输强度"
        />,
      );
    });

    expect(tree?.root.findByType(Text).props.children).toBe(
      '设备温度较高，已降低传输强度',
    );
  });

  it('returns null outside active upload states', () => {
    expect(
      getSyncPerformanceHintMessage(
        {
          uploadState: 'completed',
          performanceHint: 'thermal_limited',
          performanceMessage: '设备温度较高，已降低传输强度',
        },
        i18n.t.bind(i18n),
      ),
    ).toBeNull();
  });

  it('falls back to the default message when native text is empty', () => {
    expect(
      getSyncPerformanceHintMessage(
        {
          uploadState: 'reconnecting',
          performanceHint: 'thermal_limited',
          performanceMessage: '   ',
        },
        i18n.t.bind(i18n),
      ),
    ).toBe('设备温度较高，已降低传输强度');
  });
});
