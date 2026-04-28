import React from 'react';
import { NativeEventEmitter, NativeModules } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

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
        'deviceDiscovery.onboarding.unconnected.skip': '跳過',
        'deviceDiscovery.onboarding.unconnected.title': '開始使用 Vivi Drop',
        'deviceDiscovery.onboarding.unconnected.subtitle':
          '手機與電腦無線同步素材，三步搞定',
        'deviceDiscovery.onboarding.unconnected.downloadStep.title':
          '下載 PC 端',
        'deviceDiscovery.onboarding.unconnected.downloadStep.body':
          '在電腦上安裝 Vivi Drop',
        'deviceDiscovery.onboarding.unconnected.connectStep.title': '手機連接',
        'deviceDiscovery.onboarding.unconnected.connectStep.body':
          '輸入連接碼或掃碼連接',
        'deviceDiscovery.onboarding.unconnected.syncStep.title': '開始同步',
        'deviceDiscovery.onboarding.unconnected.syncStep.body':
          '素材自動傳輸到電腦',
        'deviceDiscovery.onboarding.unconnected.copy': '複製',
        'deviceDiscovery.onboarding.unconnected.copyFailed': '複製失敗',
        'deviceDiscovery.onboarding.unconnected.copyHint':
          '複製後在電腦瀏覽器中打開即可下載',
        'deviceDiscovery.onboarding.unconnected.start':
          '我已經下載好了，去連接設備',
        'deviceDiscovery.onboarding.unconnected.footerNote':
          '首次使用引導 · 可在幫助頁重新查看',
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
      expect(screen.getByText('開始使用 Vivi Drop')).toBeTruthy();
    });
    expect(screen.getByText('首次使用引導 · 可在幫助頁重新查看')).toBeTruthy();

    fireEvent.press(screen.getByText('我已經下載好了，去連接設備'));

    await waitFor(
      () => {
        expect(mockMarkUnconnectedGuideSeen).toHaveBeenCalledTimes(1);
        expect(screen.queryByText('開始使用 Vivi Drop')).toBeNull();
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
    expect(screen.queryByText('開始使用 Vivi Drop')).toBeNull();
  });
});
