import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ReactTestInstance } from 'react-test-renderer';
import type { SubscriptionInfo, UserProfile } from '../../stores/auth-store';

jest.mock('react-native-localize', () => ({
  getLocales: () => [
    {
      languageCode: 'zh',
      scriptCode: 'Hant',
      countryCode: 'TW',
      languageTag: 'zh-Hant-TW',
      isRTL: false,
    },
  ],
}));

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockReset = jest.fn();
const mockDispatch = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    const ReactInner = require('react');
    ReactInner.useEffect(effect, [effect]);
  },
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    canGoBack: jest.fn().mockReturnValue(true),
    reset: mockReset,
    dispatch: mockDispatch,
  }),
  CommonActions: {
    reset: jest.fn(payload => payload),
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
  resetGenericPassword: jest.fn(),
}));

jest.mock('../../components/Icon', () => ({
  Icon: ({ name }: { name: string }) => {
    const ReactInner = require('react');
    const { Text: MockText } = require('react-native');
    return ReactInner.createElement(MockText, null, name);
  },
}));

jest.mock('../../services/auth-service', () => ({
  logout: jest.fn(),
  deleteAccount: jest.fn(),
}));

jest.mock('../../services/iap-service', () => ({
  iapService: {
    restore: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock('../../services/subscription-service', () => ({
  getSubscriptionStatus: jest.fn().mockResolvedValue({
    status: 'subscribed',
    plan: 'yearly',
    expireAt: '2027-04-01T00:00:00.000Z',
    trialEnd: null,
  }),
}));

jest.mock('../../utils/shareDiagnosticsArchive', () => ({
  isDiagnosticsExportUnavailable: jest.fn().mockReturnValue(false),
  shareDiagnosticsArchive: jest.fn().mockResolvedValue('mock.zip'),
}));

const mockAuth: {
  user: UserProfile | null;
  subscription: SubscriptionInfo | null;
  refreshToken: string;
  clearAuth: jest.Mock;
  loadSubscription: jest.Mock;
  setSubscription: jest.Mock;
  setSignedOutTransition: jest.Mock;
} = {
  user: {
    id: 1,
    primaryIdentity: { type: 'email', display: 'test@example.com' },
    identities: [{ type: 'email', display: 'test@example.com' }],
    status: 'trial_expired' as const,
    plan: '' as const,
    expireAt: null,
    trialEnd: '2026-04-01T00:00:00.000Z',
  },
  subscription: {
    status: 'subscribed' as const,
    plan: 'yearly' as const,
    expireAt: '2027-04-01T00:00:00.000Z',
    trialEnd: null,
  },
  refreshToken: 'refresh-token',
  clearAuth: jest.fn(),
  loadSubscription: jest.fn().mockResolvedValue(undefined),
  setSubscription: jest.fn(),
  setSignedOutTransition: jest.fn(),
};

function resetMockAuth() {
  mockAuth.user = {
    id: 1,
    primaryIdentity: { type: 'email', display: 'test@example.com' },
    identities: [{ type: 'email', display: 'test@example.com' }],
    status: 'trial_expired',
    plan: '',
    expireAt: null,
    trialEnd: '2026-04-01T00:00:00.000Z',
  };
  mockAuth.subscription = {
    status: 'subscribed',
    plan: 'yearly',
    expireAt: '2027-04-01T00:00:00.000Z',
    trialEnd: null,
  };
}

jest.mock('../../stores/auth-store', () => ({
  useAuth: () => mockAuth,
  isFeatureAccessAllowed: jest.fn(),
  getTrialRemainingDays: jest.fn(user => {
    if (!user?.trialEnd) return 0;
    return 3;
  }),
}));

jest.mock('../../constants/features', () => ({
  FEATURES: {
    IAP_ENABLED: true,
    IAP_RESTORE_ENABLED: true,
  },
}));

import i18n from '../../i18n';
import { SettingsScreen } from '../SettingsScreen';
import { NativeModules, NativeEventEmitter } from 'react-native';
import { ApiError, ERROR_CODE } from '../../services/api';
import { iapService } from '../../services/iap-service';
import { LANGUAGE_PREFERENCE_STORAGE_KEY } from '../../i18n/language-preference';

const mockNativeSyncEngine = {
  getBindingState: jest.fn().mockResolvedValue(null),
  getClientDisplayName: jest.fn().mockResolvedValue('我的 iPhone'),
  getAppInfo: jest.fn().mockResolvedValue({ version: '1.0.0', build: '1' }),
  getHistoryDays: jest.fn().mockResolvedValue({ items: [] }),
  getSyncOverview: jest.fn().mockResolvedValue({
    progressPercent: 0,
    transferredBytes: 0,
    currentFile: null,
    currentFileConfirmedBytes: 0,
    uploadState: 'idle',
  }),
  setClientDisplayName: jest.fn().mockResolvedValue(undefined),
  disconnectAndUnbind: jest.fn().mockResolvedValue(undefined),
  resetAllStatus: jest.fn().mockResolvedValue(undefined),
  getKnownDeviceIds: jest.fn().mockResolvedValue([]),
  addListener: jest.fn(),
  removeListeners: jest.fn(),
};

describe('SettingsScreen', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('zh-Hant');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
    (AsyncStorage.removeItem as jest.Mock).mockResolvedValue(undefined);
    resetMockAuth();
    NativeModules.NativeSyncEngine = mockNativeSyncEngine;
    jest
      .spyOn(NativeEventEmitter.prototype, 'addListener')
      .mockImplementation(() => ({ remove: jest.fn() }) as never);
  });

  test('subscription card prefers subscription status over stale user status', async () => {
    const { queryByText, getByText } = render(<SettingsScreen />);

    await waitFor(() => {
      expect(getByText('有效')).toBeTruthy();
    });

    expect(queryByText('已到期')).toBeNull();
  });

  test('monthly intro trial is displayed as subscription service, not account trial', async () => {
    const sevenDaysFromNow = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000,
    ).toISOString();
    mockAuth.user = {
      id: 1,
      primaryIdentity: { type: 'email', display: 'test@example.com' },
      identities: [{ type: 'email', display: 'test@example.com' }],
      status: 'trial_expired',
      plan: '',
      expireAt: null,
      trialEnd: '2026-04-01T00:00:00.000Z',
    };
    mockAuth.subscription = {
      status: 'trialing',
      plan: 'monthly',
      expireAt: null,
      trialEnd: sevenDaysFromNow,
    };

    const { getByText, queryByText } = render(<SettingsScreen />);

    await waitFor(() => {
      expect(getByText('訂閱服務')).toBeTruthy();
    });

    expect(getByText('7 天')).toBeTruthy();
    expect(getByText('月訂閱免費期')).toBeTruthy();
    expect(queryByText('免費試用')).toBeNull();
    expect(queryByText('立即訂閱')).toBeNull();
  });

  test('restore bound to another account shows dedicated alert', async () => {
    (iapService.restore as jest.Mock).mockRejectedValueOnce(
      new ApiError(ERROR_CODE.RECEIPT_BOUND_TO_OTHER_USER, 'bound'),
    );
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const { getByText } = render(<SettingsScreen />);
    fireEvent.press(getByText('恢復已購買訂閱'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy.mock.calls[0]?.[0]).toMatch(/Apple.*綁定/);
    alertSpy.mockRestore();
  });

  test('disables reset sync status while uploading', async () => {
    mockNativeSyncEngine.getSyncOverview.mockResolvedValueOnce({
      progressPercent: 42,
      transferredBytes: 1024,
      currentFile: 'file-key',
      currentFileConfirmedBytes: 1024,
      uploadState: 'uploading',
    });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const { getByText } = render(<SettingsScreen />);

    await waitFor(() => {
      expect(getByText('重置同步狀態')).toBeTruthy();
    });

    fireEvent.press(getByText('重置同步狀態'));

    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockNativeSyncEngine.resetAllStatus).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  test('language selector persists the selected language and updates the screen immediately', async () => {
    const { getByText } = render(<SettingsScreen />);

    await waitFor(() => {
      expect(getByText('語言')).toBeTruthy();
    });

    fireEvent.press(getByText('English'));

    await waitFor(() => {
      expect(i18n.language).toBe('en');
    });

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      LANGUAGE_PREFERENCE_STORAGE_KEY,
      'en',
    );
    expect(getByText('Settings')).toBeTruthy();
    expect(getByText('Language')).toBeTruthy();
  });

  describe('Device name editing — transfer lock', () => {
    beforeEach(async () => {
      await i18n.changeLanguage('zh-Hant');
    });

    it('idle: pencil button enables entering edit mode', async () => {
      mockNativeSyncEngine.getSyncOverview.mockResolvedValueOnce({
        progressPercent: 0,
        transferredBytes: 0,
        currentFile: null,
        currentFileConfirmedBytes: 0,
        uploadState: 'idle',
      });

      const { getByText, queryAllByText, UNSAFE_getAllByType } = render(
        <SettingsScreen />,
      );

      await waitFor(() => {
        expect(getByText('我的設備名稱')).toBeTruthy();
      });

      // The locked hint should NOT be present in idle state.
      expect(queryAllByText('傳輸進行中，暫不可修改設備名稱').length).toBe(0);

      // Find the pencil edit button by its icon name and press it.
      const TextRN = require('react-native').Text;
      const pencilNode = UNSAFE_getAllByType(TextRN).find(
        (n: ReactTestInstance) => n.props.children === 'pencil-outline',
      );
      expect(pencilNode).toBeTruthy();
      fireEvent.press(pencilNode!);

      // After entering edit mode, the checkmark icon (confirm button) appears.
      await waitFor(() => {
        const checkmark = UNSAFE_getAllByType(TextRN).find(
          (n: ReactTestInstance) => n.props.children === 'checkmark',
        );
        expect(checkmark).toBeTruthy();
      });
    });

    it('uploading: locked hint shown and pencil press does not open edit mode', async () => {
      mockNativeSyncEngine.getSyncOverview.mockResolvedValueOnce({
        progressPercent: 30,
        transferredBytes: 1024,
        currentFile: 'photo.jpg',
        currentFileConfirmedBytes: 512,
        uploadState: 'uploading',
      });

      const { getByText, UNSAFE_getAllByType } = render(<SettingsScreen />);

      // Locked hint is the strongest signal that the lock UI engaged.
      await waitFor(() => {
        expect(getByText('傳輸進行中，暫不可修改設備名稱')).toBeTruthy();
      });

      const TextRN = require('react-native').Text;
      const pencilNode = UNSAFE_getAllByType(TextRN).find(
        (n: ReactTestInstance) => n.props.children === 'pencil-outline',
      );
      expect(pencilNode).toBeTruthy();
      fireEvent.press(pencilNode!);

      // No checkmark (confirm) → edit mode never opened.
      const checkmark = UNSAFE_getAllByType(TextRN).find(
        (n: ReactTestInstance) => n.props.children === 'checkmark',
      );
      expect(checkmark).toBeFalsy();

      // setClientDisplayName must NOT have been invoked.
      expect(mockNativeSyncEngine.setClientDisplayName).not.toHaveBeenCalled();
    });
  });

  describe('Switch Device button', () => {
    beforeEach(async () => {
      await i18n.changeLanguage('zh-Hant');
    });

    it('navigates to DeviceDiscovery switch mode when not uploading', async () => {
      mockNativeSyncEngine.getSyncOverview.mockResolvedValueOnce({
        progressPercent: 0,
        transferredBytes: 0,
        currentFile: null,
        currentFileConfirmedBytes: 0,
        uploadState: 'idle',
      });
      const { getByText } = render(<SettingsScreen />);
      await waitFor(() => {
        expect(getByText('切換')).toBeTruthy();
      });
      fireEvent.press(getByText('切換'));
      expect(mockNavigate).toHaveBeenCalledWith('DeviceDiscovery', {
        mode: 'switch',
      });
    });

    it('shows upload confirmation dialog when upload is active', async () => {
      mockNativeSyncEngine.getSyncOverview.mockResolvedValueOnce({
        progressPercent: 50,
        transferredBytes: 1024,
        currentFile: 'photo.jpg',
        currentFileConfirmedBytes: 512,
        uploadState: 'uploading',
      });
      const alertSpy = jest.spyOn(Alert, 'alert');
      const { getByText } = render(<SettingsScreen />);
      await waitFor(() => {
        expect(getByText('切換')).toBeTruthy();
      });
      fireEvent.press(getByText('切換'));
      expect(alertSpy).toHaveBeenCalledWith(
        expect.stringContaining('上傳'),
        expect.any(String),
        expect.any(Array),
      );
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });
});
