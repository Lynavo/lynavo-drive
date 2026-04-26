import React from 'react';
import { NativeModules } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
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
  // Hook imports `buildBootstrapPlans` and `buildBootstrapProducts` to seed
  // initial render. Empty seeds are fine here because all assertions wait
  // for `loading: false` before checking — by then `fetchPlans` mock has
  // populated `plans` directly and `iapService.getProductSummaries` mock
  // has populated `products` directly.
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
import { subscriptionPlansService } from '../../services/subscription-plans-service';
import { IAP_PRODUCTS } from '../../constants/iap';

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
  name: '月度方案',
  description: '按月訂閱',
  sort_order: 10,
});

const yearlyPlan: SubscriptionPlanDto = makePlan({
  id: 2,
  product_id: IAP_PRODUCTS.yearly,
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
    // Default catalog — both plans, both products. Individual tests override.
    mockCatalog([monthlyPlan, yearlyPlan], [monthlyProduct, yearlyProduct]);
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

  test('shows STOREKIT_EMPTY error banner when no plans are renderable', async () => {
    // Arrange: server catalog has rows but Apple returned nothing — the
    // screen filters those out and lands on the empty-paywall error path.
    mockCatalog([monthlyPlan, yearlyPlan], []);

    // Act
    const { findByText } = renderScreen();

    // Assert: error banner copy + retry affordance render so the user can
    // recover instead of staring at a blank paywall.
    expect(
      await findByText(/暂时无法获取方案信息|暫時無法獲取|temporarily unable/i),
    ).toBeTruthy();
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
