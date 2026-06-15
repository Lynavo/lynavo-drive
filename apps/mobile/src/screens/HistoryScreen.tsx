import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  TouchableOpacity,
  Animated,
  Easing,
  NativeModules,
  NativeEventEmitter,
  type SectionListData,
  type SectionListRenderItemInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { colors } from '../theme/colors';
import { formatBytes, formatDuration } from '../utils/format';
import { formatLocalDateKey, formatLocalYesterdayDateKey } from '../utils/localDateKey';
import { Icon } from '../components/Icon';
import { listHistory } from '../services/desktop-local-service';
import type { DesktopSyncRecordDTO } from '@syncflow/contracts';


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SessionCard {
  id: string;
  deviceName: string;
  deviceIp: string;
  fileCount: number;
  totalSize: string;
  duration: string;
}

interface HistorySection {
  title: string;
  isToday: boolean;
  data: SessionCard[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isToday(dateStr: string): boolean {
  const today = formatLocalDateKey(new Date());
  return dateStr === today;
}

function isYesterday(dateStr: string): boolean {
  return dateStr === formatLocalYesterdayDateKey(new Date());
}

function formatDateLabel(dateStr: string, t: TFunction): string {
  if (isToday(dateStr)) return t('history.dates.today');
  if (isYesterday(dateStr)) return t('history.dates.yesterday');
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return t('history.dates.monthDay', {
      month: parseInt(parts[1], 10),
      day: parseInt(parts[2], 10),
    });
  }
  return dateStr;
}

// ---------------------------------------------------------------------------
// Pulsing blue dot component
// ---------------------------------------------------------------------------

function PulsingDot() {
  const pulseAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1200,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 1200,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulseAnim]);

  return (
    <View style={styles.dotContainer}>
      <Animated.View
        style={[
          styles.dotPulse,
          {
            opacity: pulseAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [0.6, 0],
            }),
            transform: [
              {
                scale: pulseAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, 2.2],
                }),
              },
            ],
          },
        ]}
      />
      <View style={styles.dotSolid} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Device summary card
// ---------------------------------------------------------------------------

interface DeviceCardProps {
  deviceName: string;
  deviceIp: string;
  fileCount: number;
  totalSize: string;
  duration: string;
  t: TFunction;
}

function DeviceCard({ deviceName, deviceIp, fileCount, totalSize, duration, t }: DeviceCardProps) {
  return (
    <View style={styles.card}>
      {/* Row 1: device icon + name + IP */}
      <View style={styles.cardHeader}>
        <View style={styles.monitorIconWrapper}>
          <Icon name="desktop-outline" size={20} color="#fff" />
        </View>
        <View style={styles.cardDeviceInfo}>
          <Text style={styles.cardDeviceName} numberOfLines={1}>
            {deviceName}
          </Text>
          <Text style={styles.cardDeviceIp}>{deviceIp}</Text>
        </View>
      </View>

      {/* Divider */}
      <View style={styles.cardDivider} />

      {/* Row 2: stats */}
      <View style={styles.cardStats}>
        <View style={styles.cardStatsLeft}>
          <Text style={styles.statsLabel}>{t('history.cards.statsLabel')}</Text>
          <View style={styles.statsValue}>
            <Text style={styles.statsCount}>{fileCount}</Text>
            <Text style={styles.statsSep}> {t('history.cards.statsUnit')} {'·'} </Text>
            <Text style={styles.statsSize}>{totalSize}</Text>
          </View>
        </View>
        <View style={styles.cardStatsRight}>
          <Text style={styles.durationLabel}>{t('history.cards.durationLabel')}</Text>
          <Text style={styles.durationValue}>{duration}</Text>
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// HistoryScreen
// ---------------------------------------------------------------------------

type NavigationProp = StackNavigationProp<RootStackParamList, 'History'>;

export function HistoryScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { t } = useTranslation();
  const [sections, setSections] = useState<HistorySection[]>([]);

  // ---------------------------------------------------------------------------
  // Load real history from native module
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const loadHistory = async () => {
      try {
        const { NativeSyncEngine } = NativeModules;
        if (!NativeSyncEngine) return;

        const binding = await NativeSyncEngine.getBindingState();
        if (!binding || !binding.host) {
          setSections([]);
          return;
        }

        const desktop = { host: binding.host, port: 39394 };
        const result = await listHistory(desktop);
        const grouped = groupRecordsByDate(result, t);
        setSections(grouped);
      } catch (e) {
        console.warn('Failed to load history scoped by current desktop:', e);
      }
    };

    loadHistory();
  }, []);


  const renderSectionHeader = ({
    section,
  }: {
    section: SectionListData<SessionCard, HistorySection>;
  }) => (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{section.title}</Text>
      {section.isToday && (
        <>
          <PulsingDot />
          <Text style={styles.liveLabel}>{t('history.liveLabel')}</Text>
        </>
      )}
    </View>
  );

  const renderItem = ({ item }: SectionListRenderItemInfo<SessionCard, HistorySection>) => (
    <DeviceCard
      deviceName={item.deviceName}
      deviceIp={item.deviceIp}
      fileCount={item.fileCount}
      totalSize={item.totalSize}
      duration={item.duration}
      t={t}
    />
  );

  const keyExtractor = (item: SessionCard) => item.id;

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
                navigation.reset({ index: 0, routes: [{ name: 'SyncActivity' as never }] });
              }
            }}
            accessibilityLabel={t('common.back')}
          >
            <Icon name="chevron-back" size={20} color={colors.screenTitle} />
          </TouchableOpacity>
          <Text style={styles.title}>{t('history.title')}</Text>
        </View>

        {/* Content */}
        <SectionList
          sections={sections}
          renderSectionHeader={renderSectionHeader}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>{t('history.emptyState.noRecords')}</Text>
            </View>
          }
        />
      </View>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Group ledger items by date into sections
// ---------------------------------------------------------------------------

interface LedgerItem {
  ledgerDate?: string;
  dateKey?: string;
  deviceId: string;
  deviceName?: string;
  deviceNameSnapshot?: string;
  deviceIp?: string;
  deviceIpSnapshot?: string;
  fileCount: number;
  totalBytes: number;
  transmissionMs?: number;
  activeTransmissionMs?: number;
}

function groupRecordsByDate(items: DesktopSyncRecordDTO[], t: TFunction): HistorySection[] {
  const map = new Map<string, SessionCard[]>();

  for (const item of items) {
    const rawDate = item.completedAt || item.failedAt || new Date().toISOString();
    const date = rawDate.split('T')[0];
    if (!map.has(date)) {
      map.set(date, []);
    }
    map.get(date)!.push({
      id: item.recordId,
      deviceName: item.filename,
      deviceIp:
        item.status === 'completed'
          ? t('history.status.completed') || '同步成功'
          : t('history.status.failed') || '同步失敗',
      fileCount: 1,
      totalSize: formatBytes(item.fileSize),
      duration: rawDate
        ? new Date(rawDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '',
    });
  }

  return Array.from(map.keys())
    .sort((a, b) => b.localeCompare(a))
    .map(date => ({
      title: formatDateLabel(date, t),
      isToday: isToday(date),
      data: map.get(date)!,
    }));
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#DFF0FE',
  },
  container: {
    flex: 1,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 20,
    gap: 10,
    zIndex: 10,
  },
  backButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.70)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: 'rgba(120,172,210,0.12)',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 1,
    shadowRadius: 12,
    elevation: 2,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: -0.36,
    color: colors.screenTitle,
  },

  // Section list
  listContent: {
    paddingHorizontal: 12,
    paddingBottom: 40,
  },

  // Section header
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
    marginTop: 4,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    letterSpacing: -0.28,
    color: '#264A73',
  },

  // Pulsing dot
  dotContainer: {
    width: 8,
    height: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dotPulse: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#3398D6',
  },
  dotSolid: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#3398D6',
  },
  liveLabel: {
    fontSize: 10,
    fontWeight: '500',
    color: '#8FB2CF',
  },

  // Device card
  card: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    shadowColor: 'rgba(81,145,197,0.08)',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 1,
    shadowRadius: 18,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 10,
  },
  monitorIconWrapper: {
    width: 43,
    height: 43,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#42A7E2',
    shadowColor: 'rgba(66,167,226,0.22)',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 1,
    shadowRadius: 16,
    elevation: 2,
  },
  cardDeviceInfo: {
    flex: 1,
    minWidth: 0,
  },
  cardDeviceName: {
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: -0.12,
    color: '#173B67',
  },
  cardDeviceIp: {
    fontSize: 9,
    color: '#A8BDCF',
    marginTop: 2,
  },

  // Divider
  cardDivider: {
    height: 1,
    backgroundColor: '#EEF5FB',
    marginBottom: 10,
  },

  // Stats
  cardStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  cardStatsLeft: {
    flex: 1,
    minWidth: 0,
  },
  statsLabel: {
    fontSize: 8,
    fontWeight: '500',
    color: '#B6C7D7',
    marginBottom: 4,
  },
  statsValue: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  statsCount: {
    fontSize: 18,
    fontWeight: 'bold',
    lineHeight: 18,
    color: '#42A7E2',
  },
  statsSep: {
    fontSize: 11,
    color: '#D0DAE4',
  },
  statsSize: {
    fontSize: 15,
    fontWeight: 'bold',
    lineHeight: 15,
    color: '#173B67',
  },
  cardStatsRight: {
    alignItems: 'flex-end',
    paddingLeft: 10,
  },
  durationLabel: {
    fontSize: 8,
    fontWeight: '500',
    color: '#B6C7D7',
    marginBottom: 4,
  },
  durationValue: {
    fontSize: 15,
    fontWeight: 'bold',
    lineHeight: 15,
    color: '#42A7E2',
  },

  // Empty
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 96,
  },
  emptyText: {
    fontSize: 14,
    color: '#8aabbd',
  },
});
