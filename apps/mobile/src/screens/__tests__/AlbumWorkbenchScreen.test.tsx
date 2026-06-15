import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {
  Animated,
  FlatList,
  NativeModules,
  PanResponder,
  Platform,
  Text,
  View,
} from 'react-native';

jest.mock('react-native-localize', () => ({
  getLocales: () => [
    {
      languageCode: 'zh',
      scriptCode: 'Hans',
      countryCode: 'CN',
      languageTag: 'zh-Hans-CN',
      isRTL: false,
    },
  ],
}));

jest.mock('react-native-video', () => 'Video');

jest.mock('react-i18next', () => jest.requireActual('react-i18next'));

const mockAsyncStorageValues = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn((key: string) =>
      Promise.resolve(mockAsyncStorageValues.get(key) ?? null),
    ),
    setItem: jest.fn((key: string, value: string) => {
      mockAsyncStorageValues.set(key, value);
      return Promise.resolve();
    }),
    removeItem: jest.fn((key: string) => {
      mockAsyncStorageValues.delete(key);
      return Promise.resolve();
    }),
  },
}));

import i18n from '../../i18n';
import {
  clearAutoUploadSessionForTest,
  clearRememberedAutoUploadRoundProgressForTest,
  rememberAutoUploadRoundProgress,
  setAutoUploadSessionBaselineForTest,
} from '../../utils/autoUploadRoundProgress';
import { AlbumWorkbenchScreen } from '../AlbumWorkbenchScreen';

function flattenTextChildren(value: unknown): Array<string | number> {
  if (typeof value === 'string' || typeof value === 'number') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(flattenTextChildren);
  }
  if (React.isValidElement<{ children?: unknown }>(value)) {
    return flattenTextChildren(value.props.children);
  }
  return [];
}

const mountedTrees: ReactTestRenderer.ReactTestRenderer[] = [];

function createAlbumWorkbenchScreen(
  options?: Parameters<typeof ReactTestRenderer.create>[1],
) {
  const tree = ReactTestRenderer.create(<AlbumWorkbenchScreen />, options);
  mountedTrees.push(tree);
  return tree;
}

function getActiveGridSelectionCircleCount(
  tree: ReactTestRenderer.ReactTestRenderer,
) {
  const { View: V } = require('react-native');
  return tree.root.findAllByType(V).filter(node => {
    const styles = Array.isArray(node.props.style)
      ? node.props.style
      : [node.props.style];
    return (
      styles.some(
        (style: { height?: number; width?: number } | null | undefined) =>
          style?.width === 22 && style?.height === 22,
      ) &&
      styles.some(
        (
          style:
            | { backgroundColor?: string; borderColor?: string }
            | null
            | undefined,
        ) =>
          style?.backgroundColor === '#3b9fd8' &&
          style?.borderColor === '#3b9fd8',
      )
    );
  }).length;
}

function mockGridItemMeasure(
  tree: ReactTestRenderer.ReactTestRenderer,
  testID: string,
  rect: [number, number, number, number],
) {
  const instance = tree.root.findByProps({ testID }).instance as {
    measureInWindow?: jest.Mock;
  };
  instance.measureInWindow?.mockImplementation(
    (callback: (x: number, y: number, width: number, height: number) => void) =>
      callback(rect[0], rect[1], rect[2], rect[3]),
  );
}

function mockPanResponderHandlers() {
  return jest.spyOn(PanResponder, 'create').mockImplementation(config => {
    return {
      panHandlers: {
        onStartShouldSetResponder: config.onStartShouldSetPanResponder,
        onStartShouldSetResponderCapture:
          config.onStartShouldSetPanResponderCapture,
        onMoveShouldSetResponder: config.onMoveShouldSetPanResponder,
        onMoveShouldSetResponderCapture:
          config.onMoveShouldSetPanResponderCapture,
        onResponderGrant: config.onPanResponderGrant,
        onResponderMove: config.onPanResponderMove,
        onResponderRelease: config.onPanResponderRelease,
        onResponderTerminate: config.onPanResponderTerminate,
        onResponderTerminationRequest: config.onPanResponderTerminationRequest,
        onShouldBlockNativeResponder: config.onShouldBlockNativeResponder,
      },
    } as unknown as ReturnType<typeof PanResponder.create>;
  });
}

const mockedBrowseAlbum = jest.fn();
const mockedGetAlbumStats = jest.fn();
const mockedGetAutoUploadConfig = jest.fn();
const mockedGetPhotoAuthorizationStatus = jest.fn();
const mockedRequestPhotoPermission = jest.fn();
const mockedPresentLimitedPhotoPicker = jest.fn();
const mockedSaveAutoUploadConfig = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    goBack: jest.fn(),
  }),
}));

jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('../../services/SyncEngineModule', () => ({
  browseAlbum: (...args: unknown[]) => mockedBrowseAlbum(...args),
  getAlbumStats: () => mockedGetAlbumStats(),
  submitManualUpload: jest.fn(),
  cancelAllManualUploads: jest.fn(),
  getAutoUploadConfig: () => mockedGetAutoUploadConfig(),
  saveAutoUploadConfig: (...args: unknown[]) =>
    mockedSaveAutoUploadConfig(...args),
  interruptAutoUpload: jest.fn(),
  disableAutoUpload: jest.fn(),
  enableAutoUpload: jest.fn(),
  getPhotoAuthorizationStatus: () => mockedGetPhotoAuthorizationStatus(),
  requestPhotoPermission: () => mockedRequestPhotoPermission(),
  presentLimitedPhotoPicker: () => mockedPresentLimitedPhotoPicker(),
  getAlbumCollections: jest.fn().mockResolvedValue([]),
  getAssetPreviewSource: jest.fn().mockResolvedValue({
    uri: 'file:///tmp/x.jpg',
    mediaType: 'image',
  }),
}));

jest.mock('../../components/Icon', () => ({
  Icon: ({ name }: { name: string }) => {
    const React = require('react');
    const { Text: MockText } = require('react-native');
    return React.createElement(MockText, null, name);
  },
}));

describe('AlbumWorkbenchScreen', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('zh-Hans');
  });

  afterAll(async () => {
    await ReactTestRenderer.act(async () => {
      await i18n.changeLanguage('zh-Hans');
    });
  });

  beforeEach(async () => {
    mockAsyncStorageValues.clear();
    await clearAutoUploadSessionForTest();
    clearRememberedAutoUploadRoundProgressForTest();
    jest.restoreAllMocks();
    jest.spyOn(Animated, 'loop').mockReturnValue({
      start: jest.fn(),
      stop: jest.fn(),
      reset: jest.fn(),
      _startNativeLoop: jest.fn(),
      _isUsingNativeDriver: jest.fn().mockReturnValue(false),
    } as unknown as Animated.CompositeAnimation);

    const nativeModules = NativeModules as typeof NativeModules & {
      NativeSyncEngine?: {
        getBindingState: jest.Mock;
        getSyncOverview: jest.Mock;
        getAlbumStats: jest.Mock;
        triggerSync: jest.Mock;
        addListener: jest.Mock;
        removeListeners: jest.Mock;
      };
    };
    nativeModules.NativeSyncEngine = {
      getBindingState: jest.fn(),
      getSyncOverview: jest.fn(),
      getAlbumStats: jest.fn(),
      triggerSync: jest.fn(),
      addListener: jest.fn(),
      removeListeners: jest.fn(),
    };

    mockedBrowseAlbum.mockResolvedValue([]);
    mockedGetAlbumStats.mockResolvedValue({
      totalCount: 12,
      transferredCount: 0,
      queuedCount: 0,
      pendingCount: 12,
    });
    nativeModules.NativeSyncEngine.getAlbumStats.mockResolvedValue({
      totalCount: 12,
      transferredCount: 0,
      queuedCount: 0,
      pendingCount: 12,
    });
    mockedGetAutoUploadConfig.mockResolvedValue({
      enabled: false,
      state: 'disabled',
      timeRangeMode: 'all',
      customTimeFrom: null,
    });
    mockedGetPhotoAuthorizationStatus.mockResolvedValue('authorized');
    mockedRequestPhotoPermission.mockResolvedValue('authorized');
    mockedPresentLimitedPhotoPicker.mockResolvedValue(undefined);
  });

  afterEach(() => {
    ReactTestRenderer.act(() => {
      mountedTrees.splice(0).forEach(tree => tree.unmount());
    });
  });

  it('requests Android photo permission before reading album assets', async () => {
    const originalPlatformOS = Platform.OS;
    Object.defineProperty(Platform, 'OS', {
      value: 'android',
      configurable: true,
    });

    mockedGetPhotoAuthorizationStatus.mockResolvedValue('denied');
    mockedRequestPhotoPermission.mockResolvedValue('authorized');
    mockedBrowseAlbum.mockResolvedValue([
      {
        assetLocalId: 'android-asset-1',
        filename: 'IMG_ANDROID.JPG',
        mediaType: 'image',
        fileSize: 1024,
        creationDate: '2026-05-01T00:00:00Z',
        thumbnailUri: 'content://media/external/images/media/1',
        isTransferred: false,
        isQueued: false,
      },
    ]);
    mockedGetAlbumStats.mockResolvedValue({
      totalCount: 1,
      transferredCount: 0,
      queuedCount: 0,
      pendingCount: 1,
    });

    try {
      let tree: ReactTestRenderer.ReactTestRenderer | undefined;
      await ReactTestRenderer.act(async () => {
        tree = createAlbumWorkbenchScreen();
      });
      await ReactTestRenderer.act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(mockedRequestPhotoPermission).toHaveBeenCalledTimes(1);
      expect(mockedBrowseAlbum).toHaveBeenCalledWith(
        'all',
        'all',
        0,
        60,
        undefined,
      );
      expect(tree!.root.findByType(FlatList).props.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            assetLocalId: 'android-asset-1',
            filename: 'IMG_ANDROID.JPG',
          }),
        ]),
      );
    } finally {
      Object.defineProperty(Platform, 'OS', {
        value: originalPlatformOS,
        configurable: true,
      });
    }
  });

  it('keeps filter tabs visible when transferred filter has no assets', async () => {
    let tree: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      tree = createAlbumWorkbenchScreen();
    });

    const pressables = tree!.root.findAll(
      node => typeof node.props.onPress === 'function',
    );
    const transferredTab = pressables.find(node => {
      const textNodes = node.findAllByType(Text);
      return textNodes.some(textNode => textNode.props.children === '已传');
    });

    expect(transferredTab).toBeDefined();

    await ReactTestRenderer.act(async () => {
      transferredTab!.props.onPress();
    });

    expect(mockedBrowseAlbum).toHaveBeenLastCalledWith(
      'all',
      'transferred',
      0,
      60,
      undefined,
    );

    const textValues = tree!.root.findAllByType(Text).flatMap(node => {
      const value = node.props.children;
      return typeof value === 'string' ? [value] : [];
    });

    expect(textValues).toContain('暂无已传素材');
    expect(textValues).toContain('全部');
    expect(textValues).toContain('已传');
  });

  it('does not show full-screen loading when switching away from an empty transferred tab', async () => {
    let resolveBrowse: ((value: unknown) => void) | undefined;
    mockedBrowseAlbum
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveBrowse = resolve;
          }),
      );

    let tree: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      tree = createAlbumWorkbenchScreen();
    });

    const findTab = (label: string) =>
      tree!.root
        .findAll(node => typeof node.props.onPress === 'function')
        .find(node => {
          const textNodes = node.findAllByType(Text);
          return textNodes.some(textNode => textNode.props.children === label);
        });

    const transferredTab = findTab('已传');
    expect(transferredTab).toBeDefined();

    await ReactTestRenderer.act(async () => {
      transferredTab!.props.onPress();
    });

    const untransferredTab = findTab('未传');
    expect(untransferredTab).toBeDefined();

    await ReactTestRenderer.act(async () => {
      untransferredTab!.props.onPress();
    });

    const textValuesDuringPending = tree!.root
      .findAllByType(Text)
      .flatMap(node => {
        const value = node.props.children;
        return typeof value === 'string' ? [value] : [];
      });

    expect(textValuesDuringPending).not.toContain('正在加载相册...');
    expect(textValuesDuringPending).toContain('未传');

    await ReactTestRenderer.act(async () => {
      resolveBrowse?.([]);
    });
  });

  it('ignores stale album requests that finish after a newer filter request', async () => {
    let resolveStale: ((value: unknown) => void) | undefined;
    const staleAsset = {
      assetLocalId: 'stale',
      filename: 'STALE.JPG',
      mediaType: 'image',
      fileSize: 1024,
      creationDate: '2026-04-01T00:00:00Z',
      thumbnailUri: 'file:///tmp/stale.jpg',
      isTransferred: true,
      isQueued: false,
    };
    const freshAsset = {
      assetLocalId: 'fresh',
      filename: 'FRESH.JPG',
      mediaType: 'image',
      fileSize: 1024,
      creationDate: '2026-04-02T00:00:00Z',
      thumbnailUri: 'file:///tmp/fresh.jpg',
      isTransferred: false,
      isQueued: false,
    };

    mockedBrowseAlbum
      .mockResolvedValueOnce([])
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveStale = resolve;
          }),
      )
      .mockResolvedValueOnce([freshAsset]);

    let tree: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      tree = createAlbumWorkbenchScreen();
    });

    const findTab = (label: string) =>
      tree!.root
        .findAll(node => typeof node.props.onPress === 'function')
        .find(node => {
          const textNodes = node.findAllByType(Text);
          return textNodes.some(textNode => textNode.props.children === label);
        });

    await ReactTestRenderer.act(async () => {
      findTab('已传')!.props.onPress();
    });

    await ReactTestRenderer.act(async () => {
      findTab('未传')!.props.onPress();
    });

    await ReactTestRenderer.act(async () => {
      resolveStale?.([staleAsset]);
    });

    const { Image } = require('react-native');
    const imageUris = tree!.root
      .findAllByType(Image)
      .map(node => node.props.source?.uri)
      .filter(Boolean);

    expect(imageUris).toContain('file:///tmp/fresh.jpg');
    expect(imageUris).not.toContain('file:///tmp/stale.jpg');
  });

  it('shows limited-access CTA when permission is limited and no assets', async () => {
    // Simulate: limited permission, 0 authorized assets
    mockedGetPhotoAuthorizationStatus.mockResolvedValue('limited');
    mockedBrowseAlbum.mockResolvedValue([]);
    mockedGetAlbumStats.mockResolvedValue({
      totalCount: 0,
      transferredCount: 0,
      queuedCount: 0,
      pendingCount: 0,
    });

    let tree: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      tree = createAlbumWorkbenchScreen();
    });

    const textValues = tree!.root.findAllByType(Text).flatMap(node => {
      const value = node.props.children;
      return typeof value === 'string' ? [value] : [];
    });

    // Should show the limited-access guidance, NOT the generic empty state
    expect(textValues).toContain('尚未选择照片');
    expect(textValues).toContain('选择照片');
    expect(textValues).not.toContain('暂无素材');
  });

  it('calls presentLimitedPhotoPicker when the CTA button is pressed', async () => {
    mockedGetPhotoAuthorizationStatus.mockResolvedValue('limited');
    mockedBrowseAlbum.mockResolvedValue([]);
    mockedGetAlbumStats.mockResolvedValue({
      totalCount: 0,
      transferredCount: 0,
      queuedCount: 0,
      pendingCount: 0,
    });

    let tree: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      tree = createAlbumWorkbenchScreen();
    });

    // Find the "选择照片" button
    const pressables = tree!.root.findAll(
      node => typeof node.props.onPress === 'function',
    );
    const pickerButton = pressables.find(node => {
      const textNodes = node.findAllByType(Text);
      return textNodes.some(textNode => textNode.props.children === '选择照片');
    });

    expect(pickerButton).toBeDefined();

    await ReactTestRenderer.act(async () => {
      pickerButton!.props.onPress();
    });

    expect(mockedPresentLimitedPhotoPicker).toHaveBeenCalled();
  });

  it('does NOT show limited CTA when permission is authorized with 0 assets', async () => {
    mockedGetPhotoAuthorizationStatus.mockResolvedValue('authorized');
    mockedBrowseAlbum.mockResolvedValue([]);
    mockedGetAlbumStats.mockResolvedValue({
      totalCount: 0,
      transferredCount: 0,
      queuedCount: 0,
      pendingCount: 0,
    });

    let tree: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      tree = createAlbumWorkbenchScreen();
    });

    const textValues = tree!.root.findAllByType(Text).flatMap(node => {
      const value = node.props.children;
      return typeof value === 'string' ? [value] : [];
    });

    // Should show the generic empty state, not the limited CTA
    expect(textValues).not.toContain('尚未选择照片');
    expect(textValues).toContain('暂无素材');
  });

  it('still shows limited-access CTA when auto upload is active', async () => {
    mockedGetPhotoAuthorizationStatus.mockResolvedValue('limited');
    mockedBrowseAlbum.mockResolvedValue([]);
    mockedGetAlbumStats.mockResolvedValue({
      totalCount: 0,
      transferredCount: 0,
      queuedCount: 0,
      pendingCount: 0,
    });
    mockedGetAutoUploadConfig.mockResolvedValue({
      enabled: true,
      state: 'active',
      timeRangeMode: 'all',
      customTimeFrom: null,
    });

    let tree: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      tree = createAlbumWorkbenchScreen();
    });

    const textValues = tree!.root.findAllByType(Text).flatMap(node => {
      const value = node.props.children;
      return typeof value === 'string' ? [value] : [];
    });

    expect(textValues).toContain('尚未选择照片');
    expect(textValues).toContain('选择照片');
  });

  it('opens preview modal when item body is tapped', async () => {
    mockedBrowseAlbum.mockResolvedValue([
      {
        assetLocalId: 'a1',
        filename: 'IMG.JPG',
        mediaType: 'image',
        fileSize: 1024,
        creationDate: '2026-04-01T00:00:00Z',
        thumbnailUri: 'file:///tmp/a1.jpg',
        isTransferred: false,
        isQueued: false,
      },
    ]);
    mockedGetAlbumStats.mockResolvedValue({
      totalCount: 1,
      transferredCount: 0,
      queuedCount: 0,
      pendingCount: 1,
    });
    mockedGetAutoUploadConfig.mockResolvedValue({
      enabled: false,
      timeRangeMode: 'all',
      state: 'idle',
    });
    mockedGetPhotoAuthorizationStatus.mockResolvedValue('authorized');

    let tree: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = createAlbumWorkbenchScreen();
    });
    await ReactTestRenderer.act(async () => {
      await Promise.resolve();
    });

    // Find the item-body TouchableOpacity — the outer one that contains an Image
    // with the thumbnail uri. (Inner circle touchable has no Image child.)
    const { Image, TouchableOpacity: TO } = require('react-native');
    const touchables = tree!.root.findAllByType(TO);
    const itemBody = touchables.find(t => {
      const images = t.findAllByType(Image);
      return images.some(i => i.props.source?.uri === 'file:///tmp/a1.jpg');
    });
    expect(itemBody).toBeDefined();
    await ReactTestRenderer.act(async () => {
      itemBody!.props.onPress();
    });
    // After press, the modal should be visible. The modal sets Modal.visible=true;
    // we verify indirectly by asserting the modal-root (a View with backgroundColor #000 style) appears.
    const { View: V } = require('react-native');
    const views = tree!.root.findAllByType(V);
    const modalRoot = views.find(v => {
      const s = v.props.style;
      if (!s) return false;
      const arr = Array.isArray(s) ? s : [s];
      return arr.some(
        (x: { backgroundColor?: string }) => x && x.backgroundColor === '#000',
      );
    });
    expect(modalRoot).toBeDefined();
  });

  it.skip('toggles selection when the top-right circle is tapped', async () => {
    const panResponderCreateSpy = mockPanResponderHandlers();
    mockedBrowseAlbum.mockResolvedValue([
      {
        assetLocalId: 'a1',
        filename: 'IMG.JPG',
        mediaType: 'image',
        fileSize: 1024,
        creationDate: '2026-04-01T00:00:00Z',
        thumbnailUri: 'file:///tmp/a1.jpg',
        isTransferred: false,
        isQueued: false,
      },
    ]);
    mockedGetAlbumStats.mockResolvedValue({
      totalCount: 1,
      transferredCount: 0,
      queuedCount: 0,
      pendingCount: 1,
    });
    mockedGetAutoUploadConfig.mockResolvedValue({
      enabled: false,
      timeRangeMode: 'all',
      state: 'idle',
    });
    mockedGetPhotoAuthorizationStatus.mockResolvedValue('authorized');

    let tree: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = createAlbumWorkbenchScreen();
    });
    await ReactTestRenderer.act(async () => {
      await Promise.resolve();
    });

    const firstGridItem = tree!.root.findByProps({
      testID: 'album-grid-item-a1',
    });
    const startEvent = {
      nativeEvent: {
        pageX: 90,
        pageY: 110,
        locationX: 999,
        locationY: 10,
      },
    };

    expect(
      firstGridItem.props.onStartShouldSetResponderCapture(startEvent),
    ).toBe(true);

    ReactTestRenderer.act(() => {
      firstGridItem.props.onResponderGrant(startEvent);
      firstGridItem.props.onResponderRelease(startEvent);
    });

    // After toggling, the stats card's selected count should become 1.
    const { Text: T } = require('react-native');
    const texts = tree!.root.findAllByType(T).map(n => n.props.children);
    // statValue renders the raw number; with one selected it should appear as 1
    expect(texts).toEqual(expect.arrayContaining([1]));
    panResponderCreateSpy.mockRestore();
  });

  it.skip('selects multiple grid items by dragging from the selection control', async () => {
    jest.useFakeTimers();
    const panResponderCreateSpy = mockPanResponderHandlers();
    const firstAsset = {
      assetLocalId: 'a1',
      filename: 'IMG_1.JPG',
      mediaType: 'image',
      fileSize: 1024,
      creationDate: '2026-04-01T00:00:00Z',
      thumbnailUri: 'file:///tmp/a1.jpg',
      isTransferred: false,
      isQueued: false,
    };
    const secondAsset = {
      assetLocalId: 'a2',
      filename: 'IMG_2.JPG',
      mediaType: 'image',
      fileSize: 1024,
      creationDate: '2026-04-02T00:00:00Z',
      thumbnailUri: 'file:///tmp/a2.jpg',
      isTransferred: false,
      isQueued: false,
    };
    const transferredAsset = {
      assetLocalId: 'a3',
      filename: 'DONE.JPG',
      mediaType: 'image',
      fileSize: 1024,
      creationDate: '2026-04-03T00:00:00Z',
      thumbnailUri: 'file:///tmp/a3.jpg',
      isTransferred: true,
      isQueued: false,
    };
    const measuredRects: Record<string, [number, number, number, number]> = {
      'album-grid-item-a1': [10, 100, 100, 100],
      'album-grid-item-a2': [112, 100, 100, 100],
      'album-grid-item-a3': [214, 100, 100, 100],
    };

    mockedBrowseAlbum.mockResolvedValue([
      firstAsset,
      secondAsset,
      transferredAsset,
    ]);
    mockedGetAlbumStats.mockResolvedValue({
      totalCount: 3,
      transferredCount: 1,
      queuedCount: 0,
      pendingCount: 2,
    });
    mockedGetAutoUploadConfig.mockResolvedValue({
      enabled: false,
      timeRangeMode: 'all',
      state: 'idle',
    });
    mockedGetPhotoAuthorizationStatus.mockResolvedValue('authorized');

    let tree: ReactTestRenderer.ReactTestRenderer;
    try {
      await ReactTestRenderer.act(async () => {
        tree = createAlbumWorkbenchScreen({
          createNodeMock: element => {
            const props = element.props as { testID?: string };
            const rect = props.testID ? measuredRects[props.testID] : undefined;
            if (!rect) return {};
            return {
              measureInWindow: (
                callback: (
                  x: number,
                  y: number,
                  width: number,
                  height: number,
                ) => void,
              ) => callback(rect[0], rect[1], rect[2], rect[3]),
            };
          },
        });
      });
      await ReactTestRenderer.act(async () => {
        await Promise.resolve();
      });
      Object.entries(measuredRects).forEach(([testID, rect]) => {
        mockGridItemMeasure(tree!, testID, rect);
      });

      const firstGridItem = tree!.root.findByProps({
        testID: 'album-grid-item-a1',
      });
      const startEvent = {
        nativeEvent: {
          pageX: 20,
          pageY: 120,
          locationX: 999,
          locationY: 10,
        },
      };

      expect(
        firstGridItem.props.onStartShouldSetResponderCapture(startEvent),
      ).toBe(true);

      ReactTestRenderer.act(() => {
        firstGridItem.props.onResponderGrant(startEvent);
      });
      expect(tree!.root.findByType(FlatList).props.scrollEnabled).toBe(false);
      ReactTestRenderer.act(() => {
        firstGridItem.props.onResponderMove({
          nativeEvent: {
            pageX: 130,
            pageY: 120,
            locationX: 18,
            locationY: 10,
          },
        });
      });
      expect(getActiveGridSelectionCircleCount(tree!)).toBe(0);

      await ReactTestRenderer.act(async () => {
        jest.advanceTimersByTime(200);
        await Promise.resolve();
      });
      expect(getActiveGridSelectionCircleCount(tree!)).toBe(1);

      await ReactTestRenderer.act(async () => {
        firstGridItem.props.onResponderMove({
          nativeEvent: {
            pageX: 130,
            pageY: 120,
            locationX: 18,
            locationY: 10,
          },
        });
        await Promise.resolve();
      });

      ReactTestRenderer.act(() => {
        firstGridItem.props.onResponderMove({
          nativeEvent: {
            pageX: 230,
            pageY: 120,
            locationX: 18,
            locationY: 10,
          },
        });
        firstGridItem.props.onResponderRelease({
          nativeEvent: {
            pageX: 230,
            pageY: 120,
            locationX: 18,
            locationY: 10,
          },
        });
      });
      expect(tree!.root.findByType(FlatList).props.scrollEnabled).toBe(true);

      const texts = tree!.root.findAllByType(Text).map(n => n.props.children);
      expect(getActiveGridSelectionCircleCount(tree!)).toBe(2);
      expect(texts).toEqual(expect.arrayContaining([2]));

      const secondGridItem = tree!.root.findByProps({
        testID: 'album-grid-item-a2',
      });
      expect(
        secondGridItem.props.onStartShouldSetResponderCapture({
          nativeEvent: {
            pageX: 130,
            pageY: 150,
            locationX: 18,
            locationY: 50,
          },
        }),
      ).toBe(false);
    } finally {
      panResponderCreateSpy.mockRestore();
      jest.useRealTimers();
    }
  });

  it.skip('deselects multiple grid items by dragging from a selected item', async () => {
    jest.useFakeTimers();
    const panResponderCreateSpy = mockPanResponderHandlers();
    const firstAsset = {
      assetLocalId: 'a1',
      filename: 'IMG_1.JPG',
      mediaType: 'image',
      fileSize: 1024,
      creationDate: '2026-04-01T00:00:00Z',
      thumbnailUri: 'file:///tmp/a1.jpg',
      isTransferred: false,
      isQueued: false,
    };
    const secondAsset = {
      assetLocalId: 'a2',
      filename: 'IMG_2.JPG',
      mediaType: 'image',
      fileSize: 1024,
      creationDate: '2026-04-02T00:00:00Z',
      thumbnailUri: 'file:///tmp/a2.jpg',
      isTransferred: false,
      isQueued: false,
    };
    const measuredRects: Record<string, [number, number, number, number]> = {
      'album-grid-item-a1': [10, 100, 100, 100],
      'album-grid-item-a2': [112, 100, 100, 100],
    };

    mockedBrowseAlbum.mockResolvedValue([firstAsset, secondAsset]);
    mockedGetAlbumStats.mockResolvedValue({
      totalCount: 2,
      transferredCount: 0,
      queuedCount: 0,
      pendingCount: 2,
    });
    mockedGetAutoUploadConfig.mockResolvedValue({
      enabled: false,
      timeRangeMode: 'all',
      state: 'idle',
    });
    mockedGetPhotoAuthorizationStatus.mockResolvedValue('authorized');

    let tree: ReactTestRenderer.ReactTestRenderer;
    try {
      await ReactTestRenderer.act(async () => {
        tree = createAlbumWorkbenchScreen({
          createNodeMock: element => {
            const props = element.props as { testID?: string };
            const rect = props.testID ? measuredRects[props.testID] : undefined;
            if (!rect) return {};
            return {
              measureInWindow: (
                callback: (
                  x: number,
                  y: number,
                  width: number,
                  height: number,
                ) => void,
              ) => callback(rect[0], rect[1], rect[2], rect[3]),
            };
          },
        });
      });
      await ReactTestRenderer.act(async () => {
        await Promise.resolve();
      });
      Object.entries(measuredRects).forEach(([testID, rect]) => {
        mockGridItemMeasure(tree!, testID, rect);
      });

      const selectByCircleTap = (assetLocalId: string, pageX: number) => {
        const gridItem = tree!.root.findByProps({
          testID: `album-grid-item-${assetLocalId}`,
        });
        const event = {
          nativeEvent: {
            pageX,
            pageY: 120,
            locationX: 999,
            locationY: 10,
          },
        };
        expect(gridItem.props.onStartShouldSetResponderCapture(event)).toBe(
          true,
        );
        ReactTestRenderer.act(() => {
          gridItem.props.onResponderGrant(event);
          gridItem.props.onResponderRelease(event);
        });
      };

      selectByCircleTap('a1', 90);
      selectByCircleTap('a2', 190);
      expect(getActiveGridSelectionCircleCount(tree!)).toBe(2);
      expect(
        tree!.root.findAllByType(Text).map(n => n.props.children),
      ).toContain('已选 2 个素材');

      const firstGridItem = tree!.root.findByProps({
        testID: 'album-grid-item-a1',
      });
      const startEvent = {
        nativeEvent: {
          pageX: 90,
          pageY: 120,
          locationX: 999,
          locationY: 10,
        },
      };

      ReactTestRenderer.act(() => {
        firstGridItem.props.onResponderGrant(startEvent);
      });
      expect(tree!.root.findByType(FlatList).props.scrollEnabled).toBe(false);

      ReactTestRenderer.act(() => {
        firstGridItem.props.onResponderMove({
          nativeEvent: {
            pageX: 130,
            pageY: 120,
            locationX: 18,
            locationY: 10,
          },
        });
      });
      expect(getActiveGridSelectionCircleCount(tree!)).toBe(2);

      ReactTestRenderer.act(() => {
        jest.advanceTimersByTime(200);
      });

      ReactTestRenderer.act(() => {
        firstGridItem.props.onResponderRelease({
          nativeEvent: {
            pageX: 130,
            pageY: 120,
            locationX: 18,
            locationY: 10,
          },
        });
      });

      const texts = tree!.root.findAllByType(Text).map(n => n.props.children);
      expect(tree!.root.findByType(FlatList).props.scrollEnabled).toBe(true);
      expect(getActiveGridSelectionCircleCount(tree!)).toBe(0);
      expect(texts).not.toContain('已选 2 个素材');
    } finally {
      panResponderCreateSpy.mockRestore();
      jest.useRealTimers();
    }
  });

  it.skip('keeps untransferred selections visible when switching back to all', async () => {
    const panResponderCreateSpy = mockPanResponderHandlers();
    const selectableAsset = {
      assetLocalId: 'a1',
      filename: 'IMG.JPG',
      mediaType: 'image',
      fileSize: 1024,
      creationDate: '2026-04-01T00:00:00Z',
      thumbnailUri: 'file:///tmp/a1.jpg',
      isTransferred: false,
      isQueued: false,
    };
    const transferredAsset = {
      assetLocalId: 'a2',
      filename: 'DONE.JPG',
      mediaType: 'image',
      fileSize: 2048,
      creationDate: '2026-04-02T00:00:00Z',
      thumbnailUri: 'file:///tmp/a2.jpg',
      isTransferred: true,
      isQueued: false,
    };

    mockedBrowseAlbum.mockImplementation(
      (_mediaFilter: string, transferFilter: string) => {
        if (transferFilter === 'untransferred') return [selectableAsset];
        if (transferFilter === 'transferred') return [transferredAsset];
        return [selectableAsset, transferredAsset];
      },
    );
    mockedGetAlbumStats.mockResolvedValue({
      totalCount: 2,
      transferredCount: 1,
      queuedCount: 0,
      pendingCount: 1,
    });
    mockedGetAutoUploadConfig.mockResolvedValue({
      enabled: false,
      timeRangeMode: 'all',
      state: 'idle',
    });
    mockedGetPhotoAuthorizationStatus.mockResolvedValue('authorized');

    let tree: ReactTestRenderer.ReactTestRenderer;
    try {
      await ReactTestRenderer.act(async () => {
        tree = createAlbumWorkbenchScreen();
      });
      await ReactTestRenderer.act(async () => {
        await Promise.resolve();
      });

      const findTab = (label: string) =>
        tree!.root
          .findAll(node => typeof node.props.onPress === 'function')
          .find(node => {
            const textNodes = node.findAllByType(Text);
            return textNodes.some(
              textNode => textNode.props.children === label,
            );
          });

      await ReactTestRenderer.act(async () => {
        findTab('未传')!.props.onPress();
      });
      await ReactTestRenderer.act(async () => {
        await Promise.resolve();
      });

      const selectableGridItem = tree!.root.findByProps({
        testID: 'album-grid-item-a1',
      });
      const circleTapEvent = {
        nativeEvent: {
          pageX: 90,
          pageY: 110,
          locationX: 999,
          locationY: 10,
        },
      };

      expect(
        selectableGridItem.props.onStartShouldSetResponderCapture(
          circleTapEvent,
        ),
      ).toBe(true);

      ReactTestRenderer.act(() => {
        selectableGridItem.props.onResponderGrant(circleTapEvent);
        selectableGridItem.props.onResponderRelease(circleTapEvent);
      });

      await ReactTestRenderer.act(async () => {
        findTab('全部')!.props.onPress();
      });
      await ReactTestRenderer.act(async () => {
        await Promise.resolve();
      });

      const textValues = tree!.root.findAllByType(Text).flatMap(node => {
        const value = node.props.children;
        return typeof value === 'string' ? [value] : [];
      });

      expect(getActiveGridSelectionCircleCount(tree!)).toBe(1);
      expect(textValues).toContain('已选 1 个素材');
    } finally {
      panResponderCreateSpy.mockRestore();
    }
  });

  it('locks time range chips when auto upload is active', async () => {
    mockedSaveAutoUploadConfig.mockClear();
    mockedBrowseAlbum.mockResolvedValue([]);
    mockedGetAutoUploadConfig.mockResolvedValue({
      enabled: true,
      state: 'active',
      timeRangeMode: 'all',
      customTimeFrom: null,
    });

    let tree: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(async () => {
      tree = createAlbumWorkbenchScreen();
    });
    // Two microtask flushes: first for getAutoUploadConfig to resolve,
    // second for the subsequent setConfigExpanded(true) re-render to commit.
    await ReactTestRenderer.act(async () => {
      await Promise.resolve();
    });
    await ReactTestRenderer.act(async () => {
      await Promise.resolve();
    });

    // loadConfig auto-expands the card when config.enabled is true,
    // so chips should already be in the tree — no header tap needed.
    const fromNowChip = tree!.root
      .findAll(node => typeof node.props.onPress === 'function')
      .find(node => {
        const textNodes = node.findAllByType(Text);
        return textNodes.some(t => t.props.children === '此时此刻');
      });
    expect(fromNowChip).toBeDefined();
    expect(fromNowChip!.props.disabled).toBe(true);

    await ReactTestRenderer.act(async () => {
      await fromNowChip!.props.onPress();
    });
    expect(mockedSaveAutoUploadConfig).not.toHaveBeenCalled();
  });

  it('shows auto upload transferred count as this-round increment instead of cumulative total', async () => {
    mockedBrowseAlbum.mockResolvedValue([]);
    mockedGetAlbumStats.mockResolvedValue({
      totalCount: 28,
      transferredCount: 8,
      queuedCount: 0,
      pendingCount: 20,
    });
    mockedGetAutoUploadConfig.mockResolvedValue({
      enabled: true,
      state: 'active',
      timeRangeMode: 'all',
      customTimeFrom: null,
    });

    let tree: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(async () => {
      tree = createAlbumWorkbenchScreen();
    });
    await ReactTestRenderer.act(async () => {
      await Promise.resolve();
    });

    const allTextValues = tree!.root
      .findAllByType(Text)
      .flatMap(node => flattenTextChildren(node.props.children));
    const transferredSummaryItem = tree!.root.findAllByType(View).find(node => {
      const itemTextValues = node
        .findAllByType(Text)
        .flatMap(text => flattenTextChildren(text.props.children));
      return itemTextValues.includes('本次已传');
    });

    expect(allTextValues).toContain('本次已传');
    expect(transferredSummaryItem).toBeDefined();
    expect(
      transferredSummaryItem!
        .findAllByType(Text)
        .flatMap(node => flattenTextChildren(node.props.children)),
    ).toContain(0);
    expect(allTextValues).not.toContain(8);
  });

  it('keeps active auto upload round progress when entering album mid-round', async () => {
    const nativeModules = NativeModules as typeof NativeModules & {
      NativeSyncEngine?: {
        getSyncOverview: jest.Mock;
      };
    };
    nativeModules.NativeSyncEngine?.getSyncOverview.mockResolvedValue({
      uploadState: 'uploading',
      completedCount: 3,
      totalCount: 7,
      roundBaselineCompletedCount: 0,
      currentTaskSource: 'auto',
      autoUploadState: 'active',
      autoPending: 4,
    });
    mockedBrowseAlbum.mockResolvedValue([]);
    mockedGetAlbumStats.mockResolvedValue({
      totalCount: 28,
      transferredCount: 3,
      queuedCount: 4,
      pendingCount: 25,
    });
    mockedGetAutoUploadConfig.mockResolvedValue({
      enabled: true,
      state: 'active',
      timeRangeMode: 'custom',
      customTimeFrom: '2026-04-27T09:00:00.000Z',
    });

    let tree: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(async () => {
      tree = createAlbumWorkbenchScreen();
    });
    await ReactTestRenderer.act(async () => {
      await Promise.resolve();
    });

    const transferredSummaryItem = tree!.root.findAllByType(View).find(node => {
      const itemTextValues = node
        .findAllByType(Text)
        .flatMap(text => flattenTextChildren(text.props.children));
      return itemTextValues.includes('本次已传');
    });

    expect(transferredSummaryItem).toBeDefined();
    expect(
      transferredSummaryItem!
        .findAllByType(Text)
        .flatMap(node => flattenTextChildren(node.props.children)),
    ).toContain(3);
  });

  it('infers auto upload session baseline from native round progress when no persisted baseline exists', async () => {
    const nativeModules = NativeModules as typeof NativeModules & {
      NativeSyncEngine?: {
        getSyncOverview: jest.Mock;
        getAlbumStats: jest.Mock;
      };
    };
    nativeModules.NativeSyncEngine?.getSyncOverview.mockResolvedValue({
      uploadState: 'uploading',
      completedCount: 59,
      totalCount: 59,
      roundBaselineCompletedCount: 58,
      currentTaskSource: 'auto',
      autoUploadState: 'active',
      autoPending: 0,
    });
    nativeModules.NativeSyncEngine?.getAlbumStats.mockResolvedValue({
      totalCount: 59,
      transferredCount: 59,
      queuedCount: 0,
      pendingCount: 0,
    });
    mockedBrowseAlbum.mockResolvedValue([]);
    mockedGetAlbumStats.mockResolvedValue({
      totalCount: 59,
      transferredCount: 59,
      queuedCount: 0,
      pendingCount: 0,
    });
    mockedGetAutoUploadConfig.mockResolvedValue({
      enabled: true,
      state: 'active',
      timeRangeMode: 'custom',
      customTimeFrom: '2026-04-27T09:00:00.000Z',
    });

    let tree: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(async () => {
      tree = createAlbumWorkbenchScreen();
    });
    await ReactTestRenderer.act(async () => {
      await Promise.resolve();
    });

    const transferredSummaryItem = tree!.root.findAllByType(View).find(node => {
      const itemTextValues = node
        .findAllByType(Text)
        .flatMap(text => flattenTextChildren(text.props.children));
      return itemTextValues.includes('本次已传');
    });

    expect(transferredSummaryItem).toBeDefined();
    expect(
      transferredSummaryItem!
        .findAllByType(Text)
        .flatMap(node => flattenTextChildren(node.props.children)),
    ).toContain(1);
  });

  it('keeps the last completed auto round after native settles back to idle', async () => {
    await setAutoUploadSessionBaselineForTest(45);
    const nativeModules = NativeModules as typeof NativeModules & {
      NativeSyncEngine?: {
        getSyncOverview: jest.Mock;
        getAlbumStats: jest.Mock;
      };
    };
    nativeModules.NativeSyncEngine?.getSyncOverview.mockResolvedValue({
      uploadState: 'idle',
      completedCount: 0,
      totalCount: 0,
      currentTaskSource: null,
      autoUploadState: 'active',
      autoPending: 0,
    });
    nativeModules.NativeSyncEngine?.getAlbumStats.mockResolvedValue({
      totalCount: 47,
      transferredCount: 47,
      queuedCount: 0,
      pendingCount: 0,
    });
    mockedBrowseAlbum.mockResolvedValue([]);
    mockedGetAlbumStats.mockResolvedValue({
      totalCount: 47,
      transferredCount: 47,
      queuedCount: 0,
      pendingCount: 0,
    });
    mockedGetAutoUploadConfig.mockResolvedValue({
      enabled: true,
      state: 'active',
      timeRangeMode: 'custom',
      customTimeFrom: '2026-04-27T09:00:00.000Z',
    });

    let tree: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(async () => {
      tree = createAlbumWorkbenchScreen();
    });
    await ReactTestRenderer.act(async () => {
      await Promise.resolve();
    });

    const transferredSummaryItem = tree!.root.findAllByType(View).find(node => {
      const itemTextValues = node
        .findAllByType(Text)
        .flatMap(text => flattenTextChildren(text.props.children));
      return itemTextValues.includes('本次已传');
    });

    expect(transferredSummaryItem).toBeDefined();
    expect(
      transferredSummaryItem!
        .findAllByType(Text)
        .flatMap(node => flattenTextChildren(node.props.children)),
    ).toContain(2);
  });
});
