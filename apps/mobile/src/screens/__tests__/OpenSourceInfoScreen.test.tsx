import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { OpenSourceInfoScreen } from '../OpenSourceInfoScreen';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockCanGoBack = jest.fn(() => true);
const mockReset = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    canGoBack: mockCanGoBack,
    reset: mockReset,
  }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const ReactInner = require('react');
    ReactInner.useEffect(effect, [effect]);
  },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string) => {
      const map: Record<string, string> = {
        'oss.title': 'Lynavo Drive Community',
        'oss.body':
          'The open-source edition syncs over your local LAN with local desktop pairing.',
        'oss.pointLan':
          'Pair with a desktop on the same network for automatic incremental sync.',
        'oss.pointNoStore':
          'App-store purchases and redemption flows are not included in this runtime.',
        'oss.pointServices':
          'Off-LAN and background commercial services stay disabled in this community runtime.',
        'oss.primary': 'Pair a computer',
        'oss.secondary': 'Back to sync',
        'common.back': 'Back',
      };
      return map[key] ?? key;
    },
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('../../components/Icon', () => ({
  Icon: ({ name }: { name: string }) => {
    const ReactInner = require('react');
    const { Text: RNText } = require('react-native');
    return ReactInner.createElement(RNText, null, name);
  },
}));

jest.mock('../../components/GlobalGradientBackground', () => ({
  GlobalGradientBackground: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

describe('OpenSourceInfoScreen OSS information route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCanGoBack.mockReturnValue(true);
  });

  it('renders local LAN OSS copy with no purchase, restore, or gift-card actions', () => {
    const { getByText, queryByText } = render(<OpenSourceInfoScreen />);

    expect(getByText('Lynavo Drive Community')).toBeTruthy();
    expect(
      getByText(
        'The open-source edition syncs over your local LAN with local desktop pairing.',
      ),
    ).toBeTruthy();
    expect(
      getByText(
        'Pair with a desktop on the same network for automatic incremental sync.',
      ),
    ).toBeTruthy();
    expect(
      getByText(
        'App-store purchases and redemption flows are not included in this runtime.',
      ),
    ).toBeTruthy();
    expect(
      getByText(
        'Off-LAN and background commercial services stay disabled in this community runtime.',
      ),
    ).toBeTruthy();
    expect(queryByText('Subscribe Now')).toBeNull();
    expect(queryByText('Restore Purchases')).toBeNull();
    expect(queryByText('Redeem Gift Card')).toBeNull();

    fireEvent.press(getByText('Pair a computer'));
    expect(mockNavigate).toHaveBeenCalledWith('DeviceDiscovery');
  });
});
