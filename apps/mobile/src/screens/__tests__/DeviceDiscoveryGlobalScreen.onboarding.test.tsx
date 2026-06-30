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
  const zhHans = {
    deviceDiscovery: require('../../i18n/locales/zh-Hans/deviceDiscovery.json'),
    common: require('../../i18n/locales/zh-Hans/common.json'),
    errors: require('../../i18n/locales/zh-Hans/errors.json'),
  };
  return {
    useTranslation: () => ({
      i18n: {
        language: 'zh-Hans',
        resolvedLanguage: 'zh-Hans',
      },
      t: (key: string, options?: any) => {
        const parts = key.split('.');
        let current: any = zhHans;
        for (const part of parts) {
          if (current == null) return key;
          current = current[part];
        }
        if (typeof current === 'string') {
          if (options) {
            let res = current;
            for (const k of Object.keys(options)) {
              res = res.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), options[k]);
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

jest.mock('../../components/GlobalGradientBackground', () => ({
  GlobalGradientBackground: ({ children }: { children: React.ReactNode }) => {
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
  DeviceDiscoveryGlobalScreen,
  resolveConnectionGuideCardPosition,
} from '../DeviceDiscoveryGlobalScreen';

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

describe('DeviceDiscoveryGlobalScreen onboarding', () => {
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
    const screen = render(<DeviceDiscoveryGlobalScreen />);

    await waitFor(() => {
      expect(screen.getByText('先连接电脑')).toBeTruthy();
    });

    expect(screen.getByText('1/6')).toBeTruthy();
    expect(screen.getByText('继续预览')).toBeTruthy();
    expect(screen.getByText('Studio Mac')).toBeTruthy();
    expect(screen.getByText('已发现 1 台')).toBeTruthy();
    expect(screen.queryByText('扫描中...')).toBeNull();
    expect(screen.queryByText('开始使用 Vivi Drop')).toBeNull();
  });

  it('hides the back button in the initial connection flow', async () => {
    const screen = render(<DeviceDiscoveryGlobalScreen />);

    await waitFor(() => {
      expect(screen.getByText('连接你的电脑')).toBeTruthy();
    });

    expect(screen.queryByLabelText('返回')).toBeNull();
    expect(screen.queryByText('chevron-back')).toBeNull();
  });

  it('keeps the back button when switching desktops from an existing session', async () => {
    mockRouteParams = { mode: 'switch' };

    const screen = render(<DeviceDiscoveryGlobalScreen />);

    await waitFor(() => {
      expect(screen.getByText('切换电脑')).toBeTruthy();
    });

    const backButton = screen.getByLabelText('返回');
    expect(backButton).toBeTruthy();
    fireEvent.press(backButton);
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('uses formal demo device names in visual QA mode', async () => {
    mockIsVisualQaEnabled.mockReturnValue(true);

    const screen = render(<DeviceDiscoveryGlobalScreen />);

    await waitFor(
      () => {
        expect(screen.getByText('ViviDrop 演示 Mac Studio')).toBeTruthy();
      },
      { timeout: 2000 },
    );

    expect(screen.getByText('ViviDrop 演示 MacBook Pro')).toBeTruthy();
    expect(screen.getByText('ViviDrop 演示 Windows 工作站')).toBeTruthy();
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

    const screen = render(<DeviceDiscoveryGlobalScreen />);

    await waitFor(() => {
      expect(screen.getByText('允许查找附近设备')).toBeTruthy();
    });

    expect(screen.getByText('等待授权')).toBeTruthy();
    expect(
      mockNativeSyncEngine.getDiscoveryPermissionStatus,
    ).toHaveBeenCalled();
    expect(mockNativeSyncEngine.startDiscovery).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText('开始扫描'));

    await waitFor(() => {
      expect(mockNativeSyncEngine.startDiscovery).toHaveBeenCalledTimes(1);
    });
  });

  it('steps through the six feature-entry guide without navigating real pages', async () => {
    const screen = render(<DeviceDiscoveryGlobalScreen />);

    await waitFor(() => {
      expect(screen.getByText('先连接电脑')).toBeTruthy();
    });

    expect(screen.getByText('1/6')).toBeTruthy();
    expect(screen.getByText('继续预览')).toBeTruthy();

    fireEvent.press(screen.getByText('继续预览'));
    await waitFor(() => {
      expect(screen.getByText('开启自动上传')).toBeTruthy();
    });
    expect(screen.getByText('2/6')).toBeTruthy();
    expectPreviewText(screen, '自动上传');
    expectPreviewText(screen, '当前手机状态');
    expectPreviewText(screen, '开启');

    fireEvent.press(screen.getByText('下一步'));
    expect(screen.getByText('同步范围与限制')).toBeTruthy();
    expect(screen.getByText('3/6')).toBeTruthy();
    expectPreviewText(screen, '同步计划');
    expectPreviewText(screen, '同步来源');
    expectPreviewText(screen, '照片和视频');
    expectPreviewText(screen, '同步范围');
    expectPreviewText(screen, '全部内容');

    fireEvent.press(screen.getByText('下一步'));
    expect(screen.getByText('查看同步进度')).toBeTruthy();
    expect(screen.getByText('4/6')).toBeTruthy();
    expectPreviewText(screen, '上传中 · 本次传输进度');
    expectPreviewText(screen, '已上传96/128');
    expectPreviewText(screen, '传输速度');
    expectPreviewText(screen, '68.5 MB/s');
    expectPreviewText(screen, '传输进度');
    expectPreviewText(screen, '文件大小');
    expectPreviewText(screen, '剩余时间');
    expectPreviewText(screen, '24 秒');
    expect(screen.queryAllByText('剪辑工作站-A')).toHaveLength(0);

    fireEvent.press(screen.getByText('下一步'));
    expect(screen.getByText('查看最近记录')).toBeTruthy();
    expect(screen.getByText('5/6')).toBeTruthy();
    expectPreviewText(screen, '最近下载');
    expectPreviewText(screen, '查看全部');
    expectPreviewText(screen, '品牌手册.pdf');
    expectPreviewTestId(screen, 'guide-preview-records-download-icon');
    expectPreviewTestId(screen, 'guide-preview-download-file-icon');
    expectPreviewTestId(screen, 'guide-preview-download-video-icon');
    expectPreviewTestId(screen, 'guide-preview-download-document-icon');
    expect(screen.queryByText('download-outline')).toBeNull();
    expect(screen.queryByText('image-outline')).toBeNull();
    expect(screen.queryByText('play-circle-outline')).toBeNull();
    expect(screen.queryByText('document-outline')).toBeNull();
    expect(screen.queryAllByText('arrow-down-circle-outline')).toHaveLength(0);

    fireEvent.press(screen.getByText('下一步'));
    expect(screen.getByText('远程访问文件')).toBeTruthy();
    expect(screen.getByText('6/6')).toBeTruthy();
    expect(screen.getByText('完成')).toBeTruthy();
    expectPreviewText(screen, '手机同步空间');
    expectPreviewText(screen, '远程访问电脑');
    expectPreviewTestId(screen, 'guide-preview-phone-sync-icon');
    expectPreviewTestId(screen, 'guide-preview-remote-access-icon');

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockMarkUnconnectedGuideSeen).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText('完成'));

    await waitFor(() => {
      expect(mockMarkUnconnectedGuideSeen).toHaveBeenCalledTimes(1);
    });
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('marks the guide seen when skipping', async () => {
    const screen = render(<DeviceDiscoveryGlobalScreen />);

    await waitFor(() => {
      expect(screen.getByText('跳过引导')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('跳过引导'));

    await waitFor(() => {
      expect(mockMarkUnconnectedGuideSeen).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText('先连接电脑')).toBeNull();
  });

  it('does not show the guide in switch-desktop mode', async () => {
    mockRouteParams = { mode: 'switch' };

    const screen = render(<DeviceDiscoveryGlobalScreen />);

    await waitFor(() => {
      expect(mockHasSeenUnconnectedGuide).not.toHaveBeenCalled();
    });
    expect(screen.queryByText('先连接电脑')).toBeNull();
  });

  it('shows pairing invalidated notice while keeping pairing choices visible', async () => {
    mockRouteParams = { reason: 'pairing_invalidated' };
    mockHasSeenUnconnectedGuide.mockResolvedValue(true);

    const screen = render(<DeviceDiscoveryGlobalScreen />);

    await waitFor(() => {
      expect(screen.getByText('需要重新配对这台电脑')).toBeTruthy();
    });

    expect(
      screen.getByText('这台电脑已更新连接码。请重新配对后继续同步。'),
    ).toBeTruthy();
    expect(screen.getByText('手动配对')).toBeTruthy();
    expect(screen.getByText('Studio Mac')).toBeTruthy();

    fireEvent.press(screen.getByText('手动配对'));

    expect(screen.getByText('扫码配对')).toBeTruthy();
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

    const screen = render(<DeviceDiscoveryGlobalScreen />);

    await waitFor(() => {
      expect(screen.getByText('当前')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('Studio Mac'));

    expect(alertSpy).toHaveBeenCalledWith('已是当前连接设备');
    expect(mockPairDevice).not.toHaveBeenCalled();
    expect(screen.queryByText('选择连接方式')).toBeNull();
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

    const screen = render(<DeviceDiscoveryGlobalScreen />);

    await waitFor(() => {
      expect(screen.getByText('已发现 1 台')).toBeTruthy();
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

    const screen = render(<DeviceDiscoveryGlobalScreen />);

    await waitFor(() => {
      expect(screen.getByText('已发现 1 台')).toBeTruthy();
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

    const screen = render(<DeviceDiscoveryGlobalScreen />);

    await waitFor(() => {
      expect(screen.getByText('已发现 1 台')).toBeTruthy();
    });
    expect(screen.getAllByText('Mini4')).toHaveLength(1);
    expect(screen.queryByText('172.16.20.108:39393')).toBeNull();
  });

  it('does not count recent-only desktops as online devices in switch mode', async () => {
    mockRouteParams = { mode: 'switch' };

    const screen = render(<DeviceDiscoveryGlobalScreen />);

    await waitFor(() => {
      expect(screen.getByText('切换电脑')).toBeTruthy();
    });

    expect(screen.queryByText('Studio Mac')).toBeNull();
    expect(screen.queryByText('192.168.31.8:39393')).toBeNull();
    expect(screen.queryByText('已发现 1 台')).toBeNull();
  });

  it('shows recent desktop host without the sync port in initial mode', async () => {
    mockHasSeenUnconnectedGuide.mockResolvedValue(true);

    const screen = render(<DeviceDiscoveryGlobalScreen />);

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

    const screen = render(<DeviceDiscoveryGlobalScreen />);

    await waitFor(() => {
      expect(screen.getByText('已连过')).toBeTruthy();
    });
    expect(screen.queryByText('直接切换')).toBeNull();

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
    expect(screen.queryByText('选择连接方式')).toBeNull();
    expect(screen.queryByPlaceholderText('例如 A8X2K9')).toBeNull();
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

    const screen = render(<DeviceDiscoveryGlobalScreen />);

    await waitFor(() => {
      expect(screen.getByText('已连过')).toBeTruthy();
    });
    expect(screen.queryByText('直接切换')).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByText('Studio Mac'));
    });

    await waitFor(() => {
      expect(screen.getByPlaceholderText('例如 A8X2K9')).toBeTruthy();
    });
    expect(mockPairDevice).toHaveBeenCalledWith({
      deviceId: 'studio-mac',
      host: '192.168.31.8',
      port: 39393,
      connectionCode: '',
    });
    expect(mockAddDesktop).not.toHaveBeenCalled();
    expect(screen.queryByText('选择连接方式')).toBeNull();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('does not let guide touches pass through to a real device', async () => {
    const screen = render(<DeviceDiscoveryGlobalScreen />);

    await waitFor(() => {
      expect(screen.getByText('Studio Mac')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('Studio Mac'));

    expect(mockMarkUnconnectedGuideSeen).not.toHaveBeenCalled();
    expect(screen.getByText('先连接电脑')).toBeTruthy();
    expect(screen.queryByText('选择连接方式')).toBeNull();
  });

  it('opens manual pairing options after the guide is dismissed', async () => {
    const screen = render(<DeviceDiscoveryGlobalScreen />);

    await waitFor(() => {
      expect(screen.getByText('跳过引导')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('跳过引导'));

    await waitFor(() => {
      expect(mockMarkUnconnectedGuideSeen).toHaveBeenCalledTimes(1);
    });

    fireEvent.press(screen.getByText('手动配对'));

    expect(screen.queryByText('先连接电脑')).toBeNull();
    expect(screen.getByText('扫码配对')).toBeTruthy();
    expect(screen.getByText('手动输入 IP')).toBeTruthy();
  });

  it('opens camera permission prompt from the manual scan pairing option', async () => {
    mockHasSeenUnconnectedGuide.mockResolvedValue(true);

    const screen = render(<DeviceDiscoveryGlobalScreen />);

    await waitFor(() => {
      expect(screen.getByText('手动配对')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('手动配对'));
    fireEvent.press(screen.getByText('扫码配对'));

    await waitFor(() => {
      expect(screen.getByText('允许相机访问')).toBeTruthy();
    });
    expect(screen.getByText('允许')).toBeTruthy();
  });

  it('navigates directly to QR scanner when camera permission is already granted', async () => {
    mockHasSeenUnconnectedGuide.mockResolvedValue(true);
    (Camera.getCameraPermissionStatus as jest.Mock).mockReturnValue('granted');

    const screen = render(<DeviceDiscoveryGlobalScreen />);

    await waitFor(() => {
      expect(screen.getByText('手动配对')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('手动配对'));
    fireEvent.press(screen.getByText('扫码配对'));

    expect(mockNavigate).toHaveBeenCalledWith('QRScanner');
    expect(screen.queryByText('允许相机访问')).toBeNull();
  });

  it('opens manual IP input from the manual pairing options', async () => {
    mockHasSeenUnconnectedGuide.mockResolvedValue(true);

    const screen = render(<DeviceDiscoveryGlobalScreen />);

    await waitFor(() => {
      expect(screen.getByText('手动配对')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('手动配对'));
    fireEvent.press(screen.getByText('手动输入 IP'));

    expect(screen.getByPlaceholderText('192.168.31.21')).toBeTruthy();
  });

  it('reconnects a recent desktop with an empty token code before opening pairing options', async () => {
    mockHasSeenUnconnectedGuide.mockResolvedValue(true);

    const screen = render(<DeviceDiscoveryGlobalScreen />);

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
    expect(screen.queryByText('选择连接方式')).toBeNull();
  });

  it('falls back to global pairing options when recent desktop token reconnect fails', async () => {
    mockHasSeenUnconnectedGuide.mockResolvedValue(true);
    mockPairDevice.mockRejectedValueOnce(
      new PairingError('Pair token invalid', 'unknown'),
    );

    const screen = render(<DeviceDiscoveryGlobalScreen />);

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
      expect(screen.getByPlaceholderText('例如 A8X2K9')).toBeTruthy();
    });
    expect(screen.queryByText('选择连接方式')).toBeNull();
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalledWith(
      '[DeviceDiscoveryGlobalScreen] recent desktop reconnect failed, requiring pairing',
      expect.any(PairingError),
    );
  });

  it('pairs manually through SyncEngineModule instead of the raw native module', async () => {
    mockHasSeenUnconnectedGuide.mockResolvedValue(true);

    const screen = render(<DeviceDiscoveryGlobalScreen />);

    await waitFor(() => {
      expect(screen.getByText('手动配对')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('手动配对'));
    fireEvent.press(screen.getByText('手动输入 IP'));
    fireEvent.changeText(
      screen.getByPlaceholderText('192.168.31.21'),
      '192.168.31.44',
    );
    fireEvent.press(screen.getByText('下一步'));
    fireEvent.changeText(screen.getByPlaceholderText('例如 A8X2K9'), 'a8x2k9');
    fireEvent.press(screen.getByText('连接'));

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
      message: '连接码错误，还可以再试 2 次。',
    },
    {
      label: 'blocked',
      error: new PairingError('Blocked', 'blocked', undefined, true),
      message: '这台电脑已阻止此手机配对，请先在电脑端解除阻止后再试。',
    },
    {
      label: 'version_incompatible',
      error: new PairingError('Version incompatible', 'version_incompatible'),
      message: '手机和电脑端版本不兼容，请更新两端 Vivi Drop 后再试。',
    },
    {
      label: 'unknown',
      error: new PairingError('Network failed', 'unknown'),
      message: '连接失败，请确认电脑端在线后重试。',
    },
  ])(
    'maps PairingError $label to a global connection state',
    async ({ error, message }) => {
      mockHasSeenUnconnectedGuide.mockResolvedValue(true);
      mockPairDevice.mockRejectedValueOnce(error);

      const screen = render(<DeviceDiscoveryGlobalScreen />);

      await waitFor(() => {
        expect(screen.getByText('手动配对')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('手动配对'));
      fireEvent.press(screen.getByText('手动输入 IP'));
      fireEvent.changeText(
        screen.getByPlaceholderText('192.168.31.21'),
        '192.168.31.44',
      );
      fireEvent.press(screen.getByText('下一步'));
      fireEvent.changeText(
        screen.getByPlaceholderText('例如 A8X2K9'),
        'a8x2k9',
      );
      fireEvent.press(screen.getByText('连接'));

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
