import type {
  AccountStatus,
  SubscriptionInfo,
  SubscriptionPlan,
  UserProfile,
} from '../stores/auth-store';

export type SubscriptionDisplayKind =
  | 'account_trial'
  | 'subscription_intro_trial'
  | 'subscribed'
  /** status=subscribed + autoRenewing=false: user cancelled in iOS
   *  Settings, access continues until expireAt. UI should surface
   *  "Cancelled, valid until X" copy instead of plain "Subscribed". */
  | 'subscribed_cancelled'
  | 'trial_expired'
  | 'sub_expired'
  | 'unknown';

export interface SubscriptionDisplayState {
  kind: SubscriptionDisplayKind;
  daysRemaining: number;
}

type EntitlementSnapshot = Pick<UserProfile, 'status' | 'plan' | 'trialEnd'>;
type SubscriptionSnapshot = Pick<
  SubscriptionInfo,
  'status' | 'plan' | 'trialEnd' | 'autoRenewing'
>;

function getRemainingDays(trialEnd: string | null | undefined): number {
  if (!trialEnd) return 0;
  const end = new Date(trialEnd).getTime();
  const diff = end - Date.now();
  if (Number.isNaN(end) || diff <= 0) return 0;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function classifySnapshot(
  snapshot: {
    status: AccountStatus;
    plan: SubscriptionPlan;
    trialEnd: string | null;
    autoRenewing?: boolean | null;
  },
): SubscriptionDisplayState | null {
  switch (snapshot.status) {
    case 'trialing':
      if (snapshot.plan === 'monthly') {
        return {
          kind: 'subscription_intro_trial',
          daysRemaining: getRemainingDays(snapshot.trialEnd),
        };
      }
      return {
        kind: 'account_trial',
        daysRemaining: getRemainingDays(snapshot.trialEnd),
      };
    case 'subscribed':
      // Only the subscription snapshot carries autoRenewing; user
      // entitlement snapshots don't, so legacy code paths that only
      // pass user still hit the plain "subscribed" branch.
      if (snapshot.autoRenewing === false) {
        return { kind: 'subscribed_cancelled', daysRemaining: 0 };
      }
      return { kind: 'subscribed', daysRemaining: 0 };
    case 'trial_expired':
      return {
        kind: snapshot.plan === 'monthly' ? 'sub_expired' : 'trial_expired',
        daysRemaining: 0,
      };
    case 'sub_expired':
      return { kind: 'sub_expired', daysRemaining: 0 };
    default:
      return null;
  }
}

export function resolveSubscriptionDisplayState(input: {
  subscription?: SubscriptionSnapshot | null;
  user?: EntitlementSnapshot | null;
}): SubscriptionDisplayState {
  const subscription = input.subscription;
  if (subscription?.status) {
    return (
      classifySnapshot({
        status: subscription.status,
        plan: subscription.plan,
        trialEnd: subscription.trialEnd,
        autoRenewing: subscription.autoRenewing,
      }) ?? { kind: 'unknown', daysRemaining: 0 }
    );
  }

  const user = input.user;
  if (user?.status) {
    return (
      classifySnapshot({
        status: user.status,
        plan: user.plan,
        trialEnd: user.trialEnd,
      }) ?? { kind: 'unknown', daysRemaining: 0 }
    );
  }

  return { kind: 'unknown', daysRemaining: 0 };
}
