import React, { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  ArrowUpToLine,
  Check,
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  Laptop,
  Languages,
  MessageSquare,
  Monitor,
  Pencil,
  Smartphone,
} from 'lucide-react-native';
import * as RNLocalize from 'react-native-localize';
import type { StackNavigationProp } from '@react-navigation/stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { BindingStateDTO, ConnectionState } from '@lynavo-drive/contracts';

import { GlobalGradientBackground } from '../components/GlobalGradientBackground';
import { GlobalBottomTabBar } from '../components/GlobalBottomTabBar';
import { ModalBlurBackdrop } from '../components/shared/ModalBlurBackdrop';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { androidBoxShadow } from '../utils/androidShadow';
import {
  getAppInfo,
  getBindingState,
  getClientDisplayName,
  setClientDisplayName,
  type AppInfo,
} from '../services/SyncEngineModule';
import {
  loadStoredLanguagePreference,
  resolveLanguagePreference,
  saveLanguagePreference,
  type LanguagePreference,
} from '../i18n/language-preference';
import i18n from '../i18n';
import { useTranslation } from 'react-i18next';
import {
  isDiagnosticsExportUnavailable,
  shareDiagnosticsArchive,
} from '../utils/shareDiagnosticsArchive';

type NavigationProp = StackNavigationProp<RootStackParamList, 'Settings'>;
type TabKey = 'home' | 'files' | 'settings';
type LucideNativeIcon = typeof Smartphone;

interface SettingsGlobalScreenProps {
  showBottomTabBar?: boolean;
  onTabPress?: (tab: TabKey) => void;
}

type SettingsRowProps = {
  icon: LucideNativeIcon;
  iconBackground: string;
  iconColor: string;
  title: string;
  subtitle?: string;
  badge?: string;
  badgeTone?: 'blue' | 'green';
  danger?: boolean;
  showChevron?: boolean;
  rightAccessory?: React.ReactNode;
  onPress?: () => void;
  testID?: string;
  last?: boolean;
};

type LanguageMode = 'system' | 'manual';
type LanguageId = Exclude<LanguagePreference, 'system'>;

type ModalTone = 'blue' | 'purple' | 'red';

const NEUTRAL_VALUE = '--';

const LANGUAGE_OPTIONS: Array<{ id: LanguageId; label: string }> = [
  { id: 'zh-Hans', label: 'Simplified Chinese' },
  { id: 'zh-Hant', label: 'Traditional Chinese' },
  { id: 'en', label: 'English' },
];

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function getConnectionLabel(state: ConnectionState, t: any): string {
  switch (state) {
    case 'connected':
      return t('settings.global.connected');
    case 'connecting':
      return t('settings.global.connecting');
    case 'discovering':
      return t('settings.global.discovering');
    case 'bound':
      return t('settings.global.bound');
    case 'offline':
      return t('settings.global.offline');
    default:
      return t('settings.global.statusUnknown');
  }
}

function getDesktopTitle(binding: BindingStateDTO | null, t: any): string {
  if (!binding) return t('settings.global.notBound');
  return (
    firstNonEmptyString(
      binding.deviceAlias,
      binding.deviceName,
      binding.host,
    ) ?? t('settings.global.currentDesktop')
  );
}

function getDesktopSubtitle(binding: BindingStateDTO | null, t: any): string {
  if (!binding) return t('settings.global.notConnectedAny');
  return t('settings.global.currentDeviceStatus', {
    status: getConnectionLabel(binding.connectionState, t),
  });
}

function getLanguageLabel(preference: LanguagePreference, t: any): string {
  if (preference === 'system') {
    return t('settings.global.followSystem');
  }
  return (
    LANGUAGE_OPTIONS.find(option => option.id === preference)?.label ??
    NEUTRAL_VALUE
  );
}

function getVersionLabel(appInfo: AppInfo | null, t: any): string {
  const version = firstNonEmptyString(appInfo?.version);
  if (!version)
    return t('settings.global.versionEmpty', { value: NEUTRAL_VALUE });
  const build = firstNonEmptyString(appInfo?.build);
  return build
    ? t('settings.global.versionWithBuild', { version, build })
    : t('settings.global.versionOnly', { version });
}

export function SettingsGlobalScreen({
  showBottomTabBar = true,
  onTabPress,
}: SettingsGlobalScreenProps) {
  const { t } = useTranslation();
  const navigation = useNavigation<NavigationProp>();
  const [activeView, setActiveView] = useState<'settings' | 'language'>(
    'settings',
  );
  const [bindingState, setBindingState] = useState<BindingStateDTO | null>(
    null,
  );
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [deviceNameError, setDeviceNameError] = useState<string | null>(null);
  const [isSavingDeviceName, setIsSavingDeviceName] = useState(false);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [languageMode, setLanguageMode] = useState<LanguageMode>('system');
  const [language, setLanguage] = useState<LanguageId>('zh-Hans');
  const [languagePreference, setLanguagePreference] =
    useState<LanguagePreference>('system');
  const [languageError, setLanguageError] = useState<string | null>(null);
  const [showEditDevice, setShowEditDevice] = useState(false);
  const [isExportingDiagnostics, setIsExportingDiagnostics] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void getBindingState()
      .then(binding => {
        if (!cancelled) {
          setBindingState(binding);
        }
      })
      .catch(error => {
        console.warn('[SettingsGlobal] getBindingState failed:', error);
        if (!cancelled) {
          setBindingState(null);
        }
      });

    void getClientDisplayName()
      .then(name => {
        const trimmed = firstNonEmptyString(name);
        if (!cancelled && trimmed) {
          setDeviceName(trimmed);
        }
      })
      .catch(error => {
        console.warn('[SettingsGlobal] getClientDisplayName failed:', error);
      });

    void getAppInfo()
      .then(info => {
        if (!cancelled) {
          setAppInfo(info);
        }
      })
      .catch(error => {
        console.warn('[SettingsGlobal] getAppInfo failed:', error);
        if (!cancelled) {
          setAppInfo(null);
        }
      });

    void loadStoredLanguagePreference()
      .then(preference => {
        if (cancelled) return;
        setLanguagePreference(preference);
        if (preference === 'system') {
          setLanguageMode('system');
          setLanguage(
            resolveLanguagePreference('system', RNLocalize.getLocales()),
          );
          return;
        }
        setLanguageMode('manual');
        setLanguage(preference);
      })
      .catch(error => {
        console.warn(
          '[SettingsGlobal] load language preference failed:',
          error,
        );
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const currentDeviceName = deviceName ?? NEUTRAL_VALUE;
  const languageSubtitle = getLanguageLabel(languagePreference, t);

  const handleOpenEditDevice = () => {
    setEditingName(deviceName ?? '');
    setDeviceNameError(null);
    setShowEditDevice(true);
  };

  const handleSaveDeviceName = async () => {
    const nextName = editingName.trim();
    if (nextName.length === 0) {
      setDeviceNameError(t('settings.global.errorDeviceNameEmpty'));
      return;
    }
    setIsSavingDeviceName(true);
    setDeviceNameError(null);
    try {
      await setClientDisplayName(nextName);
      setDeviceName(nextName);
      setShowEditDevice(false);
    } catch (error) {
      console.warn('[SettingsGlobal] setClientDisplayName failed:', error);
      setDeviceNameError(t('settings.global.errorDeviceNameSave'));
    } finally {
      setIsSavingDeviceName(false);
    }
  };

  const handleLanguagePreferenceChange = async (
    preference: LanguagePreference,
  ) => {
    setLanguageError(null);
    try {
      await saveLanguagePreference(preference);
      const resolved = resolveLanguagePreference(
        preference,
        RNLocalize.getLocales(),
      );
      await i18n.changeLanguage(resolved);
      setLanguagePreference(preference);
      if (preference === 'system') {
        setLanguageMode('system');
        setLanguage(resolved);
      } else {
        setLanguageMode('manual');
        setLanguage(preference);
      }
    } catch (error) {
      console.warn('[SettingsGlobal] save language preference failed:', error);
      setLanguageError(t('settings.dialogs.languageSaveFailed.body'));
    }
  };

  const handleExportDiagnostics = async () => {
    if (isExportingDiagnostics) return;
    setIsExportingDiagnostics(true);
    try {
      await shareDiagnosticsArchive();
    } catch (error) {
      console.warn('[SettingsGlobal] exportDiagnostics failed:', error);
      if (isDiagnosticsExportUnavailable(error)) {
        Alert.alert(
          t('settings.dialogs.exportUnavailable.title'),
          t('settings.dialogs.exportUnavailable.body'),
        );
      } else {
        Alert.alert(
          t('settings.dialogs.exportFailed.title'),
          t('settings.dialogs.exportFailed.body'),
        );
      }
    } finally {
      setIsExportingDiagnostics(false);
    }
  };

  if (activeView === 'language') {
    return (
      <LanguageGlobalView
        mode={languageMode}
        language={language}
        errorMessage={languageError}
        onBack={() => setActiveView('settings')}
        onModeChange={mode => {
          if (mode === 'system') {
            void handleLanguagePreferenceChange('system');
            return;
          }
          setLanguageMode('manual');
        }}
        onLanguageChange={nextLanguage => {
          void handleLanguagePreferenceChange(nextLanguage);
        }}
      />
    );
  }

  return (
    <GlobalGradientBackground>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <ScrollView
          testID="global-settings-scroll"
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <Text style={styles.title}>{t('settings.global.my')}</Text>
            <Text style={styles.subtitle}>
              {t('settings.global.mySubtitle')}
            </Text>
          </View>

          <SettingsSection title={t('settings.sections.device')}>
            <SettingsRow
              icon={Smartphone}
              iconBackground="#E4F5FF"
              iconColor="#1677D2"
              title={t('settings.global.deviceName')}
              subtitle={currentDeviceName}
              rightAccessory={
                <TouchableOpacity
                  testID="global-settings-edit-device-name"
                  style={styles.editIconButton}
                  accessibilityRole="button"
                  accessibilityLabel={t('settings.global.editDeviceName')}
                  activeOpacity={0.72}
                  onPress={handleOpenEditDevice}
                >
                  <Pencil size={16} color="#9AA6B2" strokeWidth={1.9} />
                </TouchableOpacity>
              }
              last
            />
          </SettingsSection>

          <SettingsSection title={t('settings.sections.computers')}>
            <SettingsRow
              icon={Laptop}
              iconBackground="#EEEAFB"
              iconColor="#746AA8"
              title={getDesktopTitle(bindingState, t)}
              subtitle={getDesktopSubtitle(bindingState, t)}
              badge={
                bindingState
                  ? t('deviceDiscovery.switch.badge.current')
                  : undefined
              }
              badgeTone="green"
            />
            <SettingsRow
              icon={Monitor}
              iconBackground="#E4F5FF"
              iconColor="#1677D2"
              title={t('settings.actions.switchDevice')}
              subtitle={t('settings.actions.switchDeviceDesc')}
              showChevron
              onPress={() =>
                navigation.navigate('DeviceDiscovery', { mode: 'switch' })
              }
              last
            />
          </SettingsSection>

          <SettingsSection title={t('settings.sections.general')}>
            <SettingsRow
              icon={Languages}
              iconBackground="#E4F5FF"
              iconColor="#1677D2"
              title={t('settings.rows.language')}
              subtitle={languageSubtitle}
              showChevron
              testID="global-settings-language"
              onPress={() => setActiveView('language')}
            />
            <SettingsRow
              icon={HelpCircle}
              iconBackground="#E4F5FF"
              iconColor="#1677D2"
              title={t('settings.rows.faq')}
              subtitle={t('settings.rows.faqDesc')}
              showChevron
              onPress={() => navigation.navigate('Help')}
            />
            <SettingsRow
              icon={MessageSquare}
              iconBackground="#EEEAFB"
              iconColor="#746AA8"
              title={t('settings.global.appVersionShort')}
              subtitle={getVersionLabel(appInfo, t)}
            />
            <SettingsRow
              icon={ArrowUpToLine}
              iconBackground="#E4F5FF"
              iconColor="#1677D2"
              title={t('settings.global.exportDiagnosticsTitle')}
              subtitle={t('settings.rows.diagnosticsDesc')}
              showChevron
              last
              onPress={() => {
                void handleExportDiagnostics();
              }}
            />
          </SettingsSection>
        </ScrollView>
      </SafeAreaView>

      {showBottomTabBar ? (
        <GlobalBottomTabBar activeTab="settings" onTabPress={onTabPress} />
      ) : null}

      {showEditDevice ? (
        <GlobalSettingsModalFrame
          title={t('settings.global.editDeviceTitle')}
          description={t('settings.global.editDeviceDesc')}
          icon={Pencil}
          tone="blue"
          onClose={() => setShowEditDevice(false)}
        >
          <TextInput
            style={styles.modalInput}
            value={editingName}
            onChangeText={setEditingName}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => {
              void handleSaveDeviceName();
            }}
          />
          {deviceNameError ? (
            <Text style={styles.modalErrorText}>{deviceNameError}</Text>
          ) : null}
          <View style={styles.modalSplitActions}>
            <TouchableOpacity
              style={styles.modalSecondaryButton}
              accessibilityRole="button"
              activeOpacity={0.72}
              onPress={() => setShowEditDevice(false)}
            >
              <Text style={styles.modalSecondaryButtonText}>
                {t('settings.global.cancel')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.modalPrimaryButton}
              accessibilityRole="button"
              activeOpacity={0.72}
              disabled={isSavingDeviceName}
              onPress={() => {
                void handleSaveDeviceName();
              }}
            >
              <Text style={styles.modalPrimaryButtonText}>
                {isSavingDeviceName
                  ? t('settings.global.saving')
                  : t('settings.global.save')}
              </Text>
            </TouchableOpacity>
          </View>
        </GlobalSettingsModalFrame>
      ) : null}
    </GlobalGradientBackground>
  );
}

function LanguageGlobalView({
  mode,
  language,
  errorMessage,
  onBack,
  onModeChange,
  onLanguageChange,
}: {
  mode: LanguageMode;
  language: LanguageId;
  errorMessage: string | null;
  onBack: () => void;
  onModeChange: (mode: LanguageMode) => void;
  onLanguageChange: (language: LanguageId) => void;
}) {
  const { t } = useTranslation();

  return (
    <GlobalGradientBackground>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.childHeader}>
          <TouchableOpacity
            testID="global-language-back"
            style={styles.childBackButton}
            accessibilityRole="button"
            accessibilityLabel={t('settings.global.back')}
            activeOpacity={0.72}
            onPress={onBack}
          >
            <ChevronLeft size={20} color="#17191C" strokeWidth={1.9} />
          </TouchableOpacity>
          <Text style={styles.childTitle}>
            {t('settings.global.languageTitle')}
          </Text>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.languageContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.card}>
            <LanguageModeRow
              title={t('settings.global.systemLanguage')}
              selected={mode === 'system'}
              onPress={() => onModeChange('system')}
            />
            <LanguageModeRow
              title={t('settings.global.manualLanguage')}
              selected={mode === 'manual'}
              onPress={() => onModeChange('manual')}
              last
            />
          </View>

          {mode === 'manual' ? (
            <View style={[styles.card, styles.languageOptionsCard]}>
              {LANGUAGE_OPTIONS.map((item, index) => (
                <TouchableOpacity
                  key={item.id}
                  style={[
                    styles.languageOptionRow,
                    index < LANGUAGE_OPTIONS.length - 1 && styles.rowDivider,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={item.label}
                  activeOpacity={0.72}
                  onPress={() => onLanguageChange(item.id)}
                >
                  <Text style={styles.languageOptionText}>{item.label}</Text>
                  {language === item.id ? (
                    <Check size={18} color="#1677D2" strokeWidth={2.4} />
                  ) : null}
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
          {errorMessage ? (
            <Text style={styles.languageErrorText}>{errorMessage}</Text>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </GlobalGradientBackground>
  );
}

function LanguageModeRow({
  title,
  selected,
  onPress,
  last = false,
}: {
  title: string;
  selected: boolean;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.languageModeRow, !last && styles.rowDivider]}
      accessibilityRole="button"
      accessibilityLabel={title}
      activeOpacity={0.72}
      onPress={onPress}
    >
      <Text style={styles.languageModeText}>{title}</Text>
      <View
        style={[
          styles.radio,
          selected ? styles.radioSelected : styles.radioUnselected,
        ]}
      >
        {selected ? (
          <Check size={14} color="#FFFFFF" strokeWidth={2.6} />
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

function GlobalSettingsModalFrame({
  title,
  description,
  icon,
  tone,
  onClose,
  children,
}: {
  title: string;
  description: string;
  icon: LucideNativeIcon;
  tone: ModalTone;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ModalIcon = icon;
  const toneStyle =
    tone === 'red'
      ? styles.modalIconRed
      : tone === 'purple'
        ? styles.modalIconPurple
        : styles.modalIconBlue;
  const iconColor =
    tone === 'red' ? '#E24D4D' : tone === 'purple' ? '#746AA8' : '#1677D2';

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <ModalBlurBackdrop />
        <Pressable style={styles.modalCard} onPress={() => undefined}>
          <View style={styles.modalHeader}>
            <View style={[styles.modalIcon, toneStyle]}>
              <ModalIcon size={22} color={iconColor} strokeWidth={1.9} />
            </View>
            <View style={styles.modalCopy}>
              <Text style={styles.modalTitle}>{title}</Text>
              <Text style={styles.modalDescription}>{description}</Text>
            </View>
          </View>
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function SettingsRow({
  icon,
  iconBackground,
  iconColor,
  title,
  subtitle,
  badge,
  badgeTone = 'blue',
  danger = false,
  showChevron = false,
  rightAccessory,
  onPress,
  testID,
  last = false,
}: SettingsRowProps) {
  const RowIcon = icon;
  const content = (
    <>
      <View style={[styles.iconBox, { backgroundColor: iconBackground }]}>
        <RowIcon size={18} color={iconColor} strokeWidth={1.9} />
      </View>
      <View style={styles.rowText}>
        <Text
          style={[styles.rowTitle, danger && styles.dangerText]}
          numberOfLines={1}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {badge ? (
        <View
          style={[
            styles.badge,
            badgeTone === 'green' ? styles.badgeGreen : styles.badgeBlue,
          ]}
        >
          <Text
            style={[
              styles.badgeText,
              badgeTone === 'green'
                ? styles.badgeTextGreen
                : styles.badgeTextBlue,
            ]}
          >
            {badge}
          </Text>
        </View>
      ) : null}
      {rightAccessory}
      {showChevron ? (
        <ChevronRight size={16} color="#C9D6E4" strokeWidth={1.9} />
      ) : null}
    </>
  );

  const rowStyle = [styles.row, !last && styles.rowDivider];

  if (onPress) {
    return (
      <TouchableOpacity
        testID={testID}
        style={rowStyle}
        accessibilityRole="button"
        accessibilityLabel={title}
        activeOpacity={0.72}
        onPress={onPress}
      >
        {content}
      </TouchableOpacity>
    );
  }

  return (
    <View testID={testID} style={rowStyle}>
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 24,
  },
  header: {
    marginBottom: 20,
  },
  title: {
    fontSize: 25,
    lineHeight: 32,
    fontWeight: '600',
    color: '#17191C',
  },
  subtitle: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 20,
    color: '#59616D',
  },
  section: {
    marginBottom: 20,
  },
  sectionLabel: {
    marginBottom: 10,
    marginLeft: 4,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
    color: '#7B8490',
  },
  card: {
    overflow: 'hidden',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.70)',
    backgroundColor: 'rgba(255,255,255,0.58)',
    shadowColor: '#46608A',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.12,
    shadowRadius: 52,
    elevation: 3,
    ...androidBoxShadow({
      offsetY: 18,
      blurRadius: 52,
      color: 'rgba(70, 96, 138, 0.12)',
    }),
  },
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.60)',
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: '#17191C',
  },
  rowSubtitle: {
    marginTop: 2,
    fontSize: 11,
    lineHeight: 16,
    color: '#59616D',
  },
  dangerText: {
    color: '#E24D4D',
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeBlue: {
    backgroundColor: '#DBEAFE',
  },
  badgeGreen: {
    backgroundColor: '#DCFCE7',
  },
  badgeText: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '600',
  },
  badgeTextBlue: {
    color: '#2563EB',
  },
  badgeTextGreen: {
    color: '#16A34A',
  },
  editIconButton: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  childHeader: {
    marginHorizontal: 12,
    marginTop: 12,
    marginBottom: 2,
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.70)',
    backgroundColor: 'rgba(255,255,255,0.54)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowColor: '#46608A',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.1,
    shadowRadius: 38,
    elevation: 3,
    ...androidBoxShadow({
      offsetY: 14,
      blurRadius: 38,
      color: 'rgba(70, 96, 138, 0.10)',
    }),
  },
  childBackButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.62)',
  },
  childTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    color: '#17191C',
  },
  languageContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 34,
  },
  languageModeRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 15,
  },
  languageModeText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '500',
    color: '#17191C',
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  radioSelected: {
    borderColor: '#1677D2',
    backgroundColor: '#1677D2',
  },
  radioUnselected: {
    borderColor: '#D1D5DB',
    backgroundColor: '#FFFFFF',
  },
  languageOptionsCard: {
    marginTop: 20,
  },
  languageErrorText: {
    marginTop: 14,
    marginHorizontal: 4,
    fontSize: 12,
    lineHeight: 18,
    color: '#E24D4D',
  },
  languageOptionRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  languageOptionText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
    color: '#17191C',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 336,
    alignSelf: 'center',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.68)',
    backgroundColor: 'rgba(255,255,255,0.94)',
    paddingHorizontal: 20,
    paddingVertical: 20,
    shadowColor: '#173D58',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 28,
    elevation: 10,
    ...androidBoxShadow({
      offsetY: 12,
      blurRadius: 28,
      color: 'rgba(23, 61, 88, 0.18)',
    }),
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  modalIcon: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalIconBlue: {
    backgroundColor: '#E4F5FF',
  },
  modalIconPurple: {
    backgroundColor: '#EEEAFB',
  },
  modalIconRed: {
    backgroundColor: '#FFF0F0',
  },
  modalCopy: {
    flex: 1,
    minWidth: 0,
  },
  modalTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    color: '#17191C',
  },
  modalDescription: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 24,
    color: '#3F4A58',
  },
  modalInput: {
    marginTop: 20,
    minHeight: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(23,25,28,0.08)',
    backgroundColor: 'rgba(23,25,28,0.04)',
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    lineHeight: 20,
    color: '#17191C',
  },
  modalErrorText: {
    marginTop: 12,
    fontSize: 12,
    lineHeight: 18,
    color: '#E24D4D',
  },
  modalResultText: {
    marginTop: 14,
    fontSize: 13,
    lineHeight: 20,
  },
  modalResultSuccess: {
    color: '#16803C',
  },
  modalResultNeutral: {
    color: '#3F4A58',
  },
  modalResultError: {
    color: '#E24D4D',
  },
  modalSplitActions: {
    marginTop: 20,
    flexDirection: 'row',
    gap: 12,
  },
  modalSecondaryButton: {
    flex: 0.78,
    minHeight: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(23,25,28,0.06)',
  },
  modalPrimaryButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1677D2',
  },
  modalDangerButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E24D4D',
  },
  modalFullPrimaryButton: {
    marginTop: 20,
    minHeight: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1677D2',
  },
  modalSecondaryButtonText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600',
    color: '#59616D',
  },
  modalPrimaryButtonText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  modalDangerButtonText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  modalNoteInput: {
    marginTop: 20,
    minHeight: 82,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(23,25,28,0.08)',
    backgroundColor: 'rgba(23,25,28,0.04)',
    paddingHorizontal: 14,
    paddingTop: 11,
    paddingBottom: 11,
    fontSize: 14,
    lineHeight: 20,
    color: '#17191C',
  },
});
