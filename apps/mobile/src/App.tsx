import { useEffect } from 'react';
import {
  AppState,
  NativeEventEmitter,
  NativeModules,
  StatusBar,
  StyleSheet,
  useColorScheme,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as RNLocalize from 'react-native-localize';

import { AuthProvider } from './stores/auth-store';
import { RecentDesktopsProvider } from './stores/recent-desktops-store';
import { RootNavigator } from './navigation/RootNavigator';
import { loadDebugBaseUrlOverride } from './services/config';
import { refreshNativeAppFeatureSettings } from './services/app-config-service';
import {
  autoConfigurePublicWakeTargetFromBinding,
  autoConfigurePublicWakeTargetFromNativeBinding,
} from './services/public-wake-auto-config-service';
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
    let bindingAutoConfigInFlight = false;
    const refreshAppStartupSettings = async () => {
      if (refreshInFlight) return;
      refreshInFlight = true;
      try {
        try {
          await refreshNativeAppFeatureSettings();
        } catch (error) {
          console.warn('[App] failed to refresh native feature settings:', error);
        }
        try {
          await autoConfigurePublicWakeTargetFromNativeBinding();
        } catch (error) {
          console.warn(
            '[App] failed to auto-configure public wake target:',
            error,
          );
        }
      } finally {
        refreshInFlight = false;
      }
    };
    const autoConfigurePublicWakeFromBindingEvent = async (binding: unknown) => {
      if (bindingAutoConfigInFlight) return;
      bindingAutoConfigInFlight = true;
      try {
        await autoConfigurePublicWakeTargetFromBinding(binding);
      } catch (error) {
        console.warn(
          '[App] failed to auto-configure public wake target from binding event:',
          error,
        );
      } finally {
        bindingAutoConfigInFlight = false;
      }
    };

    void (async () => {
      await loadDebugBaseUrlOverride();
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
    let bindingStateSubscription: { remove: () => void } | undefined;
    const { NativeSyncEngine } = NativeModules;
    if (NativeSyncEngine) {
      const nativeEmitter = new NativeEventEmitter(NativeSyncEngine);
      bindingStateSubscription = nativeEmitter.addListener(
        'onBindingStateChanged',
        binding => {
          void autoConfigurePublicWakeFromBindingEvent(binding);
        },
      );
    }
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
      bindingStateSubscription?.remove();
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
