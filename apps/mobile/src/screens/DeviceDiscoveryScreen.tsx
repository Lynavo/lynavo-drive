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
  Clipboard,
  TextInput,
  Keyboard,
  LayoutChangeEvent,
  Platform,
  Modal,
  Pressable,
  KeyboardAvoidingView,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import {
  CommonActions,
  useFocusEffect,
  useNavigation,
  useRoute,
} from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { DiscoveredDeviceDTO } from '@syncflow/contracts';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { colors } from '../theme/colors';
import { Icon } from '../components/Icon';
import {
  diagnosticUploadService,
  DiagnosticUploadError,
} from '../services/diagnostic-upload-service';
import { UnconnectedGuide } from '../components/onboarding/UnconnectedGuide';
import {
  hasSeenUnconnectedGuide,
  markUnconnectedGuideSeen,
} from '../utils/onboardingStorage';
import { buildManualPairDevice } from './deviceDiscoveryManualPairing';
import { shouldKeepCachedDevicesVisible } from './deviceDiscoveryRefresh';
import { marketConfig } from '../markets';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DiscoveredDevice = Pick<
  DiscoveredDeviceDTO,
  'deviceId' | 'name' | 'ip' | 'type' | 'port'
>;

const desktopDownloadHost = marketConfig.downloadUrl
  .replace(/^https?:\/\//, '')
  .replace(/\/$/, '');

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
  const { t, i18n } = useTranslation();
  const isAndroid = Platform.OS === 'android';
  const language = i18n.resolvedLanguage ?? i18n.language;
  const popoverMenuWidth = language.startsWith('zh') ? 176 : 200;
  const route = useRoute<RouteProp<RootStackParamList, 'DeviceDiscovery'>>();
  const mode = route.params?.mode ?? 'initial';
  const [knownDeviceIds, setKnownDeviceIds] = useState<Set<string>>(new Set());
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(true);
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [manualHost, setManualHost] = useState('');
  const [manualHostError, setManualHostError] = useState<string | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [manualSectionHeight, setManualSectionHeight] = useState(0);
  const [isUploadingDiagnostics, setIsUploadingDiagnostics] = useState(false);
  const [showUnconnectedGuide, setShowUnconnectedGuide] = useState(false);

  // Popover & Modal state
  const [showPairingMenu, setShowPairingMenu] = useState(false);
  const [showManualModal, setShowManualModal] = useState(false);
  const [diagnosticPromptVisible, setDiagnosticPromptVisible] = useState(false);
  const [diagnosticPromptNote, setDiagnosticPromptNote] = useState('');
  const devicesRef = useRef<DiscoveredDevice[]>([]);
  const preserveCachedDevicesRef = useRef(false);

  useEffect(() => {
    if (mode !== 'switch') return;
    let cancelled = false;
    const { NativeSyncEngine: NSE } = NativeModules;
    Promise.all([
      (NSE?.getKnownDeviceIds?.() ?? Promise.resolve([])).catch((err: unknown) => {
        console.warn('[DiscoveryScreen] switch bootstrap: getKnownDeviceIds failed', err);
        return [] as string[];
      }),
      (NSE?.getBindingState?.() ?? Promise.resolve(null)).catch((err: unknown) => {
        console.warn('[DiscoveryScreen] switch bootstrap: getBindingState failed', err);
        return null;
      }),
    ]).then(([ids, binding]) => {
      if (cancelled) return;
      setKnownDeviceIds(new Set(ids as string[]));
      setCurrentDeviceId((binding as { deviceId?: string } | null)?.deviceId ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  useEffect(() => {
    if (mode === 'switch') {
      setShowUnconnectedGuide(false);
      return;
    }

    let cancelled = false;
    void hasSeenUnconnectedGuide().then(seen => {
      if (!cancelled) {
        setShowUnconnectedGuide(!seen);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  useEffect(() => {
    devicesRef.current = devices;
  }, [devices]);

  // ---------------------------------------------------------------------------
  // Native module discovery
  // ---------------------------------------------------------------------------

  useFocusEffect(
    useCallback(() => {
      console.log('[DiscoveryScreen] focused, starting discovery session');
      preserveCachedDevicesRef.current = devicesRef.current.length > 0;
      setScanning(devicesRef.current.length === 0);

      let subscription: { remove: () => void } | undefined;
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
      let active = true;

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

              if (
                shouldKeepCachedDevicesVisible({
                  currentDeviceCount: devicesRef.current.length,
                  nextDeviceCount: discoveredDevices.length,
                  preserveCachedDevices: preserveCachedDevicesRef.current,
                })
              ) {
                console.log(
                  '[DiscoveryScreen] keeping cached devices visible during discovery refresh',
                );
                return;
              }

              preserveCachedDevicesRef.current = false;
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
          console.log('[DiscoveryScreen] restarting discovery');
          NativeSyncEngine.stopDiscovery()
            .catch((e: Error) =>
              console.warn('[DiscoveryScreen] stopDiscovery before start failed:', e),
            )
            .then(() => {
              if (!active) return undefined;
              return NativeSyncEngine.startDiscovery();
            })
            .then(() => console.log('[DiscoveryScreen] startDiscovery resolved'))
            .catch((e: Error) =>
              console.warn('[DiscoveryScreen] startDiscovery failed:', e),
            );
          // Timeout fallback: if no devices found after 8s, stop scanning animation
          timeoutTimer = setTimeout(() => {
            console.log(
              '[DiscoveryScreen] discovery timeout reached with no devices',
            );
            preserveCachedDevicesRef.current = false;
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
        active = false;
        console.log(
          '[DiscoveryScreen] blurred, cleaning up discovery listeners',
        );
        subscription?.remove();
        if (timeoutTimer) clearTimeout(timeoutTimer);
        preserveCachedDevicesRef.current = false;
        try {
          console.log('[DiscoveryScreen] calling stopDiscovery during cleanup');
          NativeModules.NativeSyncEngine?.stopDiscovery();
        } catch {
          // ignore cleanup errors
        }
      };
    }, []),
  );

  useEffect(() => {
    console.log('[DiscoveryScreen] mounted');
    return () => {
      console.log('[DiscoveryScreen] unmounted');
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
        NativeSyncEngine.stopDiscovery()
          .catch((e: Error) =>
            console.warn('[DiscoveryScreen] handleRescan stopDiscovery failed:', e),
          )
          .then(() => NativeSyncEngine.startDiscovery())
          .catch((e: Error) => {
            console.warn('[DiscoveryScreen] handleRescan startDiscovery failed:', e);
            setScanning(false);
          });
        return;
      }
    } catch {
      // fallback
    }
    setScanning(false);
  }, []);

  const handleDevicePress = useCallback(
    async (device: DiscoveredDevice) => {
      console.log(
        '[DiscoveryScreen] handleDevicePress',
        `${device.name}/${device.ip || 'no-ip'}/${device.deviceId}/${device.type}`,
      );

      if (mode !== 'switch') {
        navigation.navigate('CodeVerify', {
          deviceId: device.deviceId,
          host: device.ip,
          port: device.port,
          deviceName: device.name,
        });
        return;
      }

      if (device.deviceId === currentDeviceId) {
        Alert.alert(t('deviceDiscovery.switch.toast.alreadyCurrent'));
        return;
      }

      if (knownDeviceIds.has(device.deviceId)) {
        try {
          const { NativeSyncEngine } = NativeModules;
          if (!NativeSyncEngine) {
            throw new Error('NativeSyncEngine unavailable');
          }
          await NativeSyncEngine.pairDevice({
            deviceId: device.deviceId,
            host: device.ip,
            port: device.port,
            connectionCode: '',
          });
          navigation.dispatch(
            CommonActions.reset({
              index: 0,
              routes: [{ name: 'SyncActivity' }],
            }),
          );
          return;
        } catch (error) {
          console.warn(
            '[DiscoveryScreen] known device direct switch failed, requiring code verification',
            error,
          );
        }
      }

      navigation.navigate('CodeVerify', {
        deviceId: device.deviceId,
        host: device.ip,
        port: device.port,
        deviceName: device.name,
      });
    },
    [mode, navigation, currentDeviceId, knownDeviceIds, t],
  );

  const handleManualPair = useCallback(() => {
    console.log('[DiscoveryScreen] handleManualPair submitted', manualHost);
    const manualDevice = buildManualPairDevice(manualHost);

    if (!manualDevice) {
      console.log('[DiscoveryScreen] handleManualPair rejected invalid host');
      setManualHostError(t('deviceDiscovery.dialogs.manualInput.ipError'));
      return;
    }

    console.log(
      '[DiscoveryScreen] handleManualPair accepted',
      `${manualDevice.name}/${manualDevice.ip}/${manualDevice.deviceId}/${manualDevice.type}`,
    );
    setManualHostError(null);
    setShowManualModal(false);
    handleDevicePress(manualDevice);
  }, [handleDevicePress, manualHost, t]);

  const startDiagnosticUpload = useCallback(async (rawNote?: string) => {
    try {
      setIsUploadingDiagnostics(true);

      const { NativeSyncEngine } = NativeModules;
      if (!NativeSyncEngine?.exportDiagnostics) {
        Alert.alert(
          t('settings.dialogs.exportUnavailable.title'),
          t('settings.dialogs.exportUnavailable.body'),
        );
        return;
      }

      const archivePath: string = await NativeSyncEngine.exportDiagnostics();
      const archiveUrl = archivePath.startsWith('file://')
        ? archivePath
        : `file://${archivePath}`;
      const clientId = String(await NativeSyncEngine.getClientId());
      const note = (rawNote ?? '').trim();
      const result = await diagnosticUploadService.upload(
        archiveUrl,
        clientId,
        new AbortController().signal,
        () => undefined,
        note || undefined,
      );

      Clipboard.setString(result.refId);
      Alert.alert(
        t('settings.uploadDiagnostic.success.toast', {
          refId: result.refId,
        }),
      );
    } catch (error) {
      if (
        error instanceof DiagnosticUploadError &&
        error.detail.kind === 'BUNDLE_TOO_LARGE'
      ) {
        Alert.alert(t('settings.uploadDiagnostic.tooLarge.toast'));
      } else if (
        error instanceof DiagnosticUploadError &&
        error.detail.kind === 'ABORTED'
      ) {
        Alert.alert(t('settings.uploadDiagnostic.aborted.toast'));
      } else {
        Alert.alert(t('settings.uploadDiagnostic.failure.toast'));
      }
    } finally {
      setIsUploadingDiagnostics(false);
    }
  }, [t]);

  const handleUploadDiagnostics = useCallback(() => {
    setShowPairingMenu(false);

    if (Platform.OS === 'ios' && typeof Alert.prompt === 'function') {
      Alert.prompt(
        t('settings.uploadDiagnostic.confirm.title'),
        t('settings.uploadDiagnostic.confirm.message'),
        [
          {
            text: t('settings.uploadDiagnostic.confirm.cancel'),
            style: 'cancel',
          },
          {
            text: t('settings.uploadDiagnostic.confirm.ok'),
            onPress: (note?: string) => void startDiagnosticUpload(note),
          },
        ],
        'plain-text',
        '',
      );
      return;
    }

    setDiagnosticPromptNote('');
    setDiagnosticPromptVisible(true);
  }, [startDiagnosticUpload, t]);

  const handleDismissUnconnectedGuide = useCallback(async () => {
    await markUnconnectedGuideSeen();
    setShowUnconnectedGuide(false);
  }, []);

  const renderDevice = useCallback(
    ({ item }: ListRenderItemInfo<DiscoveredDevice>) => {
      const isCurrentDevice = mode === 'switch' && item.deviceId === currentDeviceId;
      const isKnownDevice =
        mode === 'switch' && !isCurrentDevice && knownDeviceIds.has(item.deviceId);

      return (
        <TouchableOpacity
          style={styles.deviceCard}
          activeOpacity={0.7}
          onPress={() => handleDevicePress(item)}
        >
          <View style={styles.deviceIconWrapper}>
            <Icon name="desktop-outline" size={20} color="#fff" />
          </View>
          <View style={styles.deviceInfo}>
            <Text style={styles.deviceName}>{item.name}</Text>
            <Text style={styles.deviceMeta}>
              {item.type === 'win' ? 'Windows' : 'macOS'} {'·'} {item.ip}
            </Text>
          </View>
          {isCurrentDevice && (
            <View style={styles.badgeCurrent}>
              <Text style={styles.badgeCurrentText}>
                {t('deviceDiscovery.switch.badge.current')}
              </Text>
            </View>
          )}
          {isKnownDevice && (
            <View style={styles.badgeKnown}>
              <Text style={styles.badgeKnownText}>
                {t('deviceDiscovery.switch.badge.known')}
              </Text>
            </View>
          )}
          {!isCurrentDevice && !isKnownDevice && (
            <Icon name="chevron-forward" size={20} color="#b0c8da" />
          )}
        </TouchableOpacity>
      );
    },
    [handleDevicePress, mode, currentDeviceId, knownDeviceIds, t],
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

  const troubleshootingCard = (
    <View style={styles.troubleshootingCard}>
      <Text style={styles.troubleshootingTitle}>
        {t('deviceDiscovery.troubleshooting.title')}
      </Text>
      <View style={styles.troubleshootingList}>
        <View style={styles.troubleshootingItem}>
          <View style={styles.troubleshootingBullet} />
          <Text style={styles.troubleshootingText}>
            {t('deviceDiscovery.troubleshooting.sameWifi')}
          </Text>
        </View>
        <View style={styles.troubleshootingItem}>
          <View style={styles.troubleshootingBullet} />
          <Text style={styles.troubleshootingText}>
            {t('deviceDiscovery.troubleshooting.desktopApp').replace(
              'www.vividrop.cn',
              desktopDownloadHost,
            )}
          </Text>
        </View>
      </View>
      <TouchableOpacity
        style={styles.troubleshootingLink}
        activeOpacity={0.72}
        onPress={() => navigation.navigate('ConnectionTutorial')}
      >
        <Text style={styles.troubleshootingLinkText}>
          {t('deviceDiscovery.troubleshooting.cta')}
        </Text>
      </TouchableOpacity>
    </View>
  );


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
            {mode === 'switch' ? (
              <TouchableOpacity
                style={styles.backButton}
                activeOpacity={0.7}
                onPress={() => navigation.goBack()}
              >
                <Icon name="chevron-back" size={20} color="#3b9fd8" />
              </TouchableOpacity>
            ) : (
              <View style={styles.wifiIconBox}>
                <Icon name="wifi" size={24} color="#3b9fd8" />
              </View>
            )}
            <TouchableOpacity
              style={styles.scanButton}
              activeOpacity={0.8}
              onPress={() => setShowPairingMenu(true)}
            >
              <Icon name="settings-outline" size={16} color="#3b9fd8" />
              <Text style={styles.scanButtonText}>{t('deviceDiscovery.actions.manualPair')}</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.title}>
            {mode === 'switch' ? t('deviceDiscovery.switch.title') : t('deviceDiscovery.title')}
          </Text>
          <Text style={styles.subtitle}>
            {isAndroid
              ? t('deviceDiscovery.subtitle.android')
              : t('deviceDiscovery.subtitle.ios')}
          </Text>
        </View>

        {/* Scanning animation */}
        {scanning && devices.length === 0 && (
          <View style={styles.scanningSection}>
            <PulseRings />
            <Text style={styles.scanningText}>{t('deviceDiscovery.scanning.text')}</Text>
          </View>
        )}

        {/* Device list */}
        {(devices.length > 0 || !scanning) && (
          <View
            style={[styles.listSection, { paddingBottom: listBottomInset }]}
          >
            {devices.length > 0 && (
              <Text style={styles.deviceCount}>
                {t('deviceDiscovery.devices.foundCount', { count: devices.length })}
              </Text>
            )}
            {devices.length === 0 ? (
              <View style={styles.emptySection}>
                <Text style={styles.emptyText}>
                  {isAndroid
                    ? t('deviceDiscovery.emptyState.android')
                    : t('deviceDiscovery.emptyState.default')}
                </Text>
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
                  <Text style={styles.rescanText}>{t('deviceDiscovery.actions.rescan')}</Text>
                </View>
              </TouchableOpacity>
              {mode === 'switch' ? null : troubleshootingCard}
            </View>
          )}
        </View>

        {showUnconnectedGuide && (
          <UnconnectedGuide
            onSkip={() => void handleDismissUnconnectedGuide()}
            onStart={() => void handleDismissUnconnectedGuide()}
          />
        )}

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
            <View
              style={[
                styles.popoverMenu,
                { top: insets.top + 60, width: popoverMenuWidth },
              ]}
            >
              <TouchableOpacity
                style={styles.popoverItem}
                onPress={() => {
                  setShowPairingMenu(false);
                  setShowManualModal(true);
                }}
              >
                <Icon name="create-outline" size={20} color="#3b9fd8" />
                <Text style={styles.popoverText}>{t('deviceDiscovery.actions.manualInputIp')}</Text>
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
                <Text style={styles.popoverText}>{t('deviceDiscovery.actions.qrPair')}</Text>
              </TouchableOpacity>
              <View style={styles.popoverDivider} />
              <TouchableOpacity
                style={styles.popoverItem}
                disabled={isUploadingDiagnostics}
                onPress={handleUploadDiagnostics}
              >
                <Icon name="cloud-upload-outline" size={20} color="#3b9fd8" />
                <Text style={styles.popoverText}>
                  {isUploadingDiagnostics
                    ? t('settings.uploadDiagnostic.progress.title')
                    : t('settings.uploadDiagnostic.button')}
                </Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Modal>

        {/* Diagnostic Upload Prompt */}
        <Modal
          visible={diagnosticPromptVisible}
          transparent
          animationType="fade"
          onRequestClose={() => {
            setDiagnosticPromptVisible(false);
            setDiagnosticPromptNote('');
          }}
        >
          <Pressable
            style={styles.diagnosticPromptBackdrop}
            onPress={() => {
              setDiagnosticPromptVisible(false);
              setDiagnosticPromptNote('');
            }}
          >
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              style={styles.diagnosticPromptKeyboard}
            >
              <Pressable onPress={() => {}}>
                <View style={styles.diagnosticPromptCard}>
                  <Text style={styles.diagnosticPromptTitle}>
                    {t('settings.uploadDiagnostic.confirm.title')}
                  </Text>
                  <Text style={styles.diagnosticPromptMessage}>
                    {t('settings.uploadDiagnostic.confirm.message')}
                  </Text>
                  <TextInput
                    style={styles.diagnosticPromptInput}
                    value={diagnosticPromptNote}
                    onChangeText={setDiagnosticPromptNote}
                    placeholder={t(
                      'settings.uploadDiagnostic.confirm.placeholder',
                    )}
                    placeholderTextColor="#8aa9bc"
                    multiline
                    maxLength={500}
                    textAlignVertical="top"
                    accessibilityLabel={t(
                      'settings.uploadDiagnostic.confirm.placeholder',
                    )}
                  />
                  <View style={styles.diagnosticPromptActions}>
                    <TouchableOpacity
                      style={styles.diagnosticPromptButton}
                      activeOpacity={0.72}
                      onPress={() => {
                        setDiagnosticPromptVisible(false);
                        setDiagnosticPromptNote('');
                      }}
                    >
                      <Text style={styles.diagnosticPromptCancelText}>
                        {t('settings.uploadDiagnostic.confirm.cancel')}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.diagnosticPromptButton,
                        styles.diagnosticPromptPrimaryButton,
                      ]}
                      activeOpacity={0.82}
                      onPress={() => {
                        const note = diagnosticPromptNote;
                        setDiagnosticPromptVisible(false);
                        setDiagnosticPromptNote('');
                        void startDiagnosticUpload(note);
                      }}
                    >
                      <Text style={styles.diagnosticPromptPrimaryText}>
                        {t('settings.uploadDiagnostic.confirm.ok')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </Pressable>
            </KeyboardAvoidingView>
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
                  <View style={styles.manualHandle} />
                  <View style={styles.modalHeader}>
                    <Text style={styles.manualTitle}>{t('deviceDiscovery.dialogs.manualInput.title')}</Text>
                    <TouchableOpacity onPress={() => setShowManualModal(false)}>
                      <Icon name="close" size={22} color="#8aa9bc" />
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.manualDescription}>
                    {t('deviceDiscovery.dialogs.manualInput.description')}
                  </Text>
                  <View style={styles.manualCallout}>
                    <View style={styles.manualCalloutIcon}>
                      <Icon name="desktop-outline" size={22} color="#3b82f6" />
                    </View>
                    <View style={styles.manualCalloutCopy}>
                      <Text style={styles.manualCalloutTitle}>
                        {t('deviceDiscovery.dialogs.manualInput.guideTitle')}
                      </Text>
                      <Text style={styles.manualCalloutBody}>
                        {t('deviceDiscovery.dialogs.manualInput.guideBody')}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.manualLabel}>
                    {t('deviceDiscovery.dialogs.manualInput.hostLabel')}
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
                      <Text style={styles.manualButtonText}>{t('deviceDiscovery.dialogs.manualInput.confirm')}</Text>
                    </TouchableOpacity>
                  </View>
                  {manualHostError ? (
                    <Text style={styles.manualErrorText}>
                      {manualHostError}
                    </Text>
                  ) : (
                    <Text style={styles.manualHint}>
                      {t('deviceDiscovery.dialogs.manualInput.hint')}
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
  badgeCurrent: {
    backgroundColor: 'rgba(59,159,216,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(59,159,216,0.4)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeCurrentText: {
    color: '#3b9fd8',
    fontSize: 11,
    fontWeight: '600',
  },
  badgeKnown: {
    backgroundColor: 'rgba(63,207,127,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(63,207,127,0.4)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeKnownText: {
    color: '#3fcf7f',
    fontSize: 11,
    fontWeight: '600',
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(59,159,216,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Empty state
  emptySection: {
    alignItems: 'stretch',
    paddingVertical: 48,
  },
  emptyText: {
    fontSize: 14,
    color: '#8aabbd',
    textAlign: 'center',
    marginBottom: 18,
  },
  troubleshootingCard: {
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: 'rgba(219,234,254,0.45)',
  },
  troubleshootingTitle: {
    color: '#1e40af',
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 10,
  },
  troubleshootingList: {
    gap: 8,
  },
  troubleshootingItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  troubleshootingBullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#3b82f6',
    marginTop: 6,
  },
  troubleshootingText: {
    flex: 1,
    color: '#3b5a8a',
    fontSize: 12,
    lineHeight: 18,
  },
  troubleshootingLink: {
    alignSelf: 'flex-start',
    marginTop: 12,
  },
  troubleshootingLinkText: {
    color: '#2563eb',
    fontSize: 12,
    fontWeight: '700',
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
    right: 16,
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
    paddingHorizontal: 14,
  },
  popoverText: {
    flex: 1,
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 20,
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
    backgroundColor: 'rgba(13,27,39,0.42)',
    justifyContent: 'flex-end',
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
  diagnosticPromptBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(13,27,39,0.42)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  diagnosticPromptKeyboard: {
    width: '100%',
  },
  diagnosticPromptCard: {
    borderRadius: 24,
    backgroundColor: 'rgba(236,247,253,0.98)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.68)',
    paddingHorizontal: 20,
    paddingVertical: 18,
    shadowColor: '#173d58',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 8,
  },
  diagnosticPromptTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.screenTitle,
  },
  diagnosticPromptMessage: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 19,
    color: '#6a96b8',
  },
  diagnosticPromptInput: {
    marginTop: 14,
    minHeight: 88,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.18)',
    backgroundColor: 'rgba(255,255,255,0.82)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.screenTitle,
    fontSize: 14,
  },
  diagnosticPromptActions: {
    marginTop: 16,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  diagnosticPromptButton: {
    minWidth: 76,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
  },
  diagnosticPromptPrimaryButton: {
    backgroundColor: '#3b82f6',
  },
  diagnosticPromptCancelText: {
    color: '#6a96b8',
    fontSize: 14,
    fontWeight: '600',
  },
  diagnosticPromptPrimaryText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  manualCard: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 28,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: 'rgba(236,247,253,0.98)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.68)',
    shadowColor: '#173d58',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 10,
  },
  manualHandle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(90,122,150,0.28)',
    marginBottom: 18,
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
    marginTop: 6,
    fontSize: 13,
    lineHeight: 19,
    color: '#6a96b8',
  },
  manualCallout: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginTop: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.62)',
    shadowColor: 'rgba(59,130,210,0.3)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 14,
    elevation: 2,
  },
  manualCalloutIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(59,130,246,0.09)',
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  manualCalloutCopy: {
    flex: 1,
    minWidth: 0,
  },
  manualCalloutTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1a3a5c',
  },
  manualCalloutBody: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 18,
    color: '#5a7a96',
  },
  manualLabel: {
    marginTop: 18,
    marginBottom: 8,
    fontSize: 12,
    fontWeight: '700',
    color: '#5a7a96',
  },
  manualInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  manualInput: {
    flex: 1,
    minHeight: 52,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: 'rgba(59,130,246,0.18)',
    backgroundColor: 'rgba(255,255,255,0.82)',
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
    backgroundColor: '#3b82f6',
    shadowColor: 'rgba(59,130,246,0.5)',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.22,
    shadowRadius: 12,
    elevation: 3,
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
