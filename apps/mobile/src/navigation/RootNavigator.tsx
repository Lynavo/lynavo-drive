import { createStackNavigator } from '@react-navigation/stack';

import { DeviceDiscoveryScreen } from '../screens/DeviceDiscoveryScreen';
import { CodeVerifyScreen } from '../screens/CodeVerifyScreen';
import { SyncStatusScreen } from '../screens/SyncStatusScreen';
import { HistoryScreen } from '../screens/HistoryScreen';
import { SettingsScreen } from '../screens/SettingsScreen';

export type RootStackParamList = {
  DeviceDiscovery: undefined;
  CodeVerify: { deviceId: string; host: string; port: number; deviceName: string };
  SyncStatus: undefined;
  History: undefined;
  Settings: undefined;
};

const Stack = createStackNavigator<RootStackParamList>();

export function RootNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="DeviceDiscovery"
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="DeviceDiscovery" component={DeviceDiscoveryScreen} />
      <Stack.Screen name="CodeVerify" component={CodeVerifyScreen} />
      <Stack.Screen name="SyncStatus" component={SyncStatusScreen} />
      <Stack.Screen name="History" component={HistoryScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
    </Stack.Navigator>
  );
}
