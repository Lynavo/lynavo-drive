import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  SubscriptionPlanDto,
  SubscriptionPlanPlatform,
  SubscriptionPlanTier,
  SubscriptionPlansResponse,
} from '@syncflow/contracts';
import { apiGet, ApiError } from './api';
import type { IapProductSummary } from './iap-service';
import { ALL_PRODUCT_IDS, IAP_PRODUCTS } from '../constants/iap';
import { marketConfig } from '../markets';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CACHE_KEY = '@vividrop/subscription-plans-cache:v2';
const PLANS_PATH = '/subscription/plans';
const BOOTSTRAP_MEMORY_CACHE_TTL_MS = 5_000;

const ANDROID_MAINLAND_PRODUCTS = {
  monthly: 'com.vividrop.android.china.monthly.999',
  yearlyPromo: 'com.vividrop.android.china.yearly.9900',
} as const;

export type SubscriptionPlansSource = 'network' | 'cache' | 'bootstrap';
export type CatalogSubscriptionPlan = SubscriptionPlanDto;

export interface SubscriptionPlansResult {
  plans: CatalogSubscriptionPlan[];
  source: SubscriptionPlansSource;
}

export interface SubscriptionProductPlan {
  productId: string;
  plan: SubscriptionPlanTier;
}

export interface SubscriptionPlansService {
  fetchPlans(
    platform?: SubscriptionPlanPlatform,
  ): Promise<SubscriptionPlansResult>;
  /** Test-only: clears the AsyncStorage cache. */
  _clearCache(): Promise<void>;
}

const memoryCache = new Map<
  SubscriptionPlanPlatform,
  { result: SubscriptionPlansResult; expiresAt: number }
>();
const inFlightFetches = new Map<
  SubscriptionPlanPlatform,
  Promise<SubscriptionPlansResult>
>();

// ---------------------------------------------------------------------------
// Cache envelope
// ---------------------------------------------------------------------------

interface PlansCacheEnvelope {
  platform: SubscriptionPlanPlatform;
  plans: CatalogSubscriptionPlan[];
  /** ISO 8601 timestamp of when the network response was cached. */
  cachedAt: string;
}

function isPlatform(value: unknown): value is SubscriptionPlanPlatform {
  return value === 'ios' || value === 'android';
}

function isPlanShape(value: unknown): value is CatalogSubscriptionPlan {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'number' &&
    typeof v.product_id === 'string' &&
    isSubscriptionPlanTier(v.plan) &&
    isPlatform(v.platform) &&
    typeof v.name === 'string' &&
    typeof v.description === 'string' &&
    Array.isArray(v.badges) &&
    v.badges.every(b => typeof b === 'string') &&
    typeof v.recommended === 'boolean' &&
    typeof v.sort_order === 'number' &&
    typeof v.active === 'boolean' &&
    typeof v.created_at === 'string' &&
    typeof v.updated_at === 'string'
  );
}

function isSubscriptionPlanTier(value: unknown): value is SubscriptionPlanTier {
  return value === 'monthly' || value === 'yearly';
}

export function resolveSubscriptionPlanTier(
  plan: SubscriptionPlanDto,
): SubscriptionPlanTier | null {
  return isSubscriptionPlanTier(plan.plan) ? plan.plan : null;
}

function parseCache(raw: string | null): PlansCacheEnvelope | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const env = parsed as Record<string, unknown>;
    if (!isPlatform(env.platform)) return null;
    if (typeof env.cachedAt !== 'string') return null;
    if (!Array.isArray(env.plans)) return null;
    if (!env.plans.every(isPlanShape)) return null;
    return {
      platform: env.platform,
      plans: env.plans,
      cachedAt: env.cachedAt,
    };
  } catch {
    // Corrupt cache (mid-write crash, manual edit, version mismatch) — drop it.
    return null;
  }
}

async function readCache(
  platform: SubscriptionPlanPlatform,
): Promise<CatalogSubscriptionPlan[] | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    const env = parseCache(raw);
    if (!env) return null;
    if (env.platform !== platform) return null;
    return env.plans.filter(plan => plan.active);
  } catch (err) {
    console.warn('[plans-service] cache read failed', err);
    return null;
  }
}

async function writeCache(
  platform: SubscriptionPlanPlatform,
  plans: CatalogSubscriptionPlan[],
): Promise<void> {
  const envelope: PlansCacheEnvelope = {
    platform,
    plans,
    cachedAt: new Date().toISOString(),
  };
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(envelope));
  } catch (err) {
    // Cache write failure is non-fatal — next launch will simply re-fetch.
    console.warn('[plans-service] cache write failed', err);
  }
}

// ---------------------------------------------------------------------------
// Bootstrap fallback
// ---------------------------------------------------------------------------

/**
 * Build a minimal `SubscriptionPlanDto[]` from the hardcoded SKU constants.
 *
 * Kept only as a last-resort metadata helper for non-authoritative flows.
 * The paywall must render the server catalog, not this hardcoded list,
 * because admin can disable SKUs at runtime.
 */
export function buildBootstrapPlans(
  platform: SubscriptionPlanPlatform,
): CatalogSubscriptionPlan[] {
  if (platform === 'android') {
    const epoch = new Date(0).toISOString();
    if (marketConfig.market === 'global') {
      return [
        {
          id: 101,
          product_id: 'com.vividrop.mobile.global.monthly.999',
          plan: 'monthly',
          platform,
          name: 'Monthly Plan',
          description: 'Subscribe monthly, cancel anytime',
          badges: [],
          recommended: false,
          sort_order: 10,
          active: true,
          created_at: epoch,
          updated_at: epoch,
        },
        {
          id: 102,
          product_id: 'com.vividrop.mobile.global.yearly.9900',
          plan: 'yearly',
          platform,
          name: 'Yearly Plan',
          description: 'One year of unlimited sync',
          badges: [],
          recommended: true,
          sort_order: 20,
          active: true,
          created_at: epoch,
          updated_at: epoch,
        },
      ];
    }
    return [
      {
        id: 101,
        product_id: ANDROID_MAINLAND_PRODUCTS.monthly,
        plan: 'monthly',
        platform,
        name: '月度方案',
        description: '按月訂閱，隨時取消',
        amount_cents: 999,
        currency: 'CNY',
        badges: [],
        recommended: false,
        sort_order: 10,
        active: true,
        created_at: epoch,
        updated_at: epoch,
      },
      {
        id: 102,
        product_id: ANDROID_MAINLAND_PRODUCTS.yearlyPromo,
        plan: 'yearly',
        platform,
        name: '年度方案',
        description: '一年無限同步',
        amount_cents: 9900,
        currency: 'CNY',
        badges: ['限時'],
        recommended: true,
        sort_order: 20,
        active: true,
        created_at: epoch,
        updated_at: epoch,
      },
    ];
  }

  const epoch = new Date(0).toISOString();
  const allowedSkus: ReadonlySet<string> = new Set(ALL_PRODUCT_IDS);
  const candidates: CatalogSubscriptionPlan[] = [
    {
      id: 1,
      product_id: IAP_PRODUCTS.monthly,
      plan: 'monthly',
      platform,
      name: '月付试水',
      description: '按月计费，随时取消',
      badges: [],
      recommended: false,
      sort_order: 1,
      active: true,
      created_at: epoch,
      updated_at: epoch,
    },
    {
      id: 3,
      product_id: IAP_PRODUCTS.yearlyPromo,
      plan: 'yearly',
      platform,
      name: '限时年费',
      description: '新用户限时优惠价',
      badges: ['限时优惠'],
      recommended: false,
      sort_order: 3,
      active: true,
      created_at: epoch,
      updated_at: epoch,
    },
  ];
  return candidates.filter(plan => allowedSkus.has(plan.product_id));
}

const FIXED_PRODUCT_SUMMARY_BY_TIER: Readonly<
  Record<SubscriptionPlanTier, Omit<IapProductSummary, 'productId'>>
> = {
  monthly: {
    displayPrice: '¥9.90',
    priceAmount: 9.9,
    currency: 'CNY',
    periodUnit: 'MONTH',
    periodCount: 1,
    eligibleForIntroOffer: false,
  },
  yearly: {
    displayPrice: '¥99.00',
    priceAmount: 99,
    currency: 'CNY',
    periodUnit: 'YEAR',
    periodCount: 1,
    eligibleForIntroOffer: false,
  },
};

export function buildFixedProductSummary(
  productId: string,
  plan: SubscriptionPlanTier,
): IapProductSummary {
  return {
    productId,
    ...FIXED_PRODUCT_SUMMARY_BY_TIER[plan],
  };
}

/**
 * Bootstrap counterpart for `buildBootstrapPlans` — provides StoreKit-shaped
 * `IapProductSummary` rows for tests and non-authoritative fallback helpers.
 * The paywall no longer uses these rows as first-paint seed data, because
 * hardcoded products can conflict with admin-disabled catalog rows.
 *
 * Numbers reflect the CN App Store storefront, which is the only locale
 * the SKU namespace (`com.vividrop.mobile.china.*`) is published to.
 */
export function buildBootstrapProducts(): IapProductSummary[] {
  const allowedSkus: ReadonlySet<string> = new Set(ALL_PRODUCT_IDS);
  const candidates: IapProductSummary[] = [
    buildFixedProductSummary(IAP_PRODUCTS.monthly, 'monthly'),
    buildFixedProductSummary(IAP_PRODUCTS.yearlyPromo, 'yearly'),
  ];
  return candidates.filter(p => allowedSkus.has(p.productId));
}

// ---------------------------------------------------------------------------
// Service implementation
// ---------------------------------------------------------------------------

class SubscriptionPlansServiceImpl implements SubscriptionPlansService {
  async fetchPlans(
    platform: SubscriptionPlanPlatform = 'ios',
  ): Promise<SubscriptionPlansResult> {
    const now = Date.now();
    const cachedResult = memoryCache.get(platform);
    if (
      cachedResult &&
      cachedResult.expiresAt > now &&
      cachedResult.result.source === 'bootstrap'
    ) {
      return cachedResult.result;
    }

    const inFlight = inFlightFetches.get(platform);
    if (inFlight) return inFlight;

    const task = this.fetchPlansUncached(platform).finally(() => {
      inFlightFetches.delete(platform);
    });
    inFlightFetches.set(platform, task);
    return task;
  }

  private remember(
    platform: SubscriptionPlanPlatform,
    result: SubscriptionPlansResult,
    ttlMs: number,
  ): SubscriptionPlansResult {
    memoryCache.set(platform, {
      result,
      expiresAt: Date.now() + ttlMs,
    });
    return result;
  }

  private async fetchPlansUncached(
    platform: SubscriptionPlanPlatform,
  ): Promise<SubscriptionPlansResult> {
    // 1. Try the network. apiGet handles auth, refresh, timeout, retry.
    try {
      const response = await apiGet<SubscriptionPlansResponse>(
        `${PLANS_PATH}?platform=${encodeURIComponent(
          platform,
        )}&region=${encodeURIComponent(marketConfig.market)}`,
      );
      const plans = Array.isArray(response.plans) ? response.plans : [];
      // Server is the sort authority but defensively re-sort so a transient
      // ordering bug on the backend cannot shuffle the paywall.
      const sorted = plans
        .filter(plan => plan.active)
        .sort((a, b) => a.sort_order - b.sort_order);
      void writeCache(platform, sorted);
      memoryCache.delete(platform);
      return { plans: sorted, source: 'network' };
    } catch (err) {
      if (err instanceof ApiError) {
        console.warn(
          `[plans-service] network fetch failed (code=${err.code}): ${err.message}`,
        );
      } else {
        console.warn('[plans-service] network fetch failed', err);
      }
    }

    // 2. Fall back to the AsyncStorage cache.
    const cached = await readCache(platform);
    if (cached && cached.length > 0) {
      memoryCache.delete(platform);
      return { plans: cached, source: 'cache' };
    }

    // 3. Final fallback — keep admin-controlled catalog authoritative. A
    // hardcoded SKU fallback can re-show products that were disabled in
    // admin, so the UI should go empty and offer retry instead.
    console.warn(
      '[plans-service] no subscription catalog available — server unreachable and no cache',
    );
    return this.remember(
      platform,
      {
        plans: [],
        source: 'bootstrap',
      },
      BOOTSTRAP_MEMORY_CACHE_TTL_MS,
    );
  }

  async _clearCache(): Promise<void> {
    memoryCache.clear();
    inFlightFetches.clear();
    try {
      await AsyncStorage.removeItem(CACHE_KEY);
    } catch {
      // Ignore — only used in tests.
    }
  }
}

export const subscriptionPlansService: SubscriptionPlansService =
  new SubscriptionPlansServiceImpl();

export async function getSubscriptionProductPlans(
  platform: SubscriptionPlanPlatform = 'ios',
): Promise<SubscriptionProductPlan[]> {
  const catalog = await subscriptionPlansService.fetchPlans(platform);
  return catalog.plans
    .filter(plan => plan.active)
    .map(plan => {
      const tier = resolveSubscriptionPlanTier(plan);
      return tier ? { productId: plan.product_id, plan: tier } : null;
    })
    .filter((entry): entry is SubscriptionProductPlan => entry != null);
}

export async function resolveSubscriptionProductPlan(
  productId: string,
  platform: SubscriptionPlanPlatform = 'ios',
): Promise<SubscriptionPlanTier | null> {
  const productPlans = await getSubscriptionProductPlans(platform);
  return (
    productPlans.find(entry => entry.productId === productId)?.plan ?? null
  );
}
