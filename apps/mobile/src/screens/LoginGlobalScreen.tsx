import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  type GestureResponderEvent,
  Image,
  Linking,
  Modal,
  NativeModules,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import Svg, {
  Path,
} from 'react-native-svg';

import {
  GLOBAL_AUTH_COLORS as AUTH_COLORS,
  GlobalAuthScreenShell,
} from '../components/auth/GlobalAuthScreenShell';
import {
  authTextScalingProps,
  getAuthTextScalingProps,
} from '../components/auth/authPlatformStyles';
import { appleLogin, googleLogin, sendEmailCode, emailLogin } from '../services/auth-service';
import { useAuth } from '../stores/auth-store';
import { PRIVACY_POLICY_URL, USER_AGREEMENT_URL } from '../constants/legal';
import { ModalBlurBackdrop } from '../components/shared/ModalBlurBackdrop';
import { androidBoxShadow } from '../utils/androidShadow';

const VIVIDROP_LOGO = require('../assets/icons/vividrop-logo.png');

type Provider = 'apple' | 'google' | 'email';

function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0) return message;
  }
  return typeof err === 'string' && err.length > 0 ? err : fallback;
}

function isProviderSignInCancelled(err: unknown): boolean {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? (err as { code?: unknown }).code
      : null;
  const message = getErrorMessage(err, '');

  return (
    code === 'SIGN_IN_CANCELLED' ||
    message === 'Sign in cancelled' ||
    message.toLowerCase().includes('cancel')
  );
}

function getGoogleIdToken(
  userInfo: Awaited<ReturnType<typeof GoogleSignin.signIn>>,
): string | null {
  if (userInfo.data?.idToken) return userInfo.data.idToken;
  if (
    typeof userInfo === 'object' &&
    userInfo !== null &&
    'idToken' in userInfo
  ) {
    const idToken = (userInfo as { idToken?: unknown }).idToken;
    if (typeof idToken === 'string' && idToken.length > 0) return idToken;
  }
  return null;
}

export function LoginGlobalScreen() {
  const [authProvider, setAuthProvider] = useState<Provider | null>(null);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [agreementProvider, setAgreementProvider] = useState<Provider | null>(
    null,
  );
  const [pendingProvider, setPendingProvider] = useState<Provider | null>(null);
  const { login } = useAuth();

  const [loginMethod, setLoginMethod] = useState<'oauth' | 'email'>('oauth');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [codeFocused, setCodeFocused] = useState(false);
  const showAppleSignIn = Platform.OS === 'ios';
  const textInputScalingProps =
    Platform.OS === 'android' ? getAuthTextScalingProps('android') : {};

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => {
      setCountdown(prev => prev - 1);
    }, 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const handleSendCode = async () => {
    if (!email.trim()) {
      Alert.alert('提示', '请输入电子邮箱');
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      Alert.alert('错误', '请输入有效的电子邮箱地址');
      return;
    }

    setIsSendingCode(true);
    try {
      await sendEmailCode(email.trim());
      Alert.alert('提示', '验证码已发送至您的邮箱，请注意查收');
      setCountdown(60);
    } catch (error) {
      Alert.alert('发送失败', getErrorMessage(error, '发送验证码失败'));
    } finally {
      setIsSendingCode(false);
    }
  };

  const handleEmailLoginSubmit = async () => {
    if (!agreedToTerms) {
      setAgreementProvider('email');
      return;
    }
    if (!email.trim()) {
      Alert.alert('提示', '请输入电子邮箱');
      return;
    }
    if (!code.trim() || code.trim().length !== 6) {
      Alert.alert('提示', '请输入 6 位数验证码');
      return;
    }

    setIsLoggingIn(true);
    try {
      const authRes = await emailLogin(email.trim(), code.trim());
      login(authRes.accessToken, authRes.refreshToken);
    } catch (error) {
      Alert.alert(
        '登录失败',
        getErrorMessage(error, '登录失败，验证码可能错误或已过期'),
      );
    } finally {
      setIsLoggingIn(false);
    }
  };

  useEffect(() => {
    try {
      GoogleSignin.configure({
        webClientId:
          '318131526906-jdsojdqh6057pn3fo5hhtgudht1bh6c8.apps.googleusercontent.com',
      });
    } catch (err) {
      console.warn('Failed to configure Google Sign-In:', err);
    }
  }, []);

  const beginProviderLogin = (provider: Provider) => {
    if (pendingProvider) return;
    if (provider === 'apple' && !showAppleSignIn) return;

    if (!agreedToTerms) {
      setAgreementProvider(provider);
      return;
    }

    setAuthProvider(provider);
  };

  const handleProviderPress = async (provider: Provider) => {
    if (pendingProvider) return;
    if (provider === 'apple' && !showAppleSignIn) return;
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
        const idToken = getGoogleIdToken(userInfo);
        if (!idToken) {
          throw new Error('Google Sign-In failed: No ID token returned.');
        }
        const authRes = await googleLogin(idToken);
        login(authRes.accessToken, authRes.refreshToken);
      }
    } catch (err: unknown) {
      if (!isProviderSignInCancelled(err)) {
        Alert.alert('Sign In Failed', getErrorMessage(err, 'Unknown error'));
      }
    } finally {
      setPendingProvider(null);
      setAuthProvider(null);
    }
  };

  const handleOpenTerms = () => {
    Linking.openURL(USER_AGREEMENT_URL);
  };

  const handleOpenPrivacy = () => {
    Linking.openURL(PRIVACY_POLICY_URL);
  };

  return (
    <GlobalAuthScreenShell>
      <View style={styles.pageContent}>
        <View style={styles.heroSection}>
          <View style={styles.brandCol}>
            <View style={styles.logoBox}>
              <Image
                source={VIVIDROP_LOGO}
                style={styles.logoImage}
                resizeMode="contain"
              />
            </View>
            <View style={styles.brandTextWrap}>
              <Text {...authTextScalingProps} style={styles.brandTitle}>
                Vivi Drop
              </Text>
              <Text {...authTextScalingProps} style={styles.brandSubtitle}>
                Connect your desktop and keep media in sync.
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.authCard}>
          <Text {...authTextScalingProps} style={styles.cardTitle}>
            {loginMethod === 'oauth' ? '登录或创建账号' : '邮箱登录'}
          </Text>
          <Text {...authTextScalingProps} style={styles.cardDescription}>
            {loginMethod === 'oauth'
              ? '使用现有账号继续，稍后可连接电脑设备。'
              : '未注册的账号将自动注册，稍后可连接电脑设备。'}
          </Text>

          {loginMethod === 'oauth' ? (
            <View style={styles.providerList}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="使用 Google 继续"
                disabled={pendingProvider !== null}
                onPress={() => beginProviderLogin('google')}
                testID="global-auth-google-provider-button"
                style={({ pressed }) => [
                  styles.providerButton,
                  pressed ? styles.providerButtonPressed : null,
                  pendingProvider !== null ? styles.providerButtonDisabled : null,
                ]}
              >
                {pendingProvider === 'google' ? (
                  <ActivityIndicator size="small" color={AUTH_COLORS.text} />
                ) : (
                  <>
                    <GoogleSvgIcon size={20} />
                    <Text {...authTextScalingProps} style={styles.providerText}>
                      使用 Google 继续
                    </Text>
                  </>
                )}
              </Pressable>

              {showAppleSignIn ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="使用 Apple 继续"
                  disabled={pendingProvider !== null}
                  onPress={() => beginProviderLogin('apple')}
                  testID="global-auth-apple-provider-button"
                  style={({ pressed }) => [
                    styles.providerButton,
                    pressed ? styles.providerButtonPressed : null,
                    pendingProvider !== null
                      ? styles.providerButtonDisabled
                      : null,
                  ]}
                >
                  {pendingProvider === 'apple' ? (
                    <ActivityIndicator size="small" color={AUTH_COLORS.text} />
                  ) : (
                    <>
                      <AppleSvgIcon size={20} color={AUTH_COLORS.text} />
                      <Text
                        {...authTextScalingProps}
                        style={styles.providerText}
                      >
                        使用 Apple 继续
                      </Text>
                    </>
                  )}
                </Pressable>
              ) : null}

              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>或</Text>
                <View style={styles.dividerLine} />
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="使用邮箱登录"
                onPress={() => setLoginMethod('email')}
                style={({ pressed }) => [
                  styles.emailChooseButton,
                  pressed ? styles.providerButtonPressed : null,
                ]}
              >
                <MailSvgIcon size={18} color={AUTH_COLORS.text} />
                <Text {...authTextScalingProps} style={styles.providerText}>
                  使用邮箱登录
                </Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.providerList}>
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>电子邮箱</Text>
                <TextInput
                  {...textInputScalingProps}
                  accessibilityLabel="请输入电子邮箱"
                  placeholder="请输入电子邮箱"
                  placeholderTextColor="#7B8490"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={email}
                  onChangeText={setEmail}
                  onFocus={() => setEmailFocused(true)}
                  onBlur={() => setEmailFocused(false)}
                  editable={!isLoggingIn && !isSendingCode}
                  style={[
                    styles.input,
                    Platform.OS === 'android' ? styles.androidInputText : null,
                    emailFocused ? styles.inputFocused : null,
                  ]}
                />
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>验证码</Text>
                <View style={styles.codeInputRow}>
                  <TextInput
                    {...textInputScalingProps}
                    accessibilityLabel="6 位数验证码"
                    placeholder="6 位数验证码"
                    placeholderTextColor="#7B8490"
                    keyboardType="number-pad"
                    maxLength={6}
                    value={code}
                    onChangeText={text => setCode(text.replace(/\D/g, ''))}
                    onFocus={() => setCodeFocused(true)}
                    onBlur={() => setCodeFocused(false)}
                    editable={!isLoggingIn}
                    style={[
                      styles.input,
                      styles.codeInput,
                      Platform.OS === 'android' ? styles.androidInputText : null,
                      codeFocused ? styles.inputFocused : null,
                    ]}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      isSendingCode
                        ? '正在获取验证码'
                        : countdown > 0
                        ? `已发送 ${countdown}秒`
                        : '获取验证码'
                    }
                    onPress={handleSendCode}
                    disabled={isSendingCode || countdown > 0}
                    style={({ pressed }) => [
                      styles.sendCodeButton,
                      pressed ? styles.providerButtonPressed : null,
                      isSendingCode || countdown > 0
                        ? styles.sendCodeButtonDisabled
                        : null,
                    ]}
                  >
                    {isSendingCode ? (
                      <ActivityIndicator size="small" color={AUTH_COLORS.text} />
                    ) : (
                      <Text style={styles.sendCodeButtonText}>
                        {countdown > 0 ? `已发送 (${countdown}s)` : '获取验证码'}
                      </Text>
                    )}
                  </Pressable>
                </View>
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="登录"
                onPress={handleEmailLoginSubmit}
                disabled={isLoggingIn}
                style={({ pressed }) => [
                  styles.submitButton,
                  pressed ? styles.providerButtonPressed : null,
                  isLoggingIn ? styles.providerButtonDisabled : null,
                ]}
              >
                {isLoggingIn ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.submitButtonText}>登录</Text>
                )}
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="返回第三方登录"
                onPress={() => setLoginMethod('oauth')}
                style={styles.backToOAuthButton}
              >
                <Text style={styles.backToOAuthText}>返回第三方登录</Text>
              </Pressable>
            </View>
          )}

          <View style={styles.termsRow}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: agreedToTerms }}
              accessibilityLabel="Agree to terms"
              onPress={() => setAgreedToTerms(prev => !prev)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={[
                styles.checkbox,
                agreedToTerms ? styles.checkboxChecked : null,
              ]}
            >
              {agreedToTerms ? <CheckGlyph /> : null}
            </Pressable>
            <Text {...authTextScalingProps} style={styles.termsText}>
              继续即表示你同意
              <Text style={styles.termsLink} onPress={handleOpenTerms}>
                服务条款
              </Text>
              和
              <Text style={styles.termsLink} onPress={handleOpenPrivacy}>
                隐私政策
              </Text>
              。
            </Text>
          </View>
        </View>
      </View>

      <ProviderConfirmModal
        provider={authProvider}
        pendingProvider={pendingProvider}
        onCancel={() => setAuthProvider(null)}
        onContinue={provider => void handleProviderPress(provider)}
      />

      <AgreementRequiredModal
        provider={agreementProvider}
        onCancel={() => setAgreementProvider(null)}
        onContinue={provider => {
          setAgreedToTerms(true);
          setAgreementProvider(null);
          if (provider !== 'email') {
            setAuthProvider(provider);
          }
        }}
      />
    </GlobalAuthScreenShell>
  );
}

function GoogleSvgIcon({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v3.927h6.6a5.647 5.647 0 0 1-2.45 3.717v3.082h3.94c2.31-2.13 3.655-5.26 3.655-8.65z"
      />
      <Path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.94-3.082c-1.1.74-2.5 1.18-3.99 1.18-3.07 0-5.67-2.08-6.6-4.88H1.37v3.18A11.996 11.996 0 0 0 12 24z"
      />
      <Path
        fill="#FBBC05"
        d="M5.4 14.308a7.16 7.16 0 0 1 0-4.616V6.512H1.37a11.99 11.99 0 0 0 0 10.976l4.03-3.18z"
      />
      <Path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.43-3.43A11.928 11.928 0 0 0 12 0C7.3 0 3.2 2.67 1.37 6.512l4.03 3.18C6.33 6.83 8.93 4.75 12 4.75z"
      />
    </Svg>
  );
}

function AppleSvgIcon({ size = 18, color = '#000000' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.82M15.97 4.17c.66-.81 1.11-1.93.99-3.06-.96.04-2.13.64-2.82 1.45-.6.69-1.12 1.84-.98 2.94.12 0 .23.01.35.01.96 0 2.06-.59 2.46-1.34" />
    </Svg>
  );
}

function MailSvgIcon({ size = 18, color = '#17191C' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <Path d="M22 6l-10 7L2 6" />
    </Svg>
  );
}



function ShieldCheckGlyph() {
  return (
    <Svg width={23} height={23} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 3.15 5.35 5.62v5.2c0 4.3 2.72 8.36 6.65 9.97 3.93-1.61 6.65-5.67 6.65-9.97v-5.2L12 3.15z"
        stroke="#1677D2"
        strokeWidth={1.9}
        strokeLinejoin="round"
      />
      <Path
        d="m8.7 12.1 2.15 2.1 4.55-5"
        stroke="#1677D2"
        strokeWidth={2.1}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function CheckGlyph() {
  return (
    <Svg width={11} height={11} viewBox="0 0 12 12" fill="none">
      <Path
        d="m2.4 6.25 2.1 2.05 5.1-5.25"
        stroke="#FFFFFF"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function ProviderConfirmModal({
  provider,
  pendingProvider,
  onCancel,
  onContinue,
}: {
  provider: Provider | null;
  pendingProvider: Provider | null;
  onCancel: () => void;
  onContinue: (provider: Provider) => void;
}) {
  if (!provider || provider === 'email') return null;

  const isGoogle = provider === 'google';

  return (
    <AuthModalFrame
      backdropTestID="global-auth-provider-modal-backdrop"
      cardTestID="global-auth-provider-modal-card"
      onCancel={onCancel}
    >
      <View style={styles.modalCardContent}>
        <View style={[styles.modalHeader, styles.providerModalHeader]}>
          <View
            style={[
              styles.modalProviderIcon,
              isGoogle ? styles.modalGoogleIcon : styles.modalAppleIcon,
            ]}
          >
            {isGoogle ? (
              <GoogleSvgIcon size={24} />
            ) : (
              <AppleSvgIcon size={24} color={AUTH_COLORS.text} />
            )}
          </View>
          <View style={styles.modalHeaderText}>
            <Text {...authTextScalingProps} style={styles.modalTitle}>
              {isGoogle ? 'Google 授权登录' : 'Apple 授权登录'}
            </Text>
            <Text {...authTextScalingProps} style={styles.modalSubtitle}>
              {isGoogle
                ? '将打开 Google 完成账号授权。'
                : '将打开 Apple 完成账号授权。'}
            </Text>
          </View>
        </View>

        <View style={styles.modalInfoBox}>
          <Text {...authTextScalingProps} style={styles.modalInfoText}>
            {isGoogle
              ? '使用 Google 账号授权后，ViviDrop 只会用于识别账号和同步设备，不会读取你的密码。'
              : '使用 Apple ID 授权后，ViviDrop 只会用于识别账号和同步设备，不会读取你的密码。'}
          </Text>
        </View>

        <View style={styles.modalButtonRow}>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.modalSecondaryButton,
              pressed ? styles.providerButtonPressed : null,
            ]}
            onPress={onCancel}
          >
            <Text style={styles.modalSecondaryText}>取消</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: pendingProvider !== null }}
            style={({ pressed }) => [
              styles.modalPrimaryButton,
              pendingProvider !== null ? styles.modalPrimaryButtonDisabled : null,
              pressed ? styles.providerButtonPressed : null,
            ]}
            onPress={() => onContinue(provider)}
            disabled={pendingProvider !== null}
          >
            {pendingProvider === provider ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.modalPrimaryText}>继续授权</Text>
            )}
          </Pressable>
        </View>
      </View>
    </AuthModalFrame>
  );
}

function AuthModalFrame({
  backdropTestID,
  cardTestID,
  children,
  onCancel,
}: {
  backdropTestID: string;
  cardTestID: string;
  children: React.ReactNode;
  onCancel: () => void;
}) {
  const stopModalPress = (event: GestureResponderEvent) => {
    event.stopPropagation();
  };

  return (
    <Modal animationType="fade" transparent visible onRequestClose={onCancel}>
      <Pressable
        style={styles.modalBackdrop}
        testID={backdropTestID}
        onPress={onCancel}
      >
        <ModalBlurBackdrop />
        <Pressable
          style={styles.modalCard}
          testID={cardTestID}
          onPress={stopModalPress}
        >
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function AgreementRequiredModal({
  provider,
  onCancel,
  onContinue,
}: {
  provider: Provider | null;
  onCancel: () => void;
  onContinue: (provider: Provider) => void;
}) {
  if (!provider) return null;

  return (
    <AuthModalFrame
      backdropTestID="global-auth-agreement-modal-backdrop"
      cardTestID="global-auth-agreement-modal-card"
      onCancel={onCancel}
    >
      <View style={styles.modalCardContent}>
        <View style={[styles.modalHeader, styles.agreementModalHeader]}>
          <View style={styles.modalShieldIcon}>
            <ShieldCheckGlyph />
          </View>
          <View style={styles.modalHeaderText}>
            <Text {...authTextScalingProps} style={styles.modalTitle}>
              请先同意服务协议
            </Text>
            <Text {...authTextScalingProps} style={styles.modalBodyText}>
              登录前需要确认你已阅读并同意服务条款和隐私政策，之后可继续使用
              {provider === 'google' ? ' Google 授权' : provider === 'apple' ? ' Apple 授权' : ' 邮箱登录'}。
            </Text>
          </View>
        </View>

        <View style={[styles.modalInfoBox, styles.agreementModalInfoBox]}>
          <Text
            {...authTextScalingProps}
            style={[styles.modalInfoText, styles.agreementModalInfoText]}
          >
            <Text style={styles.termsLink}>服务条款</Text>
            <Text style={styles.modalDividerText}> / </Text>
            <Text style={styles.termsLink}>隐私政策</Text>
            <Text> 用于说明账号、设备连接和同步数据的处理方式。</Text>
          </Text>
        </View>

        <View style={styles.modalButtonRow}>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.modalSecondaryButton,
              pressed ? styles.providerButtonPressed : null,
            ]}
            onPress={onCancel}
          >
            <Text style={styles.modalSecondaryText}>稍后</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.modalPrimaryButton,
              pressed ? styles.providerButtonPressed : null,
            ]}
            onPress={() => onContinue(provider)}
          >
            <Text style={styles.modalPrimaryText}>同意并继续</Text>
          </Pressable>
        </View>
      </View>
    </AuthModalFrame>
  );
}

const glassShadow = {
  shadowColor: '#46608A',
  shadowOffset: { width: 0, height: 18 },
  shadowOpacity: 0.12,
  shadowRadius: 52,
  elevation: 6,
  ...androidBoxShadow({
    offsetY: 18,
    blurRadius: 52,
    color: 'rgba(70, 96, 138, 0.12)',
  }),
};



const styles = StyleSheet.create({
  pageContent: {
    flex: 1,
  },
  heroSection: {
    paddingTop: 24,
    alignItems: 'center',
    marginBottom: 16,
  },
  brandCol: {
    alignItems: 'center',
    gap: 16,
  },
  logoBox: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoImage: {
    width: 64,
    height: 64,
  },
  brandTextWrap: {
    alignItems: 'center',
  },
  brandTitle: {
    fontSize: 24,
    lineHeight: 29,
    fontWeight: '600',
    color: AUTH_COLORS.text,
    textAlign: 'center',
  },
  brandSubtitle: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
    color: AUTH_COLORS.textMuted,
    textAlign: 'center',
  },
  authCard: {
    marginTop: 40,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.70)',
    backgroundColor: 'rgba(255,255,255,0.58)',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 20,
    ...glassShadow,
  },
  cardTitle: {
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '600',
    color: AUTH_COLORS.text,
  },
  cardDescription: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 18,
    color: AUTH_COLORS.textMuted,
  },
  providerList: {
    marginTop: 20,
    gap: 12,
  },
  providerButton: {
    height: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.70)',
    backgroundColor: 'rgba(255,255,255,0.64)',
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    shadowColor: '#46608A',
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
  providerButtonPressed: {
    transform: [{ translateY: 1 }],
  },
  providerButtonDisabled: {
    opacity: 0.5,
  },
  providerText: {
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '600',
    color: AUTH_COLORS.text,
  },
  termsRow: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  checkbox: {
    marginTop: 2,
    width: 16,
    height: 16,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#C9D6E4',
    backgroundColor: 'rgba(255,255,255,0.70)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    borderColor: AUTH_COLORS.primary,
    backgroundColor: AUTH_COLORS.primary,
  },
  termsText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: '#7B8490',
  },
  termsLink: {
    fontWeight: '600',
    color: AUTH_COLORS.link,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 32,
  },
  modalCard: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.90)',
    backgroundColor: 'rgba(248,251,255,0.98)',
    overflow: 'hidden',
    shadowColor: '#23344D',
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
  modalCardContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    gap: 12,
  },
  providerModalHeader: {
    alignItems: 'center',
    marginBottom: 20,
  },
  agreementModalHeader: {
    alignItems: 'flex-start',
  },
  modalProviderIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.80)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalGoogleIcon: {
    backgroundColor: '#EEF4FF',
  },
  modalAppleIcon: {
    backgroundColor: '#F4F5F7',
  },
  modalProviderMark: {
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '600',
  },
  modalGoogleMark: {
    color: '#4285F4',
  },
  modalAppleMark: {
    color: AUTH_COLORS.text,
  },
  modalShieldIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.80)',
    backgroundColor: '#E4F5FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalHeaderText: {
    flex: 1,
  },
  modalTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    color: AUTH_COLORS.text,
  },
  modalSubtitle: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 18,
    color: AUTH_COLORS.textMuted,
  },
  modalBodyText: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 24,
    color: '#3F4A58',
  },
  modalInfoBox: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#DDE8F4',
    backgroundColor: 'rgba(255,255,255,0.96)',
    paddingHorizontal: 16,
    paddingVertical: 16,
    shadowColor: '#46608A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 22,
    elevation: 2,
    ...androidBoxShadow({
      offsetY: 8,
      blurRadius: 22,
      color: 'rgba(70, 96, 138, 0.08)',
    }),
  },
  agreementModalInfoBox: {
    marginTop: 16,
  },
  modalInfoText: {
    fontSize: 13,
    lineHeight: 24,
    color: '#3F4A58',
  },
  agreementModalInfoText: {
    fontSize: 12,
    lineHeight: 20,
  },
  modalDividerText: {
    color: '#C5CED8',
  },
  modalButtonRow: {
    marginTop: 20,
    flexDirection: 'row',
    gap: 12,
  },
  modalSecondaryButton: {
    flex: 0.78,
    height: 46,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#DDE8F4',
    backgroundColor: 'rgba(255,255,255,0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#46608A',
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
  modalSecondaryText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#3F4A58',
  },
  modalPrimaryButton: {
    flex: 1,
    height: 46,
    borderRadius: 8,
    backgroundColor: AUTH_COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: AUTH_COLORS.primary,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.18,
    shadowRadius: 28,
    elevation: 3,
  },
  modalPrimaryButtonDisabled: {
    opacity: 0.6,
    shadowOpacity: 0,
    elevation: 0,
  },
  modalPrimaryText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(207,214,223,0.4)',
  },
  dividerText: {
    marginHorizontal: 12,
    fontSize: 11,
    fontWeight: '600',
    color: '#8D96A3',
  },
  emailChooseButton: {
    height: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.70)',
    backgroundColor: 'rgba(255,255,255,0.64)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    shadowColor: '#46608A',
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
  inputContainer: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#7B8490',
    marginBottom: 6,
  },
  input: {
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cfd6df',
    backgroundColor: 'rgba(255,255,255,0.70)',
    paddingHorizontal: 12,
    fontSize: 14,
    color: AUTH_COLORS.text,
  },
  androidInputText: {
    paddingVertical: 0,
    paddingTop: 0,
    paddingBottom: 0,
    lineHeight: 20,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  inputFocused: {
    borderColor: '#17191c',
  },
  codeInputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  codeInput: {
    flex: 1,
  },
  sendCodeButton: {
    height: 40,
    minWidth: 100,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cfd6df',
    backgroundColor: 'rgba(255,255,255,0.58)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  sendCodeButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: AUTH_COLORS.text,
  },
  sendCodeButtonDisabled: {
    opacity: 0.6,
  },
  submitButton: {
    height: 44,
    borderRadius: 8,
    backgroundColor: '#17191c',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  submitButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  backToOAuthButton: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    paddingVertical: 4,
  },
  backToOAuthText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#7B8490',
  },
});
