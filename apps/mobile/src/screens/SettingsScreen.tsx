import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  NativeModules,
  NativeEventEmitter,
  Alert,
  Linking,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, CommonActions } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { Icon } from '../components/Icon';
import {
  useAuth,
  isFeatureAccessAllowed,
  getTrialRemainingDays,
} from '../stores/auth-store';
import { logout as serverLogout } from '../services/auth-service';
import {
  isDiagnosticsExportUnavailable,
  shareDiagnosticsArchive,
} from '../utils/shareDiagnosticsArchive';
import {
  buildSyncConnectionEvidence,
  getConnectionBadgeState,
  type MobileConnectionState,
} from '../utils/effectiveConnectionState';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BLUE = '#3b9fd8';
const DARK = '#1a3a5c';
const SCREEN_BG = '#d6ecf8';
const CARD_BG = '#ffffff';
const CARD_BORDER = 'rgba(187, 214, 233, 0.72)';
const MUTED_TEXT = '#7893ab';
const SECTION_TEXT = '#6e8aa3';
const ROW_CHEVRON = '#b8d0e4';
const ONLINE_GREEN = '#22c55e';
const ONLINE_TEXT = '#16a34a';
const CONNECTING_AMBER = '#f3b24c';
const CONNECTING_TEXT = '#b45309';
const OFFLINE_SLATE = '#94a3b8';
const OFFLINE_TEXT = '#72859a';
const DANGER_RED = '#ef4444';
const DANGER_BG = 'rgba(239,68,68,0.04)';
const SUB_GREEN = '#22c55e';
const SUB_GREEN_BG = 'rgba(34,197,94,0.12)';
const TRIAL_PURPLE = '#8b5cf6';
const TRIAL_PURPLE_BG = 'rgba(139,92,246,0.10)';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type NavigationProp = StackNavigationProp<RootStackParamList, 'Settings'>;
type SettingsSyncOverviewState = {
  progressPercent: number;
  transferredBytes: number;
  currentFile: string | null;
  currentFileConfirmedBytes: number;
  uploadState: string;
};

function formatAppVersionLabel(
  appInfo: Record<string, unknown> | undefined,
  t: TFunction,
): string {
  const version = typeof appInfo?.version === 'string' ? appInfo.version : '';
  if (!version) return t('common.unknownVersion');
  const build =
    typeof appInfo?.build === 'string' && appInfo.build ? appInfo.build : '0';
  return t('settings.versionLabel', { version, build });
}

function formatDateTimeLabel(iso: string | undefined, t: TFunction): string {
  if (!iso) return t('settings.status.noRecord');
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return t('settings.status.noRecord');

  const now = new Date();
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  if (date.toDateString() === now.toDateString()) {
    return t('settings.dates.todayAt', { time });
  }
  if (date.getFullYear() === now.getFullYear()) {
    return t('settings.dates.monthDayAt', {
      month: date.getMonth() + 1,
      day: date.getDate(),
      time,
    });
  }
  return t('settings.dates.fullDate', {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    time,
  });
}

function maskPhone(phone: string | undefined, t: TFunction): string {
  if (!phone) return t('settings.status.notBound');
  if (phone.length >= 7) {
    return phone.slice(0, 3) + '****' + phone.slice(-4);
  }
  return phone;
}

// ---------------------------------------------------------------------------
// SettingsScreen
// ---------------------------------------------------------------------------

export function SettingsScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { t } = useTranslation();
  const auth = useAuth();
  const isAndroid = Platform.OS === 'android';
  const [deviceName, setDeviceName] = useState('');
  const [deviceIp, setDeviceIp] = useState('');
  const [connectionState, setConnectionState] =
    useState<MobileConnectionState>('offline');
  const [syncOverviewState, setSyncOverviewState] =
    useState<SettingsSyncOverviewState>({
      progressPercent: 0,
      transferredBytes: 0,
      currentFile: null as string | null,
      currentFileConfirmedBytes: 0,
      uploadState: 'idle',
    });
  const [latestSyncLabel, setLatestSyncLabel] = useState(
    t('settings.status.noRecord'),
  );
  const [appVersionLabel, setAppVersionLabel] = useState(
    t('settings.status.reading'),
  );
  const [isPhotoPermissionBlocked, setIsPhotoPermissionBlocked] =
    useState(false);
  const [isExportingDiagnostics, setIsExportingDiagnostics] = useState(false);

  // My iPhone display name
  const [myName, setMyName] = useState('iPhone');
  const [editingMyName, setEditingMyName] = useState(false);

  // ---------------------------------------------------------------------------
  // Load real binding state + client display name from native module
  // ---------------------------------------------------------------------------

  useEffect(() => {
    let bindingSub: { remove: () => void } | undefined;
    let syncSub: { remove: () => void } | undefined;

    const applyBindingState = (
      state: Record<string, unknown> | null | undefined,
    ) => {
      if (!state || !state.deviceId) {
        setDeviceName('');
        setDeviceIp('');
        setConnectionState('offline');
        return;
      }

      setDeviceName(
        (state.deviceAlias as string) || (state.deviceName as string) || '',
      );
      setDeviceIp((state.host as string) || '');
      setConnectionState(
        (state.connectionState as typeof connectionState) || 'bound',
      );
    };

    const loadState = async () => {
      try {
        const { NativeSyncEngine } = NativeModules;
        if (!NativeSyncEngine) return;

        const emitter = new NativeEventEmitter(NativeSyncEngine);
        bindingSub = emitter.addListener(
          'onBindingStateChanged',
          applyBindingState,
        );
        syncSub = emitter.addListener(
          'onSyncStateChanged',
          (state: Record<string, unknown>) => {
            const uploadState = (state.uploadState as string) || 'idle';
            setSyncOverviewState(prev => ({
              progressPercent:
                typeof state.progressPercent === 'number'
                  ? state.progressPercent
                  : prev.progressPercent,
              transferredBytes:
                typeof state.transferredBytes === 'number'
                  ? state.transferredBytes
                  : prev.transferredBytes,
              currentFile: Object.prototype.hasOwnProperty.call(
                state,
                'currentFile',
              )
                ? typeof state.currentFile === 'string'
                  ? state.currentFile
                  : null
                : prev.currentFile,
              currentFileConfirmedBytes:
                typeof state.currentFileConfirmedBytes === 'number'
                  ? state.currentFileConfirmedBytes
                  : prev.currentFileConfirmedBytes,
              uploadState,
            }));
            setIsPhotoPermissionBlocked(uploadState === 'paused_no_permission');
          },
        );

        const [
          stateResult,
          clientNameResult,
          appInfoResult,
          historyResult,
          syncOverviewResult,
        ] = await Promise.allSettled([
          NativeSyncEngine.getBindingState?.() ?? Promise.resolve(null),
          NativeSyncEngine.getClientDisplayName?.() ??
            Promise.resolve('iPhone'),
          NativeSyncEngine.getAppInfo?.() ?? Promise.resolve(undefined),
          NativeSyncEngine.getHistoryDays?.(null) ?? Promise.resolve(undefined),
          NativeSyncEngine.getSyncOverview?.() ?? Promise.resolve(undefined),
        ]);

        if (stateResult.status === 'fulfilled' && stateResult.value) {
          applyBindingState(
            stateResult.value as Record<string, unknown> | null | undefined,
          );
        }

        if (clientNameResult.status === 'fulfilled' && clientNameResult.value) {
          setMyName(clientNameResult.value as string);
        }

        if (appInfoResult.status === 'fulfilled' && appInfoResult.value) {
          setAppVersionLabel(
            formatAppVersionLabel(
              appInfoResult.value as Record<string, unknown> | undefined,
              t,
            ),
          );
        } else {
          setAppVersionLabel(t('common.unknownVersion'));
        }

        const history =
          historyResult.status === 'fulfilled'
            ? (historyResult.value as
                | { items?: Array<Record<string, unknown>> }
                | undefined)
            : undefined;
        const items = history?.items as
          | Array<Record<string, unknown>>
          | undefined;
        if (items?.length) {
          let latestItem: Record<string, unknown> | null = null;
          for (const item of items) {
            if (!latestItem) {
              latestItem = item;
              continue;
            }
            const currentTs = new Date(String(item.updatedAt ?? 0)).getTime();
            const latestTs = new Date(
              String(latestItem.updatedAt ?? 0),
            ).getTime();
            if (currentTs > latestTs) {
              latestItem = item;
            }
          }
          if (latestItem?.updatedAt) {
            setLatestSyncLabel(
              `${formatDateTimeLabel(String(latestItem.updatedAt), t)} · ${String(latestItem.deviceName || 'Mac')}`,
            );
          }
        }
        const syncOverview =
          syncOverviewResult.status === 'fulfilled'
            ? (syncOverviewResult.value as
                | {
                    progressPercent?: number;
                    transferredBytes?: number;
                    currentFile?: string | null;
                    currentFileConfirmedBytes?: number;
                    uploadState?: string;
                  }
                | undefined)
            : undefined;
        setSyncOverviewState({
          progressPercent: syncOverview?.progressPercent ?? 0,
          transferredBytes: syncOverview?.transferredBytes ?? 0,
          currentFile:
            typeof syncOverview?.currentFile === 'string'
              ? syncOverview.currentFile
              : null,
          currentFileConfirmedBytes:
            syncOverview?.currentFileConfirmedBytes ?? 0,
          uploadState: syncOverview?.uploadState ?? 'idle',
        });
        setIsPhotoPermissionBlocked(
          syncOverview?.uploadState === 'paused_no_permission',
        );
      } catch (e) {
        setAppVersionLabel(t('common.unknownVersion'));
        console.warn('Native module not available for Settings');
      }
    };

    loadState();

    return () => {
      bindingSub?.remove();
      syncSub?.remove();
    };
  }, [t]);

  const connectionEvidence = buildSyncConnectionEvidence(syncOverviewState);
  const connectionBadgeState = getConnectionBadgeState(
    connectionState,
    connectionEvidence,
  );
  const isConnected = connectionBadgeState === 'online';
  const isConnecting = connectionBadgeState === 'connecting';

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleConfirmMyName = useCallback(async () => {
    setEditingMyName(false);
    const trimmed = myName.trim();
    if (!trimmed) return;
    try {
      const { NativeSyncEngine } = NativeModules;
      if (NativeSyncEngine) {
        await NativeSyncEngine.setClientDisplayName(trimmed);
      }
    } catch (e) {
      console.warn('Failed to save client display name');
    }
  }, [myName]);

  const handleSwitchDevice = useCallback(() => {
    Alert.alert(
      t('settings.dialogs.switchDevice.title'),
      t('settings.dialogs.switchDevice.body'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.dialogs.switchDevice.confirm'),
          style: 'destructive',
          onPress: async () => {
            try {
              const { NativeSyncEngine } = NativeModules;
              if (NativeSyncEngine) {
                await NativeSyncEngine.disconnectAndUnbind();
              }
            } catch (e) {
              console.warn('Failed to disconnect');
            }
            navigation.reset({
              index: 0,
              routes: [{ name: 'DeviceDiscovery' }],
            });
          },
        },
      ],
    );
  }, [navigation, t]);

  const handleExportDiagnostics = useCallback(async () => {
    try {
      setIsExportingDiagnostics(true);
      await shareDiagnosticsArchive();
    } catch (error) {
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
  }, [t]);

  const handleResetSyncStatus = useCallback(() => {
    Alert.alert(
      t('settings.dialogs.resetSync.title'),
      t('settings.dialogs.resetSync.body'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.dialogs.resetSync.confirm'),
          style: 'destructive',
          onPress: async () => {
            try {
              const { NativeSyncEngine } = NativeModules;
              if (NativeSyncEngine) {
                await NativeSyncEngine.resetAllStatus();
                await NativeSyncEngine.disconnectAndUnbind();
              }
            } catch (e) {
              console.warn('[Settings] reset error:', e);
            }
            navigation.dispatch(
              CommonActions.reset({
                index: 0,
                routes: [{ name: 'DeviceDiscovery' }],
              }),
            );
          },
        },
      ],
    );
  }, [navigation, t]);

  const handleLogout = useCallback(() => {
    Alert.alert(t('settings.dialogs.logout.title'), t('settings.dialogs.logout.body'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.dialogs.logout.confirm'),
        style: 'destructive',
        onPress: () => {
          // Snapshot the refresh token before clearAuth wipes it.
          const refresh = auth.refreshToken;

          // 1) Kick off the server-side revoke FIRST so the request is
          //    constructed while the access token is still in memory —
          //    `request()` reads `getAccessToken()` synchronously to build
          //    the Authorization header before its first await. We do NOT
          //    await this; the 5s timeout inside `auth-service.logout()`
          //    bounds how long it can run, and a slow/failed network must
          //    never block the local logout.
          if (refresh) {
            void serverLogout(refresh).catch((e) => {
              console.warn('[Settings] server logout failed (already cleared locally):', e);
            });
          }

          // 2) Now wipe local state + navigate. After this point the in-flight
          //    serverLogout fetch keeps the headers it captured above; the
          //    user is logged out locally regardless of network outcome.
          try {
            auth.clearAuth();
          } catch (e) {
            console.warn('[Settings] local logout error:', e);
          }
          navigation.dispatch(
            CommonActions.reset({
              index: 0,
              routes: [{ name: 'Login' }],
            }),
          );
        },
      },
    ]);
  }, [auth, navigation, t]);

  // Subscription derived state
  const userStatus = auth.user?.status;
  const trialDays = getTrialRemainingDays(auth.user);
  const isTrialing = userStatus === 'trialing';
  const isSubscribed = userStatus === 'subscribed';
  const isTrialExpired = userStatus === 'trial_expired';
  const isSubExpired = userStatus === 'sub_expired';
  const showSubCta = isTrialing || isTrialExpired || isSubExpired;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          activeOpacity={0.6}
          hitSlop={{ top: 15, bottom: 15, left: 15, right: 30 }}
          onPress={() => {
            if (navigation.canGoBack()) {
              navigation.goBack();
            } else {
              navigation.reset({
                index: 0,
                routes: [{ name: 'SyncActivity' as never }],
              });
            }
          }}
          accessibilityLabel={t('common.back')}
        >
          <Icon name="chevron-back" size={20} color={DARK} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('settings.title')}</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {isAndroid ? (
          <View style={styles.androidNoticeCard}>
            <Text style={styles.androidNoticeTitle}>
              {t('settings.android.title')}
            </Text>
            <Text style={styles.androidNoticeBody}>
              {t('settings.android.body')}
            </Text>
          </View>
        ) : null}

        {/* ============================================================= */}
        {/* Top two-card row: device + subscription                        */}
        {/* ============================================================= */}
        <View style={styles.topCardRow}>
          {/* Left: Connected device card (compact) */}
          <View style={[styles.topCard, styles.topCardLeft]}>
            <View style={styles.topCardIconRow}>
              <View style={styles.wifiIconCircle}>
                <Icon name="wifi" size={18} color="#fff" />
              </View>
              <Text style={styles.topCardSmallLabel}>{t('settings.sections.connectedDevice')}</Text>
            </View>
            <Text style={styles.topCardTitle} numberOfLines={1}>
              {deviceName || t('settings.connection.notConnected')}
            </Text>
            {deviceIp ? (
              <Text style={styles.topCardSubtext}>{deviceIp}</Text>
            ) : null}
            <View style={styles.topCardBottomRow}>
              <View style={styles.statusBadge}>
                <View
                  style={[
                    styles.statusDot,
                    isConnected
                      ? styles.statusDotOnline
                      : isConnecting
                        ? styles.statusDotConnecting
                        : styles.statusDotOffline,
                  ]}
                />
                <Text
                  style={[
                    styles.statusBadgeText,
                    isConnected
                      ? styles.statusTextOnline
                      : isConnecting
                        ? styles.statusTextConnecting
                        : styles.statusTextOffline,
                  ]}
                >
                  {isConnected
                    ? t('settings.connection.online')
                    : isConnecting
                      ? t('settings.connection.connecting')
                      : t('settings.connection.offline')}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.switchButton}
                activeOpacity={0.6}
                onPress={handleSwitchDevice}
              >
                <Text style={styles.switchButtonText}>{t('settings.actions.switch')}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Right: Subscription status card */}
          <View style={[styles.topCard, styles.topCardRight]}>
            <View style={styles.topCardIconRow}>
              <View
                style={[
                  styles.subIconCircle,
                  isSubscribed
                    ? { backgroundColor: SUB_GREEN_BG }
                    : { backgroundColor: TRIAL_PURPLE_BG },
                ]}
              >
                <Icon
                  name={isSubscribed ? 'shield-checkmark-outline' : 'time-outline'}
                  size={18}
                  color={isSubscribed ? SUB_GREEN : TRIAL_PURPLE}
                />
              </View>
              <Text style={styles.topCardSmallLabel}>
                {isSubscribed || isSubExpired
                  ? t('settings.subscription.subscribed')
                  : t('settings.subscription.trial')}
              </Text>
            </View>
            {isTrialing ? (
              <>
                <Text style={styles.topCardTitle}>
                  {t('settings.subscription.trialDays', { days: trialDays })}
                </Text>
                <Text style={styles.topCardSubtext}>
                  {t('settings.subscription.freeTrial')}
                </Text>
              </>
            ) : isTrialExpired ? (
              <Text style={[styles.topCardTitle, { color: DANGER_RED }]}>
                {t('settings.subscription.expired')}
              </Text>
            ) : isSubscribed ? (
              <Text style={[styles.topCardTitle, { color: SUB_GREEN }]}>
                {t('settings.subscription.active')}
              </Text>
            ) : isSubExpired ? (
              <Text style={[styles.topCardTitle, { color: DANGER_RED }]}>
                {t('settings.subscription.expired')}
              </Text>
            ) : (
              <Text style={styles.topCardTitle}>--</Text>
            )}
            {showSubCta ? (
              <TouchableOpacity
                activeOpacity={0.6}
                onPress={() => navigation.navigate('Subscription')}
                style={styles.subCtaRow}
              >
                <Text style={styles.subCtaText}>
                  {t('settings.subscription.subscribeCta')}
                </Text>
                <Icon name="chevron-forward" size={13} color={BLUE} />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {/* ============================================================= */}
        {/* My device name card                                            */}
        {/* ============================================================= */}
        <View style={styles.card}>
          <View style={styles.myDeviceRow}>
            <View style={styles.phoneIconCircle}>
              <Icon name="phone-portrait-outline" size={20} color="#fff" />
            </View>
            <View style={styles.myDeviceInfo}>
              <Text style={styles.myDeviceLabel}>{t('settings.myDevice.label')}</Text>
              {editingMyName ? (
                <View style={styles.editRow}>
                  <TextInput
                    style={styles.nameInput}
                    value={myName}
                    onChangeText={setMyName}
                    autoFocus
                    selectTextOnFocus
                    returnKeyType="done"
                    onSubmitEditing={handleConfirmMyName}
                  />
                  <TouchableOpacity
                    style={styles.confirmButton}
                    activeOpacity={0.7}
                    onPress={handleConfirmMyName}
                  >
                    <Icon name="checkmark" size={16} color={BLUE} />
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.nameRow}>
                  <Text style={styles.myDeviceName} numberOfLines={1}>
                    {myName}
                  </Text>
                  <TouchableOpacity
                    style={styles.editButton}
                    activeOpacity={0.7}
                    onPress={() => setEditingMyName(true)}
                  >
                    <Icon name="pencil-outline" size={14} color={MUTED_TEXT} />
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>
          <Text style={styles.myDeviceHint}>{t('settings.myDevice.hint')}</Text>
        </View>

        {/* ============================================================= */}
        {/* Info rows                                                      */}
        {/* ============================================================= */}
        <View style={styles.listCard}>
          {isPhotoPermissionBlocked ? (
            <>
              <View style={styles.warningBox}>
                <Text style={styles.warningTitle}>{t('settings.photoPermission.title')}</Text>
                <Text style={styles.warningText}>
                  {t('settings.photoPermission.body')}
                </Text>
                <TouchableOpacity
                  style={styles.warningAction}
                  activeOpacity={0.8}
                  onPress={() => {
                    void Linking.openSettings();
                  }}
                >
                  <Text style={styles.warningActionText}>{t('settings.photoPermission.openSettings')}</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.listSep} />
            </>
          ) : null}
          <View style={styles.infoRow}>
            <View style={styles.infoRowLeft}>
              <Icon name="person-outline" size={16} color={MUTED_TEXT} />
              <Text style={styles.infoRowLabel}>{t('settings.rows.currentAccount')}</Text>
            </View>
            <Text style={styles.infoRowValue}>
              {maskPhone(auth.user?.phone, t)}
            </Text>
          </View>
          <View style={styles.listSep} />
          <View style={styles.infoRow}>
            <View style={styles.infoRowLeft}>
              <Icon name="time-outline" size={16} color={MUTED_TEXT} />
              <Text style={styles.infoRowLabel}>{t('settings.rows.latestSync')}</Text>
            </View>
            <Text style={styles.infoRowValue}>{latestSyncLabel}</Text>
          </View>
          <View style={styles.listSep} />
          <View style={styles.infoRow}>
            <Text style={styles.infoRowLabel}>{t('settings.rows.appVersion')}</Text>
            <Text style={styles.infoRowValue}>{appVersionLabel}</Text>
          </View>
        </View>

        {/* ============================================================= */}
        {/* Support & Help section                                         */}
        {/* ============================================================= */}
        <Text style={styles.sectionLabel}>{t('settings.sections.supportHelp')}</Text>
        <View style={styles.listCard}>
          <TouchableOpacity
            style={styles.actionRow}
            activeOpacity={0.6}
            disabled={isExportingDiagnostics}
            onPress={() => {
              void handleExportDiagnostics();
            }}
          >
            <View style={styles.actionRowLeft}>
              <Icon name="download-outline" size={18} color={BLUE} />
              <Text style={styles.actionRowText}>
                {isExportingDiagnostics
                  ? t('settings.actions.exportingDiagnostics')
                  : t('settings.actions.exportDiagnostics')}
              </Text>
            </View>
            <Icon name="chevron-forward" size={16} color={ROW_CHEVRON} />
          </TouchableOpacity>
          <View style={styles.listSep} />
          <TouchableOpacity
            style={styles.actionRow}
            activeOpacity={0.6}
            onPress={() => navigation.navigate('Help')}
          >
            <View style={styles.actionRowLeft}>
              <Icon name="help-circle-outline" size={18} color={BLUE} />
              <Text style={styles.actionRowText}>{t('settings.actions.help')}</Text>
            </View>
            <Icon name="chevron-forward" size={16} color={ROW_CHEVRON} />
          </TouchableOpacity>
        </View>

        {/* ============================================================= */}
        {/* Danger zone                                                    */}
        {/* ============================================================= */}
        <View style={[styles.listCard, styles.dangerCard]}>
          <TouchableOpacity
            style={styles.actionRow}
            activeOpacity={0.6}
            onPress={handleResetSyncStatus}
          >
            <View style={styles.actionRowLeft}>
              <Icon name="refresh-outline" size={18} color={DANGER_RED} />
              <Text style={styles.dangerRowText}>{t('settings.actions.resetSyncStatus')}</Text>
            </View>
            <Icon name="chevron-forward" size={16} color={ROW_CHEVRON} />
          </TouchableOpacity>
        </View>

        {/* ============================================================= */}
        {/* Logout                                                         */}
        {/* ============================================================= */}
        <View style={[styles.listCard, styles.dangerCard, styles.logoutCard]}>
          <TouchableOpacity
            style={styles.actionRow}
            activeOpacity={0.6}
            onPress={handleLogout}
          >
            <View style={styles.actionRowLeft}>
              <Icon name="log-out-outline" size={18} color={DANGER_RED} />
              <Text style={styles.dangerRowText}>{t('settings.actions.logout')}</Text>
            </View>
            <Icon name="chevron-forward" size={16} color={ROW_CHEVRON} />
          </TouchableOpacity>
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: SCREEN_BG,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 12,
    gap: 12,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: DARK,
  },

  // Scroll
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 40,
  },

  // Android notice
  androidNoticeCard: {
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.76)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.88)',
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 12,
  },
  androidNoticeTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#28597e',
    marginBottom: 6,
  },
  androidNoticeBody: {
    fontSize: 12,
    lineHeight: 18,
    color: '#5d7f98',
  },

  // Section label
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: SECTION_TEXT,
    marginBottom: 8,
    marginTop: 8,
    marginLeft: 4,
  },

  // ---------------------------------------------------------------------------
  // Top two-card row (device + subscription)
  // ---------------------------------------------------------------------------
  topCardRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  topCard: {
    flex: 1,
    backgroundColor: CARD_BG,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    padding: 14,
    shadowColor: '#4f8fbc',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 2,
  },
  topCardLeft: {},
  topCardRight: {},
  topCardIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  wifiIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#4abe7b',
    justifyContent: 'center',
    alignItems: 'center',
  },
  subIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  topCardSmallLabel: {
    fontSize: 11,
    color: MUTED_TEXT,
    flexShrink: 1,
  },
  topCardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: DARK,
    marginBottom: 2,
  },
  topCardSubtext: {
    fontSize: 11,
    color: MUTED_TEXT,
    marginBottom: 6,
  },
  topCardBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  subCtaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: 6,
  },
  subCtaText: {
    fontSize: 12,
    fontWeight: '600',
    color: BLUE,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusDotOnline: {
    backgroundColor: ONLINE_GREEN,
  },
  statusDotConnecting: {
    backgroundColor: CONNECTING_AMBER,
  },
  statusDotOffline: {
    backgroundColor: OFFLINE_SLATE,
  },
  statusBadgeText: {
    fontSize: 13,
    fontWeight: '600',
  },
  statusTextOnline: {
    color: ONLINE_TEXT,
  },
  statusTextConnecting: {
    color: CONNECTING_TEXT,
  },
  statusTextOffline: {
    color: OFFLINE_TEXT,
  },
  switchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  switchButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: BLUE,
  },

  // ---------------------------------------------------------------------------
  // Generic card
  // ---------------------------------------------------------------------------
  card: {
    backgroundColor: CARD_BG,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    padding: 18,
    marginBottom: 12,
    shadowColor: '#4f8fbc',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 2,
  },

  // ---------------------------------------------------------------------------
  // My device name card
  // ---------------------------------------------------------------------------
  myDeviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  phoneIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: '#6366f1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  myDeviceInfo: {
    flex: 1,
    minWidth: 0,
  },
  myDeviceLabel: {
    fontSize: 12,
    color: MUTED_TEXT,
    marginBottom: 2,
  },
  myDeviceName: {
    fontSize: 18,
    fontWeight: '700',
    color: DARK,
    flexShrink: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  editButton: {
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  nameInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#b8d8ea',
    borderRadius: 8,
    backgroundColor: '#ffffff',
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 16,
    fontWeight: '600',
    color: DARK,
  },
  confirmButton: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: 'rgba(59,159,216,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  myDeviceHint: {
    fontSize: 12,
    color: MUTED_TEXT,
    marginTop: 10,
    marginLeft: 62,
  },

  // ---------------------------------------------------------------------------
  // List card (info rows, action rows)
  // ---------------------------------------------------------------------------
  listCard: {
    backgroundColor: CARD_BG,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    overflow: 'hidden',
    marginBottom: 12,
    shadowColor: '#4f8fbc',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 2,
  },
  listSep: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#e4eff7',
    marginHorizontal: 18,
  },

  // Info rows
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    gap: 12,
  },
  infoRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  infoRowLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: DARK,
  },
  infoRowValue: {
    fontSize: 13,
    color: MUTED_TEXT,
    flexShrink: 1,
    textAlign: 'right',
  },

  // Action rows (support & help)
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  actionRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  actionRowText: {
    fontSize: 15,
    fontWeight: '500',
    color: DARK,
  },

  // Danger zone
  dangerCard: {
    backgroundColor: DANGER_BG,
    borderColor: 'rgba(239,68,68,0.12)',
    marginTop: 8,
  },
  dangerRowText: {
    fontSize: 15,
    fontWeight: '500',
    color: DANGER_RED,
  },

  // Logout card
  logoutCard: {
    marginTop: 4,
  },

  // Warning box (photo permission)
  warningBox: {
    margin: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(220,38,38,0.12)',
    backgroundColor: 'rgba(254,242,242,0.9)',
    padding: 12,
    gap: 6,
  },
  warningTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#991b1b',
  },
  warningText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#b91c1c',
  },
  warningAction: {
    alignSelf: 'flex-start',
    marginTop: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(185,28,28,0.08)',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  warningActionText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#991b1b',
  },

  bottomSpacer: {
    height: 20,
  },
});
