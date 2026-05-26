import React, { useEffect, useState, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  NativeModules,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import Svg, { Path } from 'react-native-svg';

import { AUTH_COLORS, AuthScreenShell } from '../components/auth/AuthScreenShell';
import {
  authCardSurfaceStyle,
  authSingleLineInputStyle,
  authTextScalingProps,
} from '../components/auth/authPlatformStyles';
import { appleLogin, googleLogin, sendEmailCode, sendSmsCode } from '../services/auth-service';
import { useAuth } from '../stores/auth-store';
import { PRIVACY_POLICY_URL, USER_AGREEMENT_URL } from '../constants/legal';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { Icon } from '../components/Icon';
import { isValidChinaPhone } from '../utils/phone-validation';
import { COUNTRY_CODES } from '../constants/countries';

type Provider = 'apple' | 'google' | 'email';
type LoginGlobalNavProp = StackNavigationProp<RootStackParamList, 'Login'>;

// ---------------------------------------------------------------------------
// Premium Native SVG Icons
// ---------------------------------------------------------------------------

function AppleIcon({ color = '#000000' }: { color?: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 16 16">
      <Path
        d="M11.182.008C11.148-.03 9.923.023 8.857 1.18c-1.066 1.156-.902 2.482-.878 2.516s1.52.087 2.475-1.258.762-2.391.728-2.43m3.314 11.733c-.048-.096-2.325-1.234-2.113-3.422s1.675-2.789 1.698-2.854-.597-.79-1.254-1.157a3.7 3.7 0 0 0-1.563-.434c-.108-.003-.483-.095-1.254.116-.508.139-1.653.589-1.968.607-.316.018-1.256-.522-2.267-.665-.647-.125-1.333.131-1.824.328-.49.196-1.422.754-2.074 2.237-.652 1.482-.311 3.83-.067 4.56s.625 1.924 1.273 2.796c.576.984 1.34 1.667 1.659 1.899s1.219.386 1.843.067c.502-.308 1.408-.485 1.766-.472.357.013 1.061.154 1.782.539.571.197 1.111.115 1.652-.105.541-.221 1.324-1.059 2.238-2.758q.52-1.185.473-1.282"
        fill={color}
      />
    </Svg>
  );
}

function GoogleIcon() {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <Path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <Path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
        fill="#FBBC05"
      />
      <Path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
        fill="#EA4335"
      />
    </Svg>
  );
}

function PhoneIcon({ color = '#1a2a3a' }: { color?: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Path
        d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}



export function LoginGlobalScreen() {
  const navigation = useNavigation<LoginGlobalNavProp>();
  const [method, setMethod] = useState<'email' | 'phone'>('phone');
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pendingProvider, setPendingProvider] = useState<Provider | null>(null);
  const [selectedCountry, setSelectedCountry] = useState(
    COUNTRY_CODES.find(c => c.iso === 'CN') || COUNTRY_CODES[0]
  );
  const [isPickerVisible, setIsPickerVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const { login } = useAuth();

  const closePicker = useCallback(() => {
    setIsPickerVisible(false);
    setSearchQuery('');
  }, []);

  const filteredCountries = COUNTRY_CODES.filter(country => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return true;
    return (
      country.nameEn.toLowerCase().includes(query) ||
      country.nameZh.toLowerCase().includes(query) ||
      country.code.includes(query) ||
      country.iso.toLowerCase().includes(query)
    );
  });

  const isPhoneMode = method === 'phone';
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const isButtonEnabled = inputValue.trim().length > 0 && !pendingProvider;

  useEffect(() => {
    try {
      GoogleSignin.configure({
        webClientId: '318131526906-jdsojdqh6057pn3fo5hhtgudht1bh6c8.apps.googleusercontent.com',
      });
    } catch (err) {
      console.warn('Failed to configure Google Sign-In:', err);
    }
  }, []);

  const handleProviderPress = async (provider: 'apple' | 'google') => {
    if (pendingProvider) return;
    setPendingProvider(provider);
    try {
      if (provider === 'apple') {
        const { AppleAuthModule } = NativeModules;
        if (!AppleAuthModule) {
          throw new Error('Apple Sign-In is only supported on iOS devices.');
        }
        const res = await AppleAuthModule.login();
        const authRes = await appleLogin({
          identityToken: res.identityToken,
          authorizationCode: res.authorizationCode,
          fullName: res.fullName,
        });
        login(authRes.accessToken, authRes.refreshToken);
      } else {
        await GoogleSignin.hasPlayServices();
        const userInfo = await GoogleSignin.signIn();
        const idToken = userInfo.data?.idToken || (userInfo as any).idToken;
        if (!idToken) {
          throw new Error('Google Sign-In failed: No ID token returned.');
        }
        const authRes = await googleLogin(idToken);
        login(authRes.accessToken, authRes.refreshToken);
      }
    } catch (err: any) {
      const isCancelled =
        err.code === 'SIGN_IN_CANCELLED' ||
        err.message === 'Sign in cancelled' ||
        err.message?.includes('cancel');

      if (!isCancelled) {
        Alert.alert('Sign In Failed', err.message || String(err));
      }
    } finally {
      setPendingProvider(null);
    }
  };


  const handleInputChange = useCallback((val: string) => {
    if (isPhoneMode) {
      // Only allow digits for phone number
      const digits = val.replace(/\D/g, '').slice(0, selectedCountry.maxLength);
      setInputValue(digits);
    } else {
      setInputValue(val.trim());
    }
    setError(null);
  }, [isPhoneMode, selectedCountry]);

  const handleContinue = useCallback(async () => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;

    if (isPhoneMode) {
      const isChina = selectedCountry.code === '+86';
      const isValid = isChina
        ? isValidChinaPhone(trimmed)
        : /^\d+$/.test(trimmed) &&
          trimmed.length >= selectedCountry.minLength &&
          trimmed.length <= selectedCountry.maxLength;

      if (!isValid) {
        setError(
          isChina
            ? 'Please enter a valid phone number.'
            : `Please enter a valid ${selectedCountry.nameEn} phone number.`,
        );
        return;
      }

      const fullPhone = selectedCountry.code + trimmed;
      setError(null);
      setPendingProvider('email'); // reuse indicator state
      try {
        const { authBaseUrl } = await sendSmsCode(fullPhone);
        setPendingProvider(null);
        navigation.navigate('SmsVerify', { phone: fullPhone, authBaseUrl });
      } catch (err: any) {
        setPendingProvider(null);
        Alert.alert('Error', err.message || 'Failed to send SMS verification code.');
      }
    } else {
      if (!emailRegex.test(trimmed)) {
        setError('Please enter a valid email address.');
        return;
      }
      setError(null);
      setPendingProvider('email');
      try {
        await sendEmailCode(trimmed);
        setPendingProvider(null);
        navigation.navigate('SmsVerify', { email: trimmed });
      } catch (err: any) {
        setPendingProvider(null);
        Alert.alert('Error', err.message || 'Failed to send email verification code.');
      }
    }
  }, [inputValue, isPhoneMode, selectedCountry, navigation]);

  const handleOpenTerms = useCallback(() => {
    Linking.openURL(USER_AGREEMENT_URL);
  }, []);

  const handleOpenPrivacy = useCallback(() => {
    Linking.openURL(PRIVACY_POLICY_URL);
  }, []);

  return (
    <AuthScreenShell subtitle="Connect your desktop and keep media in sync.">
      <View style={styles.card}>
        {/* Header Title */}
        <Text style={styles.title}>Log in or sign up</Text>

        {/* Provider Buttons */}
        <View style={styles.buttonList}>
          <Pressable
            accessibilityRole="button"
            disabled={pendingProvider !== null}
            onPress={() => void handleProviderPress('google')}
            style={({ pressed }) => [
              styles.providerButton,
              pendingProvider !== null ? styles.buttonDisabled : null,
              pressed ? styles.buttonPressed : null,
            ]}
          >
            {pendingProvider === 'google' ? (
              <ActivityIndicator size="small" color={AUTH_COLORS.text} />
            ) : (
              <View style={styles.buttonContent}>
                <GoogleIcon />
                <Text style={styles.providerText}>Continue with Google</Text>
              </View>
            )}
          </Pressable>

          <Pressable
            accessibilityRole="button"
            disabled={pendingProvider !== null}
            onPress={() => void handleProviderPress('apple')}
            style={({ pressed }) => [
              styles.providerButton,
              pendingProvider !== null ? styles.buttonDisabled : null,
              pressed ? styles.buttonPressed : null,
            ]}
          >
            {pendingProvider === 'apple' ? (
              <ActivityIndicator size="small" color={AUTH_COLORS.text} />
            ) : (
              <View style={styles.buttonContent}>
                <AppleIcon color={AUTH_COLORS.text} />
                <Text style={styles.providerText}>Continue with Apple</Text>
              </View>
            )}
          </Pressable>
        </View>

        {/* OR Divider */}
        <View style={styles.dividerContainer}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>OR</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* Dynamic Address Input (Pill styled) */}
        <View style={styles.inputSection}>
          <View
            style={[
              styles.inputContainer,
              error ? styles.textInputError : null,
            ]}
          >
            {isPhoneMode ? (
              <>
                <TouchableOpacity
                  accessibilityRole="combobox"
                  onPress={() => setIsPickerVisible(true)}
                  style={styles.phonePrefix}
                >
                  <PhoneIcon color={AUTH_COLORS.textMuted} />
                  <Text {...authTextScalingProps} style={styles.prefixText}>
                    {selectedCountry.code}
                  </Text>
                  <Text style={styles.dropdownArrow}>▼</Text>
                </TouchableOpacity>
                <View style={styles.inputDivider} />
              </>
            ) : (
              <View style={[styles.phonePrefix, { marginRight: 8 }]}>
                <Icon
                  name="mail-outline"
                  size={16}
                  color={AUTH_COLORS.textMuted}
                />
              </View>
            )}
            <TextInput
              {...authTextScalingProps}
              style={styles.textInput}
              value={inputValue}
              onChangeText={handleInputChange}
              keyboardType={isPhoneMode ? 'phone-pad' : 'email-address'}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={isPhoneMode ? 'Phone number' : 'Email address'}
              placeholderTextColor={AUTH_COLORS.textFaint}
              editable={!pendingProvider}
              returnKeyType="done"
              selectionColor={AUTH_COLORS.primary}
              maxLength={isPhoneMode ? selectedCountry.maxLength : 128}
              onSubmitEditing={handleContinue}
            />
          </View>
          {error && (
            <Text style={styles.errorText}>{error}</Text>
          )}
        </View>

        {/* Continue Action Button */}
        <Pressable
          accessibilityRole="button"
          disabled={!isButtonEnabled}
          onPress={handleContinue}
          style={({ pressed }) => [
            styles.continueButton,
            !isButtonEnabled ? styles.continueButtonDisabled : null,
            pressed ? { opacity: 0.9 } : null,
          ]}
        >
          {pendingProvider === 'email' ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Text style={styles.continueButtonText}>Continue</Text>
          )}
        </Pressable>

        {/* Legal Footer */}
        <View style={styles.legalFooter}>
          <Text style={styles.legalText}>
            By continuing, you agree to our{' '}
            <Text style={styles.legalLink} onPress={handleOpenTerms}>
              Terms of Service
            </Text>{' '}
            and{' '}
            <Text style={styles.legalLink} onPress={handleOpenPrivacy}>
              Privacy Policy
            </Text>
            .
          </Text>
        </View>

        {/* Country Code Picker Modal */}
        <Modal
          animationType="slide"
          transparent={true}
          visible={isPickerVisible}
          onRequestClose={closePicker}
        >
          <Pressable
            style={styles.modalOverlay}
            onPress={closePicker}
          >
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Select Country / Region</Text>
                <TouchableOpacity
                  onPress={closePicker}
                  style={styles.modalCloseButton}
                >
                  <Text style={styles.modalCloseText}>Done</Text>
                </TouchableOpacity>
              </View>

              {/* Search Bar */}
              <View style={styles.searchWrapper}>
                <View style={styles.searchContainer}>
                  <Icon name="search-outline" size={16} color={AUTH_COLORS.textMuted} />
                  <TextInput
                    style={styles.searchInput}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholder="Search by country or code..."
                    placeholderTextColor={AUTH_COLORS.textFaint}
                    autoCapitalize="none"
                    autoCorrect={false}
                    clearButtonMode="while-editing"
                  />
                </View>
              </View>

              <ScrollView style={styles.countryList} keyboardShouldPersistTaps="handled">
                {filteredCountries.map((country) => (
                  <TouchableOpacity
                    key={country.iso}
                    style={[
                      styles.countryItem,
                      selectedCountry.iso === country.iso
                        ? styles.countryItemActive
                        : null,
                    ]}
                    onPress={() => {
                      setSelectedCountry(country);
                      closePicker();
                      setInputValue('');
                      setError(null);
                    }}
                  >
                    <Text style={styles.countryFlag}>{country.flag}</Text>
                    <Text style={styles.countryName}>{country.nameEn} ({country.nameZh})</Text>
                    <Text style={styles.countryCodeText}>{country.code}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </Pressable>
        </Modal>
      </View>
    </AuthScreenShell>
  );
}

const styles = StyleSheet.create({
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
    gap: 16,
  },
  title: {
    color: AUTH_COLORS.text,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 6,
  },
  buttonList: {
    gap: 12,
  },
  providerButton: {
    height: 52,
    borderRadius: 26,
    borderWidth: 1.5,
    borderColor: AUTH_COLORS.inputBorder,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    backgroundColor: 'rgba(59,130,246,0.04)',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  providerText: {
    fontSize: 15,
    fontWeight: '600',
    color: AUTH_COLORS.text,
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 8,
    paddingHorizontal: 4,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.08)',
  },
  dividerText: {
    color: AUTH_COLORS.textFaint,
    fontSize: 12,
    fontWeight: '600',
    marginHorizontal: 16,
  },
  inputSection: {
    marginBottom: 4,
  },
  inputContainer: {
    height: 52,
    borderRadius: 26,
    borderWidth: 1.5,
    borderColor: AUTH_COLORS.inputBorder,
    backgroundColor: AUTH_COLORS.inputBackground,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  textInput: {
    flex: 1,
    color: AUTH_COLORS.text,
    fontSize: 15,
    fontWeight: '500',
    ...authSingleLineInputStyle,
    paddingLeft: 4,
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
  inputDivider: {
    width: 1,
    height: 20,
    backgroundColor: 'rgba(0,0,0,0.08)',
    marginHorizontal: 10,
  },
  textInputError: {
    borderColor: AUTH_COLORS.danger,
  },
  errorText: {
    color: AUTH_COLORS.danger,
    fontSize: 13,
    marginTop: 6,
    marginLeft: 14,
  },
  continueButton: {
    height: 52,
    borderRadius: 26,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 3,
  },
  continueButtonDisabled: {
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    shadowOpacity: 0,
    elevation: 0,
  },
  continueButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
  },
  legalFooter: {
    marginTop: 8,
    paddingHorizontal: 8,
  },
  legalText: {
    fontSize: 12,
    lineHeight: 18,
    color: AUTH_COLORS.textFaint,
    textAlign: 'center',
  },
  legalLink: {
    color: AUTH_COLORS.link,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 20,
    paddingBottom: 40,
    maxHeight: '60%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0, 0, 0, 0.05)',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: AUTH_COLORS.text,
  },
  modalCloseButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  modalCloseText: {
    fontSize: 15,
    fontWeight: '600',
    color: AUTH_COLORS.primary,
  },
  countryList: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  countryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  countryItemActive: {
    backgroundColor: 'rgba(59, 130, 246, 0.05)',
  },
  countryFlag: {
    fontSize: 20,
    marginRight: 14,
  },
  countryName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: AUTH_COLORS.text,
  },
  countryCodeText: {
    fontSize: 15,
    fontWeight: '600',
    color: AUTH_COLORS.textMuted,
  },
  dropdownArrow: {
    fontSize: 8,
    color: AUTH_COLORS.textMuted,
    marginLeft: 2,
    marginTop: 1,
  },
  searchWrapper: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 12,
  },
  searchContainer: {
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: AUTH_COLORS.inputBorder,
    backgroundColor: AUTH_COLORS.inputBackground,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    color: AUTH_COLORS.text,
    fontSize: 14,
    fontWeight: '500',
    padding: 0,
  },
});
