import React, { useState, useEffect, useCallback } from 'react';
import {
  NativeModules,
  ActivityIndicator,
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
} from 'react-native';
import { createStackNavigator } from '@react-navigation/stack';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { useAuth } from '../stores/auth-store';
import type { SubscriptionInfo } from '../stores/auth-store';
import { useExpiryReminder } from '../hooks/useExpiryReminder';
import { FEATURES } from '../constants/features';
import { LoginScreen } from '../screens/LoginScreen';
import { SmsVerifyScreen } from '../screens/SmsVerifyScreen';
import { DeviceDiscoveryScreen } from '../screens/DeviceDiscoveryScreen';
import { CodeVerifyScreen } from '../screens/CodeVerifyScreen';
import { SyncActivityScreen } from '../screens/SyncActivityScreen';
import { AlbumWorkbenchScreen } from '../screens/AlbumWorkbenchScreen';
import { SharedFilesScreen } from '../screens/SharedFilesScreen';
import { HistoryScreen } from '../screens/HistoryScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { HelpScreen } from '../screens/HelpScreen';
import { QRScannerScreen } from '../screens/QRScannerScreen';
import { SubscriptionScreen } from '../screens/SubscriptionScreen';
import { AUTH_COLORS, AuthScreenShell } from '../components/auth/AuthScreenShell';

// ---------------------------------------------------------------------------
// Param lists
// ---------------------------------------------------------------------------

export type RootStackParamList = {
  Login: undefined;
  SmsVerify: { phone: string };
  DeviceDiscovery: undefined;
  CodeVerify: {
    deviceId?: string;
    host: string;
    port: number;
    deviceName?: string;
    prefilledCode?: string;
  };
  QRScanner: undefined;
  SyncActivity: undefined;
  AlbumWorkbench: undefined;
  SharedFiles: undefined;
  History: undefined;
  Settings: undefined;
  Help: undefined;
  Subscription: { isNewUser?: boolean } | undefined;
};

// ---------------------------------------------------------------------------
// Root Navigator
// ---------------------------------------------------------------------------
//
// The root chooses between two distinct stacks based on auth state. Splitting
// (rather than swapping `initialRouteName` on a shared stack) means a session
// flipped to logged-out (e.g. background refresh-token failure ⇒ clearAuth)
// triggers a React unmount/mount cycle that automatically resets navigation
// to Login — no imperative `dispatch(reset(...))` race against stale screens.

const Stack = createStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const auth = useAuth();

  // Cold-start hydration in flight.
  if (auth.isLoading) {
    return <LoadingScreen />;
  }

  if (!auth.isLoggedIn) {
    if (auth.signedOutTransition === 'account_deleted') {
      return (
        <SignedOutTransitionScreen
          onComplete={() => auth.setSignedOutTransition(null)}
        />
      );
    }
    return <UnauthStack />;
  }

  // Logged in but the user profile hasn't returned yet. Wait for it before
  // routing — otherwise we would have to optimistically grant access while
  // the subscription gate is unknown, defeating deny-by-default.
  if (!auth.user) {
    if (auth.profileError) {
      return (
        <ProfileErrorScreen
          message={auth.profileError.message}
          retrying={auth.profileLoading}
          onRetry={auth.retryProfileLoad}
          onLogout={auth.clearAuth}
        />
      );
    }
    return <LoadingScreen />;
  }

  return (
    <AuthedStack
      userStatus={auth.user.status}
      subscription={auth.subscription}
    />
  );
}

// ---------------------------------------------------------------------------
// Unauthenticated stack
// ---------------------------------------------------------------------------

function UnauthStack() {
  return (
    <Stack.Navigator
      initialRouteName="Login"
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="SmsVerify" component={SmsVerifyScreen} />
    </Stack.Navigator>
  );
}

// ---------------------------------------------------------------------------
// Expiry reminder watcher — rendered inside AuthedStack so it is always
// under NavigationContainer and can call useNavigation() safely.
// ---------------------------------------------------------------------------

function ExpiryReminderWatcher({
  subscription,
}: {
  subscription: SubscriptionInfo | null;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const navigation = useNavigation<any>();
  const onRenew = useCallback(
    () => navigation.navigate('Subscription' as never),
    [navigation],
  );
  useExpiryReminder({ subscription, onRenew });
  return null;
}

// ---------------------------------------------------------------------------
// Authenticated stack
// ---------------------------------------------------------------------------

function AuthedStack({
  userStatus,
  subscription,
}: {
  userStatus: string;
  subscription: SubscriptionInfo | null;
}) {
  const [initialRoute, setInitialRoute] =
    useState<keyof RootStackParamList | null>(null);

  useEffect(() => {
    let cancelled = false;
    const decide = async () => {
      // Subscription enforcement is feature-flagged off until real IAP
      // verification ships — without that, expired users get sent into a
      // dead end on SubscriptionScreen with no working purchase path.
      if (
        FEATURES.SUBSCRIPTION_ENFORCEMENT &&
        (userStatus === 'trial_expired' || userStatus === 'sub_expired')
      ) {
        if (!cancelled) setInitialRoute('Subscription');
        return;
      }
      try {
        const { NativeSyncEngine } = NativeModules;
        if (NativeSyncEngine) {
          const binding = await NativeSyncEngine.getBindingState();
          if (binding && binding.deviceId) {
            if (!cancelled) setInitialRoute('SyncActivity');
            return;
          }
        }
      } catch {
        /* fall through to DeviceDiscovery */
      }
      if (!cancelled) setInitialRoute('DeviceDiscovery');
    };
    decide();
    return () => {
      cancelled = true;
    };
  }, [userStatus]);

  if (!initialRoute) {
    return <LoadingScreen />;
  }

  return (
    <>
      <ExpiryReminderWatcher subscription={subscription} />
      <Stack.Navigator
        initialRouteName={initialRoute}
        screenOptions={{ headerShown: false }}
      >
        <Stack.Screen name="DeviceDiscovery" component={DeviceDiscoveryScreen} />
        <Stack.Screen name="QRScanner" component={QRScannerScreen} />
        <Stack.Screen name="CodeVerify" component={CodeVerifyScreen} />
        <Stack.Screen name="SyncActivity" component={SyncActivityScreen} />
        <Stack.Screen name="AlbumWorkbench" component={AlbumWorkbenchScreen} />
        <Stack.Screen name="SharedFiles" component={SharedFilesScreen} />
        <Stack.Screen name="History" component={HistoryScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="Help" component={HelpScreen} />
        <Stack.Screen name="Subscription" component={SubscriptionScreen} />
      </Stack.Navigator>
    </>
  );
}

// ---------------------------------------------------------------------------
// Shared loading screen
// ---------------------------------------------------------------------------

function LoadingScreen() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" color="#3b9fd8" />
    </View>
  );
}

function SignedOutTransitionScreen({
  onComplete,
}: {
  onComplete: () => void;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    const timer = setTimeout(onComplete, 720);
    return () => {
      clearTimeout(timer);
    };
  }, [onComplete]);

  return (
    <AuthScreenShell subtitle={t('auth.accountDeleted.subtitle')}>
      <View style={styles.transitionCard}>
        <View style={styles.transitionIcon}>
          <Text style={styles.transitionIconGlyph}>✓</Text>
        </View>
        <Text style={styles.transitionTitle}>{t('auth.accountDeleted.title')}</Text>
        <Text style={styles.transitionMessage}>{t('auth.accountDeleted.subtitle')}</Text>
        <ActivityIndicator
          size="small"
          color={AUTH_COLORS.primary}
          style={styles.transitionSpinner}
        />
      </View>
    </AuthScreenShell>
  );
}

// Rendered when the post-login profile load fails (transient network /
// server error). Without this screen the user would be stranded on the
// LoadingScreen forever because the auto-load effect won't re-fire on its
// own — the user must tap Retry or Log out.
function ProfileErrorScreen({
  message,
  retrying,
  onRetry,
  onLogout,
}: {
  message: string;
  retrying: boolean;
  onRetry: () => void;
  onLogout: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.errorRoot}>
      <Text style={styles.errorTitle}>{t('errors.profileLoadTitle')}</Text>
      <Text style={styles.errorMessage}>{message || t('errors.authTryLater')}</Text>
      <TouchableOpacity
        style={[styles.errorButton, retrying && styles.errorButtonDisabled]}
        onPress={onRetry}
        disabled={retrying}
        activeOpacity={0.8}
      >
        {retrying ? (
          <ActivityIndicator size="small" color="#ffffff" />
        ) : (
          <Text style={styles.errorButtonText}>{t('common.retry')}</Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.errorSecondary}
        onPress={onLogout}
        activeOpacity={0.6}
      >
        <Text style={styles.errorSecondaryText}>{t('settings.actions.logout')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#daeef8',
  },
  errorRoot: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#daeef8',
    paddingHorizontal: 32,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1a3a5c',
    marginBottom: 12,
  },
  errorMessage: {
    fontSize: 14,
    color: '#7893ab',
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 20,
  },
  errorButton: {
    backgroundColor: '#3b9fd8',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 64,
    minWidth: 200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorButtonDisabled: {
    backgroundColor: '#a8cfe4',
  },
  errorButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
    letterSpacing: 0.5,
  },
  errorSecondary: {
    marginTop: 16,
    paddingVertical: 8,
  },
  errorSecondaryText: {
    fontSize: 14,
    color: '#7893ab',
  },
  transitionCard: {
    marginTop: 56,
    marginHorizontal: 4,
    borderRadius: 28,
    paddingHorizontal: 28,
    paddingVertical: 32,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderWidth: 1,
    borderColor: 'rgba(194, 220, 245, 0.72)',
    alignItems: 'center',
    shadowColor: '#4f90ff',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.12,
    shadowRadius: 26,
    elevation: 8,
  },
  transitionIcon: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: 'rgba(94, 177, 115, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  transitionIconGlyph: {
    fontSize: 28,
    lineHeight: 30,
    fontWeight: '700',
    color: '#32a852',
  },
  transitionTitle: {
    marginTop: 18,
    fontSize: 24,
    fontWeight: '800',
    color: '#1d334d',
    textAlign: 'center',
  },
  transitionMessage: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 22,
    color: '#6687a6',
    textAlign: 'center',
  },
  transitionSpinner: {
    marginTop: 22,
  },
});
