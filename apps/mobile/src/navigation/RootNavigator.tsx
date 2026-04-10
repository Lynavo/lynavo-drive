import React, { useState, useEffect } from 'react';
import { NativeModules, ActivityIndicator, View, StyleSheet } from 'react-native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { DeviceDiscoveryScreen } from '../screens/DeviceDiscoveryScreen';
import { CodeVerifyScreen } from '../screens/CodeVerifyScreen';
import { SyncActivityScreen } from '../screens/SyncActivityScreen';
import { AlbumWorkbenchScreen } from '../screens/AlbumWorkbenchScreen';
import { SharedFilesScreen } from '../screens/SharedFilesScreen';
import { HistoryScreen } from '../screens/HistoryScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { QRScannerScreen } from '../screens/QRScannerScreen';
import { Icon } from '../components/Icon';

// ---------------------------------------------------------------------------
// Param lists
// ---------------------------------------------------------------------------

export type RootStackParamList = {
  DeviceDiscovery: undefined;
  CodeVerify: {
    deviceId?: string;
    host: string;
    port: number;
    deviceName?: string;
    prefilledCode?: string;
  };
  QRScanner: undefined;
  MainTabs: undefined;
  // Keep old routes for backward compat during transition
  SyncStatus: undefined;
  History: undefined;
  Settings: undefined;
};

export type MainTabParamList = {
  SyncActivity: undefined;
  AlbumWorkbench: undefined;
  SharedFiles: undefined;
  History: undefined;
  Settings: undefined;
};

// ---------------------------------------------------------------------------
// Bottom Tab Navigator
// ---------------------------------------------------------------------------

const Tab = createBottomTabNavigator<MainTabParamList>();

function MainTabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: 'rgba(255,255,255,0.92)',
          borderTopColor: 'rgba(0,0,0,0.06)',
          borderTopWidth: 1,
          paddingTop: 6,
          height: 88,
        },
        tabBarActiveTintColor: '#3b9fd8',
        tabBarInactiveTintColor: '#8aabbd',
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '500',
          marginTop: 2,
        },
      }}
    >
      <Tab.Screen
        name="SyncActivity"
        component={SyncActivityScreen}
        options={{
          tabBarLabel: '同步',
          tabBarIcon: ({ color, size }) => (
            <Icon name="sync-outline" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="AlbumWorkbench"
        component={AlbumWorkbenchScreen}
        options={{
          tabBarLabel: '相册',
          tabBarIcon: ({ color, size }) => (
            <Icon name="albums-outline" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="SharedFiles"
        component={SharedFilesScreen}
        options={{
          tabBarLabel: '共享',
          tabBarIcon: ({ color, size }) => (
            <Icon name="folder-outline" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="History"
        component={HistoryScreen}
        options={{
          tabBarLabel: '历史',
          tabBarIcon: ({ color, size }) => (
            <Icon name="time-outline" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          tabBarLabel: '设置',
          tabBarIcon: ({ color, size }) => (
            <Icon name="settings-outline" size={size} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

// ---------------------------------------------------------------------------
// Root Stack Navigator
// ---------------------------------------------------------------------------

const Stack = createStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const [initialRoute, setInitialRoute] = useState<keyof RootStackParamList | null>(null);

  useEffect(() => {
    const checkBinding = async () => {
      try {
        const { NativeSyncEngine } = NativeModules;
        if (NativeSyncEngine) {
          const binding = await NativeSyncEngine.getBindingState();
          if (binding && binding.deviceId) {
            // Already paired — go straight to main tabs
            setInitialRoute('MainTabs');
            return;
          }
        }
      } catch {
        // Ignore errors
      }
      // Not paired or no native module — show discovery
      setInitialRoute('DeviceDiscovery');
    };
    checkBinding();
  }, []);

  // Show loading while checking binding
  if (!initialRoute) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#3b9fd8" />
      </View>
    );
  }

  return (
    <Stack.Navigator
      initialRouteName={initialRoute}
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="DeviceDiscovery" component={DeviceDiscoveryScreen} />
      <Stack.Screen name="QRScanner" component={QRScannerScreen} />
      <Stack.Screen name="CodeVerify" component={CodeVerifyScreen} />
      <Stack.Screen name="MainTabs" component={MainTabNavigator} />
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#daeef8',
  },
});
