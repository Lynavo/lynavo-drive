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
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { colors } from '../theme/colors';
import { Icon } from '../components/Icon';
import { isDiagnosticsExportUnavailable, shareDiagnosticsArchive } from '../utils/shareDiagnosticsArchive';

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
        <Icon name="radio-outline" size={22} color="#3b9fd8" />
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
  const [isExportingDiagnostics, setIsExportingDiagnostics] = useState(false);

  // ---------------------------------------------------------------------------
  // Native module discovery
  // ---------------------------------------------------------------------------

  useEffect(() => {
    let subscription: { remove: () => void } | undefined;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

    try {
      const { NativeSyncEngine } = NativeModules;
      if (NativeSyncEngine) {
        const emitter = new NativeEventEmitter(NativeSyncEngine);
        subscription = emitter.addListener('onDiscoveredDevicesChanged', (discoveredDevices: DiscoveredDevice[]) => {
          setDevices(discoveredDevices);
          if (discoveredDevices.length > 0) {
            setScanning(false);
            if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = undefined; }
          }
        });
        NativeSyncEngine.startDiscovery()
          .catch((e: Error) => console.warn('[Discovery] startDiscovery failed:', e));
        // Timeout fallback: if no devices found after 8s, stop scanning animation
        timeoutTimer = setTimeout(() => {
          setScanning(false);
        }, 8000);
      } else {
        setScanning(false);
      }
    } catch (e) {
      console.warn('[Discovery] error:', e);
      setScanning(false);
    }

    return () => {
      subscription?.remove();
      if (timeoutTimer) clearTimeout(timeoutTimer);
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
    setScanning(false);
  }, []);

  const handleExportDiagnostics = useCallback(async () => {
    try {
      setIsExportingDiagnostics(true);
      await shareDiagnosticsArchive();
    } catch (error) {
      if (isDiagnosticsExportUnavailable(error)) {
        Alert.alert('无法导出', '当前版本暂不支持导出诊断包');
      } else {
        Alert.alert('导出失败', '诊断包导出失败，请稍后重试');
      }
    } finally {
      setIsExportingDiagnostics(false);
    }
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
          <Icon name="desktop-outline" size={20} color="#fff" />
        </View>

        {/* Device info */}
        <View style={styles.deviceInfo}>
          <Text style={styles.deviceName}>{item.name}</Text>
          <Text style={styles.deviceMeta}>macOS {'·'} {item.ip}</Text>
        </View>

        {/* Chevron */}
        <Icon name="chevron-forward" size={20} color="#b0c8da" />
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
          <View style={styles.headerTopRow}>
            <View style={styles.wifiIconBox}>
              <Icon name="wifi" size={24} color="#3b9fd8" />
            </View>
            <TouchableOpacity
              style={[
                styles.diagnosticsButton,
                isExportingDiagnostics && styles.diagnosticsButtonDisabled,
              ]}
              activeOpacity={0.8}
              disabled={isExportingDiagnostics}
              onPress={() => {
                void handleExportDiagnostics();
              }}
            >
              <Icon name="download-outline" size={16} color="#3b9fd8" />
              <Text style={styles.diagnosticsButtonText}>
                {isExportingDiagnostics ? '导出中…' : '导出诊断包'}
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.title}>{'搜索设备'}</Text>
          <Text style={styles.subtitle}>{'正在扫描局域网中的电脑端应用...'}</Text>
        </View>

        {/* Scanning animation */}
        {scanning && devices.length === 0 && (
          <View style={styles.scanningSection}>
            <PulseRings />
            <Text style={styles.scanningText}>{'扫描中，请稍候...'}</Text>
          </View>
        )}

        {/* Device list */}
        {!scanning && (
          <View style={styles.listSection}>
            {devices.length > 0 && (
              <Text style={styles.deviceCount}>{'发现'} {devices.length} {'台设备'}</Text>
            )}
            {devices.length === 0 ? (
              <View style={styles.emptySection}>
                <Text style={styles.emptyText}>{'未发现设备'}</Text>
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
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Icon name="refresh" size={16} color="#5a9abf" />
                <Text style={styles.rescanText}>{'重新扫描'}</Text>
              </View>
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
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
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
  diagnosticsButton: {
    minHeight: 40,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.62)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.82)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    shadowColor: 'rgba(80,160,210,0.25)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 2,
  },
  diagnosticsButtonDisabled: {
    opacity: 0.6,
  },
  diagnosticsButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#3b9fd8',
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
