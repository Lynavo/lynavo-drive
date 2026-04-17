import React from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Icon } from '../Icon';

const AUTH_LOGO = require('../../assets/icons/auth-logo.png');

export const AUTH_COLORS = {
  background: '#e9f6ff',
  surface: '#ffffff',
  surfaceBorder: 'rgba(194, 220, 245, 0.72)',
  primary: '#4e8ef7',
  primaryPressed: '#4380e3',
  primaryDisabled: '#e4ebf3',
  primaryTextDisabled: '#b8c6d6',
  text: '#1d334d',
  textMuted: '#6687a6',
  textFaint: '#a2b7cb',
  inputBackground: '#f8fbff',
  inputBorder: '#d7e6f7',
  inputBorderStrong: '#a7caf4',
  danger: '#db5b66',
  link: '#3f82ff',
  checkFill: '#5a9cff',
  checkBorder: '#d4dee9',
} as const;

interface AuthScreenShellProps {
  subtitle: string;
  children: React.ReactNode;
  onBack?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
}

export function AuthScreenShell({
  subtitle,
  children,
  onBack,
  contentStyle,
}: AuthScreenShellProps) {
  const { t } = useTranslation();
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor={AUTH_COLORS.background} />
      <KeyboardAvoidingView
        style={styles.keyboardRoot}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.backgroundLayer} pointerEvents="none">
          <View style={[styles.glowOrb, styles.glowOrbLeft]} />
          <View style={[styles.glowOrb, styles.glowOrbRight]} />
          <View style={styles.bottomGlow} />
        </View>

        {onBack ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            activeOpacity={0.8}
            onPress={onBack}
            style={styles.backButton}
          >
            <Icon name="chevron-back" size={24} color={AUTH_COLORS.text} />
          </TouchableOpacity>
        ) : null}

        <ScrollView
          bounces={false}
          contentContainerStyle={[styles.scrollContent, contentStyle]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.brandSection}>
            <View style={styles.logoWrap}>
              <Image source={AUTH_LOGO} style={styles.logo} resizeMode="contain" />
            </View>
            <Text style={styles.brandTitle}>Vivi Drop</Text>
            <Text style={styles.brandSubtitle}>{subtitle}</Text>
          </View>

          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: AUTH_COLORS.background,
  },
  keyboardRoot: {
    flex: 1,
  },
  backgroundLayer: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  glowOrb: {
    position: 'absolute',
    top: '28%',
    width: 220,
    height: 520,
    borderRadius: 999,
    backgroundColor: 'rgba(83, 157, 255, 0.12)',
    shadowColor: '#56a7ff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.28,
    shadowRadius: 60,
    elevation: 12,
  },
  glowOrbLeft: {
    left: -168,
  },
  glowOrbRight: {
    right: -170,
  },
  bottomGlow: {
    position: 'absolute',
    left: 40,
    right: 40,
    bottom: -80,
    height: 180,
    borderRadius: 999,
    backgroundColor: 'rgba(70, 126, 255, 0.10)',
    shadowColor: '#4f90ff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.22,
    shadowRadius: 50,
    elevation: 10,
  },
  backButton: {
    position: 'absolute',
    top: 12,
    left: 24,
    zIndex: 2,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#4f90ff',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 6,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 42,
    paddingBottom: 32,
  },
  brandSection: {
    alignItems: 'center',
    marginTop: 56,
    marginBottom: 30,
  },
  logoWrap: {
    width: 84,
    height: 84,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  logo: {
    width: 72,
    height: 72,
  },
  brandTitle: {
    fontSize: 30,
    fontWeight: '800',
    color: AUTH_COLORS.text,
    letterSpacing: 0.2,
  },
  brandSubtitle: {
    marginTop: 12,
    fontSize: 17,
    lineHeight: 24,
    color: AUTH_COLORS.textMuted,
    textAlign: 'center',
  },
});
