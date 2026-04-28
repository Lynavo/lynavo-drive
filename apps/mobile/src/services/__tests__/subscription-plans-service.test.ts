// Mocks must be declared before importing the service so the imports inside
// `subscription-plans-service` see the stubs (Jest hoists `jest.mock` calls).
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('../api', () => {
  // ApiError must be a real constructor so `instanceof ApiError` checks
  // inside the service still work when the network path throws.
  class ApiError extends Error {
    code: number;
    constructor(code: number, message: string) {
      super(message);
      this.name = 'ApiError';
      this.code = code;
    }
  }
  return {
    apiGet: jest.fn(),
    ApiError,
    ERROR_CODE: { NETWORK_ERROR: 9004, SERVER_ERROR: 9002 },
  };
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  SubscriptionPlanDto,
  SubscriptionPlansResponse,
} from '@syncflow/contracts';
import { apiGet, ApiError } from '../api';
import {
  resolveSubscriptionPlanTier,
  subscriptionPlansService,
} from '../subscription-plans-service';
import { IAP_PRODUCTS } from '../../constants/iap';

const CACHE_KEY = '@vividrop/subscription-plans-cache:v1';

const monthlyPlan: SubscriptionPlanDto = {
  id: 1,
  product_id: IAP_PRODUCTS.monthly,
  plan: 'monthly',
  platform: 'ios',
  name: '月度方案',
  description: '按月訂閱',
  badges: [],
  recommended: false,
  sort_order: 10,
  active: true,
  created_at: '2026-04-24T00:00:00Z',
  updated_at: '2026-04-24T00:00:00Z',
};

const yearlyPlan: SubscriptionPlanDto = {
  id: 2,
  product_id: IAP_PRODUCTS.yearly,
  plan: 'yearly',
  platform: 'ios',
  name: '年度方案',
  description: '一年無限同步',
  badges: ['8.8 折'],
  recommended: true,
  sort_order: 20,
  active: true,
  created_at: '2026-04-24T00:00:00Z',
  updated_at: '2026-04-24T00:00:00Z',
};

const adminPlan = {
  id: 10,
  product_id: 'admin.catalog.alpha',
  platform: 'ios' as const,
  plan: 'monthly' as const,
  name: '後台方案',
  description: '後台設定 SKU',
  badges: [],
  recommended: false,
  sort_order: 5,
  active: true,
  created_at: '2026-04-24T00:00:00Z',
  updated_at: '2026-04-24T00:00:00Z',
};

describe('subscriptionPlansService.fetchPlans', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(async () => {
    jest.clearAllMocks();
    await subscriptionPlansService._clearCache();
    jest.clearAllMocks();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test('returns network result and writes cache when API succeeds', async () => {
    // Arrange: server returns plans in deliberately wrong order so we can
    // verify the service re-sorts defensively by sort_order ascending.
    const response: SubscriptionPlansResponse = {
      plans: [yearlyPlan, monthlyPlan],
    };
    (apiGet as jest.Mock).mockResolvedValueOnce(response);

    // Act
    const result = await subscriptionPlansService.fetchPlans('ios');

    // Assert
    expect(result.source).toBe('network');
    expect(result.plans).toHaveLength(2);
    expect(result.plans[0]?.product_id).toBe(monthlyPlan.product_id);
    expect(result.plans[1]?.product_id).toBe(yearlyPlan.product_id);
    expect(apiGet).toHaveBeenCalledWith('/subscription/plans?platform=ios');

    // Cache written with sorted plans.
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
    const setItemCalls = (AsyncStorage.setItem as jest.Mock).mock.calls;
    const [key, raw] = setItemCalls[0] as [string, string];
    expect(key).toBe(CACHE_KEY);
    const envelope = JSON.parse(raw) as {
      platform: string;
      plans: SubscriptionPlanDto[];
    };
    expect(envelope.platform).toBe('ios');
    expect(envelope.plans).toEqual([monthlyPlan, yearlyPlan]);
  });

  test('preserves server plan/tier metadata for admin-configured SKUs', async () => {
    (apiGet as jest.Mock).mockResolvedValueOnce({ plans: [adminPlan] });

    const result = await subscriptionPlansService.fetchPlans('ios');

    expect(result.source).toBe('network');
    expect(result.plans[0]?.product_id).toBe('admin.catalog.alpha');
    expect(resolveSubscriptionPlanTier(result.plans[0]!)).toBe('monthly');
    const setItemCalls = (AsyncStorage.setItem as jest.Mock).mock.calls;
    const [, raw] = setItemCalls[0] as [string, string];
    expect(JSON.parse(raw).plans[0].plan).toBe('monthly');
  });

  test('coalesces concurrent requests for the same platform', async () => {
    let resolveNetwork!: (value: SubscriptionPlansResponse) => void;
    (apiGet as jest.Mock).mockReturnValueOnce(
      new Promise<SubscriptionPlansResponse>(resolve => {
        resolveNetwork = resolve;
      }),
    );

    const first = subscriptionPlansService.fetchPlans('ios');
    const second = subscriptionPlansService.fetchPlans('ios');

    expect(apiGet).toHaveBeenCalledTimes(1);
    resolveNetwork({ plans: [monthlyPlan] });

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toEqual(secondResult);
    expect(firstResult.source).toBe('network');
    expect(firstResult.plans).toEqual([monthlyPlan]);
  });

  test('serves repeated requests from short-lived memory cache', async () => {
    (apiGet as jest.Mock).mockResolvedValueOnce({ plans: [monthlyPlan] });

    const first = await subscriptionPlansService.fetchPlans('ios');
    const second = await subscriptionPlansService.fetchPlans('ios');

    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  test('bootstrap fallback memory cache expires quickly', async () => {
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_000);
    (apiGet as jest.Mock).mockRejectedValueOnce(new Error('offline'));
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null);

    const first = await subscriptionPlansService.fetchPlans('ios');
    expect(first.source).toBe('bootstrap');
    expect(apiGet).toHaveBeenCalledTimes(1);

    nowSpy.mockReturnValue(5_000);
    const second = await subscriptionPlansService.fetchPlans('ios');
    expect(second.source).toBe('bootstrap');
    expect(apiGet).toHaveBeenCalledTimes(1);

    nowSpy.mockReturnValue(7_000);
    (apiGet as jest.Mock).mockResolvedValueOnce({ plans: [monthlyPlan] });
    const third = await subscriptionPlansService.fetchPlans('ios');

    expect(third.source).toBe('network');
    expect(third.plans).toEqual([monthlyPlan]);
    expect(apiGet).toHaveBeenCalledTimes(2);

    nowSpy.mockRestore();
  });

  test('falls back to cache when network fails and cache is valid', async () => {
    // Arrange
    (apiGet as jest.Mock).mockRejectedValueOnce(
      new ApiError(9004, 'NETWORK_ERROR'),
    );
    const cached = JSON.stringify({
      platform: 'ios',
      plans: [monthlyPlan, yearlyPlan],
      cachedAt: '2026-04-23T00:00:00Z',
    });
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(cached);

    // Act
    const result = await subscriptionPlansService.fetchPlans('ios');

    // Assert
    expect(result.source).toBe('cache');
    expect(result.plans).toEqual([monthlyPlan, yearlyPlan]);
    expect(AsyncStorage.getItem).toHaveBeenCalledWith(CACHE_KEY);
    // No new write — cache miss path is the only writer.
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  test('falls back to bootstrap when network fails and cache is empty', async () => {
    // Arrange: missing cache (null) AND network down.
    (apiGet as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null);

    // Act
    const result = await subscriptionPlansService.fetchPlans('ios');

    // Assert: bootstrap delivers the two production SKUs (monthly +
    // yearlyPromo) so the paywall is never empty even on cold-install +
    // offline. Mirrors the live server catalog (id=1, id=3) so a successful
    // refresh later is visually a no-op.
    expect(result.source).toBe('bootstrap');
    expect(result.plans).toHaveLength(2);
    const ids = result.plans.map(p => p.product_id).sort();
    expect(ids).toEqual(
      [IAP_PRODUCTS.monthly, IAP_PRODUCTS.yearlyPromo].sort(),
    );
    // Bootstrap mode must announce itself loudly so QA notices the
    // degraded-state render rather than blaming "stale data".
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('bootstrap fallback active'),
    );
  });

  test('falls back to bootstrap when cache JSON is corrupt', async () => {
    // Arrange: cache schema validation should drop a non-JSON / mid-write
    // garbage payload rather than crashing or returning a half-typed plan.
    (apiGet as jest.Mock).mockRejectedValueOnce(new Error('offline'));
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(
      '{"platform":"ios","plans":[{"id":"not-a-number"}],"cachedAt":"x"}',
    );

    // Act
    const result = await subscriptionPlansService.fetchPlans('ios');

    // Assert: corrupt cache treated as miss → bootstrap path.
    expect(result.source).toBe('bootstrap');
    expect(result.plans.length).toBeGreaterThan(0);
  });

  test('passes platform query parameter through to apiGet', async () => {
    // Arrange
    (apiGet as jest.Mock).mockResolvedValueOnce({ plans: [] });

    // Act
    await subscriptionPlansService.fetchPlans('android');

    // Assert: platform value reaches the URL exactly so the server can scope
    // the catalog (different SKUs / pricing tiers per store).
    expect(apiGet).toHaveBeenCalledWith('/subscription/plans?platform=android');
  });
});
