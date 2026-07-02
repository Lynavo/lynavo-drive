import React from 'react';
import { NativeEventEmitter, NativeModules } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(null),
    removeItem: jest.fn().mockResolvedValue(null),
  },
}));

const mockNavigate = jest.fn();
const mockDispatch = jest.fn();
const mockMarkUnconnectedGuideSeen = jest.fn().mockResolvedValue(undefined);
const mockHasSeenUnconnectedGuide = jest.fn().mockResolvedValue(false);

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    const R = require('react');
    R.useEffect(cb, [cb]);
  },
  useNavigation: () => ({
    navigate: mockNavigate,
    dispatch: mockDispatch,
    goBack: jest.fn(),
  }),
  useRoute: () => ({
    params: undefined,
  }),
  CommonActions: {
    reset: jest.fn(payload => ({ type: 'RESET', payload })),
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: {
      language: 'zh-Hant',
      resolvedLanguage: 'zh-Hant',
    },
    t: (key: string) =>
      ({
        'deviceDiscovery.onboarding.unconnected.skip': 'Skip',
        'deviceDiscovery.onboarding.unconnected.title':
          'Start using Lynavo Drive',
        'deviceDiscovery.onboarding.unconnected.subtitle':
          'Sync media wirelessly from phone to computer in three steps',
        'deviceDiscovery.onboarding.unconnected.downloadStep.title':
          'Install PC App',
        'deviceDiscovery.onboarding.unconnected.downloadStep.body':
          'Install Lynavo Drive on your computer',
        'deviceDiscovery.onboarding.unconnected.connectStep.title':
          'Connect Phone',
        'deviceDiscovery.onboarding.unconnected.connectStep.body':
          'Enter a pairing code or scan QR',
        'deviceDiscovery.onboarding.unconnected.syncStep.title':
          'Start Syncing',
        'deviceDiscovery.onboarding.unconnected.syncStep.body':
          'Media transfers to your computer',
        'deviceDiscovery.onboarding.unconnected.copy': 'Copy',
        'deviceDiscovery.onboarding.unconnected.copyFailed': 'Copy failed',
        'deviceDiscovery.onboarding.unconnected.copyHint':
          'Copy and open it in your computer browser to download',
        'deviceDiscovery.onboarding.unconnected.start':
          'I installed it. Connect device',
        'deviceDiscovery.onboarding.unconnected.footerNote':
          'First-time guide - Available again from Help',
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

jest.mock('../../utils/shareDiagnosticsArchive', () => ({
  isDiagnosticsExportUnavailable: jest.fn().mockReturnValue(false),
  shareDiagnosticsArchive: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../utils/onboardingStorage', () => ({
  hasSeenUnconnectedGuide: () => mockHasSeenUnconnectedGuide(),
  markUnconnectedGuideSeen: () => mockMarkUnconnectedGuideSeen(),
}));

jest.mock('../../stores/recent-desktops-store', () => ({
  useRecentDesktops: () => ({
    recentDesktops: [],
    isLoading: false,
    addDesktop: jest.fn(),
    forgetDesktop: jest.fn(),
    updateAuthStatus: jest.fn(),
  }),
}));

import { DeviceDiscoveryScreen } from '../DeviceDiscoveryScreen';

const mockNativeSyncEngine = {
  startDiscovery: jest.fn().mockResolvedValue(undefined),
  stopDiscovery: jest.fn().mockResolvedValue(undefined),
  addListener: jest.fn(),
  removeListeners: jest.fn(),
};

describe('DeviceDiscoveryScreen onboarding', () => {
  let logSpy: jest.SpyInstance;

  beforeAll(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockHasSeenUnconnectedGuide.mockResolvedValue(false);
    mockMarkUnconnectedGuideSeen.mockResolvedValue(undefined);
    NativeModules.NativeSyncEngine = mockNativeSyncEngine;
    jest
      .spyOn(NativeEventEmitter.prototype, 'addListener')
      .mockReturnValue({ remove: jest.fn() } as any);
  });

  afterAll(() => {
    logSpy.mockRestore();
  });

  it('shows the unconnected guide once and marks it seen when starting connection', async () => {
    const screen = render(<DeviceDiscoveryScreen />);

    await waitFor(() => {
      expect(screen.getByText('Start using Lynavo Drive')).toBeTruthy();
    });
    expect(
      screen.getByText('First-time guide - Available again from Help'),
    ).toBeTruthy();

    fireEvent.press(screen.getByText('I installed it. Connect device'));

    await waitFor(
      () => {
        expect(mockMarkUnconnectedGuideSeen).toHaveBeenCalledTimes(1);
        expect(screen.queryByText('Start using Lynavo Drive')).toBeNull();
      },
      { timeout: 3000 },
    );
  }, 10000);

  it('does not show the unconnected guide after it has been seen', async () => {
    mockHasSeenUnconnectedGuide.mockResolvedValueOnce(true);

    const screen = render(<DeviceDiscoveryScreen />);

    await waitFor(() => {
      expect(mockHasSeenUnconnectedGuide).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText('Start using Lynavo Drive')).toBeNull();
  });
});
