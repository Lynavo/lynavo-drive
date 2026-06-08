import { useEffect } from 'react';
import {
  AppState,
  StatusBar,
  StyleSheet,
  useColorScheme,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as RNLocalize from 'react-native-localize';

import { AuthProvider } from './stores/auth-store';
import { RootNavigator } from './navigation/RootNavigator';
import { loadDebugBaseUrlOverride } from './services/config';
import { refreshNativeAppFeatureSettings } from './services/app-config-service';
import i18n from './i18n';
import {
  loadStoredLanguagePreference,
  resolveLanguagePreference,
} from './i18n/language-preference';

export function App() {
  const isDarkMode = useColorScheme() === 'dark';

  // Load any persisted dev-only API base URL override BEFORE the AuthProvider
  // mounts and triggers its first request — see services/config.ts for the
  // real-device debug instructions.
  useEffect(() => {
    let isDisposed = false;
    let refreshInFlight = false;
    const refreshFeatureSettings = async () => {
      if (refreshInFlight) return;
      refreshInFlight = true;
      try {
        await refreshNativeAppFeatureSettings();
      } catch (error) {
        console.warn('[App] failed to refresh native feature settings:', error);
      } finally {
        refreshInFlight = false;
      }
    };

    void (async () => {
      await loadDebugBaseUrlOverride();
      if (!isDisposed) {
        await refreshFeatureSettings();
      }
    })();
    const appStateSubscription = AppState.addEventListener(
      'change',
      nextState => {
        if (nextState === 'active') {
          void refreshFeatureSettings();
        }
      },
    );
    void loadStoredLanguagePreference().then(preference => {
      const language = resolveLanguagePreference(
        preference,
        RNLocalize.getLocales(),
      );
      if (i18n.language !== language) {
        void i18n.changeLanguage(language);
      }
    });
    return () => {
      isDisposed = true;
      appStateSubscription.remove();
    };
  }, []);

  return (
    <AuthProvider>
      <GestureHandlerRootView style={styles.root}>
        <SafeAreaProvider>
          <NavigationContainer>
            <StatusBar
              barStyle={isDarkMode ? 'light-content' : 'dark-content'}
            />
            <RootNavigator />
          </NavigationContainer>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
