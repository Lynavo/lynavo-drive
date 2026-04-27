import React, {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Modal,
  ActivityIndicator,
  Dimensions,
  NativeModules,
  Clipboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { Icon } from '../components/Icon';
import { SubscriptionPlanCard } from '../components/SubscriptionPlanCard';
import {
  SUBSCRIPTION_STATUS_ICON_BACKGROUNDS,
  SUBSCRIPTION_STATUS_ICON_COLORS,
  SubscriptionStatusIcon,
  getSubscriptionStatusIconTone,
} from '../components/SubscriptionStatusIcon';
import {
  isFeatureAccessAllowed,
  useAuth,
  type SubscriptionInfo,
} from '../stores/auth-store';
import { iapService } from '../services/iap-service';
import { resolveSubscriptionPlanTier } from '../services/subscription-plans-service';
import {
  useSubscriptionPlans,
  type PlanWithProduct,
} from '../hooks/useSubscriptionPlans';
import { classifyIapError, IapErrorClass } from '../services/iap-errors';
import { markSubscriptionJustActivated } from '../hooks/useExpiryReminder';
import {
  getSubscriptionStatus,
  verifyIapReceipt,
} from '../services/subscription-service';
import { logout as serverLogout } from '../services/auth-service';
import { wipeSyncIdentity } from '../services/SyncEngineModule';
import { resetCurrentDesktopSidecarIfReachable } from '../services/sidecar-reset-service';
import { clearUserScopedStorage } from '../utils/clearUserScopedStorage';
import {
  DiagnosticUploadError,
  diagnosticUploadService,
} from '../services/diagnostic-upload-service';
import { recordDiagnosticsLog } from '../services/diagnostics-log-service';
import { FEATURES } from '../constants/features';
import {
  resolveSubscriptionDisplayState,
  type SubscriptionDisplayState,
} from '../utils/subscriptionStatusDisplay';
import { ERROR_CODE } from '../services/api';

const DARK = '#202022';
const SCREEN_BG = '#d6ecf8';
const CARD_BG = '#ffffff';
const CARD_BORDER = 'rgba(187, 214, 233, 0.72)';
const MUTED_TEXT = '#7893ab';
const SUCCESS_GREEN = '#22c55e';
const DESTRUCTIVE_RED = '#e53935';
const CHECK_BG = 'rgba(83, 200, 120, 0.12)';
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PLAN_CARD_GAP = 12;
const PLAN_CARD_HORIZONTAL_PADDING = 16;
const POST_VERIFY_STATUS_POLL_DELAYS_MS = [
  2_000,
  5_000,
  10_000,
  20_000,
  30_000,
] as const;

/** Card width grows/shrinks with plan count so 2 or 3 cards always tile
 *  edge-to-edge under the section padding. The base styles default to the
 *  2-card width; PlanCard accepts a width override for 3-card layouts. */
function planCardWidth(cardsPerRow: number): number {
  const totalGap = PLAN_CARD_GAP * (cardsPerRow - 1);
  return (
    (SCREEN_WIDTH - PLAN_CARD_HORIZONTAL_PADDING * 2 - totalGap) / cardsPerRow
  );
}
type NavigationProp = StackNavigationProp<RootStackParamList, 'Subscription'>;
type PostSubscriptionRoute = Extract<
  keyof RootStackParamList,
  'DeviceDiscovery' | 'SyncActivity'
>;

/** Returns the Apple-level plan the user currently holds, or null for
 *  account-level trials / expired states where no Apple IAP applies.
 *  Drives the "current plan" badge + card disabling on SubscriptionScreen.
 *  Exported for unit testing. */
export function resolveCurrentPlan(
  sub: { status: string; plan: string } | null,
): 'monthly' | 'yearly' | null {
  if (!sub) return null;
  if (sub.status !== 'subscribed' && sub.status !== 'trialing') return null;
  if (sub.plan === 'monthly' || sub.plan === 'yearly') return sub.plan;
  return null;
}
type PlanKey = 'monthly' | 'yearly';

function isDowngradePlan(
  currentPlan: PlanKey | null,
  targetPlan: PlanKey,
): boolean {
  return currentPlan === 'yearly' && targetPlan === 'monthly';
}

function formatExpireDate(dateStr: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function resolvePostSubscriptionRoute(): Promise<PostSubscriptionRoute> {
  try {
    const { NativeSyncEngine } = NativeModules;
    if (NativeSyncEngine) {
      const binding = await NativeSyncEngine.getBindingState();
      if (binding && binding.deviceId) {
        return 'SyncActivity';
      }
    }
  } catch {
    /* fall through to DeviceDiscovery */
  }
  return 'DeviceDiscovery';
}

/** Translates StoreKit-reported (periodUnit, periodCount) into a localized
 *  unit suffix like "/月" / "/year" / "/3 months". Falls back to the
 *  caller-provided string when StoreKit didn't expose period metadata
 *  (Android, sandbox not configured, IAP feature flag off). */
function periodLabel(
  product: { periodUnit?: string; periodCount?: number } | null,
  fallbackLabel: string,
  t: TFunction,
): string {
  const unit = product?.periodUnit;
  const count = product?.periodCount;
  if (!unit || !count || count < 1) return fallbackLabel;
  const lower = unit.toLowerCase();
  if (
    lower !== 'day' &&
    lower !== 'week' &&
    lower !== 'month' &&
    lower !== 'year'
  ) {
    return fallbackLabel;
  }
  return t(`subscription.plans.unit.${lower}` as never, {
    count,
    defaultValue: fallbackLabel,
  });
}

/** Best-effort label for the post-purchase success modal. The modal only
 *  needs a human-readable plan name, so we look it up from the freshly
 *  loaded server catalog by product_id. When the catalog isn't available
 *  (offline + bootstrap fallback) we fall back to the legacy generic
 *  "subscription" copy so the modal still renders rather than crashing. */
function getPlanDisplayName(
  productId: string,
  plans: PlanWithProduct[],
  t: TFunction,
): string {
  const found = plans.find(entry => entry.plan.product_id === productId);
  if (found) return found.plan.name;
  return t('subscription.plans.fallback');
}

const FEATURE_KEYS = [
  'subscription.features.autoUpload',
  'subscription.features.customTime',
  'subscription.features.sharedDir',
  'subscription.features.preview',
  'subscription.features.multiDevice',
  'subscription.features.unlimited',
] as const;

function StatusBadge({
  displayState,
  t,
}: {
  displayState: SubscriptionDisplayState;
  t: TFunction;
}) {
  let dotColor: string;
  let label: string;
  let backgroundColor: string;
  let textColor: string;
  const iconTone = getSubscriptionStatusIconTone(displayState.kind);

  switch (displayState.kind) {
    case 'account_trial': {
      const days = displayState.daysRemaining;
      label = t('subscription.status.trialing', { days });
      dotColor = SUBSCRIPTION_STATUS_ICON_COLORS.trial;
      backgroundColor = SUBSCRIPTION_STATUS_ICON_BACKGROUNDS.trial;
      textColor = SUBSCRIPTION_STATUS_ICON_COLORS.trial;
      break;
    }
    case 'subscription_intro_trial': {
      const days = displayState.daysRemaining;
      label = t('subscription.status.introTrialing', { days });
      dotColor = SUBSCRIPTION_STATUS_ICON_COLORS.trial;
      backgroundColor = SUBSCRIPTION_STATUS_ICON_BACKGROUNDS.trial;
      textColor = SUBSCRIPTION_STATUS_ICON_COLORS.trial;
      break;
    }
    case 'trial_expired':
      label = t('subscription.status.trialExpired');
      dotColor = SUBSCRIPTION_STATUS_ICON_COLORS.expired;
      backgroundColor = SUBSCRIPTION_STATUS_ICON_BACKGROUNDS.expired;
      textColor = SUBSCRIPTION_STATUS_ICON_COLORS.expired;
      break;
    case 'subscribed':
      label = t('subscription.status.subscribed');
      dotColor = SUBSCRIPTION_STATUS_ICON_COLORS.subscribed;
      backgroundColor = SUBSCRIPTION_STATUS_ICON_BACKGROUNDS.subscribed;
      textColor = SUBSCRIPTION_STATUS_ICON_COLORS.subscribed;
      break;
    case 'subscribed_cancelled':
      label = t('subscription.status.subscribed');
      dotColor = SUBSCRIPTION_STATUS_ICON_COLORS.subscribed;
      backgroundColor = SUBSCRIPTION_STATUS_ICON_BACKGROUNDS.subscribed;
      textColor = SUBSCRIPTION_STATUS_ICON_COLORS.subscribed;
      break;
    case 'sub_expired':
      label = t('subscription.status.subExpired');
      dotColor = SUBSCRIPTION_STATUS_ICON_COLORS.expired;
      backgroundColor = SUBSCRIPTION_STATUS_ICON_BACKGROUNDS.expired;
      textColor = SUBSCRIPTION_STATUS_ICON_COLORS.expired;
      break;
    default:
      return null;
  }

  return (
    <View style={[badgeStyles.container, { backgroundColor }]}>
      {iconTone ? (
        <SubscriptionStatusIcon tone={iconTone} size={14} />
      ) : (
        <View style={[badgeStyles.dot, { backgroundColor: dotColor }]} />
      )}
      <Text style={[badgeStyles.text, { color: textColor }]}>{label}</Text>
    </View>
  );
}

const badgeStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  text: {
    fontSize: 13,
    fontWeight: '600',
  },
});

function FeatureList({ t }: { t: TFunction }) {
  return (
    <View style={featureStyles.container}>
      <Text style={featureStyles.caption}>{t('subscription.divider')}</Text>
      {FEATURE_KEYS.map(key => (
        <View key={key} style={featureStyles.row}>
          <View style={featureStyles.iconWrap}>
            <Icon name="checkmark" size={14} color={SUCCESS_GREEN} />
          </View>
          <Text style={featureStyles.text}>{t(key)}</Text>
        </View>
      ))}
    </View>
  );
}

const featureStyles = StyleSheet.create({
  container: {
    gap: 12,
  },
  caption: {
    fontSize: 12,
    fontWeight: '600',
    color: '#b1b6be',
    marginBottom: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  iconWrap: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: CHECK_BG,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  text: {
    flex: 1,
    fontSize: 14,
    lineHeight: 22,
    color: '#42464d',
  },
});

function PaymentSuccessModal({
  visible,
  planLabel,
  expireAt,
  onDismiss,
  t,
}: {
  visible: boolean;
  /** Pre-resolved display name (server-provided plan.name or fallback). The
   *  modal stays dumb so SubscriptionScreen owns catalog lookup. */
  planLabel: string;
  expireAt: string | null;
  onDismiss: () => void;
  t: TFunction;
}) {
  const expiry = formatExpireDate(expireAt);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
    >
      <View style={modalStyles.overlay}>
        <View style={modalStyles.card}>
          <View style={modalStyles.iconCircle}>
            <Icon name="checkmark-circle" size={48} color={SUCCESS_GREEN} />
          </View>
          <Text style={modalStyles.title}>
            {t('subscription.modal.paymentSuccess')}
          </Text>
          <Text style={modalStyles.subtitle}>
            {t('subscription.modal.successSubtitle')}
          </Text>

          <View style={modalStyles.planRow}>
            <Icon name="calendar-outline" size={18} color="#3b9fd8" />
            <Text style={modalStyles.planText}>{planLabel}</Text>
            {expiry ? (
              <Text style={modalStyles.expiryText}>
                {t('subscription.modal.validUntil', { date: expiry })}
              </Text>
            ) : null}
          </View>

          <TouchableOpacity
            style={modalStyles.button}
            activeOpacity={0.7}
            onPress={onDismiss}
          >
            <Text style={modalStyles.buttonText}>
              {t('subscription.actions.start')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  card: {
    width: '100%',
    backgroundColor: CARD_BG,
    borderRadius: 24,
    paddingVertical: 32,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  iconCircle: {
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: DARK,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: MUTED_TEXT,
    textAlign: 'center',
    marginBottom: 20,
  },
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(59,159,216,0.06)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 24,
  },
  planText: {
    fontSize: 14,
    fontWeight: '600',
    color: DARK,
  },
  expiryText: {
    fontSize: 12,
    color: MUTED_TEXT,
    marginLeft: 4,
  },
  button: {
    width: '100%',
    backgroundColor: DARK,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
});

export function SubscriptionScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { t, i18n } = useTranslation();
  const {
    user,
    subscription,
    loadSubscription,
    setSubscription,
    refreshToken,
    clearAuth,
    setSignedOutTransition,
  } = useAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isUploadingDiagnostics, setIsUploadingDiagnostics] = useState(false);
  const diagnosticAbortRef = useRef<AbortController | null>(null);

  // Which Apple-level plan the user is currently holding (null when on
  // account trial, post-expiry, or no Apple IAP yet). Drives the "目前
  // 方案" badge, card disable, and CTA copy.
  const currentPlan = resolveCurrentPlan(subscription);

  // selectedProductId tracks the Apple SKU the user has tapped on. Defaults
  // to null so the auto-select-first effect below picks the recommended /
  // first plan once the catalog resolves. Keying by product_id (instead of
  // the legacy 'monthly' | 'yearly' enum) lets us render N plans driven by
  // the server catalog while still mapping back to backend tier semantics
  // via the catalog `plan` / `tier` field for downgrade checks and
  // verify-receipt calls.
  const [selectedProductId, setSelectedProductId] = useState<string | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [showPaymentSuccess, setShowPaymentSuccess] = useState(false);
  /** Apple SKU consumed by the most recent successful purchase. Surfaces in
   *  the success modal as a localized plan name (looked up against the
   *  current catalog). */
  const [confirmedProductId, setConfirmedProductId] = useState<string | null>(
    null,
  );
  const [confirmedExpireAt, setConfirmedExpireAt] = useState<string | null>(
    null,
  );

  useEffect(
    () => () => {
      diagnosticAbortRef.current?.abort();
    },
    [],
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      recordDiagnosticsLog('SubscriptionScreen', 'focus refresh start');
      void getSubscriptionStatus()
        .then(info => {
          recordDiagnosticsLog('SubscriptionScreen', 'focus refresh success', {
            status: info.status,
            plan: info.plan,
          });
          if (!cancelled) setSubscription(info);
        })
        .catch(err => {
          recordDiagnosticsLog('SubscriptionScreen', 'focus refresh failed', {
            error: err instanceof Error ? err.message : String(err),
          });
          console.warn('[subscription] refresh on focus failed', err);
        });
      return () => {
        cancelled = true;
      };
    }, [setSubscription]),
  );

  const subscriptionDisplay = resolveSubscriptionDisplayState({
    subscription,
    user,
  });
  const canExitRootPaywall = isFeatureAccessAllowed(
    subscription?.status ?? user?.status,
  );
  // Always render a back affordance. The third branch (Subscription is the
  // stack root AND status forbids access — i.e. trial_expired / sub_expired
  // landed straight here from RootNavigator) used to be uncovered, leaving
  // the user with no way out short of force-killing the app. handleBackPress
  // resolves that case by logging out and letting RootNavigator remount
  // UnauthStack onto Login.
  const showBackButton = true;

  const [isRestoring, setIsRestoring] = useState(false);

  // Prices flow exclusively from StoreKit. There are NO numeric fallbacks
  // baked into i18n — fake-number fallbacks are worse than no number, since
  // they let users tap "Subscribe" against a stale price that StoreKit will
  // then reject. When StoreKit hasn't resolved (loading) or fails (sandbox
  // not configured, network down) the UI shows a neutral "—" placeholder
  // and the error banner / disabled CTA take over the messaging.
  //
  // Intl.NumberFormat keeps the derived strings (annualized strikethrough,
  // savings amount) visually consistent with Apple's localizedPrice for
  // the user's storefront. Hermes ships Intl since RN 0.74; on the rare
  // locale/currency combination that throws we degrade to "<currency>
  // <amount>" rather than crash.
  const formatPrice = useCallback(
    (amount: number, currency: string): string => {
      try {
        return new Intl.NumberFormat(i18n.language, {
          style: 'currency',
          currency,
          minimumFractionDigits: 0,
          maximumFractionDigits: 2,
        }).format(amount);
      } catch {
        return `${currency} ${amount.toFixed(2)}`;
      }
    },
    [i18n.language],
  );
  const formatSavings = useCallback(
    (savingsDisplay: string) =>
      t('subscription.plans.savingsTemplate', {
        amount: savingsDisplay,
      }),
    [t],
  );
  const {
    loading: plansLoading,
    productsLoading,
    error: plansError,
    plans: rawPlans,
    source: plansSource,
    refresh: refreshPlans,
  } = useSubscriptionPlans({ formatPrice, formatSavings });

  // Layout cap: paywall design assumes 1-3 cards in a single row. Server can
  // technically return more (extra promo SKUs, A/B variants), but rendering
  // 4+ cards in the same row breaks tile widths. Drop the overflow here and
  // surface a console.warn so QA notices the mis-config rather than shipping
  // a broken layout.
  const PLAN_LAYOUT_CAP = 3;
  const plans = useMemo<PlanWithProduct[]>(() => {
    // Filter out catalog rows whose Apple SKU didn't resolve via StoreKit —
    // ASC mis-config most commonly. We log the dropped product_id so QA
    // notices instead of silently rendering a placeholder card with "—".
    //
    // Exception: while either catalog or StoreKit lookup is still in
    // flight, `product` is legitimately null for bootstrap-seeded entries.
    // Keeping them rendered (with "—" price as last-resort fallback) is
    // the entire point of the seed — it prevents the blank-row flash on
    // cold open. Once both flips to false, genuinely-misconfigured SKUs
    // are dropped as before.
    const filtered = rawPlans.filter(entry => {
      if (entry.product != null) return true;
      if (plansLoading || productsLoading) return true;
      console.warn(
        '[SubscriptionScreen] dropping plan with no StoreKit product:',
        entry.plan.product_id,
      );
      return false;
    });
    if (filtered.length > PLAN_LAYOUT_CAP) {
      console.warn(
        '[SubscriptionScreen] catalog returned',
        filtered.length,
        'plans; capping render to first',
        PLAN_LAYOUT_CAP,
      );
      return filtered.slice(0, PLAN_LAYOUT_CAP);
    }
    return filtered;
  }, [rawPlans, plansLoading, productsLoading]);

  // Auto-select the first valid plan once the catalog resolves. Prefer the
  // recommended row when present (server intent), otherwise the first
  // post-sort entry. Re-runs only when the available SKU set changes so a
  // user-initiated tap is preserved across re-renders.
  useEffect(() => {
    if (plans.length === 0) {
      if (selectedProductId != null) setSelectedProductId(null);
      return;
    }
    const stillAvailable = plans.some(
      entry => entry.plan.product_id === selectedProductId,
    );
    if (stillAvailable) return;
    const recommended = plans.find(entry => entry.plan.recommended);
    setSelectedProductId((recommended ?? plans[0]).plan.product_id);
  }, [plans, selectedProductId]);

  // Reconcile selection if the user already holds the SKU they're pointing
  // at, OR if the SKU maps to a downgrade — flip to the first non-current,
  // non-downgrade plan. Keeps the CTA in a meaningful state without forcing
  // a "blank" UI before the user has explicitly tapped.
  const selectedEntry = useMemo<PlanWithProduct | null>(
    () =>
      plans.find(entry => entry.plan.product_id === selectedProductId) ?? null,
    [plans, selectedProductId],
  );
  const selectedPlanTier = useMemo<PlanKey | null>(() => {
    if (!selectedEntry) return null;
    return resolveSubscriptionPlanTier(selectedEntry.plan);
  }, [selectedEntry]);
  const selectedPlanIsCurrent =
    currentPlan != null &&
    selectedPlanTier != null &&
    selectedPlanTier === currentPlan;
  const selectedPlanIsDowngrade =
    selectedPlanTier != null && isDowngradePlan(currentPlan, selectedPlanTier);

  useEffect(() => {
    if (plans.length === 0) return;
    if (!selectedPlanIsCurrent && !selectedPlanIsDowngrade) return;
    // Find an alternative — preferring recommended, otherwise first non-self.
    const alternative = plans.find(entry => {
      const tier = resolveSubscriptionPlanTier(entry.plan);
      if (tier == null) return false;
      if (currentPlan != null && tier === currentPlan) return false;
      if (isDowngradePlan(currentPlan, tier)) return false;
      return true;
    });
    if (alternative) {
      setSelectedProductId(alternative.plan.product_id);
    }
  }, [plans, currentPlan, selectedPlanIsCurrent, selectedPlanIsDowngrade]);

  const handleRestore = useCallback(async () => {
    if (!FEATURES.IAP_ENABLED || !FEATURES.IAP_RESTORE_ENABLED) return;
    recordDiagnosticsLog('SubscriptionScreen', 'restore start');
    setIsRestoring(true);
    try {
      const restored = await iapService.restore();
      recordDiagnosticsLog('SubscriptionScreen', 'restore result', {
        count: restored.length,
      });
      if (restored.length === 0) {
        Alert.alert(t('subscription.restore.empty'));
        return;
      }
      await loadSubscription();
      recordDiagnosticsLog('SubscriptionScreen', 'restore success');
      Alert.alert(t('subscription.restore.success'));
    } catch (err) {
      const cls = classifyIapError(err);
      recordDiagnosticsLog('SubscriptionScreen', 'restore failed', {
        kind: cls.kind,
        i18nKey: cls.i18nKey,
      });
      Alert.alert(t((cls.i18nKey ?? 'subscription.restore.failed') as never));
    } finally {
      setIsRestoring(false);
    }
  }, [t, loadSubscription]);

  const handleUploadDiagnostics = useCallback(() => {
    if (isUploadingDiagnostics) return;
    recordDiagnosticsLog('SubscriptionScreen', 'diagnostics upload start');

    void (async () => {
      const { NativeSyncEngine } = NativeModules;
      if (!NativeSyncEngine?.exportDiagnostics) {
        recordDiagnosticsLog(
          'SubscriptionScreen',
          'diagnostics export unavailable',
        );
        Alert.alert(
          t('subscription.diagnostics.unavailableTitle'),
          t('subscription.diagnostics.unavailableBody'),
        );
        return;
      }

      const abortController = new AbortController();
      diagnosticAbortRef.current = abortController;
      setIsUploadingDiagnostics(true);

      try {
        const archivePath: string = await NativeSyncEngine.exportDiagnostics();
        recordDiagnosticsLog(
          'SubscriptionScreen',
          'diagnostics export success',
        );
        const archiveUrl = archivePath.startsWith('file://')
          ? archivePath
          : `file://${archivePath}`;
        const clientId = String(await NativeSyncEngine.getClientId());
        const result = await diagnosticUploadService.upload(
          archiveUrl,
          clientId,
          abortController.signal,
          undefined,
          'subscription-screen',
        );

        recordDiagnosticsLog(
          'SubscriptionScreen',
          'diagnostics upload success',
          {
            refId: result.refId,
          },
        );
        Clipboard.setString(result.refId);
        Alert.alert(
          t('subscription.diagnostics.successTitle'),
          t('subscription.diagnostics.successBody', {
            refId: result.refId,
          }),
        );
      } catch (error) {
        recordDiagnosticsLog(
          'SubscriptionScreen',
          'diagnostics upload failed',
          {
            error: error instanceof Error ? error.message : String(error),
          },
        );
        if (
          error instanceof DiagnosticUploadError &&
          error.detail.kind === 'BUNDLE_TOO_LARGE'
        ) {
          Alert.alert(t('subscription.diagnostics.tooLarge'));
        } else if (
          error instanceof DiagnosticUploadError &&
          error.detail.kind === 'ABORTED'
        ) {
          Alert.alert(t('subscription.diagnostics.aborted'));
        } else {
          Alert.alert(t('subscription.diagnostics.failure'));
        }
      } finally {
        diagnosticAbortRef.current = null;
        setIsUploadingDiagnostics(false);
      }
    })();
  }, [isUploadingDiagnostics, t]);

  const handleSubscribe = useCallback(async () => {
    if (!selectedEntry || selectedPlanTier == null) {
      // Catalog hasn't resolved yet, or selection couldn't map back to a
      // backend tier. Bail rather than guessing which entitlement to verify.
      return;
    }
    const targetProductId = selectedEntry.plan.product_id;
    const targetTier = selectedPlanTier;
    recordDiagnosticsLog('SubscriptionScreen', 'subscribe start', {
      productId: targetProductId,
      targetTier,
      currentPlan,
    });

    if (
      (currentPlan != null && targetTier === currentPlan) ||
      isDowngradePlan(currentPlan, targetTier)
    ) {
      recordDiagnosticsLog('SubscriptionScreen', 'subscribe blocked current', {
        productId: targetProductId,
        targetTier,
        currentPlan,
      });
      return;
    }

    if (!FEATURES.IAP_ENABLED) {
      recordDiagnosticsLog(
        'SubscriptionScreen',
        'subscribe blocked iap disabled',
      );
      Alert.alert(
        t('subscription.alert.devTitle'),
        t('subscription.alert.devBody'),
        [{ text: t('subscription.alert.devConfirm') }],
      );
      return;
    }

    setIsLoading(true);
    try {
      try {
        const fresh = await getSubscriptionStatus();
        setSubscription(fresh);
        const freshPlan = resolveCurrentPlan(fresh);
        recordDiagnosticsLog(
          'SubscriptionScreen',
          'subscribe preflight status',
          {
            status: fresh.status,
            plan: fresh.plan,
            freshPlan,
          },
        );
        if (
          (freshPlan != null && targetTier === freshPlan) ||
          isDowngradePlan(freshPlan, targetTier)
        ) {
          recordDiagnosticsLog(
            'SubscriptionScreen',
            'subscribe blocked by preflight',
            {
              targetTier,
              freshPlan,
            },
          );
          return;
        }
      } catch (err) {
        recordDiagnosticsLog(
          'SubscriptionScreen',
          'subscribe preflight failed',
          {
            error: err instanceof Error ? err.message : String(err),
          },
        );
        console.warn('[subscription] preflight refresh failed', err);
      }

      const receipt = await iapService.purchase(targetProductId);
      recordDiagnosticsLog('SubscriptionScreen', 'purchase resolved', {
        productId: receipt.productId,
        hasReceipt: receipt.transactionReceipt.length > 0,
        hasTransactionId: receipt.transactionId.length > 0,
      });
      let receiptData = receipt.transactionReceipt;
      const isPlanSwitch = currentPlan != null && currentPlan !== targetTier;
      const receiptProductMatchesSelection =
        receipt.productId === targetProductId;
      const shouldRefreshReceiptOnMismatch =
        isPlanSwitch || !receiptProductMatchesSelection;
      let refreshedAfterMismatch = false;

      // Retry verify twice (1s → 4s) before surfacing error — Apple already
      // charged, so we must try hard before handing retry to the user.
      let verified = false;
      // Set when `verified` was reached via server code 2002 (receipt already
      // used). Server recognised the transaction but wrote nothing new — it's
      // only a real success when the canonical subscription state still grants
      // access. Drives the post-verify guard below that blocks a misleading
      // "支付成功" modal for stale StoreKit replays (sandbox 12-renew cap,
      // orphan redeliveries after a previous sub expired).
      let verifiedViaSilentSuccess = false;
      const delays = [0, 1_000, 4_000];
      let lastErr: unknown = null;
      let refreshedAfterVerifyFailure = false;
      let shouldPollAfterStaleMismatch = false;
      for (const delay of delays) {
        if (delay > 0) await wait(delay);
        try {
          await verifyIapReceipt(
            receiptData,
            targetTier,
            targetProductId,
            receipt.transactionId,
          );
          verified = true;
          recordDiagnosticsLog('SubscriptionScreen', 'verify success', {
            targetTier,
            attempt: delay === 0 ? 1 : delay === 1_000 ? 2 : 3,
          });
          break;
        } catch (err) {
          const cls = classifyIapError(err);
          recordDiagnosticsLog('SubscriptionScreen', 'verify attempt failed', {
            targetTier,
            kind: cls.kind,
            i18nKey: cls.i18nKey,
          });
          if (cls.kind === IapErrorClass.SilentSuccess) {
            verified = true;
            verifiedViaSilentSuccess = true;
            recordDiagnosticsLog(
              'SubscriptionScreen',
              'verify silent success',
              {
                targetTier,
              },
            );
            break;
          }
          if (cls.kind === IapErrorClass.FatalMismatch) {
            const isProductIdMismatch =
              typeof err === 'object' &&
              err !== null &&
              'code' in err &&
              (err as { code?: unknown }).code ===
                ERROR_CODE.PRODUCT_ID_MISMATCH;
            if (shouldRefreshReceiptOnMismatch && !refreshedAfterMismatch) {
              // StoreKit can briefly expose the previous subscription-group
              // receipt after a plan switch or return the old SKU in the
              // purchase event even after the user selected a new SKU. Refresh
              // once before treating the backend mismatch as a real product
              // configuration error.
              refreshedAfterMismatch = true;
              const refreshedReceipt = await iapService.refreshReceipt();
              if (refreshedReceipt) {
                recordDiagnosticsLog(
                  'SubscriptionScreen',
                  'verify mismatch refreshed receipt',
                  {
                    targetTier,
                    targetProductId,
                    receiptProductId: receipt.productId,
                    isPlanSwitch,
                    receiptProductMatchesSelection,
                  },
                );
                receiptData = refreshedReceipt;
                lastErr = err;
                continue;
              }
            }
            if (shouldRefreshReceiptOnMismatch && isProductIdMismatch) {
              shouldPollAfterStaleMismatch = true;
              lastErr = err;
              recordDiagnosticsLog(
                'SubscriptionScreen',
                'verify product mismatch deferred polling',
                {
                  targetTier,
                  targetProductId,
                  receiptProductId: receipt.productId,
                  isPlanSwitch,
                  receiptProductMatchesSelection,
                },
              );
              break;
            }
            await iapService.finishTransaction(receipt.transactionId);
            recordDiagnosticsLog(
              'SubscriptionScreen',
              'verify fatal mismatch',
              {
                targetTier,
                isPlanSwitch,
                receiptProductMatchesSelection,
              },
            );
            // cls.i18nKey is always a valid translation key for FatalMismatch
            if (cls.i18nKey) Alert.alert(t(cls.i18nKey as never));
            return;
          }
          const isIapVerifyFailed =
            typeof err === 'object' &&
            err !== null &&
            'code' in err &&
            (err as { code?: unknown }).code === ERROR_CODE.IAP_VERIFY_FAILED;
          if (isIapVerifyFailed && !refreshedAfterVerifyFailure) {
            refreshedAfterVerifyFailure = true;
            const refreshedReceipt = await iapService.refreshReceipt();
            if (refreshedReceipt) {
              recordDiagnosticsLog(
                'SubscriptionScreen',
                'verify failure refreshed receipt',
                {
                  targetTier,
                  targetProductId,
                  receiptProductId: receipt.productId,
                },
              );
              receiptData = refreshedReceipt;
              lastErr = err;
              continue;
            }
          }
          lastErr = err;
          // Retryable / network — loop continues.
        }
      }

      let fresh: SubscriptionInfo | null = null;
      if (!verified) {
        const cls = classifyIapError(lastErr);
        recordDiagnosticsLog('SubscriptionScreen', 'verify exhausted', {
          targetTier,
          kind: cls.kind,
          i18nKey: cls.i18nKey,
        });
        if (
          cls.kind === IapErrorClass.Retryable ||
          shouldPollAfterStaleMismatch
        ) {
          for (const delay of POST_VERIFY_STATUS_POLL_DELAYS_MS) {
            await wait(delay);
            try {
              const candidate = await loadSubscription();
              recordDiagnosticsLog(
                'SubscriptionScreen',
                'post-verify poll status',
                {
                  targetTier,
                  status: candidate.status,
                  plan: candidate.plan,
                },
              );
              if (
                candidate.status === 'subscribed' &&
                candidate.plan === targetTier
              ) {
                fresh = candidate;
                verified = true;
                recordDiagnosticsLog(
                  'SubscriptionScreen',
                  'post-verify poll recovered',
                  {
                    targetTier,
                  },
                );
                break;
              }
            } catch {
              recordDiagnosticsLog(
                'SubscriptionScreen',
                'post-verify poll failed',
                {
                  targetTier,
                },
              );
            }
          }
        }
        if (!verified) {
          if (shouldPollAfterStaleMismatch) {
            Alert.alert(t('subscription.errors.verifyRetrying'));
            return;
          }
          if (cls.kind === IapErrorClass.FatalMismatch) {
            await iapService.finishTransaction(receipt.transactionId);
          }
          Alert.alert(
            t((cls.i18nKey ?? 'subscription.errors.verifyRetrying') as never),
          );
          return;
        }
      }

      // loadSubscription returns the freshly-fetched snapshot so we can
      // render the success modal's "valid until" line without waiting for
      // React to re-render with the new context value. If the backend hasn't
      // yet reflected the upgraded plan, expireAt may still be the previous
      // period — acceptable degradation vs. hiding the date entirely.
      if (fresh == null) {
        try {
          fresh = await loadSubscription();
          recordDiagnosticsLog(
            'SubscriptionScreen',
            'post-verify load success',
            {
              status: fresh?.status,
              plan: fresh?.plan,
            },
          );
          if (
            fresh &&
            isPlanSwitch &&
            fresh.plan !== targetTier &&
            (fresh.status === 'subscribed' || fresh.status === 'trialing')
          ) {
            fresh = { ...fresh, plan: targetTier };
            setSubscription(fresh);
          }
        } catch {
          recordDiagnosticsLog('SubscriptionScreen', 'post-verify load failed');
          // Fall through — modal will just hide the expiry line.
        }
      }

      // When `verified` came from a 2002 silent-success AND the server's
      // canonical view still doesn't grant access, the StoreKit transaction
      // we just consumed was stale (sandbox replay / expired prior sub).
      // Surface the truth instead of misleading the user with a success
      // modal that the RootNavigator will immediately bounce away from.
      // `fresh == null` = loadSubscription threw; no evidence to block on,
      // degrade to the legacy lenient behaviour.
      if (
        verifiedViaSilentSuccess &&
        fresh != null &&
        !isFeatureAccessAllowed(fresh.status)
      ) {
        // Show the user-facing truth FIRST — if finishTransaction throws,
        // StoreKit will redeliver the same stale tx on next launch and the
        // orphan path will re-finish it, so the queue self-heals. Losing
        // the accurate alert copy would be the actual user-visible regression.
        Alert.alert(t('subscription.errors.receiptStaleNoActive'));
        await iapService
          .finishTransaction(receipt.transactionId)
          .catch(() => {});
        recordDiagnosticsLog('SubscriptionScreen', 'silent success rejected', {
          targetTier,
        });
        return;
      }

      await iapService.finishTransaction(receipt.transactionId);
      markSubscriptionJustActivated();
      setConfirmedProductId(targetProductId);
      setConfirmedExpireAt(fresh?.expireAt ?? null);
      setShowPaymentSuccess(true);
      recordDiagnosticsLog('SubscriptionScreen', 'subscribe success', {
        productId: targetProductId,
        targetTier,
      });
    } catch (err) {
      const cls = classifyIapError(err);
      recordDiagnosticsLog('SubscriptionScreen', 'subscribe failed', {
        kind: cls.kind,
        i18nKey: cls.i18nKey,
      });
      if (cls.kind === IapErrorClass.Cancelled) {
        return; // silent
      }
      if (cls.kind === IapErrorClass.AlreadyOwned) {
        // User tapped Subscribe while already holding an active sub (e.g.
        // trying to switch plans). Surface an explicit alert instead of
        // auto-triggering Restore — that made the old flow look like the
        // plan switch silently succeeded.
        Alert.alert(
          t((cls.i18nKey ?? 'subscription.errors.alreadyOwned') as never),
        );
        return;
      }
      if (cls.kind === IapErrorClass.AutoRestore) {
        void handleRestore();
        return;
      }
      if (cls.i18nKey) {
        Alert.alert(t(cls.i18nKey as never));
      }
    } finally {
      setIsLoading(false);
    }
  }, [
    t,
    selectedEntry,
    selectedPlanTier,
    currentPlan,
    loadSubscription,
    setSubscription,
    handleRestore,
  ]);

  const resetToPostSubscriptionRoute = useCallback(async () => {
    const route = await resolvePostSubscriptionRoute();
    navigation.reset({
      index: 0,
      routes: [{ name: route }],
    });
  }, [navigation]);

  const handlePaymentSuccessDismiss = useCallback(() => {
    setShowPaymentSuccess(false);
    // Came from Settings / elsewhere → return there. Came from login
    // (Subscription is the stack root for trial_expired / sub_expired) →
    // no back entry exists, so reset into the normal authed flow.
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      void resetToPostSubscriptionRoute();
    }
  }, [navigation, resetToPostSubscriptionRoute]);

  // Mirrors SettingsScreen.handleLogout ordering — see that file for the
  // load-bearing rationale: wipeSyncIdentity must run before clearAuth so
  // the keychain identity is gone before the navigator unmounts AuthedStack;
  // serverLogout must run before clearAuth so the in-memory access token is
  // still available to compose the Authorization header.
  const handleLogoutAndReturnToLogin = useCallback(() => {
    if (isLoggingOut) return;
    Alert.alert(
      t('subscription.backToLogin.title'),
      t('subscription.backToLogin.body'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('subscription.backToLogin.confirm'),
          style: 'destructive',
          onPress: async () => {
            if (isLoggingOut) return;
            setIsLoggingOut(true);
            const refresh = refreshToken;
            try {
              await resetCurrentDesktopSidecarIfReachable();
            } catch (e) {
              console.warn(
                '[Subscription] desktop sidecar reset threw (ignored):',
                e,
              );
            }
            try {
              await wipeSyncIdentity();
            } catch (e) {
              console.warn(
                '[Subscription] wipeSyncIdentity failed — aborting logout to avoid residual identity:',
                e,
              );
              Alert.alert(
                '登出失敗',
                '未能完整清理本機資料，請稍後再試。若持續失敗，請重新啟動應用程式。',
              );
              setIsLoggingOut(false);
              return;
            }
            try {
              await clearUserScopedStorage();
            } catch (e) {
              console.warn(
                '[Subscription] clearUserScopedStorage failed (ignored):',
                e,
              );
            }
            if (refresh) {
              void serverLogout(refresh).catch(e => {
                console.warn(
                  '[Subscription] server logout failed (already cleared locally):',
                  e,
                );
              });
            }
            setSignedOutTransition('logout');
            try {
              clearAuth();
            } catch (e) {
              console.warn('[Subscription] local logout error:', e);
            }
            // clearAuth triggers RootNavigator to swap to UnauthStack and
            // unmount this screen, so resetting isLoggingOut is unnecessary.
          },
        },
      ],
    );
  }, [clearAuth, isLoggingOut, refreshToken, setSignedOutTransition, t]);

  const handleBackPress = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    if (canExitRootPaywall) {
      void resetToPostSubscriptionRoute();
      return;
    }
    // Stuck on the expired-subscription paywall (Subscription is the stack
    // root + status forbids feature access). The only escape that keeps
    // navigation state coherent is to log out, which triggers RootNavigator
    // to remount UnauthStack and land the user on Login.
    handleLogoutAndReturnToLogin();
  }, [
    canExitRootPaywall,
    handleLogoutAndReturnToLogin,
    navigation,
    resetToPostSubscriptionRoute,
  ]);

  const subscribeButtonLabel =
    currentPlan === 'yearly'
      ? t('subscription.actions.currentYearly')
      : currentPlan && selectedPlanTier && selectedPlanTier !== currentPlan
        ? t('subscription.actions.switchPlan')
        : t('subscription.actions.subscribe');

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        {showBackButton ? (
          <TouchableOpacity
            style={styles.backButton}
            activeOpacity={0.6}
            hitSlop={{ top: 15, bottom: 15, left: 15, right: 30 }}
            onPress={handleBackPress}
            disabled={isLoggingOut}
            accessibilityLabel={t('common.back')}
          >
            {isLoggingOut ? (
              <ActivityIndicator size="small" color={DARK} />
            ) : (
              <Icon name="chevron-back" size={20} color={DARK} />
            )}
          </TouchableOpacity>
        ) : null}
        <Text style={styles.headerTitle}>{t('subscription.title')}</Text>
        <TouchableOpacity
          style={styles.diagnosticsButton}
          activeOpacity={0.7}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          onPress={handleUploadDiagnostics}
          disabled={isUploadingDiagnostics || isLoggingOut}
          accessibilityLabel={t('subscription.diagnostics.button')}
        >
          {isUploadingDiagnostics ? (
            <ActivityIndicator size="small" color={DARK} />
          ) : (
            <Icon name="cloud-upload-outline" size={20} color={DARK} />
          )}
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroSection}>
          <Text style={styles.heroTitle}>{t('subscription.hero.title')}</Text>
          <Text style={styles.heroSubtitle}>
            {t('subscription.hero.subtitle')}
          </Text>
          {subscriptionDisplay.kind !== 'unknown' ? (
            <StatusBadge displayState={subscriptionDisplay} t={t} />
          ) : null}
        </View>

        <View style={styles.featureCard}>
          <FeatureList t={t} />
        </View>

        <View
          style={[
            styles.planRow,
            // Dim during the cold-start StoreKit fetch so the price swap
            // (priceFallback → real localizedPrice) reads as "loading then
            // settled" instead of a jarring text replacement. Once products
            // are resolved (or refresh after error) we restore full opacity.
            plansLoading && styles.planRowLoading,
          ]}
        >
          {plans.map(entry => {
            const product = entry.product;
            // entry.product is non-null here — `plans` filtered out null
            // products above. Cast keeps TS happy without an extra guard.
            const tier = resolveSubscriptionPlanTier(entry.plan);
            const cardIsCurrent = tier != null && currentPlan === tier;
            const cardIsDowngrade =
              tier != null && isDowngradePlan(currentPlan, tier);
            const unitLabel = product ? periodLabel(product, '', t) : '';
            return (
              <SubscriptionPlanCard
                key={entry.plan.product_id}
                title={entry.plan.name}
                description={entry.plan.description}
                badges={entry.plan.badges}
                width={planCardWidth(plans.length)}
                price={product?.displayPrice ?? '—'}
                unit={unitLabel}
                oldPrice={entry.savings?.annualizedMonthlyDisplay}
                savingsBadge={entry.savings?.display}
                selected={selectedProductId === entry.plan.product_id}
                disabled={cardIsCurrent || cardIsDowngrade}
                recommended={entry.plan.recommended}
                currentBadge={
                  cardIsCurrent
                    ? t('subscription.plans.currentPlan')
                    : undefined
                }
                onPress={() => setSelectedProductId(entry.plan.product_id)}
              />
            );
          })}
        </View>

        {(plansError || (FEATURES.IAP_ENABLED && plans.length === 0)) &&
        FEATURES.IAP_ENABLED ? (
          <TouchableOpacity
            style={styles.errorBanner}
            activeOpacity={0.7}
            onPress={() => {
              void refreshPlans();
            }}
            accessibilityLabel={t('common.retry')}
          >
            <Text style={styles.errorBannerText} numberOfLines={2}>
              {t('subscription.errors.productsUnavailable')}
            </Text>
            <Text style={styles.errorBannerRetry}>{t('common.retry')}</Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          style={styles.subscribeButton}
          activeOpacity={0.7}
          disabled={
            isLoading ||
            selectedEntry == null ||
            // Block while StoreKit lookup is in flight. The hook may have
            // already populated the catalog (plansLoading=false) but the
            // displayed price is still the bootstrap seed until products
            // resolve — letting the user tap Subscribe against an
            // unverified amount risks an Apple-side rejection.
            productsLoading ||
            // Post-loading safety net: if both catalog and StoreKit
            // resolved but the selected plan still has no product (genuine
            // ASC mis-config / sandbox not signed in), we cannot price the
            // purchase — block it.
            selectedEntry?.product == null ||
            selectedPlanIsCurrent ||
            selectedPlanIsDowngrade ||
            (plansError != null && FEATURES.IAP_ENABLED)
          }
          onPress={() => {
            void handleSubscribe();
          }}
        >
          {isLoading ? (
            <ActivityIndicator color="#ffffff" size="small" />
          ) : (
            <Text style={styles.subscribeButtonText}>
              {subscribeButtonLabel}
            </Text>
          )}
        </TouchableOpacity>

        {FEATURES.IAP_ENABLED && FEATURES.IAP_RESTORE_ENABLED ? (
          <TouchableOpacity
            onPress={handleRestore}
            disabled={isRestoring}
            accessibilityLabel={t('subscription.restore.action')}
            style={styles.restoreButton}
          >
            <Text style={styles.restoreText}>
              {isRestoring
                ? t('subscription.restore.inProgress')
                : t('subscription.restore.action')}
            </Text>
          </TouchableOpacity>
        ) : null}

        <Text style={styles.footerText}>{t('subscription.footer')}</Text>
        {plansSource === 'bootstrap' ? (
          <Text style={styles.offlineNote}>
            {t('subscription.plans.offlineMode')}
          </Text>
        ) : null}
        <View style={styles.bottomSpacer} />
      </ScrollView>

      <PaymentSuccessModal
        visible={showPaymentSuccess}
        planLabel={
          confirmedProductId
            ? getPlanDisplayName(confirmedProductId, plans, t)
            : t('subscription.plans.fallback')
        }
        expireAt={confirmedExpireAt}
        onDismiss={handlePaymentSuccessDismiss}
        t={t}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: SCREEN_BG,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 12,
    gap: 12,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: 'bold',
    color: '#32475b',
  },
  diagnosticsButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 40,
  },
  heroSection: {
    alignItems: 'flex-start',
    marginBottom: 18,
    paddingTop: 4,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#2b2f35',
    marginBottom: 6,
  },
  heroSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: '#8b98a7',
    marginBottom: 12,
  },
  featureCard: {
    backgroundColor: CARD_BG,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    paddingHorizontal: 18,
    paddingVertical: 16,
    marginBottom: 20,
    shadowColor: '#4f8fbc',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 2,
  },
  planRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: PLAN_CARD_GAP,
    marginBottom: 20,
  },
  planRowLoading: {
    opacity: 0.55,
  },
  subscribeButton: {
    backgroundColor: DARK,
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    marginBottom: 10,
    shadowColor: DARK,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 3,
  },
  subscribeButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#ffffff',
  },
  footerText: {
    fontSize: 12,
    color: '#b2bccc',
    textAlign: 'center',
    lineHeight: 18,
  },
  offlineNote: {
    fontSize: 11,
    color: '#9aa6b3',
    textAlign: 'center',
    marginTop: 8,
  },
  restoreButton: {
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  restoreText: {
    fontSize: 13,
    color: MUTED_TEXT,
    textDecorationLine: 'underline',
  },
  bottomSpacer: {
    height: 20,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(229, 57, 53, 0.08)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
    gap: 12,
  },
  errorBannerText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: DESTRUCTIVE_RED,
  },
  errorBannerRetry: {
    fontSize: 13,
    fontWeight: '700',
    color: DESTRUCTIVE_RED,
    textDecorationLine: 'underline',
  },
});
