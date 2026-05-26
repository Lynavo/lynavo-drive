import React, { useState, useCallback } from 'react';
import {
  Alert,
  ActivityIndicator,
  Keyboard,
  Linking,
  Modal,
  Pressable,
  ScrollView,
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
  authSingleLineInputStyle,
  authTextScalingProps,
} from '../components/auth/authPlatformStyles';
import { useAuth } from '../stores/auth-store';
import { isValidChinaPhone } from '../utils/phone-validation';
import { sendSmsCode, sendEmailCode } from '../services/auth-service';
import { ApiError, ERROR_CODE } from '../services/api';
import { PRIVACY_POLICY_URL, USER_AGREEMENT_URL } from '../constants/legal';
import { isGlobalMarket } from '../markets';
import { COUNTRY_CODES, CountryCodeInfo } from '../constants/countries';

// ---------------------------------------------------------------------------
// Navigation types
// ---------------------------------------------------------------------------

type LoginNavProp = StackNavigationProp<RootStackParamList, 'Login'>;

// ---------------------------------------------------------------------------
// LoginScreen
// ---------------------------------------------------------------------------

export function LoginScreen() {
  const navigation = useNavigation<LoginNavProp>();
  const { t, i18n } = useTranslation();
  const auth = useAuth();
  const isGlobal = isGlobalMarket();
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [sending, setSending] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [hasTouched, setHasTouched] = useState(false);

  const [selectedCountry, setSelectedCountry] = useState<CountryCodeInfo>(COUNTRY_CODES[0]);
  const [isPickerVisible, setIsPickerVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const openPicker = useCallback(() => {
    setIsPickerVisible(true);
  }, []);

  const closePicker = useCallback(() => {
    setIsPickerVisible(false);
    setSearchQuery('');
  }, []);

  const getPhoneErrorMessage = useCallback((country: CountryCodeInfo) => {
    if (country.code === '+86') {
      return t('auth.login.phoneInvalidSimplified');
    }
    const isZh = i18n.language?.startsWith('zh');
    const isHant = i18n.language === 'zh-Hant' || i18n.language?.startsWith('zh-TW') || i18n.language?.startsWith('zh-HK');
    const countryName = isZh ? country.nameZh : country.nameEn;
    if (isZh) {
      return isHant
        ? `請輸入有效的 ${countryName} 手機號碼`
        : `请输入有效的 ${countryName} 手机号码`;
    } else {
      return `Please enter a valid ${countryName} phone number.`;
    }
  }, [t, i18n.language]);

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

  // -----------------------------------------------------------------------
  // Derived state
  // -----------------------------------------------------------------------

  const phoneValid = selectedCountry.code === '+86'
    ? isValidChinaPhone(phone)
    : /^\d+$/.test(phone) &&
      phone.length >= selectedCountry.minLength &&
      phone.length <= selectedCountry.maxLength;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const emailValid = emailRegex.test(email);
  const buttonEnabled = isGlobal
    ? emailValid && agreed && !sending
    : phoneValid && agreed && !sending;

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------

  const handlePhoneChange = useCallback((value: string) => {
    // Only allow digits
    const digits = value.replace(/\D/g, '').slice(0, selectedCountry.maxLength);
    setPhone(digits);
    setHasTouched(true);

    const isChina = selectedCountry.code === '+86';
    const isValid = isChina
      ? isValidChinaPhone(digits)
      : /^\d+$/.test(digits) &&
        digits.length >= selectedCountry.minLength &&
        digits.length <= selectedCountry.maxLength;

    if (digits.length > 0 && digits.length === selectedCountry.maxLength && !isValid) {
      setPhoneError(getPhoneErrorMessage(selectedCountry));
    } else {
      setPhoneError(null);
    }
  }, [selectedCountry, getPhoneErrorMessage]);

  const handlePhoneBlur = useCallback(() => {
    if (hasTouched && phone.length > 0) {
      const isChina = selectedCountry.code === '+86';
      const isValid = isChina
        ? isValidChinaPhone(phone)
        : /^\d+$/.test(phone) &&
          phone.length >= selectedCountry.minLength &&
          phone.length <= selectedCountry.maxLength;

      if (!isValid) {
        setPhoneError(getPhoneErrorMessage(selectedCountry));
      } else {
        setPhoneError(null);
      }
    }
  }, [hasTouched, phone, selectedCountry, getPhoneErrorMessage]);

  const handleEmailChange = useCallback((value: string) => {
    const trimmed = value.trim();
    setEmail(trimmed);
    setHasTouched(true);

    if (trimmed.length > 0 && !emailRegex.test(trimmed)) {
      setEmailError(t('auth.login.emailInvalid'));
    } else {
      setEmailError(null);
    }
  }, [t]);

  const handleEmailBlur = useCallback(() => {
    if (hasTouched && email.length > 0 && !emailRegex.test(email)) {
      setEmailError(t('auth.login.emailInvalid'));
    }
  }, [hasTouched, email, t]);

  const handleSendCode = useCallback(async () => {
    if (!buttonEnabled) return;

    Keyboard.dismiss();
    setSending(true);
    setPhoneError(null);
    setEmailError(null);

    try {
      if (isGlobal) {
        await sendEmailCode(email);
        setSending(false);
        navigation.navigate('SmsVerify', { email });
      } else {
        const fullPhone = selectedCountry.code + phone;
        const { authBaseUrl } = await sendSmsCode(fullPhone);
        setSending(false);
        navigation.navigate('SmsVerify', { phone: fullPhone, authBaseUrl });
      }
    } catch (err) {
      setSending(false);

      if (err instanceof ApiError) {
        switch (err.code) {
          case ERROR_CODE.PHONE_FORMAT_INVALID:
            setPhoneError(t('auth.login.phoneInvalidTraditional'));
            break;
          case ERROR_CODE.EMAIL_FORMAT_INVALID:
            setEmailError(t('auth.login.emailInvalid'));
            break;
          case ERROR_CODE.SMS_TOO_FREQUENT:
          case ERROR_CODE.RATE_LIMITED:
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
  }, [buttonEnabled, isGlobal, email, phone, navigation, t]);

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
    <AuthScreenShell subtitle={isGlobal ? t('auth.login.subtitleEmail') : t('auth.login.subtitle')}>
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
                (isGlobal ? emailError : phoneError) ? styles.phoneFieldError : null,
              ]}
            >
              {isGlobal ? (
                <View style={[styles.phonePrefix, { marginRight: 8 }]}>
                  <Icon
                    name="mail-outline"
                    size={16}
                    color={AUTH_COLORS.textMuted}
                  />
                </View>
              ) : (
                <>
                  <TouchableOpacity
                    accessibilityRole="combobox"
                    onPress={openPicker}
                    style={styles.phonePrefix}
                  >
                    <Text style={styles.flagText}>{selectedCountry.flag}</Text>
                    <Text {...authTextScalingProps} style={styles.prefixText}>
                      {selectedCountry.code}
                    </Text>
                    <Text style={styles.dropdownArrow}>▼</Text>
                  </TouchableOpacity>
                  <View style={styles.divider} />
                </>
              )}
              <TextInput
                {...authTextScalingProps}
                style={styles.phoneInput}
                value={isGlobal ? email : phone}
                onChangeText={isGlobal ? handleEmailChange : handlePhoneChange}
                onBlur={isGlobal ? handleEmailBlur : handlePhoneBlur}
                keyboardType={isGlobal ? 'email-address' : 'phone-pad'}
                maxLength={isGlobal ? 128 : selectedCountry.maxLength}
                placeholder={isGlobal ? t('auth.login.emailPlaceholder') : t('auth.login.phonePlaceholder')}
                placeholderTextColor={AUTH_COLORS.textFaint}
                editable={!sending}
                returnKeyType="done"
                selectionColor={AUTH_COLORS.primary}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            {(isGlobal ? emailError : phoneError) && (
              <Text {...authTextScalingProps} style={styles.phoneErrorText}>
                {isGlobal ? emailError : phoneError}
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
                        setPhone('');
                        setPhoneError(null);
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
    fontSize: 15,
    fontWeight: '500',
    color: AUTH_COLORS.text,
    ...authSingleLineInputStyle,
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
  dropdownArrow: {
    fontSize: 8,
    color: AUTH_COLORS.textMuted,
    marginLeft: 2,
    marginTop: 1,
  },
  flagText: {
    fontSize: 16,
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
