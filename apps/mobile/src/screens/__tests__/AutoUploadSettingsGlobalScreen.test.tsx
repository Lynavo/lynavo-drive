import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Alert, StyleSheet, Text, TouchableOpacity } from 'react-native';
import {
  disableAutoUpload,
  enableAutoUpload,
  getAutoUploadConfig,
  pickDocumentUploads,
  prepareAutoUploadEnable,
  saveAutoUploadConfig,
  submitDocumentUploads,
} from '../../services/SyncEngineModule';

const mockGoBack = jest.fn();
const mockDispatch = jest.fn();
const mockCanGoBack = jest.fn();

jest.mock('@react-navigation/native', () => ({
  CommonActions: {
    reset: jest.fn(payload => ({ type: 'RESET', payload })),
  },
  useNavigation: () => ({
    goBack: mockGoBack,
    dispatch: mockDispatch,
    canGoBack: mockCanGoBack,
  }),
}));

jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('../../components/GlobalGradientBackground', () => ({
  GlobalGradientBackground: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

jest.mock('../../components/GlobalBottomTabBar', () => ({
  GlobalBottomTabBar: () => {
    const React = require('react');
    const { Text: MockText } = require('react-native');
    return React.createElement(
      MockText,
      { testID: 'mock-bottom-tab-bar' },
      'GlobalBottomTabBar',
    );
  },
}));

jest.mock('../../components/Icon', () => ({
  Icon: ({ name }: { name: string }) => {
    const React = require('react');
    const { Text: MockText } = require('react-native');
    return React.createElement(MockText, null, name);
  },
}));

jest.mock('lucide-react-native', () => {
  const React = require('react');
  const { View } = require('react-native');
  const createIcon =
    (fallbackTestID: string) =>
    ({ testID, ...props }: { testID?: string }) =>
      React.createElement(View, {
        testID: testID ?? fallbackTestID,
        ...props,
      });
  return {
    Calendar: createIcon('mock-calendar-icon'),
    Check: createIcon('mock-check-icon'),
    ChevronLeft: createIcon('mock-chevron-left-icon'),
    ChevronRight: createIcon('mock-chevron-right-icon'),
    Clock: createIcon('mock-clock-icon'),
    CloudDownload: createIcon('mock-cloud-download-icon'),
    File: createIcon('mock-file-icon'),
    Folder: createIcon('mock-folder-icon'),
    Image: createIcon('mock-image-icon'),
    ShieldCheck: createIcon('mock-shield-check-icon'),
    X: createIcon('mock-x-icon'),
  };
});

jest.mock('../../services/SyncEngineModule', () => ({
  disableAutoUpload: jest.fn().mockResolvedValue(undefined),
  enableAutoUpload: jest.fn().mockResolvedValue(undefined),
  getAutoUploadConfig: jest.fn().mockResolvedValue({
    enabled: true,
    timeRangeMode: 'all',
    state: 'active',
  }),
  pickDocumentUploads: jest.fn().mockResolvedValue({
    queuedCount: 0,
    skippedCount: 0,
    batchId: '',
    files: [],
  }),
  prepareAutoUploadEnable: jest.fn().mockResolvedValue(undefined),
  saveAutoUploadConfig: jest.fn().mockResolvedValue(undefined),
  submitDocumentUploads: jest.fn().mockResolvedValue({
    queuedCount: 0,
    skippedCount: 0,
    batchId: '',
    files: [],
  }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      const copy: Record<string, string> = {
        'syncActivity.autoUploadSettings.title': '自动上传',
        'syncActivity.autoUploadSettings.confirmEnable': '开启自动上传',
        'syncActivity.autoUploadSettings.sourceAlbumTitle': '照片和视频',
        'syncActivity.autoUploadSettings.sourceAlbumDesc':
          '同步系统相册中的媒体内容',
        'syncActivity.autoUploadSettings.sourceFileTitle': '指定文件',
        'syncActivity.autoUploadSettings.sourceFileDescEmpty':
          '从系统文件中选择需要同步的内容',
        'syncActivity.autoUploadSettings.sourcesTitle': '同步来源',
        'syncActivity.autoUploadSettings.addFile': '添加',
        'syncActivity.autoUploadSettings.rangeTitle': '同步范围',
        'syncActivity.autoUploadSettings.rangeAllTitle': '全部内容',
        'syncActivity.autoUploadSettings.rangeAllDesc': '同步现有照片和视频',
        'syncActivity.autoUploadSettings.rangeNowTitle': '从现在开始',
        'syncActivity.autoUploadSettings.rangeNowDesc': '仅同步后续新增内容',
        'syncActivity.autoUploadSettings.rangeCustomTitle': '自定义时间',
        'syncActivity.autoUploadSettings.rangeCustomDesc': '按指定时间起点同步',
        'syncActivity.autoUploadSettings.customPickerSave': '保存',
        'syncActivity.autoUploadSettings.infoAlbumAll':
          '相册照片和视频将同步到电脑。',
        'syncActivity.autoUploadSettings.infoEmpty': '请选择至少一个同步来源。',
        common: '',
        'common.confirm': '确认',
      };
      return copy[key] ?? '';
    },
  }),
}));

import { AutoUploadSettingsGlobalScreen } from '../AutoUploadSettingsGlobalScreen';

async function renderScreen() {
  let tree: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<AutoUploadSettingsGlobalScreen />);
    await Promise.resolve();
  });
  return tree!;
}

function getTextValues(tree: ReactTestRenderer.ReactTestRenderer) {
  return tree.root.findAllByType(Text).flatMap(node => {
    const value = node.props.children;
    return typeof value === 'string' || typeof value === 'number'
      ? [value]
      : [];
  });
}

function getAutoUploadSwitch(tree: ReactTestRenderer.ReactTestRenderer) {
  return tree.root.findByProps({ testID: 'auto-upload-enabled-switch' });
}

const mockedDisableAutoUpload = disableAutoUpload as jest.Mock;
const mockedEnableAutoUpload = enableAutoUpload as jest.Mock;
const mockedGetAutoUploadConfig = getAutoUploadConfig as jest.Mock;
const mockedPickDocumentUploads = pickDocumentUploads as jest.Mock;
const mockedPrepareAutoUploadEnable = prepareAutoUploadEnable as jest.Mock;
const mockedSaveAutoUploadConfig = saveAutoUploadConfig as jest.Mock;
const mockedSubmitDocumentUploads = submitDocumentUploads as jest.Mock;

describe('AutoUploadSettingsGlobalScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCanGoBack.mockReturnValue(true);
    mockedDisableAutoUpload.mockResolvedValue(undefined);
    mockedEnableAutoUpload.mockResolvedValue(undefined);
    mockedGetAutoUploadConfig.mockResolvedValue({
      enabled: true,
      timeRangeMode: 'all',
      state: 'active',
    });
    mockedPickDocumentUploads.mockResolvedValue({
      queuedCount: 0,
      skippedCount: 0,
      batchId: '',
      files: [],
    });
    mockedPrepareAutoUploadEnable.mockResolvedValue(undefined);
    mockedSaveAutoUploadConfig.mockResolvedValue(undefined);
    mockedSubmitDocumentUploads.mockResolvedValue({
      queuedCount: 0,
      skippedCount: 0,
      batchId: '',
      files: [],
    });
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders the reference-style sync plan summary before source controls', async () => {
    const tree = await renderScreen();
    const textValues = getTextValues(tree);

    expect(textValues).toContain('同步计划');
    expect(textValues).toContain('自动上传开关');
    expect(textValues).toContain('相册照片和视频将同步到电脑。');
    expect(textValues).toContain('来源');
    expect(textValues).toContain('文件');
    expect(textValues).toContain('范围');
    expect(textValues).toContain('全部内容');
    expect(textValues).toContain('同步来源');
    expect(textValues).toContain('照片和视频');
    expect(textValues).toContain('同步系统相册中的媒体内容');
    expect(textValues).toContain('指定文件');
    expect(textValues).toContain('从系统文件中选择需要同步的内容');
    expect(textValues).toContain('添加');
    expect(textValues).not.toContain('0 B');
    expect(textValues).toContain('同步范围');
    expect(textValues).toContain('同步现有照片和视频');
    expect(textValues).toContain('仅同步后续新增内容');
    expect(textValues).toContain('自定义时间');
    expect(textValues).toContain('按指定时间起点同步');
    expect(textValues).not.toContain('shield-checkmark-outline');
    expect(
      tree.root.findByProps({ testID: 'auto-upload-info-icon' }),
    ).toBeTruthy();
    expect(
      tree.root.findAllByProps({ testID: 'auto-upload-confirm' }),
    ).toHaveLength(0);
  });

  it('renders an independent auto upload switch without changing source selection', async () => {
    const tree = await renderScreen();
    const enabledSwitch = getAutoUploadSwitch(tree);

    expect(enabledSwitch.props.value).toBe(true);
    expect(enabledSwitch.props.accessibilityRole).toBe('switch');
    expect(enabledSwitch.props.accessibilityState).toMatchObject({
      checked: true,
    });
    expect(
      tree.root.findByProps({ testID: 'auto-upload-source-album' }).props
        .accessibilityState,
    ).toMatchObject({ selected: true });
  });

  it('hides source and range controls when the auto upload switch is off', async () => {
    const tree = await renderScreen();

    await ReactTestRenderer.act(async () => {
      await getAutoUploadSwitch(tree).props.onValueChange(false);
    });

    expect(mockedDisableAutoUpload).toHaveBeenCalledTimes(1);
    expect(
      tree.root.findAllByProps({ testID: 'auto-upload-source-album' }),
    ).toHaveLength(0);
    expect(
      tree.root.findAllByProps({ testID: 'auto-upload-add-file' }),
    ).toHaveLength(0);
    expect(
      tree.root.findAllByProps({ testID: 'auto-upload-range-all' }),
    ).toHaveLength(0);
    expect(getTextValues(tree)).toContain(
      '自动上传关闭后，不会同步后续新增素材。',
    );
    expect(
      tree.root.findAllByProps({ testID: 'auto-upload-confirm' }),
    ).toHaveLength(0);
  });

  it('keeps the file add action inline with the specified-file source row', async () => {
    const tree = await renderScreen();
    const addButton = tree.root.findByProps({
      testID: 'auto-upload-add-file',
    });

    expect(addButton.parent?.props.style).toMatchObject({
      flexDirection: 'row',
      alignItems: 'center',
    });
  });

  it('uses reference-style source and range icons instead of generic ionicons', async () => {
    const tree = await renderScreen();
    const textValues = getTextValues(tree);
    const sourceAlbumIcon = tree.root.findByProps({
      testID: 'auto-upload-source-album-icon',
    });
    const sourceFileIcon = tree.root.findByProps({
      testID: 'auto-upload-source-file-icon',
    });
    const rangeAllIcon = tree.root.findByProps({
      testID: 'auto-upload-range-all-icon',
    });
    const rangeNowIcon = tree.root.findByProps({
      testID: 'auto-upload-range-now-icon',
    });
    const rangeCustomIcon = tree.root.findByProps({
      testID: 'auto-upload-range-custom-icon',
    });

    expect(
      tree.root.findByProps({ testID: 'auto-upload-plan-icon' }),
    ).toBeTruthy();
    expect(sourceAlbumIcon.props.size).toBe(20);
    expect(sourceFileIcon.props.size).toBe(20);
    expect(rangeAllIcon.props.size).toBe(18);
    expect(rangeNowIcon.props.size).toBe(18);
    expect(rangeCustomIcon.props.size).toBe(18);
    expect(sourceAlbumIcon.props.color).toBe('#fff');
    expect(sourceFileIcon.props.color).toBe('#7B8490');
    expect(rangeAllIcon.props.color).toBe('#fff');
    expect(textValues).not.toContain('auto-upload-image');
    expect(textValues).not.toContain('auto-upload-file');
    expect(textValues).not.toContain('auto-upload-folder');
    expect(textValues).not.toContain('auto-upload-clock');
    expect(textValues).not.toContain('auto-upload-calendar');
    expect(textValues).not.toContain('cloud-download-outline');
    expect(textValues).not.toContain('shield-checkmark-outline');
    expect(textValues).not.toContain('image-outline');
    expect(textValues).not.toContain('folder-outline');
    expect(textValues).not.toContain('time-outline');
    expect(textValues).not.toContain('calendar-outline');
  });

  it('keeps title and icon containers aligned with the global reference layout', async () => {
    const tree = await renderScreen();
    const titleNode = tree.root.findAllByType(Text).find(node => {
      return node.props.children === '自动上传';
    });
    const backIcon = tree.root.findByProps({
      testID: 'auto-upload-back-icon',
    });
    const albumIcon = tree.root.findByProps({
      testID: 'auto-upload-source-album-icon',
    });
    const rangeAllIcon = tree.root.findByProps({
      testID: 'auto-upload-range-all-icon',
    });
    const rangeCustomSelectionBox = tree.root.findByProps({
      testID: 'auto-upload-range-custom-check-icon-box',
    });

    expect(StyleSheet.flatten(titleNode?.props.style)).toMatchObject({
      fontSize: 17,
      fontWeight: '600',
      color: '#17191C',
    });
    expect(backIcon.props.color).toBe('#17191C');
    expect(StyleSheet.flatten(albumIcon.parent?.props.style)).toMatchObject({
      width: 44,
      height: 44,
      borderRadius: 13,
    });
    expect(StyleSheet.flatten(rangeAllIcon.parent?.props.style)).toMatchObject({
      width: 40,
      height: 40,
      borderRadius: 12,
    });
    expect(
      tree.root.findAllByProps({
        testID: 'auto-upload-range-custom-chevron-icon',
      }),
    ).toHaveLength(0);
    expect(
      StyleSheet.flatten(rangeCustomSelectionBox.props.style),
    ).toMatchObject({
      width: 24,
      height: 24,
      borderRadius: 8,
      borderColor: '#C9D6E4',
      backgroundColor: 'rgba(255,255,255,0.72)',
    });
  });

  it('does not render the main tabbar on the auto upload child page', async () => {
    const tree = await renderScreen();

    expect(
      tree.root.findAllByProps({ testID: 'mock-bottom-tab-bar' }),
    ).toHaveLength(0);
  });

  it('falls back to the sync activity screen when there is no back stack', async () => {
    mockCanGoBack.mockReturnValue(false);
    const tree = await renderScreen();
    const backButton = tree.root.findAllByType(TouchableOpacity)[0];

    ReactTestRenderer.act(() => {
      backButton.props.onPress();
    });

    expect(mockGoBack).not.toHaveBeenCalled();
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'RESET',
      payload: {
        index: 0,
        routes: [{ name: 'SyncActivity' }],
      },
    });
  });

  it('exposes the back button for automation and accessibility', async () => {
    const tree = await renderScreen();

    expect(
      tree.root.findByProps({ testID: 'auto-upload-back' }).props,
    ).toMatchObject({
      accessibilityRole: 'button',
      accessibilityLabel: '返回',
    });
  });

  it('toggles the album source independently from the auto upload switch', async () => {
    const tree = await renderScreen();
    const albumSource = tree.root.findByProps({
      testID: 'auto-upload-source-album',
    });

    expect(albumSource.props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(
      tree.root.findAllByProps({ testID: 'auto-upload-confirm' }),
    ).toHaveLength(0);
    expect(getAutoUploadSwitch(tree).props.value).toBe(true);

    ReactTestRenderer.act(() => {
      albumSource.props.onPress();
    });

    const updatedAlbumSource = tree.root.findByProps({
      testID: 'auto-upload-source-album',
    });
    expect(updatedAlbumSource.props.accessibilityState).toMatchObject({
      selected: false,
    });
    expect(
      tree.root.findAllByProps({ testID: 'auto-upload-confirm' }),
    ).toHaveLength(0);
    expect(getAutoUploadSwitch(tree).props.value).toBe(true);
  });

  it('hydrates the saved native config before users edit settings', async () => {
    mockedGetAutoUploadConfig.mockResolvedValueOnce({
      enabled: false,
      timeRangeMode: 'custom',
      customTimeFrom: '2026-06-16T03:04:05.000Z',
      state: 'disabled',
    });

    const tree = await renderScreen();

    expect(mockedGetAutoUploadConfig).toHaveBeenCalledTimes(1);
    expect(getAutoUploadSwitch(tree).props.value).toBe(false);
    expect(
      tree.root.findAllByProps({ testID: 'auto-upload-source-album' }),
    ).toHaveLength(0);
    expect(
      tree.root.findAllByProps({ testID: 'auto-upload-range-custom' }),
    ).toHaveLength(0);
    expect(
      tree.root.findAllByProps({ testID: 'auto-upload-confirm' }),
    ).toHaveLength(0);
    await ReactTestRenderer.act(async () => {
      await getAutoUploadSwitch(tree).props.onValueChange(true);
    });
    expect(getAutoUploadSwitch(tree).props.accessibilityState).toMatchObject({
      checked: true,
    });
    expect(
      tree.root.findByProps({ testID: 'auto-upload-source-album' }).props
        .accessibilityState,
    ).toMatchObject({ selected: true });
    expect(
      tree.root.findByProps({ testID: 'auto-upload-range-custom' }).props
        .accessibilityState,
    ).toMatchObject({ selected: true });
    expect(mockedPrepareAutoUploadEnable).toHaveBeenCalledTimes(1);
    expect(mockedSaveAutoUploadConfig).toHaveBeenCalledWith({
      enabled: true,
      timeRangeMode: 'custom',
      customTimeFrom: '2026-06-16T03:04:05.000Z',
    });
    expect(mockedEnableAutoUpload).toHaveBeenCalledWith({
      skipPermissionPreflight: true,
    });
  });

  it('does not save or enable auto upload when native config hydration fails', async () => {
    mockedGetAutoUploadConfig.mockRejectedValueOnce(
      new Error('native config unavailable'),
    );
    const tree = await renderScreen();

    expect(
      tree.root.findAllByProps({ testID: 'auto-upload-confirm' }),
    ).toHaveLength(0);
    expect(getAutoUploadSwitch(tree).props.disabled).toBe(true);
    expect(getTextValues(tree)).toContain('自动上传设置读取失败，请稍后重试。');

    await ReactTestRenderer.act(async () => {
      await getAutoUploadSwitch(tree).props.onValueChange(true);
    });

    expect(mockedPrepareAutoUploadEnable).not.toHaveBeenCalled();
    expect(mockedSaveAutoUploadConfig).not.toHaveBeenCalled();
    expect(mockedEnableAutoUpload).not.toHaveBeenCalled();
  });

  it('hides sync range controls when only specified files are selected', async () => {
    mockedGetAutoUploadConfig.mockResolvedValueOnce({
      enabled: true,
      timeRangeMode: 'all',
      state: 'active',
    });
    mockedPickDocumentUploads.mockResolvedValueOnce({
      queuedCount: 1,
      skippedCount: 0,
      batchId: 'document-batch-1',
      files: [
        {
          name: 'Brand Guidelines.pdf',
          size: 2 * 1024 * 1024,
          mimeType: 'application/pdf',
          uri: 'content://docs/brand-guidelines',
        },
      ],
    });
    const tree = await renderScreen();

    ReactTestRenderer.act(() => {
      tree.root
        .findByProps({ testID: 'auto-upload-source-album' })
        .props.onPress();
    });

    await ReactTestRenderer.act(async () => {
      await tree.root
        .findByProps({ testID: 'auto-upload-add-file' })
        .props.onPress();
    });

    const textValues = getTextValues(tree);
    expect(textValues).not.toContain('同步范围');
    expect(
      tree.root.findAllByProps({ testID: 'auto-upload-range-all' }),
    ).toHaveLength(0);
    expect(
      tree.root.findAllByProps({ testID: 'auto-upload-range-now' }),
    ).toHaveLength(0);
    expect(
      tree.root.findAllByProps({ testID: 'auto-upload-range-custom' }),
    ).toHaveLength(0);
  });

  it('queues selected system files from the specified-file source', async () => {
    mockedGetAutoUploadConfig.mockResolvedValueOnce({
      enabled: true,
      timeRangeMode: 'all',
      state: 'active',
    });
    mockedPickDocumentUploads.mockResolvedValueOnce({
      queuedCount: 2,
      skippedCount: 0,
      batchId: 'document-batch-1',
      files: [
        {
          name: 'Brand Guidelines.pdf',
          size: 2 * 1024 * 1024,
          mimeType: 'application/pdf',
          uri: 'content://docs/brand-guidelines',
        },
        {
          name: 'Launch Clip.mov',
          size: 12 * 1024 * 1024,
          mimeType: 'video/quicktime',
          uri: 'content://docs/launch-clip',
        },
      ],
    });
    mockedSubmitDocumentUploads.mockResolvedValueOnce({
      queuedCount: 2,
      skippedCount: 0,
      batchId: 'document-batch-1',
      files: [],
    });
    const tree = await renderScreen();

    ReactTestRenderer.act(() => {
      tree.root
        .findByProps({ testID: 'auto-upload-source-album' })
        .props.onPress();
    });

    await ReactTestRenderer.act(async () => {
      await tree.root
        .findByProps({ testID: 'auto-upload-add-file' })
        .props.onPress();
    });

    const textValues = getTextValues(tree);
    expect(mockedPickDocumentUploads).toHaveBeenCalledTimes(1);
    expect(mockedSubmitDocumentUploads).not.toHaveBeenCalled();
    expect(textValues).toContain('已选文件');
    expect(textValues).toContain('Brand Guidelines.pdf');
    expect(textValues).toContain('Launch Clip.mov');
    expect(textValues).toContain('继续添加');
    expect(Alert.alert).not.toHaveBeenCalledWith(
      '暂不可用',
      expect.any(String),
    );

    const confirmButton = tree.root.findByProps({
      testID: 'auto-upload-confirm',
    });
    expect(confirmButton.props.disabled).toBe(false);

    await ReactTestRenderer.act(async () => {
      await confirmButton.props.onPress();
    });

    expect(mockedSubmitDocumentUploads).toHaveBeenCalledWith([
      {
        name: 'Brand Guidelines.pdf',
        size: 2 * 1024 * 1024,
        mimeType: 'application/pdf',
        uri: 'content://docs/brand-guidelines',
      },
      {
        name: 'Launch Clip.mov',
        size: 12 * 1024 * 1024,
        mimeType: 'video/quicktime',
        uri: 'content://docs/launch-clip',
      },
    ]);
    expect(mockedPrepareAutoUploadEnable).not.toHaveBeenCalled();
    expect(mockedSaveAutoUploadConfig).not.toHaveBeenCalled();
    expect(mockedEnableAutoUpload).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith(
      '确认',
      '已加入 2 个文件到同步队列',
      expect.any(Array),
    );
  });

  it('deduplicates files selected across multiple document picker sessions', async () => {
    mockedGetAutoUploadConfig.mockResolvedValueOnce({
      enabled: true,
      timeRangeMode: 'all',
      state: 'active',
    });
    mockedPickDocumentUploads
      .mockResolvedValueOnce({
        queuedCount: 1,
        skippedCount: 0,
        batchId: 'document-batch-1',
        files: [
          {
            name: 'Brand Guidelines.pdf',
            size: 2 * 1024 * 1024,
            mimeType: 'application/pdf',
            uri: 'file:///source/brand-guidelines.pdf',
          },
        ],
      })
      .mockResolvedValueOnce({
        queuedCount: 1,
        skippedCount: 1,
        batchId: 'document-batch-2',
        files: [
          {
            name: 'Brand Guidelines.pdf',
            size: 2 * 1024 * 1024,
            mimeType: 'application/pdf',
            uri: 'file:///source/brand-guidelines.pdf',
          },
          {
            name: 'Launch Clip.mov',
            size: 12 * 1024 * 1024,
            mimeType: 'video/quicktime',
            uri: 'file:///source/launch-clip.mov',
          },
        ],
      });
    const tree = await renderScreen();
    const addButton = tree.root.findByProps({
      testID: 'auto-upload-add-file',
    });

    await ReactTestRenderer.act(async () => {
      await addButton.props.onPress();
    });
    await ReactTestRenderer.act(async () => {
      await tree.root
        .findByProps({ testID: 'auto-upload-add-file' })
        .props.onPress();
    });

    const textValues = getTextValues(tree);
    expect(mockedPickDocumentUploads).toHaveBeenCalledTimes(2);
    expect(
      textValues.filter(value => value === 'Brand Guidelines.pdf'),
    ).toHaveLength(1);
    expect(textValues).toContain('Launch Clip.mov');
    expect(textValues).toContain('已选择 2 个文件');
    expect(textValues).not.toContain('另有 1 个文件');
  });

  it('shows a skipped duplicate notice when selected files are picked again', async () => {
    mockedGetAutoUploadConfig.mockResolvedValueOnce({
      enabled: true,
      timeRangeMode: 'all',
      state: 'active',
    });
    mockedPickDocumentUploads
      .mockResolvedValueOnce({
        queuedCount: 1,
        skippedCount: 0,
        batchId: 'document-batch-1',
        files: [
          {
            name: 'Brand Guidelines.pdf',
            size: 2 * 1024 * 1024,
            mimeType: 'application/pdf',
            uri: 'file:///source/brand-guidelines.pdf',
          },
        ],
      })
      .mockResolvedValueOnce({
        queuedCount: 0,
        skippedCount: 1,
        batchId: 'document-batch-2',
        files: [],
      });
    const tree = await renderScreen();

    await ReactTestRenderer.act(async () => {
      await tree.root
        .findByProps({ testID: 'auto-upload-add-file' })
        .props.onPress();
    });
    await ReactTestRenderer.act(async () => {
      await tree.root
        .findByProps({ testID: 'auto-upload-add-file' })
        .props.onPress();
    });

    const textValues = getTextValues(tree);
    expect(textValues).toContain('已跳过 1 个已选文件');
    expect(
      textValues.filter(value => value === 'Brand Guidelines.pdf'),
    ).toHaveLength(1);
  });

  it('removes a selected file from the in-app selected file list', async () => {
    mockedGetAutoUploadConfig.mockResolvedValueOnce({
      enabled: true,
      timeRangeMode: 'all',
      state: 'active',
    });
    mockedPickDocumentUploads.mockResolvedValueOnce({
      queuedCount: 2,
      skippedCount: 0,
      batchId: 'document-batch-1',
      files: [
        {
          name: 'Brand Guidelines.pdf',
          size: 2 * 1024 * 1024,
          mimeType: 'application/pdf',
          uri: 'file:///source/brand-guidelines.pdf',
        },
        {
          name: 'Launch Clip.mov',
          size: 12 * 1024 * 1024,
          mimeType: 'video/quicktime',
          uri: 'file:///source/launch-clip.mov',
        },
      ],
    });
    const tree = await renderScreen();

    await ReactTestRenderer.act(async () => {
      await tree.root
        .findByProps({ testID: 'auto-upload-add-file' })
        .props.onPress();
    });

    ReactTestRenderer.act(() => {
      tree.root
        .findByProps({ testID: 'auto-upload-remove-file-0' })
        .props.onPress();
    });

    const textValues = getTextValues(tree);
    expect(textValues).not.toContain('Brand Guidelines.pdf');
    expect(textValues).toContain('Launch Clip.mov');
    expect(textValues).toContain('已选择 1 个文件');

    await ReactTestRenderer.act(async () => {
      await tree.root
        .findByProps({ testID: 'auto-upload-confirm' })
        .props.onPress();
    });

    expect(mockedSubmitDocumentUploads).toHaveBeenCalledWith([
      {
        name: 'Launch Clip.mov',
        size: 12 * 1024 * 1024,
        mimeType: 'video/quicktime',
        uri: 'file:///source/launch-clip.mov',
      },
    ]);
  });

  it('opens the custom range picker UI when custom range is selected', async () => {
    const tree = await renderScreen();

    ReactTestRenderer.act(() => {
      tree.root
        .findByProps({ testID: 'auto-upload-range-custom' })
        .props.onPress();
    });

    expect(
      tree.root.findByProps({
        testID: 'auto-upload-range-custom',
      }).props.accessibilityState,
    ).toMatchObject({ selected: true });
    expect(getTextValues(tree)).toContain('保存');
    expect(
      tree.root.findAllByType(
        'DateTimePicker' as unknown as React.ComponentType,
      ),
    ).toHaveLength(1);
  });

  it('saves range changes immediately while auto upload is enabled', async () => {
    const tree = await renderScreen();

    await ReactTestRenderer.act(async () => {
      await tree.root
        .findByProps({ testID: 'auto-upload-range-now' })
        .props.onPress();
    });

    expect(mockedSaveAutoUploadConfig).toHaveBeenCalledWith({
      enabled: true,
      timeRangeMode: 'from_now',
      customTimeFrom: undefined,
    });
    expect(mockedPrepareAutoUploadEnable).not.toHaveBeenCalled();
    expect(mockedEnableAutoUpload).not.toHaveBeenCalled();
  });

  it('guards saving against rapid switch-on while enabling auto upload', async () => {
    mockedGetAutoUploadConfig.mockResolvedValueOnce({
      enabled: false,
      timeRangeMode: 'all',
      state: 'disabled',
    });
    let resolveSave: (() => void) | undefined;
    mockedSaveAutoUploadConfig.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          resolveSave = resolve;
        }),
    );
    const tree = await renderScreen();

    await ReactTestRenderer.act(async () => {
      void getAutoUploadSwitch(tree).props.onValueChange(true);
      void getAutoUploadSwitch(tree).props.onValueChange(true);
      await Promise.resolve();
    });

    expect(mockedSaveAutoUploadConfig).toHaveBeenCalledTimes(1);
    expect(mockedEnableAutoUpload).not.toHaveBeenCalled();
    expect(getAutoUploadSwitch(tree).props.disabled).toBe(true);

    await ReactTestRenderer.act(async () => {
      resolveSave?.();
      await Promise.resolve();
    });
  });

  it('saves the native config before enabling auto upload from the switch', async () => {
    mockedGetAutoUploadConfig.mockResolvedValueOnce({
      enabled: false,
      timeRangeMode: 'from_now',
      state: 'disabled',
    });
    const tree = await renderScreen();

    await ReactTestRenderer.act(async () => {
      await getAutoUploadSwitch(tree).props.onValueChange(true);
    });

    expect(mockedPrepareAutoUploadEnable).toHaveBeenCalledTimes(1);
    expect(mockedSaveAutoUploadConfig).toHaveBeenCalledWith({
      enabled: true,
      timeRangeMode: 'from_now',
      customTimeFrom: undefined,
    });
    expect(mockedEnableAutoUpload).toHaveBeenCalledTimes(1);
    expect(mockedEnableAutoUpload.mock.calls[0]).toEqual([
      { skipPermissionPreflight: true },
    ]);
    expect(
      mockedPrepareAutoUploadEnable.mock.invocationCallOrder[0],
    ).toBeLessThan(mockedSaveAutoUploadConfig.mock.invocationCallOrder[0]);
    expect(mockedSaveAutoUploadConfig.mock.invocationCallOrder[0]).toBeLessThan(
      mockedEnableAutoUpload.mock.invocationCallOrder[0],
    );
  });

  it('does not save enabled config when permission preflight rejects', async () => {
    mockedGetAutoUploadConfig.mockResolvedValueOnce({
      enabled: false,
      timeRangeMode: 'all',
      state: 'disabled',
    });
    mockedPrepareAutoUploadEnable.mockRejectedValueOnce(
      new Error('permission denied'),
    );
    const tree = await renderScreen();

    await ReactTestRenderer.act(async () => {
      await getAutoUploadSwitch(tree).props.onValueChange(true);
    });

    expect(mockedPrepareAutoUploadEnable).toHaveBeenCalledTimes(1);
    expect(mockedSaveAutoUploadConfig).not.toHaveBeenCalled();
    expect(mockedEnableAutoUpload).not.toHaveBeenCalled();
  });

  it('preserves hydrated from_today mode when the range is not edited', async () => {
    mockedGetAutoUploadConfig.mockResolvedValueOnce({
      enabled: false,
      timeRangeMode: 'from_today',
      state: 'disabled',
    });
    const tree = await renderScreen();

    await ReactTestRenderer.act(async () => {
      await getAutoUploadSwitch(tree).props.onValueChange(true);
    });

    expect(mockedSaveAutoUploadConfig).toHaveBeenCalledWith({
      enabled: true,
      timeRangeMode: 'from_today',
      customTimeFrom: undefined,
    });
    expect(mockedEnableAutoUpload).toHaveBeenCalledWith({
      skipPermissionPreflight: true,
    });
  });

  it('saves custom time from the hydrated config when custom range stays selected', async () => {
    mockedGetAutoUploadConfig.mockResolvedValueOnce({
      enabled: false,
      timeRangeMode: 'custom',
      customTimeFrom: '2026-06-16T03:04:05.000Z',
      state: 'disabled',
    });
    const tree = await renderScreen();

    await ReactTestRenderer.act(async () => {
      await getAutoUploadSwitch(tree).props.onValueChange(true);
    });

    expect(mockedSaveAutoUploadConfig).toHaveBeenCalledWith({
      enabled: true,
      timeRangeMode: 'custom',
      customTimeFrom: '2026-06-16T03:04:05.000Z',
    });
    expect(mockedEnableAutoUpload).toHaveBeenCalledTimes(1);
  });

  it('disables native auto upload when the saved enabled config is turned off', async () => {
    mockedGetAutoUploadConfig.mockResolvedValueOnce({
      enabled: true,
      timeRangeMode: 'all',
      state: 'active',
    });
    const tree = await renderScreen();

    await ReactTestRenderer.act(async () => {
      await getAutoUploadSwitch(tree).props.onValueChange(false);
    });

    expect(mockedDisableAutoUpload).toHaveBeenCalledTimes(1);
    expect(mockedSaveAutoUploadConfig).not.toHaveBeenCalled();
    expect(mockedEnableAutoUpload).not.toHaveBeenCalled();
    expect(
      tree.root.findAllByProps({ testID: 'auto-upload-source-album' }),
    ).toHaveLength(0);
  });
});
