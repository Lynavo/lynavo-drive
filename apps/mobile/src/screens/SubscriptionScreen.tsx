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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { Icon } from '../components/Icon';
import { useAuth } from '../stores/auth-store';
import { iapService } from '../services/iap-service';
import { IAP_PRODUCTS, planToProductId } from '../constants/iap';
import { classifyIapError, IapErrorClass } from '../services/iap-errors';
import { markSubscriptionJustActivated } from '../hooks/useExpiryReminder';
import { verifyIapReceipt } from '../services/subscription-service';
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
const LIGHT_GREEN_BG = 'rgba(83, 200, 120, 0.12)';
const LIGHT_RED_BG = 'rgba(229, 57, 53, 0.12)';
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
type PlanKey = 'monthly' | 'yearly';

function formatExpireDate(dateStr: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
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

  switch (displayState.kind) {
    case 'account_trial': {
      const days = displayState.daysRemaining;
      dotColor = SUCCESS_GREEN;
      label = t('subscription.status.trialing', { days });
      backgroundColor = LIGHT_GREEN_BG;
      textColor = SUCCESS_GREEN;
      break;
    }
    case 'subscription_intro_trial': {
      const days = displayState.daysRemaining;
      dotColor = SUCCESS_GREEN;
      label = t('subscription.status.introTrialing', { days });
      backgroundColor = LIGHT_GREEN_BG;
      textColor = SUCCESS_GREEN;
      break;
    }
    case 'trial_expired':
      dotColor = DESTRUCTIVE_RED;
      label = t('subscription.status.trialExpired');
      backgroundColor = LIGHT_RED_BG;
      textColor = DESTRUCTIVE_RED;
      break;
    case 'subscribed':
      dotColor = SUCCESS_GREEN;
      label = t('subscription.status.subscribed');
      backgroundColor = LIGHT_GREEN_BG;
      textColor = SUCCESS_GREEN;
      break;
    case 'sub_expired':
      dotColor = DESTRUCTIVE_RED;
      label = t('subscription.status.subExpired');
      backgroundColor = LIGHT_RED_BG;
      textColor = DESTRUCTIVE_RED;
      break;
    default:
      return null;
  }

  return (
    <View style={[badgeStyles.container, { backgroundColor }]}>
      <View style={[badgeStyles.dot, { backgroundColor: dotColor }]} />
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
      {FEATURE_KEYS.map((key) => (
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
  onPress,
}: {
  price: string;
  unit: string;
  oldPrice?: string;
  savingsBadge?: string;
  selected: boolean;
  disabled?: boolean;
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
      <Text
        style={[
          planStyles.price,
          disabled
            ? planStyles.textDisabled
            : selected
              ? planStyles.textSelected
              : planStyles.textUnselected,
        ]}
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
      >
        {unit}
      </Text>
      {oldPrice ? (
        <View style={planStyles.metaRow}>
          <Text style={planStyles.oldPrice}>{oldPrice}</Text>
          {savingsBadge ? (
            <View style={planStyles.savingsBadge}>
              <Text style={planStyles.savingsBadgeText}>{savingsBadge}</Text>
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
          <Text style={modalStyles.title}>{t('subscription.modal.paymentSuccess')}</Text>
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
            <Text style={modalStyles.buttonText}>{t('subscription.actions.start')}</Text>
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
  const { t } = useTranslation();
  const { user, subscription, loadSubscription } = useAuth();

  const [selectedPlan, setSelectedPlan] = useState<PlanKey>('yearly');
  const [isLoading, setIsLoading] = useState(false);
  const [showPaymentSuccess, setShowPaymentSuccess] = useState(false);
  const [confirmedPlan, setConfirmedPlan] = useState<PlanKey>('yearly');
  const [confirmedExpireAt, setConfirmedExpireAt] = useState<string | null>(null);

  const [monthlyTrialEligible, setMonthlyTrialEligible] = useState<boolean | null>(null);

  useEffect(() => {
    if (!FEATURES.IAP_ENABLED) return;
    let cancelled = false;
    void iapService
      .checkEligibility()
      .then((results) => {
        if (cancelled) return;
        const monthly = results.find(
          (r) => r.productId === IAP_PRODUCTS.monthly,
        );
        setMonthlyTrialEligible(monthly?.eligibleForIntroOffer ?? false);
      })
      .catch(() => {
        if (!cancelled) setMonthlyTrialEligible(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const subscriptionDisplay = resolveSubscriptionDisplayState({
    subscription,
    user,
  });

  const [isRestoring, setIsRestoring] = useState(false);

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
    } catch {
      Alert.alert(t('subscription.restore.failed'));
    } finally {
      setIsRestoring(false);
    }
  }, [t, loadSubscription]);

  const handleSubscribe = useCallback(async () => {
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
      const productId = planToProductId(selectedPlan);
      const receipt = await iapService.purchase(productId);

      // Retry verify twice (1s → 4s) before surfacing error — Apple already
      // charged, so we must try hard before handing retry to the user.
      let verified = false;
      const delays = [0, 1_000, 4_000];
      let lastErr: unknown = null;
      for (const delay of delays) {
        if (delay > 0) await new Promise<void>((r) => setTimeout(r, delay));
        try {
          await verifyIapReceipt(receipt.transactionReceipt, selectedPlan);
          verified = true;
          break;
        } catch (err) {
          const cls = classifyIapError(err);
          if (cls.kind === IapErrorClass.SilentSuccess) {
            verified = true;
            break;
          }
          if (cls.kind === IapErrorClass.FatalMismatch) {
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
        Alert.alert(t((cls.i18nKey ?? 'subscription.errors.verifyRetrying') as never));
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
      } catch {
        // Fall through — modal will just hide the expiry line.
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
  }, [t, selectedPlan, loadSubscription]);

  const handlePaymentSuccessDismiss = useCallback(() => {
    setShowPaymentSuccess(false);
  }, []);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          activeOpacity={0.6}
          hitSlop={{ top: 15, bottom: 15, left: 15, right: 30 }}
          onPress={() => {
            if (navigation.canGoBack()) {
              navigation.goBack();
            }
          }}
          accessibilityLabel={t('common.back')}
        >
          <Icon name="chevron-back" size={20} color={DARK} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('subscription.title')}</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroSection}>
          <Text style={styles.heroTitle}>{t('subscription.hero.title')}</Text>
          <Text style={styles.heroSubtitle}>{t('subscription.hero.subtitle')}</Text>
          {subscriptionDisplay.kind !== 'unknown' ? (
            <StatusBadge displayState={subscriptionDisplay} t={t} />
          ) : null}
        </View>

        <View style={styles.featureCard}>
          <FeatureList t={t} />
        </View>

        <View style={styles.planRow}>
          <PlanCard
            price="¥9.9"
            unit={
              monthlyTrialEligible
                ? t('subscription.plans.monthly.trialOffer')
                : t('subscription.plans.monthly.subtitle')
            }
            selected={selectedPlan === 'monthly'}
            disabled={false}
            onPress={() => setSelectedPlan('monthly')}
          />
          <PlanCard
            price="¥104"
            unit={t('subscription.plans.yearly.unit')}
            oldPrice={t('subscription.plans.yearly.oldPrice')}
            savingsBadge={t('subscription.plans.yearly.savings')}
            selected={selectedPlan === 'yearly'}
            onPress={() => setSelectedPlan('yearly')}
          />
        </View>

        <TouchableOpacity
          style={styles.subscribeButton}
          activeOpacity={0.7}
          disabled={isLoading}
          onPress={() => {
            void handleSubscribe();
          }}
        >
          {isLoading ? (
            <ActivityIndicator color="#ffffff" size="small" />
          ) : (
            <Text style={styles.subscribeButtonText}>{t('subscription.actions.subscribe')}</Text>
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
});
