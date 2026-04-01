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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { colors } from '../theme/colors';
import { Icon } from '../components/Icon';
import { isDiagnosticsExportUnavailable, shareDiagnosticsArchive } from '../utils/shareDiagnosticsArchive';
import {
  getEffectiveConnectionState,
  type MobileConnectionState,
} from '../utils/effectiveConnectionState';

// ---------------------------------------------------------------------------
// SettingsScreen
// ---------------------------------------------------------------------------

type NavigationProp = StackNavigationProp<RootStackParamList, 'Settings'>;

function formatAppVersionLabel(appInfo?: Record<string, unknown>): string {
  const version = typeof appInfo?.version === 'string' ? appInfo.version : '';
  if (!version) return '未知版本';

  const appName = typeof appInfo?.appName === 'string' && appInfo.appName
    ? appInfo.appName
    : '小豹闪传';
  const build = typeof appInfo?.build === 'string' && appInfo.build
    ? appInfo.build
    : '0';
  return `${appName} v${version} (${build})`;
}

function formatDateTimeLabel(iso?: string): string {
  if (!iso) return '暂无记录';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '暂无记录';

  const now = new Date();
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  if (date.toDateString() === now.toDateString()) {
    return `今天 ${time}`;
  }
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
  }
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${time}`;
}

export function SettingsScreen() {
  const navigation = useNavigation<NavigationProp>();
  const [deviceName, setDeviceName] = useState('');
  const [deviceIp, setDeviceIp] = useState('');
  const [connectionState, setConnectionState] = useState<MobileConnectionState>('offline');
  const [syncOverviewState, setSyncOverviewState] = useState({
    progressPercent: 0,
    transferredBytes: 0,
    uploadState: 'idle',
  });
  const [latestSyncLabel, setLatestSyncLabel] = useState('暂无记录');
  const [appVersionLabel, setAppVersionLabel] = useState('读取中…');
  const [isPhotoPermissionBlocked, setIsPhotoPermissionBlocked] = useState(false);
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

    const applyBindingState = (state: Record<string, unknown> | null | undefined) => {
      if (!state || !state.deviceId) {
        setDeviceName('');
        setDeviceIp('');
        setConnectionState('offline');
        return;
      }

      setDeviceName((state.deviceAlias as string) || (state.deviceName as string) || '');
      setDeviceIp((state.host as string) || '');
      setConnectionState(((state.connectionState as typeof connectionState) || 'bound'));
    };

    const loadState = async () => {
      try {
        const { NativeSyncEngine } = NativeModules;
        if (!NativeSyncEngine) return;

        const emitter = new NativeEventEmitter(NativeSyncEngine);
        bindingSub = emitter.addListener('onBindingStateChanged', applyBindingState);
        syncSub = emitter.addListener('onSyncStateChanged', (state: Record<string, unknown>) => {
          const uploadState = (state.uploadState as string) || 'idle';
          setSyncOverviewState((prev) => ({
            progressPercent: typeof state.progressPercent === 'number'
              ? state.progressPercent
              : prev.progressPercent,
            transferredBytes: typeof state.transferredBytes === 'number'
              ? state.transferredBytes
              : prev.transferredBytes,
            uploadState,
          }));
          setIsPhotoPermissionBlocked(uploadState === 'paused_no_permission');
        });

        // Safely call all methods with optional chaining to prevent synchronous TypeErrors
        // if any method isn't fully exported to the React Native bridge yet.
        const [stateResult, clientNameResult, appInfoResult, historyResult, syncOverviewResult] = await Promise.allSettled([
          NativeSyncEngine.getBindingState?.() ?? Promise.resolve(null),
          NativeSyncEngine.getClientDisplayName?.() ?? Promise.resolve('iPhone'),
          NativeSyncEngine.getAppInfo?.() ?? Promise.resolve(undefined),
          NativeSyncEngine.getHistoryDays?.(null) ?? Promise.resolve(undefined),
          NativeSyncEngine.getSyncOverview?.() ?? Promise.resolve(undefined),
        ]);

        if (stateResult.status === 'fulfilled' && stateResult.value) {
          applyBindingState(stateResult.value as Record<string, unknown> | null | undefined);
        }

        if (clientNameResult.status === 'fulfilled' && clientNameResult.value) {
          setMyName(clientNameResult.value as string);
        }

        if (appInfoResult.status === 'fulfilled' && appInfoResult.value) {
          setAppVersionLabel(formatAppVersionLabel(appInfoResult.value as Record<string, unknown> | undefined));
        } else {
          setAppVersionLabel('未知版本');
        }

        const history = historyResult.status === 'fulfilled'
          ? (historyResult.value as { items?: Array<Record<string, unknown>> } | undefined)
          : undefined;
        const items = history?.items as Array<Record<string, unknown>> | undefined;
        if (items?.length) {
          let latestItem: Record<string, unknown> | null = null;
          for (const item of items) {
            if (!latestItem) {
              latestItem = item;
              continue;
            }
            const currentTs = new Date(String(item.updatedAt ?? 0)).getTime();
            const latestTs = new Date(String(latestItem.updatedAt ?? 0)).getTime();
            if (currentTs > latestTs) {
              latestItem = item;
            }
          }
          if (latestItem?.updatedAt) {
            setLatestSyncLabel(
              `${formatDateTimeLabel(String(latestItem.updatedAt))} · ${String(latestItem.deviceName || 'Mac')}`,
            );
          }
        }
        const syncOverview = syncOverviewResult.status === 'fulfilled'
          ? (syncOverviewResult.value as {
              progressPercent?: number;
              transferredBytes?: number;
              uploadState?: string;
            } | undefined)
          : undefined;
        setSyncOverviewState({
          progressPercent: syncOverview?.progressPercent ?? 0,
          transferredBytes: syncOverview?.transferredBytes ?? 0,
          uploadState: syncOverview?.uploadState ?? 'idle',
        });
        setIsPhotoPermissionBlocked(syncOverview?.uploadState === 'paused_no_permission');
      } catch (e) {
        setAppVersionLabel('未知版本');
        console.warn('Native module not available for Settings');
      }
    };

    loadState();

    return () => {
      bindingSub?.remove();
      syncSub?.remove();
    };
  }, []);

  const effectiveConnectionState = getEffectiveConnectionState(connectionState, syncOverviewState);
  const connectionLabel = (
    effectiveConnectionState === 'connected' ? '已连接'
      : effectiveConnectionState === 'connecting' || effectiveConnectionState === 'discovering' ? '连接中'
        : '未连接'
  );
  const isConnected = effectiveConnectionState === 'connected';
  const isConnecting = effectiveConnectionState === 'connecting' || effectiveConnectionState === 'discovering';

  // ---------------------------------------------------------------------------
  // Save my iPhone display name
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

  // ---------------------------------------------------------------------------
  // Disconnect and unbind
  // ---------------------------------------------------------------------------

  const handleDisconnect = useCallback(() => {
    Alert.alert(
      '断开连接',
      '确定要断开与电脑的连接吗？断开后需要重新输入连接码配对',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确定',
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
  }, [navigation]);

  const handleExportDiagnostics = useCallback(async () => {
    try {
      setIsExportingDiagnostics(true);
      await shareDiagnosticsArchive();
    } catch (error) {
      if (isDiagnosticsExportUnavailable(error)) {
        Alert.alert('无法导出', '当前版本暂不支持导出诊断包');
      } else {
        Alert.alert('导出失败', '诊断包导出失败，请稍后重試');
      }
    } finally {
      setIsExportingDiagnostics(false);
    }
  }, []);

  const handleResetSyncStatus = useCallback(() => {
    Alert.alert(
      '重置所有同步状态',
      '确定要清除所有本地同步记录吗？此操作不会删除手机或电脑上的照片，但会让手机重新扫描並重新上传所有素材。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确定重置',
          style: 'destructive',
          onPress: async () => {
            try {
              const { NativeSyncEngine } = NativeModules;
              if (NativeSyncEngine) {
                await NativeSyncEngine.resetAllStatus();
                Alert.alert('已重置', '本地同步记录已清除，正在重新扫描素材。');
              }
            } catch (e) {
              Alert.alert('重置失败', '请稍后重試');
            }
          },

        },
      ],
    );
  }, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
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
                navigation.reset({ index: 0, routes: [{ name: 'SyncStatus' }] });
              }
            }}
            accessibilityLabel={'返回'}
          >
            <Icon name="chevron-back" size={20} color={colors.screenTitle} />
          </TouchableOpacity>
          <Text style={styles.title}>{'设置'}</Text>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* My iPhone display name card */}
          <View style={styles.deviceCard}>
            <Text style={styles.sectionLabel}>{'我的设备名称'}</Text>
            <View style={styles.deviceRow}>
              {/* Phone icon */}
              <View style={[styles.monitorIconWrapper, styles.phoneIconWrapper]}>
                <Icon name="phone-portrait-outline" size={20} color="#fff" />
              </View>

              {/* Name display / edit */}
              <View style={styles.deviceInfo}>
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
                      <Icon name="checkmark" size={16} color="#3b9fd8" />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.nameRow}>
                    <Text style={styles.deviceNameText} numberOfLines={1}>
                      {myName}
                    </Text>
                    <TouchableOpacity
                      style={styles.editButton}
                      activeOpacity={0.7}
                      onPress={() => setEditingMyName(true)}
                    >
                      <Icon name="pencil-outline" size={14} color="#3b9fd8" />
                    </TouchableOpacity>
                  </View>
                )}
                <Text style={styles.myNameHint}>
                  {'此名称将在 Mac 端显示'}
                </Text>
              </View>
            </View>
          </View>

          {/* Connected device card */}
          <View style={styles.deviceCard}>
            <Text style={styles.sectionLabel}>{'同步状态'}</Text>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>{'最近一次成功同步'}</Text>
              <Text style={styles.metaValue}>{latestSyncLabel}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>{'应用版本'}</Text>
              <Text style={styles.metaValue}>{appVersionLabel}</Text>
            </View>
            {isPhotoPermissionBlocked ? (
              <View style={styles.warningBox}>
                <Text style={styles.warningTitle}>{'照片权限未开启'}</Text>
                <Text style={styles.warningText}>
                  {'需要允许访问照片后才能继续自动同步。'}
                </Text>
                <TouchableOpacity
                  style={styles.warningAction}
                  activeOpacity={0.8}
                  onPress={() => {
                    void Linking.openSettings();
                  }}
                >
                  <Text style={styles.warningActionText}>{'打开系统设置'}</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>

          <View style={styles.deviceCard}>
            <Text style={styles.sectionLabel}>{'支持与诊断'}</Text>
            <Text style={styles.diagnosticsHint}>
              {'导出当前设备状态、队列快照、本地数据库和最近日志，便于排查同步问题。'}
            </Text>
            
            <View style={styles.actionButtonGroup}>
              <TouchableOpacity
                style={[
                  styles.diagnosticsButton,
                  isExportingDiagnostics && styles.diagnosticsButtonDisabled,
                ]}
                activeOpacity={0.8}
                disabled={isExportingDiagnostics}
                onPress={() => {
                  void handleExportDiagnostics();
                }}
              >
                <Icon name="download-outline" size={16} color="#3b9fd8" />
                <Text style={styles.diagnosticsButtonText}>
                  {isExportingDiagnostics ? '正在导出诊断包…' : '导出诊断包'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.resetButton}
                activeOpacity={0.8}
                onPress={handleResetSyncStatus}
              >
                <Icon name="refresh-outline" size={16} color="#ef4444" />
                <Text style={styles.resetButtonText}>{'重置同步状态'}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.deviceCard}>
            {/* Device info row */}
            <View style={styles.deviceRow}>
              {/* Monitor icon */}
              <View style={styles.monitorIconWrapper}>
                <Icon name="desktop-outline" size={20} color="#fff" />
              </View>

              {/* Name + IP + status */}
              <View style={styles.deviceInfo}>
                <Text style={styles.deviceNameText} numberOfLines={1}>
                  {deviceName}
                </Text>

                <Text style={styles.deviceIp}>{deviceIp}</Text>

                {/* Connection status */}
                <View style={styles.statusRow}>
                  <View
                    style={[
                      styles.statusDot,
                      !isConnected && styles.statusDotDisconnected,
                      isConnecting && styles.statusDotConnecting,
                    ]}
                  />
                  <Text
                    style={[
                      styles.statusText,
                      !isConnected && styles.statusTextDisconnected,
                      isConnecting && styles.statusTextConnecting,
                    ]}
                  >
                    {connectionLabel}
                  </Text>
                </View>
              </View>
            </View>

            {/* Disconnect button */}
            <TouchableOpacity
              style={styles.disconnectButton}
              activeOpacity={0.7}
              onPress={handleDisconnect}
            >
              <Text style={styles.disconnectText}>{'切换设备'}</Text>
            </TouchableOpacity>
          </View>

          {/* Hint text */}
          <Text style={styles.hintText}>
            {'电脑端名称在电脑端设置中修改'}
          </Text>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.screenBackground,
  },
  container: {
    flex: 1,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 12,
    gap: 12,
    zIndex: 10,
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
    color: colors.screenTitle,
  },

  // Scroll
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 40,
  },

  // Device card
  deviceCard: {
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderRadius: 16,
    padding: 16,
    shadowColor: 'rgba(80,150,200,0.3)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 2,
    marginBottom: 16,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 16,
  },
  monitorIconWrapper: {
    width: 48,
    height: 48,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#3ba4dc',
    shadowColor: 'rgba(59,159,216,0.5)',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 3,
  },
  deviceInfo: {
    flex: 1,
    minWidth: 0,
  },

  // Name display
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  deviceNameText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.screenTitle,
    flexShrink: 1,
  },
  editButton: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Name editing
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
    fontSize: 14,
    fontWeight: '600',
    color: colors.screenTitle,
  },
  confirmButton: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: 'rgba(59,159,216,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // IP + status
  deviceIp: {
    fontSize: 12,
    color: '#90b0c8',
    marginTop: 2,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22c55e',
  },
  statusDotDisconnected: {
    backgroundColor: '#ef4444',
  },
  statusDotConnecting: {
    backgroundColor: '#f59e0b',
  },
  statusText: {
    fontSize: 12,
    color: '#22c55e',
  },
  statusTextDisconnected: {
    color: '#dc2626',
  },
  statusTextConnecting: {
    color: '#b45309',
  },

  // Disconnect button
  disconnectButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(59,159,216,0.18)',
    backgroundColor: 'rgba(59,159,216,0.08)',
    borderRadius: 14,
    paddingVertical: 12,
  },
  disconnectText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#3b9fd8',
  },

  // Section label
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#90b0c8',
    marginBottom: 12,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 10,
  },
  metaLabel: {
    fontSize: 13,
    color: '#90b0c8',
  },
  metaValue: {
    flex: 1,
    textAlign: 'right',
    fontSize: 13,
    fontWeight: '600',
    color: colors.screenTitle,
  },
  warningBox: {
    marginTop: 6,
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
  diagnosticsHint: {
    fontSize: 12,
    lineHeight: 18,
    color: '#6e8aa3',
    marginBottom: 12,
  },
  // Support & Diagnostics
  actionButtonGroup: {
    flexDirection: 'column',
    gap: 12,
  },
  diagnosticsButton: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(59,159,216,0.18)',
    backgroundColor: 'rgba(59,159,216,0.08)',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    justifyContent: 'center',
  },
  diagnosticsButtonDisabled: {
    opacity: 0.6,
  },
  diagnosticsButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#3b9fd8',
  },
  resetButton: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.12)',
    backgroundColor: 'rgba(239,68,68,0.06)',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    justifyContent: 'center',
  },
  resetButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#ef4444',
  },

  // Phone icon
  phoneIconWrapper: {
    backgroundColor: '#6366f1',
    shadowColor: 'rgba(99,102,241,0.5)',
  },

  // My name hint
  myNameHint: {
    fontSize: 11,
    color: '#90b0c8',
    marginTop: 4,
  },

  // Hint
  hintText: {
    fontSize: 12,
    color: '#90b0c8',
    paddingHorizontal: 4,
  },
});
