import React, { useState, useCallback, useEffect } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { Icon } from '../components/Icon';
import {
  SUBSCRIPTION_STATUS_ICON_BACKGROUNDS,
  SUBSCRIPTION_STATUS_ICON_COLORS,
  SubscriptionStatusIcon,
  getSubscriptionStatusIconTone,
} from '../components/SubscriptionStatusIcon';
import { isFeatureAccessAllowed, useAuth } from '../stores/auth-store';
import { iapService } from '../services/iap-service';
import { planToProductId } from '../constants/iap';
import { useStoreProducts } from '../hooks/useStoreProducts';
import { classifyIapError, IapErrorClass } from '../services/iap-errors';
import { markSubscriptionJustActivated } from '../hooks/useExpiryReminder';
import {
  getSubscriptionStatus,
  verifyIapReceipt,
} from '../services/subscription-service';
import { FEATURES } from '../constants/features';
import {
  resolveSubscriptionDisplayState,
  type SubscriptionDisplayState,
} from '../utils/subscriptionStatusDisplay';

const DARK = '#202022';
const SCREEN_BG = '#d6ecf8';
const CARD_BG = '#ffffff';
const CARD_BORDER = 'rgba(187, 214, 233, 0.72)';
const MUTED_TEXT = '#7893ab';
const SUCCESS_GREEN = '#22c55e';
const DESTRUCTIVE_RED = '#e53935';
const PLAN_DISABLED_BG = '#edf5fb';
const PLAN_DISABLED_TEXT = '#afb6bf';
const PLAN_SELECTED_BORDER = '#3a3a3d';
const CHECK_BG = 'rgba(83, 200, 120, 0.12)';
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PLAN_CARD_GAP = 12;
const PLAN_CARD_HORIZONTAL_PADDING = 16;
const PLAN_CARD_WIDTH =
  (SCREEN_WIDTH - PLAN_CARD_HORIZONTAL_PADDING * 2 - PLAN_CARD_GAP) / 2;

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

const DEFAULT_SELECTED_PLAN: PlanKey = 'yearly';

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

function getPlanDisplayName(plan: string, t: TFunction): string {
  switch (plan) {
    case 'monthly':
      return t('subscription.plans.monthly.name');
    case 'yearly':
      return t('subscription.plans.yearly.name');
    default:
      return plan || t('subscription.plans.fallback');
  }
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

function PlanCard({
  price,
  unit,
  oldPrice,
  savingsBadge,
  selected,
  disabled,
  currentBadge,
  onPress,
}: {
  price: string;
  unit: string;
  oldPrice?: string;
  savingsBadge?: string;
  selected: boolean;
  disabled?: boolean;
  /** When set, renders a small "目前方案" / "Current Plan" label in the
   *  top-right corner. Callers should also pass `disabled` to block the
   *  pointless self-select tap. */
  currentBadge?: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[
        planStyles.card,
        disabled
          ? planStyles.cardDisabled
          : selected
          ? planStyles.cardSelected
          : planStyles.cardUnselected,
      ]}
      activeOpacity={0.82}
      onPress={onPress}
      disabled={disabled}
    >
      {currentBadge ? (
        <View style={planStyles.currentBadge}>
          <Text style={planStyles.currentBadgeText}>{currentBadge}</Text>
        </View>
      ) : null}
      <Text
        style={[
          planStyles.price,
          disabled
            ? planStyles.textDisabled
            : selected
            ? planStyles.textSelected
            : planStyles.textUnselected,
        ]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {price}
      </Text>
      <Text
        style={[
          planStyles.unit,
          disabled
            ? planStyles.unitDisabled
            : selected
            ? planStyles.unitSelected
            : planStyles.unitUnselected,
        ]}
        numberOfLines={1}
      >
        {unit}
      </Text>
      {oldPrice ? (
        <View style={planStyles.metaRow}>
          <Text
            style={planStyles.oldPrice}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
          >
            {oldPrice}
          </Text>
          {savingsBadge ? (
            <View style={planStyles.savingsBadge}>
              <Text
                style={planStyles.savingsBadgeText}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
              >
                {savingsBadge}
              </Text>
            </View>
          ) : null}
        </View>
      ) : (
        <View style={planStyles.metaSpacer} />
      )}
    </TouchableOpacity>
  );
}

const planStyles = StyleSheet.create({
  card: {
    width: PLAN_CARD_WIDTH,
    minHeight: 142,
    borderRadius: 18,
    borderWidth: 1.5,
    paddingVertical: 18,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardSelected: {
    backgroundColor: CARD_BG,
    borderColor: PLAN_SELECTED_BORDER,
    shadowColor: '#1f2937',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  cardUnselected: {
    backgroundColor: CARD_BG,
    borderColor: CARD_BORDER,
  },
  cardDisabled: {
    backgroundColor: PLAN_DISABLED_BG,
    borderColor: 'rgba(196, 214, 228, 0.72)',
  },
  price: {
    fontSize: 24,
    fontWeight: '800',
  },
  textSelected: {
    color: DARK,
  },
  textUnselected: {
    color: DARK,
  },
  textDisabled: {
    color: PLAN_DISABLED_TEXT,
  },
  unit: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 2,
  },
  unitSelected: {
    color: '#6f747c',
  },
  unitUnselected: {
    color: MUTED_TEXT,
  },
  unitDisabled: {
    color: '#c2c8cf',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  metaSpacer: {
    height: 23,
    marginTop: 10,
  },
  oldPrice: {
    fontSize: 11,
    color: '#b9b0b0',
    textDecorationLine: 'line-through',
  },
  savingsBadge: {
    backgroundColor: DESTRUCTIVE_RED,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  savingsBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#ffffff',
  },
  currentBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(83, 200, 120, 0.16)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  currentBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#2e7d4f',
  },
});

function PaymentSuccessModal({
  visible,
  plan,
  expireAt,
  onDismiss,
  t,
}: {
  visible: boolean;
  plan: string;
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
            <Text style={modalStyles.planText}>
              {getPlanDisplayName(plan, t)}
            </Text>
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
  const { user, subscription, loadSubscription, setSubscription } = useAuth();

  // Which Apple-level plan the user is currently holding (null when on
  // account trial, post-expiry, or no Apple IAP yet). Drives the "目前
  // 方案" badge, card disable, and CTA copy.
  const currentPlan = resolveCurrentPlan(subscription);

  // Default to the yearly SKU. Monthly holders can upgrade; yearly holders
  // stay on their current plan because this screen intentionally blocks
  // yearly -> monthly downgrade.
  const [selectedPlan, setSelectedPlan] = useState<PlanKey>(
    DEFAULT_SELECTED_PLAN,
  );
  const selectedPlanIsCurrent =
    currentPlan != null && selectedPlan === currentPlan;
  const selectedPlanIsDowngrade = isDowngradePlan(currentPlan, selectedPlan);
  const [isLoading, setIsLoading] = useState(false);
  const [showPaymentSuccess, setShowPaymentSuccess] = useState(false);
  const [confirmedPlan, setConfirmedPlan] = useState<PlanKey>('yearly');
  const [confirmedExpireAt, setConfirmedExpireAt] = useState<string | null>(
    null,
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void getSubscriptionStatus()
        .then(info => {
          if (!cancelled) setSubscription(info);
        })
        .catch(err => {
          console.warn('[subscription] refresh on focus failed', err);
        });
      return () => {
        cancelled = true;
      };
    }, [setSubscription]),
  );

  useEffect(() => {
    if (
      currentPlan != null &&
      (selectedPlan === currentPlan ||
        isDowngradePlan(currentPlan, selectedPlan))
    ) {
      setSelectedPlan(DEFAULT_SELECTED_PLAN);
    }
  }, [currentPlan, selectedPlan]);

  const subscriptionDisplay = resolveSubscriptionDisplayState({
    subscription,
    user,
  });
  const canExitRootPaywall = isFeatureAccessAllowed(
    subscription?.status ?? user?.status,
  );
  const showBackButton = navigation.canGoBack() || canExitRootPaywall;

  const [isRestoring, setIsRestoring] = useState(false);

  // StoreKit-sourced prices. Falls back to i18n strings when IAP is gated
  // off (CI / unit tests) or when StoreKit returns no products (sandbox not
  // configured, network failure). Currency / formatting flows from Apple,
  // not the codebase, so the same screen renders correct prices for any
  // storefront the user is signed into.
  // Use Intl.NumberFormat so the strikethrough + savings string visually
  // matches Apple's localizedPrice (e.g. "¥118.80" rather than "CNY 118.80").
  // Locale comes from i18next so a Hant user on a CN storefront still sees
  // "¥118.80" while a US-storefront user sees "$1,299.00" with their grouping
  // separators. Hermes ships Intl since RN 0.74; falls back to a simple
  // "<currency> <amount>" string if Intl/currency throws on an obscure locale.
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
      t('subscription.plans.yearly.savingsTemplate', {
        amount: savingsDisplay,
        defaultValue: t('subscription.plans.yearly.savings'),
      }),
    [t],
  );
  const storeProducts = useStoreProducts({ formatPrice, formatSavings });
  const monthlyPriceLabel =
    storeProducts.monthly?.displayPrice ??
    t('subscription.plans.monthly.priceFallback');
  const yearlyPriceLabel =
    storeProducts.yearly?.displayPrice ??
    t('subscription.plans.yearly.priceFallback');
  const yearlyOldPriceLabel =
    storeProducts.yearlySavings?.annualizedMonthlyDisplay ??
    t('subscription.plans.yearly.oldPrice');
  const yearlySavingsLabel =
    storeProducts.yearlySavings?.display ??
    t('subscription.plans.yearly.savings');

  const handleRestore = useCallback(async () => {
    if (!FEATURES.IAP_ENABLED || !FEATURES.IAP_RESTORE_ENABLED) return;
    setIsRestoring(true);
    try {
      const restored = await iapService.restore();
      if (restored.length === 0) {
        Alert.alert(t('subscription.restore.empty'));
        return;
      }
      await loadSubscription();
      Alert.alert(t('subscription.restore.success'));
    } catch (err) {
      const cls = classifyIapError(err);
      Alert.alert(t((cls.i18nKey ?? 'subscription.restore.failed') as never));
    } finally {
      setIsRestoring(false);
    }
  }, [t, loadSubscription]);

  const handleSubscribe = useCallback(async () => {
    if (
      (currentPlan != null && selectedPlan === currentPlan) ||
      isDowngradePlan(currentPlan, selectedPlan)
    ) {
      return;
    }

    if (!FEATURES.IAP_ENABLED) {
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
        if (
          (freshPlan != null && selectedPlan === freshPlan) ||
          isDowngradePlan(freshPlan, selectedPlan)
        ) {
          return;
        }
      } catch (err) {
        console.warn('[subscription] preflight refresh failed', err);
      }

      const productId = planToProductId(selectedPlan);
      const receipt = await iapService.purchase(productId);
      let receiptData = receipt.transactionReceipt;
      const isPlanSwitch = currentPlan != null && currentPlan !== selectedPlan;

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
      for (const delay of delays) {
        if (delay > 0) await new Promise<void>(r => setTimeout(r, delay));
        try {
          await verifyIapReceipt(receiptData, selectedPlan);
          verified = true;
          break;
        } catch (err) {
          const cls = classifyIapError(err);
          if (cls.kind === IapErrorClass.SilentSuccess) {
            verified = true;
            verifiedViaSilentSuccess = true;
            break;
          }
          if (cls.kind === IapErrorClass.FatalMismatch) {
            if (isPlanSwitch) {
              // StoreKit can briefly expose the previous subscription-group
              // receipt after a plan switch. Refresh once before treating the
              // backend mismatch as a real product configuration error.
              const refreshedReceipt = await iapService.refreshReceipt();
              if (refreshedReceipt) {
                receiptData = refreshedReceipt;
                lastErr = err;
                continue;
              }
            }
            await iapService.finishTransaction(receipt.transactionId);
            // cls.i18nKey is always a valid translation key for FatalMismatch
            if (cls.i18nKey) Alert.alert(t(cls.i18nKey as never));
            return;
          }
          lastErr = err;
          // Retryable / network — loop continues.
        }
      }

      if (!verified) {
        const cls = classifyIapError(lastErr);
        if (cls.kind === IapErrorClass.FatalMismatch) {
          await iapService.finishTransaction(receipt.transactionId);
        }
        Alert.alert(
          t((cls.i18nKey ?? 'subscription.errors.verifyRetrying') as never),
        );
        return;
      }

      // loadSubscription returns the freshly-fetched snapshot so we can
      // render the success modal's "valid until" line without waiting for
      // React to re-render with the new context value. If the backend hasn't
      // yet reflected the upgraded plan, expireAt may still be the previous
      // period — acceptable degradation vs. hiding the date entirely.
      let fresh: typeof subscription = null;
      try {
        fresh = await loadSubscription();
        if (
          fresh &&
          isPlanSwitch &&
          fresh.plan !== selectedPlan &&
          (fresh.status === 'subscribed' || fresh.status === 'trialing')
        ) {
          fresh = { ...fresh, plan: selectedPlan };
          setSubscription(fresh);
        }
      } catch {
        // Fall through — modal will just hide the expiry line.
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
        return;
      }

      await iapService.finishTransaction(receipt.transactionId);
      markSubscriptionJustActivated();
      setConfirmedPlan(selectedPlan);
      setConfirmedExpireAt(fresh?.expireAt ?? null);
      setShowPaymentSuccess(true);
    } catch (err) {
      const cls = classifyIapError(err);
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
  }, [t, selectedPlan, currentPlan, loadSubscription, setSubscription]);

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

  const handleBackPress = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    if (canExitRootPaywall) {
      void resetToPostSubscriptionRoute();
    }
  }, [canExitRootPaywall, navigation, resetToPostSubscriptionRoute]);

  const subscribeButtonLabel =
    currentPlan === 'yearly'
      ? t('subscription.actions.currentYearly')
      : currentPlan && selectedPlan !== currentPlan
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
            accessibilityLabel={t('common.back')}
          >
            <Icon name="chevron-back" size={20} color={DARK} />
          </TouchableOpacity>
        ) : null}
        <Text style={styles.headerTitle}>{t('subscription.title')}</Text>
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
            storeProducts.loading && styles.planRowLoading,
          ]}
        >
          <PlanCard
            price={monthlyPriceLabel}
            unit={t('subscription.plans.monthly.unit')}
            selected={selectedPlan === 'monthly'}
            disabled={
              currentPlan === 'monthly' ||
              isDowngradePlan(currentPlan, 'monthly')
            }
            currentBadge={
              currentPlan === 'monthly'
                ? t('subscription.plans.currentPlan')
                : undefined
            }
            onPress={() => setSelectedPlan('monthly')}
          />
          <PlanCard
            price={yearlyPriceLabel}
            unit={t('subscription.plans.yearly.unit')}
            oldPrice={yearlyOldPriceLabel}
            savingsBadge={yearlySavingsLabel}
            selected={selectedPlan === 'yearly'}
            disabled={currentPlan === 'yearly'}
            currentBadge={
              currentPlan === 'yearly'
                ? t('subscription.plans.currentPlan')
                : undefined
            }
            onPress={() => setSelectedPlan('yearly')}
          />
        </View>

        {storeProducts.error && FEATURES.IAP_ENABLED ? (
          <TouchableOpacity
            style={styles.errorBanner}
            activeOpacity={0.7}
            onPress={() => {
              void storeProducts.refresh();
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
            selectedPlanIsCurrent ||
            selectedPlanIsDowngrade ||
            (storeProducts.error != null && FEATURES.IAP_ENABLED)
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
        <View style={styles.bottomSpacer} />
      </ScrollView>

      <PaymentSuccessModal
        visible={showPaymentSuccess}
        plan={confirmedPlan}
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
    fontSize: 18,
    fontWeight: 'bold',
    color: '#32475b',
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
