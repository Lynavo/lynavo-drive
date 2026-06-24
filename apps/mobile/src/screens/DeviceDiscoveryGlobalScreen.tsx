import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  NativeEventEmitter,
  NativeModules,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  CommonActions,
  useNavigation,
  useRoute,
} from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type {
  DiscoveredDeviceDTO,
  RecentDesktopDTO,
} from '@syncflow/contracts';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import Svg, { Defs, Mask, Rect } from 'react-native-svg';
import {
  Check,
  ChevronRight,
  CloudDownload,
  Download,
  FileText,
  FileVideo,
  Monitor,
  Smartphone,
} from 'lucide-react-native';
import { Camera } from 'react-native-vision-camera';

import { Icon } from '../components/Icon';
import { GlobalGradientBackground } from '../components/GlobalGradientBackground';
import { ModalBlurBackdrop } from '../components/shared/ModalBlurBackdrop';
import { NativeModalBlurView } from '../components/shared/NativeModalBlurView';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useRecentDesktops } from '../stores/recent-desktops-store';
import { androidBoxShadow } from '../utils/androidShadow';
import {
  hasSeenUnconnectedGuide,
  markUnconnectedGuideSeen,
} from '../utils/onboardingStorage';
import { isVisualQaEnabled } from '../dev/visualQa';
import { pairDevice, PairingError } from '../services/SyncEngineModule';
import { buildManualPairDevice } from './deviceDiscoveryManualPairing';
import {
  normalizeDiscoveredDevices,
  recentDesktopMatchesDiscoveredDevice,
} from './deviceDiscoveryDevices';
import { shouldKeepCachedDevicesVisible } from './deviceDiscoveryRefresh';

type NavigationProp = StackNavigationProp<
  RootStackParamList,
  'DeviceDiscovery'
>;

type DiscoveredDevice = Pick<
  DiscoveredDeviceDTO,
  'deviceId' | 'name' | 'ip' | 'type' | 'port'
> & {
  availability?: DeviceAvailability;
  deviceKind?: 'desktop' | 'laptop';
};

type DeviceAvailability = 'available' | 'busy';
type ConnectionFlowStatus =
  | 'scanning'
  | 'ready'
  | 'empty'
  | 'failed'
  | 'timeout'
  | 'permissionRequired'
  | 'cameraDenied';
type ConnectionFailureCode =
  | 'wrong_code'
  | 'blocked'
  | 'version_incompatible'
  | 'unknown';
type ConnectionFailure = {
  code: ConnectionFailureCode;
  remainingAttempts?: number;
};
type ConnectionModalStep =
  | 'method'
  | 'manualPair'
  | 'cameraPermission'
  | 'code';
type FlowStateTone = 'neutral' | 'danger' | 'warning';
type NativeDiscoveryModule = {
  addListener: (eventName: string) => void;
  removeListeners: (count: number) => void;
  startDiscovery?: () => Promise<void>;
  stopDiscovery?: () => Promise<void>;
  getDiscoveryPermissionStatus?: () => Promise<unknown>;
};
type DiscoveryPermissionStatus = 'granted' | 'required' | 'unavailable';
type ConnectionGuidePreviewKind =
  | 'connect'
  | 'autoUpload'
  | 'uploadScope'
  | 'syncProgress'
  | 'records'
  | 'remoteResources';
type ConnectionGuideStep = {
  title: string;
  description: string;
  actionLabel: string;
  previewKind: ConnectionGuidePreviewKind;
};
type FlowStateContent = {
  title: string;
  description: string;
  actionLabel?: string;
  icon: string;
  tone: FlowStateTone;
  onAction?: () => void;
};

type SpotlightLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ConnectionGuideCardPosition = {
  position: 'absolute';
  left: number;
  right: number;
  top?: number;
  bottom?: number;
};
type GuidePreviewIconComponent = React.ComponentType<{
  color?: string;
  size?: number;
  strokeWidth?: number;
  testID?: string;
}>;

const GUIDE_CARD_EDGE_MARGIN = 16;
const GUIDE_CARD_VERTICAL_GAP = 14;
const GUIDE_CARD_TOP_MARGIN = 20;
const GUIDE_CARD_ESTIMATED_HEIGHT = 236;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function describeLogError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'unknown';
}

function isConnectionFailureCode(
  value: unknown,
): value is ConnectionFailureCode {
  return (
    value === 'wrong_code' ||
    value === 'blocked' ||
    value === 'version_incompatible' ||
    value === 'unknown'
  );
}

function normalizeConnectionFailure(error: unknown): ConnectionFailure {
  if (error instanceof PairingError) {
    return {
      code: error.blocked ? 'blocked' : error.code,
      remainingAttempts: error.remainingAttempts,
    };
  }

  if (isRecord(error)) {
    const code = isConnectionFailureCode(error.code) ? error.code : 'unknown';
    return {
      code,
      remainingAttempts:
        typeof error.remainingAttempts === 'number'
          ? error.remainingAttempts
          : undefined,
    };
  }

  return { code: 'unknown' };
}

function getConnectionCodeErrorMessage(failure: ConnectionFailure, t: any): string {
  if (
    failure.code === 'wrong_code' &&
    failure.remainingAttempts !== undefined &&
    failure.remainingAttempts > 0
  ) {
    return t('deviceDiscovery.global.connectionCodeWrongWithAttempts', {
      remainingAttempts: failure.remainingAttempts,
    });
  }
  return t('deviceDiscovery.global.connectionCodeWrong');
}

function getConnectionFailureCopy(
  failure: ConnectionFailure | null,
  t: any,
): {
  title: string;
  description: string;
  actionLabel: string;
  icon: string;
  tone: FlowStateTone;
} {
  if (failure?.code === 'blocked') {
    return {
      title: t('deviceDiscovery.global.pairingBlockedTitle'),
      description: t('deviceDiscovery.global.pairingBlockedDesc'),
      actionLabel: t('deviceDiscovery.global.reenter'),
      icon: 'alert-circle-outline',
      tone: 'danger',
    };
  }

  if (failure?.code === 'version_incompatible') {
    return {
      title: t('deviceDiscovery.global.versionIncompatibleTitle'),
      description: t('deviceDiscovery.global.versionIncompatibleDesc'),
      actionLabel: t('deviceDiscovery.global.rescan'),
      icon: 'alert-circle-outline',
      tone: 'warning',
    };
  }

  if (failure?.code === 'wrong_code') {
    return {
      title: t('deviceDiscovery.global.connectionCodeError'),
      description: getConnectionCodeErrorMessage(failure, t),
      actionLabel: t('deviceDiscovery.global.reenter'),
      icon: 'alert-circle-outline',
      tone: 'danger',
    };
  }

  return {
    title: t('deviceDiscovery.global.connectionFailed'),
    description: t('deviceDiscovery.global.connectionFailedDesc'),
    actionLabel: t('deviceDiscovery.global.reenter'),
    icon: 'alert-circle-outline',
    tone: 'danger',
  };
}

async function getAndroidDiscoveryPermissionStatus(
  nativeSyncEngine: NativeDiscoveryModule | undefined,
): Promise<DiscoveryPermissionStatus> {
  if (Platform.OS !== 'android') {
    return 'granted';
  }

  const status = await (
    nativeSyncEngine?.getDiscoveryPermissionStatus?.() ??
    Promise.resolve('granted')
  ).catch(() => 'granted');

  if (status === 'required' || status === 'unavailable') {
    return status;
  }

  return 'granted';
}

export function resolveConnectionGuideCardPosition({
  hole,
  viewportHeight,
  bottomInset,
}: {
  hole: SpotlightLayout | null;
  viewportHeight: number;
  bottomInset: number;
}): ConnectionGuideCardPosition {
  if (!hole) {
    return {
      position: 'absolute',
      left: GUIDE_CARD_EDGE_MARGIN,
      right: GUIDE_CARD_EDGE_MARGIN,
      bottom: Math.max(bottomInset, 8),
    };
  }

  const bottomMargin = Math.max(bottomInset, 8);
  const preferredCardTop = hole.y + hole.height + GUIDE_CARD_VERTICAL_GAP;
  const maxCardTop = Math.max(
    GUIDE_CARD_TOP_MARGIN,
    viewportHeight - bottomMargin - GUIDE_CARD_ESTIMATED_HEIGHT,
  );
  const shouldPlaceAbove = preferredCardTop > maxCardTop;
  const preferredAboveTop =
    hole.y - GUIDE_CARD_ESTIMATED_HEIGHT - GUIDE_CARD_VERTICAL_GAP;

  return {
    position: 'absolute',
    left: GUIDE_CARD_EDGE_MARGIN,
    right: GUIDE_CARD_EDGE_MARGIN,
    top: shouldPlaceAbove
      ? Math.max(GUIDE_CARD_TOP_MARGIN, Math.min(preferredAboveTop, maxCardTop))
      : preferredCardTop,
  };
}

const VISUAL_QA_LAN_DEVICES: DiscoveredDevice[] = [
  {
    deviceId: 'visual-qa-openimde-mac-mini',
    name: 'ViviDrop 演示 Mac Studio',
    ip: '192.168.31.21',
    type: 'mac',
    port: 39393,
    availability: 'available',
    deviceKind: 'desktop',
  },
  {
    deviceId: 'visual-qa-macbook-pro',
    name: 'ViviDrop 演示 MacBook Pro',
    ip: '192.168.31.36',
    type: 'mac',
    port: 39393,
    availability: 'available',
    deviceKind: 'laptop',
  },
  {
    deviceId: 'visual-qa-windows-workstation',
    name: 'ViviDrop 演示 Windows 工作站',
    ip: '192.168.31.52',
    type: 'win',
    port: 39393,
    availability: 'busy',
    deviceKind: 'desktop',
  },
];


function PulseDot() {
  const opacity = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 720,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.45,
          duration: 720,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return <Animated.View style={[styles.scanDot, { opacity }]} />;
}

export function DeviceDiscoveryGlobalScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProp<RootStackParamList, 'DeviceDiscovery'>>();
  const insets = useSafeAreaInsets();
  const mode = route.params?.mode ?? 'initial';
  const showPairingInvalidatedNotice =
    route.params?.reason === 'pairing_invalidated';
  const { recentDesktops, addDesktop } = useRecentDesktops();

  const getVisualQaDevices = useCallback(() => {
    return VISUAL_QA_LAN_DEVICES.map(device => {
      if (device.deviceId === 'visual-qa-openimde-mac-mini') {
        return { ...device, name: t('deviceDiscovery.global.demoMacStudio') };
      }
      if (device.deviceId === 'visual-qa-macbook-pro') {
        return { ...device, name: t('deviceDiscovery.global.demoMacBook') };
      }
      if (device.deviceId === 'visual-qa-windows-workstation') {
        return { ...device, name: t('deviceDiscovery.global.demoWindows') };
      }
      return device;
    });
  }, [t]);

  const connectionFeatureGuideSteps = React.useMemo<ConnectionGuideStep[]>(() => [
    {
      title: t('deviceDiscovery.global.onboarding.step1Title'),
      description: t('deviceDiscovery.global.onboarding.step1Desc'),
      actionLabel: t('deviceDiscovery.global.onboarding.step1Action'),
      previewKind: 'connect',
    },
    {
      title: t('deviceDiscovery.global.onboarding.step2Title'),
      description: t('deviceDiscovery.global.onboarding.step2Desc'),
      actionLabel: t('deviceDiscovery.global.onboarding.step2Action'),
      previewKind: 'autoUpload',
    },
    {
      title: t('deviceDiscovery.global.onboarding.step3Title'),
      description: t('deviceDiscovery.global.onboarding.step3Desc'),
      actionLabel: t('deviceDiscovery.global.onboarding.step3Action'),
      previewKind: 'uploadScope',
    },
    {
      title: t('deviceDiscovery.global.onboarding.step4Title'),
      description: t('deviceDiscovery.global.onboarding.step4Desc'),
      actionLabel: t('deviceDiscovery.global.onboarding.step4Action'),
      previewKind: 'syncProgress',
    },
    {
      title: t('deviceDiscovery.global.onboarding.step5Title'),
      description: t('deviceDiscovery.global.onboarding.step5Desc'),
      actionLabel: t('deviceDiscovery.global.onboarding.step5Action'),
      previewKind: 'records',
    },
    {
      title: t('deviceDiscovery.global.onboarding.step6Title'),
      description: t('deviceDiscovery.global.onboarding.step6Desc'),
      actionLabel: t('deviceDiscovery.global.onboarding.step6Action'),
      previewKind: 'remoteResources',
    },
  ], [t]);

  const [knownDeviceIds, setKnownDeviceIds] = useState<Set<string>>(new Set());
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [scanning, setScanning] = useState(true);
  const [manualHost, setManualHost] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);
  const [selectedDevice, setSelectedDevice] = useState<DiscoveredDevice | null>(
    null,
  );
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionFlowStatus>('scanning');
  const [connectionFailure, setConnectionFailure] =
    useState<ConnectionFailure | null>(null);
  const [connectionModalStep, setConnectionModalStep] =
    useState<ConnectionModalStep | null>(null);
  const [connectionCode, setConnectionCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [guideStepIndex, setGuideStepIndex] = useState(0);
  const [spotlightLayout, setSpotlightLayout] =
    useState<SpotlightLayout | null>(null);
  const containerRef = useRef<React.ElementRef<typeof View>>(null);
  const devicesCardRef = useRef<React.ElementRef<typeof View>>(null);
  const devicesRef = useRef<DiscoveredDevice[]>([]);
  const preserveCachedDevicesRef = useRef(false);

  useEffect(() => {
    devicesRef.current = devices;
  }, [devices]);

  useEffect(() => {
    if (mode !== 'switch') {
      setKnownDeviceIds(new Set());
      setCurrentDeviceId(null);
      return undefined;
    }

    let cancelled = false;
    const { NativeSyncEngine } = NativeModules;

    Promise.all([
      (NativeSyncEngine?.getKnownDeviceIds?.() ?? Promise.resolve([])).catch(
        (error: unknown) => {
          console.warn(
            '[DeviceDiscoveryGlobalScreen] switch bootstrap getKnownDeviceIds failed',
            error,
          );
          return [] as string[];
        },
      ),
      (NativeSyncEngine?.getBindingState?.() ?? Promise.resolve(null)).catch(
        (error: unknown) => {
          console.warn(
            '[DeviceDiscoveryGlobalScreen] switch bootstrap getBindingState failed',
            error,
          );
          return null;
        },
      ),
    ]).then(([ids, binding]) => {
      if (cancelled) return;
      setKnownDeviceIds(new Set(ids));
      setCurrentDeviceId(
        ((binding as { deviceId?: string } | null)?.deviceId as
          | string
          | undefined) ?? null,
      );
    });

    return () => {
      cancelled = true;
    };
  }, [mode]);

  useEffect(() => {
    if (mode === 'switch') {
      setShowGuide(false);
      return;
    }

    let cancelled = false;
    void hasSeenUnconnectedGuide().then(seen => {
      if (!cancelled) {
        setGuideStepIndex(0);
        setShowGuide(!seen);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  useEffect(() => {
    preserveCachedDevicesRef.current = devicesRef.current.length > 0;
    setScanning(devicesRef.current.length === 0);
    setConnectionStatus(devicesRef.current.length === 0 ? 'scanning' : 'ready');

    let subscription: { remove: () => void } | undefined;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    let visualQaTimer: ReturnType<typeof setTimeout> | undefined;
    let active = true;

    if (isVisualQaEnabled()) {
      visualQaTimer = setTimeout(() => {
        if (!active || devicesRef.current.length > 0) return;
        preserveCachedDevicesRef.current = false;
        setDevices(getVisualQaDevices());
        setScanning(false);
        setConnectionStatus('ready');
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          timeoutTimer = undefined;
        }
      }, 900);
      return () => {
        active = false;
        if (visualQaTimer) clearTimeout(visualQaTimer);
        preserveCachedDevicesRef.current = false;
      };
    }

    const scheduleDiscoveryTimeout = () => {
      timeoutTimer = setTimeout(() => {
        preserveCachedDevicesRef.current = false;
        setScanning(false);
        if (devicesRef.current.length === 0) {
          setConnectionStatus('empty');
        }
      }, 8000);
    };

    try {
      const { NativeSyncEngine } = NativeModules as {
        NativeSyncEngine?: NativeDiscoveryModule;
      };
      if (!NativeSyncEngine) {
        scheduleDiscoveryTimeout();
        return () => {
          if (visualQaTimer) clearTimeout(visualQaTimer);
          if (timeoutTimer) clearTimeout(timeoutTimer);
        };
      }

      const emitter = new NativeEventEmitter(NativeSyncEngine);
      subscription = emitter.addListener(
        'onDiscoveredDevicesChanged',
        (nextDevices: DiscoveredDevice[]) => {
          const normalizedDevices = normalizeDiscoveredDevices(nextDevices);
          if (
            shouldKeepCachedDevicesVisible({
              currentDeviceCount: devicesRef.current.length,
              nextDeviceCount: normalizedDevices.length,
              preserveCachedDevices: preserveCachedDevicesRef.current,
            })
          ) {
            return;
          }

          preserveCachedDevicesRef.current = false;
          setDevices(normalizedDevices);
          if (normalizedDevices.length > 0) {
            setScanning(false);
            setConnectionStatus('ready');
            if (timeoutTimer) {
              clearTimeout(timeoutTimer);
              timeoutTimer = undefined;
            }
          }
        },
      );

      void (async () => {
        await (NativeSyncEngine.stopDiscovery?.() ?? Promise.resolve()).catch(
          () => undefined,
        );
        if (!active) return;

        const permissionStatus = await getAndroidDiscoveryPermissionStatus(
          NativeSyncEngine,
        );
        if (!active) return;
        if (permissionStatus === 'required') {
          preserveCachedDevicesRef.current = false;
          setScanning(false);
          setConnectionStatus('permissionRequired');
          return;
        }

        await (NativeSyncEngine.startDiscovery?.() ?? Promise.resolve()).catch(
          () => undefined,
        );
        if (!active) return;
        scheduleDiscoveryTimeout();
      })().catch(() => {
        if (!active) return;
        scheduleDiscoveryTimeout();
      });
    } catch {
      scheduleDiscoveryTimeout();
    }

    return () => {
      active = false;
      subscription?.remove();
      if (visualQaTimer) clearTimeout(visualQaTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      preserveCachedDevicesRef.current = false;
      try {
        NativeModules.NativeSyncEngine?.stopDiscovery?.();
      } catch {
        // ignore cleanup errors
      }
    };
  }, []);

  const displayedRecentDesktops =
    mode === 'switch'
      ? recentDesktops.filter(
          recent =>
            recent.desktopDeviceId === currentDeviceId &&
            !devices.some(device => device.deviceId === recent.desktopDeviceId),
        )
      : recentDesktops.filter(
          recent =>
            !devices.some(device =>
              recentDesktopMatchesDiscoveredDevice(recent, device),
            ),
        );
  const discoveredCount = devices.length + displayedRecentDesktops.length;
  const isShowingSkeleton = scanning && discoveredCount === 0;
  const statusLabel = isShowingSkeleton
    ? t('deviceDiscovery.global.connectionStatus.scanning')
    : connectionStatus === 'permissionRequired'
    ? t('deviceDiscovery.global.connectionStatus.permissionRequired')
    : t('deviceDiscovery.devices.foundCount', { count: discoveredCount });

  const measureGuideTarget = useCallback(() => {
    const containerNode = containerRef.current;
    const devicesCardNode = devicesCardRef.current;
    if (
      !containerNode ||
      !devicesCardNode ||
      typeof containerNode.measureInWindow !== 'function' ||
      typeof devicesCardNode.measureInWindow !== 'function'
    ) {
      return;
    }

    containerNode.measureInWindow((containerX, containerY) => {
      devicesCardNode.measureInWindow((cardX, cardY, width, height) => {
        if (width <= 0 || height <= 0) return;
        const nextLayout = {
          x: cardX - containerX,
          y: cardY - containerY,
          width,
          height,
        };
        setSpotlightLayout(previous => {
          if (
            previous &&
            Math.abs(previous.x - nextLayout.x) < 1 &&
            Math.abs(previous.y - nextLayout.y) < 1 &&
            Math.abs(previous.width - nextLayout.width) < 1 &&
            Math.abs(previous.height - nextLayout.height) < 1
          ) {
            return previous;
          }
          return nextLayout;
        });
      });
    });
  }, []);

  useEffect(() => {
    if (!showGuide) {
      return undefined;
    }

    const frame = requestAnimationFrame(measureGuideTarget);
    return () => cancelAnimationFrame(frame);
  }, [
    showGuide,
    isShowingSkeleton,
    devices.length,
    recentDesktops.length,
    connectionStatus,
    measureGuideTarget,
  ]);

  const goBack = useCallback(() => {
    if (mode === 'switch' || navigation.canGoBack()) {
      navigation.goBack();
    }
  }, [mode, navigation]);

  const openDeviceCodeModal = useCallback(
    (device: DiscoveredDevice) => {
      if (showGuide) {
        return;
      }
      if (mode === 'switch' && device.deviceId === currentDeviceId) {
        Alert.alert(t('deviceDiscovery.switch.toast.alreadyCurrent'));
        return;
      }
      setSelectedDevice(device);
      setConnectionCode('');
      setCodeError(null);
      setConnectionFailure(null);
      if (device.availability === 'busy') {
        setConnectionStatus('timeout');
        return;
      }

      setConnectionStatus('ready');
      setConnectionModalStep('code');
    },
    [currentDeviceId, mode, showGuide],
  );

  const openRecentDesktop = useCallback(
    async (recent: RecentDesktopDTO) => {
      if (showGuide) {
        return;
      }

      const discoveredDevice = devices.find(
        device => device.deviceId === recent.desktopDeviceId,
      );
      const device: DiscoveredDevice = {
        deviceId: recent.desktopDeviceId,
        name: discoveredDevice?.name ?? recent.desktopName,
        ip: discoveredDevice?.ip ?? recent.host,
        port: discoveredDevice?.port ?? recent.port,
        type: discoveredDevice?.type ?? 'mac',
        availability: discoveredDevice?.availability,
        deviceKind: discoveredDevice?.deviceKind,
      };

      if (mode === 'switch' && device.deviceId === currentDeviceId) {
        Alert.alert(t('deviceDiscovery.switch.toast.alreadyCurrent'));
        return;
      }

      if (device.availability === 'busy') {
        setConnectionStatus('timeout');
        return;
      }

      setSelectedDevice(device);
      setConnectionCode('');
      setCodeError(null);
      setConnectionFailure(null);
      setConnectionStatus('ready');
      setVerifying(true);

      try {
        await pairDevice({
          deviceId: device.deviceId,
          host: device.ip,
          port: device.port || 39393,
          connectionCode: '',
        });
        await addDesktop({
          desktopDeviceId: device.deviceId,
          desktopName: device.name,
          host: device.ip,
          port: device.port || 39393,
          authorizationStatus: 'authorized',
        });
        setVerifying(false);
        setConnectionModalStep(null);
        navigation.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [{ name: 'SyncActivity' }],
          }),
        );
      } catch (error) {
        if (error instanceof PairingError) {
          console.info(
            '[DeviceDiscoveryGlobalScreen] recent desktop reconnect requires pairing',
            {
              code: error.code,
              nativeCode: error.nativeCode,
              message: describeLogError(error),
            },
          );
        } else {
          console.warn(
            '[DeviceDiscoveryGlobalScreen] recent desktop reconnect failed, requiring pairing',
            error,
          );
        }
        setVerifying(false);
        setConnectionModalStep('code');
      }
    },
    [addDesktop, currentDeviceId, devices, mode, navigation, showGuide],
  );

  const handleManualPair = useCallback(() => {
    const manualDevice = buildManualPairDevice(manualHost);
    if (!manualDevice) {
      setManualError(t('deviceDiscovery.global.manualIPErr'));
      return;
    }
    setManualError(null);
    setSelectedDevice(manualDevice);
    setConnectionCode('');
    setCodeError(null);
    setConnectionFailure(null);
    setConnectionStatus('ready');
    setConnectionModalStep('code');
  }, [manualHost]);

  const handleVerifyCode = useCallback(async () => {
    if (!selectedDevice || !connectionCode.trim()) return;

    const normalizedCode = connectionCode.trim().toUpperCase();
    setVerifying(true);
    setCodeError(null);
    try {
      if (isVisualQaEnabled()) {
        if (normalizedCode !== 'A8X2K9') {
          setVerifying(false);
          setConnectionModalStep(null);
          setConnectionFailure({ code: 'wrong_code' });
          setConnectionStatus('failed');
          return;
        }

        await addDesktop({
          desktopDeviceId: selectedDevice.deviceId,
          desktopName: selectedDevice.name,
          host: selectedDevice.ip,
          port: selectedDevice.port || 39393,
          authorizationStatus: 'authorized',
        });
        setVerifying(false);
        setConnectionModalStep(null);
        navigation.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [{ name: 'SyncActivity' }],
          }),
        );
        return;
      }

      await pairDevice({
        deviceId: selectedDevice.deviceId,
        host: selectedDevice.ip,
        port: selectedDevice.port || 39393,
        connectionCode: normalizedCode,
      });
      await addDesktop({
        desktopDeviceId: selectedDevice.deviceId,
        desktopName: selectedDevice.name,
        host: selectedDevice.ip,
        port: selectedDevice.port || 39393,
        authorizationStatus: 'authorized',
      });

      setVerifying(false);
      setConnectionModalStep(null);
      navigation.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [{ name: 'SyncActivity' }],
        }),
      );
    } catch (error: unknown) {
      const failure = normalizeConnectionFailure(error);
      setVerifying(false);
      setConnectionFailure(failure);
      if (failure.code === 'wrong_code') {
        setCodeError(getConnectionCodeErrorMessage(failure, t));
        return;
      }
      setConnectionModalStep(null);
      setConnectionStatus('failed');
    }
  }, [addDesktop, connectionCode, navigation, selectedDevice]);

  const handleRescan = useCallback(() => {
    setDevices([]);
    setScanning(true);
    setConnectionStatus('scanning');
    setConnectionFailure(null);
    if (isVisualQaEnabled()) {
      setTimeout(() => {
        setDevices(getVisualQaDevices());
        setScanning(false);
        setConnectionStatus('ready');
      }, 900);
      return;
    }
    try {
      const { NativeSyncEngine } = NativeModules;
      if (!NativeSyncEngine) {
        setTimeout(() => {
          setScanning(false);
          setConnectionStatus('empty');
        }, 8000);
        return;
      }
      NativeSyncEngine.stopDiscovery()
        .catch(() => undefined)
        .then(() => NativeSyncEngine.startDiscovery())
        .catch(() => undefined);
      setTimeout(() => {
        setScanning(false);
        if (devicesRef.current.length === 0) {
          setConnectionStatus('empty');
        }
      }, 8000);
    } catch {
      setScanning(false);
      setConnectionStatus('empty');
    }
  }, [getVisualQaDevices]);

  const connectionStateContent: FlowStateContent | null =
    !isShowingSkeleton && connectionStatus === 'empty'
      ? {
          title: t('deviceDiscovery.global.noDeviceTitle'),
          description: t('deviceDiscovery.global.noDeviceDesc'),
          actionLabel: t('deviceDiscovery.global.manualPairing'),
          icon: 'desktop-outline',
          tone: 'neutral',
          onAction: () => {
            setManualHost('');
            setManualError(null);
            setSelectedDevice(null);
            setConnectionModalStep('method');
          },
        }
      : !isShowingSkeleton && connectionStatus === 'permissionRequired'
      ? {
          title: t('deviceDiscovery.global.nearbyPermissionTitle'),
          description: t('deviceDiscovery.global.nearbyPermissionDesc'),
          actionLabel: t('deviceDiscovery.global.startScan'),
          icon: 'radio-outline',
          tone: 'neutral',
          onAction: handleRescan,
        }
      : !isShowingSkeleton && connectionStatus === 'failed'
      ? {
          ...getConnectionFailureCopy(connectionFailure, t),
          onAction: () => {
            if (connectionFailure?.code === 'version_incompatible') {
              handleRescan();
              return;
            }
            setConnectionCode('');
            setCodeError(null);
            setConnectionFailure(null);
            setConnectionStatus('ready');
            setConnectionModalStep('code');
          },
        }
      : !isShowingSkeleton && connectionStatus === 'timeout'
      ? {
          title: t('deviceDiscovery.global.connectTimeoutTitle'),
          description: t('deviceDiscovery.global.connectTimeoutDesc'),
          actionLabel: t('deviceDiscovery.global.rescan'),
          icon: 'time-outline',
          tone: 'warning',
          onAction: handleRescan,
        }
      : !isShowingSkeleton && connectionStatus === 'cameraDenied'
      ? {
          title: t('deviceDiscovery.global.cameraDeniedTitle'),
          description: t('deviceDiscovery.global.cameraDeniedDesc'),
          actionLabel: t('deviceDiscovery.global.inputCode'),
          icon: 'camera-outline',
          tone: 'warning',
          onAction: () => {
            setConnectionCode('');
            setCodeError(null);
            setConnectionModalStep(selectedDevice ? 'code' : 'method');
          },
        }
      : null;

  const activeConnectionModalStep =
    connectionModalStep === 'manualPair' ||
    connectionModalStep === 'method' ||
    connectionModalStep === 'cameraPermission' ||
    selectedDevice !== null
      ? connectionModalStep
      : null;

  const closeConnectionModal = useCallback(() => {
    if (verifying) return;
    setConnectionModalStep(null);
  }, [verifying]);

  const openScannerOrPermissionPrompt = useCallback(() => {
    if (Camera.getCameraPermissionStatus() === 'granted') {
      setConnectionModalStep(null);
      navigation.navigate('QRScanner');
      return;
    }

    setConnectionModalStep('cameraPermission');
  }, [navigation]);

  const dismissGuide = useCallback(async () => {
    await markUnconnectedGuideSeen();
    setShowGuide(false);
    setGuideStepIndex(0);
  }, []);

  const continuePreview = useCallback(() => {
    if (guideStepIndex < connectionFeatureGuideSteps.length - 1) {
      setGuideStepIndex(index =>
        Math.min(index + 1, connectionFeatureGuideSteps.length - 1),
      );
      return;
    }
    void dismissGuide();
  }, [dismissGuide, guideStepIndex, connectionFeatureGuideSteps]);

  return (
    <GlobalGradientBackground>
      <SafeAreaView style={styles.safeArea}>
        <View ref={containerRef} style={styles.container}>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {mode === 'switch' ? (
              <TouchableOpacity
                activeOpacity={0.76}
                accessibilityRole="button"
                accessibilityLabel={t('deviceDiscovery.global.back')}
                onPress={goBack}
                style={styles.backButton}
              >
                <Icon name="chevron-back" size={22} color="#42566E" />
              </TouchableOpacity>
            ) : null}

            <View style={styles.header}>
              <Text style={styles.title}>
                {mode === 'switch' ? t('deviceDiscovery.global.switchComputer') : t('deviceDiscovery.global.connectYourPC')}
              </Text>
              <Text style={styles.subtitle}>
                {t('deviceDiscovery.global.scanFirstText')}
              </Text>
            </View>

            {showPairingInvalidatedNotice ? (
              <FlowStateCard
                state={{
                  title: t('deviceDiscovery.global.pairingInvalidatedTitle'),
                  description: t(
                    'deviceDiscovery.global.pairingInvalidatedDesc',
                  ),
                  icon: 'key-outline',
                  tone: 'warning',
                }}
              />
            ) : null}

            <View
              ref={devicesCardRef}
              style={styles.devicesCard}
              onLayout={measureGuideTarget}
            >
              <View style={styles.devicesHeader}>
                <Text style={styles.devicesTitle}>{t('deviceDiscovery.global.lanDeviceTitle')}</Text>
                <View style={styles.statusPill}>
                  {scanning ? <PulseDot /> : null}
                  <Text style={styles.statusText}>{statusLabel}</Text>
                </View>
              </View>

              {isShowingSkeleton ? (
                <View style={styles.skeletonStack}>
                  {[0, 1, 2].map(item => (
                    <View key={item} style={styles.skeletonRow} />
                  ))}
                </View>
              ) : (
                <View style={styles.deviceStack}>
                  {connectionStateContent ? (
                    <FlowStateCard state={connectionStateContent} />
                  ) : null}
                  {!connectionStateContent
                    ? devices.map(device => {
                        const isCurrentDevice =
                          mode === 'switch' &&
                          device.deviceId === currentDeviceId;
                        const isKnownDevice =
                          mode === 'switch' &&
                          !isCurrentDevice &&
                          knownDeviceIds.has(device.deviceId);
                        return (
                          <DeviceRow
                            key={device.deviceId}
                            title={device.name}
                            subtitle={device.ip}
                            status={
                              isCurrentDevice
                                ? t('deviceDiscovery.switch.badge.current')
                                : isKnownDevice
                                ? t('deviceDiscovery.switch.badge.known')
                                : device.availability === 'busy'
                                ? t('deviceDiscovery.global.connectionStatus.busy')
                                : t('deviceDiscovery.global.connectionStatus.available')
                            }
                            iconName={
                              device.deviceKind === 'laptop'
                                ? 'laptop-outline'
                                : 'desktop-outline'
                            }
                            availability={device.availability ?? 'available'}
                            onPress={() => openDeviceCodeModal(device)}
                          />
                        );
                      })
                    : null}
                  {!connectionStateContent
                    ? displayedRecentDesktops.map(recent => {
                        const isCurrentDevice =
                          mode === 'switch' &&
                          recent.desktopDeviceId === currentDeviceId;
                        const isKnownDevice =
                          mode === 'switch' &&
                          !isCurrentDevice &&
                          knownDeviceIds.has(recent.desktopDeviceId);
                        return (
                          <DeviceRow
                            key={recent.desktopDeviceId}
                            title={recent.desktopName}
                            subtitle={`${recent.host}:${recent.port}`}
                            status={
                              isCurrentDevice
                                ? t('deviceDiscovery.switch.badge.current')
                                : isKnownDevice
                                ? t('deviceDiscovery.switch.badge.known')
                                : t('deviceDiscovery.global.connectionStatus.available')
                            }
                            iconName="desktop-outline"
                            availability="available"
                            onPress={() => openRecentDesktop(recent)}
                          />
                        );
                      })
                    : null}
                  <TouchableOpacity
                    activeOpacity={0.76}
                    style={styles.manualPairRow}
                    onPress={() => {
                      setSelectedDevice(null);
                      setManualHost('');
                      setManualError(null);
                      setConnectionFailure(null);
                      setConnectionModalStep('method');
                    }}
                  >
                    <View style={styles.rowIcon}>
                      <Icon name="link-outline" size={22} color="#1677D2" />
                    </View>
                    <View style={styles.rowCopy}>
                      <Text style={styles.rowTitle}>{t('deviceDiscovery.actions.manualPair')}</Text>
                      <Text style={styles.rowSubtitle}>
                        {t('deviceDiscovery.global.enterIPAndCode')}
                      </Text>
                    </View>
                    <Icon name="chevron-forward" size={18} color="#A1B6CF" />
                  </TouchableOpacity>
                </View>
              )}
            </View>

            {!scanning ? (
              <TouchableOpacity
                activeOpacity={0.76}
                style={styles.rescanButton}
                onPress={handleRescan}
              >
                <View style={styles.rescanButtonContent}>
                  <Icon name="refresh" size={16} color="#5A9ABF" />
                  <Text style={styles.rescanText}>{t('deviceDiscovery.actions.rescan')}</Text>
                </View>
              </TouchableOpacity>
            ) : null}

            <View style={styles.helpPanel}>
              <Text style={styles.helpTitle}>{t('deviceDiscovery.troubleshooting.notReadyTitle')}</Text>
              <Text style={styles.helpBody}>
                {t('deviceDiscovery.troubleshooting.notReadyDesc')}
              </Text>
            </View>
          </ScrollView>

          {showGuide ? (
            <ConnectionGuideOverlay
              step={connectionFeatureGuideSteps[guideStepIndex]}
              stepIndex={guideStepIndex}
              totalSteps={connectionFeatureGuideSteps.length}
              targetLayout={guideStepIndex === 0 ? spotlightLayout : null}
              bottomInset={insets.bottom}
              onSkip={() => void dismissGuide()}
              onNext={continuePreview}
            />
          ) : null}

          <ConnectionFlowModal
            step={activeConnectionModalStep}
            deviceName={selectedDevice?.name ?? ''}
            manualHost={manualHost}
            manualError={manualError}
            connectionCode={connectionCode}
            verifying={verifying}
            codeError={codeError}
            onClose={closeConnectionModal}
            onScan={openScannerOrPermissionPrompt}
            onCode={() => {
              setCodeError(null);
              setConnectionFailure(null);
              setConnectionModalStep('code');
            }}
            onManual={() => {
              setManualHost('');
              setManualError(null);
              setConnectionFailure(null);
              setConnectionModalStep('manualPair');
            }}
            onManualHostChange={value => {
              setManualHost(value);
              if (manualError) setManualError(null);
            }}
            onManualSubmit={handleManualPair}
            onDeny={() => {
              setConnectionModalStep(null);
              setConnectionStatus('cameraDenied');
            }}
            onAllow={() => {
              setConnectionModalStep(null);
              navigation.navigate('QRScanner');
            }}
            onChange={value => {
              setConnectionCode(value.toUpperCase());
              if (codeError) setCodeError(null);
            }}
            onSubmit={handleVerifyCode}
          />
        </View>
      </SafeAreaView>
    </GlobalGradientBackground>
  );
}

function DeviceRow({
  title,
  subtitle,
  status,
  iconName,
  availability,
  onPress,
}: {
  title: string;
  subtitle: string;
  status: string;
  iconName: string;
  availability: DeviceAvailability;
  onPress: () => void;
}) {
  const isBusy = availability === 'busy';
  return (
    <TouchableOpacity
      activeOpacity={0.76}
      style={styles.deviceRow}
      onPress={onPress}
    >
      <View style={styles.rowIcon}>
        <Icon name={iconName} size={22} color="#1677D2" />
      </View>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.rowSubtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <View style={[styles.deviceStatus, isBusy && styles.deviceStatusBusy]}>
        <Text
          style={[
            styles.deviceStatusText,
            isBusy && styles.deviceStatusTextBusy,
          ]}
        >
          {status}
        </Text>
      </View>
      <Icon name="chevron-forward" size={18} color="#9AA3AE" />
    </TouchableOpacity>
  );
}

function FlowStateCard({ state }: { state: FlowStateContent }) {
  const toneStyle =
    state.tone === 'danger'
      ? {
          icon: styles.flowIconDanger,
          iconColor: '#D94F4F',
          action: styles.flowActionDanger,
          actionText: styles.flowActionTextDanger,
        }
      : state.tone === 'warning'
      ? {
          icon: styles.flowIconWarning,
          iconColor: '#AD761D',
          action: styles.flowActionWarning,
          actionText: styles.flowActionTextWarning,
        }
      : {
          icon: styles.flowIconNeutral,
          iconColor: '#7B8490',
          action: styles.flowActionNeutral,
          actionText: styles.flowActionTextNeutral,
        };

  return (
    <View style={styles.flowStateCard}>
      <View style={[styles.flowStateIcon, toneStyle.icon]}>
        <Icon name={state.icon} size={20} color={toneStyle.iconColor} />
      </View>
      <View style={styles.flowStateCopy}>
        <View style={styles.flowStateTopRow}>
          <Text style={styles.flowStateTitle}>{state.title}</Text>
          {state.actionLabel && state.onAction ? (
            <TouchableOpacity
              activeOpacity={0.76}
              style={[styles.flowAction, toneStyle.action]}
              onPress={state.onAction}
            >
              <Text style={[styles.flowActionText, toneStyle.actionText]}>
                {state.actionLabel}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
        <Text style={styles.flowStateDescription}>{state.description}</Text>
      </View>
    </View>
  );
}

function ConnectionGuideOverlay({
  step,
  stepIndex,
  totalSteps,
  targetLayout,
  bottomInset,
  onSkip,
  onNext,
}: {
  step: ConnectionGuideStep;
  stepIndex: number;
  totalSteps: number;
  targetLayout: SpotlightLayout | null;
  bottomInset: number;
  onSkip: () => void;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  const { height: viewportHeight } = useWindowDimensions();
  const isSpotlightStep = step.previewKind === 'connect';
  const spotlightPadding = 10;
  const hole =
    isSpotlightStep && targetLayout
      ? {
          x: Math.max(8, targetLayout.x - spotlightPadding),
          y: Math.max(8, targetLayout.y - spotlightPadding),
          width: Math.max(0, targetLayout.width + spotlightPadding * 2),
          height: targetLayout.height + spotlightPadding * 2,
        }
      : null;
  const guideCardPosition = resolveConnectionGuideCardPosition({
    hole,
    viewportHeight,
    bottomInset,
  });

  return (
    <View pointerEvents="auto" style={styles.guideOverlay}>
      {hole ? (
        <Svg pointerEvents="none" style={StyleSheet.absoluteFillObject}>
          <Defs>
            <Mask id="global-connection-guide-spotlight">
              <Rect width="100%" height="100%" fill="white" />
              <Rect
                x={hole.x}
                y={hole.y}
                width={hole.width}
                height={hole.height}
                rx={18}
                ry={18}
                fill="black"
              />
            </Mask>
          </Defs>
          <Rect
            width="100%"
            height="100%"
            fill="rgba(14,31,52,0.36)"
            mask="url(#global-connection-guide-spotlight)"
          />
          <Rect
            x={hole.x - 2}
            y={hole.y - 2}
            width={hole.width + 4}
            height={hole.height + 4}
            rx={20}
            ry={20}
            fill="none"
            stroke="rgba(255,255,255,0.48)"
            strokeWidth={1.5}
          />
        </Svg>
      ) : (
        <View pointerEvents="none" style={styles.guideDimFill} />
      )}
      <View style={[styles.guideCard, guideCardPosition]}>
        <View pointerEvents="none" style={styles.guideCardSurface}>
          <NativeModalBlurView
            blurStyle="systemThinMaterialLight"
            fallbackColor="rgba(255,255,255,0.78)"
            intensity={0.42}
            style={StyleSheet.absoluteFillObject}
          />
          <View pointerEvents="none" style={styles.guideCardTint} />
        </View>
        <View style={styles.guideCardContent}>
          <View style={styles.guideProgressRow}>
            <View style={styles.guideDots}>
              {Array.from({ length: totalSteps }).map((_, index) => (
                <View
                  key={index}
                  style={[
                    styles.guideDot,
                    index === stepIndex && styles.guideDotActive,
                  ]}
                />
              ))}
            </View>
            <Text style={styles.guideStep}>
              {stepIndex + 1}/{totalSteps}
            </Text>
          </View>
          {isSpotlightStep ? null : (
            <GlobalConnectionFeaturePreviewCard kind={step.previewKind} />
          )}
          <Text style={styles.guideTitle}>{step.title}</Text>
          <Text style={styles.guideBody}>{step.description}</Text>
          <View style={styles.guideActions}>
            <TouchableOpacity
              accessible
              accessibilityRole="button"
              accessibilityLabel={t('deviceDiscovery.global.preview.skipGuide')}
              activeOpacity={0.76}
              style={styles.guideSkipButton}
              onPress={onSkip}
            >
              <Text style={styles.guideSkip}>{t('deviceDiscovery.global.preview.skipGuide')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessible
              accessibilityRole="button"
              accessibilityLabel={step.actionLabel}
              activeOpacity={0.82}
              style={styles.guideNext}
              onPress={onNext}
            >
              <Text style={styles.guideNextText}>{step.actionLabel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
}

function GlobalConnectionFeaturePreviewCard({
  kind,
}: {
  kind: ConnectionGuidePreviewKind;
}) {
  const { t } = useTranslation();
  if (kind === 'autoUpload') {
    return (
      <GuidePreviewShell>
        <View style={styles.guidePreviewHeader}>
          <View style={styles.guidePreviewTitleRow}>
            <View
              testID="guide-preview-auto-upload-icon"
              style={[styles.guidePreviewMiniIcon, styles.guidePreviewIconBlue]}
            >
              <Monitor size={16} color="#1677D2" strokeWidth={2} />
            </View>
            <View>
              <Text style={styles.guidePreviewStrong}>{t('deviceDiscovery.global.preview.autoUpload')}</Text>
              <Text style={styles.guidePreviewSubtle}>{t('deviceDiscovery.global.preview.disabled')}</Text>
            </View>
          </View>
          <View style={styles.guidePreviewPrimaryPill}>
            <Text style={styles.guidePreviewPrimaryPillText}>{t('deviceDiscovery.global.preview.enableAction')}</Text>
          </View>
        </View>
        <View style={styles.guidePreviewPanel}>
          <Text style={styles.guidePreviewPanelTitle}>{t('deviceDiscovery.global.preview.deviceStatus')}</Text>
          <Text style={styles.guidePreviewPanelValue}>{t('deviceDiscovery.global.preview.autoUploadDisabled')}</Text>
          <Text style={styles.guidePreviewPanelMeta}>{t('deviceDiscovery.global.preview.lastSyncNone')}</Text>
        </View>
      </GuidePreviewShell>
    );
  }

  if (kind === 'uploadScope') {
    return (
      <GuidePreviewShell>
        <View style={styles.guidePreviewPlanRow}>
          <View
            testID="guide-preview-sync-plan-icon"
            style={[styles.guidePreviewMiniIcon, styles.guidePreviewIconBlue]}
          >
            <CloudDownload size={16} color="#1677D2" strokeWidth={2} />
          </View>
          <View style={styles.guidePreviewFlex}>
            <Text style={styles.guidePreviewStrong}>{t('deviceDiscovery.global.preview.syncPlan')}</Text>
            <Text style={styles.guidePreviewSubtle} numberOfLines={1}>
              {t('deviceDiscovery.global.preview.syncPlanDesc')}
            </Text>
          </View>
        </View>
        <View style={styles.guidePreviewStatsRow}>
          <GuidePreviewStat label={t('deviceDiscovery.global.preview.statSource')} value="2" />
          <GuidePreviewStat label={t('deviceDiscovery.global.preview.statFiles')} value="3" />
          <GuidePreviewStat label={t('deviceDiscovery.global.preview.statScope')} value={t('deviceDiscovery.global.preview.statScopeAll')} />
        </View>
        <Text style={styles.guidePreviewSectionLabel}>{t('deviceDiscovery.global.preview.syncSource')}</Text>
        <GuidePreviewOption
          iconName="auto-upload-image"
          title={t('deviceDiscovery.global.preview.photosAndVideos')}
          description={t('deviceDiscovery.global.preview.photosAndVideosDesc')}
          active
        />
        <Text style={styles.guidePreviewSectionLabel}>{t('deviceDiscovery.global.preview.syncScope')}</Text>
        <GuidePreviewOption
          iconName="auto-upload-folder"
          title={t('deviceDiscovery.global.preview.statScopeAll')}
          description={t('deviceDiscovery.global.preview.allContentDesc')}
          active
        />
      </GuidePreviewShell>
    );
  }

  if (kind === 'syncProgress') {
    return (
      <GuidePreviewShell>
        <View style={styles.guidePreviewHeader}>
          <View style={styles.guidePreviewTitleRow}>
            <View
              testID="guide-preview-sync-progress-icon"
              style={[styles.guidePreviewMiniIcon, styles.guidePreviewIconBlue]}
            >
              <Monitor size={16} color="#1677D2" strokeWidth={2} />
            </View>
            <View>
              <Text style={styles.guidePreviewStrong}>{t('deviceDiscovery.global.preview.autoUpload')}</Text>
              <Text style={styles.guidePreviewSubtle}>{t('deviceDiscovery.global.preview.enabled')}</Text>
            </View>
          </View>
          <View style={styles.guidePreviewPrimaryPill}>
            <Text style={styles.guidePreviewPrimaryPillText}>{t('deviceDiscovery.global.preview.adjustAction')}</Text>
          </View>
        </View>
        <View style={styles.guidePreviewPanel}>
          <Text style={styles.guidePreviewPanelTitle}>{t('deviceDiscovery.global.preview.deviceStatus')}</Text>
          <Text style={styles.guidePreviewPanelValue}>
            {t('deviceDiscovery.global.preview.uploadedCount', { uploaded: 96, total: 128 })}
          </Text>
          <View style={styles.guidePreviewUploadCard}>
            <View style={styles.guidePreviewUploadHeader}>
              <Text style={styles.guidePreviewUploadTitle}>
                {t('deviceDiscovery.global.preview.uploadingProgress')}
              </Text>
              <Text style={styles.guidePreviewUploadPercent}>75%</Text>
            </View>
            <View style={styles.guidePreviewUploadTrack}>
              <View style={styles.guidePreviewUploadFill} />
            </View>
            <View style={styles.guidePreviewUploadGrid}>
              <GuidePreviewProgressStat label={t('deviceDiscovery.global.preview.speed')} value="68.5 MB/s" />
              <GuidePreviewProgressStat
                label={t('deviceDiscovery.global.preview.progress')}
                value="96 / 128"
                alignRight
              />
              <GuidePreviewProgressStat
                label={t('deviceDiscovery.global.preview.fileSize')}
                value="2.4 GB / 3.6 GB"
              />
              <GuidePreviewProgressStat
                label={t('deviceDiscovery.global.preview.remainingTime')}
                value={t('deviceDiscovery.global.preview.secondsVal', { seconds: 24 })}
                alignRight
              />
            </View>
          </View>
          <Text style={styles.guidePreviewPanelMeta}>{t('deviceDiscovery.global.preview.lastSyncNone')}</Text>
        </View>
      </GuidePreviewShell>
    );
  }

  if (kind === 'records') {
    return (
      <GuidePreviewShell>
        <View style={styles.guidePreviewHeader}>
          <View style={styles.guidePreviewTitleRow}>
            <View
              testID="guide-preview-records-download-icon"
              style={[styles.guidePreviewMiniIcon, styles.guidePreviewIconBlue]}
            >
              <Download size={16} color="#1677D2" strokeWidth={2} />
            </View>
            <Text style={styles.guidePreviewStrong}>{t('deviceDiscovery.global.preview.recentDownload')}</Text>
          </View>
          <Text style={styles.guidePreviewLink}>{t('deviceDiscovery.global.preview.viewAll')}</Text>
        </View>
        <View style={styles.guidePreviewDownloadRow}>
          {[
            { icon: FileText, label: t('deviceDiscovery.global.preview.demoFileName1'), testID: 'file' },
            { icon: FileVideo, label: t('deviceDiscovery.global.preview.demoFileName2'), testID: 'video' },
            { icon: FileText, label: t('deviceDiscovery.global.preview.demoFileName3'), testID: 'document' },
          ].map(({ icon: PreviewIcon, label, testID }) => (
            <View key={label} style={styles.guidePreviewDownloadItem}>
              <View testID={`guide-preview-download-${testID}-icon`}>
                <PreviewIcon size={15} color="#315E8C" strokeWidth={2} />
              </View>
              <Text style={styles.guidePreviewDownloadLabel} numberOfLines={1}>
                {label}
              </Text>
            </View>
          ))}
        </View>
        <View style={styles.guidePreviewCompactRecord}>
          <View>
            <Text style={styles.guidePreviewStrong}>{t('deviceDiscovery.global.preview.syncRecords')}</Text>
            <Text style={styles.guidePreviewSubtle}>
              {t('deviceDiscovery.global.preview.todayStat')}
            </Text>
          </View>
          <View style={styles.guidePreviewCompletedPill}>
            <Text style={styles.guidePreviewCompletedText}>{t('deviceDiscovery.global.preview.completed')}</Text>
          </View>
        </View>
      </GuidePreviewShell>
    );
  }

  if (kind === 'remoteResources') {
    return (
      <GuidePreviewShell>
        <GuidePreviewResourceEntry
          icon={Smartphone}
          iconStyle={styles.guidePreviewIconBlue}
          iconColor="#3B82F6"
          testID="guide-preview-phone-sync-icon"
          title={t('deviceDiscovery.global.preview.syncSpaceTitle')}
          description={t('deviceDiscovery.global.preview.syncSpaceDesc')}
          badges={[
            t('deviceDiscovery.global.preview.syncSpaceBadge1'),
            t('deviceDiscovery.global.preview.syncSpaceBadge2'),
          ]}
        />
        <GuidePreviewResourceEntry
          icon={Monitor}
          iconStyle={styles.guidePreviewIconPurple}
          iconColor="#8B5CF6"
          testID="guide-preview-remote-access-icon"
          title={t('deviceDiscovery.global.preview.remoteAccessTitle')}
          description={t('deviceDiscovery.global.preview.remoteAccessDesc')}
          badges={[
            t('deviceDiscovery.global.preview.remoteAccessBadge1'),
            t('deviceDiscovery.global.preview.remoteAccessBadge2'),
          ]}
        />
      </GuidePreviewShell>
    );
  }

  return null;
}

function GuidePreviewShell({ children }: { children: React.ReactNode }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={styles.guidePreviewCard}
    >
      {children}
    </View>
  );
}

function GuidePreviewStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.guidePreviewStat}>
      <Text style={styles.guidePreviewStatLabel}>{label}</Text>
      <Text style={styles.guidePreviewStatValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function GuidePreviewProgressStat({
  label,
  value,
  alignRight,
}: {
  label: string;
  value: string;
  alignRight?: boolean;
}) {
  return (
    <View
      style={[
        styles.guidePreviewProgressStat,
        alignRight && styles.guidePreviewProgressStatRight,
      ]}
    >
      <Text style={styles.guidePreviewProgressLabel}>{label}</Text>
      <Text style={styles.guidePreviewProgressValue}>{value}</Text>
    </View>
  );
}

function GuidePreviewOption({
  iconName,
  title,
  description,
  active,
}: {
  iconName: string;
  title: string;
  description: string;
  active?: boolean;
}) {
  return (
    <View
      style={[
        styles.guidePreviewOption,
        active && styles.guidePreviewOptionActive,
      ]}
    >
      <View
        style={[
          styles.guidePreviewMiniIcon,
          active
            ? styles.guidePreviewIconBlueSolid
            : styles.guidePreviewIconMuted,
        ]}
      >
        <Icon
          name={iconName}
          size={15}
          color={active ? '#FFFFFF' : '#8AABBD'}
        />
      </View>
      <View style={styles.guidePreviewFlex}>
        <Text style={styles.guidePreviewOptionTitle}>{title}</Text>
        <Text style={styles.guidePreviewSubtle} numberOfLines={1}>
          {description}
        </Text>
      </View>
      {active ? (
        <View style={styles.guidePreviewCheck}>
          <Check
            testID="guide-preview-option-check-icon"
            size={9}
            color="#FFFFFF"
            strokeWidth={2.8}
          />
        </View>
      ) : null}
    </View>
  );
}

function GuidePreviewResourceEntry({
  icon: ResourceIcon,
  iconStyle,
  iconColor,
  testID,
  title,
  description,
  badges,
}: {
  icon: GuidePreviewIconComponent;
  iconStyle: object;
  iconColor: string;
  testID: string;
  title: string;
  description: string;
  badges: string[];
}) {
  return (
    <View style={styles.guidePreviewResourceEntry}>
      <View
        testID={testID}
        style={[styles.guidePreviewResourceIcon, iconStyle]}
      >
        <ResourceIcon size={17} color={iconColor} strokeWidth={2} />
      </View>
      <View style={styles.guidePreviewFlex}>
        <Text style={styles.guidePreviewOptionTitle}>{title}</Text>
        <Text style={styles.guidePreviewSubtle} numberOfLines={1}>
          {description}
        </Text>
        <View style={styles.guidePreviewBadgeRow}>
          {badges.map(badge => (
            <View key={badge} style={styles.guidePreviewBadge}>
              <Text style={styles.guidePreviewBadgeText}>{badge}</Text>
            </View>
          ))}
        </View>
      </View>
      <ChevronRight
        testID="guide-preview-resource-chevron-icon"
        size={14}
        color="#C7C7CC"
        strokeWidth={2}
      />
    </View>
  );
}

function ConnectionFlowModal({
  step,
  deviceName,
  manualHost,
  manualError,
  connectionCode,
  verifying,
  codeError,
  onClose,
  onScan,
  onCode,
  onManual,
  onManualHostChange,
  onManualSubmit,
  onDeny,
  onAllow,
  onChange,
  onSubmit,
}: {
  step: ConnectionModalStep | null;
  deviceName: string;
  manualHost: string;
  manualError: string | null;
  connectionCode: string;
  verifying: boolean;
  codeError: string | null;
  onClose: () => void;
  onScan: () => void;
  onCode: () => void;
  onManual: () => void;
  onManualHostChange: (value: string) => void;
  onManualSubmit: () => void;
  onDeny: () => void;
  onAllow: () => void;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();
  if (!step) return null;

  const keyboardEnabled = step === 'manualPair' || step === 'code';
  let content: React.ReactNode;

  if (step === 'method') {
    const isManualPairing = !deviceName;
    content = (
      <>
        <View style={styles.modalHeader}>
          <View style={styles.modalIconBlue}>
            <Icon name="desktop-outline" size={22} color="#1677D2" />
          </View>
          <View style={styles.modalTitleStack}>
            <Text style={styles.modalTitle}>
              {isManualPairing ? t('deviceDiscovery.global.manualPairing') : t('deviceDiscovery.global.selectMethod')}
            </Text>
            <Text style={styles.modalSubtitle}>
              {isManualPairing
                ? t('deviceDiscovery.global.manualPairingDesc')
                : t('deviceDiscovery.connectionMethod.selected', { name: deviceName })}
            </Text>
          </View>
        </View>
        <TouchableOpacity
          activeOpacity={0.78}
          style={styles.optionRow}
          onPress={onScan}
        >
          <View style={styles.optionIconBlue}>
            <Icon name="scan-outline" size={20} color="#1677D2" />
          </View>
          <View style={styles.optionCopy}>
            <Text style={styles.optionTitle}>{t('deviceDiscovery.actions.qrPair')}</Text>
            <Text style={styles.optionBody}>
              {t('deviceDiscovery.connectionMethod.qrDesc', { name: deviceName || t('deviceDiscovery.global.findPC') })}
            </Text>
          </View>
          <Icon name="chevron-forward" size={18} color="#9AA3AE" />
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.78}
          style={styles.optionRow}
          onPress={isManualPairing ? onManual : onCode}
        >
          <View style={styles.optionIconPurple}>
            <Icon
              name={isManualPairing ? 'create-outline' : 'link-outline'}
              size={20}
              color="#746AA8"
            />
          </View>
          <View style={styles.optionCopy}>
            <Text style={styles.optionTitle}>
              {isManualPairing ? t('deviceDiscovery.global.manualIP') : t('deviceDiscovery.connectionMethod.codeTitle')}
            </Text>
            <Text style={styles.optionBody}>
              {isManualPairing
                ? t('deviceDiscovery.global.enterIPAndCode')
                : t('deviceDiscovery.connectionMethod.codeDesc', { name: deviceName })}
            </Text>
          </View>
          <Icon name="chevron-forward" size={18} color="#9AA3AE" />
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.76}
          style={styles.modalCancel}
          onPress={onClose}
        >
          <Text style={styles.modalCancelText}>{t('deviceDiscovery.global.cancel')}</Text>
        </TouchableOpacity>
      </>
    );
  } else if (step === 'manualPair') {
    content = (
      <>
        <View style={styles.modalHeader}>
          <View style={styles.modalIconPurple}>
            <Icon name="link-outline" size={22} color="#746AA8" />
          </View>
          <View style={styles.modalTitleStack}>
            <Text style={styles.modalTitle}>{t('deviceDiscovery.global.manualPairing')}</Text>
            <Text style={styles.modalSubtitle}>
              {t('deviceDiscovery.global.manualIPHint')}
            </Text>
          </View>
        </View>
        <TextInput
          value={manualHost}
          onChangeText={onManualHostChange}
          placeholder="192.168.31.21"
          placeholderTextColor="#A8B6C6"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="decimal-pad"
          style={[styles.textInput, manualError && styles.textInputError]}
          onSubmitEditing={onManualSubmit}
        />
        <Text style={manualError ? styles.errorText : styles.inputHint}>
          {manualError ||
            t('deviceDiscovery.global.viewSettingsHint')}
        </Text>
        <View style={styles.modalActions}>
          <TouchableOpacity
            activeOpacity={0.76}
            style={styles.secondaryAction}
            onPress={onClose}
          >
            <Text style={styles.secondaryActionText}>{t('deviceDiscovery.global.cancel')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.82}
            style={styles.primaryAction}
            onPress={onManualSubmit}
          >
            <Text style={styles.primaryActionText}>{t('deviceDiscovery.global.onboarding.step2Action')}</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  } else if (step === 'cameraPermission') {
    content = (
      <>
        <View style={styles.modalHeader}>
          <View style={styles.modalIconBlue}>
            <Icon name="scan-outline" size={22} color="#1677D2" />
          </View>
          <View style={styles.modalTitleStack}>
            <Text style={styles.modalTitle}>{t('deviceDiscovery.global.cameraAccessTitle')}</Text>
            <Text style={styles.modalSubtitle}>
              {t('deviceDiscovery.global.cameraAccessDesc')}
            </Text>
          </View>
        </View>
        <View style={styles.modalActions}>
          <TouchableOpacity
            activeOpacity={0.76}
            style={styles.secondaryAction}
            onPress={onDeny}
          >
            <Text style={styles.secondaryActionText}>{t('deviceDiscovery.global.deny')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.82}
            style={styles.primaryAction}
            onPress={onAllow}
          >
            <Text style={styles.primaryActionText}>{t('deviceDiscovery.global.allow')}</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  } else {
    content = (
      <>
        <View style={styles.modalHeader}>
          <View style={styles.modalIconPurple}>
            <Icon name="link-outline" size={22} color="#746AA8" />
          </View>
          <View style={styles.modalTitleStack}>
            <Text style={styles.modalTitle}>{t('deviceDiscovery.global.enterCodeTitle')}</Text>
            <Text style={styles.modalSubtitle}>
              {t('deviceDiscovery.global.enterCodeDesc', { deviceName: deviceName || t('deviceDiscovery.global.lanDeviceTitle') })}
            </Text>
          </View>
        </View>
        <TextInput
          value={connectionCode}
          onChangeText={onChange}
          placeholder={t('deviceDiscovery.global.pairingCodePlaceholder')}
          placeholderTextColor="#A8B6C6"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={6}
          editable={!verifying}
          style={styles.codeInput}
          onSubmitEditing={onSubmit}
        />
        {verifying ? (
          <View style={styles.verifyingRow}>
            <ActivityIndicator size="small" color="#1677D2" />
            <Text style={styles.verifyingText}>{t('deviceDiscovery.global.verifyingCode')}</Text>
          </View>
        ) : null}
        {codeError ? <Text style={styles.errorText}>{codeError}</Text> : null}
        <View style={styles.modalActions}>
          <TouchableOpacity
            activeOpacity={0.76}
            style={styles.secondaryAction}
            onPress={onClose}
          >
            <Text style={styles.secondaryActionText}>{t('deviceDiscovery.global.cancel')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.82}
            disabled={verifying || !connectionCode.trim()}
            style={[
              styles.primaryAction,
              (verifying || !connectionCode.trim()) && styles.disabledAction,
            ]}
            onPress={onSubmit}
          >
            <Text style={styles.primaryActionText}>{t('deviceDiscovery.global.connect')}</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <ModalBlurBackdrop />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          enabled={keyboardEnabled}
          style={styles.keyboardModal}
        >
          <Pressable style={styles.modalCard} onPress={() => undefined}>
            {content}
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  container: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 32,
    paddingBottom: 42,
  },
  backButton: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.42)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.62)',
    shadowColor: '#46608A',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 2,
    ...androidBoxShadow({
      offsetY: 12,
      blurRadius: 24,
      color: 'rgba(70, 96, 138, 0.08)',
    }),
  },
  header: {
    marginTop: 24,
  },
  title: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '700',
    color: '#17191C',
  },
  subtitle: {
    marginTop: 10,
    fontSize: 13,
    lineHeight: 24,
    color: '#59616D',
  },
  devicesCard: {
    marginTop: 24,
    borderRadius: 28,
    paddingHorizontal: 18,
    paddingVertical: 18,
    backgroundColor: 'rgba(255,255,255,0.82)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.72)',
    shadowColor: '#46608A',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.12,
    shadowRadius: 42,
    elevation: 5,
    ...androidBoxShadow({
      offsetY: 18,
      blurRadius: 42,
      color: 'rgba(70, 96, 138, 0.12)',
    }),
  },
  devicesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  devicesTitle: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    color: '#17191C',
  },
  statusPill: {
    minHeight: 30,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.72)',
    backgroundColor: 'rgba(255,255,255,0.58)',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusText: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '600',
    color: '#59616D',
  },
  scanDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#1677D2',
  },
  skeletonStack: {
    marginTop: 16,
    gap: 12,
  },
  skeletonRow: {
    height: 66,
    borderRadius: 18,
    backgroundColor: '#EDF4FB',
  },
  deviceStack: {
    marginTop: 16,
    gap: 12,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    backgroundColor: 'rgba(255,255,255,0.6)',
    paddingHorizontal: 14,
    paddingVertical: 14,
    shadowColor: '#46608A',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 2,
    ...androidBoxShadow({
      offsetY: 10,
      blurRadius: 24,
      color: 'rgba(70, 96, 138, 0.08)',
    }),
  },
  manualPairRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#B8DFFF',
    backgroundColor: 'rgba(247,251,255,0.72)',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  rowIcon: {
    width: 44,
    height: 44,
    borderRadius: 13,
    backgroundColor: '#E4F5FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
    color: '#17191C',
  },
  rowSubtitle: {
    marginTop: 4,
    fontSize: 10,
    lineHeight: 18,
    color: '#59616D',
  },
  deviceStatus: {
    borderRadius: 999,
    backgroundColor: '#E8F7ED',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  deviceStatusBusy: {
    backgroundColor: '#FFF3E8',
  },
  deviceStatusText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#21A453',
  },
  deviceStatusTextBusy: {
    color: '#D7832F',
  },
  rescanButton: {
    marginTop: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    backgroundColor: 'rgba(255,255,255,0.55)',
    paddingVertical: 14,
    alignItems: 'center',
  },
  rescanButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rescanText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '500',
    color: '#1677D2',
  },
  helpPanel: {
    marginTop: 20,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: 'rgba(255,255,255,0.54)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.68)',
  },
  helpTitle: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
    color: '#17191C',
  },
  helpBody: {
    marginTop: 8,
    fontSize: 10,
    lineHeight: 20,
    color: '#59616D',
  },
  flowStateCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: 'rgba(255,255,255,0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    shadowColor: '#46608A',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 34,
    elevation: 2,
    ...androidBoxShadow({
      offsetY: 12,
      blurRadius: 34,
      color: 'rgba(70, 96, 138, 0.08)',
    }),
  },
  flowStateIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flowIconNeutral: {
    backgroundColor: 'rgba(255,255,255,0.72)',
  },
  flowIconDanger: {
    backgroundColor: '#FFF0F0',
  },
  flowIconWarning: {
    backgroundColor: '#FFF6D8',
  },
  flowStateCopy: {
    flex: 1,
    minWidth: 0,
  },
  flowStateTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  flowStateTitle: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    color: '#17191C',
  },
  flowStateDescription: {
    marginTop: 6,
    fontSize: 11,
    lineHeight: 20,
    color: '#59616D',
  },
  flowAction: {
    flexShrink: 0,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  flowActionNeutral: {
    backgroundColor: 'rgba(255,255,255,0.64)',
  },
  flowActionDanger: {
    backgroundColor: '#FFF0F0',
  },
  flowActionWarning: {
    backgroundColor: '#FFF5E0',
  },
  flowActionText: {
    fontSize: 9,
    lineHeight: 13,
    fontWeight: '700',
  },
  flowActionTextNeutral: {
    color: '#7B8490',
  },
  flowActionTextDanger: {
    color: '#D94F4F',
  },
  flowActionTextWarning: {
    color: '#B7791F',
  },
  guideOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 80,
    overflow: 'hidden',
  },
  guideDimFill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(14,31,52,0.36)',
  },
  guideCard: {
    borderRadius: 18,
    shadowColor: '#46608A',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.18,
    shadowRadius: 50,
    elevation: 8,
    ...androidBoxShadow({
      offsetY: 18,
      blurRadius: 50,
      color: 'rgba(70, 96, 138, 0.18)',
    }),
  },
  guideCardSurface: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    backgroundColor: 'rgba(255,255,255,0.7)',
  },
  guideCardTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.58)',
  },
  guideCardContent: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  guideProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  guideDots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  guideDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#C9DAEE',
  },
  guideDotActive: {
    width: 20,
    backgroundColor: '#357CFF',
  },
  guideStep: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '500',
    color: '#7D97B5',
  },
  guideTitle: {
    marginTop: 12,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    color: '#1C365A',
  },
  guideBody: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 24,
    color: '#6E8CAD',
  },
  guidePreviewCard: {
    marginTop: 12,
    marginBottom: 2,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.72)',
    backgroundColor: 'rgba(247,251,255,0.72)',
    padding: 12,
    gap: 9,
    shadowColor: '#46608A',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 3,
    ...androidBoxShadow({
      offsetY: 10,
      blurRadius: 24,
      color: 'rgba(70, 96, 138, 0.08)',
    }),
  },
  guidePreviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  guidePreviewTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  guidePreviewFlex: {
    flex: 1,
    minWidth: 0,
  },
  guidePreviewMiniIcon: {
    width: 32,
    height: 32,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guidePreviewIconBlue: {
    backgroundColor: '#E8F4FF',
  },
  guidePreviewIconBlueSolid: {
    backgroundColor: '#3B9FD8',
  },
  guidePreviewIconMuted: {
    backgroundColor: '#EEF3FA',
  },
  guidePreviewIconPurple: {
    backgroundColor: '#F0EDFF',
  },
  guidePreviewStrong: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: '#203D63',
  },
  guidePreviewSubtle: {
    marginTop: 2,
    fontSize: 9,
    lineHeight: 13,
    color: '#6E8CAD',
  },
  guidePreviewPrimaryPill: {
    borderRadius: 999,
    backgroundColor: '#DBEAFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  guidePreviewPrimaryPillText: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '700',
    color: '#357CFF',
  },
  guidePreviewPanel: {
    borderRadius: 13,
    backgroundColor: 'rgba(232,244,255,0.74)',
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  guidePreviewPanelTitle: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
    color: '#203D63',
  },
  guidePreviewPanelValue: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: '#1677D2',
  },
  guidePreviewPanelMeta: {
    marginTop: 2,
    fontSize: 9,
    lineHeight: 13,
    color: '#7D97B5',
  },
  guidePreviewUploadCard: {
    marginTop: 9,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.72)',
    backgroundColor: 'rgba(255,255,255,0.54)',
    paddingHorizontal: 9,
    paddingVertical: 9,
  },
  guidePreviewUploadHeader: {
    marginBottom: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  guidePreviewUploadTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 8,
    lineHeight: 11,
    fontWeight: '600',
    color: '#59616D',
  },
  guidePreviewUploadPercent: {
    fontSize: 8,
    lineHeight: 11,
    fontWeight: '700',
    color: '#59616D',
  },
  guidePreviewUploadTrack: {
    height: 6,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: '#DCE9F5',
  },
  guidePreviewUploadFill: {
    width: '75%',
    height: 6,
    borderRadius: 999,
    backgroundColor: '#1677D2',
  },
  guidePreviewUploadGrid: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 9,
  },
  guidePreviewProgressStat: {
    width: '50%',
    minWidth: 0,
  },
  guidePreviewProgressStatRight: {
    alignItems: 'flex-end',
  },
  guidePreviewProgressLabel: {
    fontSize: 8,
    lineHeight: 11,
    color: '#9AB0C6',
  },
  guidePreviewProgressValue: {
    marginTop: 3,
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '700',
    color: '#17191C',
  },
  guidePreviewPlanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  guidePreviewStatsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  guidePreviewStat: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.72)',
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  guidePreviewStatLabel: {
    fontSize: 8,
    lineHeight: 11,
    color: '#7D97B5',
  },
  guidePreviewStatValue: {
    marginTop: 2,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '700',
    color: '#203D63',
  },
  guidePreviewSectionLabel: {
    marginTop: 1,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
    color: '#203D63',
  },
  guidePreviewOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.64)',
    paddingHorizontal: 9,
    paddingVertical: 8,
  },
  guidePreviewOptionActive: {
    backgroundColor: 'rgba(232,244,255,0.8)',
  },
  guidePreviewOptionTitle: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
    color: '#203D63',
  },
  guidePreviewCheck: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#3B9FD8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  guidePreviewDayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  guidePreviewDay: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
    color: '#3E6F9E',
  },
  guidePreviewDayStats: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
    color: '#9CB6D2',
  },
  guidePreviewRecordCard: {
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.82)',
    padding: 10,
  },
  guidePreviewRecordHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  guidePreviewRecordTitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: '#203D63',
  },
  guidePreviewSyncingPill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    backgroundColor: '#DBEAFF',
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  guidePreviewSyncingText: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '700',
    color: '#357CFF',
  },
  guidePreviewCompletedPill: {
    alignSelf: 'center',
    borderRadius: 999,
    backgroundColor: '#E8F7ED',
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  guidePreviewCompletedText: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '700',
    color: '#21A453',
  },
  guidePreviewLink: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
    color: '#357CFF',
  },
  guidePreviewDownloadRow: {
    flexDirection: 'row',
    gap: 8,
  },
  guidePreviewDownloadItem: {
    flex: 1,
    minWidth: 0,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.72)',
    paddingHorizontal: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  guidePreviewDownloadLabel: {
    marginTop: 5,
    fontSize: 8,
    lineHeight: 11,
    fontWeight: '700',
    color: '#315E8C',
    textAlign: 'center',
  },
  guidePreviewCompactRecord: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.7)',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  guidePreviewResourceEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.72)',
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  guidePreviewResourceIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guidePreviewBadgeRow: {
    marginTop: 5,
    flexDirection: 'row',
    gap: 5,
  },
  guidePreviewBadge: {
    borderRadius: 999,
    backgroundColor: '#EEF3FA',
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  guidePreviewBadgeText: {
    fontSize: 8,
    lineHeight: 10,
    fontWeight: '700',
    color: '#6E8CAD',
  },
  guideActions: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  guideSkipButton: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  guideSkip: {
    fontSize: 13,
    fontWeight: '500',
    color: '#8DA5BF',
  },
  guideNext: {
    minHeight: 36,
    borderRadius: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1677D2',
    shadowColor: '#1677D2',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.18,
    shadowRadius: 28,
    elevation: 6,
  },
  guideNextText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  keyboardModal: {
    width: '100%',
  },
  modalCard: {
    width: '100%',
    maxWidth: 336,
    alignSelf: 'center',
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 20,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.68)',
    shadowColor: '#173D58',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 28,
    elevation: 10,
    ...androidBoxShadow({
      offsetY: 12,
      blurRadius: 28,
      color: 'rgba(23, 61, 88, 0.18)',
    }),
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 16,
  },
  modalIconBlue: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E4F5FF',
  },
  modalIconPurple: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EEEAFB',
  },
  modalTitleStack: {
    flex: 1,
    minWidth: 0,
  },
  modalTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '700',
    color: '#17191C',
  },
  modalSubtitle: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 20,
    color: '#59616D',
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    backgroundColor: 'rgba(255,255,255,0.56)',
    padding: 14,
    marginBottom: 12,
  },
  optionIconBlue: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E4F5FF',
  },
  optionIconPurple: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EEEAFB',
  },
  optionCopy: {
    flex: 1,
    minWidth: 0,
  },
  optionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#17191C',
  },
  optionBody: {
    marginTop: 4,
    fontSize: 11,
    lineHeight: 18,
    color: '#59616D',
  },
  modalCancel: {
    marginTop: 2,
    minHeight: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EEF5FC',
    borderWidth: 1,
    borderColor: '#DDE8F4',
  },
  modalCancelText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1677D2',
  },
  textInput: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#DDE8F4',
    backgroundColor: 'rgba(255,255,255,0.96)',
    paddingHorizontal: 16,
    color: '#17191C',
    fontSize: 16,
  },
  codeInput: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#DDE8F4',
    backgroundColor: 'rgba(255,255,255,0.96)',
    paddingHorizontal: 16,
    color: '#17191C',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 2,
  },
  textInputError: {
    borderColor: '#DB6B6B',
  },
  inputHint: {
    marginTop: 10,
    fontSize: 11,
    lineHeight: 18,
    color: '#59616D',
  },
  errorText: {
    marginTop: 10,
    fontSize: 12,
    lineHeight: 18,
    color: '#D14C4C',
  },
  modalActions: {
    marginTop: 18,
    flexDirection: 'row',
    gap: 12,
  },
  secondaryAction: {
    flex: 0.78,
    minHeight: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EEF5FC',
    borderWidth: 1,
    borderColor: '#DDE8F4',
  },
  secondaryActionText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1677D2',
  },
  primaryAction: {
    flex: 1,
    minHeight: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1677D2',
  },
  disabledAction: {
    backgroundColor: '#A8B6CC',
  },
  primaryActionText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  verifyingRow: {
    marginTop: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  verifyingText: {
    fontSize: 12,
    color: '#59616D',
  },
});
