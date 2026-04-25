/**
 * Tests for the diagnostic upload flow in SettingsScreen.
 *
 * Covers:
 *  - Confirm modal appears on button press
 *  - Upload service is called after confirm
 *  - Success path: toast shown with refId, clipboard written
 *  - Error paths: BUNDLE_TOO_LARGE, ABORTED, NETWORK_ERROR → correct toast
 */
import React from 'react';
import { Alert, Clipboard } from 'react-native';
import { fireEvent, render, waitFor, act } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SubscriptionInfo, UserProfile } from '../../stores/auth-store';
import { DiagnosticUploadError } from '../../services/diagnostic-upload-service';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

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
    const R = require('react');
    R.useEffect(effect, [effect]);
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
    const R = require('react');
    const { Text } = require('react-native');
    return R.createElement(Text, null, name);
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

// Mock the diagnostic upload service
const mockUpload = jest.fn();
jest.mock('../../services/diagnostic-upload-service', () => {
  class DiagnosticUploadError extends Error {
    readonly detail: { kind: string; status?: number };
    constructor(detail: { kind: string; status?: number }) {
      super(detail.kind);
      this.detail = detail;
      this.name = 'DiagnosticUploadError';
    }
  }
  return {
    DiagnosticUploadError,
    diagnosticUploadService: {
      upload: (...args: unknown[]) => mockUpload(...args),
    },
  };
});

// ---------------------------------------------------------------------------
// Auth mock
// ---------------------------------------------------------------------------

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
    id: 42,
    primaryIdentity: { type: 'phone', display: '138****8888' },
    identities: [{ type: 'phone', display: '138****8888' }],
    status: 'subscribed' as const,
    plan: 'yearly' as const,
    expireAt: '2027-04-01T00:00:00.000Z',
    trialEnd: null,
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

jest.mock('../../stores/auth-store', () => ({
  useAuth: () => mockAuth,
  isFeatureAccessAllowed: jest.fn().mockReturnValue(true),
  getTrialRemainingDays: jest.fn().mockReturnValue(0),
}));

jest.mock('../../constants/features', () => ({
  FEATURES: {
    IAP_ENABLED: false,
    IAP_RESTORE_ENABLED: false,
  },
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import i18n from '../../i18n';
import { SettingsScreen } from '../SettingsScreen';
import { NativeModules, NativeEventEmitter } from 'react-native';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EXPORT_PATH = '/tmp/diagnostics-test.zip';

const mockNativeSyncEngine = {
  getBindingState: jest.fn().mockResolvedValue(null),
  getClientId: jest.fn().mockResolvedValue('mobile-client-uuid'),
  getClientDisplayName: jest.fn().mockResolvedValue('My iPhone'),
  getAppInfo: jest.fn().mockResolvedValue({ version: '1.0.0', build: '1' }),
  getHistoryDays: jest.fn().mockResolvedValue({ items: [] }),
  getSyncOverview: jest.fn().mockResolvedValue({
    progressPercent: 0,
    transferredBytes: 0,
    currentFile: null,
    currentFileConfirmedBytes: 0,
    uploadState: 'idle',
  }),
  exportDiagnostics: jest.fn().mockResolvedValue(EXPORT_PATH),
  setClientDisplayName: jest.fn().mockResolvedValue(undefined),
  disconnectAndUnbind: jest.fn().mockResolvedValue(undefined),
  resetAllStatus: jest.fn().mockResolvedValue(undefined),
  getKnownDeviceIds: jest.fn().mockResolvedValue([]),
  addListener: jest.fn(),
  removeListeners: jest.fn(),
};

/** Simulate pressing a named button on the most-recent Alert.alert call. */
function pressAlertButton(buttonText: string): void {
  const alertMock = Alert.alert as jest.Mock;
  const lastCall = alertMock.mock.calls[alertMock.mock.calls.length - 1];
  const buttons: Array<{ text: string; onPress?: () => void }> =
    lastCall[2] ?? [];
  const btn = buttons.find(b => b.text === buttonText);
  if (!btn) {
    throw new Error(
      `Alert button "${buttonText}" not found. Available: ${buttons.map(b => b.text).join(', ')}`,
    );
  }
  btn.onPress?.();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SettingsScreen — diagnostic upload flow', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('zh-Hant');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
    (AsyncStorage.removeItem as jest.Mock).mockResolvedValue(undefined);
    NativeModules.NativeSyncEngine = mockNativeSyncEngine;
    jest
      .spyOn(NativeEventEmitter.prototype, 'addListener')
      .mockImplementation(() => ({ remove: jest.fn() }) as never);
    jest.spyOn(Alert, 'alert');
    jest.spyOn(Clipboard, 'setString').mockImplementation(() => undefined);
  });

  test('pressing the upload button shows confirm modal with correct title', async () => {
    const { getByText } = render(<SettingsScreen />);

    await waitFor(() => {
      expect(getByText('上傳診斷包')).toBeTruthy();
    });

    fireEvent.press(getByText('上傳診斷包'));

    expect(Alert.alert).toHaveBeenCalledWith(
      '上傳診斷包',
      expect.stringContaining('Vivi Drop'),
      expect.arrayContaining([
        expect.objectContaining({ text: '取消' }),
        expect.objectContaining({ text: '繼續' }),
      ]),
    );
  });

  test('pressing Cancel in confirm modal does not invoke upload service', async () => {
    const { getByText } = render(<SettingsScreen />);

    await waitFor(() => {
      expect(getByText('上傳診斷包')).toBeTruthy();
    });

    fireEvent.press(getByText('上傳診斷包'));
    pressAlertButton('取消');

    expect(mockUpload).not.toHaveBeenCalled();
  });

  test('success: upload service called with file URI + mobile client id, success toast shown with refId, clipboard written', async () => {
    mockUpload.mockResolvedValueOnce({
      refId: 'ABC12XYZ',
      uploadedAt: '2026-04-25T10:00:00.000Z',
    });

    const { getByText } = render(<SettingsScreen />);

    await waitFor(() => {
      expect(getByText('上傳診斷包')).toBeTruthy();
    });

    fireEvent.press(getByText('上傳診斷包'));

    await act(async () => {
      pressAlertButton('繼續');
    });

    await waitFor(() => {
      expect(mockUpload).toHaveBeenCalledWith(
        'file:///tmp/diagnostics-test.zip',
        'mobile-client-uuid',
        expect.any(AbortSignal),
        expect.any(Function),
      );
    });

    await waitFor(() => {
      const calls = (Alert.alert as jest.Mock).mock.calls as string[][];
      const successCall = calls.find(
        c => typeof c[0] === 'string' && c[0].includes('ABC12XYZ'),
      );
      expect(successCall).toBeTruthy();
    });

    expect(Clipboard.setString).toHaveBeenCalledWith('ABC12XYZ');
  });

  test('BUNDLE_TOO_LARGE error shows tooLarge toast', async () => {
    mockUpload.mockRejectedValueOnce(
      new DiagnosticUploadError({ kind: 'BUNDLE_TOO_LARGE' }),
    );

    const { getByText } = render(<SettingsScreen />);

    await waitFor(() => {
      expect(getByText('上傳診斷包')).toBeTruthy();
    });

    fireEvent.press(getByText('上傳診斷包'));

    await act(async () => {
      pressAlertButton('繼續');
    });

    await waitFor(() => {
      const calls = (Alert.alert as jest.Mock).mock.calls as string[][];
      const toastCall = calls.find(
        c => typeof c[0] === 'string' && c[0].includes('過大'),
      );
      expect(toastCall).toBeTruthy();
    });

    expect(Clipboard.setString).not.toHaveBeenCalled();
  });

  test('ABORTED error shows aborted toast', async () => {
    mockUpload.mockRejectedValueOnce(
      new DiagnosticUploadError({ kind: 'ABORTED' }),
    );

    const { getByText } = render(<SettingsScreen />);

    await waitFor(() => {
      expect(getByText('上傳診斷包')).toBeTruthy();
    });

    fireEvent.press(getByText('上傳診斷包'));

    await act(async () => {
      pressAlertButton('繼續');
    });

    await waitFor(() => {
      const calls = (Alert.alert as jest.Mock).mock.calls as string[][];
      // Aborted toast text is "已取消上傳"
      const toastCall = calls.find(
        c => typeof c[0] === 'string' && c[0].includes('取消'),
      );
      expect(toastCall).toBeTruthy();
    });
  });

  test('NETWORK_ERROR shows generic failure toast', async () => {
    mockUpload.mockRejectedValueOnce(
      new DiagnosticUploadError({ kind: 'NETWORK_ERROR' }),
    );

    const { getByText } = render(<SettingsScreen />);

    await waitFor(() => {
      expect(getByText('上傳診斷包')).toBeTruthy();
    });

    fireEvent.press(getByText('上傳診斷包'));

    await act(async () => {
      pressAlertButton('繼續');
    });

    await waitFor(() => {
      const calls = (Alert.alert as jest.Mock).mock.calls as string[][];
      const toastCall = calls.find(
        c => typeof c[0] === 'string' && c[0].includes('失敗'),
      );
      expect(toastCall).toBeTruthy();
    });
  });
});
