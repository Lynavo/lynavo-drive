import React, {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from 'react';
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
  Folder,
  Image as ImageIcon,
  ShieldCheck,
} from 'lucide-react-native';
import DateTimePicker, {
  DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import type { AutoUploadTimeRangeMode } from '@lynavo-drive/contracts';

import { GlobalGradientBackground } from '../components/GlobalGradientBackground';
import { androidBoxShadow } from '../utils/androidShadow';
import {
  disableAutoUpload,
  enableAutoUpload,
  getAutoUploadConfig,
  prepareAutoUploadEnable,
  saveAutoUploadConfig,
} from '../services/SyncEngineModule';

type AutoUploadRange = 'all' | 'now' | 'custom';

const BLUE = '#1677D2';
const DARK = '#17191C';
const MUTED_ICON = '#7B8490';
const FALLBACK_COPY = {
  title: '自动上传',
  subtitle: '设置手机内容同步到电脑',
  planTitle: '同步计划',
  enableSwitchTitle: '自动上传开关',
  enableSwitchDescOn: '已开启，会按同步范围自动同步相册新增素材',
  enableSwitchDescOff: '已关闭，不会自动同步相册新增素材',
  sourcesTitle: '同步来源',
  albumTitle: '照片和视频',
  albumDesc: '同步系统相册中的媒体内容',
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

export function AutoUploadSettingsGlobalScreen() {
  const navigation = useNavigation();
  const { t } = useTranslation();

  const copy = useMemo(
    () => ({
      title: t('syncActivity.autoUploadSettings.title') || FALLBACK_COPY.title,
      subtitle:
        t('syncActivity.autoUploadSettings.subtitle') || FALLBACK_COPY.subtitle,
      planTitle:
        t('syncActivity.autoUploadSettings.planTitle') ||
        FALLBACK_COPY.planTitle,
      enableSwitchTitle:
        t('syncActivity.autoUploadSettings.enableSwitchTitle') ||
        FALLBACK_COPY.enableSwitchTitle,
      enableSwitchDescOn:
        t('syncActivity.autoUploadSettings.enableSwitchDescOn') ||
        FALLBACK_COPY.enableSwitchDescOn,
      enableSwitchDescOff:
        t('syncActivity.autoUploadSettings.enableSwitchDescOff') ||
        FALLBACK_COPY.enableSwitchDescOff,
      sourcesTitle:
        t('syncActivity.autoUploadSettings.sourcesTitle') ||
        FALLBACK_COPY.sourcesTitle,
      albumTitle:
        t('syncActivity.autoUploadSettings.albumTitle') ||
        FALLBACK_COPY.albumTitle,
      albumDesc:
        t('syncActivity.autoUploadSettings.albumDesc') ||
        FALLBACK_COPY.albumDesc,
      rangeTitle:
        t('syncActivity.autoUploadSettings.rangeTitle') ||
        FALLBACK_COPY.rangeTitle,
      rangeAllTitle:
        t('syncActivity.autoUploadSettings.rangeAllTitle') ||
        FALLBACK_COPY.rangeAllTitle,
      rangeAllDesc:
        t('syncActivity.autoUploadSettings.rangeAllDesc') ||
        FALLBACK_COPY.rangeAllDesc,
      rangeNowTitle:
        t('syncActivity.autoUploadSettings.rangeNowTitle') ||
        FALLBACK_COPY.rangeNowTitle,
      rangeNowDesc:
        t('syncActivity.autoUploadSettings.rangeNowDesc') ||
        FALLBACK_COPY.rangeNowDesc,
      rangeCustomTitle:
        t('syncActivity.autoUploadSettings.rangeCustomTitle') ||
        FALLBACK_COPY.rangeCustomTitle,
      rangeCustomDesc:
        t('syncActivity.autoUploadSettings.rangeCustomDesc') ||
        FALLBACK_COPY.rangeCustomDesc,
      confirmEnable:
        t('syncActivity.autoUploadSettings.confirmEnable') ||
        FALLBACK_COPY.confirmEnable,
      confirmDisable:
        t('syncActivity.autoUploadSettings.confirmDisable') ||
        FALLBACK_COPY.confirmDisable,
      customPickerSave:
        t('syncActivity.autoUploadSettings.customPickerSave') ||
        FALLBACK_COPY.customPickerSave,
      infoAlbum:
        t('syncActivity.autoUploadSettings.infoAlbum') ||
        FALLBACK_COPY.infoAlbum,
      infoAutoOff:
        t('syncActivity.autoUploadSettings.infoAutoOff') ||
        FALLBACK_COPY.infoAutoOff,
      infoEmpty:
        t('syncActivity.autoUploadSettings.infoEmpty') ||
        FALLBACK_COPY.infoEmpty,
      loadingConfig:
        t('syncActivity.autoUploadSettings.loadingConfig') ||
        FALLBACK_COPY.loadingConfig,
      loadConfigFailed:
        t('syncActivity.autoUploadSettings.loadConfigFailed') ||
        FALLBACK_COPY.loadConfigFailed,
      disabledSuccess:
        t('syncActivity.autoUploadSettings.disabledSuccess') ||
        FALLBACK_COPY.disabledSuccess,
    }),
    [t],
  );

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
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const planSourceCount = autoUploadEnabled ? 1 : 0;
  const planFileCount = 0;

  useEffect(() => {
    let mounted = true;

    const hydrateConfig = async () => {
      setConfigLoading(true);
      try {
        const config = await getAutoUploadConfig();
        if (!mounted) return;

        setPersistedAutoUploadEnabled(config.enabled);
        setAutoUploadEnabled(config.enabled);
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
          setConfigError(copy.loadConfigFailed);
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
    if (autoUploadEnabled) {
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
    if (autoUploadEnabled) {
      void persistAlbumAutoUploadConfig('custom', tempDate, true);
    }
  };

  // Render dynamic explanation sentence
  const renderInfoText = () => {
    if (configLoading) {
      return copy.loadingConfig;
    }
    if (configError) {
      return configError;
    }
    if (!autoUploadEnabled) {
      return copy.infoAutoOff;
    }
    return copy.infoAlbum;
  };

  const activeRangeLabel =
    uploadRange === 'all'
      ? copy.rangeAllTitle
      : uploadRange === 'now'
        ? copy.rangeNowTitle
        : copy.rangeCustomTitle;
  const planRangeLabel =
    autoUploadEnabled ? activeRangeLabel : t('common.notApplicable') || '不适用';
  const infoText = renderInfoText();

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
            accessibilityLabel={t('common.back') || '返回'}
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
            <Text style={styles.headerTitle}>{copy.title}</Text>
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {copy.subtitle}
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
                <Text style={styles.planTitle}>{copy.planTitle}</Text>
                <Text style={styles.planDescription}>{infoText}</Text>
              </View>
            </View>
            <View style={styles.planStatsRow}>
              <View style={styles.planStatItem}>
                <Text style={styles.planStatLabel}>
                  {t('syncActivity.autoUploadSettings.planSource') || '来源'}
                </Text>
                <Text style={styles.planStatValue}>{planSourceCount}</Text>
              </View>
              <View style={styles.planStatItem}>
                <Text style={styles.planStatLabel}>
                  {t('syncActivity.autoUploadSettings.planFile') || '文件'}
                </Text>
                <Text style={styles.planStatValue}>{planFileCount}</Text>
              </View>
              <View style={styles.planStatItem}>
                <Text style={styles.planStatLabel}>
                  {t('syncActivity.autoUploadSettings.planRange') || '范围'}
                </Text>
                <Text style={styles.planStatValue} numberOfLines={1}>
                  {planRangeLabel}
                </Text>
              </View>
            </View>
            <View style={styles.enableSwitchRow}>
              <View style={styles.enableSwitchCopy}>
                <Text style={styles.enableSwitchTitle}>
                  {copy.enableSwitchTitle}
                </Text>
                <Text style={styles.enableSwitchDesc}>
                  {autoUploadEnabled
                    ? copy.enableSwitchDescOn
                    : copy.enableSwitchDescOff}
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
                  <Text style={styles.sectionTitle}>{copy.sourcesTitle}</Text>
                </View>
                <View style={styles.cardContainer}>
                  {/* Option 1: Album */}
                  <View
                    style={[styles.optionRow, styles.optionRowActive]}
                    testID="auto-upload-source-album"
                    accessibilityState={{ selected: true }}
                  >
                    <View
                      style={[styles.sourceIconBox, styles.iconBoxActive]}
                    >
                      <ImageIcon
                        testID="auto-upload-source-album-icon"
                        size={20}
                        color="#fff"
                        strokeWidth={1.9}
                      />
                    </View>
                    <View style={styles.optionInfo}>
                      <Text style={styles.optionTitle}>{copy.albumTitle}</Text>
                      <Text style={styles.optionDesc}>{copy.albumDesc}</Text>
                    </View>
                    <SelectionIndicator
                      selected
                      testID="auto-upload-source-album-check-icon"
                    />
                  </View>
                </View>
              </View>

              {/* Upload Range */}
              <View style={styles.section}>
                <Text
                  style={[styles.sectionTitle, styles.standaloneSectionTitle]}
                >
                  {copy.rangeTitle}
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
                        {copy.rangeAllTitle}
                      </Text>
                      <Text style={styles.optionDesc}>
                        {copy.rangeAllDesc}
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
                        {copy.rangeNowTitle}
                      </Text>
                      <Text style={styles.optionDesc}>
                        {copy.rangeNowDesc}
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
                        {copy.rangeCustomTitle}
                      </Text>
                      <Text style={styles.optionDesc}>
                        {copy.rangeCustomDesc}
                      </Text>
                    </View>
                    <SelectionIndicator
                      selected={uploadRange === 'custom'}
                      testID="auto-upload-range-custom-check-icon"
                    />
                  </TouchableOpacity>
                </View>
              </View>
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
                    {copy.customPickerSave}
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
