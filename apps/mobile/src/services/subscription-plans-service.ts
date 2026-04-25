import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  SubscriptionPlanDto,
  SubscriptionPlanPlatform,
  SubscriptionPlansResponse,
} from '@syncflow/contracts';
import { apiGet, ApiError } from './api';
import { ALL_PRODUCT_IDS, IAP_PRODUCTS } from '../constants/iap';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CACHE_KEY = '@vividrop/subscription-plans-cache:v1';
const PLANS_PATH = '/subscription/plans';

export type SubscriptionPlansSource = 'network' | 'cache' | 'bootstrap';

export interface SubscriptionPlansResult {
  plans: SubscriptionPlanDto[];
  source: SubscriptionPlansSource;
}

export interface SubscriptionPlansService {
  fetchPlans(
    platform?: SubscriptionPlanPlatform,
  ): Promise<SubscriptionPlansResult>;
  /** Test-only: clears the AsyncStorage cache. */
  _clearCache(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Cache envelope
// ---------------------------------------------------------------------------

interface PlansCacheEnvelope {
  platform: SubscriptionPlanPlatform;
  plans: SubscriptionPlanDto[];
  /** ISO 8601 timestamp of when the network response was cached. Currently
   *  informational only — we do not TTL the cache because the bootstrap
   *  fallback already protects the UI on truly stale data. */
  cachedAt: string;
}

function isPlatform(value: unknown): value is SubscriptionPlanPlatform {
  return value === 'ios' || value === 'android';
}

function isPlanShape(value: unknown): value is SubscriptionPlanDto {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'number' &&
    typeof v.product_id === 'string' &&
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
): Promise<SubscriptionPlanDto[] | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    const env = parseCache(raw);
    if (!env) return null;
    if (env.platform !== platform) return null;
    return env.plans;
  } catch (err) {
    console.warn('[plans-service] cache read failed', err);
    return null;
  }
}

async function writeCache(
  platform: SubscriptionPlanPlatform,
  plans: SubscriptionPlanDto[],
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
 * Used only when both the server and the AsyncStorage cache are unavailable
 * (cold install, offline, server outage). Without this the paywall would be
 * empty and users could not subscribe at all — a worse failure mode than
 * showing slightly out-of-date marketing copy.
 *
 * Bootstrap copy is intentionally bare (no badges) so the degraded mode is
 * visually obvious and the accompanying console.warn flags it for diagnostics.
 */
function buildBootstrapPlans(
  platform: SubscriptionPlanPlatform,
): SubscriptionPlanDto[] {
  const epoch = new Date(0).toISOString();
  const allowedSkus: ReadonlySet<string> = new Set(ALL_PRODUCT_IDS);
  const candidates: SubscriptionPlanDto[] = [
    {
      id: -1,
      product_id: IAP_PRODUCTS.monthly,
      platform,
      name: '月度方案',
      description: '按月訂閱，隨時取消',
      badges: [],
      recommended: false,
      sort_order: 10,
      active: true,
      created_at: epoch,
      updated_at: epoch,
    },
    {
      id: -2,
      product_id: IAP_PRODUCTS.yearly,
      platform,
      name: '年度方案',
      description: '一次付費，全年使用',
      badges: [],
      recommended: true,
      sort_order: 20,
      active: true,
      created_at: epoch,
      updated_at: epoch,
    },
    {
      id: -3,
      product_id: IAP_PRODUCTS.yearlyPromo,
      platform,
      name: '年度限時',
      description: '限時優惠價格',
      badges: [],
      recommended: false,
      sort_order: 30,
      active: true,
      created_at: epoch,
      updated_at: epoch,
    },
  ];
  return candidates.filter(plan => allowedSkus.has(plan.product_id));
}

// ---------------------------------------------------------------------------
// Service implementation
// ---------------------------------------------------------------------------

class SubscriptionPlansServiceImpl implements SubscriptionPlansService {
  async fetchPlans(
    platform: SubscriptionPlanPlatform = 'ios',
  ): Promise<SubscriptionPlansResult> {
    // 1. Try the network. apiGet handles auth, refresh, timeout, retry.
    try {
      const response = await apiGet<SubscriptionPlansResponse>(
        `${PLANS_PATH}?platform=${encodeURIComponent(platform)}`,
      );
      const plans = Array.isArray(response.plans) ? response.plans : [];
      // Server is the sort authority but defensively re-sort so a transient
      // ordering bug on the backend cannot shuffle the paywall.
      const sorted = [...plans].sort((a, b) => a.sort_order - b.sort_order);
      void writeCache(platform, sorted);
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
      return { plans: cached, source: 'cache' };
    }

    // 3. Final fallback — protect the paywall so users can still subscribe.
    console.warn(
      '[plans-service] bootstrap fallback active — server unreachable and no cache',
    );
    return { plans: buildBootstrapPlans(platform), source: 'bootstrap' };
  }

  async _clearCache(): Promise<void> {
    try {
      await AsyncStorage.removeItem(CACHE_KEY);
    } catch {
      // Ignore — only used in tests.
    }
  }
}

export const subscriptionPlansService: SubscriptionPlansService =
  new SubscriptionPlansServiceImpl();
