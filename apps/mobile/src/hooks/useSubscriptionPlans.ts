import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SubscriptionPlanDto } from '@syncflow/contracts';
import { iapService, type IapProductSummary } from '../services/iap-service';
import {
  subscriptionPlansService,
  buildBootstrapPlans,
  buildBootstrapProducts,
  type SubscriptionPlansSource,
} from '../services/subscription-plans-service';
import type { IapProductId } from '../constants/iap';
import { ALL_PRODUCT_IDS } from '../constants/iap';
import { FEATURES } from '../constants/features';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface YearlySavings {
  display: string;
  percent: number;
  annualizedMonthlyDisplay: string;
}

export interface PlanWithProduct {
  plan: SubscriptionPlanDto;
  /** `null` when StoreKit did not return a SKU matching `plan.product_id`.
   *  Reasons: ASC mis-config, sandbox not signed in, region restriction.
   *  Decision: keep the entry so the screen can render an "unavailable"
   *  placeholder rather than silently dropping a server-driven plan. The
   *  screen layer (#19) decides whether to filter or display the placeholder. */
  product: IapProductSummary | null;
  /** Yearly savings vs the cheapest monthly-period anchor in the same
   *  currency. `null` for monthly plans, plans without a product, or when no
   *  monthly anchor exists in the catalog. */
  savings: YearlySavings | null;
}

export interface UseSubscriptionPlansResult {
  /** True while the server `subscription_plans` catalog is being fetched.
   *  Decoupled from StoreKit lookup so the paywall can render server-driven
   *  plan names/descriptions even before Apple returns localized prices. */
  loading: boolean;
  /** True while StoreKit `getProductSummaries` is in flight. Independent
   *  from `loading` because the IAP service is initialized lazily (post
   *  cold-start, see `useIapLifecycle`) and may resolve later than the
   *  server catalog. The paywall uses this to keep the Subscribe button
   *  blocked until Apple-side prices are confirmed, even if `loading` has
   *  already flipped false. */
  productsLoading: boolean;
  error: string | null;
  plans: PlanWithProduct[];
  source: SubscriptionPlansSource;
  refresh: () => Promise<void>;
}

export interface UseSubscriptionPlansArgs {
  formatPrice: (amount: number, currency: string) => string;
  formatSavings: (savingsDisplay: string) => string;
  enabled?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALLOWED_SKUS: ReadonlySet<string> = new Set(ALL_PRODUCT_IDS);

function isKnownIapProductId(productId: string): productId is IapProductId {
  return ALLOWED_SKUS.has(productId);
}

/**
 * Pick the monthly anchor for savings math: lowest-priced product whose
 * StoreKit period is exactly 1 month. Walking by period unit (not by SKU
 * naming) means a future "weekly" or "quarterly" plan does not silently
 * become the anchor and skew the percentages.
 */
function findMonthlyAnchor(
  rows: ReadonlyArray<{ product: IapProductSummary | null }>,
): IapProductSummary | null {
  let anchor: IapProductSummary | null = null;
  for (const row of rows) {
    const p = row.product;
    if (!p) continue;
    if (p.periodUnit !== 'MONTH') continue;
    if ((p.periodCount ?? 1) !== 1) continue;
    if (p.priceAmount <= 0) continue;
    if (!anchor || p.priceAmount < anchor.priceAmount) {
      anchor = p;
    }
  }
  return anchor;
}

function computeYearlySavings(
  monthly: IapProductSummary,
  yearly: IapProductSummary,
  formatPrice: (amount: number, currency: string) => string,
  formatSavings: (savingsDisplay: string) => string,
): YearlySavings | null {
  if (monthly.currency !== yearly.currency) return null;
  if (monthly.priceAmount <= 0 || yearly.priceAmount <= 0) return null;
  const annualized = monthly.priceAmount * 12;
  if (yearly.priceAmount >= annualized) return null;
  const savedAmount = annualized - yearly.priceAmount;
  const percent = Math.round((savedAmount / annualized) * 100);
  return {
    display: formatSavings(formatPrice(savedAmount, monthly.currency)),
    percent,
    annualizedMonthlyDisplay: formatPrice(annualized, monthly.currency),
  };
}

function isYearlyPeriod(product: IapProductSummary): boolean {
  return product.periodUnit === 'YEAR' && (product.periodCount ?? 1) === 1;
}

function computePlanSavings(
  product: IapProductSummary | null,
  monthlyAnchor: IapProductSummary | null,
  formatPrice: (amount: number, currency: string) => string,
  formatSavings: (savingsDisplay: string) => string,
): YearlySavings | null {
  if (!product || !monthlyAnchor) return null;
  // Do not "save vs self".
  if (product.productId === monthlyAnchor.productId) return null;
  // Only yearly tiers carry meaningful savings copy in the current PRD.
  if (!isYearlyPeriod(product)) return null;
  return computeYearlySavings(
    monthlyAnchor,
    product,
    formatPrice,
    formatSavings,
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSubscriptionPlans({
  formatPrice,
  formatSavings,
  enabled = FEATURES.IAP_ENABLED,
}: UseSubscriptionPlansArgs): UseSubscriptionPlansResult {
  // Seed `plans` with the same hardcoded bootstrap rows the service uses on
  // its final fallback. Goal is purely UX: the paywall renders two cards
  // immediately on first paint instead of flashing an empty `planRow` while
  // the network request and StoreKit lookup are in flight. Once the network
  // catalog (or AsyncStorage cache) returns, `setPlans` replaces this seed
  // with the authoritative list — product_ids match the production server
  // response so a successful refresh is visually a no-op for the user.
  // When `enabled` is false (IAP feature flag off) we deliberately stay
  // empty so the screen renders nothing IAP-related.
  const [plans, setPlans] = useState<SubscriptionPlanDto[]>(() =>
    enabled ? buildBootstrapPlans('ios') : [],
  );
  // Seed `products` alongside `plans` so the paywall renders real-looking
  // prices on first paint instead of the "—" placeholder. The seed is
  // synced 1:1 with `buildBootstrapPlans` SKUs and replaced once StoreKit
  // returns localized prices. Subscribe button is blocked while `loading`
  // is true (see SubscriptionScreen) so users cannot tap against the
  // unverified seed amount.
  const [products, setProducts] = useState<IapProductSummary[]>(() =>
    enabled ? buildBootstrapProducts() : [],
  );
  const [source, setSource] = useState<SubscriptionPlansSource>('bootstrap');
  const [loading, setLoading] = useState<boolean>(enabled);
  const [productsLoading, setProductsLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!enabled) {
      setPlans([]);
      setProducts([]);
      setSource('bootstrap');
      setLoading(false);
      setProductsLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setProductsLoading(true);
    setError(null);
    // Step 1 — server catalog (with cache + bootstrap fallback inside).
    // Decoupled from StoreKit so a slow / failed catalog fetch doesn't
    // hold the Subscribe gate hostage when StoreKit responds first, and
    // vice versa.
    let validPlans: SubscriptionPlanDto[] = [];
    try {
      const catalog = await subscriptionPlansService.fetchPlans('ios');
      validPlans = catalog.plans.filter(p => p.active);
      setPlans(validPlans);
      setSource(catalog.source);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }

    // Step 2 — Apple StoreKit prices/period for the SKUs the server told
    // us to render. Runs in its own try/finally so a StoreKit failure
    // doesn't roll back the catalog already shown to the user. Filter
    // out unknown SKUs defensively so a server typo cannot crash StoreKit
    // lookup.
    try {
      const skus = validPlans
        .map(p => p.product_id)
        .filter(isKnownIapProductId);
      const fetchedProducts =
        skus.length > 0 ? await iapService.getProductSummaries(skus) : [];
      setProducts(fetchedProducts);

      // Surface STOREKIT_EMPTY when the catalog promised SKUs but Apple
      // returned nothing. Bootstrap source can also legitimately produce
      // zero products in dev — still useful signal.
      if (validPlans.length > 0 && fetchedProducts.length === 0) {
        setError('STOREKIT_EMPTY');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setProducts([]);
    } finally {
      setProductsLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const merged = useMemo<PlanWithProduct[]>(() => {
    if (plans.length === 0) return [];
    const productById = new Map<string, IapProductSummary>(
      products.map(p => [p.productId, p]),
    );
    const intermediate = plans.map(plan => ({
      plan,
      product: productById.get(plan.product_id) ?? null,
    }));
    const monthlyAnchor = findMonthlyAnchor(intermediate);
    return intermediate.map(({ plan, product }) => ({
      plan,
      product,
      savings: computePlanSavings(
        product,
        monthlyAnchor,
        formatPrice,
        formatSavings,
      ),
    }));
  }, [plans, products, formatPrice, formatSavings]);

  return {
    loading,
    productsLoading,
    error,
    plans: merged,
    source,
    refresh,
  };
}
