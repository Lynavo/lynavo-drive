import React from 'react';
import { Dimensions, StyleSheet, ViewStyle } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

const mockGoBack = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    goBack: mockGoBack,
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'common.back': 'Back',
        'connectionTutorial.title': 'Connection Tutorial',
        'connectionTutorial.prerequisite':
          'Prerequisite: make sure Lynavo Drive is installed and open on your computer',
        'connectionTutorial.tabs.lan': 'Search',
        'connectionTutorial.tabs.qr': 'Scan QR',
        'connectionTutorial.tabs.code': 'Pairing Code',
        'connectionTutorial.tabs.ip': 'Direct IP',
        'connectionTutorial.cards.lan.steps.0':
          'Make sure your phone and computer are on the same Wi-Fi or local network',
        'connectionTutorial.cards.lan.steps.1':
          'Open Lynavo Drive on your computer and keep it running',
        'connectionTutorial.cards.lan.steps.2':
          'Open device search on the phone and wait a moment for the computer to appear',
        'connectionTutorial.cards.lan.warning':
          'No desktop app yet? Visit {{host}} in your computer browser to install it.',
        'connectionTutorial.cards.qr.steps.0':
          'Show the QR code in Lynavo Drive desktop Global Settings',
        'connectionTutorial.cards.qr.steps.1':
          'Tap QR pairing on the phone to open the camera',
        'connectionTutorial.cards.qr.steps.2':
          'Point at the QR code on the screen to enter pairing automatically',
        'connectionTutorial.cards.code.steps.0':
          'View the 6-digit pairing code in desktop Global Settings',
        'connectionTutorial.cards.code.steps.1':
          'The pairing code does not refresh automatically. Click Regenerate manually to change it',
        'connectionTutorial.cards.code.steps.2':
          'Enter the pairing code on the phone to complete pairing after verification',
        'connectionTutorial.cards.ip.steps.0':
          'Open Global Settings from the desktop sidebar',
        'connectionTutorial.cards.ip.steps.1':
          'Find Broadcast IP (iPhone connection address)',
        'connectionTutorial.cards.ip.steps.2':
          'Enter that address in Manual Pairing on the phone and continue',
        'connectionTutorial.troubleshoot.entry': "Still can't find a device?",
        'connectionTutorial.troubleshoot.cta': 'View troubleshooting guide >',
        'connectionTutorial.troubleshoot.title':
          'Connection Troubleshooting Guide',
        'connectionTutorial.troubleshoot.items.0':
          'Confirm the phone and computer are on the same Wi-Fi.',
        'connectionTutorial.troubleshoot.items.1':
          'Check whether VPN or proxy is enabled on the phone or computer.',
        'connectionTutorial.troubleshoot.items.2':
          'If it still cannot connect, use manual pairing.',
        'connectionTutorial.troubleshoot.supportTitle': 'Still not resolved?',
        'connectionTutorial.troubleshoot.supportBody':
          'Export diagnostics and open a GitHub issue.',
        'connectionTutorial.troubleshoot.supportIssue': 'GitHub Issues',
      })[key] ?? key,
  }),
}));

jest.mock('../../components/Icon', () => ({
  Icon: ({ name }: { name: string }) => {
    const ReactInner = require('react');
    const { Text } = require('react-native');
    return ReactInner.createElement(Text, null, name);
  },
}));

import { ConnectionTutorialScreen } from '../ConnectionTutorialScreen';

describe('ConnectionTutorialScreen visuals', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('switches between dedicated tutorial visuals for each pairing method', () => {
    const screen = render(<ConnectionTutorialScreen />);

    expect(screen.getByTestId('connection-tutorial-visual-lan')).toBeTruthy();

    fireEvent.press(screen.getByText('Scan QR'));
    expect(screen.getByTestId('connection-tutorial-visual-qr')).toBeTruthy();

    fireEvent.press(screen.getByText('Pairing Code'));
    expect(screen.getByTestId('connection-tutorial-visual-code')).toBeTruthy();

    fireEvent.press(screen.getByText('Direct IP'));
    expect(screen.getByTestId('connection-tutorial-visual-ip')).toBeTruthy();
  });

  it('switches tabs when the tutorial pages are swiped horizontally', () => {
    const screen = render(<ConnectionTutorialScreen />);
    const pages = screen.getByTestId('connection-tutorial-pages');

    fireEvent(pages, 'momentumScrollEnd', {
      nativeEvent: {
        contentOffset: { x: 343 },
        layoutMeasurement: { width: 343 },
      },
    });

    expect(screen.getByText('Scan QR').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ color: '#ffffff' })]),
    );

    fireEvent(pages, 'momentumScrollEnd', {
      nativeEvent: {
        contentOffset: { x: 0 },
        layoutMeasurement: { width: 343 },
      },
    });

    expect(screen.getByText('Search').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ color: '#ffffff' })]),
    );
  });

  it('keeps each tutorial page the same width as the horizontal paging viewport', () => {
    Dimensions.set({
      window: { width: 375, height: 812, scale: 2, fontScale: 1 },
      screen: { width: 375, height: 812, scale: 2, fontScale: 1 },
    });

    const screen = render(<ConnectionTutorialScreen />);
    const firstPage = screen.getByTestId(
      'connection-tutorial-page-lan',
    ) as unknown as {
      props: { style: ViewStyle };
    };
    const firstPageStyle = StyleSheet.flatten(firstPage.props.style);

    expect(firstPageStyle.width).toBe(375);
  });
});
