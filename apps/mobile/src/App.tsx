import { useEffect } from 'react';
import { AppState, StatusBar, StyleSheet, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as RNLocalize from 'react-native-localize';

import { AuthProvider } from './stores/auth-store';
import { RecentDesktopsProvider } from './stores/recent-desktops-store';
import { RootNavigator } from './navigation/RootNavigator';
import { refreshNativeAppFeatureSettings } from './services/app-config-service';
import i18n from './i18n';
import {
  loadStoredLanguagePreference,
  resolveLanguagePreference,
} from './i18n/language-preference';

export function App() {
  const isDarkMode = useColorScheme() === 'dark';

  useEffect(() => {
    let isDisposed = false;
    let refreshInFlight = false;
    const refreshAppStartupSettings = async () => {
      if (refreshInFlight) return;
      refreshInFlight = true;
      try {
        try {
          await refreshNativeAppFeatureSettings();
        } catch (error) {
          console.warn(
            '[App] failed to refresh native feature settings:',
            error,
          );
        }
      } finally {
        refreshInFlight = false;
      }
    };

    void (async () => {
      if (!isDisposed) {
        await refreshAppStartupSettings();
      }
    })();
    const appStateSubscription = AppState.addEventListener(
      'change',
      nextState => {
        if (nextState === 'active') {
          void refreshAppStartupSettings();
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
      <RecentDesktopsProvider>
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
      </RecentDesktopsProvider>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
