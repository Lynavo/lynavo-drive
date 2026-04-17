import AsyncStorage from '@react-native-async-storage/async-storage';
import { classifyReminder, shouldShowReminderToday } from '../useExpiryReminder';

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
