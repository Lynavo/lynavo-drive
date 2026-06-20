import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  Alert,
  Modal,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, CommonActions } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import {
  Calendar,
  Check,
  ChevronLeft,
  Clock,
  CloudDownload,
  File as FileIcon,
  Folder,
  Image as ImageIcon,
  ShieldCheck,
  X,
} from 'lucide-react-native';
import DateTimePicker, {
  DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import type { AutoUploadTimeRangeMode } from '@syncflow/contracts';

import { GlobalGradientBackground } from '../components/GlobalGradientBackground';
import { androidBoxShadow } from '../utils/androidShadow';
import {
  disableAutoUpload,
  enableAutoUpload,
  getAutoUploadConfig,
  type DocumentUploadFile,
  prepareAutoUploadEnable,
  pickDocumentUploads,
  saveAutoUploadConfig,
  submitDocumentUploads,
} from '../services/SyncEngineModule';
import { formatBytes } from '../utils/format';

type AutoUploadRange = 'all' | 'now' | 'custom';

const BLUE = '#1677D2';
const DARK = '#17191C';
const MUTED_ICON = '#7B8490';
const GLOBAL_COPY = {
  title: '自动上传',
  subtitle: '设置手机内容同步到电脑',
  planTitle: '同步计划',
  enableSwitchTitle: '自动上传开关',
  enableSwitchDescOn: '已开启，会按同步范围自动同步相册新增素材',
  enableSwitchDescOff: '已关闭，不会自动同步相册新增素材',
  sourcesTitle: '同步来源',
  albumTitle: '照片和视频',
  albumDesc: '同步系统相册中的媒体内容',
  fileTitle: '指定文件',
  fileDescEmpty: '从系统文件中选择需要同步的内容',
  addFile: '添加',
  addMoreFile: '继续添加',
  selectedFilesTitle: '已选文件',
  filePickCancelled: '未选择文件',
  filePickFailedTitle: '添加失败',
  filePickFailedBody: '无法添加指定文件，请稍后重试。',
  fileQueuedMessage: '已加入 {{count}} 个文件到同步队列',
  fileSkippedMessage: '已跳过 {{count}} 个已选文件',
  rangeTitle: '同步范围',
  rangeAllTitle: '全部内容',
  rangeAllDesc: '同步现有照片和视频',
  rangeNowTitle: '从现在开始',
  rangeNowDesc: '仅同步后续新增内容',
  rangeCustomTitle: '自定义时间',
  rangeCustomDesc: '按指定时间起点同步',
  confirmEnable: '开启自动上传',
  confirmDisable: '关闭自动上传',
  customPickerSave: '保存',
  infoAlbum: '相册照片和视频将同步到电脑。',
  infoAutoOff: '自动上传关闭后，不会同步后续新增素材。',
  infoEmpty: '请选择至少一个同步来源。',
  loadingConfig: '正在读取自动上传设置...',
  loadConfigFailed: '自动上传设置读取失败，请稍后重试。',
  disabledSuccess: '自动上传已关闭',
};

function toUploadRange(mode: AutoUploadTimeRangeMode): AutoUploadRange {
  if (mode === 'custom') return 'custom';
  if (mode === 'from_now' || mode === 'from_today') return 'now';
  return 'all';
}

function toTimeRangeMode(range: AutoUploadRange): AutoUploadTimeRangeMode {
  if (range === 'now') return 'from_now';
  return range;
}

function resolveTimeRangeMode(
  range: AutoUploadRange,
  hydratedMode: AutoUploadTimeRangeMode,
  rangeEdited: boolean,
): AutoUploadTimeRangeMode {
  if (!rangeEdited && hydratedMode === 'from_today' && range === 'now') {
    return 'from_today';
  }
  return toTimeRangeMode(range);
}

function parseConfigDate(value?: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getDocumentUploadFileKey(file: DocumentUploadFile): string {
  const uri = file.uri?.trim();
  if (uri) {
    return uri;
  }
  return [
    file.name.trim().toLocaleLowerCase(),
    Math.max(file.size || 0, 0),
    file.mimeType?.trim().toLocaleLowerCase() ?? '',
  ].join('|');
}

function formatFileSkippedMessage(count: number): string {
  return GLOBAL_COPY.fileSkippedMessage.replace('{{count}}', String(count));
}

function mergeDocumentUploadFiles(
  currentFiles: DocumentUploadFile[],
  incomingFiles: DocumentUploadFile[],
): { files: DocumentUploadFile[]; duplicateCount: number } {
  const seen = new Set(currentFiles.map(getDocumentUploadFileKey));
  const merged = [...currentFiles];
  let duplicateCount = 0;
  for (const file of incomingFiles) {
    const key = getDocumentUploadFileKey(file);
    if (seen.has(key)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(key);
    merged.push(file);
  }
  return { files: merged, duplicateCount };
}

export function AutoUploadSettingsGlobalScreen() {
  const navigation = useNavigation();
  const { t } = useTranslation();

  const [albumEnabled, setAlbumEnabled] = useState(true);
  const [autoUploadEnabled, setAutoUploadEnabled] = useState(false);
  const [persistedAutoUploadEnabled, setPersistedAutoUploadEnabled] =
    useState(false);
  const [uploadRange, setUploadRange] = useState<AutoUploadRange>('all');
  const [hydratedTimeRangeMode, setHydratedTimeRangeMode] =
    useState<AutoUploadTimeRangeMode>('all');
  const [rangeEdited, setRangeEdited] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [customDate, setCustomDate] = useState<Date>(new Date());
  const [tempDate, setTempDate] = useState<Date>(new Date());
  const [selectedFiles, setSelectedFiles] = useState<DocumentUploadFile[]>([]);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pickingFiles, setPickingFiles] = useState(false);
  const [lastFileSkipMessage, setLastFileSkipMessage] = useState<string | null>(
    null,
  );
  const savingRef = useRef(false);

  const fileSourceSelected = selectedFiles.length > 0;
  const selectedFileSize = selectedFiles.reduce(
    (total, file) => total + Math.max(file.size || 0, 0),
    0,
  );
  const selectedFileSizeLabel = formatBytes(selectedFileSize);
  const selectedSourceCount =
    (albumEnabled ? 1 : 0) + (fileSourceSelected ? 1 : 0);
  const canConfirm = !configLoading && !configError && fileSourceSelected;
  const planSourceCount = autoUploadEnabled ? selectedSourceCount : 0;
  const planFileCount = autoUploadEnabled ? selectedFiles.length : 0;

  useEffect(() => {
    let mounted = true;

    const hydrateConfig = async () => {
      setConfigLoading(true);
      try {
        const config = await getAutoUploadConfig();
        if (!mounted) return;

        setPersistedAutoUploadEnabled(config.enabled);
        setAutoUploadEnabled(config.enabled);
        setAlbumEnabled(true);
        setHydratedTimeRangeMode(config.timeRangeMode);
        setRangeEdited(false);
        setUploadRange(toUploadRange(config.timeRangeMode));

        const parsedDate = parseConfigDate(config.customTimeFrom);
        if (parsedDate) {
          setCustomDate(parsedDate);
          setTempDate(parsedDate);
        }
        setConfigError(null);
      } catch (e) {
        console.warn('[AutoUploadSettings] getAutoUploadConfig failed:', e);
        if (mounted) {
          setConfigError(GLOBAL_COPY.loadConfigFailed);
        }
      } finally {
        if (mounted) {
          setConfigLoading(false);
        }
      }
    };

    void hydrateConfig();

    return () => {
      mounted = false;
    };
  }, []);

  const handleAddFileSource = async () => {
    if (pickingFiles) return;
    try {
      setPickingFiles(true);
      const result = await pickDocumentUploads();
      const mergeResult = mergeDocumentUploadFiles(selectedFiles, result.files);
      const skippedCount = Math.max(
        result.skippedCount ?? 0,
        mergeResult.duplicateCount,
      );
      if (result.files.length) {
        setSelectedFiles(mergeResult.files);
      }
      setLastFileSkipMessage(
        skippedCount > 0 ? formatFileSkippedMessage(skippedCount) : null,
      );
    } catch (e) {
      const code = (e as { code?: string } | null)?.code;
      if (code === 'DOCUMENT_PICKER_CANCELLED') {
        return;
      }
      console.warn('[AutoUploadSettings] pickDocumentUploads failed:', e);
      Alert.alert(
        GLOBAL_COPY.filePickFailedTitle,
        GLOBAL_COPY.filePickFailedBody,
      );
    } finally {
      setPickingFiles(false);
    }
  };

  const handleRemoveSelectedFile = (fileKey: string) => {
    setSelectedFiles(prev =>
      prev.filter(file => getDocumentUploadFileKey(file) !== fileKey),
    );
    setLastFileSkipMessage(null);
  };

  const persistAlbumAutoUploadConfig = async (
    range: AutoUploadRange,
    date: Date,
    edited: boolean,
  ) => {
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      setSaving(true);
      const timeRangeMode = resolveTimeRangeMode(
        range,
        hydratedTimeRangeMode,
        edited,
      );
      const customTimeFrom =
        timeRangeMode === 'custom' ? date.toISOString() : undefined;
      const wasPersistedEnabled = persistedAutoUploadEnabled;

      if (!wasPersistedEnabled) {
        await prepareAutoUploadEnable();
      }
      await saveAutoUploadConfig({
        enabled: true,
        timeRangeMode,
        customTimeFrom,
      });
      if (!wasPersistedEnabled) {
        await enableAutoUpload({ skipPermissionPreflight: true });
      }
      setPersistedAutoUploadEnabled(true);
      setAutoUploadEnabled(true);
      setHydratedTimeRangeMode(timeRangeMode);
      setRangeEdited(false);
    } catch (e) {
      console.warn('[AutoUploadSettings] save auto upload config failed:', e);
      if (!persistedAutoUploadEnabled) {
        setAutoUploadEnabled(false);
      }
      Alert.alert(
        t('syncActivity.dialogs.enableAutoFailed.title') || '操作失敗',
        t('syncActivity.dialogs.enableAutoFailed.body') ||
          '無法開啟自動上傳，請稍後重試',
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleAutoUploadEnabledChange = async (enabled: boolean) => {
    if (configLoading || configError || savingRef.current) return;
    setAutoUploadEnabled(enabled);
    if (!enabled) {
      setSelectedFiles([]);
      setLastFileSkipMessage(null);
      if (!persistedAutoUploadEnabled) {
        return;
      }
      savingRef.current = true;
      try {
        setSaving(true);
        await disableAutoUpload();
        setPersistedAutoUploadEnabled(false);
      } catch (e) {
        console.warn('[AutoUploadSettings] disable auto upload failed:', e);
        setAutoUploadEnabled(true);
        Alert.alert(
          t('syncActivity.dialogs.enableAutoFailed.title') || '操作失敗',
          t('syncActivity.dialogs.enableAutoFailed.body') ||
            '無法開啟自動上傳，請稍後重試',
        );
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
      return;
    }
    setAlbumEnabled(true);
    await persistAlbumAutoUploadConfig(uploadRange, customDate, rangeEdited);
  };

  const handleBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }

    navigation.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'SyncActivity' }],
      }),
    );
  }, [navigation]);

  const handleRangeSelect = (range: AutoUploadRange) => {
    setRangeEdited(true);
    setUploadRange(range);
    if (range === 'custom') {
      setTempDate(customDate);
      setShowDatePicker(true);
      return;
    }
    if (autoUploadEnabled && albumEnabled) {
      void persistAlbumAutoUploadConfig(range, customDate, true);
    }
  };

  const handleDateChange = (
    event: DateTimePickerEvent,
    selectedDate?: Date,
  ) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
      if (event.type === 'set' && selectedDate) {
        setCustomDate(selectedDate);
        setTempDate(selectedDate);
      }
    } else if (selectedDate) {
      setTempDate(selectedDate);
    }
  };

  const handleConfirmDatePicker = () => {
    setCustomDate(tempDate);
    setShowDatePicker(false);
    if (autoUploadEnabled && albumEnabled) {
      void persistAlbumAutoUploadConfig('custom', tempDate, true);
    }
  };

  const handleConfirmSettings = async () => {
    if (!canConfirm || savingRef.current) return;
    savingRef.current = true;
    try {
      setSaving(true);
      const result = await submitDocumentUploads(selectedFiles);

      Alert.alert(
        t('common.confirm') || '確認',
        GLOBAL_COPY.fileQueuedMessage.replace(
          '{{count}}',
          String(result.queuedCount ?? selectedFiles.length),
        ),
        [
          {
            text: t('common.ok') || '好',
            onPress: () => {
              navigation.dispatch(
                CommonActions.reset({
                  index: 0,
                  routes: [{ name: 'SyncActivity' }],
                }),
              );
            },
          },
        ],
      );
    } catch (e) {
      console.warn('[AutoUploadSettings] enableAutoUpload failed:', e);
      Alert.alert(
        t('syncActivity.dialogs.enableAutoFailed.title') || '操作失敗',
        t('syncActivity.dialogs.enableAutoFailed.body') ||
          '無法開啟自動上傳，請稍後重試',
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  // Render dynamic explanation sentence
  const renderInfoText = () => {
    if (configLoading) {
      return GLOBAL_COPY.loadingConfig;
    }
    if (configError) {
      return configError;
    }
    if (!autoUploadEnabled) {
      return GLOBAL_COPY.infoAutoOff;
    }
    if (albumEnabled) {
      return GLOBAL_COPY.infoAlbum;
    } else if (fileSourceSelected) {
      return GLOBAL_COPY.fileQueuedMessage.replace(
        '{{count}}',
        String(selectedFiles.length),
      );
    } else {
      return GLOBAL_COPY.infoEmpty;
    }
  };

  const activeRangeLabel =
    uploadRange === 'all'
      ? GLOBAL_COPY.rangeAllTitle
      : uploadRange === 'now'
        ? GLOBAL_COPY.rangeNowTitle
        : GLOBAL_COPY.rangeCustomTitle;
  const planRangeLabel =
    autoUploadEnabled && albumEnabled ? activeRangeLabel : '不适用';
  const infoText = renderInfoText();
  const confirmLabel = '完成';

  return (
    <GlobalGradientBackground>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            testID="auto-upload-back"
            style={styles.backButton}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="返回"
            onPress={handleBack}
          >
            <ChevronLeft
              testID="auto-upload-back-icon"
              size={20}
              color={DARK}
              strokeWidth={1.9}
            />
          </TouchableOpacity>
          <View style={styles.headerCopy}>
            <Text style={styles.headerTitle}>{GLOBAL_COPY.title}</Text>
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {GLOBAL_COPY.subtitle}
            </Text>
          </View>
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.planCard}>
            <View style={styles.planHeaderRow}>
              <View style={styles.planIconBox}>
                <CloudDownload
                  testID="auto-upload-plan-icon"
                  size={24}
                  color={BLUE}
                  strokeWidth={1.9}
                />
              </View>
              <View style={styles.planTextColumn}>
                <Text style={styles.planTitle}>{GLOBAL_COPY.planTitle}</Text>
                <Text style={styles.planDescription}>{infoText}</Text>
              </View>
            </View>
            <View style={styles.planStatsRow}>
              <View style={styles.planStatItem}>
                <Text style={styles.planStatLabel}>来源</Text>
                <Text style={styles.planStatValue}>{planSourceCount}</Text>
              </View>
              <View style={styles.planStatItem}>
                <Text style={styles.planStatLabel}>文件</Text>
                <Text style={styles.planStatValue}>{planFileCount}</Text>
              </View>
              <View style={styles.planStatItem}>
                <Text style={styles.planStatLabel}>范围</Text>
                <Text style={styles.planStatValue} numberOfLines={1}>
                  {planRangeLabel}
                </Text>
              </View>
            </View>
            <View style={styles.enableSwitchRow}>
              <View style={styles.enableSwitchCopy}>
                <Text style={styles.enableSwitchTitle}>
                  {GLOBAL_COPY.enableSwitchTitle}
                </Text>
                <Text style={styles.enableSwitchDesc}>
                  {autoUploadEnabled
                    ? GLOBAL_COPY.enableSwitchDescOn
                    : GLOBAL_COPY.enableSwitchDescOff}
                </Text>
              </View>
              <Switch
                testID="auto-upload-enabled-switch"
                value={autoUploadEnabled}
                disabled={configLoading || Boolean(configError) || saving}
                accessibilityRole="switch"
                accessibilityState={{ checked: autoUploadEnabled }}
                onValueChange={handleAutoUploadEnabledChange}
                trackColor={{ false: '#D8E2EF', true: '#98D4FF' }}
                thumbColor={autoUploadEnabled ? BLUE : '#FFFFFF'}
                ios_backgroundColor="#D8E2EF"
              />
            </View>
          </View>

          {autoUploadEnabled ? (
            <>
              {/* Synchronize Source */}
              <View style={styles.section}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionTitle}>
                    {GLOBAL_COPY.sourcesTitle}
                  </Text>
                </View>
                <View style={styles.cardContainer}>
                  {/* Option 1: Album */}
                  <TouchableOpacity
                    style={[
                      styles.optionRow,
                      albumEnabled && styles.optionRowActive,
                    ]}
                    activeOpacity={0.8}
                    testID="auto-upload-source-album"
                    accessibilityRole="button"
                    accessibilityState={{ selected: albumEnabled }}
                    onPress={() => setAlbumEnabled(!albumEnabled)}
                  >
                    <View
                      style={[
                        styles.sourceIconBox,
                        albumEnabled
                          ? styles.iconBoxActive
                          : styles.iconBoxInactive,
                      ]}
                    >
                      <ImageIcon
                        testID="auto-upload-source-album-icon"
                        size={20}
                        color={albumEnabled ? '#fff' : MUTED_ICON}
                        strokeWidth={1.9}
                      />
                    </View>
                    <View style={styles.optionInfo}>
                      <Text style={styles.optionTitle}>
                        {GLOBAL_COPY.albumTitle}
                      </Text>
                      <Text style={styles.optionDesc}>
                        {GLOBAL_COPY.albumDesc}
                      </Text>
                    </View>
                    <SelectionIndicator
                      selected={albumEnabled}
                      testID="auto-upload-source-album-check-icon"
                    />
                  </TouchableOpacity>

                  {/* Option 2: Files */}
                  <View style={styles.optionContainer}>
                    <View style={styles.optionRowHeader}>
                      <View
                        style={[styles.sourceIconBox, styles.iconBoxInactive]}
                      >
                        <FileIcon
                          testID="auto-upload-source-file-icon"
                          size={20}
                          color={MUTED_ICON}
                          strokeWidth={1.9}
                        />
                      </View>
                      <View style={styles.optionInfo}>
                        <Text style={styles.optionTitle}>
                          {GLOBAL_COPY.fileTitle}
                        </Text>
                        <Text style={styles.optionDesc}>
                          {fileSourceSelected
                            ? `已选择 ${selectedFiles.length} 个文件`
                            : GLOBAL_COPY.fileDescEmpty}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={[
                          styles.addFileButton,
                          pickingFiles && styles.addFileButtonDisabled,
                        ]}
                        activeOpacity={0.8}
                        disabled={pickingFiles}
                        testID="auto-upload-add-file"
                        accessibilityRole="button"
                        accessibilityState={{ busy: pickingFiles }}
                        onPress={handleAddFileSource}
                      >
                        <Text style={styles.addFileButtonText}>
                          {fileSourceSelected
                            ? GLOBAL_COPY.addMoreFile
                            : GLOBAL_COPY.addFile}
                        </Text>
                      </TouchableOpacity>
                    </View>
                    {fileSourceSelected ? (
                      <View style={styles.filesPreviewCard}>
                        <View style={styles.filesPreviewHeader}>
                          <Text style={styles.filesPreviewTitle}>
                            {GLOBAL_COPY.selectedFilesTitle}
                          </Text>
                          <Text style={styles.filesPreviewMeta}>
                            {selectedFiles.length} 个 · {selectedFileSizeLabel}
                          </Text>
                        </View>
                        {lastFileSkipMessage ? (
                          <Text
                            style={styles.filesSkippedNotice}
                            testID="auto-upload-file-skip-notice"
                          >
                            {lastFileSkipMessage}
                          </Text>
                        ) : null}
                        {selectedFiles.map((file, index) => (
                          <View
                            key={getDocumentUploadFileKey(file)}
                            style={styles.filePreviewRow}
                          >
                            <FileIcon
                              size={14}
                              color={BLUE}
                              strokeWidth={1.9}
                            />
                            <Text
                              style={styles.filePreviewName}
                              numberOfLines={1}
                            >
                              {file.name}
                            </Text>
                            <Text style={styles.filePreviewSize}>
                              {formatBytes(file.size || 0)}
                            </Text>
                            <TouchableOpacity
                              style={styles.removeFileButton}
                              activeOpacity={0.75}
                              testID={`auto-upload-remove-file-${index}`}
                              accessibilityRole="button"
                              accessibilityLabel={`移除 ${file.name}`}
                              onPress={() =>
                                handleRemoveSelectedFile(
                                  getDocumentUploadFileKey(file),
                                )
                              }
                            >
                              <X
                                testID={`auto-upload-remove-file-icon-${index}`}
                                size={12}
                                color="#7B8490"
                                strokeWidth={2}
                              />
                            </TouchableOpacity>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </View>
                </View>
              </View>

              {/* Upload Range */}
              {albumEnabled ? (
                <View style={styles.section}>
                  <Text
                    style={[styles.sectionTitle, styles.standaloneSectionTitle]}
                  >
                    {GLOBAL_COPY.rangeTitle}
                  </Text>
                  <View style={styles.cardContainer}>
                    {/* Option: All */}
                    <TouchableOpacity
                      style={[
                        styles.optionRow,
                        uploadRange === 'all' && styles.optionRowActive,
                      ]}
                      activeOpacity={0.8}
                      testID="auto-upload-range-all"
                      accessibilityRole="button"
                      accessibilityState={{ selected: uploadRange === 'all' }}
                      onPress={() => handleRangeSelect('all')}
                    >
                      <View
                        style={[
                          styles.rangeIconBox,
                          uploadRange === 'all'
                            ? styles.iconBoxActive
                            : styles.iconBoxInactive,
                        ]}
                      >
                        <Folder
                          testID="auto-upload-range-all-icon"
                          size={18}
                          color={uploadRange === 'all' ? '#fff' : MUTED_ICON}
                          strokeWidth={1.9}
                        />
                      </View>
                      <View style={styles.optionInfo}>
                        <Text style={styles.optionTitle}>
                          {GLOBAL_COPY.rangeAllTitle}
                        </Text>
                        <Text style={styles.optionDesc}>
                          {GLOBAL_COPY.rangeAllDesc}
                        </Text>
                      </View>
                      <SelectionIndicator
                        selected={uploadRange === 'all'}
                        testID="auto-upload-range-all-check-icon"
                      />
                    </TouchableOpacity>

                    {/* Option: Now */}
                    <TouchableOpacity
                      style={[
                        styles.optionRow,
                        uploadRange === 'now' && styles.optionRowActive,
                      ]}
                      activeOpacity={0.8}
                      testID="auto-upload-range-now"
                      accessibilityRole="button"
                      accessibilityState={{ selected: uploadRange === 'now' }}
                      onPress={() => handleRangeSelect('now')}
                    >
                      <View
                        style={[
                          styles.rangeIconBox,
                          uploadRange === 'now'
                            ? styles.iconBoxActive
                            : styles.iconBoxInactive,
                        ]}
                      >
                        <Clock
                          testID="auto-upload-range-now-icon"
                          size={18}
                          color={uploadRange === 'now' ? '#fff' : MUTED_ICON}
                          strokeWidth={1.9}
                        />
                      </View>
                      <View style={styles.optionInfo}>
                        <Text style={styles.optionTitle}>
                          {GLOBAL_COPY.rangeNowTitle}
                        </Text>
                        <Text style={styles.optionDesc}>
                          {GLOBAL_COPY.rangeNowDesc}
                        </Text>
                      </View>
                      <SelectionIndicator
                        selected={uploadRange === 'now'}
                        testID="auto-upload-range-now-check-icon"
                      />
                    </TouchableOpacity>

                    {/* Option: Custom */}
                    <TouchableOpacity
                      style={[
                        styles.optionRow,
                        uploadRange === 'custom' && styles.optionRowActive,
                      ]}
                      activeOpacity={0.8}
                      testID="auto-upload-range-custom"
                      accessibilityRole="button"
                      accessibilityState={{
                        selected: uploadRange === 'custom',
                      }}
                      onPress={() => handleRangeSelect('custom')}
                    >
                      <View
                        style={[
                          styles.rangeIconBox,
                          uploadRange === 'custom'
                            ? styles.iconBoxActive
                            : styles.iconBoxInactive,
                        ]}
                      >
                        <Calendar
                          testID="auto-upload-range-custom-icon"
                          size={18}
                          color={uploadRange === 'custom' ? '#fff' : MUTED_ICON}
                          strokeWidth={1.9}
                        />
                      </View>
                      <View style={styles.optionInfo}>
                        <Text style={styles.optionTitle}>
                          {GLOBAL_COPY.rangeCustomTitle}
                        </Text>
                        <Text style={styles.optionDesc}>
                          {GLOBAL_COPY.rangeCustomDesc}
                        </Text>
                      </View>
                      <SelectionIndicator
                        selected={uploadRange === 'custom'}
                        testID="auto-upload-range-custom-check-icon"
                      />
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}
            </>
          ) : null}

          {/* Info Card */}
          <View style={styles.infoCard}>
            <View style={styles.infoIconBox}>
              <ShieldCheck
                testID="auto-upload-info-icon"
                size={18}
                color="#AD761D"
                strokeWidth={1.9}
              />
            </View>
            <Text style={styles.infoText}>{infoText}</Text>
          </View>
        </ScrollView>

        {fileSourceSelected ? (
          <View style={styles.bottomActionBar}>
            <TouchableOpacity
              style={[
                styles.confirmButton,
                (!canConfirm || saving) && styles.confirmButtonDisabled,
              ]}
              activeOpacity={0.8}
              disabled={!canConfirm || saving}
              testID="auto-upload-confirm"
              accessibilityRole="button"
              accessibilityState={{
                disabled: !canConfirm || saving,
                busy: saving,
              }}
              onPress={handleConfirmSettings}
            >
              <Text style={styles.confirmButtonText}>{confirmLabel}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </SafeAreaView>

      {/* Date Picker Modal for iOS / Modal structure for Android */}
      {showDatePicker && Platform.OS === 'ios' && (
        <Modal transparent animationType="fade" visible={showDatePicker}>
          <View style={styles.pickerOverlay}>
            <View style={styles.pickerCard}>
              <View style={styles.pickerHeader}>
                <TouchableOpacity
                  activeOpacity={0.6}
                  onPress={() => setShowDatePicker(false)}
                >
                  <Text style={styles.pickerCancelText}>
                    {t('common.cancel') || '取消'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.6}
                  onPress={handleConfirmDatePicker}
                >
                  <Text style={styles.pickerConfirmText}>
                    {GLOBAL_COPY.customPickerSave}
                  </Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={tempDate}
                mode="datetime"
                display="spinner"
                onChange={handleDateChange}
                style={styles.datePicker}
              />
            </View>
          </View>
        </Modal>
      )}

      {showDatePicker && Platform.OS === 'android' && (
        <DateTimePicker
          value={customDate}
          mode="datetime"
          display="default"
          onChange={handleDateChange}
        />
      )}
    </GlobalGradientBackground>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 12,
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.70)',
    backgroundColor: 'rgba(255,255,255,0.54)',
    shadowColor: '#46608A',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.1,
    shadowRadius: 38,
    elevation: 2,
    ...androidBoxShadow({
      offsetY: 14,
      blurRadius: 38,
      color: 'rgba(70, 96, 138, 0.10)',
    }),
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.62)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#17191C',
  },
  headerSubtitle: {
    marginTop: 2,
    fontSize: 11,
    color: '#59616D',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
  },
  planCard: {
    backgroundColor: 'rgba(255,255,255,0.58)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.70)',
    padding: 16,
    shadowColor: '#46608A',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 22,
    elevation: 2,
    ...androidBoxShadow({
      offsetY: 10,
      blurRadius: 22,
      color: 'rgba(70, 96, 138, 0.10)',
    }),
  },
  planHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  planIconBox: {
    width: 48,
    height: 48,
    borderRadius: 15,
    backgroundColor: '#E4F5FF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  planTextColumn: {
    flex: 1,
    minWidth: 0,
  },
  planTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#17191C',
  },
  planDescription: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 20,
    color: '#3F4A58',
  },
  planStatsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  planStatItem: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
    backgroundColor: 'rgba(255,255,255,0.62)',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  planStatLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#7B8490',
  },
  planStatValue: {
    marginTop: 4,
    fontSize: 14,
    fontWeight: '700',
    color: '#17191C',
  },
  enableSwitchRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.86)',
    backgroundColor: 'rgba(255,255,255,0.62)',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  enableSwitchCopy: {
    flex: 1,
    minWidth: 0,
  },
  enableSwitchTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    color: '#17191C',
  },
  enableSwitchDesc: {
    marginTop: 3,
    fontSize: 10,
    lineHeight: 16,
    color: '#59616D',
  },
  section: {
    marginTop: 20,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#7B8490',
  },
  standaloneSectionTitle: {
    marginBottom: 10,
  },
  cardContainer: {
    gap: 12,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.70)',
    backgroundColor: 'rgba(255,255,255,0.50)',
    shadowColor: '#46608A',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 34,
    elevation: 1,
    ...androidBoxShadow({
      offsetY: 12,
      blurRadius: 34,
      color: 'rgba(70, 96, 138, 0.08)',
    }),
  },
  optionRowActive: {
    backgroundColor: 'rgba(255,255,255,0.58)',
    borderColor: 'rgba(22,119,210,0.18)',
  },
  sourceIconBox: {
    width: 44,
    height: 44,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rangeIconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconBoxActive: {
    backgroundColor: '#1677D2',
  },
  iconBoxInactive: {
    backgroundColor: 'rgba(255,255,255,0.72)',
  },
  optionInfo: {
    flex: 1,
    minWidth: 0,
  },
  optionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#17191C',
  },
  optionDesc: {
    fontSize: 11,
    lineHeight: 18,
    color: '#59616D',
    marginTop: 4,
  },
  selectionBox: {
    width: 24,
    height: 24,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectionBoxActive: {
    borderColor: '#1677D2',
    backgroundColor: '#1677D2',
  },
  selectionBoxInactive: {
    borderColor: '#C9D6E4',
    backgroundColor: 'rgba(255,255,255,0.72)',
  },
  optionContainer: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.70)',
    backgroundColor: 'rgba(255,255,255,0.50)',
    shadowColor: '#46608A',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 34,
    elevation: 1,
    ...androidBoxShadow({
      offsetY: 12,
      blurRadius: 34,
      color: 'rgba(70, 96, 138, 0.08)',
    }),
  },
  optionRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  addFileButton: {
    backgroundColor: '#1677D2',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    flexShrink: 0,
    alignSelf: 'flex-start',
    shadowColor: '#1677D2',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 2,
  },
  addFileButtonDisabled: {
    opacity: 0.62,
  },
  addFileButtonText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  filesPreviewCard: {
    marginTop: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(22,119,210,0.12)',
    backgroundColor: 'rgba(245,251,255,0.72)',
    padding: 12,
    gap: 8,
  },
  filesPreviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  filesPreviewTitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    color: '#17191C',
  },
  filesPreviewMeta: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '600',
    color: '#7B8490',
  },
  filesSkippedNotice: {
    borderRadius: 10,
    backgroundColor: 'rgba(22,119,210,0.08)',
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '600',
    color: '#1677D2',
  },
  filePreviewRow: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filePreviewName: {
    flex: 1,
    minWidth: 0,
    fontSize: 11,
    lineHeight: 16,
    color: '#3F4A58',
  },
  filePreviewSize: {
    flexShrink: 0,
    fontSize: 10,
    lineHeight: 14,
    color: '#9AA3AE',
  },
  removeFileButton: {
    width: 24,
    height: 24,
    borderRadius: 8,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.78)',
    borderWidth: 1,
    borderColor: 'rgba(201,214,228,0.70)',
  },
  infoCard: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: 'rgba(255,255,255,0.50)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.70)',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#46608A',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 34,
    elevation: 1,
    ...androidBoxShadow({
      offsetY: 12,
      blurRadius: 34,
      color: 'rgba(70, 96, 138, 0.08)',
    }),
  },
  infoIconBox: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#FFF6D8',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  infoText: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    lineHeight: 22,
    color: '#3F4A58',
  },
  bottomActionBar: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.60)',
    backgroundColor: 'rgba(247,251,255,0.78)',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
  },
  confirmButton: {
    backgroundColor: '#1677D2',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1677D2',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.18,
    shadowRadius: 28,
    elevation: 3,
  },
  confirmButtonDisabled: {
    backgroundColor: '#A8B6CC',
    shadowOpacity: 0,
    elevation: 0,
  },
  confirmButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  // Date Picker iOS styles
  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  pickerCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: Platform.OS === 'ios' ? 30 : 16,
  },
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#edf2f7',
  },
  pickerCancelText: {
    fontSize: 15,
    color: '#718096',
  },
  pickerConfirmText: {
    fontSize: 15,
    color: '#1D4ED8',
    fontWeight: '600',
  },
  datePicker: {
    height: 200,
    width: '100%',
  },
});

function SelectionIndicator({
  selected,
  testID,
}: {
  selected: boolean;
  testID: string;
}) {
  return (
    <View
      testID={`${testID}-box`}
      style={[
        styles.selectionBox,
        selected ? styles.selectionBoxActive : styles.selectionBoxInactive,
      ]}
    >
      {selected ? (
        <Check testID={testID} size={12} color="#fff" strokeWidth={2.6} />
      ) : null}
    </View>
  );
}
