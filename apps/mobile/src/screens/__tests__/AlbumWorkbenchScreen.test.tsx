import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Animated, NativeModules, Text } from 'react-native';

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

import i18n from '../../i18n';
import { AlbumWorkbenchScreen } from '../AlbumWorkbenchScreen';

const mockedBrowseAlbum = jest.fn();
const mockedGetAlbumStats = jest.fn();
const mockedGetAutoUploadConfig = jest.fn();
const mockedGetPhotoAuthorizationStatus = jest.fn();
const mockedPresentLimitedPhotoPicker = jest.fn();

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
  saveAutoUploadConfig: jest.fn(),
  interruptAutoUpload: jest.fn(),
  enableAutoUpload: jest.fn(),
  getPhotoAuthorizationStatus: () => mockedGetPhotoAuthorizationStatus(),
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

  beforeEach(() => {
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
        triggerSync: jest.Mock;
        addListener: jest.Mock;
        removeListeners: jest.Mock;
      };
    };
    nativeModules.NativeSyncEngine = {
      getBindingState: jest.fn(),
      getSyncOverview: jest.fn(),
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
    mockedGetAutoUploadConfig.mockResolvedValue({
      enabled: false,
      state: 'disabled',
      timeRangeMode: 'all',
      customTimeFrom: null,
    });
    mockedGetPhotoAuthorizationStatus.mockResolvedValue('authorized');
    mockedPresentLimitedPhotoPicker.mockResolvedValue(undefined);
  });

  it('keeps filter tabs visible when transferred filter has no assets', async () => {
    let tree: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(<AlbumWorkbenchScreen />);
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

    expect(mockedBrowseAlbum).toHaveBeenLastCalledWith('all', 'transferred', 0, 60, undefined);

    const textValues = tree!.root
      .findAllByType(Text)
      .flatMap(node => {
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
      tree = ReactTestRenderer.create(<AlbumWorkbenchScreen />);
    });

    const findTab = (label: string) =>
      tree!.root.findAll(node => typeof node.props.onPress === 'function').find(node => {
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
      tree = ReactTestRenderer.create(<AlbumWorkbenchScreen />);
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
      tree = ReactTestRenderer.create(<AlbumWorkbenchScreen />);
    });

    const textValues = tree!.root
      .findAllByType(Text)
      .flatMap(node => {
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
      tree = ReactTestRenderer.create(<AlbumWorkbenchScreen />);
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
      tree = ReactTestRenderer.create(<AlbumWorkbenchScreen />);
    });

    const textValues = tree!.root
      .findAllByType(Text)
      .flatMap(node => {
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
      tree = ReactTestRenderer.create(<AlbumWorkbenchScreen />);
    });

    const textValues = tree!.root
      .findAllByType(Text)
      .flatMap(node => {
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
    mockedGetAlbumStats.mockResolvedValue({ totalCount: 1, transferredCount: 0, queuedCount: 0, pendingCount: 1 });
    mockedGetAutoUploadConfig.mockResolvedValue({ enabled: false, timeRangeMode: 'all', state: 'idle' });
    mockedGetPhotoAuthorizationStatus.mockResolvedValue('authorized');

    let tree: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(<AlbumWorkbenchScreen />);
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
      return arr.some((x: { backgroundColor?: string }) => x && x.backgroundColor === '#000');
    });
    expect(modalRoot).toBeDefined();
  });

  it('toggles selection when the top-right circle is tapped', async () => {
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
    mockedGetAlbumStats.mockResolvedValue({ totalCount: 1, transferredCount: 0, queuedCount: 0, pendingCount: 1 });
    mockedGetAutoUploadConfig.mockResolvedValue({ enabled: false, timeRangeMode: 'all', state: 'idle' });
    mockedGetPhotoAuthorizationStatus.mockResolvedValue('authorized');

    let tree: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(<AlbumWorkbenchScreen />);
    });
    await ReactTestRenderer.act(async () => {
      await Promise.resolve();
    });

    const { TouchableOpacity: TO } = require('react-native');
    const touchables = tree!.root.findAllByType(TO);
    // The selection circle's TouchableOpacity has a hitSlop prop and no Image child.
    const circle = touchables.find(
      t => t.props.hitSlop && t.props.hitSlop.top === 12,
    );
    expect(circle).toBeDefined();
    await ReactTestRenderer.act(async () => {
      circle!.props.onPress();
    });

    // After toggling, the stats card's selected count should become 1.
    const { Text: T } = require('react-native');
    const texts = tree!.root.findAllByType(T).map(n => n.props.children);
    // statValue renders the raw number; with one selected it should appear as 1
    expect(texts).toEqual(expect.arrayContaining([1]));
  });
});
