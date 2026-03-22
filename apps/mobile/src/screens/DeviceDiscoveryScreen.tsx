import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Animated,
  Easing,
  NativeModules,
  NativeEventEmitter,
  ListRenderItemInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { colors } from '../theme/colors';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DiscoveredDevice {
  deviceId: string;
  name: string;
  ip: string;
  type: 'mac';
  port: number;
}

// ---------------------------------------------------------------------------
// Static mock data (fallback when native module not available)
// ---------------------------------------------------------------------------

const mockDevices: DiscoveredDevice[] = [
  { deviceId: 'mac-1', name: '\u526A\u8F91\u5DE5\u4F5C\u7AD9-A', ip: '192.168.1.101', type: 'mac' as const, port: 39393 },
  { deviceId: 'mac-2', name: 'MacBook Pro', ip: '192.168.1.108', type: 'mac' as const, port: 39393 },
  { deviceId: 'mac-3', name: '\u5907\u7528\u673A-B', ip: '192.168.1.115', type: 'mac' as const, port: 39393 },
];

// ---------------------------------------------------------------------------
// Pulse ring animation component
// ---------------------------------------------------------------------------

function PulseRings() {
  const rings = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];

  useEffect(() => {
    const animations = rings.map((anim, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 400),
          Animated.timing(anim, {
            toValue: 1,
            duration: 1800,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ),
    );
    animations.forEach((a) => a.start());
    return () => animations.forEach((a) => a.stop());
  }, []);

  return (
    <View style={styles.pulseContainer}>
      {rings.map((anim, i) => {
        const size = 60 + i * 36;
        return (
          <Animated.View
            key={i}
            style={[
              styles.pulseRing,
              {
                width: size,
                height: size,
                borderRadius: size / 2,
                borderColor: `rgba(59,159,216,${0.35 - i * 0.1})`,
                opacity: anim.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0.8, 0, 0] }),
                transform: [
                  {
                    scale: anim.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0.85, 1.2, 1.2] }),
                  },
                ],
              },
            ]}
          />
        );
      })}
      {/* Center circle */}
      <View style={styles.pulseCenter}>
        <Text style={styles.wifiIconSmall}>{'\uD83D\uDCE1'}</Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// DeviceDiscoveryScreen
// ---------------------------------------------------------------------------

type NavigationProp = StackNavigationProp<RootStackParamList, 'DeviceDiscovery'>;

export function DeviceDiscoveryScreen() {
  const navigation = useNavigation<NavigationProp>();
  const [scanning, setScanning] = useState(true);
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);

  // ---------------------------------------------------------------------------
  // Native module discovery with mock fallback
  // ---------------------------------------------------------------------------

  useEffect(() => {
    let subscription: { remove: () => void } | undefined;
    let mockTimer: ReturnType<typeof setTimeout> | undefined;

    try {
      const { NativeSyncEngine } = NativeModules;
      if (NativeSyncEngine) {
        
        
        
        
        NativeSyncEngine.startDiscovery()
          .catch((e: Error) => console.warn('[Discovery] startDiscovery failed:', e));
        const emitter = new NativeEventEmitter(NativeSyncEngine);
        subscription = emitter.addListener('onDiscoveredDevicesChanged', (discoveredDevices: DiscoveredDevice[]) => {
          setDevices(discoveredDevices);
          if (discoveredDevices.length > 0) {
            setScanning(false);
            if (mockTimer) { clearTimeout(mockTimer); mockTimer = undefined; }
          }
        });
        // Timeout fallback: if no devices found after 8s, stop scanning animation
        mockTimer = setTimeout(() => {
          setScanning(false);
        }, 8000);
      } else {
        console.log('[Discovery] native module not found, using mock data');
        mockTimer = setTimeout(() => {
          setDevices(mockDevices);
          setScanning(false);
        }, 1800);
      }
    } catch (e) {
      console.warn('[Discovery] error:', e);
      mockTimer = setTimeout(() => {
        setDevices(mockDevices);
        setScanning(false);
      }, 1800);
    }

    return () => {
      subscription?.remove();
      if (mockTimer) clearTimeout(mockTimer);
      try {
        NativeModules.NativeSyncEngine?.stopDiscovery();
      } catch {
        // ignore cleanup errors
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Rescan
  // ---------------------------------------------------------------------------

  const handleRescan = useCallback(() => {
    setScanning(true);
    setDevices([]);

    try {
      const { NativeSyncEngine } = NativeModules;
      if (NativeSyncEngine) {
        NativeSyncEngine.stopDiscovery();
        NativeSyncEngine.startDiscovery();
        return;
      }
    } catch {
      // fallback
    }
    // Mock fallback
    setTimeout(() => {
      setDevices(mockDevices);
      setScanning(false);
    }, 1800);
  }, []);

  const handleDevicePress = useCallback(
    (device: DiscoveredDevice) => {
      navigation.navigate('CodeVerify', {
        deviceId: device.deviceId,
        host: device.ip,
        port: device.port,
        deviceName: device.name,
      });
    },
    [navigation],
  );

  const renderDevice = useCallback(
    ({ item }: ListRenderItemInfo<DiscoveredDevice>) => (
      <TouchableOpacity
        style={styles.deviceCard}
        activeOpacity={0.7}
        onPress={() => handleDevicePress(item)}
      >
        {/* Monitor icon with gradient bg */}
        <View style={styles.deviceIconWrapper}>
          <Text style={styles.monitorIcon}>{'\uD83D\uDDA5'}</Text>
        </View>

        {/* Device info */}
        <View style={styles.deviceInfo}>
          <Text style={styles.deviceName}>{item.name}</Text>
          <Text style={styles.deviceMeta}>macOS {'\u00B7'} {item.ip}</Text>
        </View>

        {/* Chevron */}
        <Text style={styles.chevron}>{'\u203A'}</Text>
      </TouchableOpacity>
    ),
    [handleDevicePress],
  );

  const keyExtractor = useCallback((item: DiscoveredDevice) => item.deviceId, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.wifiIconBox}>
            <Text style={styles.wifiIcon}>{'\uD83D\uDCF6'}</Text>
          </View>
          <Text style={styles.title}>{'\u641C\u7D22\u8BBE\u5907'}</Text>
          <Text style={styles.subtitle}>{'\u6B63\u5728\u626B\u63CF\u5C40\u57DF\u7F51\u4E2D\u7684\u7535\u8111\u7AEF\u5E94\u7528...'}</Text>
        </View>

        {/* Scanning animation */}
        {scanning && devices.length === 0 && (
          <View style={styles.scanningSection}>
            <PulseRings />
            <Text style={styles.scanningText}>{'\u626B\u63CF\u4E2D\uFF0C\u8BF7\u7A0D\u5019...'}</Text>
          </View>
        )}

        {/* Device list */}
        {!scanning && (
          <View style={styles.listSection}>
            {devices.length > 0 && (
              <Text style={styles.deviceCount}>{'\u53D1\u73B0'} {devices.length} {'\u53F0\u8BBE\u5907'}</Text>
            )}
            {devices.length === 0 ? (
              <View style={styles.emptySection}>
                <Text style={styles.emptyText}>{'\u672A\u53D1\u73B0\u8BBE\u5907'}</Text>
              </View>
            ) : (
              <FlatList
                data={devices}
                renderItem={renderDevice}
                keyExtractor={keyExtractor}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
              />
            )}

            {/* Rescan button */}
            <TouchableOpacity
              style={styles.rescanButton}
              activeOpacity={0.7}
              onPress={handleRescan}
            >
              <Text style={styles.rescanText}>{'\uD83D\uDD04'}  {'\u91CD\u65B0\u626B\u63CF'}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#c4e4f5',
  },
  container: {
    flex: 1,
    backgroundColor: undefined,
    // Approximate linear gradient with layered background:
    // top #c4e4f5 -> bottom #f2f8fd via the safeArea + container split
  },
  header: {
    paddingTop: 24,
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  wifiIconBox: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: 'rgba(59,159,216,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  wifiIcon: {
    fontSize: 28,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: colors.screenTitle,
  },
  subtitle: {
    fontSize: 14,
    color: '#6a96b8',
    marginTop: 4,
  },

  // Scanning
  scanningSection: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 20,
  },
  pulseContainer: {
    width: 140,
    height: 140,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pulseRing: {
    position: 'absolute',
    borderWidth: 2,
  },
  pulseCenter: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(59,159,216,0.15)',
    borderWidth: 2,
    borderColor: 'rgba(59,159,216,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  wifiIconSmall: {
    fontSize: 24,
  },
  scanningText: {
    fontSize: 14,
    color: '#6a96b8',
  },

  // Device list
  listSection: {
    flex: 1,
    paddingHorizontal: 20,
  },
  deviceCount: {
    fontSize: 12,
    fontWeight: '500',
    color: '#6a96b8',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  listContent: {
    gap: 8,
  },
  deviceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.75)',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
    // Shadow
    shadowColor: 'rgba(80,160,210,0.3)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 2,
    gap: 12,
  },
  deviceIconWrapper: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    // Approximate gradient: #4db8ea -> #2e8fcc
    backgroundColor: '#3ba4dc',
    shadowColor: 'rgba(59,159,216,0.5)',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 3,
  },
  monitorIcon: {
    fontSize: 20,
  },
  deviceInfo: {
    flex: 1,
    minWidth: 0,
  },
  deviceName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.screenTitle,
  },
  deviceMeta: {
    fontSize: 12,
    color: '#8aabbd',
    marginTop: 2,
  },
  chevron: {
    fontSize: 22,
    color: '#b0c8da',
    fontWeight: '300',
  },

  // Empty state
  emptySection: {
    alignItems: 'center',
    paddingVertical: 48,
  },
  emptyText: {
    fontSize: 14,
    color: '#8aabbd',
  },

  // Rescan
  rescanButton: {
    marginTop: 16,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
  },
  rescanText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#5a9abf',
  },
});
