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
