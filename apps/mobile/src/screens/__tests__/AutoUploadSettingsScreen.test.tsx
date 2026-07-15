import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Alert, StyleSheet, Text, TouchableOpacity } from 'react-native';
import {
  disableAutoUpload,
  enableAutoUpload,
  getAutoUploadConfig,
  prepareAutoUploadEnable,
  saveAutoUploadConfig,
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

jest.mock('../../components/GradientBackground', () => ({
  GradientBackground: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

jest.mock('lucide-react-native', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');
  const createIcon =
    (fallbackTestID: string) =>
    ({ testID, ...props }: { testID?: string }) =>
      ReactModule.createElement(View, {
        testID: testID ?? fallbackTestID,
        ...props,
      });
  return {
    Calendar: createIcon('mock-calendar-icon'),
    Check: createIcon('mock-check-icon'),
    ChevronLeft: createIcon('mock-chevron-left-icon'),
    Clock: createIcon('mock-clock-icon'),
    CloudDownload: createIcon('mock-cloud-download-icon'),
    Folder: createIcon('mock-folder-icon'),
    Image: createIcon('mock-image-icon'),
    ShieldCheck: createIcon('mock-shield-check-icon'),
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
  prepareAutoUploadEnable: jest.fn().mockResolvedValue(undefined),
  saveAutoUploadConfig: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const copy: Record<string, string> = {
        'syncActivity.autoUploadSettings.title': 'Auto Upload',
        'syncActivity.autoUploadSettings.subtitle':
          'Set up phone content sync to computer',
        'syncActivity.autoUploadSettings.planTitle': 'Sync Plan',
        'syncActivity.autoUploadSettings.enableSwitchTitle':
          'Auto Upload Switch',
        'syncActivity.autoUploadSettings.enableSwitchDescOn':
          'Enabled. New album media will sync automatically based on sync range',
        'syncActivity.autoUploadSettings.enableSwitchDescOff':
          'Disabled. New album media will not sync automatically',
        'syncActivity.autoUploadSettings.sourcesTitle': 'Sync Sources',
        'syncActivity.autoUploadSettings.albumTitle': 'Photos and Videos',
        'syncActivity.autoUploadSettings.albumDesc':
          'Sync media content from system album',
        'syncActivity.autoUploadSettings.rangeTitle': 'Sync Range',
        'syncActivity.autoUploadSettings.rangeAllTitle': 'All Content',
        'syncActivity.autoUploadSettings.rangeAllDesc':
          'Sync existing photos and videos',
        'syncActivity.autoUploadSettings.rangeNowTitle': 'From Now On',
        'syncActivity.autoUploadSettings.rangeNowDesc':
          'Only sync newly added content from now on',
        'syncActivity.autoUploadSettings.rangeCustomTitle': 'CustomTime',
        'syncActivity.autoUploadSettings.rangeCustomDesc':
          'Sync from the specified start time',
        'syncActivity.autoUploadSettings.customPickerSave': 'Save',
        'syncActivity.autoUploadSettings.infoAlbum':
          'Album photos and videos will sync to your computer.',
        'syncActivity.autoUploadSettings.infoAutoOff':
          'After auto upload is disabled, newly added media will not sync.',
        'syncActivity.autoUploadSettings.loadingConfig':
          'Reading auto upload settings...',
        'syncActivity.autoUploadSettings.loadConfigFailed':
          'Failed to read auto upload settings. Please try again later.',
        'syncActivity.dialogs.enableAutoFailed.title': 'Action Failed',
        'syncActivity.dialogs.enableAutoFailed.body':
          'Could not enable auto upload. Please try again later',
        'common.back': 'Back',
        'common.cancel': 'Cancel',
        'common.notApplicable': 'N/A',
      };
      return copy[key] ?? '';
    },
  }),
}));

import { AutoUploadSettingsScreen } from '../AutoUploadSettingsScreen';

async function renderScreen() {
  let tree: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<AutoUploadSettingsScreen />);
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
const mockedPrepareAutoUploadEnable = prepareAutoUploadEnable as jest.Mock;
const mockedSaveAutoUploadConfig = saveAutoUploadConfig as jest.Mock;

describe('AutoUploadSettingsScreen', () => {
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
    mockedPrepareAutoUploadEnable.mockResolvedValue(undefined);
    mockedSaveAutoUploadConfig.mockResolvedValue(undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders the OSS auto-upload plan without manual file-selection entrypoints', async () => {
    const tree = await renderScreen();
    const textValues = getTextValues(tree);

    expect(textValues).toContain('Sync Plan');
    expect(textValues).toContain('Auto Upload Switch');
    expect(textValues).toContain(
      'Album photos and videos will sync to your computer.',
    );
    expect(textValues).toContain('Sync Sources');
    expect(textValues).toContain('Photos and Videos');
    expect(textValues).toContain('Sync media content from system album');
    expect(textValues).toContain('Sync Range');
    expect(textValues).toContain('Sync existing photos and videos');
    expect(textValues).toContain('Only sync newly added content from now on');
    expect(textValues).toContain('CustomTime');
    expect(textValues).not.toContain('Specified Files');
    expect(textValues).not.toContain(
      'Select content to sync from system files',
    );
    expect(textValues).not.toContain('Add');
    expect(textValues).not.toContain('Selected Files');
    expect(
      tree.root.findAllByProps({ testID: 'auto-upload-add-file' }),
    ).toHaveLength(0);
    expect(
      tree.root.findAllByProps({ testID: 'auto-upload-confirm' }),
    ).toHaveLength(0);
    expect(
      tree.root.findAllByProps({ testID: 'auto-upload-source-file-icon' }),
    ).toHaveLength(0);
  });

  it('keeps the album source fixed as the only sync source', async () => {
    const tree = await renderScreen();
    const albumSource = tree.root.findByProps({
      testID: 'auto-upload-source-album',
    });

    expect(albumSource.props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(albumSource.props.onPress).toBeUndefined();
    expect(getAutoUploadSwitch(tree).props.value).toBe(true);
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
      tree.root.findAllByProps({ testID: 'auto-upload-range-all' }),
    ).toHaveLength(0);
    expect(getTextValues(tree)).toContain(
      'After auto upload is disabled, newly added media will not sync.',
    );
  });

  it('uses reference-style source and range icons without file-source icons', async () => {
    const tree = await renderScreen();
    const albumIcon = tree.root.findByProps({
      testID: 'auto-upload-source-album-icon',
    });
    const rangeAllIcon = tree.root.findByProps({
      testID: 'auto-upload-range-all-icon',
    });

    expect(
      tree.root.findByProps({ testID: 'auto-upload-plan-icon' }),
    ).toBeTruthy();
    expect(albumIcon.props.size).toBe(20);
    expect(albumIcon.props.color).toBe('#fff');
    expect(rangeAllIcon.props.size).toBe(18);
    expect(rangeAllIcon.props.color).toBe('#fff');
    expect(
      tree.root.findAllByProps({ testID: 'auto-upload-source-file-icon' }),
    ).toHaveLength(0);
  });

  it('keeps title and icon containers aligned with the reference layout', async () => {
    const tree = await renderScreen();
    const titleNode = tree.root.findAllByType(Text).find(node => {
      return node.props.children === 'Auto Upload';
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
      StyleSheet.flatten(rangeCustomSelectionBox.props.style),
    ).toMatchObject({
      width: 24,
      height: 24,
      borderRadius: 8,
      borderColor: '#C9D6E4',
      backgroundColor: 'rgba(255,255,255,0.72)',
    });
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

    expect(getAutoUploadSwitch(tree).props.disabled).toBe(true);
    expect(getTextValues(tree)).toContain(
      'Failed to read auto upload settings. Please try again later.',
    );

    await ReactTestRenderer.act(async () => {
      await getAutoUploadSwitch(tree).props.onValueChange(true);
    });

    expect(mockedPrepareAutoUploadEnable).not.toHaveBeenCalled();
    expect(mockedSaveAutoUploadConfig).not.toHaveBeenCalled();
    expect(mockedEnableAutoUpload).not.toHaveBeenCalled();
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
    expect(getTextValues(tree)).toContain('Save');
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
