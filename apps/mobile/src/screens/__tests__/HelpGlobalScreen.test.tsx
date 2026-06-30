import React from 'react';
import { render } from '@testing-library/react-native';
import { HelpGlobalScreen } from '../HelpGlobalScreen';

const mockGoBack = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    goBack: mockGoBack,
  }),
}));

jest.mock('react-i18next', () => {
  const en = {
    help: require('../../i18n/locales/en/help.json'),
    settings: {
      actions: {
        help: 'Help',
      },
      dialogs: {
        exportUnavailable: {
          title: 'Diagnostics unavailable',
          body: 'Diagnostics are unavailable.',
        },
        exportFailed: {
          title: 'Export failed',
          body: 'Try again later.',
        },
      },
    },
    common: {
      back: 'Back',
    },
  };
  return {
    useTranslation: () => ({
      t: (key: string) => {
        const parts = key.split('.');
        let current: any = en;
        for (const part of parts) {
          if (current == null) return key;
          current = current[part];
        }
        return typeof current === 'string' ? current : key;
      },
    }),
  };
});

jest.mock('../../components/Icon', () => ({
  Icon: ({ name }: { name: string }) => {
    const ReactInner = require('react');
    const { Text } = require('react-native');
    return ReactInner.createElement(Text, null, name);
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('../../utils/shareDiagnosticsArchive', () => ({
  shareDiagnosticsArchive: jest.fn().mockResolvedValue(undefined),
  isDiagnosticsExportUnavailable: jest.fn(() => false),
}));

describe('HelpGlobalScreen OSS copy', () => {
  it('describes local LAN operation instead of trial, subscription, or purchase flows', () => {
    const { getByText, queryByText } = render(<HelpGlobalScreen />);

    expect(getByText('Does the open-source edition require a subscription?')).toBeTruthy();
    expect(
      getByText(
        'No. The OSS edition keeps local LAN pairing, foreground sync, and shared-folder browsing available without an official account.',
      ),
    ).toBeTruthy();
    expect(queryByText(/trial/i)).toBeNull();
    expect(queryByText(/subscription is required/i)).toBeNull();
    expect(queryByText(/purchase/i)).toBeNull();
  });
});
