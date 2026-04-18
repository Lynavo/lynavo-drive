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
} from 'react-native-iap';

jest.mock('react-native-iap', () => ({
  initConnection: jest.fn().mockResolvedValue(true),
  endConnection: jest.fn().mockResolvedValue(undefined),
  purchaseUpdatedListener: jest.fn(() => ({ remove: jest.fn() })),
  purchaseErrorListener: jest.fn(() => ({ remove: jest.fn() })),
  getAvailablePurchases: jest.fn().mockResolvedValue([]),
  getSubscriptions: jest.fn().mockResolvedValue([]),
  requestSubscription: jest.fn(),
  finishTransaction: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../subscription-service', () => ({
  verifyIapReceipt: jest.fn().mockResolvedValue(undefined),
  getSubscriptionStatus: jest.fn(),
}));

import { iapService } from '../iap-service';

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

  test('teardown() removes listeners and ends connection', async () => {
    const removeMock = jest.fn();
    (purchaseUpdatedListener as jest.Mock).mockReturnValue({ remove: removeMock });
    (purchaseErrorListener as jest.Mock).mockReturnValue({ remove: removeMock });

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

import { requestSubscription } from 'react-native-iap';
import { IAP_PRODUCTS } from '../../constants/iap';

describe('iapService — purchase', () => {
  let updatedCb: ((p: any) => void) | null = null;
  let errorCb: ((e: any) => void) | null = null;

  beforeEach(async () => {
    jest.clearAllMocks();
    (purchaseUpdatedListener as jest.Mock).mockImplementation((cb) => {
      updatedCb = cb;
      return { remove: jest.fn() };
    });
    (purchaseErrorListener as jest.Mock).mockImplementation((cb) => {
      errorCb = cb;
      return { remove: jest.fn() };
    });
    await iapService.initialize();
  });

  afterEach(async () => {
    await iapService.teardown();
    updatedCb = null;
    errorCb = null;
  });

  test('resolves with PurchaseReceipt when matching event arrives', async () => {
    const pending = iapService.purchase(IAP_PRODUCTS.monthly);
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

  test('rejects when error listener fires with the pending productId', async () => {
    const pending = iapService.purchase(IAP_PRODUCTS.yearly);
    errorCb?.({ code: 'E_USER_CANCELLED', productId: IAP_PRODUCTS.yearly });

    await expect(pending).rejects.toMatchObject({ code: 'E_USER_CANCELLED' });
  });

  test('times out after 60s when no event arrives', async () => {
    jest.useFakeTimers();
    const pending = iapService.purchase(IAP_PRODUCTS.monthly);

    jest.advanceTimersByTime(60_000);

    await expect(pending).rejects.toThrow(/timed out/i);
    jest.useRealTimers();
  });

  test('resolves pending yearly when Apple delivers event with monthly (group-parent) productId', async () => {
    // Repro of Blocker 1: user already on monthly upgrades to yearly. Apple
    // delivers the SKPaymentTransaction with productId = old monthly SKU.
    // The pending yearly Promise must resolve with the real receipt blob.
    const pending = iapService.purchase(IAP_PRODUCTS.yearly);
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

  test('fatal E_ITEM_UNAVAILABLE code still rejects pending (regression guard)', async () => {
    const pending = iapService.purchase(IAP_PRODUCTS.yearly);
    errorCb?.({ code: 'E_ITEM_UNAVAILABLE', productId: IAP_PRODUCTS.yearly });
    await expect(pending).rejects.toMatchObject({ code: 'E_ITEM_UNAVAILABLE' });
  });
});

import { finishTransaction as finishTxMock } from 'react-native-iap';
import { verifyIapReceipt } from '../subscription-service';
import { ApiError, ERROR_CODE } from '../api';

describe('iapService — orphan recovery', () => {
  let updatedCb: ((p: any) => void) | null = null;

  beforeEach(async () => {
    jest.clearAllMocks();
    (purchaseUpdatedListener as jest.Mock).mockImplementation((cb) => {
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

    await new Promise<void>((r) => setImmediate(r));

    expect(verifyIapReceipt).toHaveBeenCalledWith('BLOB', 'monthly');
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

    await new Promise<void>((r) => setImmediate(r));

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

    await new Promise<void>((r) => setImmediate(r));

    expect(finishTxMock).toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  test('orphan with unknown productId → finish immediately, no verify call', async () => {
    const listener = jest.fn();
    iapService.onOrphanPurchaseVerified(listener);

    updatedCb?.({
      productId: 'com.other.garbage',
      transactionReceipt: 'BLOB',
      transactionId: 'tx_orphan_4',
    });

    await new Promise<void>((r) => setImmediate(r));

    expect(verifyIapReceipt).not.toHaveBeenCalled();
    expect(finishTxMock).toHaveBeenCalled();
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

    await new Promise<void>((r) => setImmediate(r));

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

    await new Promise<void>((r) => setImmediate(r));

    expect(listener).not.toHaveBeenCalled();
  });
});

import { getAvailablePurchases, getSubscriptions } from 'react-native-iap';

describe('iapService — checkEligibility', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    (purchaseUpdatedListener as jest.Mock).mockReturnValue({ remove: jest.fn() });
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
    (getSubscriptions as jest.Mock).mockRejectedValueOnce(new Error('store down'));

    const res = await iapService.checkEligibility();
    expect(res).toEqual([]);
  });

  test('queries only TRIAL_ELIGIBLE_PRODUCTS', async () => {
    (getSubscriptions as jest.Mock).mockResolvedValueOnce([]);
    await iapService.checkEligibility();

    expect(getSubscriptions).toHaveBeenCalledWith({
      skus: [IAP_PRODUCTS.monthly],
    });
  });
});

describe('iapService — restore', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    (purchaseUpdatedListener as jest.Mock).mockReturnValue({ remove: jest.fn() });
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
        productId: IAP_PRODUCTS.yearly,
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

  test('2003 is skipped (not counted, no finish)', async () => {
    (getAvailablePurchases as jest.Mock).mockResolvedValueOnce([
      {
        productId: IAP_PRODUCTS.monthly,
        transactionReceipt: 'R1',
        transactionId: 'tx_1',
      },
    ]);
    (verifyIapReceipt as jest.Mock).mockRejectedValueOnce(
      new ApiError(ERROR_CODE.PRODUCT_ID_MISMATCH, 'mismatch'),
    );

    const res = await iapService.restore();
    expect(res).toHaveLength(0);
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
