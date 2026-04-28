import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Alert,
  ActivityIndicator,
  Animated,
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  Vibration,
  View,
  type NativeSyntheticEvent,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { AUTH_COLORS, AuthScreenShell } from '../components/auth/AuthScreenShell';
import { maskPhone } from '../utils/phone-validation';
import { smsLogin, sendSmsCode } from '../services/auth-service';
import { ApiError, ERROR_CODE } from '../services/api';
import { useAuth } from '../stores/auth-store';
import { useTranslation } from 'react-i18next';

// ---------------------------------------------------------------------------
// Navigation types
// ---------------------------------------------------------------------------

type SmsVerifyNavProp = StackNavigationProp<RootStackParamList, 'SmsVerify'>;
type SmsVerifyRouteProp = RouteProp<RootStackParamList, 'SmsVerify'>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CODE_LENGTH = 6;
const COUNTDOWN_SECONDS = 60;
export function SmsVerifyScreen() {
  const navigation = useNavigation<SmsVerifyNavProp>();
  const route = useRoute<SmsVerifyRouteProp>();
  const { phone } = route.params;
  const auth = useAuth();
  const { t } = useTranslation();
  const windowWidth = Dimensions.get('window').width;

  // -----------------------------------------------------------------------
  // State
  // -----------------------------------------------------------------------

  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [resending, setResending] = useState(false);

  const codeInputRef = useRef<TextInput | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const codeBoxSize = Math.min(
    48,
    Math.floor((windowWidth - 24 * 2 - 24 * 2 - 8 * (CODE_LENGTH - 1)) / CODE_LENGTH),
  );
  const resolvedCodeBoxSize = Math.max(40, codeBoxSize);
  const codeBoxRadius = Math.max(14, Math.floor(resolvedCodeBoxSize * 0.3));
  const codeDigitSize = Math.max(18, Math.floor(resolvedCodeBoxSize * 0.42));

  // -----------------------------------------------------------------------
  // Countdown timer
  // -----------------------------------------------------------------------

  const startCountdown = useCallback(() => {
    setCountdown(COUNTDOWN_SECONDS);
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
    }
    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (countdownRef.current) {
            clearInterval(countdownRef.current);
            countdownRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  useEffect(() => {
    startCountdown();
    return () => {
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
      }
    };
  }, [startCountdown]);

  // -----------------------------------------------------------------------
  // Auto-focus first input
  // -----------------------------------------------------------------------

  useEffect(() => {
    const timer = setTimeout(() => {
      codeInputRef.current?.focus();
    }, 300);
    return () => clearTimeout(timer);
  }, []);

  // -----------------------------------------------------------------------
  // Shake animation for error
  // -----------------------------------------------------------------------

  const triggerShake = useCallback(() => {
    shakeAnim.setValue(0);
    Animated.sequence([
      Animated.timing(shakeAnim, {
        toValue: 10,
        duration: 50,
        useNativeDriver: true,
      }),
      Animated.timing(shakeAnim, {
        toValue: -10,
        duration: 50,
        useNativeDriver: true,
      }),
      Animated.timing(shakeAnim, {
        toValue: 8,
        duration: 50,
        useNativeDriver: true,
      }),
      Animated.timing(shakeAnim, {
        toValue: -8,
        duration: 50,
        useNativeDriver: true,
      }),
      Animated.timing(shakeAnim, {
        toValue: 0,
        duration: 50,
        useNativeDriver: true,
      }),
    ]).start();
  }, [shakeAnim]);

  // -----------------------------------------------------------------------
  // Submit code
  // -----------------------------------------------------------------------

  const submitCode = useCallback(
    async (fullCode: string) => {
      setVerifying(true);
      setError(false);
      setErrorMsg(null);

      try {
        const result = await smsLogin(phone, fullCode);
        // auth.login flips isLoggedIn=true → RootNavigator unmounts the
        // UnauthStack and mounts AuthedStack, which picks the right initial
        // route (DeviceDiscovery / SyncActivity / Subscription) once the
        // profile auto-loads. No imperative navigation needed here.
        auth.login(result.accessToken, result.refreshToken);
        setVerifying(false);
      } catch (err) {
        setVerifying(false);

        if (err instanceof ApiError) {
          switch (err.code) {
            case ERROR_CODE.CODE_WRONG:
              setError(true);
              setErrorMsg(t('errors.smsCodeIncorrect'));
              triggerShake();
              setCode('');
              Vibration.vibrate(300);
              setTimeout(() => codeInputRef.current?.focus(), 120);
              break;
            case ERROR_CODE.CODE_EXPIRED:
              setError(true);
              setErrorMsg(t('errors.smsCodeExpired'));
              setCode('');
              Vibration.vibrate(300);
              setTimeout(() => codeInputRef.current?.focus(), 120);
              break;
            case ERROR_CODE.TOO_MANY_CODE_ATTEMPTS:
              Alert.alert(t('errors.smsVerifyFailedTitle'), t('errors.smsTooManyAttempts'));
              setCode('');
              Vibration.vibrate(300);
              setTimeout(() => codeInputRef.current?.focus(), 120);
              break;
            default:
              setError(true);
              setErrorMsg(err.message || t('errors.smsVerifyFailedRetry'));
              Vibration.vibrate(300);
          }
        } else {
          setError(true);
          setErrorMsg(t('errors.networkCheckRetry'));
          Vibration.vibrate(300);
        }
      }
    },
    [phone, auth, triggerShake],
  );

  // -----------------------------------------------------------------------
  // Handle digit input
  // -----------------------------------------------------------------------

  const handleCodeChange = useCallback(
    (value: string) => {
      const digits = value.replace(/\D/g, '').slice(0, CODE_LENGTH);
      setCode(digits);
      setError(false);
      setErrorMsg(null);

      if (digits.length === CODE_LENGTH && !verifying) {
        void submitCode(digits);
      }
    },
    [submitCode, verifying],
  );

  // -----------------------------------------------------------------------
  // Resend code
  // -----------------------------------------------------------------------

  const handleResend = useCallback(async () => {
    if (countdown > 0 || resending) return;

    setResending(true);
    setError(false);
    setErrorMsg(null);

    try {
      await sendSmsCode(phone);
      startCountdown();
      setCode('');
      setTimeout(() => codeInputRef.current?.focus(), 120);
    } catch (err) {
      if (err instanceof ApiError) {
        Alert.alert(t('errors.authSendFailed'), err.message || t('errors.smsSendFailed'));
      } else {
        Alert.alert(t('errors.networkTitle'), t('errors.networkCheckConnection'));
      }
    } finally {
      setResending(false);
    }
  }, [countdown, resending, phone, startCountdown]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <AuthScreenShell
      subtitle={t('auth.smsVerify.subtitlePattern', { phone: maskPhone(phone) })}
      onBack={() => navigation.goBack()}
      contentStyle={styles.content}
    >
      <View style={styles.card}>
        <Text style={styles.prompt}>{t('auth.smsVerify.prompt')}</Text>

        <TextInput
          ref={codeInputRef}
          style={styles.hiddenInput}
          value={code}
          onChangeText={handleCodeChange}
          keyboardType="number-pad"
          maxLength={CODE_LENGTH}
          editable={!verifying}
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          selectionColor={AUTH_COLORS.primary}
        />

        <Animated.View
          style={[
            styles.codeRow,
            { transform: [{ translateX: shakeAnim }] },
          ]}
        >
          <Pressable
            onPress={() => codeInputRef.current?.focus()}
            style={styles.codePressArea}
          >
            {Array.from({ length: CODE_LENGTH }, (_, index) => {
              const digit = code[index] ?? '';
              const isActive =
                !verifying &&
                !error &&
                (index === code.length || (code.length === CODE_LENGTH && index === CODE_LENGTH - 1));
              return (
                <View
                  key={index}
                  style={[
                    styles.codeBox,
                    {
                      width: resolvedCodeBoxSize,
                      height: resolvedCodeBoxSize,
                      borderRadius: codeBoxRadius,
                    },
                    digit ? styles.codeBoxFilled : styles.codeBoxEmpty,
                    isActive ? styles.codeBoxActive : null,
                    error ? styles.codeBoxError : null,
                    verifying ? styles.codeBoxDisabled : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.codeDigit,
                      { fontSize: codeDigitSize },
                    ]}
                  >
                    {digit}
                  </Text>
                </View>
              );
            })}
          </Pressable>
        </Animated.View>

        {verifying ? (
          <View style={styles.statusRow}>
            <Text style={styles.statusText}>{t('auth.smsVerify.verifying')}</Text>
            <ActivityIndicator size="small" color={AUTH_COLORS.primary} />
          </View>
        ) : null}

        {error && errorMsg ? (
          <Text style={styles.errorText}>{errorMsg}</Text>
        ) : null}

        <View style={styles.resendRow}>
          {countdown > 0 ? (
            <Text style={styles.countdownText}>
              {t('auth.smsVerify.resendCountdown', { seconds: countdown })}
            </Text>
          ) : (
            <TouchableOpacity
              onPress={handleResend}
              activeOpacity={0.7}
              disabled={resending}
              style={styles.resendButton}
            >
              {resending ? (
                <ActivityIndicator size="small" color={AUTH_COLORS.primary} />
              ) : (
                <Text style={styles.resendText}>{t('auth.smsVerify.resendButton')}</Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>
    </AuthScreenShell>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  content: {
    justifyContent: 'flex-start',
  },
  card: {
    backgroundColor: AUTH_COLORS.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: AUTH_COLORS.surfaceBorder,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 28,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 24,
    elevation: 4,
  },
  prompt: {
    fontSize: 12,
    fontWeight: '500',
    color: AUTH_COLORS.textFaint,
    textAlign: 'center',
    marginBottom: 24,
  },
  hiddenInput: {
    position: 'absolute',
    opacity: 0,
    width: 1,
    height: 1,
  },
  codeRow: {
    justifyContent: 'center',
    marginBottom: 24,
  },
  codePressArea: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
  },
  codeBox: {
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeBoxEmpty: {
    borderColor: 'rgba(0,0,0,0.08)',
    backgroundColor: AUTH_COLORS.inputBackground,
  },
  codeBoxFilled: {
    borderColor: AUTH_COLORS.inputBorderStrong,
    backgroundColor: '#ffffff',
  },
  codeBoxActive: {
    borderColor: AUTH_COLORS.primary,
    shadowColor: AUTH_COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 2,
  },
  codeBoxError: {
    borderColor: AUTH_COLORS.danger,
  },
  codeBoxDisabled: {
    opacity: 0.6,
  },
  codeDigit: {
    fontWeight: '700',
    color: AUTH_COLORS.text,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 6,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '600',
    color: AUTH_COLORS.primary,
  },
  errorText: {
    fontSize: 14,
    lineHeight: 20,
    color: AUTH_COLORS.danger,
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 12,
  },
  resendRow: {
    alignItems: 'center',
    marginTop: 24,
  },
  countdownText: {
    fontSize: 14,
    color: AUTH_COLORS.textFaint,
  },
  resendButton: {
    minHeight: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resendText: {
    fontSize: 15,
    fontWeight: '600',
    color: AUTH_COLORS.link,
  },
});
