import { apiGet, apiPost } from './api';
import type { SubscriptionInfo } from '../stores/auth-store';

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
  const data = await apiGet<SubscriptionStatusResponse>('/subscription/status');
  return {
    status: data.status as SubscriptionInfo['status'],
    plan: (data.plan || '') as SubscriptionInfo['plan'],
    expireAt: data.expire_at,
    trialEnd: data.trial_end,
    autoRenewing:
      typeof data.auto_renewing === 'boolean' ? data.auto_renewing : null,
  };
}

export async function verifyIapReceipt(
  receiptData: string,
  plan: string,
): Promise<void> {
  await apiPost<Record<string, never>>('/subscription/verify', {
    receipt_data: receiptData,
    plan,
  });
}
