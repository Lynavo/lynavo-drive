import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Vibration,
  NativeModules,
  Dimensions,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CommonActions, useNavigation, useRoute } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { colors } from '../theme/colors';
import { useTranslation } from 'react-i18next';
import { Icon } from '../components/Icon';

const DARK = '#1a3a5c';

// ---------------------------------------------------------------------------
// Navigation types
// ---------------------------------------------------------------------------

type CodeVerifyNavProp = StackNavigationProp<RootStackParamList, 'CodeVerify'>;
type CodeVerifyRouteProp = RouteProp<RootStackParamList, 'CodeVerify'>;

const CODE_LENGTH = 6;
const VERIFY_DELAY_MS = 1200;

// ---------------------------------------------------------------------------
// CodeVerifyScreen
// ---------------------------------------------------------------------------

export function CodeVerifyScreen() {
  const navigation = useNavigation<CodeVerifyNavProp>();
  const route = useRoute<CodeVerifyRouteProp>();
  const { t } = useTranslation();
  const windowWidth = Dimensions.get('window').width;
  const { deviceId, host, port, deviceName, prefilledCode } = route.params;

  const [code, setCode] = useState<string[]>(
    prefilledCode && prefilledCode.length === CODE_LENGTH 
      ? prefilledCode.split('') 
      : Array(CODE_LENGTH).fill('')
  );
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const filledCount = code.filter(Boolean).length;

  const inputRefs = useRef<(TextInput | null)[]>([]);
  const codeBoxSize = Math.min(
    52,
    Math.floor(
      (windowWidth - 24 * 2 - 4 * 2 - 8 * (CODE_LENGTH - 1)) / CODE_LENGTH,
    ),
  );
  const resolvedCodeBoxSize = Math.max(36, codeBoxSize);
  const codeBoxFontSize = Math.max(18, Math.floor(resolvedCodeBoxSize * 0.4));
  const codeBoxRadius = Math.max(14, Math.floor(resolvedCodeBoxSize * 0.3));



  const submitCode = useCallback(
    async (fullCode: string) => {
      setVerifying(true);
      setError(false);
      setErrorMsg(null);

      try {
        const { NativeSyncEngine } = NativeModules;
        if (NativeSyncEngine) {
          await NativeSyncEngine.pairDevice({
            deviceId,
            host,
            port,
            connectionCode: fullCode,
          });
          setVerifying(false);
          navigation.dispatch(
            CommonActions.reset({
              index: 0,
              routes: [{ name: 'SyncActivity' }],
            }),
          );
          return;
        }
      } catch (e: any) {
        console.error('Native pairing failed:', e);
        // Native module threw a pairing error — show error state
        setVerifying(false);
        setError(true);
        // Include actual error message so the user knows if it's a network timeout vs incorrect code
        const msg = e?.message || '';
        if (msg.includes('Pairing rejected')) {
           setErrorMsg(t('errors.pairingWrongCode'));
        } else {
           setErrorMsg(t('errors.pairingConnectFailed', { msg }));
        }
        setCode(Array(CODE_LENGTH).fill(''));
        Vibration.vibrate(300);
        inputRefs.current[0]?.focus();
        return;
      }

      // Mock fallback: always succeed after delay
      setTimeout(() => {
        setVerifying(false);
        navigation.dispatch(
            CommonActions.reset({
              index: 0,
              routes: [{ name: 'SyncActivity' }],
            }),
          );
      }, VERIFY_DELAY_MS);
    },
    [navigation, deviceId, host, port, t],
  );

  // Auto-focus first input on mount (iOS autoFocus can be unreliable)
  useEffect(() => {
    if (prefilledCode && prefilledCode.length === CODE_LENGTH) {
      // Defer submit to allow the navigation transition to finish and the native
      // TCP layer to fully close any previous connection before dialing again.
      const timer = setTimeout(() => {
        submitCode(prefilledCode);
      }, 500);
      return () => clearTimeout(timer);
    } else {
      const timer = setTimeout(() => {
        inputRefs.current[0]?.focus();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [prefilledCode, submitCode]);

  // -----------------------------------------------------------------------
  // Handle digit input
  // -----------------------------------------------------------------------

  const handleChangeText = useCallback(
    (index: number, value: string) => {
      // Only allow digits
      const digit = value.replace(/\D/g, '').slice(-1);

      const newCode = [...code];
      newCode[index] = digit;
      setCode(newCode);
      setError(false);
      setErrorMsg(null);

      if (digit && index < CODE_LENGTH - 1) {
        // Advance focus to next box
        inputRefs.current[index + 1]?.focus();
      }

      // Auto-submit when 6th digit entered
      if (index === CODE_LENGTH - 1 && digit) {
        const fullCode = newCode.join('');
        if (fullCode.length === CODE_LENGTH) {
          submitCode(fullCode);
        }
      }
    },
    [code, submitCode],
  );

  // -----------------------------------------------------------------------
  // Handle backspace on empty box -> move to previous
  // -----------------------------------------------------------------------

  const handleKeyPress = useCallback(
    (index: number, e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      if (e.nativeEvent.key === 'Backspace' && !code[index] && index > 0) {
        inputRefs.current[index - 1]?.focus();
      }
    },
    [code],
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          activeOpacity={0.6}
          hitSlop={{ top: 15, bottom: 15, left: 15, right: 30 }}
          onPress={() => {
            if (navigation.canGoBack()) {
              navigation.goBack();
            } else {
              navigation.dispatch(
                CommonActions.reset({
                  index: 0,
                  routes: [{ name: 'DeviceDiscovery' }],
                }),
              );
            }
          }}
          accessibilityLabel={t('common.back')}
        >
          <Icon name="chevron-back" size={20} color={DARK} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('codeVerify.title')}</Text>
      </View>
      <View style={styles.container}>
        {/* Device name context */}
        <View style={styles.deviceLabelRow}>
          <View style={styles.deviceIconBox}>
            <Icon name="desktop-outline" size={16} color="#3b82f6" />
          </View>
          <Text style={styles.deviceLabel}>{t('codeVerify.deviceLabel', { deviceName, host })}</Text>
        </View>

        {/* Prompt */}
        <Text style={styles.prompt}>{t('codeVerify.prompt')}</Text>

        {/* Code input boxes */}
        <View style={styles.codeRow}>
          {code.map((digit, index) => (
            <TextInput
              key={index}
              ref={(ref) => {
                inputRefs.current[index] = ref;
              }}
              style={[
                styles.codeBox,
                {
                  width: resolvedCodeBoxSize,
                  height: resolvedCodeBoxSize,
                  borderRadius: codeBoxRadius,
                  fontSize: codeBoxFontSize,
                },
                digit ? styles.codeBoxFilled : styles.codeBoxEmpty,
                error && styles.codeBoxError,
                verifying && styles.codeBoxDisabled,
              ]}
              value={digit}
              onChangeText={(value) => handleChangeText(index, value)}
              onKeyPress={(e) => handleKeyPress(index, e)}
              keyboardType="number-pad"
              maxLength={1}
              autoFocus={index === 0}
              editable={!verifying}
              selectTextOnFocus
              textContentType="oneTimeCode"
            />
          ))}
        </View>

        <View style={styles.progressDots}>
          {Array.from({ length: CODE_LENGTH }).map((_, index) => (
            <View
              key={index}
              style={[
                styles.progressDot,
                index < filledCount && styles.progressDotFilled,
              ]}
            />
          ))}
        </View>

        {/* Status: verifying */}
        {verifying && (
          <View style={styles.statusRow}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.statusText}>{t('codeVerify.verifying')}</Text>
          </View>
        )}

        {/* Status: error */}
        {error && (
          <Text style={styles.errorText} numberOfLines={2}>
            {errorMsg || t('errors.pairingWrongCode')}
          </Text>
        )}

        {/* Help text */}
        <View style={styles.helpCard}>
          <View style={styles.helpIconBox}>
            <Icon name="desktop-outline" size={22} color="#3b82f6" />
          </View>
          <View style={styles.helpCopy}>
            <Text style={styles.helpTitle}>{t('codeVerify.helpTitle')}</Text>
            <Text style={styles.helpText}>{t('codeVerify.helpText')}</Text>
            <Text style={styles.helpSecondary}>{t('codeVerify.helpSecondary')}</Text>
          </View>
          <View style={styles.helpExample}>
            <View style={styles.helpExampleRow}>
              {['3', '8', '5'].map(digit => (
                <View key={digit} style={styles.helpExampleDigit}>
                  <Text style={styles.helpExampleDigitText}>{digit}</Text>
                </View>
              ))}
            </View>
            <View style={styles.helpExampleRow}>
              {['2', '1', '7'].map(digit => (
                <View key={digit} style={styles.helpExampleDigit}>
                  <Text style={styles.helpExampleDigitText}>{digit}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.helpExampleLabel}>{t('codeVerify.exampleLabel')}</Text>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#eef7ff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 12,
    gap: 10,
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
    color: DARK,
    fontSize: 17,
    fontWeight: '700',
  },
  container: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 30,
  },

  // Device label
  deviceLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 24,
  },
  deviceIconBox: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: 'rgba(59,130,246,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deviceLabel: {
    flexShrink: 1,
    fontSize: 13,
    color: '#5a7a96',
    fontWeight: '500',
  },

  // Prompt
  prompt: {
    fontSize: 15,
    color: DARK,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: 32,
  },

  // Code row
  codeRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 24,
    paddingHorizontal: 4,
  },

  codeBox: {
    borderWidth: 2,
    textAlign: 'center',
    fontWeight: 'bold',
    color: DARK,
    // Shadow
    shadowColor: 'rgba(59,130,210,0.35)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 1,
  },
  codeBoxEmpty: {
    borderColor: 'rgba(148,163,184,0.25)',
    backgroundColor: 'rgba(255,255,255,0.56)',
  },
  codeBoxFilled: {
    borderColor: 'rgba(59,130,246,0.26)',
    backgroundColor: 'rgba(255,255,255,0.94)',
  },
  codeBoxError: {
    borderColor: colors.destructive,
  },
  codeBoxDisabled: {
    opacity: 0.6,
  },

  // Status
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  statusText: {
    fontSize: 14,
    color: colors.primary,
  },
  errorText: {
    fontSize: 14,
    color: colors.destructive,
    marginTop: 4,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  progressDots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  progressDot: {
    width: 5,
    height: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(148,163,184,0.3)',
  },
  progressDotFilled: {
    width: 8,
    backgroundColor: '#3b82f6',
  },

  // Help card
  helpCard: {
    width: '100%',
    marginTop: 36,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.62)',
    paddingHorizontal: 16,
    paddingVertical: 16,
    shadowColor: 'rgba(59,130,210,0.3)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 2,
  },
  helpIconBox: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(59,130,246,0.09)',
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  helpCopy: {
    flex: 1,
    minWidth: 0,
  },
  helpTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: DARK,
  },
  helpText: {
    marginTop: 6,
    fontSize: 12,
    color: '#5a7a96',
    lineHeight: 18,
  },
  helpSecondary: {
    marginTop: 6,
    fontSize: 11,
    color: '#94a3b8',
    lineHeight: 16,
  },
  helpExample: {
    alignItems: 'center',
    gap: 4,
    marginLeft: 2,
  },
  helpExampleRow: {
    flexDirection: 'row',
    gap: 3,
  },
  helpExampleDigit: {
    width: 16,
    height: 20,
    borderRadius: 5,
    backgroundColor: 'rgba(59,130,246,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  helpExampleDigitText: {
    color: '#3b82f6',
    fontSize: 10,
    fontWeight: '800',
  },
  helpExampleLabel: {
    marginTop: 1,
    color: '#94a3b8',
    fontSize: 9,
    fontWeight: '600',
  },
});
