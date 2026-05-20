import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { AUTH_COLORS, AuthScreenShell } from '../components/auth/AuthScreenShell';

type Provider = 'apple' | 'google';

export function LoginGlobalScreen() {
  const [pendingProvider, setPendingProvider] = useState<Provider | null>(null);

  const handleProviderPress = async (provider: Provider) => {
    if (pendingProvider) return;
    setPendingProvider(provider);
    Alert.alert(
      'Sign in unavailable',
      'Apple and Google sign-in native SDK wiring will be added in feature/global-auth.',
    );
    setPendingProvider(null);
  };

  return (
    <AuthScreenShell subtitle="Connect your desktop and keep media in sync.">
      <View style={styles.card}>
        <Text style={styles.title}>Sign in to Vivi Drop</Text>
        <Pressable
          accessibilityRole="button"
          disabled={pendingProvider !== null}
          onPress={() => void handleProviderPress('apple')}
          style={styles.providerButton}
        >
          <Text style={styles.providerText}>Continue with Apple</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={pendingProvider !== null}
          onPress={() => void handleProviderPress('google')}
          style={styles.providerButton}
        >
          <Text style={styles.providerText}>Continue with Google</Text>
        </Pressable>
      </View>
    </AuthScreenShell>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 20,
    marginTop: 32,
    borderRadius: 24,
    backgroundColor: '#ffffff',
    padding: 20,
    gap: 14,
  },
  title: {
    color: AUTH_COLORS.text,
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 6,
  },
  providerButton: {
    height: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.12)', // equivalent to AUTH_COLORS.inputBorder if strong not exposed or custom
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  providerText: {
    color: AUTH_COLORS.text,
    fontSize: 16,
    fontWeight: '700',
  },
});
