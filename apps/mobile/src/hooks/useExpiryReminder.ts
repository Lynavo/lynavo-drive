import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import i18next from 'i18next';
import type { SubscriptionInfo } from '../stores/auth-store';

export type ReminderLevel = 'none' | 'warn7' | 'warnToday' | 'expired';

export interface Classification {
  level: ReminderLevel;
  days: number;
}

const MS_PER_DAY = 86_400_000;

// Grace window after an explicit purchase / restore. Within this window
// the hook suppresses reminder alerts so users who just activated a
// subscription aren't immediately warned about expiry. Most noticeable
// during sandbox testing, where a monthly subscription is only 5 min —
// expireAt < 24h always, so warnToday fires right after success. In
// production it also smooths over the brief window between state flip
// and the user putting the device down.
const GRACE_MS = 60_000;

// Session-only timestamp. Not persisted: cold launch → grace inactive
// (by then any real expiry alert is legitimately worth showing).
let justActivatedAt: number | null = null;

/** Call from purchase / restore success path to skip the next reminder
 *  firing within GRACE_MS. `now` is injectable for deterministic tests. */
export function markSubscriptionJustActivated(now: number = Date.now()): void {
  justActivatedAt = now;
}

/** Exposed as pure helper so reminder grace behavior is testable without
 *  mounting the hook. Returns true iff markSubscriptionJustActivated was
 *  called within the last GRACE_MS. */
export function isWithinActivationGrace(now: number): boolean {
  if (justActivatedAt === null) return false;
  return now - justActivatedAt < GRACE_MS;
}

/** Test-only reset — production code must not touch this. */
export function __resetJustActivatedForTesting(): void {
  justActivatedAt = null;
}

export function classifyReminder(
  sub:
    | (Pick<SubscriptionInfo, 'status'> &
        Partial<Pick<SubscriptionInfo, 'expireAt' | 'trialEnd' | 'autoRenewing'>>)
    | null,
  now: number,
): Classification {
  if (!sub) return { level: 'none', days: 0 };

  if (sub.status === 'sub_expired') return { level: 'expired', days: 0 };
  if (sub.status === 'trial_expired') return { level: 'expired', days: 0 };
  if (sub.status === 'subscribed' && sub.autoRenewing === true) {
    return { level: 'none', days: 0 };
  }

  const targetIso =
    sub.status === 'trialing' ? sub.trialEnd : sub.expireAt;
  if (!targetIso) return { level: 'none', days: 0 };

  const target = new Date(targetIso).getTime();
  if (Number.isNaN(target)) return { level: 'none', days: 0 };

  const diffMs = target - now;
  if (diffMs <= 0) return { level: 'warnToday', days: 0 };
  if (diffMs < MS_PER_DAY) return { level: 'warnToday', days: 0 };

  const diffDays = Math.ceil(diffMs / MS_PER_DAY);
  if (diffDays <= 7) return { level: 'warn7', days: diffDays };
  return { level: 'none', days: 0 };
}

function todayKey(now: number, level: ReminderLevel): string {
  const d = new Date(now);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `@vividrop/reminder-shown/${y}-${m}-${day}/${level}`;
}

export async function shouldShowReminderToday(
  level: ReminderLevel,
  now: number,
): Promise<boolean> {
  if (level === 'none') return false;
  const key = todayKey(now, level);
  const prev = await AsyncStorage.getItem(key);
  if (prev) return false;
  await AsyncStorage.setItem(key, '1');
  return true;
}

export interface UseExpiryReminderArgs {
  subscription: SubscriptionInfo | null;
  onRenew: () => void;
}

export function useExpiryReminder({
  subscription,
  onRenew,
}: UseExpiryReminderArgs): void {
  const shownRef = useRef(false);

  useEffect(() => {
    if (shownRef.current) return;
    if (!subscription) return;

    // Grace window: user just activated via purchase/restore. Skip the
    // first reminder so they don't see "expires today" immediately after
    // a successful purchase alert. Don't mark shownRef — if grace lapses
    // and a legitimate reminder is warranted (e.g. they navigate back
    // much later in a sandbox session after expiry), it can still fire.
    if (isWithinActivationGrace(Date.now())) return;

    const cls = classifyReminder(subscription, Date.now());
    if (cls.level === 'none') return;

    void shouldShowReminderToday(cls.level, Date.now()).then((ok) => {
      if (!ok) return;
      shownRef.current = true;

      // Cast to a plain translate function to allow dynamic key construction.
      // The keys are composed from a known prefix + level enum, so they are
      // always valid at runtime; the strict i18next overloads can't express this.
      const t = i18next.t.bind(i18next) as (key: string, opts?: Record<string, unknown>) => string;
      const titleKey = `subscription.reminder.${cls.level}Title`;
      const bodyKey = `subscription.reminder.${cls.level}Body`;
      const body =
        cls.level === 'warn7'
          ? t(bodyKey, { days: cls.days })
          : t(bodyKey);

      Alert.alert(t(titleKey), body, [
        { text: t('subscription.reminder.later'), style: 'cancel' },
        {
          text: t('subscription.reminder.renewNow'),
          onPress: onRenew,
        },
      ]);
    });
  }, [subscription, onRenew]);
}
