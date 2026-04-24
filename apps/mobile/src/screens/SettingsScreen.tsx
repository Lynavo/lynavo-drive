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
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useFocusEffect,
  useNavigation,
  CommonActions,
} from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import * as RNLocalize from 'react-native-localize';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { Icon } from '../components/Icon';
import { AUTH_COLORS } from '../components/auth/AuthScreenShell';
import {
  SUBSCRIPTION_STATUS_ICON_COLORS,
  SubscriptionStatusIcon,
  getSubscriptionStatusIconTone,
} from '../components/SubscriptionStatusIcon';
import { useAuth } from '../stores/auth-store';
import {
  logout as serverLogout,
  deleteAccount,
} from '../services/auth-service';
import { getSubscriptionStatus } from '../services/subscription-service';
import { wipeSyncIdentity } from '../services/SyncEngineModule';
import { resetCurrentDesktopSidecarIfReachable } from '../services/sidecar-reset-service';
import { clearUserScopedStorage } from '../utils/clearUserScopedStorage';
import { FEATURES } from '../constants/features';
import { iapService } from '../services/iap-service';
import { classifyIapError } from '../services/iap-errors';
import { markSubscriptionJustActivated } from '../hooks/useExpiryReminder';
import { ApiError, ERROR_CODE } from '../services/api';
import {
  isDiagnosticsExportUnavailable,
  shareDiagnosticsArchive,
} from '../utils/shareDiagnosticsArchive';
import {
  buildSyncConnectionEvidence,
  getConnectionBadgeState,
  type MobileConnectionState,
} from '../utils/effectiveConnectionState';
import { isSyncActivityActivelyTransferring } from '../utils/syncActivityTransferState';
import { resolveSubscriptionDisplayState } from '../utils/subscriptionStatusDisplay';
import {
  loadStoredLanguagePreference,
  resolveLanguagePreference,
  saveLanguagePreference,
  type LanguagePreference,
} from '../i18n/language-preference';

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
const APPLE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions';

function waitForLogoutOverlayFrame(): Promise<void> {
  return new Promise(resolve => {
    requestAnimationFrame(() => resolve());
  });
}

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
type LanguageOption = {
  value: LanguagePreference;
  labelKey:
    | 'settings.language.system'
    | 'settings.language.traditionalChinese'
    | 'settings.language.simplifiedChinese'
    | 'settings.language.english';
};

const LANGUAGE_OPTIONS: readonly LanguageOption[] = [
  { value: 'system', labelKey: 'settings.language.system' },
  { value: 'zh-Hant', labelKey: 'settings.language.traditionalChinese' },
  { value: 'zh-Hans', labelKey: 'settings.language.simplifiedChinese' },
  { value: 'en', labelKey: 'settings.language.english' },
];

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

/**
 * Title shown on the blocking overlay while `handleDeleteAccount` is in
 * flight. Hardcoded per-language because the corresponding i18n key
 * (`settings.deleteAccount.overlayTitle`) is NOT in the strict i18next
 * resource type — settings.json is globally gitignored in some dev
 * environments so we can't rely on it existing locally. Kept inline so
 * the component still renders readable copy in all three supported
 * locales.
 *
 * TODO(i18n): once settings.json stabilises across environments, add
 * `deleteAccount.overlayTitle` to apps/mobile/src/i18n/locales/{en,
 * zh-Hans,zh-Hant}/settings.json and switch this back to `t()`.
 */
function resolveDeleteOverlayTitle(language: string | undefined): string {
  const tag = (language ?? 'zh-Hant').toLowerCase();
  if (tag.startsWith('en')) return 'Deleting account…';
  if (tag.startsWith('zh-hans') || tag.startsWith('zh-cn')) {
    return '删除账号中…';
  }
  return '刪除帳號中…';
}

/**
 * Copy shown when the server blocks account deletion because an Apple
 * subscription is still auto-renewing. Kept with the same per-language
 * fallback pattern as `resolveDeleteOverlayTitle` because `settings.json` is
 * not reliably tracked in this repo yet.
 */
function resolveDeleteSubscriptionBlockCopy(language: string | undefined): {
  title: string;
  body: string;
  manageSubscription: string;
} {
  const tag = (language ?? 'zh-Hant').toLowerCase();
  if (tag.startsWith('en')) {
    return {
      title: 'Cancel subscription first',
      body: 'Your Apple subscription is still set to renew. Open Apple subscription management, cancel it, then return to delete your account.',
      manageSubscription: 'Manage Subscription',
    };
  }
  if (tag.startsWith('zh-hans') || tag.startsWith('zh-cn')) {
    return {
      title: '请先取消订阅',
      body: '你的 Apple 订阅仍在自动续订中。请先前往 Apple 订阅管理取消订阅，再回来删除帐号。',
      manageSubscription: '管理订阅',
    };
  }
  return {
    title: '請先取消訂閱',
    body: '你的 Apple 訂閱仍在自動續訂中。請先前往 Apple 訂閱管理取消訂閱，再回來刪除帳號。',
    manageSubscription: '管理訂閱',
  };
}

function formatDateTimeLabel(iso: string | undefined, t: TFunction): string {
  if (!iso) return t('settings.status.noRecord');
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return t('settings.status.noRecord');

  const now = new Date();
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}`;
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

// ---------------------------------------------------------------------------
// SettingsScreen
// ---------------------------------------------------------------------------

export function SettingsScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { t, i18n } = useTranslation();
  const auth = useAuth();
  const { setSubscription } = auth;
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
  const [latestSyncLabel, setLatestSyncLabel] = useState('');
  const [appVersionLabel, setAppVersionLabel] = useState('');
  const [isPhotoPermissionBlocked, setIsPhotoPermissionBlocked] =
    useState(false);
  const [isExportingDiagnostics, setIsExportingDiagnostics] = useState(false);
  const [languagePreference, setLanguagePreference] =
    useState<LanguagePreference>('system');
  const [isChangingLanguage, setIsChangingLanguage] = useState(false);
  const isResetSyncDisabled = syncOverviewState.uploadState === 'uploading';

  // My iPhone display name
  const [myName, setMyName] = useState('iPhone');
  const [editingMyName, setEditingMyName] = useState(false);

  useEffect(() => {
    let cancelled = false;

    loadStoredLanguagePreference()
      .then(preference => {
        if (!cancelled) {
          setLanguagePreference(preference);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLanguagePreference('system');
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Refetch subscription status every time Settings gains focus. The trial
  // card on this screen reads `auth.subscription` from the store, and the
  // store is otherwise only refreshed at login or when SubscriptionScreen
  // focuses. Without this hook, trial countdown / expiry state can sit
  // stale across screen navigations and server-side changes.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void getSubscriptionStatus()
        .then(info => {
          if (!cancelled) setSubscription(info);
        })
        .catch(err => {
          console.warn('[settings] subscription refresh on focus failed', err);
        });
      return () => {
        cancelled = true;
      };
    }, [setSubscription]),
  );

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
              `${formatDateTimeLabel(
                String(latestItem.updatedAt),
                t,
              )} · ${String(latestItem.deviceName || 'Mac')}`,
            );
          } else {
            setLatestSyncLabel(t('settings.status.noRecord'));
          }
        } else {
          setLatestSyncLabel(t('settings.status.noRecord'));
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
    if (isSyncActivityActivelyTransferring(syncOverviewState)) {
      Alert.alert(
        t('settings.dialogs.switchDeviceWhileUploading.title'),
        t('settings.dialogs.switchDeviceWhileUploading.body'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('settings.dialogs.switchDeviceWhileUploading.confirm'),
            style: 'destructive',
            onPress: () =>
              navigation.navigate('DeviceDiscovery', { mode: 'switch' }),
          },
        ],
      );
    } else {
      navigation.navigate('DeviceDiscovery', { mode: 'switch' });
    }
  }, [navigation, syncOverviewState, t]);

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
    if (isResetSyncDisabled) return;

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
  }, [isResetSyncDisabled, navigation, t]);

  const handleLanguagePreferenceChange = useCallback(
    async (preference: LanguagePreference) => {
      if (preference === languagePreference || isChangingLanguage) return;

      const previousPreference = languagePreference;
      setLanguagePreference(preference);
      setIsChangingLanguage(true);
      try {
        await saveLanguagePreference(preference);
        const nextLanguage = resolveLanguagePreference(
          preference,
          RNLocalize.getLocales(),
        );
        if (i18n.language !== nextLanguage) {
          await i18n.changeLanguage(nextLanguage);
        }
      } catch (error) {
        setLanguagePreference(previousPreference);
        Alert.alert(
          t('settings.dialogs.languageSaveFailed.title'),
          t('settings.dialogs.languageSaveFailed.body'),
        );
      } finally {
        setIsChangingLanguage(false);
      }
    },
    [i18n, isChangingLanguage, languagePreference, t],
  );

  // Guards against double-submission. A single full logout path runs roughly
  // sidecar-timeout + native-wipe + AsyncStorage sweep — sub-second in the
  // happy case, up to ~3s when the desktop is unreachable. We disable the
  // button for that window so impatient double-taps don't fire duplicate
  // wipes into the same native state.
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = useCallback(() => {
    Alert.alert(
      t('settings.dialogs.logout.title'),
      t('settings.dialogs.logout.body'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.dialogs.logout.confirm'),
          style: 'destructive',
          onPress: async () => {
            if (isLoggingOut) return;
            setIsLoggingOut(true);
            await waitForLogoutOverlayFrame();

            // Snapshot the refresh token up-front so the value used for
            // server-side revocation is stable even if auth state is
            // touched mid-flight. The revoke itself is deliberately
            // deferred until AFTER the awaited local cleanup succeeds —
            // see the block comment below for the why.
            const refresh = auth.refreshToken;

            // Order is load-bearing and mirrors the account-identity-reset
            // spec §4 Phase 1 with one deliberate refinement: server-side
            // token revocation (`serverLogout`) happens LAST, not first,
            // so the fail-closed wipe at step 2 genuinely leaves client +
            // server in a consistent state:
            //
            //   1. desktop sidecar reset — best-effort, swallowed.
            //   2. native wipeSyncIdentity — MUST succeed; on reject we
            //      show an alert, keep the user signed in, and do NOT
            //      call serverLogout. The previous ordering (serverLogout
            //      first) would have left the server with a revoked
            //      refresh token while the UI claimed "still signed in" —
            //      an eventually-consistent logout that's hostile to
            //      debug and breaks the fail-closed contract.
            //   3. user-scoped AsyncStorage cleanup — best-effort; its
            //      failure only affects reminder-shown suppression flags,
            //      not security-critical state.
            //   4. fire-and-forget serverLogout — tokens still live in
            //      `_accessToken` / `_refreshToken` module-level vars
            //      until step 5, so `request()` can still build the
            //      Authorization header synchronously before its first
            //      await; a slow/failed network must never block
            //      auth.clearAuth.
            //   5. auth.clearAuth — clears in-memory tokens + keychain
            //      entry, triggering RootNavigator to unmount AuthedStack.
            try {
              await resetCurrentDesktopSidecarIfReachable();
            } catch (e) {
              console.warn(
                '[Settings] desktop sidecar reset threw (ignored):',
                e,
              );
            }
            try {
              await wipeSyncIdentity();
            } catch (e) {
              console.warn(
                '[Settings] wipeSyncIdentity failed — aborting logout to avoid residual identity:',
                e,
              );
              // TODO(i18n): promote these hardcoded zh-Hant strings to
              // `settings.dialogs.logoutFailed.{title,body}` once
              // settings.json is no longer gitignored in any dev env and
              // the keys can be added to the strict i18next resource
              // types without typecheck errors.
              Alert.alert(
                '登出失敗',
                '未能完整清理本機資料，請稍後再試。若持續失敗，請重新啟動應用程式。',
              );
              setIsLoggingOut(false);
              return;
            }
            try {
              await clearUserScopedStorage();
            } catch (e) {
              console.warn(
                '[Settings] clearUserScopedStorage failed (ignored):',
                e,
              );
            }
            // Fire-and-forget server-side revoke. Must run BEFORE
            // clearAuth so the access token used by `request()` to build
            // the Authorization header is still in memory; the request's
            // first await happens after that header is composed, so the
            // network call can safely race clearAuth. The 5s timeout
            // inside `auth-service.logout()` bounds how long this can
            // run in the background. Server revoke failure is non-fatal
            // but worth logging for forensics.
            if (refresh) {
              void serverLogout(refresh).catch(e => {
                console.warn(
                  '[Settings] server logout failed (already cleared locally):',
                  e,
                );
              });
            }
            auth.setSignedOutTransition('logout');
            try {
              auth.clearAuth();
            } catch (e) {
              console.warn('[Settings] local logout error:', e);
            }
            // clearAuth triggers a navigator remount to Login so this
            // component is about to unmount. setState on an unmounted
            // component is a noop warning — safe to skip resetting the
            // flag.
          },
        },
      ],
    );
  }, [auth, isLoggingOut, t]);

  // Restore Purchases (Apple Review requirement — Position B in Settings)
  const [isRestoring, setIsRestoring] = useState(false);

  const handleRestore = useCallback(async () => {
    if (!FEATURES.IAP_ENABLED || !FEATURES.IAP_RESTORE_ENABLED) return;
    setIsRestoring(true);
    try {
      const restored = await iapService.restore();
      if (restored.length === 0) {
        Alert.alert(t('subscription.restore.empty'));
        return;
      }
      await auth.loadSubscription();
      markSubscriptionJustActivated();
      Alert.alert(t('subscription.restore.success'));
    } catch (err) {
      const cls = classifyIapError(err);
      Alert.alert(t((cls.i18nKey ?? 'subscription.restore.failed') as never));
    } finally {
      setIsRestoring(false);
    }
  }, [t, auth]);

  // Belt-and-suspenders two-step confirmation for account deletion.
  // Apple App Store Guideline 5.1.1(v) requires the action to be easy to
  // find AND to double-check, and this is irreversible on the server:
  // the user row is soft-deleted, every identity + refresh token is wiped,
  // token_version bumps so any cached access token dies immediately, and
  // an active non-renewing subscription is marked cancelled. No undo.
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const handleDeleteAccount = useCallback(() => {
    if (isDeletingAccount) return;
    const subscriptionBlockCopy = resolveDeleteSubscriptionBlockCopy(
      i18n.language,
    );
    Alert.alert(
      t('settings.dialogs.deleteAccount.title'),
      t('settings.dialogs.deleteAccount.body'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.dialogs.deleteAccount.continue'),
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              t('settings.dialogs.deleteAccount.confirmAgainTitle'),
              t('settings.dialogs.deleteAccount.confirmAgainBody'),
              [
                { text: t('common.cancel'), style: 'cancel' },
                {
                  text: t('settings.dialogs.deleteAccount.confirmAgainButton'),
                  style: 'destructive',
                  onPress: async () => {
                    setIsDeletingAccount(true);
                    try {
                      await deleteAccount();
                    } catch (e) {
                      // Server-side deletion failed — leave every local
                      // state untouched so the user can retry. Do NOT run
                      // the cleanup sequence below, otherwise a flaky
                      // network would log them out with their account
                      // still alive on the backend.
                      setIsDeletingAccount(false);
                      if (
                        e instanceof ApiError &&
                        e.code === ERROR_CODE.DELETE_BLOCKED_ACTIVE_SUBSCRIPTION
                      ) {
                        Alert.alert(
                          subscriptionBlockCopy.title,
                          subscriptionBlockCopy.body,
                          [
                            { text: t('common.cancel'), style: 'cancel' },
                            {
                              text: subscriptionBlockCopy.manageSubscription,
                              onPress: () => {
                                void Linking.openURL(
                                  APPLE_SUBSCRIPTIONS_URL,
                                ).catch(err => {
                                  console.warn(
                                    '[Settings] open Apple subscriptions failed:',
                                    err,
                                  );
                                });
                              },
                            },
                          ],
                        );
                        return;
                      }
                      const msg =
                        e instanceof ApiError
                          ? e.message
                          : t('errors.accountDeleteFailed');
                      Alert.alert(t('errors.title'), msg);
                      return;
                    }

                    // Signal the short-lived "account deleted" transition
                    // before any of the cleanup awaits, so RootNavigator
                    // has the flag set when it eventually re-renders into
                    // the signed-out tree. Do NOT call serverLogout()
                    // after this — tokens are already revoked by the
                    // delete transaction and calling it would just 401.
                    auth.setSignedOutTransition('account_deleted');

                    // Mirror handleLogout's cleanup order (see
                    // account-identity-reset spec Phase 1). Same
                    // best-effort semantics on each step.
                    try {
                      await resetCurrentDesktopSidecarIfReachable();
                    } catch (e) {
                      console.warn(
                        '[Settings] desktop sidecar reset threw (ignored):',
                        e,
                      );
                    }
                    try {
                      await wipeSyncIdentity();
                    } catch (e) {
                      // Fail OPEN here — unlike handleLogout. The account
                      // is already gone server-side (deleteAccount just
                      // resolved), so refusing to clearAuth would strand
                      // the user in a logged-in shell whose tokens are
                      // already revoked. The reinstall sentinel +
                      // next-login owner-guard are the backstops for
                      // any residual native state.
                      console.warn(
                        '[Settings] wipeSyncIdentity failed after deleteAccount — sentinel will self-heal on next launch',
                        e,
                      );
                    }
                    try {
                      await clearUserScopedStorage();
                    } catch (e) {
                      console.warn(
                        '[Settings] clearUserScopedStorage failed (ignored):',
                        e,
                      );
                    }
                    auth.clearAuth();
                  },
                },
              ],
            );
          },
        },
      ],
    );
  }, [auth, navigation, t, isDeletingAccount]);

  // Subscription derived state
  const subscriptionDisplay = resolveSubscriptionDisplayState({
    subscription: auth.subscription,
    user: auth.user,
  });
  const trialDays = subscriptionDisplay.daysRemaining;
  const isAccountTrial = subscriptionDisplay.kind === 'account_trial';
  const isSubscriptionIntroTrial =
    subscriptionDisplay.kind === 'subscription_intro_trial';
  const isSubscribed = subscriptionDisplay.kind === 'subscribed';
  const isSubscribedCancelled =
    subscriptionDisplay.kind === 'subscribed_cancelled';
  const isTrialExpired = subscriptionDisplay.kind === 'trial_expired';
  const isSubExpired = subscriptionDisplay.kind === 'sub_expired';
  const hasKnownSubscriptionState = subscriptionDisplay.kind !== 'unknown';
  const showSubCta = isAccountTrial || isTrialExpired || isSubExpired;
  const subscriptionIconTone = getSubscriptionStatusIconTone(
    subscriptionDisplay.kind,
  );
  const subscriptionStatusColor = subscriptionIconTone
    ? SUBSCRIPTION_STATUS_ICON_COLORS[subscriptionIconTone]
    : DARK;

  // Phone reveal toggle — when the primary identity is a CN phone number
  // the server also returns the raw identifier so the user can choose to
  // temporarily reveal the full digits. Defaults to masked on every mount
  // (no persistence) so the full number is never displayed unattended.
  const [isPhoneRevealed, setIsPhoneRevealed] = useState(false);
  const primaryIdentity = auth.user?.primaryIdentity;
  const rawPhoneIdentifier =
    primaryIdentity?.type === 'phone_cn'
      ? primaryIdentity.identifier
      : undefined;
  const canTogglePhoneReveal = Boolean(rawPhoneIdentifier);
  const accountDisplayValue =
    isPhoneRevealed && rawPhoneIdentifier
      ? rawPhoneIdentifier
      : (primaryIdentity?.display ?? '');

  // Pretty-format the Apple expireAt for the "Cancelled — valid until X"
  // secondary line. Keep it lenient: bad ISO falls through to empty so
  // the primary status line still shows.
  const cancelledUntilDate = (() => {
    if (!isSubscribedCancelled || !auth.subscription?.expireAt) return '';
    const d = new Date(auth.subscription.expireAt);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  })();

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
              <Text style={styles.topCardSmallLabel}>
                {t('settings.sections.connectedDevice')}
              </Text>
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
                <Text style={styles.switchButtonText}>
                  {t('settings.actions.switch')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Right: Subscription status card */}
          <TouchableOpacity
            style={[styles.topCard, styles.topCardRight]}
            activeOpacity={0.82}
            onPress={() => navigation.navigate('Subscription')}
            accessibilityRole="button"
          >
            <View style={styles.topCardIconRow}>
              {subscriptionIconTone ? (
                <SubscriptionStatusIcon
                  tone={subscriptionIconTone}
                  size={20}
                  framed
                  frameSize={32}
                />
              ) : (
                <View style={styles.subIconCircle}>
                  <Icon name="time-outline" size={18} color={MUTED_TEXT} />
                </View>
              )}
              <Text style={styles.topCardSmallLabel}>
                {isSubscribed ||
                isSubscribedCancelled ||
                isSubExpired ||
                isSubscriptionIntroTrial
                  ? t('settings.subscription.subscribed')
                  : isAccountTrial || isTrialExpired
                    ? t('settings.subscription.trial')
                    : t('subscription.title')}
              </Text>
            </View>
            {isAccountTrial || isSubscriptionIntroTrial ? (
              <>
                <Text style={styles.topCardTitle}>
                  {t('settings.subscription.trialDays', { days: trialDays })}
                </Text>
                <Text style={styles.topCardSubtext}>
                  {isSubscriptionIntroTrial
                    ? t('settings.subscription.introTrial')
                    : t('settings.subscription.freeTrial')}
                </Text>
              </>
            ) : isTrialExpired ? (
              <Text style={[styles.topCardTitle, { color: DANGER_RED }]}>
                {t('settings.subscription.expired')}
              </Text>
            ) : isSubscribedCancelled ? (
              // Cancelled-but-active: deliberately two-line so the amber
              // tint carries the urgency while expiry date gives certainty.
              <>
                <Text style={[styles.topCardTitle, { color: DANGER_RED }]}>
                  {t('subscription.status.subscribedCancelled', {
                    date: cancelledUntilDate,
                  })}
                </Text>
              </>
            ) : isSubscribed ? (
              <Text
                style={[
                  styles.topCardTitle,
                  { color: subscriptionStatusColor },
                ]}
              >
                {t('settings.subscription.active')}
              </Text>
            ) : isSubExpired ? (
              <Text style={[styles.topCardTitle, { color: DANGER_RED }]}>
                {t('settings.subscription.expired')}
              </Text>
            ) : (
              <Text style={styles.topCardTitle}>
                {hasKnownSubscriptionState
                  ? '--'
                  : t('settings.status.reading')}
              </Text>
            )}
            {showSubCta ? (
              <View style={styles.subCtaRow}>
                <Text style={styles.subCtaText}>
                  {t('settings.subscription.subscribeCta')}
                </Text>
                <Icon name="chevron-forward" size={13} color={BLUE} />
              </View>
            ) : null}
          </TouchableOpacity>
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
              <Text style={styles.myDeviceLabel}>
                {t('settings.myDevice.label')}
              </Text>
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
                <Text style={styles.warningTitle}>
                  {t('settings.photoPermission.title')}
                </Text>
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
                  <Text style={styles.warningActionText}>
                    {t('settings.photoPermission.openSettings')}
                  </Text>
                </TouchableOpacity>
              </View>
              <View style={styles.listSep} />
            </>
          ) : null}
          <View style={styles.infoRow}>
            <View style={styles.infoRowLeft}>
              <Icon name="person-outline" size={16} color={MUTED_TEXT} />
              <Text style={styles.infoRowLabel}>
                {t('settings.rows.currentAccount')}
              </Text>
            </View>
            <View style={styles.accountValueRow}>
              <Text style={styles.infoRowValue} numberOfLines={1}>
                {accountDisplayValue}
              </Text>
              {canTogglePhoneReveal ? (
                <TouchableOpacity
                  style={styles.phoneEyeButton}
                  activeOpacity={0.7}
                  onPress={() => setIsPhoneRevealed(v => !v)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    isPhoneRevealed
                      ? t('settings.phone.hide')
                      : t('settings.phone.reveal')
                  }
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Icon
                    name={isPhoneRevealed ? 'eye-outline' : 'eye-off-outline'}
                    size={16}
                    color={MUTED_TEXT}
                  />
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
          <View style={styles.listSep} />
          <View style={styles.infoRow}>
            <View style={styles.infoRowLeft}>
              <Icon name="time-outline" size={16} color={MUTED_TEXT} />
              <Text style={styles.infoRowLabel}>
                {t('settings.rows.latestSync')}
              </Text>
            </View>
            <Text style={styles.infoRowValue}>{latestSyncLabel}</Text>
          </View>
          <View style={styles.listSep} />
          <View style={styles.infoRow}>
            <View style={styles.infoRowLeft}>
              <Icon
                name="information-circle-outline"
                size={16}
                color={MUTED_TEXT}
              />
              <Text style={styles.infoRowLabel}>
                {t('settings.rows.appVersion')}
              </Text>
            </View>
            <Text style={styles.infoRowValue}>{appVersionLabel}</Text>
          </View>
          <View style={styles.listSep} />
          <View style={styles.languageRow}>
            <View style={styles.languageHeaderRow}>
              <Icon name="language-outline" size={16} color={MUTED_TEXT} />
              <Text style={styles.infoRowLabel}>
                {t('settings.rows.language')}
              </Text>
            </View>
            <View style={styles.languageOptions}>
              {LANGUAGE_OPTIONS.map(option => {
                const isSelected = languagePreference === option.value;
                return (
                  <TouchableOpacity
                    key={option.value}
                    style={[
                      styles.languageOption,
                      isSelected ? styles.languageOptionSelected : null,
                    ]}
                    activeOpacity={0.75}
                    disabled={isChangingLanguage}
                    onPress={() => {
                      void handleLanguagePreferenceChange(option.value);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{
                      selected: isSelected,
                      disabled: isChangingLanguage,
                    }}
                  >
                    <Text
                      style={[
                        styles.languageOptionText,
                        isSelected ? styles.languageOptionTextSelected : null,
                      ]}
                      numberOfLines={1}
                    >
                      {t(option.labelKey)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>

        {/* ============================================================= */}
        {/* Support & Help section                                         */}
        {/* ============================================================= */}
        <Text style={styles.sectionLabel}>
          {t('settings.sections.supportHelp')}
        </Text>
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
              <Text style={styles.actionRowText}>
                {t('settings.actions.help')}
              </Text>
            </View>
            <Icon name="chevron-forward" size={16} color={ROW_CHEVRON} />
          </TouchableOpacity>
          {FEATURES.IAP_ENABLED && FEATURES.IAP_RESTORE_ENABLED ? (
            <>
              <View style={styles.listSep} />
              <TouchableOpacity
                style={styles.actionRow}
                activeOpacity={0.6}
                onPress={() => {
                  void handleRestore();
                }}
                disabled={isRestoring}
              >
                <View style={styles.actionRowLeft}>
                  <Icon name="refresh-outline" size={18} color={BLUE} />
                  <Text style={styles.actionRowText}>
                    {isRestoring
                      ? t('subscription.restore.inProgress')
                      : t('subscription.restore.action')}
                  </Text>
                </View>
                <Icon name="chevron-forward" size={16} color={ROW_CHEVRON} />
              </TouchableOpacity>
            </>
          ) : null}
        </View>

        {/* ============================================================= */}
        {/* Danger zone                                                    */}
        {/* ============================================================= */}
        <View style={[styles.listCard, styles.dangerCard]}>
          <TouchableOpacity
            style={[
              styles.actionRow,
              isResetSyncDisabled && styles.actionRowDisabled,
            ]}
            activeOpacity={0.6}
            onPress={handleResetSyncStatus}
            disabled={isResetSyncDisabled}
            accessibilityState={{ disabled: isResetSyncDisabled }}
          >
            <View style={styles.actionRowLeft}>
              <Icon
                name="refresh-outline"
                size={18}
                color={isResetSyncDisabled ? MUTED_TEXT : DANGER_RED}
              />
              <Text
                style={[
                  styles.dangerRowText,
                  isResetSyncDisabled && styles.dangerRowTextDisabled,
                ]}
              >
                {t('settings.actions.resetSyncStatus')}
              </Text>
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
              <Text style={styles.dangerRowText}>
                {t('settings.actions.logout')}
              </Text>
            </View>
            <Icon name="chevron-forward" size={16} color={ROW_CHEVRON} />
          </TouchableOpacity>
        </View>

        {/* ============================================================= */}
        {/* Delete Account                                                 */}
        {/* Required by App Store Guideline 5.1.1(v). Destructive; server  */}
        {/* wipes identities/tokens + cancels active subscription.         */}
        {/* ============================================================= */}
        <View style={[styles.listCard, styles.dangerCard, styles.logoutCard]}>
          <TouchableOpacity
            style={styles.actionRow}
            activeOpacity={0.6}
            onPress={handleDeleteAccount}
            disabled={isDeletingAccount}
          >
            <View style={styles.actionRowLeft}>
              <Icon name="trash-outline" size={18} color={DANGER_RED} />
              <Text style={styles.dangerRowText}>
                {isDeletingAccount
                  ? t('settings.actions.deletingAccount')
                  : t('settings.actions.deleteAccount')}
              </Text>
            </View>
            <Icon name="chevron-forward" size={16} color={ROW_CHEVRON} />
          </TouchableOpacity>
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>

      {isLoggingOut ? (
        <View
          style={styles.logoutTransitionOverlay}
          pointerEvents="auto"
          accessibilityRole="progressbar"
          accessibilityLiveRegion="polite"
        >
          <ActivityIndicator size="large" color={AUTH_COLORS.primary} />
        </View>
      ) : null}

      {/*
       * Full-screen blocking overlay while `handleDeleteAccount` runs its
       * Phase-1 cleanup (server deleteAccount → setSignedOutTransition →
       * sidecar reset → wipeSyncIdentity → clearUserScopedStorage →
       * clearAuth). Between `setSignedOutTransition` and `clearAuth` the
       * store still reports `isLoggedIn === true`, so the logged-in
       * Settings tree underneath is live and every row would hit the
       * backend with tokens that the delete transaction has already
       * revoked. The overlay is rendered AFTER ScrollView so it layers
       * on top, and uses `pointerEvents="auto"` on a StyleSheet.absoluteFill
       * View to swallow every touch underneath.
       *
       * Do NOT try to fix this by firing-and-forgetting the cleanup and
       * calling `clearAuth` immediately — per account-identity-reset spec
       * §4 Phase 1 the await chain is deliberate so the next login flow
       * doesn't race into residual native / storage state.
       */}
      {isDeletingAccount ? (
        <View
          style={styles.deletingOverlay}
          // `auto` (the default) is explicit here to signal intent: we
          // want this View to catch every touch so the UI underneath is
          // untappable.
          pointerEvents="auto"
          accessibilityRole="progressbar"
          accessibilityLiveRegion="polite"
        >
          <View style={styles.deletingOverlayCard}>
            <ActivityIndicator size="large" color={BLUE} />
            <Text style={styles.deletingOverlayText}>
              {resolveDeleteOverlayTitle(i18n.language)}
            </Text>
          </View>
        </View>
      ) : null}
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
    backgroundColor: 'rgba(120, 147, 171, 0.1)',
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
  accountValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  phoneEyeButton: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  languageRow: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    gap: 10,
  },
  languageHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  languageOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  languageOption: {
    minHeight: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#d4e5f1',
    backgroundColor: '#f7fbfe',
    paddingHorizontal: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  languageOptionSelected: {
    borderColor: BLUE,
    backgroundColor: 'rgba(59,159,216,0.12)',
  },
  languageOptionText: {
    fontSize: 13,
    fontWeight: '600',
    color: MUTED_TEXT,
  },
  languageOptionTextSelected: {
    color: BLUE,
  },

  // Action rows (support & help)
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  actionRowDisabled: {
    opacity: 0.45,
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
  dangerRowTextDisabled: {
    color: MUTED_TEXT,
  },

  // Logout card
  logoutCard: {
    marginTop: 4,
  },
  logoutTransitionOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: AUTH_COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
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

  // ---------------------------------------------------------------------------
  // Deleting-account overlay (see handleDeleteAccount and the JSX block
  // rendered outside ScrollView). Semi-transparent SCREEN_BG-tinted
  // backdrop + centered white card so the message reads cleanly on both
  // light and dark photos behind the Settings tree.
  // ---------------------------------------------------------------------------
  deletingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(214, 236, 248, 0.88)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  deletingOverlayCard: {
    backgroundColor: CARD_BG,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    paddingHorizontal: 28,
    paddingVertical: 24,
    alignItems: 'center',
    gap: 14,
    minWidth: 200,
    shadowColor: '#4f8fbc',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 6,
  },
  deletingOverlayText: {
    fontSize: 15,
    fontWeight: '600',
    color: DARK,
    textAlign: 'center',
  },
});
