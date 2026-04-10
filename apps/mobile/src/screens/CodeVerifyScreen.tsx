import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Vibration,
  NativeModules,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CommonActions, useNavigation, useRoute } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { colors } from '../theme/colors';

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
  const { deviceId, host, port, deviceName, prefilledCode } = route.params;

  const [code, setCode] = useState<string[]>(
    prefilledCode && prefilledCode.length === CODE_LENGTH 
      ? prefilledCode.split('') 
      : Array(CODE_LENGTH).fill('')
  );
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const inputRefs = useRef<(TextInput | null)[]>([]);



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
              routes: [{ name: 'MainTabs', state: { routes: [{ name: 'AlbumWorkbench' }] } }],
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
           setErrorMsg('连接码错误，请重新输入');
        } else {
           setErrorMsg(`连接失败：${msg}`);
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
              routes: [{ name: 'MainTabs', state: { routes: [{ name: 'AlbumWorkbench' }] } }],
            }),
          );
      }, VERIFY_DELAY_MS);
    },
    [navigation, deviceId, host, port],
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
      <View style={styles.container}>
        {/* Device name context */}
        <Text style={styles.deviceLabel}>{'正在连接'}: {deviceName} ({host})</Text>

        {/* Prompt */}
        <Text style={styles.prompt}>{'请输入电脑端显示的 6 位连接码'}</Text>

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

        {/* Status: verifying */}
        {verifying && (
          <View style={styles.statusRow}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.statusText}>{'正在验证连接码...'}</Text>
          </View>
        )}

        {/* Status: error */}
        {error && (
          <Text style={styles.errorText} numberOfLines={2}>
            {errorMsg || '连接码错误，请重新输入'}
          </Text>
        )}

        {/* Help text */}
        <View style={styles.helpCard}>
          <Text style={styles.helpText}>
            {'请确保手机与电脑处于同一局域网下，在电脑端打开应用即可看到连接码'}
          </Text>
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
    backgroundColor: '#c4e4f5',
  },
  container: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 60,
  },

  // Device label
  deviceLabel: {
    fontSize: 13,
    color: '#6a96b8',
    marginBottom: 24,
  },

  // Prompt
  prompt: {
    fontSize: 14,
    color: colors.foreground,
    opacity: 0.7,
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
    width: 44,
    height: 56,
    borderRadius: 16,
    borderWidth: 2,
    textAlign: 'center',
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.foreground,
    // Shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  codeBoxEmpty: {
    borderColor: 'rgba(255,255,255,0.6)',
    backgroundColor: 'rgba(255,255,255,0.7)',
  },
  codeBoxFilled: {
    borderColor: 'rgba(42,108,181,0.4)',
    backgroundColor: '#ffffff',
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
    marginTop: 4,
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

  // Help card
  helpCard: {
    marginTop: 40,
    backgroundColor: 'rgba(255,255,255,0.5)',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  helpText: {
    fontSize: 12,
    color: 'rgba(26,42,60,0.5)',
    lineHeight: 18,
    textAlign: 'center',
  },
});
