// Mock native modules that api.ts pulls in transitively via auth-store
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

import { ERROR_CODE, ApiError } from '../api';
import {
  classifyIapError,
  IapErrorClass,
  looksLikeUserDismiss,
} from '../iap-errors';

describe('classifyIapError', () => {
  test('E_USER_CANCELLED → cancelled (silent)', () => {
    const cls = classifyIapError({ code: 'E_USER_CANCELLED' });
    expect(cls.kind).toBe(IapErrorClass.Cancelled);
    expect(cls.i18nKey).toBeNull();
  });

  test('E_DEFERRED_PAYMENT → deferred with i18n key', () => {
    const cls = classifyIapError({ code: 'E_DEFERRED_PAYMENT' });
    expect(cls.kind).toBe(IapErrorClass.Deferred);
    expect(cls.i18nKey).toBe('subscription.errors.deferred');
  });

  test('E_NETWORK_ERROR → retryable', () => {
    const cls = classifyIapError({ code: 'E_NETWORK_ERROR' });
    expect(cls.kind).toBe(IapErrorClass.Retryable);
    expect(cls.i18nKey).toBe('subscription.errors.iapFailed');
  });

  test('E_ALREADY_OWNED → alreadyOwned with dedicated i18n key', () => {
    const cls = classifyIapError({ code: 'E_ALREADY_OWNED' });
    expect(cls.kind).toBe(IapErrorClass.AlreadyOwned);
    expect(cls.i18nKey).toBe('subscription.errors.alreadyOwned');
  });

  test('E_ITEM_UNAVAILABLE → fatalConfig', () => {
    const cls = classifyIapError({ code: 'E_ITEM_UNAVAILABLE' });
    expect(cls.kind).toBe(IapErrorClass.FatalConfig);
    expect(cls.i18nKey).toBe('subscription.errors.productUnavailable');
  });

  test('E_DEVELOPER_ERROR → fatalConfig (ASC misconfig, not retryable)', () => {
    // Observed in sandbox when a product ID exists in code but is not
    // yet approved / missing metadata in App Store Connect. Must fail
    // fast with an alert — waiting won't help.
    const cls = classifyIapError({ code: 'E_DEVELOPER_ERROR' });
    expect(cls.kind).toBe(IapErrorClass.FatalConfig);
    expect(cls.i18nKey).toBe('subscription.errors.productUnavailable');
  });

  test('Unknown Apple code → retryable with account/sign-in guidance key', () => {
    const cls = classifyIapError({ code: 'E_UNKNOWN' });
    expect(cls.kind).toBe(IapErrorClass.Retryable);
    expect(cls.i18nKey).toBe('subscription.errors.applePurchaseIncomplete');
  });

  test('Backend 2001 IAP_VERIFY_FAILED → retryable', () => {
    const cls = classifyIapError(
      new ApiError(ERROR_CODE.IAP_VERIFY_FAILED, 'fail'),
    );
    expect(cls.kind).toBe(IapErrorClass.Retryable);
    expect(cls.i18nKey).toBe('subscription.errors.verifyFailed');
  });

  test('Backend 2002 RECEIPT_ALREADY_USED → silent success', () => {
    const cls = classifyIapError(
      new ApiError(ERROR_CODE.RECEIPT_ALREADY_USED, 'used'),
    );
    expect(cls.kind).toBe(IapErrorClass.SilentSuccess);
  });

  test('Backend 2003 PRODUCT_ID_MISMATCH → fatal mismatch', () => {
    const cls = classifyIapError(
      new ApiError(ERROR_CODE.PRODUCT_ID_MISMATCH, 'mismatch'),
    );
    expect(cls.kind).toBe(IapErrorClass.FatalMismatch);
    expect(cls.i18nKey).toBe('subscription.errors.productMismatch');
  });

  test('Backend 2005 RECEIPT_BOUND_TO_OTHER_USER → fatal mismatch with dedicated copy', () => {
    // Guard against regression to SilentSuccess — cross-account receipt
    // reuse MUST surface an actionable alert, not silently "succeed".
    const cls = classifyIapError(
      new ApiError(ERROR_CODE.RECEIPT_BOUND_TO_OTHER_USER, 'bound to other'),
    );
    expect(cls.kind).toBe(IapErrorClass.FatalMismatch);
    expect(cls.i18nKey).toBe('subscription.errors.receiptBoundToOther');
  });

  test('Backend NETWORK_ERROR → retryable', () => {
    const cls = classifyIapError(
      new ApiError(ERROR_CODE.NETWORK_ERROR, 'network'),
    );
    expect(cls.kind).toBe(IapErrorClass.Retryable);
    expect(cls.i18nKey).toBe('subscription.errors.verifyRetrying');
  });

  test('E_UNKNOWN with "Payment Sheet" message → Cancelled (sandbox 907 dismissal)', () => {
    // Repro: user taps subscribe then dismisses Apple's sandbox
    // "使用 Apple 账户登录" confirmation. RN-IAP forwards this as
    // `E_UNKNOWN` with message "Payment Sheet Failed" — should be treated
    // as Cancelled so SubscriptionScreen returns silently instead of
    // alerting "购买未完成".
    const cls = classifyIapError({
      code: 'E_UNKNOWN',
      message: 'Payment Sheet Failed',
      debugMessage:
        'Payment sheet dismissed with neither an error nor a result',
    });
    expect(cls.kind).toBe(IapErrorClass.Cancelled);
    expect(cls.i18nKey).toBeNull();
  });

  test('E_UNKNOWN with generic message stays Retryable (transient non-dismissal)', () => {
    // Regression guard: non-dismissal E_UNKNOWN must keep the existing
    // retryable classification — otherwise real StoreKit glitches would
    // be silently swallowed.
    const cls = classifyIapError({
      code: 'E_UNKNOWN',
      message: 'Something unexpected happened',
    });
    expect(cls.kind).toBe(IapErrorClass.Retryable);
    expect(cls.i18nKey).toBe('subscription.errors.applePurchaseIncomplete');
  });

  test('E_ITEM_UNAVAILABLE with "cancel" in message still returns FatalConfig', () => {
    // Dismissal heuristic must not hijack genuine fatal codes.
    const cls = classifyIapError({
      code: 'E_ITEM_UNAVAILABLE',
      message: 'Cannot cancel — product unavailable',
    });
    expect(cls.kind).toBe(IapErrorClass.FatalConfig);
    expect(cls.i18nKey).toBe('subscription.errors.productUnavailable');
  });
});

describe('looksLikeUserDismiss', () => {
  test('true for "Payment Sheet Failed" message', () => {
    expect(
      looksLikeUserDismiss({
        code: 'E_UNKNOWN',
        message: 'Payment Sheet Failed',
      }),
    ).toBe(true);
  });

  test('true when the signal is only in debugMessage', () => {
    expect(
      looksLikeUserDismiss({
        code: 'E_UNKNOWN',
        debugMessage:
          'Payment sheet dismissed with neither an error nor a result',
      }),
    ).toBe(true);
  });

  test('true for plain "cancelled" wording', () => {
    expect(
      looksLikeUserDismiss({ message: 'User cancelled the request' }),
    ).toBe(true);
  });

  test('false for non-dismissal message', () => {
    expect(
      looksLikeUserDismiss({ code: 'E_UNKNOWN', message: 'Network is down' }),
    ).toBe(false);
  });

  test('false for null / undefined / string', () => {
    expect(looksLikeUserDismiss(null)).toBe(false);
    expect(looksLikeUserDismiss(undefined)).toBe(false);
    expect(looksLikeUserDismiss('payment sheet')).toBe(false);
  });

  test('false when both message and debugMessage are empty', () => {
    expect(looksLikeUserDismiss({ code: 'E_UNKNOWN' })).toBe(false);
    expect(looksLikeUserDismiss({ message: '', debugMessage: '' })).toBe(false);
  });
});
