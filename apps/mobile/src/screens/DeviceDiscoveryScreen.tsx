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
  TextInput,
  Keyboard,
  LayoutChangeEvent,
  Platform,
  Modal,
  Pressable,
  KeyboardAvoidingView,
} from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { DiscoveredDeviceDTO } from '@syncflow/contracts';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { colors } from '../theme/colors';
import { Icon } from '../components/Icon';
import { buildManualPairDevice } from './deviceDiscoveryManualPairing';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DiscoveredDevice = Pick<
  DiscoveredDeviceDTO,
  'deviceId' | 'name' | 'ip' | 'type' | 'port'
>;

function deviceDiscoveryDebugSummary(devices: DiscoveredDevice[]): string {
  if (devices.length === 0) {
    return 'none';
  }

  return devices
    .map(
      device =>
        `${device.name}/${device.ip || 'no-ip'}/${device.deviceId}/${
          device.type
        }`,
    )
    .join(', ');
}

// ---------------------------------------------------------------------------
// Pulse ring animation component
// ---------------------------------------------------------------------------

function PulseRings() {
  const rings = [
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
  ];

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
    animations.forEach(a => a.start());
    return () => animations.forEach(a => a.stop());
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
                opacity: anim.interpolate({
                  inputRange: [0, 0.7, 1],
                  outputRange: [0.8, 0, 0],
                }),
                transform: [
                  {
                    scale: anim.interpolate({
                      inputRange: [0, 0.7, 1],
                      outputRange: [0.85, 1.2, 1.2],
                    }),
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

type NavigationProp = StackNavigationProp<
  RootStackParamList,
  'DeviceDiscovery'
>;

export function DeviceDiscoveryScreen() {
  const navigation = useNavigation<NavigationProp>();
  const insets = useSafeAreaInsets();
  const [scanning, setScanning] = useState(true);
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [manualHost, setManualHost] = useState('');
  const [manualHostError, setManualHostError] = useState<string | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [manualSectionHeight, setManualSectionHeight] = useState(0);

  // Popover & Modal state
  const [showPairingMenu, setShowPairingMenu] = useState(false);
  const [showManualModal, setShowManualModal] = useState(false);

  // ---------------------------------------------------------------------------
  // Native module discovery
  // ---------------------------------------------------------------------------

  useEffect(() => {
    console.log('[DiscoveryScreen] mounted');
    let subscription: { remove: () => void } | undefined;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

    try {
      const { NativeSyncEngine } = NativeModules;
      if (NativeSyncEngine) {
        console.log(
          '[DiscoveryScreen] NativeSyncEngine available, subscribing to discovery events',
        );
        const emitter = new NativeEventEmitter(NativeSyncEngine);
        subscription = emitter.addListener(
          'onDiscoveredDevicesChanged',
          (discoveredDevices: DiscoveredDevice[]) => {
            console.log(
              '[DiscoveryScreen] onDiscoveredDevicesChanged',
              discoveredDevices.length,
              deviceDiscoveryDebugSummary(discoveredDevices),
            );
            setDevices(discoveredDevices);
            if (discoveredDevices.length > 0) {
              setScanning(false);
              if (timeoutTimer) {
                clearTimeout(timeoutTimer);
                timeoutTimer = undefined;
              }
            }
          },
        );
        console.log('[DiscoveryScreen] calling startDiscovery');
        NativeSyncEngine.startDiscovery()
          .then(() => console.log('[DiscoveryScreen] startDiscovery resolved'))
          .catch((e: Error) =>
            console.warn('[DiscoveryScreen] startDiscovery failed:', e),
          );
        // Timeout fallback: if no devices found after 8s, stop scanning animation
        timeoutTimer = setTimeout(() => {
          console.log(
            '[DiscoveryScreen] discovery timeout reached with no devices',
          );
          setScanning(false);
        }, 8000);
      } else {
        console.log('[DiscoveryScreen] NativeSyncEngine unavailable');
        setScanning(false);
      }
    } catch (e) {
      console.warn('[DiscoveryScreen] setup error:', e);
      setScanning(false);
    }

    return () => {
      console.log(
        '[DiscoveryScreen] unmounting, cleaning up discovery listeners',
      );
      subscription?.remove();
      if (timeoutTimer) clearTimeout(timeoutTimer);
      try {
        console.log('[DiscoveryScreen] calling stopDiscovery during cleanup');
        NativeModules.NativeSyncEngine?.stopDiscovery();
      } catch {
        // ignore cleanup errors
      }
    };
  }, []);

  useEffect(() => {
    const showEvent =
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent =
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSubscription = Keyboard.addListener(showEvent, event => {
      setKeyboardHeight(event.endCoordinates.height);
    });
    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Rescan
  // ---------------------------------------------------------------------------

  const handleRescan = useCallback(() => {
    console.log('[DiscoveryScreen] handleRescan invoked');
    setScanning(true);
    setDevices([]);

    try {
      const { NativeSyncEngine } = NativeModules;
      if (NativeSyncEngine) {
        console.log('[DiscoveryScreen] handleRescan restarting discovery');
        NativeSyncEngine.stopDiscovery();
        NativeSyncEngine.startDiscovery();
        return;
      }
    } catch {
      // fallback
    }
    setScanning(false);
  }, []);


  const handleDevicePress = useCallback(
    (device: DiscoveredDevice) => {
      console.log(
        '[DiscoveryScreen] handleDevicePress',
        `${device.name}/${device.ip || 'no-ip'}/${device.deviceId}/${
          device.type
        }`,
      );
      try {
        NativeModules.NativeSyncEngine?.stopDiscovery();
      } catch {
        // ignore cleanup errors
      }
      navigation.navigate('CodeVerify', {
        deviceId: device.deviceId,
        host: device.ip,
        port: device.port,
        deviceName: device.name,
      });
    },
    [navigation],
  );

  const handleManualPair = useCallback(() => {
    console.log('[DiscoveryScreen] handleManualPair submitted', manualHost);
    const manualDevice = buildManualPairDevice(manualHost);

    if (!manualDevice) {
      console.log('[DiscoveryScreen] handleManualPair rejected invalid host');
      setManualHostError('请输入有效的 IPv4 地址，例如 192.168.0.1');
      return;
    }

    console.log(
      '[DiscoveryScreen] handleManualPair accepted',
      `${manualDevice.name}/${manualDevice.ip}/${manualDevice.deviceId}/${manualDevice.type}`,
    );
    setManualHostError(null);
    setShowManualModal(false);
    handleDevicePress(manualDevice);
  }, [handleDevicePress, manualHost]);

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
          <Text style={styles.deviceMeta}>
            {item.type === 'win' ? 'Windows' : 'macOS'} {'·'} {item.ip}
          </Text>
        </View>

        {/* Chevron */}
        <Icon name="chevron-forward" size={20} color="#b0c8da" />
      </TouchableOpacity>
    ),
    [handleDevicePress],
  );

  const keyExtractor = useCallback(
    (item: DiscoveredDevice) => item.deviceId,
    [],
  );

  const handleManualSectionLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = Math.ceil(event.nativeEvent.layout.height);
    setManualSectionHeight(currentHeight =>
      currentHeight === nextHeight ? currentHeight : nextHeight,
    );
  }, []);

  const manualDockBottom =
    keyboardHeight > 0 ? Math.max(12, keyboardHeight - insets.bottom) : 0;
  const listBottomInset =
    manualSectionHeight > 0 ? manualSectionHeight + 16 : 220;

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
              style={styles.scanButton}
              activeOpacity={0.8}
              onPress={() => setShowPairingMenu(true)}
            >
              <Icon name="settings-outline" size={16} color="#3b9fd8" />
              <Text style={styles.scanButtonText}>
                手动配对
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.title}>{'搜索设备'}</Text>
          <Text style={styles.subtitle}>
            {'正在扫描局域网中的电脑端应用...'}
          </Text>
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
          <View
            style={[styles.listSection, { paddingBottom: listBottomInset }]}
          >
            {devices.length > 0 && (
              <Text style={styles.deviceCount}>
                {'发现'} {devices.length} {'台设备'}
              </Text>
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
                keyboardShouldPersistTaps="handled"
              />
            )}
          </View>
        )}

        <View
          style={[
            styles.manualDock,
            {
              bottom: manualDockBottom,
              paddingBottom: Math.max(insets.bottom, 24),
            },
          ]}
          onLayout={handleManualSectionLayout}
        >
          {/* Fixed Rescan button */}
          {!scanning && (
            <View style={styles.manualSection}>
              <TouchableOpacity
                style={styles.rescanButton}
                activeOpacity={0.7}
                onPress={handleRescan}
              >
                <View
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
                >
                  <Icon name="refresh" size={16} color="#5a9abf" />
                  <Text style={styles.rescanText}>{'重新扫描'}</Text>
                </View>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Pairing Menu Popover */}
        <Modal
          visible={showPairingMenu}
          transparent
          animationType="fade"
          onRequestClose={() => setShowPairingMenu(false)}
        >
          <Pressable
            style={styles.popoverOverlay}
            onPress={() => setShowPairingMenu(false)}
          >
            <View style={[styles.popoverMenu, { top: insets.top + 60 }]}>
              <TouchableOpacity
                style={styles.popoverItem}
                onPress={() => {
                  setShowPairingMenu(false);
                  setShowManualModal(true);
                }}
              >
                <Icon name="create-outline" size={20} color="#3b9fd8" />
                <Text style={styles.popoverText}>手动输入 IP</Text>
              </TouchableOpacity>
              <View style={styles.popoverDivider} />
              <TouchableOpacity
                style={styles.popoverItem}
                onPress={() => {
                  setShowPairingMenu(false);
                  navigation.navigate('QRScanner');
                }}
              >
                <Icon name="scan-outline" size={20} color="#3b9fd8" />
                <Text style={styles.popoverText}>扫码配对</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Modal>

        {/* Manual Input Modal */}
        <Modal
          visible={showManualModal}
          transparent
          animationType="slide"
          onRequestClose={() => setShowManualModal(false)}
        >
          <Pressable
            style={styles.modalOverlay}
            onPress={() => setShowManualModal(false)}
          >
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              style={styles.modalContent}
            >
              <Pressable onPress={() => {}}>
                <View style={styles.manualCard}>
                  <View style={styles.modalHeader}>
                    <Text style={styles.manualTitle}>{'手动输入 IP 配对'}</Text>
                    <TouchableOpacity onPress={() => setShowManualModal(false)}>
                      <Icon name="close" size={22} color="#8aa9bc" />
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.manualDescription}>
                    {
                      '如果扫描不到电脑，尤其是 Windows 设备，可直接输入电脑端 IPv4 地址继续配对。'
                    }
                  </Text>
                  <View style={styles.manualInputRow}>
                    <TextInput
                      style={[
                        styles.manualInput,
                        manualHostError && styles.manualInputError,
                      ]}
                      value={manualHost}
                      onChangeText={value => {
                        setManualHost(value);
                        if (manualHostError) {
                          setManualHostError(null);
                        }
                      }}
                      placeholder="192.168.0.1"
                      placeholderTextColor="#8aa9bc"
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="decimal-pad"
                      returnKeyType="done"
                      autoFocus
                      onSubmitEditing={handleManualPair}
                    />
                    <TouchableOpacity
                      style={styles.manualButton}
                      activeOpacity={0.8}
                      onPress={handleManualPair}
                    >
                      <Text style={styles.manualButtonText}>{'继续'}</Text>
                    </TouchableOpacity>
                  </View>
                  {manualHostError ? (
                    <Text style={styles.manualErrorText}>{manualHostError}</Text>
                  ) : (
                    <Text style={styles.manualHint}>
                      {
                        '默认使用同步端口 39393，输入后仍需在下一步填写 6 位连接码。'
                      }
                    </Text>
                  )}
                </View>
              </Pressable>
            </KeyboardAvoidingView>
          </Pressable>
        </Modal>
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
  scanButton: {
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
  scanButtonText: {
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
    marginBottom: 12,
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

  // Popover Styles
  popoverOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  popoverMenu: {
    position: 'absolute',
    right: 20,
    width: 160,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 5,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
  },
  popoverItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  popoverText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.screenTitle,
  },
  popoverDivider: {
    height: 1,
    backgroundColor: 'rgba(0,0,0,0.05)',
    marginHorizontal: 8,
  },

  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  modalContent: {
    width: '100%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  manualCard: {
    padding: 20,
    borderRadius: 24,
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 10,
  },
  manualSection: {
    paddingHorizontal: 20,
  },
  manualDock: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  manualTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.screenTitle,
  },
  manualDescription: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 19,
    color: '#6a96b8',
  },
  manualInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 18,
  },
  manualInput: {
    flex: 1,
    minHeight: 52,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e1eef5',
    backgroundColor: '#f8fbfe',
    color: colors.screenTitle,
    fontSize: 16,
  },
  manualInputError: {
    borderColor: '#db6b6b',
  },
  manualButton: {
    minHeight: 52,
    paddingHorizontal: 20,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#3b9fd8',
  },
  manualButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  manualHint: {
    marginTop: 12,
    fontSize: 12,
    lineHeight: 18,
    color: '#8aabbd',
  },
  manualErrorText: {
    marginTop: 12,
    fontSize: 12,
    lineHeight: 18,
    color: '#db6b6b',
  },
});
