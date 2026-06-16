import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import type { SubscriptionPlanPlatform } from '@syncflow/contracts';
import { iapService, type IapProductSummary } from '../services/iap-service';
import {
  subscriptionPlansService,
  buildFixedProductSummary,
  type CatalogSubscriptionPlan,
  type SubscriptionPlansSource,
} from '../services/subscription-plans-service';
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
  plan: CatalogSubscriptionPlan;
  /** `null` only when neither StoreKit nor the fixed fallback can describe
   *  `plan.product_id`. Purchase still re-checks StoreKit availability before
   *  requesting payment. */
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
   *  from `loading` because product metadata can resolve later than the
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
  platform?: SubscriptionPlanPlatform;
  useIapProducts?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function buildWalletProductSummary(
  plan: CatalogSubscriptionPlan,
  formatPrice: (amount: number, currency: string) => string,
): IapProductSummary | null {
  const amountCents =
    typeof plan.amount_cents === 'number' && Number.isFinite(plan.amount_cents)
      ? plan.amount_cents
      : null;
  const currency =
    typeof plan.currency === 'string' && plan.currency.trim().length > 0
      ? plan.currency.trim()
      : null;
  if (amountCents != null && amountCents > 0 && currency != null) {
    const priceAmount = amountCents / 100;
    return {
      productId: plan.product_id,
      displayPrice: formatPrice(priceAmount, currency),
      priceAmount,
      currency,
      periodUnit: plan.plan === 'monthly' ? 'MONTH' : 'YEAR',
      periodCount: 1,
      eligibleForIntroOffer: false,
    };
  }
  return buildFixedProductSummary(plan.product_id, plan.plan);
}

function buildWalletProductSummaries(
  plans: readonly CatalogSubscriptionPlan[],
  formatPrice: (amount: number, currency: string) => string,
): IapProductSummary[] {
  return plans
    .map(plan => buildWalletProductSummary(plan, formatPrice))
    .filter((entry): entry is IapProductSummary => entry != null);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSubscriptionPlans({
  formatPrice,
  formatSavings,
  enabled = FEATURES.IAP_ENABLED,
  platform = 'ios',
  useIapProducts = true,
}: UseSubscriptionPlansArgs): UseSubscriptionPlansResult {
  // Server catalog is the only paywall source of truth. Do not seed with
  // hardcoded SKUs: admin can disable a product and the subscription screen
  // must not briefly or permanently re-render it from client fallback data.
  const [plans, setPlans] = useState<CatalogSubscriptionPlan[]>([]);
  const [products, setProducts] = useState<IapProductSummary[]>([]);
  const [source, setSource] = useState<SubscriptionPlansSource>('bootstrap');
  const [loading, setLoading] = useState<boolean>(enabled);
  const [productsLoading, setProductsLoading] = useState<boolean>(
    enabled && useIapProducts,
  );
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
    setProductsLoading(useIapProducts);
    setError(null);
    // Step 1 — server catalog (with cache + bootstrap fallback inside).
    // Decoupled from StoreKit so a slow / failed catalog fetch doesn't
    // hold the Subscribe gate hostage when StoreKit responds first, and
    // vice versa.
    let validPlans: CatalogSubscriptionPlan[] = [];
    try {
      const catalog = await subscriptionPlansService.fetchPlans(platform);
      validPlans = catalog.plans.filter(p => p.active);
      setPlans(validPlans);
      setSource(catalog.source);
    } catch (err) {
      console.warn('[useSubscriptionPlans] catalog fetch failed', err);
      validPlans = [];
      setPlans([]);
      setProducts([]);
      setSource('bootstrap');
    } finally {
      setLoading(false);
    }

    if (!useIapProducts) {
      setProducts(buildWalletProductSummaries(validPlans, formatPrice));
      setProductsLoading(false);
      return;
    }

    // Step 2 — Apple StoreKit prices/period for the SKUs the server told
    // us to render. Runs in its own try/finally so a StoreKit failure
    // doesn't roll back the catalog already shown to the user. Do not
    // whitelist against bootstrap constants here: the server catalog is the
    // registry and admin-controlled SKUs must reach StoreKit.
    try {
      const skus = validPlans.map(p => p.product_id);
      const fetchedProducts =
        skus.length > 0 ? await iapService.getProductSummaries(skus) : [];
      if (validPlans.length > 0 && fetchedProducts.length === 0) {
        console.warn(
          '[useSubscriptionPlans] StoreKit returned no products for server catalog',
        );
      }
      if (fetchedProducts.length === 0 && Platform.OS === 'android') {
        console.log(
          '[useSubscriptionPlans] Android: falling back to static/server prices',
        );
        setProducts(buildWalletProductSummaries(validPlans, formatPrice));
      } else {
        setProducts(fetchedProducts);
      }
    } catch (err) {
      console.warn('[useSubscriptionPlans] StoreKit product fetch failed', err);
      if (Platform.OS === 'android') {
        console.log('[useSubscriptionPlans] Android fallback after failure');
        setProducts(buildWalletProductSummaries(validPlans, formatPrice));
      } else {
        setProducts([]);
      }
    } finally {
      setProductsLoading(false);
    }
  }, [enabled, platform, useIapProducts, formatPrice]);

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
