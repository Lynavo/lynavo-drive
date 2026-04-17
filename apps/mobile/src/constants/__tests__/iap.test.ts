import {
  IAP_PRODUCTS,
  ALL_PRODUCT_IDS,
  TRIAL_ELIGIBLE_PRODUCTS,
  planToProductId,
  productIdToPlan,
} from '../iap';

describe('constants/iap', () => {
  test('IAP_PRODUCTS has monthly and yearly with expected IDs', () => {
    expect(IAP_PRODUCTS.monthly).toBe('com.vividrop.mobile.china.monthly.999');
    expect(IAP_PRODUCTS.yearly).toBe('com.vividrop.mobile.china.yearly.104');
  });

  test('ALL_PRODUCT_IDS contains both products', () => {
    expect(ALL_PRODUCT_IDS).toEqual(
      expect.arrayContaining([IAP_PRODUCTS.monthly, IAP_PRODUCTS.yearly]),
    );
    expect(ALL_PRODUCT_IDS).toHaveLength(2);
  });

  test('TRIAL_ELIGIBLE_PRODUCTS only contains monthly', () => {
    expect(TRIAL_ELIGIBLE_PRODUCTS).toEqual([IAP_PRODUCTS.monthly]);
  });

  test('planToProductId maps both plans', () => {
    expect(planToProductId('monthly')).toBe(IAP_PRODUCTS.monthly);
    expect(planToProductId('yearly')).toBe(IAP_PRODUCTS.yearly);
  });

  test('productIdToPlan inverts for valid IDs', () => {
    expect(productIdToPlan(IAP_PRODUCTS.monthly)).toBe('monthly');
    expect(productIdToPlan(IAP_PRODUCTS.yearly)).toBe('yearly');
  });

  test('productIdToPlan returns null for unknown ID', () => {
    expect(productIdToPlan('com.other.product')).toBeNull();
    expect(productIdToPlan('')).toBeNull();
  });
});
