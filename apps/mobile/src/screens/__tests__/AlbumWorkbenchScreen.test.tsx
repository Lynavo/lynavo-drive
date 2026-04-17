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
    await i18n.changeLanguage('zh');
  });

  afterAll(async () => {
    await ReactTestRenderer.act(async () => {
      await i18n.changeLanguage('zh');
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

  it('shows limited-access CTA when permission is limited and no assets', async () => {
    // Simulate: limited permission, 0 authorized assets
    mockedGetPhotoAuthorizationStatus.mockResolvedValue('limited');
    mockedBrowseAlbum.mockResolvedValue([]);
    mockedGetAlbumStats.mockResolvedValue({
      totalCount: 0,
      transferredCount: 0,
      queuedCount: 0,
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
});
