import React, { useState, useCallback } from 'react';
import {
  Alert,
  ActivityIndicator,
  Keyboard,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { Icon } from '../components/Icon';
import {
  AUTH_COLORS,
  AuthScreenShell,
} from '../components/auth/AuthScreenShell';
import {
  authCardSurfaceStyle,
  authTextScalingProps,
} from '../components/auth/authPlatformStyles';
import { useAuth } from '../stores/auth-store';
import { isValidChinaPhone } from '../utils/phone-validation';
import { sendSmsCode } from '../services/auth-service';
import { ApiError, ERROR_CODE } from '../services/api';
import { PRIVACY_POLICY_URL, USER_AGREEMENT_URL } from '../constants/legal';

// ---------------------------------------------------------------------------
// Navigation types
// ---------------------------------------------------------------------------

type LoginNavProp = StackNavigationProp<RootStackParamList, 'Login'>;

// ---------------------------------------------------------------------------
// LoginScreen
// ---------------------------------------------------------------------------

export function LoginScreen() {
  const navigation = useNavigation<LoginNavProp>();
  const { t } = useTranslation();
  const auth = useAuth();

  const [phone, setPhone] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [sending, setSending] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [hasTouched, setHasTouched] = useState(false);

  // -----------------------------------------------------------------------
  // Derived state
  // -----------------------------------------------------------------------

  const phoneValid = isValidChinaPhone(phone);
  const buttonEnabled = phoneValid && agreed && !sending;

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------

  const handlePhoneChange = useCallback((value: string) => {
    // Only allow digits
    const digits = value.replace(/\D/g, '').slice(0, 11);
    setPhone(digits);
    setHasTouched(true);

    if (
      digits.length > 0 &&
      digits.length === 11 &&
      !isValidChinaPhone(digits)
    ) {
      setPhoneError(t('auth.login.phoneInvalidSimplified'));
    } else {
      setPhoneError(null);
    }
  }, []);

  const handlePhoneBlur = useCallback(() => {
    if (hasTouched && phone.length > 0 && !isValidChinaPhone(phone)) {
      setPhoneError(t('auth.login.phoneInvalidSimplified'));
    }
  }, [hasTouched, phone]);

  const handleSendCode = useCallback(async () => {
    if (!buttonEnabled) return;

    Keyboard.dismiss();
    setSending(true);
    setPhoneError(null);

    try {
      const { authBaseUrl } = await sendSmsCode(phone);
      setSending(false);
      navigation.navigate('SmsVerify', { phone, authBaseUrl });
    } catch (err) {
      setSending(false);

      if (err instanceof ApiError) {
        switch (err.code) {
          case ERROR_CODE.PHONE_FORMAT_INVALID:
            setPhoneError(t('auth.login.phoneInvalidTraditional'));
            break;
          case ERROR_CODE.SMS_TOO_FREQUENT:
            Alert.alert(
              t('errors.authRequestTooFrequent'),
              t('errors.authTryLater'),
            );
            break;
          case ERROR_CODE.SMS_SEND_FAILED:
            Alert.alert(
              t('errors.authSendFailed'),
              t('errors.authSendFailedRetry'),
            );
            break;
          case ERROR_CODE.RATE_LIMITED:
            Alert.alert(
              t('errors.authRequestTooFrequent'),
              t('errors.authTryLater'),
            );
            break;
          default:
            Alert.alert(
              t('errors.authSendFailed'),
              err.message || t('errors.unknown'),
            );
        }
      } else {
        Alert.alert(
          t('errors.networkTitle'),
          t('errors.networkCheckConnection'),
        );
      }
    }
  }, [buttonEnabled, phone, navigation]);

  const handleOpenUserAgreement = useCallback(() => {
    Linking.openURL(USER_AGREEMENT_URL);
  }, []);

  const handleOpenPrivacyPolicy = useCallback(() => {
    Linking.openURL(PRIVACY_POLICY_URL);
  }, []);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <AuthScreenShell subtitle={t('auth.login.subtitle')}>
      <View style={styles.pageContent}>
        <View style={styles.card}>
          {auth.signedOutTransition === 'session_replaced' ? (
            <View style={styles.noticeBanner}>
              <Icon name="alert-circle" size={18} color={AUTH_COLORS.primary} />
              <Text {...authTextScalingProps} style={styles.noticeText}>
                {t('auth.login.sessionReplaced')}
              </Text>
            </View>
          ) : null}
          <Text {...authTextScalingProps} style={styles.cardTitle}>
            {t('auth.login.firstLoginHint')}
          </Text>

          <View style={styles.fieldWrap}>
            <View
              style={[
                styles.phoneField,
                phoneError ? styles.phoneFieldError : null,
              ]}
            >
              <View style={styles.phonePrefix}>
                <Icon
                  name="phone-portrait-outline"
                  size={16}
                  color={AUTH_COLORS.textMuted}
                />
                <Text {...authTextScalingProps} style={styles.prefixText}>
                  +86
                </Text>
              </View>
              <View style={styles.divider} />
              <TextInput
                {...authTextScalingProps}
                style={styles.phoneInput}
                value={phone}
                onChangeText={handlePhoneChange}
                onBlur={handlePhoneBlur}
                keyboardType="phone-pad"
                maxLength={11}
                placeholder={t('auth.login.phonePlaceholder')}
                placeholderTextColor={AUTH_COLORS.textFaint}
                editable={!sending}
                returnKeyType="done"
                selectionColor={AUTH_COLORS.primary}
              />
            </View>
            {phoneError && (
              <Text {...authTextScalingProps} style={styles.phoneErrorText}>
                {phoneError}
              </Text>
            )}
          </View>

          <View style={styles.agreementRow}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: agreed }}
              onPress={() => setAgreed(!agreed)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={[styles.checkbox, agreed && styles.checkboxChecked]}
            >
              {agreed ? (
                <Icon name="checkmark" size={12} color="#ffffff" />
              ) : null}
            </Pressable>
            <Text {...authTextScalingProps} style={styles.agreementText}>
              {t('auth.login.agreePrefix')}
              <Text
                {...authTextScalingProps}
                style={styles.agreementLinkText}
                onPress={handleOpenUserAgreement}
                suppressHighlighting
              >
                {t('common.termsOfService')}
              </Text>
              {t('auth.login.agreeConjunction')}
              <Text
                {...authTextScalingProps}
                style={styles.agreementLinkText}
                onPress={handleOpenPrivacyPolicy}
                suppressHighlighting
              >
                {t('common.privacyPolicy')}
              </Text>
            </Text>
          </View>

          <TouchableOpacity
            style={[
              styles.sendButton,
              !buttonEnabled ? styles.sendButtonDisabled : null,
              sending ? styles.sendButtonSending : null,
            ]}
            onPress={handleSendCode}
            activeOpacity={0.8}
            disabled={!buttonEnabled}
          >
            {sending ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : null}
            <Text
              {...authTextScalingProps}
              style={[
                styles.sendButtonText,
                !buttonEnabled ? styles.sendButtonTextDisabled : null,
              ]}
            >
              {sending
                ? t('auth.login.requesting')
                : t('auth.login.requestCode')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </AuthScreenShell>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  pageContent: {
    flex: 1,
    justifyContent: 'space-between',
    gap: 24,
  },
  card: {
    backgroundColor: AUTH_COLORS.surface,
    borderRadius: 24,
    borderWidth: 0,
    borderColor: AUTH_COLORS.surfaceBorder,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 28,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 24,
    width: '100%',
    maxWidth: 384,
    alignSelf: 'center',
    ...authCardSurfaceStyle,
  },
  noticeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(78, 142, 247, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(78, 142, 247, 0.18)',
  },
  noticeText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: AUTH_COLORS.text,
  },
  cardTitle: {
    fontSize: 12,
    fontWeight: '500',
    color: AUTH_COLORS.textFaint,
    textAlign: 'center',
    marginBottom: 20,
  },
  fieldWrap: {
    marginBottom: 20,
  },
  phoneField: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: AUTH_COLORS.inputBorder,
    backgroundColor: AUTH_COLORS.inputBackground,
    paddingHorizontal: 16,
  },
  phoneFieldError: {
    borderColor: AUTH_COLORS.danger,
  },
  phonePrefix: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  prefixText: {
    fontSize: 14,
    fontWeight: '600',
    color: AUTH_COLORS.textMuted,
  },
  divider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(0,0,0,0.08)',
    marginHorizontal: 12,
  },
  phoneInput: {
    flex: 1,
    paddingVertical: 0,
    fontSize: 15,
    fontWeight: '500',
    color: AUTH_COLORS.text,
  },
  phoneErrorText: {
    marginTop: 10,
    marginLeft: 6,
    fontSize: 13,
    color: AUTH_COLORS.danger,
  },
  agreementRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 24,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: AUTH_COLORS.checkBorder,
    backgroundColor: 'rgba(255,255,255,0.90)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxChecked: {
    borderColor: AUTH_COLORS.checkFill,
    backgroundColor: AUTH_COLORS.checkFill,
    shadowColor: AUTH_COLORS.checkFill,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 2,
  },
  agreementText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 19,
    color: AUTH_COLORS.textFaint,
  },
  agreementLinkText: {
    color: AUTH_COLORS.link,
    fontWeight: '600',
  },
  sendButton: {
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: AUTH_COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
    overflow: 'hidden',
    shadowColor: AUTH_COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 4,
  },
  sendButtonDisabled: {
    backgroundColor: AUTH_COLORS.primaryDisabled,
    shadowOpacity: 0,
    elevation: 0,
  },
  sendButtonSending: {
    backgroundColor: AUTH_COLORS.primaryPressed,
  },
  sendButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
    zIndex: 1,
  },
  sendButtonTextDisabled: {
    color: AUTH_COLORS.primaryTextDisabled,
  },
});
