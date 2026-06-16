jest.mock('../../markets', () => ({
  activeMarket: 'cn',
  isGlobalMarket: () => false,
  isChinaMarket: () => true,
  marketConfig: {
    market: 'cn',
  },
}));

import React from 'react';
import {
  Alert,
  Clipboard,
  NativeModules,
  Platform,
  Linking,
} from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import type {
  SubscriptionPlanDto,
  SubscriptionPlanPlatform,
} from '@syncflow/contracts';

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

const mockNavigation = {
  goBack: jest.fn(),
  canGoBack: jest.fn(),
  reset: jest.fn(),
};

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useFocusEffect: (callback: () => void | (() => void)) => {
    const ReactInner = require('react');
    ReactInner.useEffect(callback, [callback]);
  },
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
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
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
    refreshReceipt: jest.fn().mockResolvedValue(null),
    checkEligibility: jest.fn().mockResolvedValue([]),
    getProductSummaries: jest.fn(),
    onOrphanPurchaseVerified: jest.fn(() => jest.fn()),
  },
}));

jest.mock('../../services/subscription-plans-service', () => ({
  subscriptionPlansService: {
    fetchPlans: jest.fn(),
  },
  resolveSubscriptionPlanTier: (plan: { plan?: string; tier?: string }) => {
    if (plan.plan === 'monthly' || plan.plan === 'yearly') return plan.plan;
    if (plan.tier === 'monthly' || plan.tier === 'yearly') return plan.tier;
    return null;
  },
  buildBootstrapPlans: jest.fn(() => []),
  buildBootstrapProducts: jest.fn(() => []),
  buildFixedProductSummary: jest.fn((productId: string, plan: string) => ({
    productId,
    displayPrice: plan === 'monthly' ? '¥9.90' : '¥99.00',
    priceAmount: plan === 'monthly' ? 9.9 : 99,
    currency: 'CNY',
    periodUnit: plan === 'monthly' ? 'MONTH' : 'YEAR',
    periodCount: 1,
    eligibleForIntroOffer: false,
  })),
}));

jest.mock('../../services/subscription-service', () => ({
  verifyIapReceipt: jest.fn().mockResolvedValue(undefined),
  getSubscriptionStatus: jest.fn().mockResolvedValue({
    status: 'trial_expired',
    plan: '',
    expireAt: null,
    trialEnd: null,
  }),
}));

jest.mock('../../services/mainland-payment-service', () => ({
  mainlandPaymentService: {
    purchase: jest.fn(),
  },
}));

jest.mock('../../services/gift-card-service', () => ({
  getGiftCardConfig: jest.fn().mockResolvedValue({ enabled: false }),
  redeemGiftCard: jest.fn().mockResolvedValue({
    code: 'VIVI-ABCD-EFGH-IJKL',
    giftCardId: 1001,
    plan: 'monthly',
    durationDays: 30,
    redeemedAt: '2026-05-12T00:00:00.000Z',
  }),
}));

const mockDiagnosticUpload = jest.fn();
jest.mock('../../services/diagnostic-upload-service', () => {
  class DiagnosticUploadError extends Error {
    readonly detail: { kind: string };

    constructor(detail: { kind: string }) {
      super(detail.kind);
      this.detail = detail;
      this.name = 'DiagnosticUploadError';
    }
  }

  return {
    DiagnosticUploadError,
    diagnosticUploadService: {
      upload: (...args: unknown[]) => mockDiagnosticUpload(...args),
    },
  };
});

jest.mock('../../constants/features', () => ({
  FEATURES: {
    IAP_ENABLED: true,
    IAP_RESTORE_ENABLED: true,
    SUBSCRIPTION_ENFORCEMENT: false,
  },
}));

const mockLoadSubscription = jest.fn().mockResolvedValue(null);
const mockSetSubscription = jest.fn();
const mockAuthState: {
  user: { id: number; status: string };
  subscription: {
    status: string;
    plan: string;
    expireAt: string | null;
    trialEnd: string | null;
    autoRenewing?: boolean | null;
    source?: string | null;
  } | null;
} = {
  user: { id: 1, status: 'trial_expired' },
  subscription: null,
};

jest.mock('../../stores/auth-store', () => ({
  useAuth: () => ({
    user: mockAuthState.user,
    subscription: mockAuthState.subscription,
    loadSubscription: mockLoadSubscription,
    setSubscription: mockSetSubscription,
  }),
  // Mirror the real predicate so the post-verify guard test exercises the
  // same logic as production.
  isFeatureAccessAllowed: (status: string | undefined | null) =>
    status === 'trialing' || status === 'subscribed',
}));

import i18n from '../../i18n';
import {
  SubscriptionScreen,
  resolveCurrentPlan,
  resolveMainlandPaymentAlertKey,
} from '../SubscriptionScreen';
import { iapService, type IapProductSummary } from '../../services/iap-service';
import {
  buildBootstrapPlans,
  buildBootstrapProducts,
  subscriptionPlansService,
} from '../../services/subscription-plans-service';
import { IAP_PRODUCTS } from '../../constants/iap';
import {
  getSubscriptionStatus,
  verifyIapReceipt,
} from '../../services/subscription-service';
import { ApiError, ERROR_CODE } from '../../services/api';
import { mainlandPaymentService } from '../../services/mainland-payment-service';
import { USER_AGREEMENT_URL, PRIVACY_POLICY_URL } from '../../constants/legal';
import {
  getGiftCardConfig,
  redeemGiftCard,
} from '../../services/gift-card-service';

// ---------------------------------------------------------------------------
// Fixture builders — CN storefront data, mirrors what the server + StoreKit
// return in production. Centralising here keeps each test focused on the
// behaviour under inspection rather than re-spelling the catalog.
// ---------------------------------------------------------------------------

function makePlan(
  overrides: Partial<SubscriptionPlanDto> &
    Pick<SubscriptionPlanDto, 'id' | 'product_id'>,
): SubscriptionPlanDto {
  const platform: SubscriptionPlanPlatform = 'ios';
  return {
    name: 'Plan',
    plan: 'monthly',
    description: '',
    badges: [],
    recommended: false,
    sort_order: 10,
    active: true,
    platform,
    created_at: '2026-04-24T00:00:00Z',
    updated_at: '2026-04-24T00:00:00Z',
    ...overrides,
  };
}

const monthlyPlan: SubscriptionPlanDto = makePlan({
  id: 1,
  product_id: IAP_PRODUCTS.monthly,
  plan: 'monthly',
  name: '月度方案',
  description: '按月訂閱',
  sort_order: 10,
});

const yearlyPlan: SubscriptionPlanDto = makePlan({
  id: 2,
  product_id: IAP_PRODUCTS.yearly,
  plan: 'yearly',
  name: '年度方案',
  description: '一年無限同步',
  badges: ['8.8 折'],
  recommended: true,
  sort_order: 20,
});

const monthlyProduct: IapProductSummary = {
  productId: IAP_PRODUCTS.monthly,
  displayPrice: '¥9.90',
  priceAmount: 9.9,
  currency: 'CNY',
  periodUnit: 'MONTH',
  periodCount: 1,
  eligibleForIntroOffer: false,
};

const yearlyProduct: IapProductSummary = {
  productId: IAP_PRODUCTS.yearly,
  displayPrice: '¥104.00',
  priceAmount: 104,
  currency: 'CNY',
  periodUnit: 'YEAR',
  periodCount: 1,
  eligibleForIntroOffer: false,
};

const adminMonthlySku = 'admin.catalog.alpha';
const adminMonthlyPlan: SubscriptionPlanDto = makePlan({
  id: 10,
  product_id: adminMonthlySku,
  plan: 'monthly',
  name: 'Admin 月費',
  description: '後台設定 SKU',
  recommended: true,
  sort_order: 5,
});

const adminMonthlyProduct: IapProductSummary = {
  productId: adminMonthlySku,
  displayPrice: '¥12.00',
  priceAmount: 12,
  currency: 'CNY',
  periodUnit: 'MONTH',
  periodCount: 1,
  eligibleForIntroOffer: false,
};

const yearlyPromoPlan: SubscriptionPlanDto = makePlan({
  id: 3,
  product_id: IAP_PRODUCTS.yearlyPromo,
  plan: 'yearly',
  name: '限时年费',
  description: '新用户限时优惠价',
  badges: ['限时优惠'],
  sort_order: 3,
});

const yearlyPromoProduct: IapProductSummary = {
  productId: IAP_PRODUCTS.yearlyPromo,
  displayPrice: '¥99.00',
  priceAmount: 99,
  currency: 'CNY',
  periodUnit: 'YEAR',
  periodCount: 1,
  eligibleForIntroOffer: false,
};

function mockCatalog(
  plans: SubscriptionPlanDto[],
  products: IapProductSummary[],
  source: 'network' | 'cache' | 'bootstrap' = 'network',
): void {
  (subscriptionPlansService.fetchPlans as jest.Mock).mockResolvedValue({
    plans,
    source,
  });
  (iapService.getProductSummaries as jest.Mock).mockResolvedValue(products);
}

function renderScreen() {
  return render(<SubscriptionScreen />);
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function advanceTimers(ms: number): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(ms);
    await Promise.resolve();
  });
}

describe('SubscriptionScreen', () => {
  const originalPlatformOS = Platform.OS;

  beforeAll(async () => {
    await i18n.changeLanguage('zh-Hans');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockNavigation.canGoBack.mockReturnValue(true);
    (NativeModules as Record<string, unknown>).NativeSyncEngine = {
      getBindingState: jest.fn().mockResolvedValue(null),
    };
    mockAuthState.user = { id: 1, status: 'trial_expired' };
    mockAuthState.subscription = null;
    mockLoadSubscription.mockResolvedValue(null);
    mockSetSubscription.mockReset();
    (getSubscriptionStatus as jest.Mock).mockResolvedValue({
      status: 'trial_expired',
      plan: '',
      expireAt: null,
      trialEnd: null,
    });
    (getGiftCardConfig as jest.Mock).mockResolvedValue({ enabled: false });
    (redeemGiftCard as jest.Mock).mockResolvedValue({
      code: 'VIVI-ABCD-EFGH-IJKL',
      giftCardId: 1001,
      plan: 'monthly',
      durationDays: 30,
      redeemedAt: '2026-05-12T00:00:00.000Z',
    });
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'ios',
    });
    (buildBootstrapPlans as jest.Mock).mockReturnValue([]);
    (buildBootstrapProducts as jest.Mock).mockReturnValue([]);
    // Default catalog — both plans, both products. Individual tests override.
    mockCatalog([monthlyPlan, yearlyPlan], [monthlyProduct, yearlyProduct]);
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: originalPlatformOS,
    });
    jest.restoreAllMocks();
  });

  test('renders one card per server plan with server-provided names', async () => {
    // Arrange: 2-plan catalog set in beforeEach.

    // Act
    const { findByText } = renderScreen();

    // Assert: name copy comes from `plan.name`, not from i18n. This is the
    // load-bearing assertion that the screen reads the server catalog rather
    // than the legacy hardcoded i18n strings.
    expect(await findByText('月度方案')).toBeTruthy();
    expect(await findByText('年度方案')).toBeTruthy();
    expect(await findByText('¥9.90')).toBeTruthy();
    expect(await findByText('¥104.00')).toBeTruthy();
  }, 15000); // First test pays Jest cold-start cost (i18n + RN module bridge hydration); subsequent tests run in <250ms.

  test('auto-selects the recommended plan once the catalog resolves', async () => {
    // Arrange: yearlyPlan.recommended === true.

    // Act
    const { findByText } = renderScreen();
    // Wait for catalog hydration before triggering the purchase.
    await findByText('年度方案');
    fireEvent.press(await findByText(/立即订阅|立即訂閱|Subscribe Now/));

    // Assert: purchase fires against the recommended SKU without any prior tap.
    await waitFor(() =>
      expect(iapService.purchase).toHaveBeenCalledWith(IAP_PRODUCTS.yearly),
    );
  });

  test('keeps the subscribe CTA inert while the Android catalog is still loading', async () => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'android',
    });
    (buildBootstrapPlans as jest.Mock).mockReturnValue([
      monthlyPlan,
      yearlyPromoPlan,
    ]);
    (buildBootstrapProducts as jest.Mock).mockReturnValue([
      monthlyProduct,
      yearlyPromoProduct,
    ]);

    const deferred = createDeferred<{
      plans: SubscriptionPlanDto[];
      source: 'network';
    }>();
    (subscriptionPlansService.fetchPlans as jest.Mock).mockReturnValueOnce(
      deferred.promise,
    );

    const { findByText, queryByText } = renderScreen();
    const subscribeButton = await findByText(/立即订阅|立即訂閱|Subscribe Now/);

    fireEvent.press(subscribeButton);
    await act(async () => {
      await Promise.resolve();
    });

    expect(mainlandPaymentService.purchase).not.toHaveBeenCalled();
    expect(
      queryByText(/选择支付方式|選擇支付方式|Choose payment method/),
    ).toBeNull();

    deferred.resolve({
      plans: [monthlyPlan, yearlyPlan],
      source: 'network',
    });
    await waitFor(() =>
      expect(subscriptionPlansService.fetchPlans).toHaveBeenCalledWith(
        'android',
      ),
    );
  });

  test('renders a single card when the server returns one plan', async () => {
    // Arrange
    mockCatalog([yearlyPlan], [yearlyProduct]);

    // Act
    const { findByText, queryByText } = renderScreen();

    // Assert: only the yearly card is visible.
    expect(await findByText('年度方案')).toBeTruthy();
    expect(queryByText('月度方案')).toBeNull();
  });

  test('shows retry state when StoreKit returns no products', async () => {
    // Arrange: server catalog has rows but Apple returned nothing. The screen
    // must not switch to a fixed fallback SKU pair, otherwise admin-disabled
    // products can reappear on the paywall.
    mockCatalog([monthlyPlan, yearlyPlan], []);

    // Act
    const { findByText, queryByText } = renderScreen();

    // Assert
    expect(
      await findByText(
        /暂时无法获取方案信息|暫時無法獲取|temporarily unavailable/i,
      ),
    ).toBeTruthy();
    expect(queryByText('月度方案')).toBeNull();
    expect(queryByText('年度方案')).toBeNull();
    expect(queryByText('限时年费')).toBeNull();
    expect(queryByText('¥9.90')).toBeNull();
    expect(queryByText('¥99.00')).toBeNull();
  });

  test('shows offline-mode footer note when source is bootstrap', async () => {
    // Arrange
    mockCatalog(
      [monthlyPlan, yearlyPlan],
      [monthlyProduct, yearlyProduct],
      'bootstrap',
    );

    // Act
    const { findByText } = renderScreen();

    // Assert: the small grey footer line announces degraded mode.
    expect(await findByText(/离线模式|離線模式|Offline mode/i)).toBeTruthy();
  });

  test('renders EULA and privacy policy links when Platform is iOS', async () => {
    // Arrange
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'ios',
    });
    const openURLSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);

    // Act
    const { findByText } = renderScreen();

    // Assert: EULA and Privacy Policy links are present
    const eulaLink = await findByText(
      /服务协议|服務協議|用户协议|用戶協議|Terms of Service|User Agreement/i,
    );
    const privacyLink = await findByText(/隐私政策|隱私政策|Privacy Policy/i);
    expect(eulaLink).toBeTruthy();
    expect(privacyLink).toBeTruthy();

    // Act: Tap EULA link
    fireEvent.press(eulaLink);
    expect(openURLSpy).toHaveBeenCalledWith(
      'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/',
    );

    // Act: Tap Privacy link
    fireEvent.press(privacyLink);
    expect(openURLSpy).toHaveBeenCalledWith(PRIVACY_POLICY_URL);

    openURLSpy.mockRestore();
  });

  test('does not render EULA and privacy policy links when Platform is Android', async () => {
    // Arrange
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'android',
    });

    // Act
    const { queryByText } = renderScreen();

    // Assert: EULA and Privacy Policy links should not be present
    expect(
      queryByText(
        /服务协议|服務協議|用户协议|用戶協議|Terms of Service|User Agreement/i,
      ),
    ).toBeNull();
    expect(queryByText(/隐私政策|隱私政策|Privacy Policy/i)).toBeNull();
  });

  test('subscribe CTA invokes iapService.purchase with the selected product_id', async () => {
    // Arrange: user explicitly taps the (non-recommended) monthly card.
    const { findByText } = renderScreen();
    fireEvent.press(await findByText('月度方案'));
    fireEvent.press(await findByText(/立即订阅|立即訂閱|Subscribe Now/));

    // Assert: purchase wired to the product_id the user selected.
    await waitFor(() =>
      expect(iapService.purchase).toHaveBeenCalledWith(IAP_PRODUCTS.monthly),
    );
  });

  test('gift card member CTA is disabled and does not start purchase', async () => {
    mockAuthState.subscription = {
      status: 'subscribed',
      plan: 'monthly',
      expireAt: '2026-06-11T00:00:00.000Z',
      trialEnd: null,
      autoRenewing: false,
      source: 'gift_card',
    };

    const { findAllByText, queryByText } = renderScreen();

    const giftCardLabels = await findAllByText(
      /已是礼品卡会员|已是禮品卡會員|Gift card member/,
    );
    expect(queryByText(/已取消/)).toBeNull();

    fireEvent.press(giftCardLabels[giftCardLabels.length - 1]);

    expect(iapService.purchase).not.toHaveBeenCalled();
  });

  test('expired gift card subscription does not block a new App Store purchase', async () => {
    (getSubscriptionStatus as jest.Mock).mockResolvedValue({
      status: 'sub_expired',
      plan: 'monthly',
      expireAt: '2026-03-18T00:00:00.000Z',
      trialEnd: null,
      source: 'gift_card',
      paymentProvider: 'gift_card',
      renewalState: 'prepaid',
    });

    const { findByText } = renderScreen();
    await findByText('年度方案');

    fireEvent.press(await findByText(/立即订阅|立即訂閱|Subscribe Now/));

    await waitFor(() =>
      expect(iapService.purchase).toHaveBeenCalledWith(IAP_PRODUCTS.yearly),
    );
  });

  test('queued gift card entitlement blocks a new App Store purchase', async () => {
    (getSubscriptionStatus as jest.Mock).mockResolvedValue({
      status: 'subscribed',
      plan: 'monthly',
      expireAt: '2026-05-18T00:00:00.000Z',
      trialEnd: null,
      autoRenewing: true,
      source: 'apple_iap',
      paymentProvider: 'apple',
      renewalState: 'auto_renewing',
      entitlementExpireAt: '2026-06-17T00:00:00.000Z',
      entitlementSource: 'gift_card',
    });

    const { findByText } = renderScreen();
    await findByText('月度方案');

    fireEvent.press(await findByText(/立即订阅|立即訂閱|Subscribe Now/));

    await waitFor(() => expect(getSubscriptionStatus).toHaveBeenCalledTimes(2));
    expect(iapService.purchase).not.toHaveBeenCalled();
  });

  test('redeems a gift card from Subscription when the server switch is on', async () => {
    (getGiftCardConfig as jest.Mock).mockResolvedValue({ enabled: true });
    mockLoadSubscription.mockResolvedValueOnce({
      status: 'subscribed',
      plan: 'monthly',
      expireAt: '2026-06-11T00:00:00.000Z',
      trialEnd: null,
      autoRenewing: null,
      source: 'gift_card',
      paymentProvider: 'gift_card',
      renewalState: 'prepaid',
    });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const { findByText, findByPlaceholderText, getByText } = renderScreen();

    fireEvent.press(await findByText(/礼品卡兑换|禮品卡兌換|Redeem Gift Card/));
    fireEvent.changeText(
      await findByPlaceholderText(
        /输入礼品卡代码|輸入禮品卡代碼|Enter gift card code/,
      ),
      'vivi-abcd-efgh-ijkl',
    );
    fireEvent.press(getByText(/^兑换$|^兌換$|^Redeem$/));

    await waitFor(() => {
      expect(redeemGiftCard).toHaveBeenCalledWith('VIVI-ABCD-EFGH-IJKL');
    });
    expect(mockLoadSubscription).toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      '兑换成功',
      expect.stringContaining('月订阅'),
      [
        expect.objectContaining({
          text: '好',
          onPress: expect.any(Function),
        }),
      ],
    );
    const buttons = alertSpy.mock.calls.at(-1)?.[2];
    buttons?.[0]?.onPress?.();
    expect(mockNavigation.goBack).toHaveBeenCalledTimes(1);
    alertSpy.mockRestore();
  });

  test('does not manually reset navigation after root paywall gift card redemption', async () => {
    mockNavigation.canGoBack.mockReturnValue(false);
    (getGiftCardConfig as jest.Mock).mockResolvedValue({ enabled: true });
    mockLoadSubscription.mockResolvedValueOnce({
      status: 'subscribed',
      plan: 'monthly',
      expireAt: '2026-06-11T00:00:00.000Z',
      trialEnd: null,
      autoRenewing: null,
      source: 'gift_card',
      paymentProvider: 'gift_card',
      renewalState: 'prepaid',
    });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const { findByText, findByPlaceholderText, getByText } = renderScreen();

    fireEvent.press(await findByText(/礼品卡兑换|禮品卡兌換|Redeem Gift Card/));
    fireEvent.changeText(
      await findByPlaceholderText(
        /输入礼品卡代码|輸入禮品卡代碼|Enter gift card code/,
      ),
      'vivi-abcd-efgh-ijkl',
    );
    fireEvent.press(getByText(/^兑换$|^兌換$|^Redeem$/));

    await waitFor(() => {
      expect(redeemGiftCard).toHaveBeenCalledWith('VIVI-ABCD-EFGH-IJKL');
    });
    expect(alertSpy).toHaveBeenCalledWith(
      '兑换成功',
      expect.stringContaining('月订阅'),
      undefined,
    );
    expect(mockNavigation.goBack).not.toHaveBeenCalled();
    expect(mockNavigation.reset).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  test('refreshes gift card switch before opening Subscription redemption prompt', async () => {
    (getGiftCardConfig as jest.Mock)
      .mockResolvedValueOnce({ enabled: true })
      .mockResolvedValueOnce({ enabled: false });

    const { findByText, queryByPlaceholderText } = renderScreen();

    fireEvent.press(await findByText(/礼品卡兑换|禮品卡兌換|Redeem Gift Card/));

    await waitFor(() => {
      expect(
        (getGiftCardConfig as jest.Mock).mock.calls.length,
      ).toBeGreaterThanOrEqual(2);
    });
    expect(
      queryByPlaceholderText(
        /输入礼品卡代码|輸入禮品卡代碼|Enter gift card code/,
      ),
    ).toBeNull();
  });

  test('Android China subscribe flow selects a wallet before payment', async () => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'android',
    });
    (mainlandPaymentService.purchase as jest.Mock).mockResolvedValueOnce({
      status: 'subscribed',
      plan: 'yearly',
      expireAt: '2027-04-28T00:00:00Z',
      trialEnd: null,
      autoRenewing: null,
    });

    const { findByText, queryByText } = renderScreen();
    await findByText('年度方案');

    fireEvent.press(await findByText(/立即订阅|立即訂閱|Subscribe Now/));

    expect(
      await findByText(/选择支付方式|選擇支付方式|Choose payment method/),
    ).toBeTruthy();
    expect(await findByText(/微信支付|WeChat Pay/)).toBeTruthy();
    expect(await findByText(/支付宝|支付寶|Alipay/)).toBeTruthy();
    expect(iapService.purchase).not.toHaveBeenCalled();

    fireEvent.press(await findByText(/支付宝|支付寶|Alipay/));

    expect(mainlandPaymentService.purchase).not.toHaveBeenCalled();

    fireEvent.press(await findByText(/确认支付|確認支付|Pay ¥99.00/));

    await waitFor(() =>
      expect(mainlandPaymentService.purchase).toHaveBeenCalledWith({
        method: 'alipay',
        productId: IAP_PRODUCTS.yearly,
        plan: 'yearly',
      }),
    );
    await waitFor(() =>
      expect(mockSetSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'subscribed',
          plan: 'yearly',
        }),
      ),
    );
    expect(
      queryByText(/选择支付方式|選擇支付方式|Choose payment method/),
    ).toBeNull();
  });

  test('renders and purchases an admin catalog SKU without monthly/yearly in the product id', async () => {
    mockCatalog([adminMonthlyPlan], [adminMonthlyProduct]);
    (iapService.purchase as jest.Mock).mockResolvedValueOnce({
      productId: adminMonthlySku,
      transactionReceipt: 'ADMIN_RECEIPT',
      transactionId: 'tx_admin',
    });
    mockLoadSubscription.mockResolvedValueOnce({
      status: 'subscribed',
      plan: 'monthly',
      expireAt: '2026-04-28T00:00:00Z',
      trialEnd: null,
    });

    const { findByText } = renderScreen();
    expect(await findByText('Admin 月費')).toBeTruthy();
    expect(await findByText('¥12.00')).toBeTruthy();

    fireEvent.press(await findByText(/立即订阅|立即訂閱|Subscribe Now/));

    await waitFor(() =>
      expect(iapService.purchase).toHaveBeenCalledWith(adminMonthlySku),
    );
    await waitFor(() =>
      expect(verifyIapReceipt).toHaveBeenCalledWith(
        'ADMIN_RECEIPT',
        'monthly',
        adminMonthlySku,
        'tx_admin',
      ),
    );
  });

  test('refreshes receipt before surfacing mismatch when StoreKit returns the previous SKU', async () => {
    // Arrange: user selects yearly, but StoreKit resolves the purchase event
    // with the previous monthly SKU. This happens in sandbox during
    // subscription-group switches even when the user tapped the yearly card.
    jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    (iapService.purchase as jest.Mock).mockResolvedValueOnce({
      productId: IAP_PRODUCTS.monthly,
      transactionReceipt: 'OLD_MONTHLY_RECEIPT',
      transactionId: 'tx_1',
    });
    (iapService.refreshReceipt as jest.Mock).mockResolvedValueOnce(
      'FRESH_YEARLY_RECEIPT',
    );
    (verifyIapReceipt as jest.Mock)
      .mockRejectedValueOnce(
        new ApiError(ERROR_CODE.PRODUCT_ID_MISMATCH, 'mismatch'),
      )
      .mockResolvedValueOnce(undefined);
    mockLoadSubscription.mockResolvedValueOnce({
      status: 'subscribed',
      plan: 'yearly',
      expireAt: '2026-04-28T00:00:00Z',
      trialEnd: null,
    });

    // Act
    const { findByText } = renderScreen();
    await findByText('年度方案');
    fireEvent.press(await findByText(/立即订阅|立即訂閱|Subscribe Now/));

    // Assert: first verify uses the stale receipt, then we refresh and retry
    // with the fresh app receipt instead of showing PRODUCT_ID_MISMATCH.
    await waitFor(() =>
      expect(iapService.purchase).toHaveBeenCalledWith(IAP_PRODUCTS.yearly),
    );
    await waitFor(
      () => expect(iapService.refreshReceipt).toHaveBeenCalledTimes(1),
      { timeout: 3000 },
    );
    await waitFor(
      () => expect(iapService.finishTransaction).toHaveBeenCalledWith('tx_1'),
      { timeout: 5000 },
    );
    expect(verifyIapReceipt).toHaveBeenNthCalledWith(
      1,
      'OLD_MONTHLY_RECEIPT',
      'yearly',
      IAP_PRODUCTS.yearly,
      'tx_1',
    );
    expect(verifyIapReceipt).toHaveBeenNthCalledWith(
      2,
      'FRESH_YEARLY_RECEIPT',
      'yearly',
      IAP_PRODUCTS.yearly,
      'tx_1',
    );
    expect(Alert.alert).not.toHaveBeenCalledWith(
      expect.stringMatching(
        /产品设置有误|產品設定有誤|Product configuration error/,
      ),
    );
  });

  test('does not finish transaction when product mismatch still looks like a stale StoreKit receipt', async () => {
    jest.useFakeTimers();
    try {
      // Arrange: StoreKit returns the old monthly SKU after the user selected
      // yearly. Even after one app-receipt refresh, backend still sees 2003.
      // This should remain retryable/redeliverable instead of finishing the
      // paid transaction and losing Apple's chance to redeliver it.
      jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
      (iapService.purchase as jest.Mock).mockResolvedValueOnce({
        productId: IAP_PRODUCTS.monthly,
        transactionReceipt: 'OLD_MONTHLY_RECEIPT',
        transactionId: 'tx_1',
      });
      (iapService.refreshReceipt as jest.Mock).mockResolvedValueOnce(
        'FRESH_APP_RECEIPT',
      );
      (verifyIapReceipt as jest.Mock)
        .mockRejectedValueOnce(
          new ApiError(ERROR_CODE.PRODUCT_ID_MISMATCH, 'mismatch'),
        )
        .mockRejectedValueOnce(
          new ApiError(ERROR_CODE.PRODUCT_ID_MISMATCH, 'mismatch'),
        );
      mockLoadSubscription.mockResolvedValue({
        status: 'sub_expired',
        plan: 'monthly',
        expireAt: null,
        trialEnd: null,
      });

      // Act
      const { findByText } = renderScreen();
      await findByText('年度方案');
      fireEvent.press(await findByText(/立即订阅|立即訂閱|Subscribe Now/));

      // Assert: refresh once, wait through the status-poll window, surface
      // "still verifying", and leave the transaction unfinished so StoreKit can
      // redeliver / user can retry.
      await waitFor(
        () => expect(iapService.refreshReceipt).toHaveBeenCalledTimes(1),
        { timeout: 3000 },
      );
      await advanceTimers(1_000);
      await waitFor(() => expect(verifyIapReceipt).toHaveBeenCalledTimes(2));
      await advanceTimers(70_000);
      await waitFor(() =>
        expect(Alert.alert).toHaveBeenCalledWith('正在验证付款...'),
      );
      expect(iapService.finishTransaction).not.toHaveBeenCalled();
      expect(Alert.alert).not.toHaveBeenCalledWith(
        expect.stringMatching(
          /产品设置有误|產品設定有誤|Product configuration error/,
        ),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  test('recovers stale product mismatch when webhook updates the selected plan during polling', async () => {
    jest.useFakeTimers();
    try {
      jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
      (iapService.purchase as jest.Mock).mockResolvedValueOnce({
        productId: IAP_PRODUCTS.monthly,
        transactionReceipt: 'OLD_MONTHLY_RECEIPT',
        transactionId: 'tx_mismatch_webhook_lag',
      });
      (iapService.refreshReceipt as jest.Mock).mockResolvedValueOnce(
        'FRESH_APP_RECEIPT',
      );
      (verifyIapReceipt as jest.Mock)
        .mockRejectedValueOnce(
          new ApiError(ERROR_CODE.PRODUCT_ID_MISMATCH, 'mismatch'),
        )
        .mockRejectedValueOnce(
          new ApiError(ERROR_CODE.PRODUCT_ID_MISMATCH, 'mismatch'),
        );
      let loadCalls = 0;
      mockLoadSubscription.mockImplementation(async () => {
        loadCalls += 1;
        if (loadCalls < 2) {
          return {
            status: 'subscribed',
            plan: 'monthly',
            expireAt: '2026-04-27T11:26:41Z',
            trialEnd: null,
          };
        }
        return {
          status: 'subscribed',
          plan: 'yearly',
          expireAt: '2026-04-27T12:02:41Z',
          trialEnd: null,
        };
      });

      const { findByText } = renderScreen();
      await findByText('年度方案');
      fireEvent.press(await findByText(/立即订阅|立即訂閱|Subscribe Now/));

      await waitFor(
        () => expect(iapService.refreshReceipt).toHaveBeenCalledTimes(1),
        { timeout: 3000 },
      );
      await advanceTimers(1_000);
      await waitFor(() => expect(verifyIapReceipt).toHaveBeenCalledTimes(2));
      await advanceTimers(70_000);

      await waitFor(() =>
        expect(iapService.finishTransaction).toHaveBeenCalledWith(
          'tx_mismatch_webhook_lag',
        ),
      );
      expect(Alert.alert).not.toHaveBeenCalledWith('正在验证付款...');
      expect(Alert.alert).not.toHaveBeenCalledWith(
        expect.stringMatching(
          /产品设置有误|產品設定有誤|Product configuration error/,
        ),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  test('refreshes receipt once after IAP verify failure before exhausting retries', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    (iapService.purchase as jest.Mock).mockResolvedValueOnce({
      productId: IAP_PRODUCTS.yearly,
      transactionReceipt: 'STALE_APP_RECEIPT',
      transactionId: 'tx_verify_retry',
    });
    (iapService.refreshReceipt as jest.Mock).mockResolvedValueOnce(
      'FRESH_APP_RECEIPT',
    );
    (verifyIapReceipt as jest.Mock)
      .mockRejectedValueOnce(
        new ApiError(ERROR_CODE.IAP_VERIFY_FAILED, 'verify failed'),
      )
      .mockResolvedValueOnce(undefined);
    mockLoadSubscription.mockResolvedValueOnce({
      status: 'subscribed',
      plan: 'yearly',
      expireAt: '2026-04-28T00:00:00Z',
      trialEnd: null,
    });

    const { findByText } = renderScreen();
    await findByText('年度方案');
    fireEvent.press(await findByText(/立即订阅|立即訂閱|Subscribe Now/));

    await waitFor(
      () => expect(iapService.refreshReceipt).toHaveBeenCalledTimes(1),
      { timeout: 3000 },
    );
    await waitFor(
      () =>
        expect(iapService.finishTransaction).toHaveBeenCalledWith(
          'tx_verify_retry',
        ),
      { timeout: 5000 },
    );
    expect(verifyIapReceipt).toHaveBeenNthCalledWith(
      1,
      'STALE_APP_RECEIPT',
      'yearly',
      IAP_PRODUCTS.yearly,
      'tx_verify_retry',
    );
    expect(verifyIapReceipt).toHaveBeenNthCalledWith(
      2,
      'FRESH_APP_RECEIPT',
      'yearly',
      IAP_PRODUCTS.yearly,
      'tx_verify_retry',
    );
    expect(Alert.alert).not.toHaveBeenCalledWith('验证失败，请稍后重试');
  });

  test('polls subscription status after retryable verify exhaustion before showing failure', async () => {
    jest.useFakeTimers();
    try {
      jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
      (iapService.purchase as jest.Mock).mockResolvedValueOnce({
        productId: IAP_PRODUCTS.yearly,
        transactionReceipt: 'STALE_APP_RECEIPT',
        transactionId: 'tx_webhook_lag',
      });
      (iapService.refreshReceipt as jest.Mock).mockResolvedValue(null);
      (verifyIapReceipt as jest.Mock).mockRejectedValue(
        new ApiError(ERROR_CODE.IAP_VERIFY_FAILED, 'verify failed'),
      );
      let loadCalls = 0;
      mockLoadSubscription.mockImplementation(async () => {
        loadCalls += 1;
        if (loadCalls < 2) {
          return {
            status: 'sub_expired',
            plan: 'monthly',
            expireAt: null,
            trialEnd: null,
          };
        }
        return {
          status: 'subscribed',
          plan: 'yearly',
          expireAt: '2026-04-28T00:00:00Z',
          trialEnd: null,
        };
      });

      const { findByText } = renderScreen();
      await findByText('年度方案');
      fireEvent.press(await findByText(/立即订阅|立即訂閱|Subscribe Now/));

      await waitFor(() => expect(verifyIapReceipt).toHaveBeenCalledTimes(1));
      await advanceTimers(1_000);
      await waitFor(() => expect(verifyIapReceipt).toHaveBeenCalledTimes(2));
      await advanceTimers(4_000);
      await waitFor(() => expect(verifyIapReceipt).toHaveBeenCalledTimes(3));
      await advanceTimers(0);
      await advanceTimers(70_000);
      await advanceTimers(0);

      await waitFor(() =>
        expect(iapService.finishTransaction).toHaveBeenCalledWith(
          'tx_webhook_lag',
        ),
      );
      expect(Alert.alert).not.toHaveBeenCalledWith('验证失败，请稍后重试');
    } finally {
      jest.useRealTimers();
    }
  });

  test('subscribe CTA is disabled when there is no selectable plan', async () => {
    // Arrange: empty catalog → nothing to auto-select → CTA must stay
    // un-tappable so we never fire purchase against an undefined SKU.
    mockCatalog([], []);

    // Act
    const { findByText } = renderScreen();
    fireEvent.press(await findByText(/立即订阅|立即訂閱|Subscribe Now/));

    // Assert: the press is a no-op — handleSubscribe early-returns when
    // selectedEntry is null. iapService.purchase must never see a call.
    expect(iapService.purchase).not.toHaveBeenCalled();
  });

  test('restore button invokes iapService.restore', async () => {
    // Arrange
    (iapService.restore as jest.Mock).mockResolvedValueOnce([]);

    // Act
    const { findByText } = renderScreen();
    fireEvent.press(
      await findByText(/恢復已購買訂閱|恢复已购买订阅|Restore Purchases/),
    );

    // Assert
    await waitFor(() => expect(iapService.restore).toHaveBeenCalled());
  });

  test('header upload logs button uploads diagnostics and copies reference id', async () => {
    // Arrange
    const exportDiagnostics = jest.fn().mockResolvedValue('/tmp/sub-log.zip');
    const getClientId = jest.fn().mockResolvedValue('client-1');
    (NativeModules as Record<string, unknown>).NativeSyncEngine = {
      getBindingState: jest.fn().mockResolvedValue(null),
      exportDiagnostics,
      getClientId,
    };
    mockDiagnosticUpload.mockResolvedValueOnce({
      refId: 'diag-123',
      uploadedAt: '2026-04-27T00:00:00Z',
    });
    jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    jest.spyOn(Clipboard, 'setString').mockImplementation(jest.fn());

    // Act
    const { findByLabelText } = renderScreen();
    fireEvent.press(await findByLabelText(/上传日志|上傳日誌|Upload logs/));

    // Assert
    await waitFor(() => expect(mockDiagnosticUpload).toHaveBeenCalled());
    expect(exportDiagnostics).toHaveBeenCalled();
    expect(getClientId).toHaveBeenCalled();
    expect(mockDiagnosticUpload).toHaveBeenCalledWith(
      'file:///tmp/sub-log.zip',
      'client-1',
      expect.any(AbortSignal),
      undefined,
      'subscription-screen',
    );
    expect(Clipboard.setString).toHaveBeenCalledWith('diag-123');
    expect(Alert.alert).toHaveBeenCalledWith(
      '日志已上传',
      '追踪编号 diag-123 已复制，可提供给客服排查订阅问题。',
    );
  });
});

describe('resolveCurrentPlan', () => {
  test('null subscription → null', () => {
    expect(resolveCurrentPlan(null)).toBeNull();
  });

  test('subscribed monthly → monthly', () => {
    expect(resolveCurrentPlan({ status: 'subscribed', plan: 'monthly' })).toBe(
      'monthly',
    );
  });

  test('trialing monthly (intro offer) → monthly', () => {
    // Trial-period IAP counts as the current Apple-level plan — tapping
    // monthly again during trial would be a no-op.
    expect(resolveCurrentPlan({ status: 'trialing', plan: 'monthly' })).toBe(
      'monthly',
    );
  });

  test('subscribed yearly → yearly', () => {
    expect(resolveCurrentPlan({ status: 'subscribed', plan: 'yearly' })).toBe(
      'yearly',
    );
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
    expect(resolveCurrentPlan({ status: 'subscribed', plan: '' })).toBeNull();
  });
});

describe('resolveMainlandPaymentAlertKey', () => {
  test('maps native unavailable errors to update guidance', () => {
    expect(
      resolveMainlandPaymentAlertKey(
        Object.assign(new Error('WeChat is not installed'), {
          code: 'MAINLAND_PAYMENT_WECHAT_NOT_INSTALLED',
        }),
      ),
    ).toBe('subscription.payment.wechatNotInstalled');
  });

  test('maps server provider-disabled errors to update guidance', () => {
    expect(
      resolveMainlandPaymentAlertKey(
        new ApiError(
          ERROR_CODE.MAINLAND_PAYMENT_PROVIDER_NOT_CONFIGURED,
          'not configured',
        ),
      ),
    ).toBe('subscription.payment.walletUnavailable');
  });

  test('maps user cancellation separately from failed payments', () => {
    expect(
      resolveMainlandPaymentAlertKey(
        Object.assign(new Error('cancelled'), {
          code: 'MAINLAND_PAYMENT_WECHAT_CANCELLED',
        }),
      ),
    ).toBe('subscription.payment.walletCancelled');
  });

  test('maps explicit Alipay cancellation separately from failed payments', () => {
    expect(
      resolveMainlandPaymentAlertKey(
        Object.assign(new Error('user cancelled'), {
          code: 'MAINLAND_PAYMENT_ALIPAY_CANCELLED',
          userInfo: { resultStatus: '6001' },
        }),
      ),
    ).toBe('subscription.payment.walletCancelled');
  });

  test('keeps non-cancelled Alipay failures on the generic failed-payment copy', () => {
    expect(
      resolveMainlandPaymentAlertKey(
        Object.assign(new Error('system error'), {
          code: 'MAINLAND_PAYMENT_ALIPAY_NOT_COMPLETED',
          userInfo: { resultStatus: '4000' },
        }),
      ),
    ).toBe('subscription.payment.walletFailed');
  });

  test('maps pending confirmation timeouts to refresh guidance', () => {
    expect(
      resolveMainlandPaymentAlertKey(
        new Error('MAINLAND_PAYMENT_PENDING_TIMEOUT'),
      ),
    ).toBe('subscription.payment.walletPending');
  });

  test('maps malformed order responses to configuration guidance', () => {
    expect(
      resolveMainlandPaymentAlertKey(
        new Error('MAINLAND_PAYMENT_INVALID_ORDER'),
      ),
    ).toBe('subscription.payment.walletConfigError');
  });

  test('maps server order mismatch errors to configuration guidance', () => {
    expect(
      resolveMainlandPaymentAlertKey(
        new ApiError(ERROR_CODE.MAINLAND_PAYMENT_ORDER_MISMATCH, 'mismatch'),
      ),
    ).toBe('subscription.payment.walletConfigError');
  });

  test('keeps unknown errors on the generic failed-payment copy', () => {
    expect(resolveMainlandPaymentAlertKey(new Error('network failed'))).toBe(
      'subscription.payment.walletFailed',
    );
  });
});
