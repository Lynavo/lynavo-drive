import React from 'react';
import { Alert, Clipboard, NativeModules } from 'react-native';
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
import { SubscriptionScreen, resolveCurrentPlan } from '../SubscriptionScreen';
import { iapService, type IapProductSummary } from '../../services/iap-service';
import {
  buildBootstrapPlans,
  buildBootstrapProducts,
  subscriptionPlansService,
} from '../../services/subscription-plans-service';
import { IAP_PRODUCTS } from '../../constants/iap';
import { verifyIapReceipt } from '../../services/subscription-service';
import { ApiError, ERROR_CODE } from '../../services/api';

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

function mockFixedBootstrapSkuFallback(): void {
  (buildBootstrapPlans as jest.Mock).mockReturnValue([
    monthlyPlan,
    yearlyPromoPlan,
  ]);
  (buildBootstrapProducts as jest.Mock).mockReturnValue([
    {
      ...monthlyProduct,
      displayPrice: '¥9.99',
      priceAmount: 9.99,
    },
    yearlyPromoProduct,
  ]);
}

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

async function advanceTimers(ms: number): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(ms);
    await Promise.resolve();
  });
}

describe('SubscriptionScreen', () => {
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
    (buildBootstrapPlans as jest.Mock).mockReturnValue([]);
    (buildBootstrapProducts as jest.Mock).mockReturnValue([]);
    // Default catalog — both plans, both products. Individual tests override.
    mockCatalog([monthlyPlan, yearlyPlan], [monthlyProduct, yearlyProduct]);
  });

  afterEach(() => {
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

  test('renders a single card when the server returns one plan', async () => {
    // Arrange
    mockCatalog([yearlyPlan], [yearlyProduct]);

    // Act
    const { findByText, queryByText } = renderScreen();

    // Assert: only the yearly card is visible.
    expect(await findByText('年度方案')).toBeTruthy();
    expect(queryByText('月度方案')).toBeNull();
  });

  test('renders fixed fallback SKU cards when StoreKit returns no products', async () => {
    // Arrange: server catalog has rows but Apple returned nothing. The screen
    // should switch to the fixed fallback SKU pair instead of showing the
    // unavailable banner.
    mockCatalog([monthlyPlan, yearlyPlan], []);
    mockFixedBootstrapSkuFallback();

    // Act
    const { findByText, queryByText } = renderScreen();

    // Assert
    expect(await findByText('月度方案')).toBeTruthy();
    expect(await findByText('限时年费')).toBeTruthy();
    expect(await findByText('¥9.99')).toBeTruthy();
    expect(await findByText('¥99.00')).toBeTruthy();
    expect(
      queryByText(/暂时无法获取方案信息|暫時無法獲取|temporarily unavailable/i),
    ).toBeNull();
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
