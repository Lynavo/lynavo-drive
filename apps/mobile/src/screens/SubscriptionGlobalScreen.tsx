import React, {
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  Modal,
  ActivityIndicator,
  NativeModules,
  Platform,
  Linking,
  Dimensions,
  Clipboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import * as RNLocalize from 'react-native-localize';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { Icon } from '../components/Icon';
import { ModalBlurBackdrop } from '../components/shared/ModalBlurBackdrop';
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
import { mainlandPaymentService } from '../services/mainland-payment-service';
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
import {
  getGiftCardConfig,
  redeemGiftCard,
} from '../services/gift-card-service';
import { getGiftCardRedeemFailureTranslationKey } from '../services/gift-card-errors';
import { logout as serverLogout } from '../services/auth-service';
import { wipeSyncIdentity } from '../services/SyncEngineModule';
import { resetCurrentDesktopSidecarIfReachable } from '../services/sidecar-reset-service';
import { clearUserScopedStorage } from '../utils/clearUserScopedStorage';
import { recordDiagnosticsLog } from '../services/diagnostics-log-service';
import {
  DiagnosticUploadError,
  diagnosticUploadService,
} from '../services/diagnostic-upload-service';
import { FEATURES } from '../constants/features';
import { USER_AGREEMENT_URL, PRIVACY_POLICY_URL } from '../constants/legal';
import {
  hasGiftCardEntitlement,
  resolveSubscriptionDisplayState,
  type SubscriptionDisplayState,
} from '../utils/subscriptionStatusDisplay';
import { ERROR_CODE } from '../services/api';
import {
  resolveSubscriptionPaymentRoute,
  type MainlandPaymentMethod,
} from '../utils/subscriptionPaymentRouting';
import { androidBoxShadow } from '../utils/androidShadow';

const APPLE_EULA_URL =
  'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';

const DARK = '#202022';
const SCREEN_BG = '#eef7fc';
const CARD_BG = 'rgba(255,255,255,0.92)';
const MUTED_TEXT = '#7893ab';
const SUCCESS_GREEN = '#22c55e';
const DESTRUCTIVE_RED = '#e53935';
const GLASS_BORDER = 'rgba(255,255,255,0.72)';
const GLASS_SHADOW = '#46608a';
const MODAL_CARD_BG = 'rgba(248,251,255,0.98)';
const POST_VERIFY_STATUS_POLL_DELAYS_MS = [
  2_000, 5_000, 10_000, 20_000, 30_000,
] as const;

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PLAN_CARD_GAP = 12;
const PLAN_CARD_HORIZONTAL_PADDING = 16;

function planCardWidth(cardsPerRow: number): number {
  const totalGap = PLAN_CARD_GAP * (cardsPerRow - 1);
  return (
    (SCREEN_WIDTH - PLAN_CARD_HORIZONTAL_PADDING * 2 - totalGap) / cardsPerRow
  );
}

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
  sub: { status: string; plan: string; source?: string | null } | null,
): 'monthly' | 'yearly' | null {
  if (!sub) return null;
  if (sub.source === 'gift_card') return null;
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

function resolveGiftCardPlanLabel(plan: string, t: TFunction): string {
  switch (plan) {
    case 'yearly':
      return t('settings.giftCard.yearlyPlan');
    case 'monthly':
      return t('settings.giftCard.monthlyPlan');
    default:
      return t('subscription.plans.fallback');
  }
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function resolveMainlandPaymentAlertKey(error: unknown): string {
  const record =
    typeof error === 'object' && error != null
      ? (error as Record<string, unknown>)
      : null;
  const code =
    typeof record?.code === 'string' || typeof record?.code === 'number'
      ? record.code
      : null;
  const userInfo =
    typeof record?.userInfo === 'object' && record.userInfo != null
      ? (record.userInfo as Record<string, unknown>)
      : null;
  const resultStatus =
    typeof userInfo?.resultStatus === 'string' ||
    typeof userInfo?.resultStatus === 'number'
      ? String(userInfo.resultStatus)
      : null;
  const message = error instanceof Error ? error.message : String(error);
  const signal = `${code ?? ''} ${message}`;

  if (signal.includes('MAINLAND_PAYMENT_WECHAT_NOT_INSTALLED')) {
    return 'subscription.payment.wechatNotInstalled';
  }
  if (
    signal.includes('MAINLAND_PAYMENT_UNAVAILABLE') ||
    signal.includes('MAINLAND_PAYMENT_ACTIVITY_UNAVAILABLE') ||
    code === ERROR_CODE.MAINLAND_PAYMENT_PROVIDER_NOT_CONFIGURED
  ) {
    return 'subscription.payment.walletUnavailable';
  }
  if (
    signal.includes('MAINLAND_PAYMENT_WECHAT_CANCELLED') ||
    signal.includes('MAINLAND_PAYMENT_ALIPAY_CANCELLED')
  ) {
    return 'subscription.payment.walletCancelled';
  }
  if (
    signal.includes('MAINLAND_PAYMENT_PENDING_TIMEOUT') ||
    signal.includes('MAINLAND_PAYMENT_WECHAT_TIMEOUT') ||
    signal.includes('MAINLAND_PAYMENT_WECHAT_HOST_DESTROYED') ||
    signal.includes('MAINLAND_PAYMENT_WECHAT_CALLBACK_INVALID') ||
    (signal.includes('MAINLAND_PAYMENT_ALIPAY_NOT_COMPLETED') &&
      resultStatus === '8000')
  ) {
    return 'subscription.payment.walletPending';
  }
  if (
    signal.includes('MAINLAND_PAYMENT_INVALID_') ||
    signal.includes('MAINLAND_PAYMENT_METHOD_MISMATCH') ||
    signal.includes('MAINLAND_PAYMENT_UNSUPPORTED_METHOD') ||
    signal.includes('MAINLAND_PAYMENT_ORDER') ||
    signal.includes('MAINLAND_PAYMENT_VERIFY') ||
    code === ERROR_CODE.MAINLAND_PAYMENT_ORDER_NOT_FOUND ||
    code === ERROR_CODE.MAINLAND_PAYMENT_ORDER_MISMATCH ||
    code === ERROR_CODE.MAINLAND_PAYMENT_VERIFY_FAILED ||
    code === ERROR_CODE.PARAM_ERROR
  ) {
    return 'subscription.payment.walletConfigError';
  }

  return 'subscription.payment.walletFailed';
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

const BENEFIT_KEYS = [
  {
    label: 'subscription.benefits.fastTransfer.label',
    value: 'subscription.benefits.fastTransfer.value',
  },
  {
    label: 'subscription.benefits.autoUpload.label',
    value: 'subscription.benefits.autoUpload.value',
  },
  {
    label: 'subscription.benefits.crossNetwork.label',
    value: 'subscription.benefits.crossNetwork.value',
  },
] as const;

function resolveStatusPresentation(
  displayState: SubscriptionDisplayState,
  t: TFunction,
): {
  label: string;
  backgroundColor: string;
  textColor: string;
} | null {
  switch (displayState.kind) {
    case 'account_trial': {
      const days = displayState.daysRemaining;
      return {
        label: t('subscription.status.trialing', { days }),
        backgroundColor: SUBSCRIPTION_STATUS_ICON_BACKGROUNDS.trial,
        textColor: SUBSCRIPTION_STATUS_ICON_COLORS.trial,
      };
    }
    case 'subscription_intro_trial': {
      const days = displayState.daysRemaining;
      return {
        label: t('subscription.status.introTrialing', { days }),
        backgroundColor: SUBSCRIPTION_STATUS_ICON_BACKGROUNDS.trial,
        textColor: SUBSCRIPTION_STATUS_ICON_COLORS.trial,
      };
    }
    case 'trial_expired':
      return {
        label: t('subscription.status.trialExpired'),
        backgroundColor: SUBSCRIPTION_STATUS_ICON_BACKGROUNDS.expired,
        textColor: SUBSCRIPTION_STATUS_ICON_COLORS.expired,
      };
    case 'subscribed':
      return {
        label: t('subscription.status.subscribed'),
        backgroundColor: SUBSCRIPTION_STATUS_ICON_BACKGROUNDS.subscribed,
        textColor: SUBSCRIPTION_STATUS_ICON_COLORS.subscribed,
      };
    case 'gift_card_subscribed':
      return {
        label: t('subscription.status.giftCardSubscribed'),
        backgroundColor: SUBSCRIPTION_STATUS_ICON_BACKGROUNDS.subscribed,
        textColor: SUBSCRIPTION_STATUS_ICON_COLORS.subscribed,
      };
    case 'gift_card_entitlement_queued':
      return {
        label: t('subscription.status.giftCardQueued', {
          date: formatExpireDate(displayState.entitlementExpireAt ?? null),
        }),
        backgroundColor: SUBSCRIPTION_STATUS_ICON_BACKGROUNDS.subscribed,
        textColor: SUBSCRIPTION_STATUS_ICON_COLORS.subscribed,
      };
    case 'subscribed_cancelled':
      return {
        label: t('subscription.status.subscribed'),
        backgroundColor: SUBSCRIPTION_STATUS_ICON_BACKGROUNDS.subscribed,
        textColor: SUBSCRIPTION_STATUS_ICON_COLORS.subscribed,
      };
    case 'sub_expired':
      return {
        label: t('subscription.status.subExpired'),
        backgroundColor: SUBSCRIPTION_STATUS_ICON_BACKGROUNDS.expired,
        textColor: SUBSCRIPTION_STATUS_ICON_COLORS.expired,
      };
    default:
      return null;
  }
}

function MembershipBenefitsCard({ t }: { t: TFunction }) {
  return (
    <View style={styles.benefitsCard}>
      <Text style={styles.benefitsTitle}>
        {t('subscription.benefits.title' as never)}
      </Text>
      <View style={styles.benefitRows}>
        {BENEFIT_KEYS.map(item => (
          <View key={item.label} style={styles.benefitRow}>
            <Text style={styles.benefitLabel}>{t(item.label as never)}</Text>
            <Text style={styles.benefitValue}>{t(item.value as never)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function remainingDaysUntil(dateStr: string | null | undefined): number {
  if (!dateStr) return 0;
  const end = new Date(dateStr).getTime();
  if (!Number.isFinite(end)) return 0;
  const diff = end - Date.now();
  if (diff <= 0) return 0;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function membershipTitle(
  displayState: SubscriptionDisplayState,
  subscription: SubscriptionInfo | null,
  t: TFunction,
): string {
  if (displayState.kind === 'account_trial') {
    return t('subscription.member.accountTrial' as never);
  }
  if (!subscription?.plan) {
    return t('subscription.plans.fallback');
  }
  if (subscription.plan === 'monthly' || subscription.plan === 'yearly') {
    return t(`subscription.member.plans.${subscription.plan}` as never);
  }
  return resolveGiftCardPlanLabel(subscription.plan, t);
}

function membershipDateLine({
  displayState,
  subscription,
  user,
  t,
}: {
  displayState: SubscriptionDisplayState;
  subscription: SubscriptionInfo | null;
  user: { trialEnd?: string | null } | null;
  t: TFunction;
}): string | null {
  const trialEnd = subscription?.trialEnd ?? user?.trialEnd ?? null;
  if (
    displayState.kind === 'account_trial' ||
    displayState.kind === 'subscription_intro_trial'
  ) {
    const date = formatExpireDate(trialEnd);
    return date
      ? t('subscription.member.trialUntil' as never, {
          date,
        })
      : null;
  }

  if (displayState.kind === 'subscribed_cancelled') {
    const date = formatExpireDate(subscription?.expireAt ?? null);
    return date ? t('subscription.status.subscribedCancelled', { date }) : null;
  }

  if (
    displayState.kind === 'subscribed' ||
    displayState.kind === 'gift_card_subscribed' ||
    displayState.kind === 'gift_card_entitlement_queued'
  ) {
    const date = formatExpireDate(
      subscription?.expireAt ?? displayState.entitlementExpireAt ?? null,
    );
    return date ? t('subscription.member.expiresAt' as never, { date }) : null;
  }

  if (displayState.kind === 'trial_expired') {
    return t('subscription.status.trialExpired');
  }
  if (displayState.kind === 'sub_expired') {
    return t('subscription.status.subExpired');
  }

  return null;
}

function membershipBody(
  displayState: SubscriptionDisplayState,
  t: TFunction,
): string {
  if (
    displayState.kind === 'subscribed' ||
    displayState.kind === 'subscribed_cancelled'
  ) {
    return t('subscription.member.activeBody' as never);
  }
  if (
    displayState.kind === 'gift_card_subscribed' ||
    displayState.kind === 'gift_card_entitlement_queued'
  ) {
    return t('subscription.member.giftCardBody' as never);
  }
  if (
    displayState.kind === 'trial_expired' ||
    displayState.kind === 'sub_expired'
  ) {
    return t('subscription.member.expiredBody' as never);
  }
  return t('subscription.member.trialBody' as never);
}

function MembershipStatusCard({
  displayState,
  subscription,
  user,
  t,
}: {
  displayState: SubscriptionDisplayState;
  subscription: SubscriptionInfo | null;
  user: { trialEnd?: string | null } | null;
  t: TFunction;
}) {
  const presentation = resolveStatusPresentation(displayState, t);
  const iconTone = getSubscriptionStatusIconTone(displayState.kind);
  if (!presentation || !iconTone) return null;

  const planLabel = membershipTitle(displayState, subscription, t);
  const dateLine = membershipDateLine({
    displayState,
    subscription,
    user,
    t,
  });
  const daySource =
    subscription?.expireAt ??
    subscription?.trialEnd ??
    user?.trialEnd ??
    displayState.entitlementExpireAt ??
    null;
  const daysRemaining = remainingDaysUntil(daySource);
  const isExpired =
    displayState.kind === 'trial_expired' ||
    displayState.kind === 'sub_expired';

  return (
    <View
      style={[
        styles.membershipCard,
        isExpired ? styles.membershipCardExpired : null,
      ]}
    >
      <View style={styles.membershipHeaderRow}>
        <SubscriptionStatusIcon
          tone={iconTone}
          framed
          frameSize={48}
          size={24}
          style={styles.membershipIconFrame}
        />
        <View style={styles.membershipCopy}>
          <Text style={styles.membershipPlanLabel}>{planLabel}</Text>
          {dateLine ? (
            <Text style={styles.membershipDateLabel}>{dateLine}</Text>
          ) : null}
        </View>
        {daysRemaining > 0 ? (
          <View style={styles.membershipRemainingPill}>
            <Text style={styles.membershipRemainingPrefix}>
              {t('subscription.member.remainingPrefix' as never)}
            </Text>
            <Text style={styles.membershipRemainingDays}>
              {t('subscription.member.remainingDays' as never, {
                days: daysRemaining,
              })}
            </Text>
          </View>
        ) : (
          <View
            style={[
              styles.membershipStatePill,
              { backgroundColor: presentation.backgroundColor },
            ]}
          >
            <Text
              style={[
                styles.membershipStatePillText,
                { color: presentation.textColor },
              ]}
              numberOfLines={2}
            >
              {presentation.label}
            </Text>
          </View>
        )}
      </View>

      <Text style={styles.membershipBody}>
        {membershipBody(displayState, t)}
      </Text>
    </View>
  );
}

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
        <ModalBlurBackdrop />
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
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: MODAL_CARD_BG,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
    paddingVertical: 28,
    paddingHorizontal: 24,
    alignItems: 'center',
    shadowColor: '#23344d',
    shadowOffset: { width: 0, height: 24 },
    shadowOpacity: 0.24,
    shadowRadius: 70,
    elevation: 12,
    ...androidBoxShadow({
      offsetY: 24,
      blurRadius: 70,
      color: 'rgba(35, 52, 77, 0.24)',
    }),
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
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderWidth: 1,
    borderColor: '#DDE8F4',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
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
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    shadowColor: DARK,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.16,
    shadowRadius: 24,
    elevation: 4,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
});

function WalletPaymentSheet({
  visible,
  methods,
  planLabel,
  priceLabel,
  selectedMethod,
  processingMethod,
  onSelect,
  onPay,
  onClose,
  t,
}: {
  visible: boolean;
  methods: readonly MainlandPaymentMethod[];
  planLabel: string;
  priceLabel: string;
  selectedMethod: MainlandPaymentMethod | null;
  processingMethod: MainlandPaymentMethod | null;
  onSelect: (method: MainlandPaymentMethod) => void;
  onPay: () => void;
  onClose: () => void;
  t: TFunction;
}) {
  const isProcessing = processingMethod != null;
  const canPay = selectedMethod != null && !isProcessing;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={paymentSheetStyles.overlay}>
        <ModalBlurBackdrop />
        <TouchableOpacity
          style={paymentSheetStyles.scrim}
          activeOpacity={1}
          onPress={isProcessing ? undefined : onClose}
        />
        <View style={paymentSheetStyles.sheet}>
          <View style={paymentSheetStyles.handle} />
          <View style={paymentSheetStyles.header}>
            <Text style={paymentSheetStyles.title}>
              {isProcessing
                ? t('subscription.payment.processingTitle')
                : t('subscription.payment.title')}
            </Text>
            <TouchableOpacity
              style={paymentSheetStyles.closeButton}
              activeOpacity={0.7}
              onPress={onClose}
              disabled={isProcessing}
              accessibilityLabel={t('subscription.payment.close')}
            >
              <Icon name="close" size={20} color={DARK} />
            </TouchableOpacity>
          </View>

          <View style={paymentSheetStyles.summary}>
            <View>
              <Text style={paymentSheetStyles.summaryLabel}>
                {t('subscription.payment.plan')}
              </Text>
              <Text style={paymentSheetStyles.summaryValue}>{planLabel}</Text>
            </View>
            <Text style={paymentSheetStyles.amountText}>{priceLabel}</Text>
          </View>

          {isProcessing ? (
            <View style={paymentSheetStyles.processingBlock}>
              <ActivityIndicator size="large" color={DARK} />
              <Text style={paymentSheetStyles.processingText}>
                {t('subscription.payment.processingBody')}
              </Text>
            </View>
          ) : (
            <View style={paymentSheetStyles.methods}>
              {methods.map(method => {
                const isSelected = selectedMethod === method;
                return (
                  <TouchableOpacity
                    key={method}
                    style={[
                      paymentSheetStyles.methodButton,
                      isSelected &&
                        (method === 'wechat'
                          ? paymentSheetStyles.wechatSelected
                          : paymentSheetStyles.alipaySelected),
                    ]}
                    activeOpacity={0.75}
                    onPress={() => onSelect(method)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isSelected }}
                  >
                    <View
                      style={[
                        paymentSheetStyles.methodIcon,
                        method === 'wechat'
                          ? paymentSheetStyles.wechatIcon
                          : paymentSheetStyles.alipayIcon,
                      ]}
                    >
                      <Text style={paymentSheetStyles.methodIconText}>
                        {method === 'wechat' ? '微' : '支'}
                      </Text>
                    </View>
                    <Text style={paymentSheetStyles.methodText}>
                      {t(`subscription.payment.${method}` as never)}
                    </Text>
                    <View
                      style={[
                        paymentSheetStyles.radioOuter,
                        isSelected && paymentSheetStyles.radioOuterSelected,
                      ]}
                    >
                      {isSelected ? (
                        <View style={paymentSheetStyles.radioInner} />
                      ) : null}
                    </View>
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity
                style={[
                  paymentSheetStyles.payButton,
                  !canPay && paymentSheetStyles.payButtonDisabled,
                ]}
                activeOpacity={0.8}
                onPress={onPay}
                disabled={!canPay}
              >
                <Text style={paymentSheetStyles.payButtonText}>
                  {t('subscription.payment.pay', { amount: priceLabel })}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          <Text style={paymentSheetStyles.terms}>
            {t('subscription.payment.terms')}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const paymentSheetStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    backgroundColor: MODAL_CARD_BG,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: 'rgba(255,255,255,0.86)',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 28,
    shadowColor: '#23344d',
    shadowOffset: { width: 0, height: -12 },
    shadowOpacity: 0.18,
    shadowRadius: 40,
    elevation: 12,
    ...androidBoxShadow({
      offsetY: -12,
      blurRadius: 40,
      color: 'rgba(35, 52, 77, 0.18)',
    }),
  },
  handle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#d5dee8',
    marginBottom: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: '800',
    color: DARK,
  },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.68)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderWidth: 1,
    borderColor: '#DDE8F4',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 16,
    gap: 12,
  },
  summaryLabel: {
    fontSize: 12,
    color: MUTED_TEXT,
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 15,
    fontWeight: '700',
    color: DARK,
  },
  amountText: {
    fontSize: 18,
    fontWeight: '800',
    color: DARK,
  },
  methods: {
    gap: 10,
  },
  methodButton: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#DDE8F4',
    backgroundColor: 'rgba(255,255,255,0.96)',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
  },
  wechatSelected: {
    backgroundColor: '#effdf4',
    borderColor: '#86efac',
  },
  alipaySelected: {
    backgroundColor: '#eef6ff',
    borderColor: '#9ecbff',
  },
  methodIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wechatIcon: {
    backgroundColor: '#20b15a',
  },
  alipayIcon: {
    backgroundColor: '#1677ff',
  },
  methodIconText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  methodText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: DARK,
  },
  radioOuter: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: '#bfd6e7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterSelected: {
    borderColor: '#3b9fd8',
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#3b9fd8',
  },
  payButton: {
    marginTop: 4,
    borderRadius: 16,
    backgroundColor: DARK,
    paddingVertical: 15,
    alignItems: 'center',
  },
  payButtonDisabled: {
    opacity: 0.45,
  },
  payButtonText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#ffffff',
  },
  processingBlock: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 12,
  },
  processingText: {
    fontSize: 14,
    color: MUTED_TEXT,
    textAlign: 'center',
  },
  terms: {
    marginTop: 16,
    fontSize: 12,
    lineHeight: 18,
    color: MUTED_TEXT,
    textAlign: 'center',
  },
});

export function SubscriptionGlobalScreen() {
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
  const paymentRoute = useMemo(
    () =>
      resolveSubscriptionPaymentRoute({
        os: Platform.OS,
        countryCode: RNLocalize.getLocales()[0]?.countryCode,
      }),
    [],
  );

  // Which Apple-level plan the user is currently holding (null when on
  // account trial, post-expiry, or no Apple IAP yet). Drives the "目前
  // 方案" badge, card disable, and CTA copy.
  const currentPlan = resolveCurrentPlan(subscription);

  // selectedProductId tracks the Apple/Google SKU the user has tapped on. Defaults to
  // recommended first, then first selectable.
  const [selectedProductId, setSelectedProductId] = useState<string | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [showWalletPaymentSheet, setShowWalletPaymentSheet] = useState(false);
  const [selectedWalletMethod, setSelectedWalletMethod] =
    useState<MainlandPaymentMethod | null>(null);
  const [processingWalletMethod, setProcessingWalletMethod] =
    useState<MainlandPaymentMethod | null>(null);
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
  const [isGiftCardEnabled, setIsGiftCardEnabled] = useState(false);
  const [giftCardPromptVisible, setGiftCardPromptVisible] = useState(false);
  const [giftCardCode, setGiftCardCode] = useState('');
  const [isRedeemingGiftCard, setIsRedeemingGiftCard] = useState(false);
  const [isUploadingDiagnostics, setIsUploadingDiagnostics] = useState(false);
  const diagnosticAbortRef = useRef<AbortController | null>(null);

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

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void getGiftCardConfig()
        .then(config => {
          if (!cancelled) {
            setIsGiftCardEnabled(config.enabled);
          }
        })
        .catch(err => {
          console.warn('[subscription] gift card config refresh failed', err);
          if (!cancelled) {
            setIsGiftCardEnabled(false);
          }
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const subscriptionDisplay = resolveSubscriptionDisplayState({
    subscription,
    user,
  });
  const isGiftCardSubscribed =
    subscriptionDisplay.kind === 'gift_card_subscribed';
  const hasQueuedGiftCardEntitlement =
    subscriptionDisplay.kind === 'gift_card_entitlement_queued';
  const hasActiveOrQueuedGiftCardEntitlement =
    isGiftCardSubscribed || hasQueuedGiftCardEntitlement;
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

  const resetToPostSubscriptionRoute = useCallback(async () => {
    const route = await resolvePostSubscriptionRoute();
    navigation.reset({
      index: 0,
      routes: [{ name: route }],
    });
  }, [navigation]);

  const handlePostSubscriptionDismiss = useCallback(() => {
    // Came from Settings / elsewhere -> return there. Came from login
    // (Subscription is the stack root for trial_expired / sub_expired) ->
    // no back entry exists, so reset into the normal authed flow.
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      void resetToPostSubscriptionRoute();
    }
  }, [navigation, resetToPostSubscriptionRoute]);

  const handleGiftCardSuccessDismiss = useCallback(() => {
    // Root paywall redemption is already handled by RootNavigator reacting to
    // the refreshed subscribed state. Only manual visits from another screen
    // should pop back on OK.
    if (navigation.canGoBack()) {
      navigation.goBack();
    }
  }, [navigation]);

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
  } = useSubscriptionPlans({
    formatPrice,
    formatSavings,
    platform: paymentRoute.catalogPlatform,
    useIapProducts: paymentRoute.useIapProducts,
  });

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

  // Resolve the active selection without mutating state during catalog
  // hydration. Prefer a user-tapped SKU when it is still available and
  // selectable; otherwise fall back to the recommended row (server intent) or
  // the first post-sort selectable entry.
  const effectiveSelectedProductId = useMemo<string | null>(() => {
    if (plans.length === 0) {
      return null;
    }

    const isBlocked = (entry: PlanWithProduct): boolean => {
      const tier = resolveSubscriptionPlanTier(entry.plan);
      return (
        tier != null &&
        (tier === currentPlan || isDowngradePlan(currentPlan, tier))
      );
    };

    const tapped = plans.find(
      entry => entry.plan.product_id === selectedProductId,
    );
    if (tapped && !isBlocked(tapped)) return tapped.plan.product_id;

    const recommended = plans.find(
      entry => entry.plan.recommended && !isBlocked(entry),
    );
    const alternative = recommended ?? plans.find(entry => !isBlocked(entry));
    if (alternative) return alternative.plan.product_id;

    return (tapped ?? plans[0]).plan.product_id;
  }, [plans, selectedProductId, currentPlan]);

  // Map the effective SKU back to the full catalog row used by CTA copy,
  // purchase, wallet checkout, and downgrade/current-plan guards.
  const selectedEntry = useMemo<PlanWithProduct | null>(
    () =>
      plans.find(
        entry => entry.plan.product_id === effectiveSelectedProductId,
      ) ?? null,
    [plans, effectiveSelectedProductId],
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

  const handleOpenGiftCardPrompt = useCallback(async () => {
    try {
      const config = await getGiftCardConfig();
      if (!config.enabled) {
        setIsGiftCardEnabled(false);
        setGiftCardPromptVisible(false);
        return;
      }
      setIsGiftCardEnabled(true);
      setGiftCardCode('');
      setGiftCardPromptVisible(true);
    } catch (err) {
      console.warn('[subscription] gift card config refresh failed', err);
      setIsGiftCardEnabled(false);
      setGiftCardPromptVisible(false);
    }
  }, []);

  const handleRedeemGiftCard = useCallback(async () => {
    const normalizedCode = giftCardCode.trim().toUpperCase();
    if (!normalizedCode) {
      Alert.alert(
        t('settings.giftCard.empty.title'),
        t('settings.giftCard.empty.body'),
      );
      return;
    }

    setIsRedeemingGiftCard(true);
    try {
      const result = await redeemGiftCard(normalizedCode);
      setGiftCardPromptVisible(false);
      setGiftCardCode('');
      markSubscriptionJustActivated();
      const fresh = await loadSubscription();
      const shouldExitSubscriptionScreen = isFeatureAccessAllowed(fresh.status);
      const shouldReturnToPreviousScreen =
        shouldExitSubscriptionScreen && navigation.canGoBack();
      Alert.alert(
        t('settings.giftCard.success.title'),
        t('settings.giftCard.success.body', {
          plan: resolveGiftCardPlanLabel(result.plan, t),
        }),
        shouldReturnToPreviousScreen
          ? [
              {
                text: t('common.ok'),
                onPress: handleGiftCardSuccessDismiss,
              },
            ]
          : undefined,
      );
    } catch (error) {
      const failureKey = getGiftCardRedeemFailureTranslationKey(error);
      Alert.alert(t('settings.giftCard.failure.title'), t(failureKey));
    } finally {
      setIsRedeemingGiftCard(false);
    }
  }, [
    giftCardCode,
    handleGiftCardSuccessDismiss,
    loadSubscription,
    navigation,
    t,
  ]);

  const handleSubscribe = useCallback(async () => {
    if (hasActiveOrQueuedGiftCardEntitlement) {
      recordDiagnosticsLog('SubscriptionScreen', 'subscribe blocked gift card');
      return;
    }
    if (plansLoading || productsLoading) {
      recordDiagnosticsLog('SubscriptionScreen', 'subscribe blocked loading', {
        plansLoading,
        productsLoading,
      });
      return;
    }
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

    if (paymentRoute.kind === 'google_play_billing') {
      recordDiagnosticsLog(
        'SubscriptionScreen',
        'subscribe blocked google billing future',
        {
          productId: targetProductId,
          targetTier,
        },
      );
      Alert.alert(
        t('subscription.payment.googleFutureTitle'),
        t('subscription.payment.googleFutureBody'),
      );
      return;
    }

    if (paymentRoute.kind === 'android_cn_wallets') {
      recordDiagnosticsLog('SubscriptionScreen', 'wallet sheet open', {
        productId: targetProductId,
        targetTier,
      });
      setSelectedWalletMethod(paymentRoute.walletMethods[0] ?? null);
      setShowWalletPaymentSheet(true);
      return;
    }

    setIsLoading(true);
    try {
      let effectiveCurrentPlan = currentPlan;
      try {
        const fresh = await getSubscriptionStatus();
        setSubscription(fresh);
        const freshPlan = resolveCurrentPlan(fresh);
        effectiveCurrentPlan = freshPlan;
        const freshDisplay = resolveSubscriptionDisplayState({
          subscription: fresh,
          user,
        });
        recordDiagnosticsLog(
          'SubscriptionScreen',
          'subscribe preflight status',
          {
            status: fresh.status,
            plan: fresh.plan,
            freshPlan,
            source: fresh.source,
          },
        );
        if (
          freshDisplay.kind === 'gift_card_subscribed' ||
          hasGiftCardEntitlement(fresh)
        ) {
          recordDiagnosticsLog(
            'SubscriptionScreen',
            'subscribe blocked by gift card preflight',
          );
          return;
        }
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
      const isPlanSwitch =
        effectiveCurrentPlan != null && effectiveCurrentPlan !== targetTier;
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
              markSubscriptionJustActivated();
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
          if (!verifiedViaSilentSuccess) {
            markSubscriptionJustActivated();
          }
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
    plansLoading,
    productsLoading,
    selectedEntry,
    selectedPlanTier,
    hasActiveOrQueuedGiftCardEntitlement,
    currentPlan,
    user,
    paymentRoute.kind,
    paymentRoute.walletMethods,
    loadSubscription,
    setSubscription,
    handleRestore,
  ]);

  const handleMainlandWalletPayment = useCallback(
    (method: MainlandPaymentMethod) => {
      if (!selectedEntry || selectedPlanTier == null) return;
      if (processingWalletMethod != null) return;

      const targetProductId = selectedEntry.plan.product_id;
      const targetTier = selectedPlanTier;
      setProcessingWalletMethod(method);
      recordDiagnosticsLog('SubscriptionScreen', 'wallet payment start', {
        method,
        productId: targetProductId,
        targetTier,
      });

      void (async () => {
        try {
          const fresh = await mainlandPaymentService.purchase({
            method,
            productId: targetProductId,
            plan: targetTier,
          });
          setSubscription(fresh);
          markSubscriptionJustActivated();
          setConfirmedProductId(targetProductId);
          setConfirmedExpireAt(fresh.expireAt ?? null);
          setShowWalletPaymentSheet(false);
          setSelectedWalletMethod(null);
          setShowPaymentSuccess(true);
          recordDiagnosticsLog('SubscriptionScreen', 'wallet payment success', {
            method,
            productId: targetProductId,
            status: fresh.status,
            plan: fresh.plan,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          recordDiagnosticsLog('SubscriptionScreen', 'wallet payment failed', {
            method,
            productId: targetProductId,
            error: message,
          });
          Alert.alert(t(resolveMainlandPaymentAlertKey(err) as never));
        } finally {
          setProcessingWalletMethod(null);
        }
      })();
    },
    [
      processingWalletMethod,
      selectedEntry,
      selectedPlanTier,
      setSubscription,
      t,
    ],
  );

  const handleConfirmWalletPayment = useCallback(() => {
    if (selectedWalletMethod == null) return;
    handleMainlandWalletPayment(selectedWalletMethod);
  }, [handleMainlandWalletPayment, selectedWalletMethod]);

  const handlePaymentSuccessDismiss = useCallback(() => {
    setShowPaymentSuccess(false);
    handlePostSubscriptionDismiss();
  }, [handlePostSubscriptionDismiss]);

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

  const subscribeButtonLabel = hasQueuedGiftCardEntitlement
    ? t('subscription.actions.giftCardQueued')
    : isGiftCardSubscribed
      ? t('subscription.actions.giftCardMember')
      : currentPlan === 'yearly'
        ? t('subscription.actions.currentYearly')
        : currentPlan && selectedPlanTier && selectedPlanTier !== currentPlan
          ? t('subscription.actions.switchPlan')
          : t('subscription.actions.subscribe');
  const primaryActionLabel =
    subscriptionDisplay.kind === 'subscribed' ||
    subscriptionDisplay.kind === 'subscribed_cancelled'
      ? t('subscription.actions.renew' as never)
      : subscribeButtonLabel;
  const canRestorePurchases =
    paymentRoute.restorePurchases &&
    FEATURES.IAP_ENABLED &&
    FEATURES.IAP_RESTORE_ENABLED;

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
        <Text style={styles.headerTitle}>
          {t('subscription.member.title' as never)}
        </Text>
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
        <MembershipStatusCard
          displayState={subscriptionDisplay}
          subscription={subscription}
          user={user}
          t={t}
        />

        <MembershipBenefitsCard t={t} />

        <View style={[styles.planRow, plansLoading && styles.planRowLoading]}>
          {plans.map(entry => {
            const product = entry.product;
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
                selected={effectiveSelectedProductId === entry.plan.product_id}
                disabled={
                  hasActiveOrQueuedGiftCardEntitlement ||
                  cardIsCurrent ||
                  cardIsDowngrade
                }
                recommended={entry.plan.recommended}
                currentBadge={
                  cardIsCurrent
                    ? t('subscription.plans.currentPlan')
                    : undefined
                }
                onPress={() => {
                  if (!hasActiveOrQueuedGiftCardEntitlement) {
                    setSelectedProductId(entry.plan.product_id);
                  }
                }}
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
            // Android wallet routes do not use StoreKit, so productsLoading
            // can be false while the server catalog is still in flight.
            // Keep the CTA inert until the authoritative catalog resolves.
            plansLoading ||
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
            hasActiveOrQueuedGiftCardEntitlement ||
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
            <Text style={styles.subscribeButtonText}>{primaryActionLabel}</Text>
          )}
        </TouchableOpacity>

        {canRestorePurchases || isGiftCardEnabled ? (
          <View style={styles.secondaryActionStack}>
            {isGiftCardEnabled ? (
              <TouchableOpacity
                onPress={() => {
                  void handleOpenGiftCardPrompt();
                }}
                accessibilityLabel={t('settings.giftCard.action')}
                activeOpacity={0.72}
                style={styles.giftCardButton}
              >
                <Text style={styles.giftCardButtonText}>
                  {t('settings.giftCard.action')}
                </Text>
              </TouchableOpacity>
            ) : null}
            {canRestorePurchases ? (
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
          </View>
        ) : null}

        <Text style={styles.footerText}>{t('subscription.footer')}</Text>
        {Platform.OS === 'ios' && (
          <View style={styles.legalContainer}>
            <TouchableOpacity
              onPress={() => Linking.openURL(APPLE_EULA_URL)}
              accessibilityLabel={t('common.termsOfService')}
            >
              <Text style={styles.legalLink}>{t('common.termsOfService')}</Text>
            </TouchableOpacity>
            <Text style={styles.legalDivider}>|</Text>
            <TouchableOpacity
              onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}
              accessibilityLabel={t('common.privacyPolicy')}
            >
              <Text style={styles.legalLink}>{t('common.privacyPolicy')}</Text>
            </TouchableOpacity>
          </View>
        )}
        {plansSource === 'bootstrap' ? (
          <Text style={styles.offlineNote}>
            {t('subscription.plans.offlineMode')}
          </Text>
        ) : null}
        <View style={styles.bottomSpacer} />
      </ScrollView>

      <WalletPaymentSheet
        visible={showWalletPaymentSheet}
        methods={paymentRoute.walletMethods}
        planLabel={selectedEntry?.plan.name ?? t('subscription.plans.fallback')}
        priceLabel={selectedEntry?.product?.displayPrice ?? '—'}
        selectedMethod={selectedWalletMethod}
        processingMethod={processingWalletMethod}
        onSelect={setSelectedWalletMethod}
        onPay={handleConfirmWalletPayment}
        onClose={() => {
          if (processingWalletMethod == null) {
            setShowWalletPaymentSheet(false);
            setSelectedWalletMethod(null);
          }
        }}
        t={t}
      />
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
      <Modal
        visible={giftCardPromptVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (isRedeemingGiftCard) return;
          setGiftCardPromptVisible(false);
          setGiftCardCode('');
        }}
      >
        <View style={styles.giftCardPromptBackdrop}>
          <ModalBlurBackdrop />
          <TouchableOpacity
            style={styles.giftCardPromptScrim}
            activeOpacity={1}
            disabled={isRedeemingGiftCard}
            onPress={() => {
              setGiftCardPromptVisible(false);
              setGiftCardCode('');
            }}
          />
          <View style={styles.giftCardPromptCard}>
            <Text style={styles.giftCardPromptTitle}>
              {t('settings.giftCard.modal.title')}
            </Text>
            <Text style={styles.giftCardPromptMessage}>
              {t('settings.giftCard.modal.message')}
            </Text>
            <TextInput
              value={giftCardCode}
              onChangeText={value => setGiftCardCode(value.toUpperCase())}
              placeholder={t('settings.giftCard.modal.placeholder')}
              placeholderTextColor={MUTED_TEXT}
              style={styles.giftCardPromptInput}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!isRedeemingGiftCard}
              maxLength={64}
              accessibilityLabel={t('settings.giftCard.modal.placeholder')}
            />
            <View style={styles.giftCardPromptActions}>
              <TouchableOpacity
                style={[
                  styles.giftCardPromptButton,
                  isRedeemingGiftCard && styles.giftCardPromptButtonDisabled,
                ]}
                activeOpacity={0.75}
                disabled={isRedeemingGiftCard}
                onPress={() => {
                  setGiftCardPromptVisible(false);
                  setGiftCardCode('');
                }}
              >
                <Text style={styles.giftCardPromptCancelText}>
                  {t('settings.giftCard.modal.cancel')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.giftCardPromptButton,
                  styles.giftCardPromptPrimaryButton,
                  (!giftCardCode.trim() || isRedeemingGiftCard) &&
                    styles.giftCardPromptButtonDisabled,
                ]}
                activeOpacity={0.75}
                disabled={!giftCardCode.trim() || isRedeemingGiftCard}
                onPress={() => {
                  void handleRedeemGiftCard();
                }}
              >
                {isRedeemingGiftCard ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.giftCardPromptPrimaryText}>
                    {t('settings.giftCard.modal.submit')}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
    marginHorizontal: 12,
    marginTop: 4,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    backgroundColor: 'rgba(255,255,255,0.54)',
    shadowColor: GLASS_SHADOW,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.1,
    shadowRadius: 38,
    elevation: 3,
    ...androidBoxShadow({
      offsetY: 14,
      blurRadius: 38,
      color: 'rgba(70, 96, 138, 0.10)',
    }),
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.62)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    color: '#17191C',
  },
  headerSpacer: {
    width: 36,
    height: 36,
  },
  diagnosticsButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.62)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 40,
  },
  membershipCard: {
    backgroundColor: CARD_BG,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    padding: 20,
    marginBottom: 20,
    shadowColor: GLASS_SHADOW,
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.12,
    shadowRadius: 52,
    elevation: 4,
    ...androidBoxShadow({
      offsetY: 18,
      blurRadius: 52,
      color: 'rgba(70, 96, 138, 0.12)',
    }),
  },
  membershipCardExpired: {
    borderColor: 'rgba(239,68,68,0.18)',
  },
  membershipHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  membershipIconFrame: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.82)',
    backgroundColor: '#EEEAFB',
  },
  membershipCopy: {
    flex: 1,
    minWidth: 0,
  },
  membershipPlanLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#17191C',
  },
  membershipDateLabel: {
    marginTop: 8,
    fontSize: 11,
    lineHeight: 17,
    color: '#59616D',
  },
  membershipStatePill: {
    maxWidth: 104,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignItems: 'center',
  },
  membershipStatePillText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
    textAlign: 'center',
  },
  membershipRemainingPill: {
    minWidth: 54,
    borderRadius: 999,
    backgroundColor: 'rgba(22,119,210,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    alignItems: 'center',
  },
  membershipRemainingPrefix: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    color: '#1677D2',
  },
  membershipRemainingDays: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    color: '#1677D2',
  },
  membershipBody: {
    marginTop: 18,
    fontSize: 12,
    lineHeight: 24,
    color: '#59616D',
  },
  benefitsCard: {
    backgroundColor: CARD_BG,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    padding: 16,
    marginBottom: 24,
    shadowColor: GLASS_SHADOW,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.08,
    shadowRadius: 34,
    elevation: 2,
    ...androidBoxShadow({
      offsetY: 14,
      blurRadius: 34,
      color: 'rgba(70, 96, 138, 0.08)',
    }),
  },
  benefitsTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#17191C',
    marginBottom: 14,
  },
  benefitRows: {
    gap: 14,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  benefitLabel: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: '#59616D',
  },
  benefitValue: {
    flexShrink: 0,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
    color: '#17191C',
  },
  subscribeButton: {
    backgroundColor: '#1677D2',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    marginBottom: 12,
    shadowColor: '#1677D2',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.18,
    shadowRadius: 28,
    elevation: 3,
  },
  subscribeButtonText: {
    fontSize: 14,
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
  secondaryActionStack: {
    gap: 10,
    marginBottom: 12,
  },
  restoreButton: {
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 6,
  },
  restoreText: {
    fontSize: 13,
    color: MUTED_TEXT,
    textDecorationLine: 'underline',
  },
  giftCardButton: {
    width: '100%',
    minHeight: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    backgroundColor: 'rgba(255,255,255,0.58)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowColor: GLASS_SHADOW,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 2,
    ...androidBoxShadow({
      offsetY: 10,
      blurRadius: 24,
      color: 'rgba(70, 96, 138, 0.08)',
    }),
  },
  giftCardButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#59616D',
  },
  bottomSpacer: {
    height: 20,
  },
  legalContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  legalLink: {
    fontSize: 12,
    color: '#3b82f6',
    textDecorationLine: 'underline',
  },
  legalDivider: {
    fontSize: 12,
    color: '#b2bccc',
    marginHorizontal: 8,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.58)',
    borderWidth: 1,
    borderColor: 'rgba(229,57,53,0.14)',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
    gap: 12,
    shadowColor: GLASS_SHADOW,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.06,
    shadowRadius: 24,
    elevation: 2,
    ...androidBoxShadow({
      offsetY: 10,
      blurRadius: 24,
      color: 'rgba(70, 96, 138, 0.06)',
    }),
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
  giftCardPromptBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  giftCardPromptScrim: {
    ...StyleSheet.absoluteFillObject,
  },
  giftCardPromptCard: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
    backgroundColor: MODAL_CARD_BG,
    padding: 20,
    gap: 14,
    shadowColor: '#23344d',
    shadowOffset: { width: 0, height: 24 },
    shadowOpacity: 0.24,
    shadowRadius: 70,
    elevation: 12,
    ...androidBoxShadow({
      offsetY: 24,
      blurRadius: 70,
      color: 'rgba(35, 52, 77, 0.24)',
    }),
  },
  giftCardPromptTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: DARK,
    textAlign: 'center',
  },
  giftCardPromptMessage: {
    fontSize: 13,
    lineHeight: 20,
    color: MUTED_TEXT,
    textAlign: 'center',
  },
  giftCardPromptInput: {
    minHeight: 48,
    maxHeight: 58,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#DDE8F4',
    backgroundColor: 'rgba(255,255,255,0.96)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: DARK,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  giftCardPromptActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  giftCardPromptButton: {
    flex: 1,
    minHeight: 44,
    minWidth: 76,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#DDE8F4',
    backgroundColor: 'rgba(255,255,255,0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  giftCardPromptPrimaryButton: {
    borderColor: DARK,
    backgroundColor: DARK,
  },
  giftCardPromptButtonDisabled: {
    opacity: 0.5,
  },
  giftCardPromptCancelText: {
    fontSize: 14,
    fontWeight: '700',
    color: MUTED_TEXT,
  },
  giftCardPromptPrimaryText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
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
});
