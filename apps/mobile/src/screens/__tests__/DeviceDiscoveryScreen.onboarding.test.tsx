import React from 'react';
import {
  Alert,
  NativeEventEmitter,
  NativeModules,
  Platform,
} from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockDispatch = jest.fn();
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockCanGoBack = jest.fn(() => false);
const mockHasSeenUnconnectedGuide = jest.fn().mockResolvedValue(false);
const mockMarkUnconnectedGuideSeen = jest.fn().mockResolvedValue(undefined);
const mockIsVisualQaEnabled = jest.fn(() => false);
const mockAddDesktop = jest.fn().mockResolvedValue(undefined);
const mockForgetDesktop = jest.fn().mockResolvedValue(undefined);
const mockUpdateAuthStatus = jest.fn().mockResolvedValue(undefined);
const mockGetBindingState = jest.fn().mockResolvedValue(null);
const mockGetKnownDeviceIds = jest.fn().mockResolvedValue([]);
let mockRouteParams:
  | { mode?: 'initial' | 'switch'; reason?: 'pairing_invalidated' }
  | undefined = {
  mode: 'initial',
};

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    canGoBack: mockCanGoBack,
    goBack: mockGoBack,
    navigate: mockNavigate,
    dispatch: mockDispatch,
  }),
  useRoute: () => ({
    params: mockRouteParams,
  }),
  CommonActions: {
    reset: jest.fn(payload => ({ type: 'RESET', payload })),
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('react-i18next', () => {
  const en = {
    deviceDiscovery: require('../../i18n/locales/en/deviceDiscovery.json'),
    common: require('../../i18n/locales/en/common.json'),
    errors: require('../../i18n/locales/en/errors.json'),
  };
  return {
    useTranslation: () => ({
      i18n: {
        language: 'en',
        resolvedLanguage: 'en',
      },
      t: (key: string, options?: any) => {
        const parts = key.split('.');
        let current: any = en;
        for (const part of parts) {
          if (current == null) return key;
          current = current[part];
        }
        if (typeof current === 'string') {
          if (options) {
            let res = current;
            for (const k of Object.keys(options)) {
              res = res.replace(
                new RegExp(`\\{\\{${k}\\}\\}`, 'g'),
                options[k],
              );
            }
            return res;
          }
          return current;
        }
        return key;
      },
    }),
  };
});

jest.mock('react-native-svg', () => {
  const ReactInner = require('react');
  const { View } = require('react-native');
  const createSvgMock =
    (name: string) =>
    ({ children, ...props }: { children?: React.ReactNode }) =>
      ReactInner.createElement(View, { ...props, mockSvgType: name }, children);

  return {
    __esModule: true,
    default: createSvgMock('Svg'),
    Svg: createSvgMock('Svg'),
    Circle: createSvgMock('Circle'),
    ClipPath: createSvgMock('ClipPath'),
    Defs: createSvgMock('Defs'),
    Ellipse: createSvgMock('Ellipse'),
    G: createSvgMock('G'),
    Line: createSvgMock('Line'),
    LinearGradient: createSvgMock('LinearGradient'),
    Mask: createSvgMock('Mask'),
    Path: createSvgMock('Path'),
    Polygon: createSvgMock('Polygon'),
    Polyline: createSvgMock('Polyline'),
    Rect: createSvgMock('Rect'),
    Stop: createSvgMock('Stop'),
  };
});

jest.mock('../../components/GradientBackground', () => ({
  GradientBackground: ({ children }: { children: React.ReactNode }) => {
    const ReactInner = require('react');
    const { View } = require('react-native');
    return ReactInner.createElement(View, null, children);
  },
}));

jest.mock('../../components/Icon', () => ({
  Icon: ({ name }: { name: string }) => {
    const ReactInner = require('react');
    const { Text } = require('react-native');
    return ReactInner.createElement(Text, null, name);
  },
}));

jest.mock('../../components/shared/NativeModalBlurView', () => ({
  NativeModalBlurView: ({
    children,
    style,
  }: {
    children?: React.ReactNode;
    style?: object;
  }) => {
    const ReactInner = require('react');
    const { View } = require('react-native');
    return ReactInner.createElement(View, { style }, children);
  },
}));

jest.mock('../../components/shared/ModalBlurBackdrop', () => ({
  ModalBlurBackdrop: () => {
    const ReactInner = require('react');
    const { View } = require('react-native');
    return ReactInner.createElement(View);
  },
}));

jest.mock('../../utils/onboardingStorage', () => ({
  hasSeenUnconnectedGuide: () => mockHasSeenUnconnectedGuide(),
  markUnconnectedGuideSeen: () => mockMarkUnconnectedGuideSeen(),
}));

jest.mock('../../stores/recent-desktops-store', () => ({
  useRecentDesktops: () => ({
    recentDesktops: [
      {
        desktopDeviceId: 'studio-mac',
        desktopName: 'Studio Mac',
        host: '192.168.31.8',
        port: 39393,
        authorizationStatus: 'authorized',
      },
    ],
    isLoading: false,
    addDesktop: mockAddDesktop,
    forgetDesktop: mockForgetDesktop,
    updateAuthStatus: mockUpdateAuthStatus,
  }),
}));

jest.mock('../../dev/visualQa', () => ({
  isVisualQaEnabled: () => mockIsVisualQaEnabled(),
}));

jest.mock('../../services/SyncEngineModule', () => {
  class MockPairingError extends Error {
    code: 'wrong_code' | 'blocked' | 'version_incompatible' | 'unknown';
    remainingAttempts?: number;
    blocked?: boolean;

    constructor(
      message: string,
      code: 'wrong_code' | 'blocked' | 'version_incompatible' | 'unknown',
      remainingAttempts?: number,
      blocked?: boolean,
    ) {
      super(message);
      this.name = 'PairingError';
      this.code = code;
      this.remainingAttempts = remainingAttempts;
      this.blocked = blocked;
    }
  }

  return {
    getBindingState: mockGetBindingState,
    getKnownDeviceIds: mockGetKnownDeviceIds,
    pairDevice: jest.fn(),
    PairingError: MockPairingError,
  };
});

jest.mock('react-native-vision-camera', () => ({
  Camera: {
    getCameraPermissionStatus: jest.fn().mockReturnValue('not-determined'),
  },
}));

import { Camera } from 'react-native-vision-camera';
import { pairDevice, PairingError } from '../../services/SyncEngineModule';
import {
  DeviceDiscoveryScreen,
  resolveConnectionGuideCardPosition,
} from '../DeviceDiscoveryScreen';

const mockPairDevice = pairDevice as jest.Mock;

const mockNativeSyncEngine = {
  startDiscovery: jest.fn().mockResolvedValue(undefined),
  stopDiscovery: jest.fn().mockResolvedValue(undefined),
  getDiscoveryPermissionStatus: jest.fn().mockResolvedValue('granted'),
  getBindingState: mockGetBindingState,
  getKnownDeviceIds: mockGetKnownDeviceIds,
  pairDevice: jest.fn().mockResolvedValue(undefined),
  addListener: jest.fn(),
  removeListeners: jest.fn(),
};

const originalPlatformOS = Platform.OS;

function expectPreviewText(screen: ReturnType<typeof render>, text: string) {
  expect(
    screen.getAllByText(text, { includeHiddenElements: true }).length,
  ).toBeGreaterThan(0);
}

function expectPreviewTestId(
  screen: ReturnType<typeof render>,
  testID: string,
) {
  expect(
    screen.getAllByTestId(testID, { includeHiddenElements: true }).length,
  ).toBeGreaterThan(0);
}

describe('DeviceDiscoveryScreen onboarding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: originalPlatformOS,
    });
    mockCanGoBack.mockReturnValue(false);
    mockRouteParams = { mode: 'initial' };
    mockHasSeenUnconnectedGuide.mockResolvedValue(false);
    mockMarkUnconnectedGuideSeen.mockResolvedValue(undefined);
    mockIsVisualQaEnabled.mockReturnValue(false);
    mockPairDevice.mockResolvedValue(undefined);
    mockAddDesktop.mockResolvedValue(undefined);
    mockForgetDesktop.mockResolvedValue(undefined);
    mockUpdateAuthStatus.mockResolvedValue(undefined);
    mockGetBindingState.mockResolvedValue(null);
    mockGetKnownDeviceIds.mockResolvedValue([]);
    (Camera.getCameraPermissionStatus as jest.Mock).mockReturnValue(
      'not-determined',
    );
    mockNativeSyncEngine.getDiscoveryPermissionStatus.mockResolvedValue(
      'granted',
    );
    NativeModules.NativeSyncEngine = mockNativeSyncEngine;
    jest
      .spyOn(NativeEventEmitter.prototype, 'addListener')
      .mockReturnValue({ remove: jest.fn() } as any);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: originalPlatformOS,
    });
    jest.restoreAllMocks();
  });

  it('keeps the connection device card visible under the first guide step', async () => {
    const screen = render(<DeviceDiscoveryScreen />);

    await waitFor(() => {
      expect(screen.getByText('Connect Computer First')).toBeTruthy();
    });

    expect(screen.getByText('1/6')).toBeTruthy();
    expect(screen.getByText('Continue Preview')).toBeTruthy();
    expect(screen.getByText('Studio Mac')).toBeTruthy();
    expect(screen.getByText('1 device found')).toBeTruthy();
    expect(screen.queryByText('Scanning...')).toBeNull();
    expect(screen.queryByText('Start using Lynavo Drive')).toBeNull();
  });

  it('hides the back button in the initial connection flow', async () => {
    const screen = render(<DeviceDiscoveryScreen />);

    await waitFor(() => {
      expect(screen.getByText('Connect Your PC')).toBeTruthy();
    });

    expect(screen.queryByLabelText('Back')).toBeNull();
    expect(screen.queryByText('chevron-back')).toBeNull();
  });

  it('keeps the back button when switching desktops from an existing session', async () => {
    mockRouteParams = { mode: 'switch' };

    const screen = render(<DeviceDiscoveryScreen />);

    await waitFor(() => {
      expect(screen.getByText('Switch Computer')).toBeTruthy();
    });

    const backButton = screen.getByLabelText('Back');
    expect(backButton).toBeTruthy();
    fireEvent.press(backButton);
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('uses formal demo device names in visual QA mode', async () => {
    mockIsVisualQaEnabled.mockReturnValue(true);

    const screen = render(<DeviceDiscoveryScreen />);

    await waitFor(
      () => {
        expect(screen.getByText('Lynavo Drive Demo Mac Studio')).toBeTruthy();
      },
      { timeout: 2000 },
    );

    expect(screen.getByText('Lynavo Drive Demo MacBook Pro')).toBeTruthy();
    expect(
      screen.getByText('Lynavo Drive Demo Windows Workstation'),
    ).toBeTruthy();
    expect(screen.queryByText('openimdeMac-mini')).toBeNull();
    expect(mockNativeSyncEngine.stopDiscovery).not.toHaveBeenCalled();
    expect(mockNativeSyncEngine.startDiscovery).not.toHaveBeenCalled();
  });

  it('does not request Android nearby-device permission on first render', async () => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'android',
    });
    mockHasSeenUnconnectedGuide.mockResolvedValue(true);
    mockNativeSyncEngine.getDiscoveryPermissionStatus.mockResolvedValue(
      'required',
    );

    const screen = render(<DeviceDiscoveryScreen />);

    await waitFor(() => {
      expect(screen.getByText('Find Nearby Devices')).toBeTruthy();
    });

    expect(screen.getByText('Waiting for permission')).toBeTruthy();
    expect(
      mockNativeSyncEngine.getDiscoveryPermissionStatus,
    ).toHaveBeenCalled();
    expect(mockNativeSyncEngine.startDiscovery).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText('Start Scan'));

    await waitFor(() => {
      expect(mockNativeSyncEngine.startDiscovery).toHaveBeenCalledTimes(1);
    });
  });

  it('steps through the six feature-entry guide without navigating real pages', async () => {
    const screen = render(<DeviceDiscoveryScreen />);

    await waitFor(() => {
      expect(screen.getByText('Connect Computer First')).toBeTruthy();
    });

    expect(screen.getByText('1/6')).toBeTruthy();
    expect(screen.getByText('Continue Preview')).toBeTruthy();

    fireEvent.press(screen.getByText('Continue Preview'));
    await waitFor(() => {
      expect(screen.getByText('Enable Auto Upload')).toBeTruthy();
    });
    expect(screen.getByText('2/6')).toBeTruthy();
    expectPreviewText(screen, 'Auto Upload');
    expectPreviewText(screen, 'Device Status');
    expectPreviewText(screen, 'Off');

    fireEvent.press(screen.getByText('Next'));
    expect(screen.getByText('Sync Scope')).toBeTruthy();
    expect(screen.getByText('3/6')).toBeTruthy();
    expectPreviewText(screen, 'Sync Plan');
    expectPreviewText(screen, 'Sources');
    expectPreviewText(screen, 'Photos & Videos');
    expectPreviewText(screen, 'Sync Scope');
    expectPreviewText(screen, 'All Content');

    fireEvent.press(screen.getByText('Next'));
    expect(screen.getByText('Sync Progress')).toBeTruthy();
    expect(screen.getByText('4/6')).toBeTruthy();
    expectPreviewText(screen, 'Uploading - Progress');
    expectPreviewText(screen, 'Uploaded 96/128');
    expectPreviewText(screen, 'Speed');
    expectPreviewText(screen, '68.5 MB/s');
    expectPreviewText(screen, 'Progress');
    expectPreviewText(screen, 'File Size');
    expectPreviewText(screen, 'Time Left');
    expectPreviewText(screen, '24s');
    expect(screen.queryAllByText('Editing Workstation A')).toHaveLength(0);

    fireEvent.press(screen.getByText('Next'));
    expect(screen.getByText('Recent Records')).toBeTruthy();
    expect(screen.getByText('5/6')).toBeTruthy();
    expectPreviewText(screen, 'Recent Downloads');
    expectPreviewText(screen, 'View All');
    expectPreviewText(screen, 'Brand Guidelines.pdf');
    expectPreviewTestId(screen, 'guide-preview-records-download-icon');
    expectPreviewTestId(screen, 'guide-preview-download-file-icon');
    expectPreviewTestId(screen, 'guide-preview-download-video-icon');
    expectPreviewTestId(screen, 'guide-preview-download-document-icon');
    expect(screen.queryByText('download-outline')).toBeNull();
    expect(screen.queryByText('image-outline')).toBeNull();
    expect(screen.queryByText('play-circle-outline')).toBeNull();
    expect(screen.queryByText('document-outline')).toBeNull();
    expect(screen.queryAllByText('arrow-down-circle-outline')).toHaveLength(0);

    fireEvent.press(screen.getByText('Next'));
    expect(screen.getByText('Local Computer')).toBeTruthy();
    expect(screen.getByText('6/6')).toBeTruthy();
    expect(screen.getByText('Done')).toBeTruthy();
    expectPreviewText(screen, 'Phone Sync Space');
    expectPreviewText(screen, 'Local Computer');
    expectPreviewTestId(screen, 'guide-preview-phone-sync-icon');
    expectPreviewTestId(screen, 'guide-preview-local-computer-icon');

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockMarkUnconnectedGuideSeen).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText('Done'));

    await waitFor(() => {
      expect(mockMarkUnconnectedGuideSeen).toHaveBeenCalledTimes(1);
    });
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('marks the guide seen when skipping', async () => {
    const screen = render(<DeviceDiscoveryScreen />);

    await waitFor(() => {
      expect(screen.getByText('Skip Guide')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('Skip Guide'));

    await waitFor(() => {
      expect(mockMarkUnconnectedGuideSeen).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText('Connect Computer First')).toBeNull();
  });

  it('does not show the guide in switch-desktop mode', async () => {
    mockRouteParams = { mode: 'switch' };

    const screen = render(<DeviceDiscoveryScreen />);

    await waitFor(() => {
      expect(mockHasSeenUnconnectedGuide).not.toHaveBeenCalled();
    });
    expect(screen.queryByText('Connect Computer First')).toBeNull();
  });

  it('shows pairing invalidated notice while keeping pairing choices visible', async () => {
    mockRouteParams = { reason: 'pairing_invalidated' };
    mockHasSeenUnconnectedGuide.mockResolvedValue(true);

    const screen = render(<DeviceDiscoveryScreen />);

    await waitFor(() => {
      expect(screen.getByText('Pair this desktop again')).toBeTruthy();
    });

    expect(
      screen.getByText(
        'This desktop changed its pairing code. Pair again to continue.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Manual Pairing')).toBeTruthy();
    expect(screen.getByText('Studio Mac')).toBeTruthy();

    fireEvent.press(screen.getByText('Manual Pairing'));

    expect(screen.getByText('Scan QR Code')).toBeTruthy();
  });

  it('marks the current desktop in switch mode and blocks reconnecting it', async () => {
    mockRouteParams = { mode: 'switch' };
    mockGetBindingState.mockResolvedValue({
      deviceId: 'studio-mac',
      deviceName: 'Studio Mac',
      deviceAlias: 'Studio Mac',
      connectionState: 'connected',
    });
    mockGetKnownDeviceIds.mockResolvedValue(['studio-mac']);
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);

    const screen = render(<DeviceDiscoveryScreen />);

    await waitFor(() => {
      expect(screen.getByText('Current')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('Studio Mac'));

    expect(alertSpy).toHaveBeenCalledWith('Already connected to this device');
    expect(mockPairDevice).not.toHaveBeenCalled();
    expect(screen.queryByText('Select Connection Method')).toBeNull();
  });

  it('deduplicates a recent desktop that is also discovered on the LAN', async () => {
    mockRouteParams = { mode: 'switch' };
    jest
      .spyOn(NativeEventEmitter.prototype, 'addListener')
      .mockImplementation((_event, listener) => {
        listener([
          {
            deviceId: 'studio-mac',
            name: 'Studio Mac',
            ip: '192.168.31.8',
            type: 'mac',
            port: 39393,
          },
        ]);
        return { remove: jest.fn() } as any;
      });

    const screen = render(<DeviceDiscoveryScreen />);

    await waitFor(() => {
      expect(screen.getByText('1 device found')).toBeTruthy();
    });
    expect(screen.getAllByText('Studio Mac')).toHaveLength(1);
  });

  it('deduplicates a recent desktop when LAN discovery reports a different id for the same host', async () => {
    mockRouteParams = { mode: 'initial' };
    jest
      .spyOn(NativeEventEmitter.prototype, 'addListener')
      .mockImplementation((_event, listener) => {
        listener([
          {
            deviceId: 'studio-mac-server-id',
            name: 'Studio Mac',
            ip: '192.168.31.8',
            type: 'mac',
            port: 39393,
          },
        ]);
        return { remove: jest.fn() } as any;
      });

    const screen = render(<DeviceDiscoveryScreen />);

    await waitFor(() => {
      expect(screen.getByText('1 device found')).toBeTruthy();
    });
    expect(screen.getAllByText('Studio Mac')).toHaveLength(1);
  });

  it('deduplicates LAN discoveries that describe the same host and port with different ids', async () => {
    mockRouteParams = { mode: 'switch' };
    jest
      .spyOn(NativeEventEmitter.prototype, 'addListener')
      .mockImplementation((_event, listener) => {
        listener([
          {
            deviceId: 'mini4-server-id',
            name: 'Mini4',
            ip: '172.16.20.108',
            type: 'mac',
            port: 39393,
          },
          {
            deviceId: 'Mini4',
            name: 'Mini4',
            ip: '172.16.20.108:39393',
            type: 'mac',
            port: 39393,
          },
          {
            deviceId: 'fallback-172.16.20.108',
            name: '172.16.20.108',
            ip: '172.16.20.108:39393',
            type: 'mac',
            port: 39393,
          },
        ]);
        return { remove: jest.fn() } as any;
      });

    const screen = render(<DeviceDiscoveryScreen />);

    await waitFor(() => {
      expect(screen.getByText('1 device found')).toBeTruthy();
    });
    expect(screen.getAllByText('Mini4')).toHaveLength(1);
    expect(screen.queryByText('172.16.20.108:39393')).toBeNull();
  });

  it('does not count recent-only desktops as online devices in switch mode', async () => {
    mockRouteParams = { mode: 'switch' };

    const screen = render(<DeviceDiscoveryScreen />);

    await waitFor(() => {
      expect(screen.getByText('Switch Computer')).toBeTruthy();
    });

    expect(screen.queryByText('Studio Mac')).toBeNull();
    expect(screen.queryByText('192.168.31.8:39393')).toBeNull();
    expect(screen.queryByText('1 device found')).toBeNull();
  });

  it('shows recent desktop host without the sync port in initial mode', async () => {
    mockHasSeenUnconnectedGuide.mockResolvedValue(true);

    const screen = render(<DeviceDiscoveryScreen />);

    await waitFor(() => {
      expect(screen.getByText('Studio Mac')).toBeTruthy();
    });

    expect(screen.getByText('192.168.31.8')).toBeTruthy();
    expect(screen.queryByText('192.168.31.8:39393')).toBeNull();
  });

  it('direct-reconnects a known discovered desktop in switch mode', async () => {
    mockRouteParams = { mode: 'switch' };
    mockGetBindingState.mockResolvedValue({
      deviceId: 'other-desktop',
      deviceName: 'Other Desktop',
      connectionState: 'connected',
    });
    mockGetKnownDeviceIds.mockResolvedValue(['studio-mac']);
    jest
      .spyOn(NativeEventEmitter.prototype, 'addListener')
      .mockImplementation((_event, listener) => {
        listener([
          {
            deviceId: 'studio-mac',
            name: 'Studio Mac',
            ip: '192.168.31.8',
            type: 'mac',
            port: 39393,
          },
        ]);
        return { remove: jest.fn() } as any;
      });

    const screen = render(<DeviceDiscoveryScreen />);

    await waitFor(() => {
      expect(screen.getByText('Previously Connected')).toBeTruthy();
    });
    expect(screen.queryByText('Switch directly')).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByText('Studio Mac'));
    });

    await waitFor(() => {
      expect(mockPairDevice).toHaveBeenCalledWith({
        deviceId: 'studio-mac',
        host: '192.168.31.8',
        port: 39393,
        connectionCode: '',
      });
    });
    expect(mockAddDesktop).toHaveBeenCalledWith({
      desktopDeviceId: 'studio-mac',
      desktopName: 'Studio Mac',
      host: '192.168.31.8',
      port: 39393,
      authorizationStatus: 'authorized',
    });
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'RESET',
      }),
    );
    expect(screen.queryByText('Select Connection Method')).toBeNull();
    expect(screen.queryByPlaceholderText('e.g. A8X2K9')).toBeNull();
  });

  it('falls back to code entry when known discovered desktop direct reconnect fails', async () => {
    mockRouteParams = { mode: 'switch' };
    mockGetBindingState.mockResolvedValue({
      deviceId: 'other-desktop',
      deviceName: 'Other Desktop',
      connectionState: 'connected',
    });
    mockGetKnownDeviceIds.mockResolvedValue(['studio-mac']);
    mockPairDevice.mockRejectedValueOnce(
      new PairingError('Pair token invalid', 'unknown'),
    );
    jest
      .spyOn(NativeEventEmitter.prototype, 'addListener')
      .mockImplementation((_event, listener) => {
        listener([
          {
            deviceId: 'studio-mac',
            name: 'Studio Mac',
            ip: '192.168.31.8',
            type: 'mac',
            port: 39393,
          },
        ]);
        return { remove: jest.fn() } as any;
      });

    const screen = render(<DeviceDiscoveryScreen />);

    await waitFor(() => {
      expect(screen.getByText('Previously Connected')).toBeTruthy();
    });
    expect(screen.queryByText('Switch directly')).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByText('Studio Mac'));
    });

    await waitFor(() => {
      expect(screen.getByPlaceholderText('e.g. A8X2K9')).toBeTruthy();
    });
    expect(mockPairDevice).toHaveBeenCalledWith({
      deviceId: 'studio-mac',
      host: '192.168.31.8',
      port: 39393,
      connectionCode: '',
    });
    expect(mockAddDesktop).not.toHaveBeenCalled();
    expect(screen.queryByText('Select Connection Method')).toBeNull();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('does not let guide touches pass through to a real device', async () => {
    const screen = render(<DeviceDiscoveryScreen />);

    await waitFor(() => {
      expect(screen.getByText('Studio Mac')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('Studio Mac'));

    expect(mockMarkUnconnectedGuideSeen).not.toHaveBeenCalled();
    expect(screen.getByText('Connect Computer First')).toBeTruthy();
    expect(screen.queryByText('Select Connection Method')).toBeNull();
  });

  it('opens manual pairing options after the guide is dismissed', async () => {
    const screen = render(<DeviceDiscoveryScreen />);

    await waitFor(() => {
      expect(screen.getByText('Skip Guide')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('Skip Guide'));

    await waitFor(() => {
      expect(mockMarkUnconnectedGuideSeen).toHaveBeenCalledTimes(1);
    });

    fireEvent.press(screen.getByText('Manual Pairing'));

    expect(screen.queryByText('Connect Computer First')).toBeNull();
    expect(screen.getByText('Scan QR Code')).toBeTruthy();
    expect(screen.getByText('Manual IP')).toBeTruthy();
  });

  it('opens camera permission prompt from the manual scan pairing option', async () => {
    mockHasSeenUnconnectedGuide.mockResolvedValue(true);

    const screen = render(<DeviceDiscoveryScreen />);

    await waitFor(() => {
      expect(screen.getByText('Manual Pairing')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('Manual Pairing'));
    fireEvent.press(screen.getByText('Scan QR Code'));

    await waitFor(() => {
      expect(screen.getByText('Allow Camera Access')).toBeTruthy();
    });
    expect(screen.getByText('Allow')).toBeTruthy();
  });

  it('navigates directly to QR scanner when camera permission is already granted', async () => {
    mockHasSeenUnconnectedGuide.mockResolvedValue(true);
    (Camera.getCameraPermissionStatus as jest.Mock).mockReturnValue('granted');

    const screen = render(<DeviceDiscoveryScreen />);

    await waitFor(() => {
      expect(screen.getByText('Manual Pairing')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('Manual Pairing'));
    fireEvent.press(screen.getByText('Scan QR Code'));

    expect(mockNavigate).toHaveBeenCalledWith('QRScanner');
    expect(screen.queryByText('Allow Camera Access')).toBeNull();
  });

  it('opens manual IP input from the manual pairing options', async () => {
    mockHasSeenUnconnectedGuide.mockResolvedValue(true);

    const screen = render(<DeviceDiscoveryScreen />);

    await waitFor(() => {
      expect(screen.getByText('Manual Pairing')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('Manual Pairing'));
    fireEvent.press(screen.getByText('Manual IP'));

    expect(screen.getByPlaceholderText('192.168.31.21')).toBeTruthy();
  });

  it('reconnects a recent desktop with an empty connection code before opening pairing options', async () => {
    mockHasSeenUnconnectedGuide.mockResolvedValue(true);

    const screen = render(<DeviceDiscoveryScreen />);

    await waitFor(() => {
      expect(screen.getByText('Studio Mac')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(screen.getByText('Studio Mac'));
    });

    await waitFor(() => {
      expect(mockPairDevice).toHaveBeenCalledWith({
        deviceId: 'studio-mac',
        host: '192.168.31.8',
        port: 39393,
        connectionCode: '',
      });
    });
    expect(mockNativeSyncEngine.pairDevice).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'RESET',
        }),
      );
    });
    expect(screen.queryByText('Select Connection Method')).toBeNull();
  });

  it('falls back to pairing options when recent desktop silent reconnect fails', async () => {
    mockHasSeenUnconnectedGuide.mockResolvedValue(true);
    mockPairDevice.mockRejectedValueOnce(
      new PairingError('Pair token invalid', 'unknown'),
    );

    const screen = render(<DeviceDiscoveryScreen />);

    await waitFor(() => {
      expect(screen.getByText('Studio Mac')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('Studio Mac'));

    await waitFor(() => {
      expect(mockPairDevice).toHaveBeenCalledWith({
        deviceId: 'studio-mac',
        host: '192.168.31.8',
        port: 39393,
        connectionCode: '',
      });
    });
    await waitFor(() => {
      expect(screen.getByPlaceholderText('e.g. A8X2K9')).toBeTruthy();
    });
    expect(screen.queryByText('Select Connection Method')).toBeNull();
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalledWith(
      '[DeviceDiscoveryScreen] recent desktop reconnect failed, requiring pairing',
      expect.any(PairingError),
    );
  });

  it('pairs manually through SyncEngineModule instead of the raw native module', async () => {
    mockHasSeenUnconnectedGuide.mockResolvedValue(true);

    const screen = render(<DeviceDiscoveryScreen />);

    await waitFor(() => {
      expect(screen.getByText('Manual Pairing')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('Manual Pairing'));
    fireEvent.press(screen.getByText('Manual IP'));
    fireEvent.changeText(
      screen.getByPlaceholderText('192.168.31.21'),
      '192.168.31.44',
    );
    fireEvent.press(screen.getByText('Next'));
    fireEvent.changeText(screen.getByPlaceholderText('e.g. A8X2K9'), 'a8x2k9');
    fireEvent.press(screen.getByText('Connect'));

    await waitFor(() => {
      expect(mockPairDevice).toHaveBeenCalledWith({
        deviceId: 'manual-192.168.31.44',
        host: '192.168.31.44',
        port: 39393,
        connectionCode: 'A8X2K9',
      });
    });
    expect(mockNativeSyncEngine.pairDevice).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(mockAddDesktop).toHaveBeenCalledWith({
        desktopDeviceId: 'manual-192.168.31.44',
        desktopName: '192.168.31.44',
        host: '192.168.31.44',
        port: 39393,
        authorizationStatus: 'authorized',
      });
    });
  });

  it.each([
    {
      label: 'wrong_code',
      error: new PairingError('Wrong code', 'wrong_code', 2),
      message: 'Incorrect connection code. You can try 2 more times.',
    },
    {
      label: 'blocked',
      error: new PairingError('Blocked', 'blocked', undefined, true),
      message:
        'This computer has blocked this phone from pairing. Please unblock it on the computer first.',
    },
    {
      label: 'version_incompatible',
      error: new PairingError('Version incompatible', 'version_incompatible'),
      message:
        'App versions are incompatible. Please update Lynavo Drive on both devices.',
    },
    {
      label: 'unknown',
      error: new PairingError('Network failed', 'unknown'),
      message:
        'Connection failed. Please check if the computer is online and try again.',
    },
  ])(
    'maps PairingError $label to a global connection state',
    async ({ error, message }) => {
      mockHasSeenUnconnectedGuide.mockResolvedValue(true);
      mockPairDevice.mockRejectedValueOnce(error);

      const screen = render(<DeviceDiscoveryScreen />);

      await waitFor(() => {
        expect(screen.getByText('Manual Pairing')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('Manual Pairing'));
      fireEvent.press(screen.getByText('Manual IP'));
      fireEvent.changeText(
        screen.getByPlaceholderText('192.168.31.21'),
        '192.168.31.44',
      );
      fireEvent.press(screen.getByText('Next'));
      fireEvent.changeText(
        screen.getByPlaceholderText('e.g. A8X2K9'),
        'a8x2k9',
      );
      fireEvent.press(screen.getByText('Connect'));

      await waitFor(() => {
        expect(screen.getByText(message)).toBeTruthy();
      });
      expect(mockNativeSyncEngine.pairDevice).not.toHaveBeenCalled();
      expect(mockDispatch).not.toHaveBeenCalled();
    },
  );

  it('places the guide card above a tall spotlight when there is not enough room below', () => {
    const position = resolveConnectionGuideCardPosition({
      hole: {
        x: 8,
        y: 248,
        width: 352,
        height: 400,
      },
      viewportHeight: 800,
      bottomInset: 34,
    });

    expect(position).toMatchObject({
      position: 'absolute',
      left: 16,
      right: 16,
      top: 20,
    });
    expect(position).not.toHaveProperty('bottom');
  });
});
