// ---------------------------------------------------------------------------
// Feature flags
// ---------------------------------------------------------------------------
//
// Toggle off-by-default for any flow that has not been validated end-to-end.
// Flip to `true` only when the corresponding backend / IAP plumbing is wired,
// QA'd and ready to ship to real users.

// NOTE (2026-04-21, TestFlight IAP testing): enabled for release/TestFlight
// builds so Apple sandbox purchases can be exercised outside dev builds.

export const FEATURES = {
  /**
   * Gate routing on subscription status (trial_expired / sub_expired ⇒
   * SubscriptionScreen) and render the paywall overlay on the activity
   * screen. Disabled until real Apple IAP + server-side receipt verification
   * are deployed — without those the user lands in a non-recoverable dead end.
   */
  SUBSCRIPTION_ENFORCEMENT: true,

  /**
   * Master switch for the entire Apple IAP integration. When false:
   *  - `useIapLifecycle` is a no-op (no initConnection, no listeners)
   *  - `SubscriptionScreen` falls back to its mock "coming soon" alert
   *  - Restore Purchases button is hidden regardless of IAP_RESTORE_ENABLED
   */
  IAP_ENABLED: true,

  /**
   * Controls Restore Purchases button visibility. Gated separately so we can
   * ship "purchase only" first and enable Restore once sandbox-verified.
   */
  IAP_RESTORE_ENABLED: true,
} as const;
