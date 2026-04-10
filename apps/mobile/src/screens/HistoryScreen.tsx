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
import type { RootStackParamList } from '../navigation/RootNavigator';
import { colors } from '../theme/colors';
import { formatBytes, formatDuration } from '../utils/format';
import { formatLocalDateKey, formatLocalYesterdayDateKey } from '../utils/localDateKey';
import { Icon } from '../components/Icon';

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

function formatDateLabel(dateStr: string): string {
  if (isToday(dateStr)) return '今天';
  if (isYesterday(dateStr)) return '昨天';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parseInt(parts[1], 10)}月${parseInt(parts[2], 10)}日`;
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
}

function DeviceCard({ deviceName, deviceIp, fileCount, totalSize, duration }: DeviceCardProps) {
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
          <Text style={styles.statsLabel}>{'共同步媒体文件'}</Text>
          <Text style={styles.statsValue}>
            <Text style={styles.statsCount}>{fileCount}</Text>
            <Text style={styles.statsSep}> {'个'} {'·'} </Text>
            <Text style={styles.statsSize}>{totalSize}</Text>
          </Text>
        </View>
        <View style={styles.cardStatsRight}>
          <Text style={styles.durationLabel}>{'耗时'}</Text>
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
  const [sections, setSections] = useState<HistorySection[]>([]);

  // ---------------------------------------------------------------------------
  // Load real history from native module
  // ---------------------------------------------------------------------------

  useEffect(() => {
    let historySub: { remove: () => void } | undefined;

    const loadHistory = async () => {
      try {
        const { NativeSyncEngine } = NativeModules;
        if (!NativeSyncEngine) return;

        const result = await NativeSyncEngine.getHistoryDays(null);
        if (result && result.items) {
          const grouped = groupByDate(result.items);
          setSections(grouped);
        }

        // Subscribe to live updates
        const emitter = new NativeEventEmitter(NativeSyncEngine);
        historySub = emitter.addListener('onHistoryUpdated', async () => {
          try {
            const updated = await NativeSyncEngine.getHistoryDays(null);
            if (updated && updated.items) {
              setSections(groupByDate(updated.items));
            }
          } catch {
            // keep current data
          }
        });
      } catch (e) {
        console.warn('Native module not available for History');
      }
    };

    loadHistory();

    return () => {
      historySub?.remove();
    };
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
          <Text style={styles.liveLabel}>{'实时同步中'}</Text>
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
                navigation.reset({ index: 0, routes: [{ name: 'MainTabs' as never }] });
              }
            }}
            accessibilityLabel={'返回'}
          >
            <Icon name="chevron-back" size={20} color={colors.screenTitle} />
          </TouchableOpacity>
          <Text style={styles.title}>{'历史记录'}</Text>
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
              <Text style={styles.emptyText}>{'暂无同步记录'}</Text>
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

function groupByDate(items: LedgerItem[]): HistorySection[] {
  const map = new Map<string, SessionCard[]>();

  for (const item of items) {
    const date = item.ledgerDate || item.dateKey || 'unknown';
    if (!map.has(date)) {
      map.set(date, []);
    }
    map.get(date)!.push({
      id: `${date}-${item.deviceId}`,
      deviceName: item.deviceName || item.deviceNameSnapshot || 'Unknown',
      deviceIp: item.deviceIp || item.deviceIpSnapshot || '',
      fileCount: item.fileCount,
      totalSize: formatBytes(item.totalBytes),
      duration: formatDuration(item.transmissionMs || item.activeTransmissionMs || 0),
    });
  }

  // Sort dates descending and build sections
  return Array.from(map.keys())
    .sort((a, b) => b.localeCompare(a))
    .map(date => ({
      title: formatDateLabel(date),
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

  // Section list
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },

  // Section header
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
    marginTop: 16,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4a6a8a',
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
    backgroundColor: '#3b9fd8',
  },
  dotSolid: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#2a90d0',
  },
  liveLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: '#90b8d0',
  },

  // Device card
  card: {
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 12,
    shadowColor: 'rgba(80,150,200,0.3)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.09,
    shadowRadius: 14,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  monitorIconWrapper: {
    width: 36,
    height: 36,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#3ba4dc',
    shadowColor: 'rgba(59,159,216,0.5)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 2,
  },
  cardDeviceInfo: {
    flex: 1,
    minWidth: 0,
  },
  cardDeviceName: {
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.screenTitle,
  },
  cardDeviceIp: {
    fontSize: 12,
    color: '#9ab8cc',
    marginTop: 1,
  },

  // Divider
  cardDivider: {
    height: 1,
    backgroundColor: 'rgba(160,200,225,0.22)',
    marginBottom: 12,
  },

  // Stats
  cardStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  cardStatsLeft: {
    flex: 1,
  },
  statsLabel: {
    fontSize: 11,
    color: '#9ab8cc',
    marginBottom: 2,
  },
  statsValue: {
    fontSize: 15,
    fontWeight: 'bold',
    color: colors.screenTitle,
    fontVariant: ['tabular-nums'],
  },
  statsCount: {
    color: '#2a90d0',
  },
  statsSep: {
    color: '#c8dce8',
  },
  statsSize: {
    color: colors.screenTitle,
  },
  cardStatsRight: {
    alignItems: 'flex-end',
  },
  durationLabel: {
    fontSize: 10,
    color: '#b8d0dc',
    marginBottom: 2,
  },
  durationValue: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2a90d0',
    fontVariant: ['tabular-nums'],
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
