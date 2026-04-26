import { ApiError, ERROR_CODE } from './api';

export enum IapErrorClass {
  /** User cancelled the Apple UI — never show an alert. */
  Cancelled = 'cancelled',
  /** Ask to Buy / Screen Time parental hold — transaction will resume later. */
  Deferred = 'deferred',
  /** Transient — show error + let user retry. */
  Retryable = 'retryable',
  /** Same receipt already verified by backend — treat as success. */
  SilentSuccess = 'silentSuccess',
  /** Receipt.productId not in backend validProducts — must finish to stop queue. */
  FatalMismatch = 'fatalMismatch',
  /** Product not on App Store / region-limited — contact support. */
  FatalConfig = 'fatalConfig',
  /** User already has an active sub — trigger Restore flow. Reserved for
   *  zombie-transaction recovery at app launch; never produced by
   *  E_ALREADY_OWNED from an explicit purchase tap (that maps to AlreadyOwned
   *  so the screen can surface a meaningful alert instead of silently
   *  restoring). */
  AutoRestore = 'autoRestore',
  /** User tapped purchase while an active subscription is already on file.
   *  Caller should show an "already subscribed" alert and leave the Restore
   *  flow to the explicit Restore button. */
  AlreadyOwned = 'alreadyOwned',
}

export interface IapErrorClassification {
  kind: IapErrorClass;
  i18nKey: string | null;
}

interface WithCode {
  code?: string | number;
  message?: string;
  debugMessage?: string;
}

// Sandbox (and some production) dismissals of the Apple payment sheet are
// reported by StoreKit as `ASDErrorDomain 907 / AMSErrorDomain 6` instead of
// `SKErrorPaymentCancelled`. react-native-iap's iOS layer only maps
// `SKErrorDomain code 2` to `E_USER_CANCELLED`; the above path falls through
// to `E_UNKNOWN`, and the underlying localized description contains strings
// like "Payment Sheet Failed" / "dismissed with neither an error nor a
// result" / "cancel". Matching on these substrings lets us recover the
// cancellation intent even when the numeric code was lost by RN-IAP.
const DISMISS_HINTS = [
  'payment sheet',
  'dismiss',
  'cancel',
  'user cancelled',
  'user canceled',
] as const;

export function looksLikeUserDismiss(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false;
  const { message, debugMessage } = err as WithCode;
  const haystack = `${message ?? ''} ${debugMessage ?? ''}`.toLowerCase();
  if (!haystack.trim()) return false;
  return DISMISS_HINTS.some(hint => haystack.includes(hint));
}

export function classifyIapError(err: unknown): IapErrorClassification {
  if (err instanceof ApiError) {
    switch (err.code) {
      case ERROR_CODE.RECEIPT_ALREADY_USED:
        return { kind: IapErrorClass.SilentSuccess, i18nKey: null };
      case ERROR_CODE.PRODUCT_ID_MISMATCH:
        return {
          kind: IapErrorClass.FatalMismatch,
          i18nKey: 'subscription.errors.productMismatch',
        };
      case ERROR_CODE.RECEIPT_BOUND_TO_OTHER_USER:
        // One Apple account's receipt is being claimed by a different
        // backend account. Reuse FatalMismatch semantics (finish the
        // transaction to stop Apple redelivery, surface alert, no retry)
        // with a dedicated copy so the user knows to sign into the
        // original account.
        return {
          kind: IapErrorClass.FatalMismatch,
          i18nKey: 'subscription.errors.receiptBoundToOther',
        };
      case ERROR_CODE.IAP_VERIFY_FAILED:
        return {
          kind: IapErrorClass.Retryable,
          i18nKey: 'subscription.errors.verifyFailed',
        };
      case ERROR_CODE.NETWORK_ERROR:
        return {
          kind: IapErrorClass.Retryable,
          i18nKey: 'subscription.errors.verifyRetrying',
        };
      default:
        return {
          kind: IapErrorClass.Retryable,
          i18nKey: 'subscription.errors.verifyFailed',
        };
    }
  }

  const code = (err as WithCode)?.code;
  // Some sandbox dismissals surface as E_UNKNOWN (ASDErrorDomain 907) — treat
  // them as Cancelled so we don't show the misleading "购买未完成" alert after
  // the user intentionally backed out of the payment sheet. Restricted to
  // non-fatal codes: a genuine E_ITEM_UNAVAILABLE / E_DEVELOPER_ERROR still
  // carries its dedicated classification even if the message happens to
  // mention "cancel".
  if ((code === 'E_UNKNOWN' || code == null) && looksLikeUserDismiss(err)) {
    return { kind: IapErrorClass.Cancelled, i18nKey: null };
  }
  switch (code) {
    case 'E_USER_CANCELLED':
      return { kind: IapErrorClass.Cancelled, i18nKey: null };
    case 'E_DEFERRED_PAYMENT':
      return {
        kind: IapErrorClass.Deferred,
        i18nKey: 'subscription.errors.deferred',
      };
    case 'E_ALREADY_OWNED':
      return {
        kind: IapErrorClass.AlreadyOwned,
        i18nKey: 'subscription.errors.alreadyOwned',
      };
    case 'E_ITEM_UNAVAILABLE':
    case 'E_DEVELOPER_ERROR':
      // Product not ready in App Store Connect (unapproved, missing
      // metadata, pricing absent for the sandbox tester's region, etc.).
      // Same UX outcome as E_ITEM_UNAVAILABLE: user can't buy; reusing
      // the "product unavailable, contact support" copy keeps messaging
      // consistent without proliferating config-specific error strings.
      return {
        kind: IapErrorClass.FatalConfig,
        i18nKey: 'subscription.errors.productUnavailable',
      };
    case 'E_NETWORK_ERROR':
      return {
        kind: IapErrorClass.Retryable,
        i18nKey: 'subscription.errors.iapFailed',
      };
    case 'E_UNKNOWN':
      return {
        kind: IapErrorClass.Retryable,
        i18nKey: 'subscription.errors.applePurchaseIncomplete',
      };
    default:
      return {
        kind: IapErrorClass.Retryable,
        i18nKey: 'subscription.errors.iapFailed',
      };
  }
}
