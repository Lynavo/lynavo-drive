import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { HelpGlobalScreen } from '../HelpGlobalScreen';
import { shareDiagnosticsArchive } from '../../utils/shareDiagnosticsArchive';

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
  shareDiagnosticsArchive: jest
    .fn()
    .mockResolvedValue('/tmp/help-diagnostics.zip'),
  isDiagnosticsExportUnavailable: jest.fn(() => false),
}));

const mockedShareDiagnosticsArchive =
  shareDiagnosticsArchive as jest.MockedFunction<
    typeof shareDiagnosticsArchive
  >;

describe('HelpGlobalScreen OSS copy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedShareDiagnosticsArchive.mockResolvedValue(
      '/tmp/help-diagnostics.zip',
    );
  });

  it('describes local LAN operation instead of account-gated flows', () => {
    const { getByText, queryByText } = render(<HelpGlobalScreen />);

    expect(
      getByText('Does the open-source edition require a cloud login?'),
    ).toBeTruthy();
    expect(
      getByText(
        'No. The OSS edition keeps local LAN pairing, foreground sync, and shared-folder browsing available through local desktop pairing.',
      ),
    ).toBeTruthy();
    expect(queryByText(/trial/i)).toBeNull();
    expect(queryByText('Cloud login required')).toBeNull();
  });

  it('shares a local diagnostics archive from the support section', async () => {
    const { getByText } = render(<HelpGlobalScreen />);

    expect(getByText('share-outline')).toBeTruthy();

    fireEvent.press(getByText('Export Diagnostics'));

    await waitFor(() => {
      expect(mockedShareDiagnosticsArchive).toHaveBeenCalledTimes(1);
    });
  });
});
