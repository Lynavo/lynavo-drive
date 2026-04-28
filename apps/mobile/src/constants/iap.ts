/**
 * BOOTSTRAP FALLBACK ONLY — not the SKU registry.
 *
 * The source of truth for the SKU list is the server's
 * `GET /api/v1/subscription/plans` endpoint, persisted to AsyncStorage as a
 * cache. This file is read ONLY when both the network request AND the local
 * cache fail simultaneously, to keep users from being stranded without any
 * way to subscribe in catastrophic outage scenarios (cold install + offline,
 * server down, cache corrupted, etc.).
 *
 * Treat this list as the offline bootstrap fallback, not as the canonical
 * SKU registry. Adding a SKU here does NOT make it visible to users — that
 * still requires registering the SKU in App Store Connect AND in the server's
 * plans catalog. Sync this list with App Store Connect manually only if you
 * want a newly added SKU to be available in the offline-bootstrap fallback.
 *
 * Other modules import these exports for purposes that survive the
 * server-driven catalog refactor:
 *   - `ALL_PRODUCT_IDS`        — used by `iap-service` to warm up StoreKit
 *                                with the canonical SKU set on app launch.
 *   - `productIdToPlan` /
 *     `planToProductId`        — bootstrap-only fallback mapping. Runtime
 *                                receipt verification must use the server
 *                                catalog's `plan` field instead.
 *   - `TRIAL_ELIGIBLE_PRODUCTS`— Apple configures the 7-day intro trial only
 *                                on the monthly product; this stays static
 *                                and platform-driven, not server-driven.
 *   - `IAP_PRODUCTS`           — named constants for the bootstrap SKUs,
 *                                referenced by the helpers above.
 */

import type { SubscriptionPlan } from '../stores/auth-store';

export const IAP_PRODUCTS = {
  monthly: 'com.vividrop.mobile.china.monthly.999',
  yearly: 'com.vividrop.mobile.china.yearly.10400',
  // Promotional yearly SKU — same backend `plan: 'yearly'` from the
  // receipt-verification side, but a cheaper price tier displayed alongside
  // the standard yearly so users can compare. Backend treats both yearly
  // SKUs identically; Apple-side billing handles the actual price/expiry.
  yearlyPromo: 'com.vividrop.mobile.china.yearly.9900',
} as const;

export type IapProductId = string;
export type IapPlanKey = keyof typeof IAP_PRODUCTS;

export const ALL_PRODUCT_IDS: readonly IapProductId[] =
  Object.values(IAP_PRODUCTS);

// Apple configures the 7-day free trial only on the monthly product.
export const TRIAL_ELIGIBLE_PRODUCTS: readonly IapProductId[] = [
  IAP_PRODUCTS.monthly,
];

export function planToProductId(
  plan: Exclude<SubscriptionPlan, ''>,
): IapProductId {
  // Backend `SubscriptionPlan` only distinguishes 'monthly' / 'yearly' tiers,
  // not individual SKUs. For the 'yearly' plan we return the standard SKU
  // as the canonical productId (used for the Restore label only — actual
  // purchase flow calls iapService.purchase(specificSkuId) directly).
  return IAP_PRODUCTS[plan];
}

export function productIdToPlan(
  productId: string,
): Exclude<SubscriptionPlan, ''> | null {
  if (productId === IAP_PRODUCTS.monthly) return 'monthly';
  if (productId === IAP_PRODUCTS.yearly) return 'yearly';
  if (productId === IAP_PRODUCTS.yearlyPromo) return 'yearly';
  return null;
}
