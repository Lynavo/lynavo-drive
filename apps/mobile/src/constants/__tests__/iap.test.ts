jest.mock('../../markets', () => ({
  activeMarket: 'cn',
  isGlobalMarket: () => false,
  isChinaMarket: () => true,
}));

import {
  IAP_PRODUCTS,
  ALL_PRODUCT_IDS,
  TRIAL_ELIGIBLE_PRODUCTS,
  planToProductId,
  productIdToPlan,
} from '../iap';

describe('constants/iap', () => {
  test('IAP_PRODUCTS has monthly, yearly, and yearlyPromo with expected IDs', () => {
    expect(IAP_PRODUCTS.monthly).toBe('com.vividrop.mobile.china.monthly.999');
    expect(IAP_PRODUCTS.yearly).toBe('com.vividrop.mobile.china.yearly.10400');
    expect(IAP_PRODUCTS.yearlyPromo).toBe(
      'com.vividrop.mobile.china.yearly.9900',
    );
  });

  test('ALL_PRODUCT_IDS contains all three products', () => {
    expect(ALL_PRODUCT_IDS).toEqual(
      expect.arrayContaining([
        IAP_PRODUCTS.monthly,
        IAP_PRODUCTS.yearly,
        IAP_PRODUCTS.yearlyPromo,
      ]),
    );
    expect(ALL_PRODUCT_IDS).toHaveLength(3);
  });

  test('TRIAL_ELIGIBLE_PRODUCTS only contains monthly', () => {
    expect(TRIAL_ELIGIBLE_PRODUCTS).toEqual([IAP_PRODUCTS.monthly]);
  });

  test('planToProductId maps tier plans to canonical SKU', () => {
    expect(planToProductId('monthly')).toBe(IAP_PRODUCTS.monthly);
    // 'yearly' tier → standard yearly SKU (canonical for restore labelling);
    // the promo SKU is reached via direct iapService.purchase(IAP_PRODUCTS.yearlyPromo).
    expect(planToProductId('yearly')).toBe(IAP_PRODUCTS.yearly);
  });

  test('productIdToPlan inverts for valid IDs; both yearly SKUs map to yearly tier', () => {
    expect(productIdToPlan(IAP_PRODUCTS.monthly)).toBe('monthly');
    expect(productIdToPlan(IAP_PRODUCTS.yearly)).toBe('yearly');
    expect(productIdToPlan(IAP_PRODUCTS.yearlyPromo)).toBe('yearly');
  });

  test('productIdToPlan returns null for unknown ID', () => {
    expect(productIdToPlan('com.other.product')).toBeNull();
    expect(productIdToPlan('')).toBeNull();
  });
});
