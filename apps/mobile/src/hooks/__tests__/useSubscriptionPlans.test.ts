import { act, renderHook, waitFor } from '@testing-library/react-native';
import type {
  SubscriptionPlanDto,
  SubscriptionPlanPlatform,
} from '@syncflow/contracts';

jest.mock('../../services/subscription-plans-service', () => ({
  subscriptionPlansService: {
    fetchPlans: jest.fn(),
  },
  buildBootstrapPlans: jest.fn(() => []),
  buildBootstrapProducts: jest.fn(() => []),
}));

jest.mock('../../services/iap-service', () => ({
  iapService: {
    getProductSummaries: jest.fn(),
  },
}));

jest.mock('../../constants/features', () => ({
  FEATURES: {
    IAP_ENABLED: true,
    IAP_RESTORE_ENABLED: true,
    SUBSCRIPTION_ENFORCEMENT: false,
  },
}));

import {
  buildBootstrapPlans,
  buildBootstrapProducts,
  subscriptionPlansService,
} from '../../services/subscription-plans-service';
import { iapService, type IapProductSummary } from '../../services/iap-service';
import { useSubscriptionPlans } from '../useSubscriptionPlans';
import { IAP_PRODUCTS } from '../../constants/iap';

// ---------------------------------------------------------------------------
// Fixtures — CN storefront, mirrors what StoreKit returns in sandbox testing.
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

const yearlyPromoPlan: SubscriptionPlanDto = makePlan({
  id: 3,
  product_id: IAP_PRODUCTS.yearlyPromo,
  plan: 'yearly',
  name: '年度限時',
  description: '限時優惠',
  sort_order: 30,
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

const yearlyPromoProduct: IapProductSummary = {
  productId: IAP_PRODUCTS.yearlyPromo,
  displayPrice: '¥99.00',
  priceAmount: 99,
  currency: 'CNY',
  periodUnit: 'YEAR',
  periodCount: 1,
  eligibleForIntroOffer: false,
};

const adminSku = 'admin.catalog.alpha';
const adminPlan: SubscriptionPlanDto = makePlan({
  id: 10,
  product_id: adminSku,
  name: '後台方案',
  description: '不含週期字樣的 SKU',
  sort_order: 5,
});
const adminProduct: IapProductSummary = {
  productId: adminSku,
  displayPrice: '¥12.00',
  priceAmount: 12,
  currency: 'CNY',
  periodUnit: 'MONTH',
  periodCount: 1,
  eligibleForIntroOffer: false,
};

function mockFixedBootstrapSkuFallback(): void {
  (buildBootstrapPlans as jest.Mock).mockReturnValue([
    monthlyPlan,
    yearlyPromoPlan,
  ]);
  (buildBootstrapProducts as jest.Mock).mockReturnValue([
    monthlyProduct,
    yearlyPromoProduct,
  ]);
}

// Identity formatters keep assertions deterministic without depending on
// Hermes Intl quirks. The hook's only contract with the formatters is that
// `formatSavings(formatPrice(...))` produces a string the screen can render.
const formatPrice = (amount: number, currency: string): string =>
  `${currency} ${amount.toFixed(2)}`;
const formatSavings = (savingsDisplay: string): string =>
  `save ${savingsDisplay}`;

describe('useSubscriptionPlans', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (buildBootstrapPlans as jest.Mock).mockReturnValue([]);
    (buildBootstrapProducts as jest.Mock).mockReturnValue([]);
  });

  test('merges server catalog with StoreKit products and computes yearly savings', async () => {
    // Arrange
    (subscriptionPlansService.fetchPlans as jest.Mock).mockResolvedValueOnce({
      plans: [monthlyPlan, yearlyPlan, yearlyPromoPlan],
      source: 'network',
    });
    (iapService.getProductSummaries as jest.Mock).mockResolvedValueOnce([
      monthlyProduct,
      yearlyProduct,
      yearlyPromoProduct,
    ]);

    // Act
    const { result } = renderHook(() =>
      useSubscriptionPlans({ formatPrice, formatSavings }),
    );

    // Assert
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.plans).toHaveLength(3);

    const [monthlyEntry, yearlyEntry, yearlyPromoEntry] = result.current.plans;
    expect(monthlyEntry?.product?.productId).toBe(IAP_PRODUCTS.monthly);
    expect(monthlyEntry?.savings).toBeNull(); // monthly anchor — no self-savings
    expect(yearlyEntry?.product?.productId).toBe(IAP_PRODUCTS.yearly);
    // Yearly savings vs monthly anchor: 9.9 * 12 = 118.80; saved = 14.80 → ~12%.
    expect(yearlyEntry?.savings).not.toBeNull();
    expect(yearlyEntry?.savings?.percent).toBe(12);
    expect(yearlyEntry?.savings?.display).toContain('save');
    expect(yearlyPromoEntry?.savings).not.toBeNull();
  });

  test('returns null product when StoreKit has no matching SKU', async () => {
    // Arrange: server promised the yearly plan but Apple did not return it.
    (subscriptionPlansService.fetchPlans as jest.Mock).mockResolvedValueOnce({
      plans: [monthlyPlan, yearlyPlan],
      source: 'network',
    });
    (iapService.getProductSummaries as jest.Mock).mockResolvedValueOnce([
      monthlyProduct,
    ]);

    // Act
    const { result } = renderHook(() =>
      useSubscriptionPlans({ formatPrice, formatSavings }),
    );

    // Assert: hook keeps the entry with product=null per agent A's decision —
    // filtering belongs at the screen layer, not here.
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.plans).toHaveLength(2);
    const yearlyEntry = result.current.plans.find(
      e => e.plan.product_id === IAP_PRODUCTS.yearly,
    );
    expect(yearlyEntry).toBeDefined();
    expect(yearlyEntry?.product).toBeNull();
    expect(yearlyEntry?.savings).toBeNull();
  });

  test('passes admin catalog SKUs through to StoreKit without bootstrap whitelist filtering', async () => {
    (subscriptionPlansService.fetchPlans as jest.Mock).mockResolvedValueOnce({
      plans: [adminPlan],
      source: 'network',
    });
    (iapService.getProductSummaries as jest.Mock).mockResolvedValueOnce([
      adminProduct,
    ]);

    const { result } = renderHook(() =>
      useSubscriptionPlans({ formatPrice, formatSavings }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(iapService.getProductSummaries).toHaveBeenCalledWith([adminSku]);
    expect(result.current.plans).toHaveLength(1);
    expect(result.current.plans[0]?.product?.productId).toBe(adminSku);
  });

  test('short-circuits all fetches when enabled is false', async () => {
    // Arrange — nothing should be called

    // Act
    const { result } = renderHook(() =>
      useSubscriptionPlans({ formatPrice, formatSavings, enabled: false }),
    );

    // Assert: no network, no StoreKit, empty result, not loading.
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(subscriptionPlansService.fetchPlans).not.toHaveBeenCalled();
    expect(iapService.getProductSummaries).not.toHaveBeenCalled();
    expect(result.current.plans).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  test('falls back to the two fixed SKUs when Apple returns no products', async () => {
    // Arrange: catalog has plans but StoreKit is empty (sandbox not signed in,
    // ASC mis-config, etc.). The hook should keep the paywall renderable with
    // the fixed bootstrap SKU pair.
    (subscriptionPlansService.fetchPlans as jest.Mock).mockResolvedValueOnce({
      plans: [monthlyPlan, yearlyPlan],
      source: 'network',
    });
    (iapService.getProductSummaries as jest.Mock).mockResolvedValueOnce([]);
    mockFixedBootstrapSkuFallback();

    // Act
    const { result } = renderHook(() =>
      useSubscriptionPlans({ formatPrice, formatSavings }),
    );

    // Assert
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.productsLoading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.source).toBe('bootstrap');
    expect(result.current.plans.map(entry => entry.plan.product_id)).toEqual([
      IAP_PRODUCTS.monthly,
      IAP_PRODUCTS.yearlyPromo,
    ]);
  });

  test('refresh re-fetches both catalog and StoreKit products', async () => {
    // Arrange: first call returns 1 plan, second call returns 2 plans.
    (subscriptionPlansService.fetchPlans as jest.Mock)
      .mockResolvedValueOnce({
        plans: [monthlyPlan],
        source: 'network',
      })
      .mockResolvedValueOnce({
        plans: [monthlyPlan, yearlyPlan],
        source: 'network',
      });
    (iapService.getProductSummaries as jest.Mock)
      .mockResolvedValueOnce([monthlyProduct])
      .mockResolvedValueOnce([monthlyProduct, yearlyProduct]);

    // Act
    const { result } = renderHook(() =>
      useSubscriptionPlans({ formatPrice, formatSavings }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.plans).toHaveLength(1);

    await act(async () => {
      await result.current.refresh();
    });

    // Assert: both services hit twice, hook reflects fresh catalog.
    await waitFor(() => expect(result.current.plans).toHaveLength(2));
    expect(subscriptionPlansService.fetchPlans).toHaveBeenCalledTimes(2);
    expect(iapService.getProductSummaries).toHaveBeenCalledTimes(2);
  });

  test('propagates source from service through to consumer', async () => {
    // Arrange — bootstrap source from cold-start offline scenario.
    (subscriptionPlansService.fetchPlans as jest.Mock).mockResolvedValueOnce({
      plans: [monthlyPlan, yearlyPlan],
      source: 'bootstrap',
    });
    (iapService.getProductSummaries as jest.Mock).mockResolvedValueOnce([
      monthlyProduct,
      yearlyProduct,
    ]);

    // Act
    const { result } = renderHook(() =>
      useSubscriptionPlans({ formatPrice, formatSavings }),
    );

    // Assert: screen reads `source` to decide whether to show the offline
    // footer note. Round-tripping the service value verbatim is the contract.
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.source).toBe('bootstrap');
  });
});
