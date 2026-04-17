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

export function classifyReminder(
  sub: Pick<SubscriptionInfo, 'status'> & Partial<Pick<SubscriptionInfo, 'expireAt' | 'trialEnd'>> | null,
  now: number,
): Classification {
  if (!sub) return { level: 'none', days: 0 };

  if (sub.status === 'sub_expired') return { level: 'expired', days: 0 };
  if (sub.status === 'trial_expired') return { level: 'expired', days: 0 };

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
