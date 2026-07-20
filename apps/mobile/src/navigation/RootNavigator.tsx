import React, { useState, useEffect, useRef } from 'react';
import {
  NativeModules,
  NativeEventEmitter,
  ActivityIndicator,
  Animated,
  Easing,
  View,
  StyleSheet,
} from 'react-native';
import { createStackNavigator } from '@react-navigation/stack';
import { CommonActions, useNavigation } from '@react-navigation/native';
import {
  createBottomTabNavigator,
  type BottomTabBarProps,
} from '@react-navigation/bottom-tabs';

import { useAuth } from '../stores/auth-store';
import { DeviceDiscoveryScreen } from '../screens/DeviceDiscoveryScreen';
import { CodeVerifyScreen } from '../screens/CodeVerifyScreen';
import { ConnectionTutorialScreen } from '../screens/ConnectionTutorialScreen';
import { SyncActivityScreen } from '../screens/SyncActivityScreen';
import { AlbumWorkbenchScreen } from '../screens/AlbumWorkbenchScreen';
import { SharedFilesScreen } from '../screens/SharedFilesScreen';
import { PhoneSyncSpaceScreen } from '../screens/PhoneSyncSpaceScreen';
import { LocalComputerScreen } from '../screens/LocalComputerScreen';
import { DownloadRecordsScreen } from '../screens/DownloadRecordsScreen';
import { HistoryScreen } from '../screens/HistoryScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { HelpScreen } from '../screens/HelpScreen';
import { QRScannerScreen } from '../screens/QRScannerScreen';
import { AutoUploadSettingsScreen } from '../screens/AutoUploadSettingsScreen';
import { BottomTabBar } from '../components/BottomTabBar';
import {
  PAIRING_INVALIDATED_EVENT,
  PAIRING_INVALIDATED_ROUTE_REASON,
  type PairingInvalidatedRouteReason,
  isPairingInvalidatedEvent,
} from '../services/SyncEngineModule';
import { resolveVisualQaInitialRoute } from '../dev/visualQa';

// ---------------------------------------------------------------------------
// Param lists
// ---------------------------------------------------------------------------

type MainTabKey = 'home' | 'files' | 'settings';

type MainTabParamList = {
  HomeTab: undefined;
  FilesTab: undefined;
  SettingsTab: undefined;
};

const MainTab = createBottomTabNavigator<MainTabParamList>();

export type RootStackParamList = {
  DeviceDiscovery:
    { mode?: 'switch'; reason?: PairingInvalidatedRouteReason } | undefined;
  CodeVerify: {
    deviceId?: string;
    host: string;
    port: number;
    deviceName?: string;
    prefilledCode?: string;
  };
  QRScanner: undefined;
  ConnectionTutorial: undefined;
  SyncActivity: undefined;
  AlbumWorkbench: undefined;
  SharedFiles: undefined;
  PhoneSyncSpace: undefined;
  LocalComputer: { path?: string } | undefined;
  DownloadRecords: undefined;
  History: undefined;
  Settings: undefined;
  Help: undefined;
  AutoUploadSettings: undefined;
};

// ---------------------------------------------------------------------------
// Root Navigator
// ---------------------------------------------------------------------------
//
// OSS runtime enters the same LAN sync stack for guests and stale persisted
// official-token sessions. Local pairing identity and pending upload state stay
// intact; no official profile bootstrap is required for foreground LAN sync.

const Stack = createStackNavigator<RootStackParamList>();
const LOGOUT_FADE_DURATION_MS = 220;

export function RootNavigator() {
  const auth = useAuth();

  // Cold-start hydration in flight.
  if (auth.isLoading) {
    return <LoadingScreen />;
  }

  if (!auth.isLoggedIn) {
    return (
      <AuthRouteTransition
        animateIn={auth.signedOutTransition === 'session_replaced'}
        onComplete={() => {
          auth.setSignedOutTransition(null);
        }}
      >
        <LanSyncStack />
      </AuthRouteTransition>
    );
  }

  return <LanSyncStack />;
}

function AuthRouteTransition({
  animateIn,
  onComplete,
  children,
}: {
  animateIn: boolean;
  onComplete?: () => void;
  children: React.ReactNode;
}) {
  const opacity = useRef(new Animated.Value(animateIn ? 0 : 1)).current;
  const translateY = useRef(new Animated.Value(animateIn ? 8 : 0)).current;
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    if (!animateIn) {
      opacity.setValue(1);
      translateY.setValue(0);
      return;
    }

    opacity.setValue(0);
    translateY.setValue(8);

    const animation = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: LOGOUT_FADE_DURATION_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: LOGOUT_FADE_DURATION_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);

    animation.start(({ finished }) => {
      if (finished) {
        onCompleteRef.current?.();
      }
    });

    return () => {
      animation.stop();
    };
  }, [animateIn, opacity, translateY]);

  return (
    <View style={styles.authRouteStage}>
      <Animated.View
        style={[
          styles.authRouteContent,
          {
            opacity,
            transform: [{ translateY }],
          },
        ]}
      >
        {children}
      </Animated.View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// LAN sync stack
// ---------------------------------------------------------------------------

function LanSyncStack() {
  const [initialRoute, setInitialRoute] = useState<
    keyof RootStackParamList | null
  >(null);
  const [initialDeviceDiscoveryReason, setInitialDeviceDiscoveryReason] =
    useState<PairingInvalidatedRouteReason | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const decide = async () => {
      const visualQaRoute = resolveVisualQaInitialRoute();
      if (visualQaRoute) {
        if (!cancelled) {
          setInitialDeviceDiscoveryReason(undefined);
          setInitialRoute(visualQaRoute);
        }
        return;
      }
      const invalidation =
        await NativeModules.NativeSyncEngine?.getBindingInvalidationState?.().catch(
          () => null,
        );
      if (
        invalidation !== null &&
        invalidation !== undefined &&
        isPairingInvalidatedEvent(invalidation)
      ) {
        if (!cancelled) {
          setInitialDeviceDiscoveryReason(PAIRING_INVALIDATED_ROUTE_REASON);
          setInitialRoute('DeviceDiscovery');
        }
        return;
      }
      const route = await resolveDefaultLanRoute();
      if (!cancelled) {
        setInitialDeviceDiscoveryReason(undefined);
        setInitialRoute(route);
      }
    };
    decide();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!initialRoute) {
    return <LoadingScreen />;
  }

  return (
    <>
      <PairingInvalidationWatcher enabled />
      <Stack.Navigator
        initialRouteName={initialRoute}
        screenOptions={{ headerShown: false }}
      >
        <Stack.Screen
          name="DeviceDiscovery"
          component={DeviceDiscoveryScreen}
          initialParams={
            initialDeviceDiscoveryReason
              ? { reason: initialDeviceDiscoveryReason }
              : undefined
          }
        />
        <Stack.Screen name="QRScanner" component={QRScannerScreen} />
        <Stack.Screen
          name="ConnectionTutorial"
          component={ConnectionTutorialScreen}
        />
        <Stack.Screen name="CodeVerify" component={CodeVerifyScreen} />
        <Stack.Screen name="SyncActivity" component={MainTabsScreen} />
        <Stack.Screen name="AlbumWorkbench" component={AlbumWorkbenchScreen} />
        <Stack.Screen name="SharedFiles" component={MainTabsScreen} />
        <Stack.Screen name="PhoneSyncSpace" component={PhoneSyncSpaceScreen} />
        <Stack.Screen name="LocalComputer" component={LocalComputerScreen} />
        <Stack.Screen
          name="DownloadRecords"
          component={DownloadRecordsScreen}
        />
        <Stack.Screen name="History" component={HistoryScreen} />
        <Stack.Screen name="Settings" component={MainTabsScreen} />
        <Stack.Screen name="Help" component={HelpScreen} />
        <Stack.Screen
          name="AutoUploadSettings"
          component={AutoUploadSettingsScreen}
        />
      </Stack.Navigator>
    </>
  );
}

function PairingInvalidationWatcher({ enabled }: { enabled: boolean }) {
  const navigation = useNavigation();
  const resetInFlightRef = useRef(false);
  const resetInFlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    if (!enabled) return;
    const nativeModule = NativeModules.NativeSyncEngine;
    if (!nativeModule) return;

    const emitter = new NativeEventEmitter(nativeModule);
    const subscription = emitter.addListener(
      PAIRING_INVALIDATED_EVENT,
      payload => {
        if (!isPairingInvalidatedEvent(payload) || resetInFlightRef.current) {
          return;
        }
        resetInFlightRef.current = true;
        if (resetInFlightTimerRef.current) {
          clearTimeout(resetInFlightTimerRef.current);
        }
        resetInFlightTimerRef.current = setTimeout(() => {
          resetInFlightRef.current = false;
          resetInFlightTimerRef.current = null;
        }, 500);
        navigation.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [
              {
                name: 'DeviceDiscovery',
                params: { reason: PAIRING_INVALIDATED_ROUTE_REASON },
              },
            ],
          }),
        );
      },
    );

    return () => {
      if (resetInFlightTimerRef.current) {
        clearTimeout(resetInFlightTimerRef.current);
        resetInFlightTimerRef.current = null;
      }
      resetInFlightRef.current = false;
      subscription.remove();
    };
  }, [enabled, navigation]);

  return null;
}

function getMainTabInitialRouteName(
  routeName: keyof RootStackParamList | undefined,
): keyof MainTabParamList {
  if (routeName === 'SharedFiles') return 'FilesTab';
  if (routeName === 'Settings') return 'SettingsTab';
  return 'HomeTab';
}

function getMainTabForTabRouteName(routeName: string | undefined): MainTabKey {
  if (routeName === 'FilesTab') return 'files';
  if (routeName === 'SettingsTab') return 'settings';
  return 'home';
}

function getMainTabRouteName(tab: MainTabKey): keyof MainTabParamList {
  if (tab === 'files') return 'FilesTab';
  if (tab === 'settings') return 'SettingsTab';
  return 'HomeTab';
}

function HomeTabScreen() {
  return <SyncActivityScreen showBottomTabBar={false} />;
}

function FilesTabScreen() {
  return <SharedFilesScreen showBottomTabBar={false} />;
}

function SettingsTabScreen() {
  return <SettingsScreen showBottomTabBar={false} />;
}

function MainTabsTabBar({ state, navigation }: BottomTabBarProps) {
  const activeTab = getMainTabForTabRouteName(state.routes[state.index]?.name);

  return (
    <BottomTabBar
      activeTab={activeTab}
      onTabPress={tab => {
        navigation.navigate(getMainTabRouteName(tab));
      }}
    />
  );
}

function MainTabsScreen({
  route,
}: {
  route: { name: keyof RootStackParamList };
}) {
  return (
    <View testID="main-tabs-root" style={styles.mainTabsRoot}>
      <MainTab.Navigator
        initialRouteName={getMainTabInitialRouteName(route.name)}
        backBehavior="history"
        detachInactiveScreens={false}
        screenOptions={{
          headerShown: false,
          lazy: false,
          freezeOnBlur: false,
          animation: 'none',
          sceneStyle: styles.mainTabsScene,
        }}
        tabBar={MainTabsTabBar}
      >
        <MainTab.Screen name="HomeTab" component={HomeTabScreen} />
        <MainTab.Screen name="FilesTab" component={FilesTabScreen} />
        <MainTab.Screen name="SettingsTab" component={SettingsTabScreen} />
      </MainTab.Navigator>
    </View>
  );
}

async function resolveDefaultLanRoute(): Promise<
  Extract<keyof RootStackParamList, 'DeviceDiscovery' | 'SyncActivity'>
> {
  try {
    const { NativeSyncEngine } = NativeModules;
    if (NativeSyncEngine) {
      const binding = await NativeSyncEngine.getBindingState();
      if (binding && binding.deviceId) {
        return 'SyncActivity';
      }
    }
  } catch {
    /* fall through to DeviceDiscovery */
  }
  return 'DeviceDiscovery';
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

const styles = StyleSheet.create({
  authRouteStage: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  authRouteContent: {
    flex: 1,
  },
  mainTabsRoot: {
    flex: 1,
    backgroundColor: '#F7FBFF',
  },
  mainTabsScene: {
    backgroundColor: '#F7FBFF',
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#daeef8',
  },
});
