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
  Alert,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, CommonActions } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import {
  Check,
  ChevronLeft,
  CloudDownload,
  Image as ImageIcon,
  ShieldCheck,
} from 'lucide-react-native';

import { GradientBackground } from '../components/GradientBackground';
import { androidBoxShadow } from '../utils/androidShadow';
import {
  disableAutoUpload,
  enableAutoUpload,
  getAutoUploadConfig,
  prepareAutoUploadEnable,
  saveAutoUploadConfig,
} from '../services/SyncEngineModule';

const BLUE = '#1677D2';
const DARK = '#17191C';
const FALLBACK_COPY = {
  title: 'Auto Upload',
  subtitle: 'Set up phone content sync to computer',
  planTitle: 'Sync Plan',
  enableSwitchTitle: 'Auto Upload Switch',
  enableSwitchDescOn: 'Enabled. Album content will sync automatically',
  enableSwitchDescOff: 'Disabled. New album media will not sync automatically',
  sourcesTitle: 'Sync Sources',
  albumTitle: 'Photos and Videos',
  albumDesc: 'Sync media content from system album',
  rangeAllTitle: 'All Content',
  confirmEnable: 'Enable Auto Upload',
  confirmDisable: 'Disable Auto Upload',
  infoAlbum: 'Album photos and videos will sync to your computer.',
  infoAutoOff:
    'After auto upload is disabled, newly added media will not sync.',
  infoEmpty: 'Please select at least one sync source.',
  loadingConfig: 'Reading auto upload settings...',
  loadConfigFailed:
    'Failed to read auto upload settings. Please try again later.',
  disabledSuccess: 'Auto upload is disabled',
};

export function AutoUploadSettingsScreen() {
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
      rangeAllTitle:
        t('syncActivity.autoUploadSettings.rangeAllTitle') ||
        FALLBACK_COPY.rangeAllTitle,
      confirmEnable:
        t('syncActivity.autoUploadSettings.confirmEnable') ||
        FALLBACK_COPY.confirmEnable,
      confirmDisable:
        t('syncActivity.autoUploadSettings.confirmDisable') ||
        FALLBACK_COPY.confirmDisable,
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
  }, [copy.loadConfigFailed]);

  const persistAlbumAutoUploadConfig = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      setSaving(true);
      const wasPersistedEnabled = persistedAutoUploadEnabled;

      if (!wasPersistedEnabled) {
        await prepareAutoUploadEnable();
      }
      await saveAutoUploadConfig({
        enabled: true,
        timeRangeMode: 'all',
        customTimeFrom: undefined,
      });
      if (!wasPersistedEnabled) {
        await enableAutoUpload({ skipPermissionPreflight: true });
      }
      setPersistedAutoUploadEnabled(true);
      setAutoUploadEnabled(true);
    } catch (e) {
      console.warn('[AutoUploadSettings] save auto upload config failed:', e);
      if (!persistedAutoUploadEnabled) {
        setAutoUploadEnabled(false);
      }
      Alert.alert(
        t('syncActivity.dialogs.enableAutoFailed.title') || 'Action Failed',
        t('syncActivity.dialogs.enableAutoFailed.body') ||
          'Could not enable auto upload. Please try again later',
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
          t('syncActivity.dialogs.enableAutoFailed.title') || 'Action Failed',
          t('syncActivity.dialogs.enableAutoFailed.body') ||
            'Could not enable auto upload. Please try again later',
        );
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
      return;
    }
    await persistAlbumAutoUploadConfig();
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

  const planRangeLabel = autoUploadEnabled
    ? copy.rangeAllTitle
    : t('common.notApplicable') || 'N/A';
  const infoText = renderInfoText();

  return (
    <GradientBackground>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            testID="auto-upload-back"
            style={styles.backButton}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={t('common.back') || 'Back'}
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
                  {t('syncActivity.autoUploadSettings.planSource') || 'Sources'}
                </Text>
                <Text style={styles.planStatValue}>{planSourceCount}</Text>
              </View>
              <View style={styles.planStatItem}>
                <Text style={styles.planStatLabel}>
                  {t('syncActivity.autoUploadSettings.planFile') || 'File'}
                </Text>
                <Text style={styles.planStatValue}>{planFileCount}</Text>
              </View>
              <View style={styles.planStatItem}>
                <Text style={styles.planStatLabel}>
                  {t('syncActivity.autoUploadSettings.planRange') || 'Range'}
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
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>{copy.sourcesTitle}</Text>
              </View>
              <View style={styles.cardContainer}>
                <View
                  style={[styles.optionRow, styles.optionRowActive]}
                  testID="auto-upload-source-album"
                  accessibilityState={{ selected: true }}
                >
                  <View style={[styles.sourceIconBox, styles.iconBoxActive]}>
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
    </GradientBackground>
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
  iconBoxActive: {
    backgroundColor: '#1677D2',
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
