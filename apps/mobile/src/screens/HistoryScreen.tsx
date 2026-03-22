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
  const today = new Date().toISOString().slice(0, 10);
  return dateStr === today;
}

function isYesterday(dateStr: string): boolean {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return dateStr === yesterday.toISOString().slice(0, 10);
}

function formatDateLabel(dateStr: string): string {
  if (isToday(dateStr)) return '\u4ECA\u5929';
  if (isYesterday(dateStr)) return '\u6628\u5929';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parseInt(parts[1], 10)}\u6708${parseInt(parts[2], 10)}\u65E5`;
  }
  return dateStr;
}

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const mockSections: HistorySection[] = [
  {
    title: '\u4ECA\u5929',
    isToday: true,
    data: [
      {
        id: 's1',
        deviceName: '\u526A\u8F91\u5DE5\u4F5C\u7AD9-A',
        deviceIp: '192.168.1.101',
        fileCount: 15,
        totalSize: '16.3 GB',
        duration: '22:51',
      },
      {
        id: 's2',
        deviceName: 'MacBook Pro',
        deviceIp: '192.168.1.108',
        fileCount: 3,
        totalSize: '2.1 GB',
        duration: '10:02',
      },
    ],
  },
  {
    title: '3\u670818\u65E5',
    isToday: false,
    data: [
      {
        id: 's3',
        deviceName: '\u526A\u8F91\u5DE5\u4F5C\u7AD9-A',
        deviceIp: '192.168.1.101',
        fileCount: 45,
        totalSize: '86.5 GB',
        duration: '22:17',
      },
    ],
  },
  {
    title: '3\u670817\u65E5',
    isToday: false,
    data: [
      {
        id: 's4',
        deviceName: '\u526A\u8F91\u5DE5\u4F5C\u7AD9-A',
        deviceIp: '192.168.1.101',
        fileCount: 29,
        totalSize: '51.0 GB',
        duration: '21:05',
      },
    ],
  },
];

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
          <Text style={styles.monitorIcon}>{'\uD83D\uDDA5'}</Text>
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
          <Text style={styles.statsLabel}>{'\u5171\u540C\u6B65\u5A92\u4F53\u6587\u4EF6'}</Text>
          <Text style={styles.statsValue}>
            <Text style={styles.statsCount}>{fileCount}</Text>
            <Text style={styles.statsSep}> {'\u4E2A'} {'\u00B7'} </Text>
            <Text style={styles.statsSize}>{totalSize}</Text>
          </Text>
        </View>
        <View style={styles.cardStatsRight}>
          <Text style={styles.durationLabel}>{'\u8017\u65F6'}</Text>
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
  // Load real history from native module with mock fallback
  // ---------------------------------------------------------------------------

  useEffect(() => {
    let historySub: { remove: () => void } | undefined;

    const loadHistory = async () => {
      try {
        const { NativeSyncEngine } = NativeModules;
        if (!NativeSyncEngine) return;

        const result = await NativeSyncEngine.getHistoryDays(null);
        console.log('[History] getHistoryDays result:', JSON.stringify(result));
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
        console.warn('Native module not available for History, using mock data');
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
          <Text style={styles.liveLabel}>{'\u5B9E\u65F6\u540C\u6B65\u4E2D'}</Text>
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
            activeOpacity={0.7}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.backArrow}>{'\u2190'}</Text>
          </TouchableOpacity>
          <Text style={styles.title}>{'\u5386\u53F2\u8BB0\u5F55'}</Text>
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
              <Text style={styles.emptyText}>{'\u6682\u65E0\u540C\u6B65\u8BB0\u5F55'}</Text>
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
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  backArrow: {
    fontSize: 18,
    color: colors.screenTitle,
    fontWeight: '500',
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
  monitorIcon: {
    fontSize: 18,
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
