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
import { authTextScalingProps } from './authPlatformStyles';

const APP_LOGO = require('../../assets/icons/app-logo.png');

export const AUTH_COLORS = {
  background: '#ffffff',
  surface: 'rgba(255,255,255,0.86)',
  surfaceBorder: 'rgba(59,130,246,0.08)',
  primary: '#3b82f6',
  primaryPressed: '#2563eb',
  primaryDisabled: 'rgba(0,0,0,0.06)',
  primaryTextDisabled: '#b0c0d0',
  text: '#1a2a3a',
  textMuted: '#5a7a96',
  textFaint: '#8a9ab0',
  inputBackground: 'rgba(248,250,252,0.90)',
  inputBorder: 'rgba(59,130,246,0.12)',
  inputBorderStrong: 'rgba(59,130,246,0.40)',
  danger: '#db5b66',
  link: '#3b82f6',
  checkFill: '#3b82f6',
  checkBorder: 'rgba(0,0,0,0.15)',
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
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#e0f2fe" />
      <View style={styles.backgroundLayer} pointerEvents="none">
        <View style={styles.topWash} />
        <View style={styles.middleWash} />
        <View style={styles.bottomWash} />
      </View>
      <SafeAreaView
        style={styles.safeArea}
        edges={['top', 'bottom', 'left', 'right']}
      >
        <KeyboardAvoidingView
          style={styles.keyboardRoot}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {onBack ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={t('common.back')}
              activeOpacity={0.8}
              onPress={onBack}
              style={styles.backButton}
            >
              <Icon name="chevron-back" size={18} color={AUTH_COLORS.text} />
            </TouchableOpacity>
          ) : null}

          <ScrollView
            style={styles.scrollView}
            bounces={false}
            contentContainerStyle={[styles.scrollContent, contentStyle]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.brandSection}>
              <View style={styles.logoWrap}>
                <Image
                  source={APP_LOGO}
                  style={styles.logo}
                  resizeMode="contain"
                />
              </View>
              <Text {...authTextScalingProps} style={styles.brandTitle}>
                Vivi Drop
              </Text>
              <Text {...authTextScalingProps} style={styles.brandSubtitle}>
                {subtitle}
              </Text>
            </View>

            {children}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: AUTH_COLORS.background,
  },
  safeArea: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  keyboardRoot: {
    flex: 1,
  },
  backgroundLayer: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  topWash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '34%',
    backgroundColor: '#e0f2fe',
  },
  middleWash: {
    position: 'absolute',
    top: '28%',
    left: 0,
    right: 0,
    height: '34%',
    backgroundColor: '#f0f9ff',
  },
  bottomWash: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '45%',
    backgroundColor: '#ffffff',
  },
  backButton: {
    position: 'absolute',
    top: 14,
    left: 20,
    zIndex: 2,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.62)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 32,
  },
  scrollView: {
    flex: 1,
  },
  brandSection: {
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 32,
  },
  logoWrap: {
    width: 116,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  logo: {
    width: 116,
    height: 64,
  },
  brandTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: AUTH_COLORS.text,
  },
  brandSubtitle: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
    color: AUTH_COLORS.textMuted,
    textAlign: 'center',
  },
});
