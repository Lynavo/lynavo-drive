// Mock native modules pulled in transitively by api.ts → auth-store
jest.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));
jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
  resetGenericPassword: jest.fn(),
}));
jest.mock('../../stores/auth-store', () => ({
  getAccessToken: jest.fn(() => null),
  getRefreshToken: jest.fn(() => null),
}));

import {
  initConnection,
  endConnection,
  purchaseUpdatedListener,
  purchaseErrorListener,
  clearTransactionIOS,
} from 'react-native-iap';

jest.mock('react-native-iap', () => ({
  initConnection: jest.fn().mockResolvedValue(true),
  endConnection: jest.fn().mockResolvedValue(undefined),
  purchaseUpdatedListener: jest.fn(() => ({ remove: jest.fn() })),
  purchaseErrorListener: jest.fn(() => ({ remove: jest.fn() })),
  getAvailablePurchases: jest.fn().mockResolvedValue([]),
  getSubscriptions: jest.fn().mockResolvedValue([]),
  getReceiptIOS: jest.fn().mockResolvedValue(null),
  clearTransactionIOS: jest.fn().mockResolvedValue(undefined),
  requestSubscription: jest.fn(),
  finishTransaction: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../subscription-service', () => ({
  verifyIapReceipt: jest.fn().mockResolvedValue(undefined),
  getSubscriptionStatus: jest.fn(),
}));

const mockGetSubscriptionProductPlans = jest.fn();
const mockResolveSubscriptionProductPlan = jest.fn();
jest.mock('../subscription-plans-service', () => ({
  getSubscriptionProductPlans: (...args: unknown[]) =>
    mockGetSubscriptionProductPlans(...args),
  resolveSubscriptionProductPlan: (...args: unknown[]) =>
    mockResolveSubscriptionProductPlan(...args),
}));

import { iapService } from '../iap-service';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('iapService — lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await iapService.teardown();
  });

  test('initialize() calls initConnection and mounts listeners', async () => {
    await iapService.initialize();

    expect(initConnection).toHaveBeenCalledTimes(1);
    expect(purchaseUpdatedListener).toHaveBeenCalledTimes(1);
    expect(purchaseErrorListener).toHaveBeenCalledTimes(1);
  });

  test('initialize() is idempotent — second call is a no-op', async () => {
    await iapService.initialize();
    await iapService.initialize();

    expect(initConnection).toHaveBeenCalledTimes(1);
    expect(purchaseUpdatedListener).toHaveBeenCalledTimes(1);
  });

  test('initialize() coalesces concurrent calls while initConnection is pending', async () => {
    const init = deferred<boolean>();
    (initConnection as jest.Mock).mockReturnValueOnce(init.promise);

    const first = iapService.initialize();
    const second = iapService.initialize();

    expect(initConnection).toHaveBeenCalledTimes(1);
    init.resolve(true);
    await Promise.all([first, second]);

    expect(purchaseUpdatedListener).toHaveBeenCalledTimes(1);
    expect(purchaseErrorListener).toHaveBeenCalledTimes(1);
  });

  test('teardown() during pending initialize closes the native connection without mounting listeners', async () => {
    const init = deferred<boolean>();
    (initConnection as jest.Mock).mockReturnValueOnce(init.promise);

    const initializing = iapService.initialize();
    const tearingDown = iapService.teardown();

    init.resolve(true);
    await Promise.all([initializing, tearingDown]);

    expect(purchaseUpdatedListener).not.toHaveBeenCalled();
    expect(purchaseErrorListener).not.toHaveBeenCalled();
    expect(endConnection).toHaveBeenCalledTimes(1);
  });

  test('initialize() after teardown during pending initialize starts a fresh listener', async () => {
    const init = deferred<boolean>();
    (initConnection as jest.Mock).mockReturnValueOnce(init.promise);

    const firstInitialize = iapService.initialize();
    const tearingDown = iapService.teardown();
    const secondInitialize = iapService.initialize();

    init.resolve(true);
    await Promise.all([firstInitialize, tearingDown, secondInitialize]);

    expect(initConnection).toHaveBeenCalledTimes(2);
    expect(endConnection).toHaveBeenCalledTimes(1);
    expect(purchaseUpdatedListener).toHaveBeenCalledTimes(1);
    expect(purchaseErrorListener).toHaveBeenCalledTimes(1);
  });

  test('initialize() during active teardown waits and reconnects', async () => {
    const end = deferred<void>();
    (endConnection as jest.Mock).mockReturnValueOnce(end.promise);

    await iapService.initialize();
    const tearingDown = iapService.teardown();
    const secondInitialize = iapService.initialize();

    end.resolve();
    await Promise.all([tearingDown, secondInitialize]);

    expect(initConnection).toHaveBeenCalledTimes(2);
    expect(endConnection).toHaveBeenCalledTimes(1);
    expect(purchaseUpdatedListener).toHaveBeenCalledTimes(2);
    expect(purchaseErrorListener).toHaveBeenCalledTimes(2);
  });

  test('teardown() removes listeners and ends connection', async () => {
    const removeMock = jest.fn();
    (purchaseUpdatedListener as jest.Mock).mockReturnValue({
      remove: removeMock,
    });
    (purchaseErrorListener as jest.Mock).mockReturnValue({
      remove: removeMock,
    });

    await iapService.initialize();
    await iapService.teardown();

    expect(removeMock).toHaveBeenCalledTimes(2);
    expect(endConnection).toHaveBeenCalledTimes(1);
  });

  test('teardown() without initialize() is a no-op', async () => {
    await iapService.teardown();
    expect(endConnection).not.toHaveBeenCalled();
  });
});

import { getReceiptIOS, requestSubscription } from 'react-native-iap';
import { ALL_PRODUCT_IDS, IAP_PRODUCTS } from '../../constants/iap';

const bootstrapProductPlans = [
  { productId: IAP_PRODUCTS.monthly, plan: 'monthly' as const },
  { productId: IAP_PRODUCTS.yearlyPromo, plan: 'yearly' as const },
  { productId: IAP_PRODUCTS.yearly, plan: 'yearly' as const },
];
const adminMonthlySku = 'admin.catalog.alpha';

function mockDefaultCatalogPlanResolvers(): void {
  mockGetSubscriptionProductPlans.mockResolvedValue(bootstrapProductPlans);
  mockResolveSubscriptionProductPlan.mockImplementation((productId: string) =>
    Promise.resolve(
      bootstrapProductPlans.find(entry => entry.productId === productId)
        ?.plan ?? null,
    ),
  );
}

describe('iapService — purchase', () => {
  let updatedCb: ((p: any) => void) | null = null;
  let errorCb: ((e: any) => void) | null = null;

  const flushPurchasePreflight = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockDefaultCatalogPlanResolvers();
    (getSubscriptions as jest.Mock).mockImplementation(({ skus }) =>
      Promise.resolve(skus.map((productId: string) => ({ productId }))),
    );
    (purchaseUpdatedListener as jest.Mock).mockImplementation(cb => {
      updatedCb = cb;
      return { remove: jest.fn() };
    });
    (purchaseErrorListener as jest.Mock).mockImplementation(cb => {
      errorCb = cb;
      return { remove: jest.fn() };
    });
    await iapService.initialize();
  });

  afterEach(async () => {
    await iapService.teardown();
    updatedCb = null;
    errorCb = null;
    jest.useRealTimers();
  });

  test('resolves with PurchaseReceipt when matching event arrives', async () => {
    const pending = iapService.purchase(IAP_PRODUCTS.monthly);
    await flushPurchasePreflight();
    expect(requestSubscription).toHaveBeenCalledWith({
      sku: IAP_PRODUCTS.monthly,
    });

    // Simulate Apple pushing a purchase event.
    updatedCb?.({
      productId: IAP_PRODUCTS.monthly,
      transactionReceipt: 'BASE64BLOB',
      transactionId: 'tx_1',
    });

    const receipt = await pending;
    expect(receipt).toEqual({
      productId: IAP_PRODUCTS.monthly,
      transactionReceipt: 'BASE64BLOB',
      transactionId: 'tx_1',
    });
  });

  test('does not force-refresh the iOS receipt when the purchase event has one', async () => {
    (getReceiptIOS as jest.Mock).mockResolvedValueOnce('FRESH_RECEIPT_BLOB');

    const pending = iapService.purchase(IAP_PRODUCTS.monthly);
    await flushPurchasePreflight();

    updatedCb?.({
      productId: IAP_PRODUCTS.monthly,
      transactionReceipt: 'BASE64BLOB',
      transactionId: 'tx_fresh',
    });

    const receipt = await pending;
    expect(getReceiptIOS).not.toHaveBeenCalled();
    expect(receipt).toEqual({
      productId: IAP_PRODUCTS.monthly,
      transactionReceipt: 'BASE64BLOB',
      transactionId: 'tx_fresh',
    });
  });

  test('falls back to a refreshed iOS receipt when the purchase event receipt is empty', async () => {
    (getReceiptIOS as jest.Mock).mockResolvedValueOnce('FRESH_RECEIPT_BLOB');

    const pending = iapService.purchase(IAP_PRODUCTS.monthly);
    await flushPurchasePreflight();

    updatedCb?.({
      productId: IAP_PRODUCTS.monthly,
      transactionReceipt: '',
      transactionId: 'tx_empty_receipt',
    });

    const receipt = await pending;
    expect(getReceiptIOS).toHaveBeenCalledWith({ forceRefresh: true });
    expect(receipt).toEqual({
      productId: IAP_PRODUCTS.monthly,
      transactionReceipt: 'FRESH_RECEIPT_BLOB',
      transactionId: 'tx_empty_receipt',
    });
  });

  test('rejects when error listener fires with the pending productId', async () => {
    const pending = iapService.purchase(IAP_PRODUCTS.yearly);
    await flushPurchasePreflight();
    errorCb?.({ code: 'E_USER_CANCELLED', productId: IAP_PRODUCTS.yearly });

    await expect(pending).rejects.toMatchObject({ code: 'E_USER_CANCELLED' });
  });

  test('times out after 60s when no event arrives', async () => {
    jest.useFakeTimers();
    const pending = iapService.purchase(IAP_PRODUCTS.monthly);
    await flushPurchasePreflight();

    jest.advanceTimersByTime(60_000);

    await expect(pending).rejects.toThrow(/timed out/i);
    jest.useRealTimers();
  });

  test('resolves pending yearly when Apple delivers event with monthly (group-parent) productId', async () => {
    // Repro of Blocker 1: user already on monthly upgrades to yearly. Apple
    // delivers the SKPaymentTransaction with productId = old monthly SKU.
    // The pending yearly Promise must resolve with the real receipt blob.
    const pending = iapService.purchase(IAP_PRODUCTS.yearly);
    await flushPurchasePreflight();
    expect(requestSubscription).toHaveBeenCalledWith({
      sku: IAP_PRODUCTS.yearly,
    });

    updatedCb?.({
      productId: IAP_PRODUCTS.monthly, // group-parent delivery
      transactionReceipt: 'YEARLY_RECEIPT_BLOB',
      transactionId: 'tx_yearly_upgrade',
    });

    const receipt = await pending;
    expect(receipt.transactionReceipt).toBe('YEARLY_RECEIPT_BLOB');
    expect(receipt.transactionId).toBe('tx_yearly_upgrade');
  });

  test('returns transaction receipt for monthly → yearly group-parent delivery', async () => {
    (getReceiptIOS as jest.Mock).mockResolvedValueOnce('FRESH_YEARLY_RECEIPT');

    const pending = iapService.purchase(IAP_PRODUCTS.yearly);
    await flushPurchasePreflight();

    updatedCb?.({
      productId: IAP_PRODUCTS.monthly,
      transactionReceipt: 'STALE_MONTHLY_RECEIPT',
      transactionId: 'tx_yearly_upgrade_fresh',
    });

    const receipt = await pending;
    expect(getReceiptIOS).not.toHaveBeenCalled();
    expect(receipt).toEqual({
      productId: IAP_PRODUCTS.monthly,
      transactionReceipt: 'STALE_MONTHLY_RECEIPT',
      transactionId: 'tx_yearly_upgrade_fresh',
    });
  });

  test('event for a productId without a pending Deferred is an orphan (not rejected)', async () => {
    // No purchase() called — event comes in "cold".
    expect(() =>
      updatedCb?.({
        productId: IAP_PRODUCTS.monthly,
        transactionReceipt: 'BLOB',
        transactionId: 'tx_orphan',
      }),
    ).not.toThrow();
  });

  test('ignores non-fatal error codes so a trailing success event still resolves pending', async () => {
    // Repro of sandbox flake: Apple fires purchaseErrorListener with a
    // non-fatal code BEFORE the real success event. Old behavior rejected
    // the pending Promise → SubscriptionScreen showed a fake "付款失敗"
    // alert despite Apple having actually processed the purchase. Fix
    // treats only codes in FATAL_ERROR_CODES as terminal.
    const pending = iapService.purchase(IAP_PRODUCTS.monthly);
    await flushPurchasePreflight();

    // Apple's flaky early error — not in the FATAL allowlist.
    errorCb?.({ code: 'E_UNKNOWN', productId: IAP_PRODUCTS.monthly });

    // Real success event arrives moments later.
    updatedCb?.({
      productId: IAP_PRODUCTS.monthly,
      transactionReceipt: 'BLOB_LATE',
      transactionId: 'tx_late',
    });

    const receipt = await pending;
    expect(receipt.transactionReceipt).toBe('BLOB_LATE');
    expect(receipt.transactionId).toBe('tx_late');
  });

  test('keeps waiting after non-fatal error until the purchase timeout', async () => {
    jest.useFakeTimers();
    const pending = iapService.purchase(IAP_PRODUCTS.monthly);
    await flushPurchasePreflight();

    errorCb?.({ code: 'E_UNKNOWN', productId: IAP_PRODUCTS.monthly });
    jest.advanceTimersByTime(59_000);

    updatedCb?.({
      productId: IAP_PRODUCTS.monthly,
      transactionReceipt: 'BLOB_AFTER_LONG_STOREKIT_DELAY',
      transactionId: 'tx_after_long_storekit_delay',
    });

    await expect(pending).resolves.toMatchObject({
      transactionReceipt: 'BLOB_AFTER_LONG_STOREKIT_DELAY',
      transactionId: 'tx_after_long_storekit_delay',
    });
  });

  test('times out after non-fatal error when no purchase update arrives', async () => {
    jest.useFakeTimers();
    const pending = iapService.purchase(IAP_PRODUCTS.monthly);
    await flushPurchasePreflight();

    errorCb?.({ code: 'E_UNKNOWN', productId: IAP_PRODUCTS.monthly });
    jest.advanceTimersByTime(60_000);

    await expect(pending).rejects.toThrow(/timed out/i);
  });

  test('fatal E_ITEM_UNAVAILABLE code still rejects pending (regression guard)', async () => {
    const pending = iapService.purchase(IAP_PRODUCTS.yearly);
    await flushPurchasePreflight();
    errorCb?.({ code: 'E_ITEM_UNAVAILABLE', productId: IAP_PRODUCTS.yearly });
    await expect(pending).rejects.toMatchObject({ code: 'E_ITEM_UNAVAILABLE' });
  });

  test('dismissal-like E_UNKNOWN (sandbox 907) rejects immediately, not after 60s', async () => {
    // Repro of the "订阅按钮永远 loading" bug: Apple sandbox reports
    // payment-sheet dismissals as ASDErrorDomain 907, which RN-IAP
    // surfaces as `E_UNKNOWN` with message "Payment Sheet Failed".
    // Before the fix this fell into the 60s transient-grace window →
    // SubscriptionScreen's `isLoading` sat spinning for a full minute
    // before the promise rejected. The fix must reject right away.
    jest.useFakeTimers();
    const pending = iapService.purchase(IAP_PRODUCTS.yearly);
    await flushPurchasePreflight();

    errorCb?.({
      code: 'E_UNKNOWN',
      productId: IAP_PRODUCTS.yearly,
      message: 'Payment Sheet Failed',
      debugMessage:
        'Payment sheet dismissed with neither an error nor a result',
    });

    // No timer advance — rejection must come on the current microtask.
    await expect(pending).rejects.toMatchObject({ code: 'E_UNKNOWN' });
    jest.useRealTimers();
  });
});

import { finishTransaction as finishTxMock } from 'react-native-iap';
import { verifyIapReceipt } from '../subscription-service';
import { ApiError, ERROR_CODE } from '../api';

describe('iapService — orphan recovery', () => {
  let updatedCb: ((p: any) => void) | null = null;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockDefaultCatalogPlanResolvers();
    (purchaseUpdatedListener as jest.Mock).mockImplementation(cb => {
      updatedCb = cb;
      return { remove: jest.fn() };
    });
    (purchaseErrorListener as jest.Mock).mockImplementation(() => ({
      remove: jest.fn(),
    }));
    await iapService.initialize();
  });

  afterEach(async () => {
    await iapService.teardown();
    updatedCb = null;
  });

  test('orphan verify success → finishTransaction called, listeners notified', async () => {
    (verifyIapReceipt as jest.Mock).mockResolvedValueOnce(undefined);
    const listener = jest.fn();
    iapService.onOrphanPurchaseVerified(listener);

    updatedCb?.({
      productId: IAP_PRODUCTS.monthly,
      transactionReceipt: 'BLOB',
      transactionId: 'tx_orphan_1',
    });

    await new Promise<void>(r => setImmediate(r));

    expect(verifyIapReceipt).toHaveBeenCalledWith(
      'BLOB',
      'monthly',
      IAP_PRODUCTS.monthly,
      'tx_orphan_1',
    );
    expect(finishTxMock).toHaveBeenCalled();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('orphan verifies an admin catalog SKU without monthly/yearly in product id', async () => {
    mockResolveSubscriptionProductPlan.mockImplementation((productId: string) =>
      Promise.resolve(productId === adminMonthlySku ? 'monthly' : null),
    );
    (verifyIapReceipt as jest.Mock).mockResolvedValueOnce(undefined);
    const listener = jest.fn();
    iapService.onOrphanPurchaseVerified(listener);

    updatedCb?.({
      productId: adminMonthlySku,
      transactionReceipt: 'ADMIN_ORPHAN_RECEIPT',
      transactionId: 'tx_admin_orphan',
    });

    await new Promise<void>(r => setImmediate(r));
    await new Promise<void>(r => setImmediate(r));

    expect(verifyIapReceipt).toHaveBeenCalledWith(
      'ADMIN_ORPHAN_RECEIPT',
      'monthly',
      adminMonthlySku,
      'tx_admin_orphan',
    );
    expect(finishTxMock).toHaveBeenCalled();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('orphan 2002 RECEIPT_ALREADY_USED → finish + notify (silent success)', async () => {
    (verifyIapReceipt as jest.Mock).mockRejectedValueOnce(
      new ApiError(ERROR_CODE.RECEIPT_ALREADY_USED, 'used'),
    );
    const listener = jest.fn();
    iapService.onOrphanPurchaseVerified(listener);

    updatedCb?.({
      productId: IAP_PRODUCTS.yearly,
      transactionReceipt: 'BLOB',
      transactionId: 'tx_orphan_2',
    });

    await new Promise<void>(r => setImmediate(r));

    expect(finishTxMock).toHaveBeenCalled();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('orphan 2003 PRODUCT_ID_MISMATCH → finish but listener NOT notified', async () => {
    (verifyIapReceipt as jest.Mock).mockRejectedValueOnce(
      new ApiError(ERROR_CODE.PRODUCT_ID_MISMATCH, 'mismatch'),
    );
    const listener = jest.fn();
    iapService.onOrphanPurchaseVerified(listener);

    updatedCb?.({
      productId: IAP_PRODUCTS.monthly,
      transactionReceipt: 'BLOB',
      transactionId: 'tx_orphan_3',
    });

    await new Promise<void>(r => setImmediate(r));

    expect(finishTxMock).toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  test('orphan with unknown productId → tries server mapping and defers finish on mismatch', async () => {
    (verifyIapReceipt as jest.Mock).mockRejectedValue(
      new ApiError(ERROR_CODE.PRODUCT_ID_MISMATCH, 'mismatch'),
    );
    const listener = jest.fn();
    iapService.onOrphanPurchaseVerified(listener);

    updatedCb?.({
      productId: 'com.other.garbage',
      transactionReceipt: 'BLOB',
      transactionId: 'tx_orphan_4',
    });

    await new Promise<void>(r => setImmediate(r));
    await new Promise<void>(r => setImmediate(r));

    expect(verifyIapReceipt).toHaveBeenCalledWith(
      'BLOB',
      'monthly',
      'com.other.garbage',
      'tx_orphan_4',
    );
    expect(verifyIapReceipt).toHaveBeenCalledWith(
      'BLOB',
      'yearly',
      'com.other.garbage',
      'tx_orphan_4',
    );
    expect(finishTxMock).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  test('orphan with network failure → do NOT finish (retry later)', async () => {
    (verifyIapReceipt as jest.Mock).mockRejectedValueOnce(
      new ApiError(ERROR_CODE.NETWORK_ERROR, 'net'),
    );

    updatedCb?.({
      productId: IAP_PRODUCTS.monthly,
      transactionReceipt: 'BLOB',
      transactionId: 'tx_orphan_5',
    });

    await new Promise<void>(r => setImmediate(r));

    expect(finishTxMock).not.toHaveBeenCalled();
  });

  test('orphan with retryable failure is throttled for the same transaction', async () => {
    (verifyIapReceipt as jest.Mock).mockRejectedValue(
      new ApiError(ERROR_CODE.NETWORK_ERROR, 'net'),
    );
    const purchase = {
      productId: IAP_PRODUCTS.monthly,
      transactionReceipt: 'BLOB',
      transactionId: 'tx_orphan_retry_throttle',
    };

    updatedCb?.(purchase);
    await new Promise<void>(r => setImmediate(r));
    updatedCb?.(purchase);
    await new Promise<void>(r => setImmediate(r));

    expect(verifyIapReceipt).toHaveBeenCalledTimes(1);
    expect(finishTxMock).not.toHaveBeenCalled();
  });

  test('onOrphanPurchaseVerified returns unsubscribe', async () => {
    (verifyIapReceipt as jest.Mock).mockResolvedValueOnce(undefined);
    const listener = jest.fn();
    const unsub = iapService.onOrphanPurchaseVerified(listener);
    unsub();

    updatedCb?.({
      productId: IAP_PRODUCTS.monthly,
      transactionReceipt: 'BLOB',
      transactionId: 'tx_orphan_6',
    });

    await new Promise<void>(r => setImmediate(r));

    expect(listener).not.toHaveBeenCalled();
  });
});

import { getAvailablePurchases, getSubscriptions } from 'react-native-iap';

describe('iapService — dev queue flush', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await iapService.teardown();
  });

  afterEach(async () => {
    await iapService.teardown();
  });

  test('finishes the iOS transaction queue without initializing IAP listeners', async () => {
    await iapService._devFlushAllPending();

    expect(clearTransactionIOS).toHaveBeenCalledTimes(1);
    expect(initConnection).not.toHaveBeenCalled();
    expect(purchaseUpdatedListener).not.toHaveBeenCalled();
    expect(purchaseErrorListener).not.toHaveBeenCalled();
  });
});

describe('iapService — dev preflight cleanup', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockDefaultCatalogPlanResolvers();
    (getSubscriptions as jest.Mock).mockImplementation(({ skus }) =>
      Promise.resolve(skus.map((productId: string) => ({ productId }))),
    );
    await iapService.teardown();
  });

  afterEach(async () => {
    await iapService.teardown();
  });

  test('purchase clears the dev sandbox queue before attaching listeners', async () => {
    const holder: { updatedCb: ((p: any) => void) | null } = {
      updatedCb: null,
    };
    (purchaseUpdatedListener as jest.Mock).mockImplementation(cb => {
      holder.updatedCb = cb;
      return { remove: jest.fn() };
    });

    const pending = iapService.purchase(IAP_PRODUCTS.monthly);
    await new Promise<void>(r => setImmediate(r));
    await new Promise<void>(r => setImmediate(r));

    expect(clearTransactionIOS).toHaveBeenCalledTimes(1);
    expect(initConnection).toHaveBeenCalledTimes(1);
    expect(purchaseUpdatedListener).toHaveBeenCalledTimes(1);

    holder.updatedCb?.({
      productId: IAP_PRODUCTS.monthly,
      transactionReceipt: 'BASE64BLOB',
      transactionId: 'tx_dev_preflight',
    });
    await expect(pending).resolves.toMatchObject({
      transactionId: 'tx_dev_preflight',
    });
  });
});

describe('iapService — checkEligibility', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockDefaultCatalogPlanResolvers();
    (purchaseUpdatedListener as jest.Mock).mockReturnValue({
      remove: jest.fn(),
    });
    (purchaseErrorListener as jest.Mock).mockReturnValue({ remove: jest.fn() });
    await iapService.initialize();
  });

  afterEach(async () => {
    await iapService.teardown();
  });

  test('returns eligibleForIntroOffer=true when subscription has intro offer', async () => {
    (getSubscriptions as jest.Mock).mockResolvedValueOnce([
      {
        productId: IAP_PRODUCTS.monthly,
        introductoryPrice: '',
        introductoryPricePaymentModeIOS: 'FREETRIAL',
        introductoryPriceNumberOfPeriodsIOS: '1',
      },
    ]);

    const res = await iapService.checkEligibility();

    expect(res).toEqual([
      { productId: IAP_PRODUCTS.monthly, eligibleForIntroOffer: true },
    ]);
  });

  test('returns eligibleForIntroOffer=false when intro mode missing', async () => {
    (getSubscriptions as jest.Mock).mockResolvedValueOnce([
      {
        productId: IAP_PRODUCTS.monthly,
        introductoryPricePaymentModeIOS: '',
      },
    ]);

    const res = await iapService.checkEligibility();
    expect(res).toEqual([
      { productId: IAP_PRODUCTS.monthly, eligibleForIntroOffer: false },
    ]);
  });

  test('returns empty array when getSubscriptions rejects', async () => {
    (getSubscriptions as jest.Mock).mockRejectedValueOnce(
      new Error('store down'),
    );

    const res = await iapService.checkEligibility();
    expect(res).toEqual([]);
  });

  test('queries ALL product IDs (warms SKProduct cache for every SKU)', async () => {
    // Regression: previously only TRIAL_ELIGIBLE_PRODUCTS was queried, which
    // left the yearly SKU out of StoreKit's cache. requestSubscription then
    // failed with E_ITEM_UNAVAILABLE / E_DEVELOPER_ERROR ("商品不可用").
    (getSubscriptions as jest.Mock).mockResolvedValueOnce([]);
    await iapService.checkEligibility();

    expect(getSubscriptions).toHaveBeenCalledWith({
      skus: [...ALL_PRODUCT_IDS],
    });
  });
});

describe('iapService — purchase product preflight', () => {
  let updatedCb: ((p: any) => void) | null = null;

  const flushPurchasePreflight = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockDefaultCatalogPlanResolvers();
    (purchaseUpdatedListener as jest.Mock).mockImplementation(cb => {
      updatedCb = cb;
      return { remove: jest.fn() };
    });
    (purchaseErrorListener as jest.Mock).mockReturnValue({ remove: jest.fn() });
    await iapService.initialize();
  });

  afterEach(async () => {
    await iapService.teardown();
    updatedCb = null;
    jest.useRealTimers();
  });

  test('loads the selected subscription SKU before requesting purchase', async () => {
    (getSubscriptions as jest.Mock).mockResolvedValueOnce([
      { productId: IAP_PRODUCTS.yearly },
    ]);

    const pending = iapService.purchase(IAP_PRODUCTS.yearly);
    await flushPurchasePreflight();

    expect(getSubscriptions).toHaveBeenCalledWith({
      skus: [IAP_PRODUCTS.yearly],
    });
    expect(requestSubscription).toHaveBeenCalledWith({
      sku: IAP_PRODUCTS.yearly,
    });

    updatedCb?.({
      productId: IAP_PRODUCTS.yearly,
      transactionReceipt: 'YEARLY_RECEIPT',
      transactionId: 'tx_yearly',
    });

    await expect(pending).resolves.toMatchObject({
      productId: IAP_PRODUCTS.yearly,
      transactionReceipt: 'YEARLY_RECEIPT',
    });
  });

  test('allows purchasing an admin catalog SKU that is not in bootstrap constants', async () => {
    (getSubscriptions as jest.Mock).mockResolvedValueOnce([
      { productId: adminMonthlySku },
    ]);

    const pending = iapService.purchase(adminMonthlySku);
    await flushPurchasePreflight();

    expect(getSubscriptions).toHaveBeenCalledWith({
      skus: [adminMonthlySku],
    });
    expect(requestSubscription).toHaveBeenCalledWith({
      sku: adminMonthlySku,
    });

    updatedCb?.({
      productId: adminMonthlySku,
      transactionReceipt: 'ADMIN_RECEIPT',
      transactionId: 'tx_admin_purchase',
    });

    await expect(pending).resolves.toMatchObject({
      productId: adminMonthlySku,
      transactionReceipt: 'ADMIN_RECEIPT',
    });
  });

  test('rejects before native purchase when StoreKit does not return the selected SKU', async () => {
    (getSubscriptions as jest.Mock).mockResolvedValueOnce([]);

    const pending = iapService.purchase(IAP_PRODUCTS.yearly);

    await expect(pending).rejects.toMatchObject({
      code: 'E_ITEM_UNAVAILABLE',
      productId: IAP_PRODUCTS.yearly,
    });
    expect(requestSubscription).not.toHaveBeenCalled();
  });
});

describe('iapService — restore', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockDefaultCatalogPlanResolvers();
    (getReceiptIOS as jest.Mock).mockReset().mockResolvedValue(null);
    (getAvailablePurchases as jest.Mock).mockReset().mockResolvedValue([]);
    (verifyIapReceipt as jest.Mock).mockReset().mockResolvedValue(undefined);
    (purchaseUpdatedListener as jest.Mock).mockReturnValue({
      remove: jest.fn(),
    });
    (purchaseErrorListener as jest.Mock).mockReturnValue({ remove: jest.fn() });
    await iapService.initialize();
  });

  afterEach(async () => {
    await iapService.teardown();
  });

  test('empty availablePurchases → returns []', async () => {
    (getAvailablePurchases as jest.Mock).mockResolvedValueOnce([]);
    const res = await iapService.restore();
    expect(res).toEqual([]);
  });

  test('all verify succeed → returns N receipts and finishes each', async () => {
    (getAvailablePurchases as jest.Mock).mockResolvedValueOnce([
      {
        productId: IAP_PRODUCTS.monthly,
        transactionReceipt: 'R1',
        transactionId: 'tx_1',
      },
      {
        productId: IAP_PRODUCTS.yearlyPromo,
        transactionReceipt: 'R2',
        transactionId: 'tx_2',
      },
    ]);
    (verifyIapReceipt as jest.Mock).mockResolvedValue(undefined);

    const res = await iapService.restore();

    expect(res).toHaveLength(2);
    expect(finishTxMock).toHaveBeenCalledTimes(2);
  });

  test('2002 counts as success + finishes', async () => {
    (getAvailablePurchases as jest.Mock).mockResolvedValueOnce([
      {
        productId: IAP_PRODUCTS.monthly,
        transactionReceipt: 'R1',
        transactionId: 'tx_1',
      },
    ]);
    (verifyIapReceipt as jest.Mock).mockRejectedValueOnce(
      new ApiError(ERROR_CODE.RECEIPT_ALREADY_USED, 'used'),
    );

    const res = await iapService.restore();

    expect(res).toHaveLength(1);
    expect(finishTxMock).toHaveBeenCalledTimes(1);
  });

  test('2003 is skipped when every plan candidate mismatches', async () => {
    (getAvailablePurchases as jest.Mock).mockResolvedValueOnce([
      {
        productId: IAP_PRODUCTS.monthly,
        transactionReceipt: 'R1',
        transactionId: 'tx_1',
      },
    ]);
    (verifyIapReceipt as jest.Mock)
      .mockRejectedValueOnce(
        new ApiError(ERROR_CODE.PRODUCT_ID_MISMATCH, 'mismatch'),
      )
      .mockRejectedValueOnce(
        new ApiError(ERROR_CODE.PRODUCT_ID_MISMATCH, 'mismatch'),
      )
      .mockRejectedValueOnce(
        new ApiError(ERROR_CODE.PRODUCT_ID_MISMATCH, 'mismatch'),
      );

    const res = await iapService.restore();
    expect(res).toHaveLength(0);
    expect(finishTxMock).not.toHaveBeenCalled();
  });

  test('native restore verifies inactive catalog SKU instead of skipping it', async () => {
    const inactiveSku = 'admin.inactive.legacy';
    mockResolveSubscriptionProductPlan.mockResolvedValueOnce(null);
    (getAvailablePurchases as jest.Mock).mockResolvedValueOnce([
      {
        productId: inactiveSku,
        transactionReceipt: 'R_LEGACY',
        transactionId: 'tx_legacy',
      },
    ]);
    (verifyIapReceipt as jest.Mock)
      .mockRejectedValueOnce(
        new ApiError(ERROR_CODE.PRODUCT_ID_MISMATCH, 'mismatch'),
      )
      .mockResolvedValueOnce(undefined);

    const res = await iapService.restore();

    expect(verifyIapReceipt).toHaveBeenNthCalledWith(
      1,
      'R_LEGACY',
      'monthly',
      inactiveSku,
      'tx_legacy',
    );
    expect(verifyIapReceipt).toHaveBeenNthCalledWith(
      2,
      'R_LEGACY',
      'yearly',
      inactiveSku,
      'tx_legacy',
    );
    expect(res).toEqual([
      {
        productId: inactiveSku,
        transactionReceipt: 'R_LEGACY',
        transactionId: 'tx_legacy',
      },
    ]);
    expect(finishTxMock).toHaveBeenCalledWith({
      purchase: { transactionId: 'tx_legacy' },
      isConsumable: false,
    });
  });

  test('2005 bound-to-other restore error is propagated', async () => {
    (getAvailablePurchases as jest.Mock).mockResolvedValueOnce([
      {
        productId: IAP_PRODUCTS.monthly,
        transactionReceipt: 'R1',
        transactionId: 'tx_1',
      },
    ]);
    (verifyIapReceipt as jest.Mock).mockRejectedValueOnce(
      new ApiError(ERROR_CODE.RECEIPT_BOUND_TO_OTHER_USER, 'bound'),
    );

    await expect(iapService.restore()).rejects.toMatchObject({
      code: ERROR_CODE.RECEIPT_BOUND_TO_OTHER_USER,
    });
    expect(finishTxMock).not.toHaveBeenCalled();
  });

  test('uses refreshed app receipt before walking native restored transactions', async () => {
    (getReceiptIOS as jest.Mock).mockResolvedValueOnce('FRESH_YEARLY_RECEIPT');
    (verifyIapReceipt as jest.Mock)
      .mockRejectedValueOnce(
        new ApiError(ERROR_CODE.PRODUCT_ID_MISMATCH, 'mismatch'),
      )
      .mockResolvedValueOnce(undefined);

    const res = await iapService.restore();

    expect(getReceiptIOS).toHaveBeenCalledWith({ forceRefresh: true });
    expect(verifyIapReceipt).toHaveBeenNthCalledWith(
      1,
      'FRESH_YEARLY_RECEIPT',
      'monthly',
      IAP_PRODUCTS.monthly,
      '',
    );
    expect(verifyIapReceipt).toHaveBeenNthCalledWith(
      2,
      'FRESH_YEARLY_RECEIPT',
      'yearly',
      IAP_PRODUCTS.yearlyPromo,
      '',
    );
    expect(res).toEqual([
      {
        productId: IAP_PRODUCTS.yearlyPromo,
        transactionReceipt: 'FRESH_YEARLY_RECEIPT',
        transactionId: '',
      },
    ]);
    expect(getAvailablePurchases).not.toHaveBeenCalled();
    expect(finishTxMock).not.toHaveBeenCalled();
  });

  test('uses refreshed app receipt without walking native restored transactions', async () => {
    (getReceiptIOS as jest.Mock).mockResolvedValueOnce('FRESH_YEARLY_RECEIPT');
    (verifyIapReceipt as jest.Mock)
      .mockRejectedValueOnce(
        new ApiError(ERROR_CODE.PRODUCT_ID_MISMATCH, 'mismatch'),
      )
      .mockResolvedValueOnce(undefined);

    const res = await iapService.restore();

    expect(getReceiptIOS).toHaveBeenCalledWith({ forceRefresh: true });
    expect(verifyIapReceipt).toHaveBeenNthCalledWith(
      1,
      'FRESH_YEARLY_RECEIPT',
      'monthly',
      IAP_PRODUCTS.monthly,
      '',
    );
    expect(verifyIapReceipt).toHaveBeenNthCalledWith(
      2,
      'FRESH_YEARLY_RECEIPT',
      'yearly',
      IAP_PRODUCTS.yearlyPromo,
      '',
    );
    expect(res).toEqual([
      {
        productId: IAP_PRODUCTS.yearlyPromo,
        transactionReceipt: 'FRESH_YEARLY_RECEIPT',
        transactionId: '',
      },
    ]);
    expect(getAvailablePurchases).not.toHaveBeenCalled();
    expect(finishTxMock).not.toHaveBeenCalled();
  });

  test('network failure for one does not finish that one', async () => {
    (getAvailablePurchases as jest.Mock).mockResolvedValueOnce([
      {
        productId: IAP_PRODUCTS.monthly,
        transactionReceipt: 'R1',
        transactionId: 'tx_1',
      },
      {
        productId: IAP_PRODUCTS.yearly,
        transactionReceipt: 'R2',
        transactionId: 'tx_2',
      },
    ]);
    (verifyIapReceipt as jest.Mock)
      .mockRejectedValueOnce(new ApiError(ERROR_CODE.NETWORK_ERROR, 'net'))
      .mockResolvedValueOnce(undefined);

    const res = await iapService.restore();
    expect(res).toHaveLength(1); // only yearly succeeded
    expect(finishTxMock).toHaveBeenCalledTimes(1);
  });

  test('restore verifies an admin catalog SKU without monthly/yearly in product id', async () => {
    mockGetSubscriptionProductPlans.mockResolvedValueOnce([
      { productId: adminMonthlySku, plan: 'monthly' },
    ]);
    mockResolveSubscriptionProductPlan.mockResolvedValueOnce('monthly');
    (getAvailablePurchases as jest.Mock).mockResolvedValueOnce([
      {
        productId: adminMonthlySku,
        transactionReceipt: 'ADMIN_RESTORE_RECEIPT',
        transactionId: 'tx_admin_restore',
      },
    ]);

    const res = await iapService.restore();

    expect(verifyIapReceipt).toHaveBeenCalledWith(
      'ADMIN_RESTORE_RECEIPT',
      'monthly',
      adminMonthlySku,
      'tx_admin_restore',
    );
    expect(res).toEqual([
      {
        productId: adminMonthlySku,
        transactionReceipt: 'ADMIN_RESTORE_RECEIPT',
        transactionId: 'tx_admin_restore',
      },
    ]);
    expect(finishTxMock).toHaveBeenCalled();
  });

  test('caps at MAX_RESTORE_RECEIPTS=10', async () => {
    const purchases = Array.from({ length: 15 }, (_, i) => ({
      productId: IAP_PRODUCTS.monthly,
      transactionReceipt: `R${i}`,
      transactionId: `tx_${i}`,
    }));
    (getAvailablePurchases as jest.Mock).mockResolvedValueOnce(purchases);
    (verifyIapReceipt as jest.Mock).mockResolvedValue(undefined);

    await iapService.restore();
    expect(verifyIapReceipt).toHaveBeenCalledTimes(10);
  });

  test('skips purchases with empty transactionReceipt', async () => {
    (getAvailablePurchases as jest.Mock).mockResolvedValueOnce([
      {
        productId: IAP_PRODUCTS.monthly,
        transactionReceipt: '',
        transactionId: 'tx_def',
      },
    ]);

    const res = await iapService.restore();
    expect(res).toEqual([]);
    expect(verifyIapReceipt).not.toHaveBeenCalled();
  });
});
