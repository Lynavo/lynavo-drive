import { apiGet, apiPost } from './api';
import type { SubscriptionInfo } from '../stores/auth-store';
import { recordDiagnosticsLog } from './diagnostics-log-service';

// ---------------------------------------------------------------------------
// Subscription API calls
// ---------------------------------------------------------------------------

interface SubscriptionStatusResponse {
  status: string;
  plan: string;
  expire_at: string | null;
  trial_end: string | null;
  /** Server emits this only when status === 'subscribed'; other states
   *  leave it absent/null (omitempty on the Go side). Client normalises
   *  to strict `boolean | null`. */
  auto_renewing?: boolean | null;
}

export async function getSubscriptionStatus(): Promise<SubscriptionInfo> {
  try {
    const data = await apiGet<SubscriptionStatusResponse>(
      '/subscription/status',
    );
    recordDiagnosticsLog('SubscriptionAPI', 'status loaded', {
      status: data.status,
      plan: data.plan || '',
      hasExpireAt: data.expire_at != null,
      hasTrialEnd: data.trial_end != null,
      autoRenewing:
        typeof data.auto_renewing === 'boolean'
          ? data.auto_renewing
          : undefined,
    });
    return {
      status: data.status as SubscriptionInfo['status'],
      plan: (data.plan || '') as SubscriptionInfo['plan'],
      expireAt: data.expire_at,
      trialEnd: data.trial_end,
      autoRenewing:
        typeof data.auto_renewing === 'boolean' ? data.auto_renewing : null,
    };
  } catch (error) {
    recordDiagnosticsLog('SubscriptionAPI', 'status failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function verifyIapReceipt(
  receiptData: string,
  plan: string,
  productId: string,
  transactionId = '',
): Promise<void> {
  recordDiagnosticsLog('SubscriptionAPI', 'verify request', {
    plan,
    hasReceipt: receiptData.length > 0,
    hasTransactionId: transactionId.length > 0,
    productId,
  });
  try {
    await apiPost<Record<string, never>>('/subscription/verify', {
      receipt_data: receiptData,
      plan,
      transaction_id: transactionId || undefined,
      product_id: productId,
    });
    recordDiagnosticsLog('SubscriptionAPI', 'verify success', { plan });
  } catch (error) {
    recordDiagnosticsLog('SubscriptionAPI', 'verify failed', {
      plan,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
