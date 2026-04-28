import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Prefix used by `useExpiryReminder` for per-day, per-level "I already showed
 * this reminder" flags (see `apps/mobile/src/hooks/useExpiryReminder.ts`).
 * These keys are user-scoped: after a logout / account switch the new owner
 * should see their own reminders on day one, not inherit the previous user's
 * "already shown today" suppression.
 */
const REMINDER_KEY_PREFIX = '@vividrop/reminder-shown/';
const AUTO_UPLOAD_SESSION_KEY = '@vividrop/auto-upload-session/v1';

/**
 * Remove every AsyncStorage entry that is scoped to the currently-signed-in
 * user. Today this is limited to the expiry-reminder suppression flags, but
 * the function is the canonical place to grow the list — any new UI-level
 * per-user state should be added here rather than in ad-hoc call sites.
 *
 * Preserves device-level / app-level state:
 *   - debug overrides (`@vividrop/debug/*`) — dev tooling, independent of user
 *   - legacy auth-token copies — `loadPersistedTokens()` handles those
 *   - theme / language / anything else not explicitly listed above
 *
 * Invoked from:
 *   - `SettingsScreen.handleLogout` (Phase 1)
 *   - `SettingsScreen.handleDeleteAccount` (Phase 1)
 *   - `auth-store` owner-mismatch path (Phase 2)
 *
 * Awaited, never fire-and-forget — the navigation transition triggered by
 * `clearAuth()` must not race ahead of this cleanup.
 */
export async function clearUserScopedStorage(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const toRemove = keys.filter(
    key =>
      key.startsWith(REMINDER_KEY_PREFIX) || key === AUTO_UPLOAD_SESSION_KEY,
  );
  if (toRemove.length === 0) {
    return;
  }
  await AsyncStorage.multiRemove(toRemove);
}
