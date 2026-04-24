import { useCallback, useEffect, useMemo, useState } from 'react';
import { iapService, type IapProductSummary } from '../services/iap-service';
import { IAP_PRODUCTS } from '../constants/iap';
import { FEATURES } from '../constants/features';

export interface YearlySavings {
  display: string;
  percent: number;
  annualizedMonthlyDisplay: string;
}

export interface UseStoreProductsResult {
  loading: boolean;
  error: string | null;
  monthly: IapProductSummary | null;
  yearly: IapProductSummary | null;
  yearlySavings: YearlySavings | null;
  refresh: () => Promise<void>;
}

export interface UseStoreProductsArgs {
  formatPrice: (amount: number, currency: string) => string;
  formatSavings: (savingsDisplay: string) => string;
  enabled?: boolean;
}

function computeSavings(
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

export function useStoreProducts({
  formatPrice,
  formatSavings,
  enabled = FEATURES.IAP_ENABLED,
}: UseStoreProductsArgs): UseStoreProductsResult {
  const [products, setProducts] = useState<IapProductSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setProducts([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const fetched = await iapService.getProductSummaries();
      setProducts(fetched);
      if (fetched.length === 0) {
        setError('STOREKIT_EMPTY');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const monthly = useMemo(
    () => products.find(p => p.productId === IAP_PRODUCTS.monthly) ?? null,
    [products],
  );
  const yearly = useMemo(
    () => products.find(p => p.productId === IAP_PRODUCTS.yearly) ?? null,
    [products],
  );
  const yearlySavings = useMemo(
    () =>
      monthly && yearly
        ? computeSavings(monthly, yearly, formatPrice, formatSavings)
        : null,
    [monthly, yearly, formatPrice, formatSavings],
  );

  return { loading, error, monthly, yearly, yearlySavings, refresh };
}
