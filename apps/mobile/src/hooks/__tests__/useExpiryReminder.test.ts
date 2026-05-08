import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  classifyReminder,
  shouldShowReminderToday,
  markSubscriptionJustActivated,
  isWithinActivationGrace,
  __resetJustActivatedForTesting,
} from '../useExpiryReminder';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

describe('classifyReminder', () => {
  const MS_PER_DAY = 86_400_000;
  const now = new Date('2026-04-17T10:00:00Z').getTime();

  test('status subscribed with expireAt > 7 days → none', () => {
    const r = classifyReminder({
      status: 'subscribed',
      expireAt: new Date(now + 10 * MS_PER_DAY).toISOString(),
    }, now);
    expect(r.level).toBe('none');
  });

  test('status subscribed with expireAt in [1..7] days → warn7', () => {
    const r = classifyReminder({
      status: 'subscribed',
      expireAt: new Date(now + 5 * MS_PER_DAY).toISOString(),
    }, now);
    expect(r.level).toBe('warn7');
    expect(r.days).toBe(5);
  });

  test('status subscribed and auto-renewing with expireAt in [1..7] days → none', () => {
    const r = classifyReminder({
      status: 'subscribed',
      expireAt: new Date(now + 5 * MS_PER_DAY).toISOString(),
      autoRenewing: true,
    }, now);
    expect(r.level).toBe('none');
  });

  test('status subscribed with expireAt today (<1 day) → warnToday', () => {
    const r = classifyReminder({
      status: 'subscribed',
      expireAt: new Date(now + 12 * 60 * 60 * 1000).toISOString(),
    }, now);
    expect(r.level).toBe('warnToday');
  });

  test('status sub_expired → expired', () => {
    const r = classifyReminder({ status: 'sub_expired', expireAt: null }, now);
    expect(r.level).toBe('expired');
  });

  test('status trialing with trial_end in 2 days → warn7', () => {
    const r = classifyReminder({
      status: 'trialing',
      trialEnd: new Date(now + 2 * MS_PER_DAY).toISOString(),
    }, now);
    expect(r.level).toBe('warn7');
    expect(r.days).toBe(2);
  });

  test('status trialing with trial_end > 7 days → none', () => {
    const r = classifyReminder({
      status: 'trialing',
      trialEnd: new Date(now + 10 * MS_PER_DAY).toISOString(),
    }, now);
    expect(r.level).toBe('none');
  });

  test('null subscription → none', () => {
    expect(classifyReminder(null, now).level).toBe('none');
  });
});

describe('shouldShowReminderToday', () => {
  beforeEach(() => {
    (AsyncStorage.getItem as jest.Mock).mockReset();
    (AsyncStorage.setItem as jest.Mock).mockReset();
  });

  test('first show today → true and writes marker', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null);
    const now = new Date('2026-04-17T10:00:00Z').getTime();
    const ok = await shouldShowReminderToday('warn7', now);
    expect(ok).toBe(true);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      '@vividrop/reminder-shown/2026-04-17/warn7',
      '1',
    );
  });

  test('second show same day same level → false', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce('1');
    const now = new Date('2026-04-17T10:00:00Z').getTime();
    const ok = await shouldShowReminderToday('warn7', now);
    expect(ok).toBe(false);
  });
});

describe('activation grace window', () => {
  beforeEach(() => {
    __resetJustActivatedForTesting();
  });

  test('no prior mark → not within grace', () => {
    expect(isWithinActivationGrace(1_000_000)).toBe(false);
  });

  test('immediately after mark → within grace', () => {
    const T = 1_000_000;
    markSubscriptionJustActivated(T);
    expect(isWithinActivationGrace(T)).toBe(true);
    expect(isWithinActivationGrace(T + 30_000)).toBe(true);
  });

  test('at grace boundary (60s) → no longer within grace', () => {
    // Repro of the original user-visible issue: sandbox monthly expires
    // ~5 min after purchase, so warnToday fires within seconds of
    // activation. Grace must suppress that first firing, but not lock
    // out legitimate reminders indefinitely.
    const T = 1_000_000;
    markSubscriptionJustActivated(T);
    expect(isWithinActivationGrace(T + 59_999)).toBe(true);
    expect(isWithinActivationGrace(T + 60_000)).toBe(false);
    expect(isWithinActivationGrace(T + 120_000)).toBe(false);
  });

  test('mark is idempotent — second call refreshes the window', () => {
    const T = 1_000_000;
    markSubscriptionJustActivated(T);
    // 50 s later, another activation (e.g. user restored after purchase).
    markSubscriptionJustActivated(T + 50_000);
    // From the refreshed anchor, 30s later still within grace.
    expect(isWithinActivationGrace(T + 80_000)).toBe(true);
    // 70s after the refresh → out of grace.
    expect(isWithinActivationGrace(T + 121_000)).toBe(false);
  });
});
