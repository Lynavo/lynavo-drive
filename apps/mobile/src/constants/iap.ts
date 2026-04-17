import type { SubscriptionPlan } from '../stores/auth-store';

export const IAP_PRODUCTS = {
  monthly: 'com.vividrop.mobile.china.monthly.999',
  yearly: 'com.vividrop.mobile.china.yearly.104',
} as const;

export type IapProductId = (typeof IAP_PRODUCTS)[keyof typeof IAP_PRODUCTS];

export const ALL_PRODUCT_IDS: readonly IapProductId[] = Object.values(IAP_PRODUCTS);

// Apple configures the 7-day free trial only on the monthly product.
export const TRIAL_ELIGIBLE_PRODUCTS: readonly IapProductId[] = [IAP_PRODUCTS.monthly];

export function planToProductId(
  plan: Exclude<SubscriptionPlan, ''>,
): IapProductId {
  return IAP_PRODUCTS[plan];
}

export function productIdToPlan(
  productId: string,
): Exclude<SubscriptionPlan, ''> | null {
  if (productId === IAP_PRODUCTS.monthly) return 'monthly';
  if (productId === IAP_PRODUCTS.yearly) return 'yearly';
  return null;
}
