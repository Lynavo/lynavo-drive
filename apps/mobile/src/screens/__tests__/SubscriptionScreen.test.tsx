import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

// Must mock react-native-localize before i18n import
jest.mock('react-native-localize', () => ({
  getLocales: () => [
    {
      languageCode: 'zh',
      scriptCode: 'Hans',
      countryCode: 'CN',
      languageTag: 'zh-Hans-CN',
      isRTL: false,
    },
  ],
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    goBack: jest.fn(),
    canGoBack: jest.fn().mockReturnValue(true),
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../components/Icon', () => ({
  Icon: ({ name }: { name: string }) => {
    const ReactInner = require('react');
    const { Text: MockText } = require('react-native');
    return ReactInner.createElement(MockText, null, name);
  },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));

jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
  resetGenericPassword: jest.fn(),
}));

jest.mock('../../services/iap-service', () => ({
  iapService: {
    initialize: jest.fn().mockResolvedValue(undefined),
    teardown: jest.fn().mockResolvedValue(undefined),
    purchase: jest.fn(),
    restore: jest.fn().mockResolvedValue([]),
    finishTransaction: jest.fn().mockResolvedValue(undefined),
    checkEligibility: jest
      .fn()
      .mockResolvedValue([
        { productId: 'com.vividrop.mobile.china.monthly.999', eligibleForIntroOffer: true },
      ]),
    onOrphanPurchaseVerified: jest.fn(() => jest.fn()),
  },
}));

jest.mock('../../services/subscription-service', () => ({
  verifyIapReceipt: jest.fn().mockResolvedValue(undefined),
  getSubscriptionStatus: jest.fn(),
}));

jest.mock('../../constants/features', () => ({
  FEATURES: { IAP_ENABLED: true, IAP_RESTORE_ENABLED: true, SUBSCRIPTION_ENFORCEMENT: false },
}));

const mockLoadSubscription = jest.fn().mockResolvedValue(null);
const mockAuthState: {
  user: { id: number; status: string };
  subscription: { status: string; plan: string; expireAt: string | null; trialEnd: string | null } | null;
} = {
  user: { id: 1, status: 'trial_expired' },
  subscription: null,
};

jest.mock('../../stores/auth-store', () => ({
  useAuth: () => ({
    user: mockAuthState.user,
    subscription: mockAuthState.subscription,
    loadSubscription: mockLoadSubscription,
  }),
  isFeatureAccessAllowed: () => false,
}));

import i18n from '../../i18n';
import { SubscriptionScreen, resolveCurrentPlan } from '../SubscriptionScreen';
import { iapService } from '../../services/iap-service';
import { verifyIapReceipt } from '../../services/subscription-service';
import { ApiError, ERROR_CODE } from '../../services/api';

function renderScreen() {
  return render(<SubscriptionScreen />);
}

describe('SubscriptionScreen', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('zh-Hans');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthState.user = { id: 1, status: 'trial_expired' };
    mockAuthState.subscription = null;
    mockLoadSubscription.mockResolvedValue(null);
  });

  test('renders subscribe button', () => {
    const { getByText } = renderScreen();
    expect(getByText(/立即订阅|立即訂閱|Subscribe Now/)).toBeTruthy();
  });

  test('renders Restore button when flags enabled', () => {
    const { getByText } = renderScreen();
    expect(getByText(/恢復已購買訂閱|恢复已购买订阅|Restore Purchases/)).toBeTruthy();
  });

  test('monthly card shows trial copy when eligible', async () => {
    const { findByText } = renderScreen();
    expect(
      await findByText(/免費試用|免费试用|free trial/i),
    ).toBeTruthy();
  });

  test('subscribe tap invokes iapService.purchase then verify', async () => {
    (iapService.purchase as jest.Mock).mockResolvedValueOnce({
      productId: 'com.vividrop.mobile.china.yearly.10400',
      transactionReceipt: 'BLOB',
      transactionId: 'tx_1',
    });

    const { getByText } = renderScreen();
    fireEvent.press(getByText(/立即订阅|立即訂閱|Subscribe Now/));

    await waitFor(() => expect(iapService.purchase).toHaveBeenCalled());
    await waitFor(() => expect(verifyIapReceipt).toHaveBeenCalled());
  });

  test('restore tap invokes iapService.restore', async () => {
    (iapService.restore as jest.Mock).mockResolvedValueOnce([]);
    const { getByText } = renderScreen();
    fireEvent.press(getByText(/恢復已購買訂閱|恢复已购买订阅|Restore Purchases/));
    await waitFor(() => expect(iapService.restore).toHaveBeenCalled());
  });

  test('2002 from verify is treated as success (success modal shown)', async () => {
    (iapService.purchase as jest.Mock).mockResolvedValueOnce({
      productId: 'com.vividrop.mobile.china.yearly.10400',
      transactionReceipt: 'BLOB',
      transactionId: 'tx_1',
    });
    (verifyIapReceipt as jest.Mock).mockRejectedValueOnce(
      new ApiError(ERROR_CODE.RECEIPT_ALREADY_USED, 'used'),
    );

    const { getByText, findByText } = renderScreen();
    fireEvent.press(getByText(/立即订阅|立即訂閱|Subscribe Now/));

    expect(await findByText(/支付成功|Payment Successful/)).toBeTruthy();
  });

  test('E_ALREADY_OWNED shows dedicated alert and does NOT trigger restore', async () => {
    (iapService.purchase as jest.Mock).mockRejectedValueOnce({
      code: 'E_ALREADY_OWNED',
    });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const { getByText } = renderScreen();
    fireEvent.press(getByText(/立即订阅|立即訂閱|Subscribe Now/));

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());

    // Restore must not be auto-triggered — that was the Blocker #2 bug.
    expect(iapService.restore).not.toHaveBeenCalled();

    // Alert message must be the AlreadyOwned copy (any of the 3 locales).
    const alertMessage = alertSpy.mock.calls[0]?.[0] ?? '';
    expect(alertMessage).toMatch(
      /已有(有效)?订阅|已有(有效)?訂閱|already have an active subscription/i,
    );

    alertSpy.mockRestore();
  });

  test('success modal reflects expireAt from freshly-loaded subscription', async () => {
    (iapService.purchase as jest.Mock).mockResolvedValueOnce({
      productId: 'com.vividrop.mobile.china.yearly.10400',
      transactionReceipt: 'BLOB',
      transactionId: 'tx_1',
    });
    (verifyIapReceipt as jest.Mock).mockResolvedValueOnce(undefined);

    // loadSubscription returns the fresh snapshot; the screen reads
    // expireAt off that return value (not off the closed-over `subscription`
    // prop, which wouldn't have updated yet within the same async flow).
    mockLoadSubscription.mockResolvedValueOnce({
      status: 'subscribed',
      plan: 'yearly',
      expireAt: '2027-05-20T00:00:00Z',
      trialEnd: null,
    });

    const { getByText, findByText } = renderScreen();
    fireEvent.press(getByText(/立即订阅|立即訂閱|Subscribe Now/));

    // The modal's "valid until" line formats as YYYY/M/D (formatExpireDate).
    expect(await findByText(/2027\/5\/20/)).toBeTruthy();
  });

  test('current-plan badge appears on the plan the user already holds', () => {
    mockAuthState.subscription = {
      status: 'subscribed',
      plan: 'monthly',
      expireAt: '2027-05-20T00:00:00Z',
      trialEnd: null,
    };

    const { getByText, queryAllByText } = renderScreen();

    // Badge renders on monthly card.
    expect(getByText(/当前方案|目前方案|Current Plan/)).toBeTruthy();
    // Only one badge — yearly card stays actionable without the label.
    expect(queryAllByText(/当前方案|目前方案|Current Plan/).length).toBe(1);
  });

  test('CTA reads Switch Plan when user already has a subscription and selects the other plan', () => {
    mockAuthState.subscription = {
      status: 'subscribed',
      plan: 'monthly',
      expireAt: '2027-05-20T00:00:00Z',
      trialEnd: null,
    };

    const { getByText, queryByText } = renderScreen();

    // selectedPlan defaults to the non-current side (yearly here), so CTA
    // immediately shows the switch-plan label instead of "Subscribe Now".
    expect(getByText(/切换方案|切換方案|Switch Plan/)).toBeTruthy();
    expect(queryByText(/^立即订阅$|^立即訂閱$|^Subscribe Now$/)).toBeNull();
  });
});

describe('resolveCurrentPlan', () => {
  test('null subscription → null', () => {
    expect(resolveCurrentPlan(null)).toBeNull();
  });

  test('subscribed monthly → monthly', () => {
    expect(
      resolveCurrentPlan({ status: 'subscribed', plan: 'monthly' }),
    ).toBe('monthly');
  });

  test('trialing monthly (intro offer) → monthly', () => {
    // Trial-period IAP counts as the current Apple-level plan — tapping
    // monthly again during trial would be a no-op.
    expect(
      resolveCurrentPlan({ status: 'trialing', plan: 'monthly' }),
    ).toBe('monthly');
  });

  test('subscribed yearly → yearly', () => {
    expect(
      resolveCurrentPlan({ status: 'subscribed', plan: 'yearly' }),
    ).toBe('yearly');
  });

  test('trial_expired → null (no Apple plan held)', () => {
    expect(
      resolveCurrentPlan({ status: 'trial_expired', plan: '' }),
    ).toBeNull();
  });

  test('sub_expired → null (user needs to re-subscribe)', () => {
    expect(
      resolveCurrentPlan({ status: 'sub_expired', plan: 'monthly' }),
    ).toBeNull();
  });

  test('subscribed with empty plan → null (defensive)', () => {
    expect(
      resolveCurrentPlan({ status: 'subscribed', plan: '' }),
    ).toBeNull();
  });
});
