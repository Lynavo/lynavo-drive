import { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  type ListRenderItemInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../navigation/RootNavigator';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SyncStatusNav = StackNavigationProp<RootStackParamList, 'SyncStatus'>;

interface QueueItem {
  id: string;
  name: string;
  size: string;
  type: 'video' | 'image';
}

// ---------------------------------------------------------------------------
// Mock data (will be replaced by TurboModule events)
// ---------------------------------------------------------------------------

const MOCK_PROGRESS = 68;
const MOCK_SPEED = '45 MB/s';
const MOCK_COMPLETED = '8 GB';
const MOCK_TOTAL = '12.4 GB';

const mockQueue: QueueItem[] = [
  { id: '1', name: 'DJI_0022_PRO.mp4', size: '1.2 GB', type: 'video' },
  { id: '2', name: 'DJI_0023_PRO.mp4', size: '2.4 GB', type: 'video' },
  { id: '3', name: 'IMG_8492.HEIC', size: '12 MB', type: 'image' },
  { id: '4', name: 'A001_C012_1024.braw', size: '4.2 GB', type: 'video' },
  { id: '5', name: 'IMG_8493.HEIC', size: '14 MB', type: 'image' },
];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BLUE = '#3b9fd8';
const BLUE_LIGHT = '#7eb8d8';
const BLUE_MUTED = '#8ab0c8';
const DARK = '#1a3a5c';
const DARK_FILE = '#1e3a54';
const MUTED_FILE = '#a8bece';
const RING_BG = '#daeef8';
const CARD_BG = 'rgba(255,255,255,0.62)';
const QUEUE_CARD_BG = 'rgba(255,255,255,0.80)';
const ICON_BG = '#eef6fc';
const SEPARATOR = '#f2f6fa';
const QUEUE_SEPARATOR = '#eef3f8';
const SCREEN_BG = '#d6ecf8';

const RING_SIZE = 200;
const RING_THICKNESS = 9;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fileIcon(type: 'video' | 'image'): string {
  return type === 'video' ? '\uD83D\uDCF9' : '\uD83D\uDDBC';
}

/**
 * Build an array of small arc segments for the circular progress ring.
 * We approximate the circle with 72 evenly-spaced tiny Views placed
 * around the centre via absolute positioning + transform.
 */
function buildRingSegments(progress: number): Array<{ angle: number; active: boolean }> {
  const TOTAL_SEGMENTS = 72;
  const filled = Math.round((progress / 100) * TOTAL_SEGMENTS);
  const segments: Array<{ angle: number; active: boolean }> = [];
  for (let i = 0; i < TOTAL_SEGMENTS; i++) {
    segments.push({ angle: (360 / TOTAL_SEGMENTS) * i - 90, active: i < filled });
  }
  return segments;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CircularProgress({ progress }: { progress: number }) {
  const segments = buildRingSegments(progress);
  const centre = RING_SIZE / 2;
  const radius = (RING_SIZE - RING_THICKNESS) / 2;

  return (
    <View style={[styles.ringContainer, { width: RING_SIZE, height: RING_SIZE }]}>
      {/* Background track */}
      <View
        style={[
          styles.ringTrack,
          {
            width: RING_SIZE,
            height: RING_SIZE,
            borderRadius: RING_SIZE / 2,
            borderWidth: RING_THICKNESS,
            borderColor: RING_BG,
          },
        ]}
      />

      {/* Progress segments */}
      {segments.map((seg) => {
        const rad = (seg.angle * Math.PI) / 180;
        const x = centre + radius * Math.cos(rad) - 3;
        const y = centre + radius * Math.sin(rad) - 3;
        return (
          <View
            key={seg.angle}
            style={[
              styles.ringDot,
              {
                left: x,
                top: y,
                backgroundColor: seg.active ? BLUE : RING_BG,
              },
            ]}
          />
        );
      })}

      {/* Centre content */}
      <View style={styles.ringCentre}>
        <Text style={styles.transmittingLabel}>TRANSMITTING</Text>
        <Text style={styles.percentageText}>{progress}%</Text>
        <Text style={styles.speedText}>{MOCK_SPEED}</Text>
      </View>
    </View>
  );
}

function QueueItemRow({ item, isLast }: { item: QueueItem; isLast: boolean }) {
  return (
    <View style={[styles.queueRow, !isLast && styles.queueRowBorder]}>
      <View style={styles.queueIcon}>
        <Text style={styles.queueIconText}>{fileIcon(item.type)}</Text>
      </View>
      <View style={styles.queueInfo}>
        <Text style={styles.queueFileName} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.queueFileSize}>{item.size}</Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export function SyncStatusScreen() {
  const navigation = useNavigation<SyncStatusNav>();

  const handleHistory = useCallback(() => {
    navigation.navigate('History');
  }, [navigation]);

  const handleSettings = useCallback(() => {
    navigation.navigate('Settings');
  }, [navigation]);

  const renderQueueItem = useCallback(
    ({ item, index }: ListRenderItemInfo<QueueItem>) => (
      <QueueItemRow item={item} isLast={index === mockQueue.length - 1} />
    ),
    [],
  );

  const keyExtractor = useCallback((item: QueueItem) => item.id, []);

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      {/* ---- Header ---- */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{'\u540C\u6B65\u52A8\u6001'}</Text>
        <View style={styles.headerActions}>
          <Pressable
            onPress={handleHistory}
            style={styles.headerBtn}
            accessibilityLabel={'\u5386\u53F2\u8BB0\u5F55'}
          >
            <Text style={styles.headerBtnIcon}>{'\u29D6'}</Text>
          </Pressable>
          <Pressable
            onPress={handleSettings}
            style={styles.headerBtn}
            accessibilityLabel={'\u8BBE\u7F6E'}
          >
            <Text style={styles.headerBtnIcon}>{'\u2699'}</Text>
          </Pressable>
        </View>
      </View>

      {/* ---- Progress card ---- */}
      <View style={styles.progressCard}>
        <CircularProgress progress={MOCK_PROGRESS} />
        <Text style={styles.completedText}>
          {'\u5DF2\u5B8C\u6210 '}{MOCK_COMPLETED}{' / '}{MOCK_TOTAL}
        </Text>
      </View>

      {/* ---- Queue card ---- */}
      <View style={styles.queueCard}>
        <View style={styles.queueHeader}>
          <Text style={styles.queueTitle}>{'\u6392\u961F\u4E2D'}</Text>
          <View style={styles.queueBadge}>
            <Text style={styles.queueBadgeText}>{mockQueue.length}</Text>
          </View>
        </View>
        <FlatList<QueueItem>
          data={mockQueue}
          renderItem={renderQueueItem}
          keyExtractor={keyExtractor}
          scrollEnabled={true}
          showsVerticalScrollIndicator={false}
        />
      </View>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: SCREEN_BG,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: DARK,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBtnIcon: {
    fontSize: 20,
    color: DARK,
    opacity: 0.5,
  },

  // Progress card
  progressCard: {
    marginHorizontal: 20,
    marginTop: 16,
    borderRadius: 24,
    paddingVertical: 32,
    paddingHorizontal: 24,
    alignItems: 'center',
    backgroundColor: CARD_BG,
    shadowColor: '#50a0d2',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 32,
    elevation: 4,
  },
  completedText: {
    marginTop: 20,
    fontSize: 14,
    color: BLUE_MUTED,
  },

  // Circular progress ring
  ringContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringTrack: {
    position: 'absolute',
  },
  ringDot: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  ringCentre: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  transmittingLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 2,
    color: BLUE_LIGHT,
    textTransform: 'uppercase',
  },
  percentageText: {
    fontSize: 42,
    fontWeight: '700',
    color: BLUE,
    lineHeight: 48,
    marginTop: 2,
  },
  speedText: {
    fontSize: 14,
    fontWeight: '600',
    color: BLUE,
    marginTop: 4,
  },

  // Queue card
  queueCard: {
    flex: 1,
    marginHorizontal: 20,
    marginTop: 20,
    marginBottom: 20,
    borderRadius: 24,
    backgroundColor: QUEUE_CARD_BG,
    shadowColor: '#50a0d2',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 3,
    overflow: 'hidden',
  },
  queueHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: QUEUE_SEPARATOR,
  },
  queueTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: DARK,
  },
  queueBadge: {
    height: 20,
    minWidth: 20,
    borderRadius: 10,
    backgroundColor: BLUE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  queueBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ffffff',
  },

  // Queue list row
  queueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#ffffff',
  },
  queueRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: SEPARATOR,
  },
  queueIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: ICON_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  queueIconText: {
    fontSize: 18,
  },
  queueInfo: {
    flex: 1,
    minWidth: 0,
  },
  queueFileName: {
    fontSize: 14,
    fontWeight: '600',
    color: DARK_FILE,
  },
  queueFileSize: {
    fontSize: 12,
    color: MUTED_FILE,
    marginTop: 2,
  },
});
