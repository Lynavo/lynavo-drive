import { renderHook, waitFor } from '@testing-library/react-native';
import { useStoreProducts } from '../useStoreProducts';
import { iapService } from '../../services/iap-service';

jest.mock('../../services/iap-service', () => ({
  iapService: {
    getProductSummaries: jest.fn(),
  },
}));

jest.mock('../../constants/features', () => ({
  FEATURES: { IAP_ENABLED: true },
}));

const formatPrice = (amount: number, currency: string): string =>
  `${currency}${amount.toFixed(2)}`;
const formatSavings = (savings: string): string => `Save ${savings}`;

const monthlySummary = {
  productId: 'com.vividrop.mobile.china.monthly.999' as const,
  displayPrice: '¥9.90',
  priceAmount: 9.9,
  currency: 'CNY',
  periodUnit: 'MONTH' as const,
  periodCount: 1,
  eligibleForIntroOffer: true,
};

const yearlySummary = {
  productId: 'com.vividrop.mobile.china.yearly.10400' as const,
  displayPrice: '¥104.00',
  priceAmount: 104,
  currency: 'CNY',
  periodUnit: 'YEAR' as const,
  periodCount: 1,
  eligibleForIntroOffer: false,
};

describe('useStoreProducts', () => {
  beforeEach(() => jest.clearAllMocks());

  test('exposes monthly + yearly summaries when StoreKit returns both', async () => {
    (iapService.getProductSummaries as jest.Mock).mockResolvedValue([
      monthlySummary,
      yearlySummary,
    ]);

    const { result } = renderHook(() =>
      useStoreProducts({ formatPrice, formatSavings }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.monthly).toEqual(monthlySummary);
    expect(result.current.yearly).toEqual(yearlySummary);
  });

  test('computes yearly savings vs monthly × 12', async () => {
    (iapService.getProductSummaries as jest.Mock).mockResolvedValue([
      monthlySummary,
      yearlySummary,
    ]);

    const { result } = renderHook(() =>
      useStoreProducts({ formatPrice, formatSavings }),
    );

    await waitFor(() => expect(result.current.yearlySavings).not.toBeNull());
    // monthly × 12 = 118.80, yearly = 104.00, saved = 14.80,
    // percent = round(14.80 / 118.80 * 100) = 12
    expect(result.current.yearlySavings).toEqual({
      display: 'Save CNY14.80',
      percent: 12,
      annualizedMonthlyDisplay: 'CNY118.80',
    });
  });

  test('returns null savings when yearly is not actually cheaper', async () => {
    (iapService.getProductSummaries as jest.Mock).mockResolvedValue([
      monthlySummary,
      { ...yearlySummary, priceAmount: 200 },
    ]);

    const { result } = renderHook(() =>
      useStoreProducts({ formatPrice, formatSavings }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.yearlySavings).toBeNull();
  });

  test('returns null savings when currencies mismatch (storefront edge case)', async () => {
    (iapService.getProductSummaries as jest.Mock).mockResolvedValue([
      monthlySummary,
      { ...yearlySummary, currency: 'USD' },
    ]);

    const { result } = renderHook(() =>
      useStoreProducts({ formatPrice, formatSavings }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.yearlySavings).toBeNull();
  });

  test('reports STOREKIT_EMPTY when products array is empty', async () => {
    (iapService.getProductSummaries as jest.Mock).mockResolvedValue([]);

    const { result } = renderHook(() =>
      useStoreProducts({ formatPrice, formatSavings }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('STOREKIT_EMPTY');
    expect(result.current.monthly).toBeNull();
    expect(result.current.yearly).toBeNull();
  });

  test('skips StoreKit and reports loading=false when enabled=false', async () => {
    const { result } = renderHook(() =>
      useStoreProducts({ formatPrice, formatSavings, enabled: false }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(iapService.getProductSummaries).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
    expect(result.current.monthly).toBeNull();
    expect(result.current.yearly).toBeNull();
  });

  test('captures error message when getProductSummaries throws', async () => {
    (iapService.getProductSummaries as jest.Mock).mockRejectedValue(
      new Error('boom'),
    );

    const { result } = renderHook(() =>
      useStoreProducts({ formatPrice, formatSavings }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('boom');
    expect(result.current.monthly).toBeNull();
  });
});
