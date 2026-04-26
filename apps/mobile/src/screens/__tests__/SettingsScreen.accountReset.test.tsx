/**
 * Phase 1 integration tests for `SettingsScreen.handleLogout` /
 * `SettingsScreen.handleDeleteAccount`. The focus here is the cleanup
 * sequence mandated by the account-identity-reset spec §4 Phase 1 —
 * desktop sidecar reset → native wipe → user-scoped storage sweep →
 * auth.clearAuth(), each step awaited, with best-effort resilience so a
 * single flaky step cannot strand the user in Settings.
 *
 * Kept separate from the broader `SettingsScreen.test.tsx` suite (which
 * covers subscription-card display and lives on the subscription WIP
 * branch) so this file ships self-contained with the feature branch.
 */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
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
const mockDispatch = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    canGoBack: jest.fn().mockReturnValue(true),
    reset: jest.fn(),
    dispatch: mockDispatch,
  }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const ReactInner = require('react');
    ReactInner.useEffect(effect, [effect]);
  },
  CommonActions: {
    reset: jest.fn(payload => payload),
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
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
  logout: jest.fn().mockResolvedValue(undefined),
  deleteAccount: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/iap-service', () => ({
  iapService: {
    restore: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock('../../utils/shareDiagnosticsArchive', () => ({
  isDiagnosticsExportUnavailable: jest.fn().mockReturnValue(false),
  shareDiagnosticsArchive: jest.fn().mockResolvedValue('mock.zip'),
}));

// Account-identity-reset plumbing — mocked here so we can assert the exact
// order that `handleLogout` / `handleDeleteAccount` kick them off.
const mockResetSidecar = jest.fn().mockResolvedValue(undefined);
const mockWipeSyncIdentity = jest.fn().mockResolvedValue(undefined);
const mockClearUserScopedStorage = jest.fn().mockResolvedValue(undefined);

jest.mock('../../services/sidecar-reset-service', () => ({
  resetCurrentDesktopSidecarIfReachable: (...args: unknown[]) =>
    mockResetSidecar(...args),
}));

jest.mock('../../utils/clearUserScopedStorage', () => ({
  clearUserScopedStorage: (...args: unknown[]) =>
    mockClearUserScopedStorage(...args),
}));

jest.mock('../../services/SyncEngineModule', () => ({
  getClientId: jest.fn().mockResolvedValue('mobile-client-uuid'),
  wipeSyncIdentity: (...args: unknown[]) => mockWipeSyncIdentity(...args),
}));

const mockAuth: {
  user: UserProfile | null;
  subscription: SubscriptionInfo | null;
  refreshToken: string;
  clearAuth: jest.Mock;
  loadSubscription: jest.Mock;
  setSignedOutTransition: jest.Mock;
} = {
  user: {
    id: 1,
    primaryIdentity: { type: 'email', display: 'test@example.com' },
    identities: [{ type: 'email', display: 'test@example.com' }],
    status: 'subscribed',
    plan: 'yearly',
    expireAt: '2027-04-01T00:00:00.000Z',
    trialEnd: null,
  },
  subscription: {
    status: 'subscribed',
    plan: 'yearly',
    expireAt: '2027-04-01T00:00:00.000Z',
    trialEnd: null,
  },
  refreshToken: 'refresh-token',
  clearAuth: jest.fn(),
  loadSubscription: jest.fn().mockResolvedValue(undefined),
  setSignedOutTransition: jest.fn(),
};

jest.mock('../../stores/auth-store', () => ({
  useAuth: () => mockAuth,
  isFeatureAccessAllowed: jest.fn(() => true),
  getTrialRemainingDays: jest.fn(() => 0),
}));

jest.mock('../../constants/features', () => ({
  FEATURES: {
    IAP_ENABLED: true,
    IAP_RESTORE_ENABLED: true,
  },
}));

import i18n from '../../i18n';
import { SettingsScreen } from '../SettingsScreen';
import {
  Alert,
  Linking,
  NativeModules,
  NativeEventEmitter,
} from 'react-native';
import {
  deleteAccount as mockDeleteAccount,
  logout as mockServerLogout,
} from '../../services/auth-service';
import { ApiError } from '../../services/api';
import type { RenderAPI } from '@testing-library/react-native';

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
  wipeSyncIdentity: jest.fn().mockResolvedValue(undefined),
  addListener: jest.fn(),
  removeListeners: jest.fn(),
};

async function flushScreenEffects(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function renderSettingsScreen(): Promise<RenderAPI> {
  const screen = render(<SettingsScreen />);
  await act(async () => {
    await flushScreenEffects();
  });
  return screen;
}

/**
 * Drive `Alert.alert` to the button whose `text` matches. The production
 * flow runs through one (logout) or two (delete-account) nested alerts;
 * each alert's `onPress` is the only path that kicks off the awaited
 * cleanup we want to assert on.
 */
async function pressAlertButtonRaw(buttonText: string): Promise<void> {
  const call = (Alert.alert as jest.Mock).mock.calls.at(-1);
  if (!call) {
    throw new Error('Alert.alert was never called');
  }
  const buttons = (call[2] ?? []) as Array<{
    text: string;
    onPress?: () => void | Promise<void>;
  }>;
  const match = buttons.find(b => b.text === buttonText);
  if (!match || !match.onPress) {
    throw new Error(
      `No button "${buttonText}" found. Available: ${buttons
        .map(b => b.text)
        .join(', ')}`,
    );
  }
  await match.onPress();
}

async function pressAlertButton(buttonText: string): Promise<void> {
  await act(async () => {
    await pressAlertButtonRaw(buttonText);
    await flushScreenEffects();
  });
}

describe('SettingsScreen — account-identity-reset (Phase 1)', () => {
  let alertSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeAll(async () => {
    await i18n.changeLanguage('zh-Hant');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    NativeModules.NativeSyncEngine = mockNativeSyncEngine;
    jest
      .spyOn(NativeEventEmitter.prototype, 'addListener')
      .mockImplementation(() => ({ remove: jest.fn() } as never));
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    alertSpy.mockRestore();
    warnSpy.mockRestore();
  });

  describe('handleLogout', () => {
    test('runs sidecar reset → native wipe → scoped storage → serverLogout → clearAuth in order', async () => {
      const callOrder: string[] = [];
      mockResetSidecar.mockImplementationOnce(async () => {
        callOrder.push('sidecar');
      });
      mockWipeSyncIdentity.mockImplementationOnce(async () => {
        callOrder.push('wipe');
      });
      mockClearUserScopedStorage.mockImplementationOnce(async () => {
        callOrder.push('scoped');
      });
      // Use .mockImplementationOnce to log entry, not just
      // .mockResolvedValue — the production call is fire-and-forget
      // (`void serverLogout(...)`), but the mock impl runs synchronously
      // when the call is dispatched, so the push lands on the ledger
      // before the next awaited step (clearAuth) executes.
      (mockServerLogout as jest.Mock).mockImplementationOnce(() => {
        callOrder.push('serverLogout');
        return Promise.resolve();
      });
      mockAuth.clearAuth.mockImplementationOnce(() => {
        callOrder.push('clearAuth');
      });

      const { getByText } = await renderSettingsScreen();
      fireEvent.press(getByText('登出'));
      await pressAlertButton('確定退出');

      expect(callOrder).toEqual([
        'sidecar',
        'wipe',
        'scoped',
        'serverLogout',
        'clearAuth',
      ]);
    });

    test('blocks logout when wipeSyncIdentity rejects — shows error alert and keeps user signed in', async () => {
      // Wipe failure is fail-closed for logout. Clearing auth while the
      // device still has the prior account's pairing token / clientId /
      // queue / history would hand the next login a contaminated local
      // state and make Phase-2 owner-guard a single point of failure —
      // we refuse to rely on that here. Expected behaviour: surface an
      // error alert, reset the in-flight flag so the user can retry, and
      // leave auth untouched.
      mockWipeSyncIdentity.mockRejectedValueOnce(new Error('wipe exploded'));

      const { getByText } = await renderSettingsScreen();
      await act(async () => {
        fireEvent.press(getByText('登出'));
      });
      await pressAlertButton('確定退出');

      expect(mockWipeSyncIdentity).toHaveBeenCalledTimes(1);
      expect(mockClearUserScopedStorage).not.toHaveBeenCalled();
      expect(mockAuth.clearAuth).not.toHaveBeenCalled();
      // Core behavioural guarantee of the fix: if the local wipe
      // can't be completed, we must NOT revoke the refresh token on
      // the server either — otherwise we'd leave client + server in
      // an inconsistent "signed in locally, revoked server-side"
      // state, which only resolves on the next 401 and is hostile
      // to debug.
      expect(mockServerLogout).not.toHaveBeenCalled();

      // The last Alert.alert call should be the logout-failed dialog.
      // Match either the (future) i18n title or the current hardcoded
      // zh-Hant fallback — see the TODO(i18n) comment in SettingsScreen.
      const lastAlert = (Alert.alert as jest.Mock).mock.calls.at(-1);
      expect(lastAlert).toBeDefined();
      expect(lastAlert?.[0]).toMatch(/登出失敗|Logout failed/i);
    });

    test('proceeds with later steps even if sidecar reset rejects (belt + braces)', async () => {
      mockResetSidecar.mockRejectedValueOnce(new Error('sidecar errored'));

      const { getByText } = await renderSettingsScreen();
      fireEvent.press(getByText('登出'));
      await pressAlertButton('確定退出');

      expect(mockWipeSyncIdentity).toHaveBeenCalledTimes(1);
      expect(mockAuth.clearAuth).toHaveBeenCalledTimes(1);
      // Sidecar is best-effort; wipe still succeeds here, so the
      // happy-path serverLogout revoke MUST run (fire-and-forget).
      expect(mockServerLogout).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleDeleteAccount', () => {
    test('awaits sidecar reset → wipe → scoped storage → clearAuth after successful server delete', async () => {
      const callOrder: string[] = [];
      mockResetSidecar.mockImplementationOnce(async () => {
        callOrder.push('sidecar');
      });
      mockWipeSyncIdentity.mockImplementationOnce(async () => {
        callOrder.push('wipe');
      });
      mockClearUserScopedStorage.mockImplementationOnce(async () => {
        callOrder.push('scoped');
      });
      mockAuth.clearAuth.mockImplementationOnce(() => {
        callOrder.push('clearAuth');
      });
      mockAuth.setSignedOutTransition.mockImplementationOnce(() => {
        callOrder.push('transition');
      });

      const { getByText } = await renderSettingsScreen();
      fireEvent.press(getByText('刪除帳號'));
      await pressAlertButton('繼續');
      await pressAlertButton('確定刪除');

      expect(callOrder).toEqual([
        'transition',
        'sidecar',
        'wipe',
        'scoped',
        'clearAuth',
      ]);
    });

    test('renders a blocking overlay while handleDeleteAccount cleanup runs', async () => {
      // Gate `resetCurrentDesktopSidecarIfReachable` on an external
      // resolver so we can assert the overlay is on-screen in the middle
      // of the cleanup sequence, not just before/after it. Until we call
      // `resolveSidecar()` the handler is parked on the first cleanup
      // await with `isDeletingAccount === true`.
      let resolveSidecar: (() => void) | undefined;
      const sidecarGate = new Promise<void>(resolve => {
        resolveSidecar = resolve;
      });
      mockResetSidecar.mockImplementationOnce(() => sidecarGate);

      const { getByText, queryByText } = await renderSettingsScreen();
      fireEvent.press(getByText('刪除帳號'));
      await pressAlertButton('繼續');

      // Fire the final confirm but do NOT await it — we want to sample
      // the UI while the handler is mid-flight, parked on sidecarGate.
      let callPromise!: Promise<void>;
      act(() => {
        callPromise = pressAlertButtonRaw('確定刪除');
      });

      // `deleteAccount` (server call) resolves before the sidecar reset
      // is even kicked off, so we wait until the handler has reached the
      // sidecar step — at which point the overlay MUST be rendered.
      await waitFor(() => {
        expect(mockResetSidecar).toHaveBeenCalledTimes(1);
      });

      expect(queryByText('刪除帳號中…')).not.toBeNull();
      // The logged-in Settings tree underneath must NOT be the thing the
      // user interacts with — the overlay sits above it. We can't easily
      // assert "untappable" cross-platform, but we can at least confirm
      // the cleanup has not finished and clearAuth has not fired yet.
      expect(mockAuth.clearAuth).not.toHaveBeenCalled();

      // Release the gate so the rest of the cleanup chain can run to
      // completion; after that the overlay disappears because
      // clearAuth + unmount would kick in (here we just check the flag
      // flips back to hidden once the awaits settle).
      await act(async () => {
        resolveSidecar?.();
        await callPromise;
      });

      expect(mockAuth.clearAuth).toHaveBeenCalledTimes(1);
    });

    test('handleDeleteAccount proceeds with clearAuth even when wipe rejects — account is gone server-side regardless', async () => {
      // Fail-OPEN on delete-account wipe failure — mirror the behaviour
      // handleLogout refuses to take. The account row / tokens are
      // already nuked on the backend by the time we reach the cleanup
      // chain, so refusing to clearAuth would strand the user in a
      // logged-in shell with no valid credentials. The reinstall
      // sentinel + next-login owner-guard are the backstops.
      mockWipeSyncIdentity.mockRejectedValueOnce(new Error('wipe exploded'));

      const { getByText } = await renderSettingsScreen();
      await act(async () => {
        fireEvent.press(getByText('刪除帳號'));
      });
      await pressAlertButton('繼續');
      await pressAlertButton('確定刪除');

      expect(mockWipeSyncIdentity).toHaveBeenCalledTimes(1);
      expect(mockAuth.clearAuth).toHaveBeenCalledTimes(1);
    });

    test('does NOT run cleanup or clearAuth when server deleteAccount rejects', async () => {
      (mockDeleteAccount as jest.Mock).mockRejectedValueOnce(
        new Error('server down'),
      );

      const { getByText } = await renderSettingsScreen();
      fireEvent.press(getByText('刪除帳號'));
      await pressAlertButton('繼續');
      await pressAlertButton('確定刪除');

      expect(mockResetSidecar).not.toHaveBeenCalled();
      expect(mockWipeSyncIdentity).not.toHaveBeenCalled();
      expect(mockClearUserScopedStorage).not.toHaveBeenCalled();
      expect(mockAuth.clearAuth).not.toHaveBeenCalled();
      // A user-visible error alert gets raised (title + message) so the
      // user knows their account is still alive on the backend.
      expect(alertSpy.mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    test('prompts user to cancel Apple subscription before deleting account', async () => {
      const openUrlSpy = jest
        .spyOn(Linking, 'openURL')
        .mockResolvedValueOnce(undefined);
      (mockDeleteAccount as jest.Mock).mockRejectedValueOnce(
        new ApiError(1109, '請先取消 Apple 訂閱後再刪除帳號'),
      );

      const { getByText } = await renderSettingsScreen();
      fireEvent.press(getByText('刪除帳號'));
      await pressAlertButton('繼續');
      await pressAlertButton('確定刪除');

      expect(mockResetSidecar).not.toHaveBeenCalled();
      expect(mockWipeSyncIdentity).not.toHaveBeenCalled();
      expect(mockClearUserScopedStorage).not.toHaveBeenCalled();
      expect(mockAuth.clearAuth).not.toHaveBeenCalled();

      const lastAlert = (Alert.alert as jest.Mock).mock.calls.at(-1);
      expect(lastAlert?.[0]).toBe('請先取消訂閱');
      expect(lastAlert?.[1]).toContain('Apple 訂閱管理');

      await pressAlertButton('管理訂閱');

      expect(openUrlSpy).toHaveBeenCalledWith(
        'https://apps.apple.com/account/subscriptions',
      );
      openUrlSpy.mockRestore();
    });
  });
});
