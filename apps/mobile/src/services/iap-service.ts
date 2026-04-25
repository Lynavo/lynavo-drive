import {
  initConnection,
  endConnection,
  purchaseUpdatedListener,
  purchaseErrorListener,
  requestSubscription,
  finishTransaction as rnFinishTransaction,
  getAvailablePurchases,
  getSubscriptions,
  getReceiptIOS,
  type Purchase,
  type PurchaseError,
} from 'react-native-iap';
import { Platform, type EmitterSubscription } from 'react-native';
import {
  type IapProductId,
  planToProductId,
  productIdToPlan,
  TRIAL_ELIGIBLE_PRODUCTS,
  ALL_PRODUCT_IDS,
} from '../constants/iap';
import { verifyIapReceipt } from './subscription-service';
import { ApiError, ERROR_CODE } from './api';
import { looksLikeUserDismiss } from './iap-errors';

const MAX_RESTORE_RECEIPTS = 10;
const PURCHASE_TIMEOUT_MS = 60_000;
const NON_FATAL_ERROR_GRACE_MS = PURCHASE_TIMEOUT_MS;
const ORPHAN_PURCHASE_RETRY_BACKOFF_MS = 60_000;
type RestorablePlan = NonNullable<ReturnType<typeof productIdToPlan>>;
type PendingPurchase = {
  resolve: (r: PurchaseReceipt) => void;
  reject: (err: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
  transientErrorTimeout: ReturnType<typeof setTimeout> | null;
};

// Apple's purchaseErrorListener may fire transient / interrupted errors
// even when the transaction ultimately succeeds (observed in sandbox as an
// early "unknown" error followed later by a successful update event). Only
// codes in this allowlist are treated as terminal for the pending Promise;
// anything else waits for the normal purchase timeout so a trailing
// purchaseUpdatedListener success can still resolve the pending Promise.
const FATAL_ERROR_CODES: ReadonlySet<string> = new Set([
  'E_USER_CANCELLED',
  'E_DEFERRED_PAYMENT',
  'E_ALREADY_OWNED',
  'E_ITEM_UNAVAILABLE',
  // Apple reports E_DEVELOPER_ERROR when the product ID isn't registered
  // / approved in App Store Connect. Not transient — no amount of waiting
  // will resolve it, so reject fast with a clear alert instead of
  // hanging the pending Promise until the 60 s timeout.
  'E_DEVELOPER_ERROR',
]);

export interface PurchaseReceipt {
  transactionReceipt: string;
  productId: IapProductId;
  transactionId: string;
}

export interface EligibilityResult {
  productId: IapProductId;
  eligibleForIntroOffer: boolean;
}

export type SubscriptionPeriodUnit = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';

/** Storefront-localized snapshot of one IAP product, sourced from StoreKit
 *  via react-native-iap. `displayPrice` is Apple-formatted for the user's
 *  current storefront — never persist it across launches, the storefront
 *  can change. Use `priceAmount` + `currency` for math (discount %, etc.). */
export interface IapProductSummary {
  productId: IapProductId;
  displayPrice: string;
  priceAmount: number;
  currency: string;
  periodUnit?: SubscriptionPeriodUnit;
  periodCount?: number;
  eligibleForIntroOffer: boolean;
}

export interface IapService {
  initialize(): Promise<void>;
  teardown(): Promise<void>;
  purchase(productId: IapProductId): Promise<PurchaseReceipt>;
  restore(): Promise<PurchaseReceipt[]>;
  finishTransaction(transactionId: string): Promise<void>;
  checkEligibility(): Promise<EligibilityResult[]>;
  /** Fetches the storefront-localized product catalog. Returns `[]` on any
   *  failure (network, StoreKit unavailable, sandbox not configured) — UI
   *  must render loading/error/empty rather than depend on hardcoded prices.
   *
   *  When `skus` is omitted the bootstrap `ALL_PRODUCT_IDS` list is used (kept
   *  for backward compatibility with the legacy `useStoreProducts` hook). The
   *  server-driven catalog flow passes the SKU list resolved from
   *  `/subscription/plans` so paywall content reflects ASC + the server's
   *  business decisions, not a frozen client constant. */
  getProductSummaries(
    skus?: readonly IapProductId[],
  ): Promise<IapProductSummary[]>;
  refreshReceipt(): Promise<string | null>;
  onOrphanPurchaseVerified(cb: () => void): () => void;
}

class IapServiceImpl implements IapService {
  private initialized = false;
  private initializePromise: Promise<void> | null = null;
  private teardownPromise: Promise<void> | null = null;
  private teardownRequested = false;
  private purchaseSub: EmitterSubscription | null = null;
  private errorSub: EmitterSubscription | null = null;
  private pendingPurchase = new Map<IapProductId, PendingPurchase>();
  private orphanListeners = new Set<() => void>();
  private orphanVerificationInFlight = new Set<string>();
  private orphanRetryAfter = new Map<string, number>();

  async initialize(): Promise<void> {
    while (true) {
      if (this.teardownPromise) {
        await this.teardownPromise;
        continue;
      }

      if (this.initialized) return;

      if (this.initializePromise) {
        const pendingInitialize = this.initializePromise;
        if (!this.teardownRequested) return pendingInitialize;
        await pendingInitialize;
        continue;
      }

      this.teardownRequested = false;
      this.initializePromise = this.initializeConnection();
      return this.initializePromise;
    }
  }

  async teardown(): Promise<void> {
    if (this.initializePromise && !this.initialized) {
      this.teardownRequested = true;
      await this.initializePromise;
      return;
    }
    if (this.teardownPromise) return this.teardownPromise;
    if (!this.initialized) return;
    this.teardownRequested = true;
    this.teardownPromise = this.teardownConnection();
    return this.teardownPromise;
  }

  private async teardownConnection(): Promise<void> {
    this.purchaseSub?.remove();
    this.errorSub?.remove();
    this.purchaseSub = null;
    this.errorSub = null;
    try {
      await endConnection();
    } finally {
      this.initialized = false;
      this.teardownPromise = null;
    }
  }

  private async initializeConnection(): Promise<void> {
    try {
      await initConnection();
      if (this.teardownRequested) {
        await endConnection().catch(() => {});
        return;
      }

      const purchaseSub = purchaseUpdatedListener(p => {
        void this.handlePurchaseEvent(p);
      });
      const errorSub = purchaseErrorListener(err => {
        this.handleErrorEvent(err);
      });

      if (this.teardownRequested) {
        purchaseSub.remove();
        errorSub.remove();
        await endConnection().catch(() => {});
        return;
      }

      this.purchaseSub = purchaseSub;
      this.errorSub = errorSub;
      this.initialized = true;
    } finally {
      this.initializePromise = null;
    }
  }

  async purchase(productId: IapProductId): Promise<PurchaseReceipt> {
    if (!this.initialized) {
      throw new Error(
        'iapService.initialize() must be called before purchase()',
      );
    }
    if (this.pendingPurchase.has(productId)) {
      throw new Error(`purchase already in flight for ${productId}`);
    }
    await this.ensureProductAvailable(productId);
    return new Promise<PurchaseReceipt>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const entry = this.pendingPurchase.get(productId);
        if (entry) this.clearPendingTimers(entry);
        reject(new Error('purchase timed out after 60s'));
        this.pendingPurchase.delete(productId);
      }, PURCHASE_TIMEOUT_MS);
      this.pendingPurchase.set(productId, {
        resolve,
        reject,
        timeout,
        transientErrorTimeout: null,
      });
      void Promise.resolve(requestSubscription({ sku: productId })).catch(
        err => {
          const entry = this.pendingPurchase.get(productId);
          if (!entry) return;
          this.clearPendingTimers(entry);
          this.pendingPurchase.delete(productId);
          reject(err);
        },
      );
    });
  }

  async restore(): Promise<PurchaseReceipt[]> {
    if (!this.initialized) {
      throw new Error(
        'iapService.initialize() must be called before restore()',
      );
    }
    const refreshedReceipt = await this.refreshReceiptForUserPurchase();
    let purchases: Purchase[];
    try {
      purchases = await getAvailablePurchases({
        automaticallyFinishRestoredTransactions: false,
        onlyIncludeActiveItems: true,
      });
    } catch (err) {
      console.warn(
        '[iap-service] native restore failed — trying refreshed app receipt',
        err,
      );
      if (!refreshedReceipt) {
        throw err;
      }
      const restored = await this.verifyRestoredPurchase(
        [refreshedReceipt],
        'monthly',
        '',
      );
      return restored ? [restored] : [];
    }
    const slice = purchases.slice(0, MAX_RESTORE_RECEIPTS);
    const out: PurchaseReceipt[] = [];

    for (const p of slice) {
      const plan = productIdToPlan(p.productId);
      if (!plan) continue;
      const txId = p.transactionId ?? '';
      const receiptCandidates = this.restoreReceiptCandidates(
        refreshedReceipt,
        p.transactionReceipt,
      );
      if (receiptCandidates.length === 0) continue;

      const restored = await this.verifyRestoredPurchase(
        receiptCandidates,
        plan,
        txId,
      );
      if (restored) {
        out.push(restored);
      }
    }
    return out;
  }
  async finishTransaction(transactionId: string): Promise<void> {
    // react-native-iap v12 accepts either a Purchase object or transactionId
    // via `purchase`; we keep a minimal stub shape it understands.
    await rnFinishTransaction({
      purchase: { transactionId } as Purchase,
      isConsumable: false,
    });
  }
  async checkEligibility(): Promise<EligibilityResult[]> {
    if (!this.initialized) return [];
    if (TRIAL_ELIGIBLE_PRODUCTS.length === 0) return [];
    try {
      // Query ALL product IDs — not just the trial-eligible ones — so iOS
      // StoreKit warms its SKProduct cache for every SKU we'll later pass to
      // requestSubscription. Without this, purchasing a SKU that was never
      // fetched fails with E_ITEM_UNAVAILABLE / E_DEVELOPER_ERROR.
      const products = await getSubscriptions({
        skus: [...ALL_PRODUCT_IDS],
      });
      return TRIAL_ELIGIBLE_PRODUCTS.map(productId => {
        const match = products.find(p => p.productId === productId);
        const eligible =
          match != null &&
          'introductoryPricePaymentModeIOS' in match &&
          match.introductoryPricePaymentModeIOS === 'FREETRIAL';
        return { productId, eligibleForIntroOffer: eligible };
      });
    } catch {
      // Eligibility query failure must not block UI — fall back to "not eligible"
      // so the non-trial copy is shown (never over-promise a free trial).
      return [];
    }
  }

  async getProductSummaries(
    skus?: readonly IapProductId[],
  ): Promise<IapProductSummary[]> {
    // Default to the bootstrap list so existing callers (and offline first
    // launch before the server catalog hydrates) still get *something*.
    const requestedSkus: readonly IapProductId[] = skus ?? ALL_PRODUCT_IDS;
    if (requestedSkus.length === 0) return [];
    try {
      const products = await getSubscriptions({ skus: [...requestedSkus] });
      const summaries: IapProductSummary[] = [];
      for (const productId of requestedSkus) {
        const match = products.find(p => p.productId === productId);
        if (!match) continue;
        // The react-native-iap `Subscription` union spans iOS / Android /
        // Amazon, but only the iOS variant exposes localizedPrice / currency.
        // This app ships iOS only, so cast through a structural shape that
        // covers the fields we need without depending on the platform-tagged
        // discriminator (which isn't always present in older SK1 builds).
        const ios = match as Partial<{
          price: string;
          localizedPrice: string;
          currency: string;
          subscriptionPeriodUnitIOS: SubscriptionPeriodUnit;
          subscriptionPeriodNumberIOS: string;
          introductoryPricePaymentModeIOS: string;
        }>;
        const priceRaw = ios.price ?? '';
        const priceAmount = Number.parseFloat(priceRaw);
        if (!Number.isFinite(priceAmount)) continue;
        const displayPrice = ios.localizedPrice ?? priceRaw;
        const currency = ios.currency ?? '';
        const periodUnit = ios.subscriptionPeriodUnitIOS;
        const periodCountRaw = ios.subscriptionPeriodNumberIOS;
        const periodCount = periodCountRaw
          ? Number.parseInt(periodCountRaw, 10)
          : undefined;
        const eligibleForIntroOffer =
          ios.introductoryPricePaymentModeIOS === 'FREETRIAL';
        summaries.push({
          productId,
          displayPrice,
          priceAmount,
          currency,
          periodUnit,
          periodCount:
            periodCount && Number.isFinite(periodCount)
              ? periodCount
              : undefined,
          eligibleForIntroOffer,
        });
      }
      return summaries;
    } catch (err) {
      console.warn('[iap-service] getProductSummaries failed', err);
      return [];
    }
  }

  async refreshReceipt(): Promise<string | null> {
    return this.refreshReceiptForUserPurchase();
  }

  onOrphanPurchaseVerified(cb: () => void): () => void {
    this.orphanListeners.add(cb);
    return () => this.orphanListeners.delete(cb);
  }

  private async ensureProductAvailable(productId: IapProductId): Promise<void> {
    const products = await getSubscriptions({ skus: [productId] });
    if (products.some(product => product.productId === productId)) {
      return;
    }

    throw {
      code: 'E_ITEM_UNAVAILABLE',
      productId,
      message: 'Subscription product is not available from StoreKit.',
    };
  }

  private async handlePurchaseEvent(p: Purchase): Promise<void> {
    const incomingProductId = p.productId as IapProductId;

    // 1. Exact match — happy path.
    const exact = this.pendingPurchase.get(incomingProductId);
    if (exact) {
      this.clearPendingTimers(exact);
      this.pendingPurchase.delete(incomingProductId);
      await this.resolvePendingPurchase(exact, incomingProductId, p);
      return;
    }

    // 2. Group-aware fallback: Apple may deliver an upgrade's SKPaymentTransaction
    // with the group-parent (e.g. previous monthly) SKU rather than the newly
    // requested yearly SKU. Because `purchase()` dedupes by productId and the
    // entire app uses a single subscription group, any in-flight pending entry
    // must correspond to the transaction we just received. Pick the most recent
    // pending entry (Map preserves insertion order) and resolve it with the
    // real receipt/transactionId so the server can verify against the truth.
    if (
      ALL_PRODUCT_IDS.includes(incomingProductId) &&
      this.pendingPurchase.size > 0
    ) {
      const keys = Array.from(this.pendingPurchase.keys());
      const fallbackKey = keys[keys.length - 1]!;
      const fallback = this.pendingPurchase.get(fallbackKey)!;
      this.clearPendingTimers(fallback);
      this.pendingPurchase.delete(fallbackKey);
      await this.resolvePendingPurchase(fallback, incomingProductId, p);
      return;
    }

    // 3. True orphan — redelivered or out-of-band transaction.
    await this.handleOrphanPurchase(p);
  }

  private async resolvePendingPurchase(
    pending: PendingPurchase,
    productId: IapProductId,
    purchase: Purchase,
  ): Promise<void> {
    try {
      const refreshedReceipt = await this.refreshReceiptForUserPurchase();
      const transactionReceipt =
        refreshedReceipt ?? purchase.transactionReceipt ?? '';
      if (!transactionReceipt) {
        throw new Error('purchase receipt is empty');
      }
      pending.resolve({
        // Reflect what the receipt actually reports; server resolves truth
        // from the receipt blob and the caller passes the user-selected plan.
        productId,
        transactionReceipt,
        transactionId: purchase.transactionId ?? '',
      });
    } catch (err) {
      pending.reject(err);
    }
  }

  private async refreshReceiptForUserPurchase(): Promise<string | null> {
    if (Platform.OS !== 'ios') return null;
    try {
      return (await getReceiptIOS({ forceRefresh: true })) ?? null;
    } catch (err) {
      console.warn(
        '[iap-service] receipt refresh failed — using transaction receipt',
        err,
      );
      return null;
    }
  }

  private restoreReceiptCandidates(
    refreshedReceipt: string | null,
    transactionReceipt: string | undefined,
  ): string[] {
    return Array.from(
      new Set(
        [refreshedReceipt, transactionReceipt].filter(
          (receipt): receipt is string =>
            typeof receipt === 'string' && receipt.length > 0,
        ),
      ),
    );
  }

  private restorePlanCandidates(plan: RestorablePlan): RestorablePlan[] {
    return plan === 'monthly' ? ['monthly', 'yearly'] : ['yearly', 'monthly'];
  }

  private async verifyRestoredPurchase(
    receiptCandidates: string[],
    initialPlan: RestorablePlan,
    transactionId: string,
  ): Promise<PurchaseReceipt | null> {
    for (const receipt of receiptCandidates) {
      for (const plan of this.restorePlanCandidates(initialPlan)) {
        try {
          await verifyIapReceipt(receipt, plan);
          if (transactionId) {
            await this.finishTransaction(transactionId).catch(() => {});
          }
          return {
            productId: planToProductId(plan),
            transactionReceipt: receipt,
            transactionId,
          };
        } catch (err) {
          if (err instanceof ApiError) {
            if (err.code === ERROR_CODE.RECEIPT_ALREADY_USED) {
              if (transactionId) {
                await this.finishTransaction(transactionId).catch(() => {});
              }
              return {
                productId: planToProductId(plan),
                transactionReceipt: receipt,
                transactionId,
              };
            }
            if (err.code === ERROR_CODE.PRODUCT_ID_MISMATCH) {
              continue;
            }
            if (err.code === ERROR_CODE.RECEIPT_BOUND_TO_OTHER_USER) {
              throw err;
            }
          }
          // Other errors: try the next receipt candidate if available, but do
          // not finish this transaction unless verification definitely passed.
          break;
        }
      }
    }
    return null;
  }

  private handleErrorEvent(err: PurchaseError): void {
    const code = err.code != null ? String(err.code) : '';
    const dismissLike = looksLikeUserDismiss(err);
    if (!FATAL_ERROR_CODES.has(code) && !dismissLike) {
      // Transient Apple signal (e.g. sandbox often emits an unknown/
      // interrupted error before the successful update event). Give
      // purchaseUpdatedListener a short chance to resolve it, then reject
      // with the original StoreKit error instead of making the user wait
      // for the 60s safety timeout.
      const pendingPair = this.pendingPurchaseForError(err.productId);
      if (!pendingPair) {
        console.warn('[iap-service] non-fatal error event — ignoring', err);
        return;
      }
      const [productId, pending] = pendingPair;
      if (pending.transientErrorTimeout) {
        clearTimeout(pending.transientErrorTimeout);
      }
      pending.transientErrorTimeout = setTimeout(() => {
        if (this.pendingPurchase.get(productId) !== pending) return;
        this.clearPendingTimers(pending);
        this.pendingPurchase.delete(productId);
        pending.reject(err);
      }, NON_FATAL_ERROR_GRACE_MS);
      console.warn(
        '[iap-service] non-fatal error event — waiting for purchase update',
        err,
      );
      return;
    }
    // Dismiss-like fall-through: Apple sandbox reports payment-sheet
    // dismissals as ASDErrorDomain 907 → RN-IAP code `E_UNKNOWN`. Those are
    // terminal (no success event will follow), so we must fast-reject here
    // — otherwise the UI button sits in loading state for the full 60s
    // grace window. FATAL_ERROR_CODES still drives the primary path; this
    // branch only catches the dismissal variants the numeric code alone
    // cannot identify.
    const pendingPair = this.pendingPurchaseForError(err.productId);
    if (!pendingPair) return;
    const [productId, pending] = pendingPair;
    this.clearPendingTimers(pending);
    this.pendingPurchase.delete(productId);
    pending.reject(err);
  }

  private pendingPurchaseForError(
    productId: string | undefined,
  ): [IapProductId, PendingPurchase] | null {
    const typedProductId = productId as IapProductId | undefined;
    if (typedProductId) {
      const pending = this.pendingPurchase.get(typedProductId);
      if (pending) return [typedProductId, pending];
    }
    if (this.pendingPurchase.size === 1) {
      return Array.from(this.pendingPurchase.entries())[0] ?? null;
    }
    return null;
  }

  private clearPendingTimers(pending: PendingPurchase): void {
    clearTimeout(pending.timeout);
    if (pending.transientErrorTimeout) {
      clearTimeout(pending.transientErrorTimeout);
      pending.transientErrorTimeout = null;
    }
  }

  private async handleOrphanPurchase(p: Purchase): Promise<void> {
    const productId = p.productId;
    const txId = p.transactionId ?? '';
    const plan = productIdToPlan(productId);
    if (!plan) {
      // Unknown product — finish to unjam the queue but do not notify.
      await this.finishTransaction(txId).catch(() => {});
      return;
    }
    const orphanKey = this.orphanPurchaseKey(p);
    if (this.orphanVerificationInFlight.has(orphanKey)) {
      return;
    }
    const retryAfter = this.orphanRetryAfter.get(orphanKey);
    if (retryAfter != null && Date.now() < retryAfter) {
      return;
    }

    this.orphanVerificationInFlight.add(orphanKey);
    try {
      await verifyIapReceipt(p.transactionReceipt, plan);
      await this.finishTransaction(txId).catch(() => {});
      this.orphanRetryAfter.delete(orphanKey);
      this.orphanListeners.forEach(cb => cb());
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === ERROR_CODE.RECEIPT_ALREADY_USED) {
          await this.finishTransaction(txId).catch(() => {});
          this.orphanRetryAfter.delete(orphanKey);
          this.orphanListeners.forEach(cb => cb());
          return;
        }
        if (err.code === ERROR_CODE.PRODUCT_ID_MISMATCH) {
          await this.finishTransaction(txId).catch(() => {});
          this.orphanRetryAfter.delete(orphanKey);
          return;
        }
      }
      // Network / 5xx / 2001 — leave the transaction unfinished so Apple
      // redelivers it later, but throttle same-transaction repeats so login
      // cannot get flooded by StoreKit redelivery loops.
      this.orphanRetryAfter.set(
        orphanKey,
        Date.now() + ORPHAN_PURCHASE_RETRY_BACKOFF_MS,
      );
    } finally {
      this.orphanVerificationInFlight.delete(orphanKey);
    }
  }

  private orphanPurchaseKey(p: Purchase): string {
    if (p.transactionId) return `tx:${p.transactionId}`;
    const receipt =
      typeof p.transactionReceipt === 'string' ? p.transactionReceipt : '';
    return `receipt:${p.productId}:${receipt.slice(0, 64)}`;
  }
}

export const iapService: IapService = new IapServiceImpl();
