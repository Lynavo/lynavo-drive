import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  NativeModules,
  NativeEventEmitter,
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
  status: 'queued' | 'uploading' | 'completed';
}

interface SyncOverview {
  progressPercent: number;
  speed: string;
  completed: string;
  total: string;
  uploadState: string;
}

// ---------------------------------------------------------------------------
// Mock data (fallback when native module not available)
// ---------------------------------------------------------------------------

const MOCK_OVERVIEW: SyncOverview = {
  progressPercent: 68,
  speed: '45 MB/s',
  completed: '8 GB',
  total: '12.4 GB',
  uploadState: 'syncing_foreground',
};

const mockQueue: QueueItem[] = [
  { id: '1', name: 'DJI_0022_PRO.mp4', size: '1.2 GB', type: 'video', status: 'uploading' },
  { id: '2', name: 'DJI_0023_PRO.mp4', size: '2.4 GB', type: 'video', status: 'queued' },
  { id: '3', name: 'IMG_8492.HEIC', size: '12 MB', type: 'image', status: 'queued' },
  { id: '4', name: 'A001_C012_1024.braw', size: '4.2 GB', type: 'video', status: 'queued' },
  { id: '5', name: 'IMG_8493.HEIC', size: '14 MB', type: 'image', status: 'queued' },
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
const UPLOADING_BG = 'rgba(59,159,216,0.08)';
const UPLOADING_BORDER = BLUE;

const RING_SIZE = 200;
const RING_THICKNESS = 9;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fileIcon(type: 'video' | 'image'): string {
  return type === 'video' ? '\uD83D\uDCF9' : '\uD83D\uDDBC';
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

/**
 * Build an array of small arc segments for the circular progress ring.
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

function CircularProgress({ progress, speed }: { progress: number; speed: string }) {
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
        <Text style={styles.speedText}>{speed}</Text>
      </View>
    </View>
  );
}

function CompletionCard({ completed, total }: { completed: string; total: string }) {
  return (
    <View style={styles.completionContainer}>
      {/* Glow backdrop */}
      <View style={styles.completionGlow} />
      {/* Checkmark circle */}
      <View style={styles.completionCircle}>
        <Text style={styles.completionCheck}>{'\u2713'}</Text>
      </View>
      <Text style={styles.completionTitle}>{'\u6240\u6709\u6587\u4EF6\u5DF2\u540C\u6B65'}</Text>
      <View style={styles.completionMeta}>
        <Text style={styles.completionStats}>
          {completed}{' / '}{total}
        </Text>
        <Text style={styles.completionSubtext}>{'\u672C\u6B21\u540C\u6B65\u5DF2\u5168\u90E8\u5B8C\u6210'}</Text>
      </View>
    </View>
  );
}

function QueueItemRow({ item, isLast }: { item: QueueItem; isLast: boolean }) {
  const isUploading = item.status === 'uploading';
  return (
    <View
      style={[
        styles.queueRow,
        !isLast && styles.queueRowBorder,
        isUploading && styles.queueRowUploading,
      ]}
    >
      <View style={styles.queueIcon}>
        <Text style={styles.queueIconText}>{fileIcon(item.type)}</Text>
      </View>
      <View style={styles.queueInfo}>
        <Text style={styles.queueFileName} numberOfLines={1}>
          {item.name}
        </Text>
        <View style={styles.queueFileMeta}>
          <Text style={styles.queueFileSize}>{item.size}</Text>
          {isUploading && (
            <View style={styles.uploadingBadge}>
              <View style={styles.uploadingDot} />
              <Text style={styles.uploadingLabel}>{'\u4F20\u8F93\u4E2D'}</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export function SyncStatusScreen() {
  const navigation = useNavigation<SyncStatusNav>();
  const [overview, setOverview] = useState<SyncOverview>({
    progressPercent: 0,
    speed: '0 MB/s',
    completed: '0 B',
    total: '0 B',
    uploadState: 'idle',
  });
  const [queue, setQueue] = useState<QueueItem[]>([]);

  // ---------------------------------------------------------------------------
  // Load real data from native module with mock fallback
  // ---------------------------------------------------------------------------

  useEffect(() => {
    let syncSub: { remove: () => void } | undefined;
    let queueSub: { remove: () => void } | undefined;

    const loadReal = async () => {
      try {
        const { NativeSyncEngine } = NativeModules;
        if (!NativeSyncEngine) return;

        // Listen for errors from native engine
        const debugEmitter = new NativeEventEmitter(NativeSyncEngine);
        const errorSub = debugEmitter.addListener('onError', (error: Record<string, unknown>) => {
          console.error('[SyncStatus] Native error:', JSON.stringify(error));
        });
        const syncEventSub = debugEmitter.addListener('onSyncStateChanged', (state: Record<string, unknown>) => {
          console.log('[SyncStatus] Sync state changed:', JSON.stringify(state));
        });

        // Auto-start sync if we have a binding (coming from app launch or after pairing)
        const binding = await NativeSyncEngine.getBindingState();
        if (binding && binding.deviceId) {
          // Start discovery first (so sync pipeline can find the target device)
          await NativeSyncEngine.startDiscovery();
          // Trigger sync — runs in background: scans photos → connects → uploads
          NativeSyncEngine.triggerSync?.()
            .catch((e: Error) => console.warn('[SyncStatus] triggerSync failed:', e));
        }

        // Load initial overview
        const syncData = await NativeSyncEngine.getSyncOverview();
        if (syncData) {
          setOverview({
            progressPercent: syncData.progressPercent ?? 0,
            speed: syncData.currentSpeedMbps ? `${syncData.currentSpeedMbps} MB/s` : '0 MB/s',
            completed: formatBytes(syncData.transferredBytes ?? 0),
            total: formatBytes(syncData.totalBytes ?? 0),
            uploadState: syncData.uploadState ?? 'idle',
          });
        }

        // Load initial queue
        const queueData = await NativeSyncEngine.getReadOnlyQueue();
        if (queueData) {
          setQueue(queueData.map((item: Record<string, unknown>, index: number) => ({
            id: String(item.id ?? index),
            name: (item.originalFilename as string) || 'Unknown',
            size: formatBytes((item.fileSize as number) ?? 0),
            type: (item.mediaType as string) === 'video' ? 'video' : 'image',
            status: ((item.status as string) ?? 'queued') as QueueItem['status'],
          })));
        }

        // Subscribe to live updates
        const emitter = new NativeEventEmitter(NativeSyncEngine);
        syncSub = emitter.addListener('onSyncStateChanged', (state: Record<string, unknown>) => {
          setOverview((prev) => ({
            ...prev,
            progressPercent: (state.progressPercent as number) ?? prev.progressPercent,
            speed: state.currentSpeedMbps ? `${state.currentSpeedMbps} MB/s` : prev.speed,
            completed: state.transferredBytes ? formatBytes(state.transferredBytes as number) : prev.completed,
            total: state.totalBytes ? formatBytes(state.totalBytes as number) : prev.total,
            uploadState: (state.uploadState as string) ?? prev.uploadState,
          }));
        });

        queueSub = emitter.addListener('onQueueUpdated', (updatedQueue: Array<Record<string, unknown>>) => {
          if (updatedQueue) {
            setQueue(updatedQueue.map((item, index) => ({
              id: String(item.id ?? index),
              name: (item.originalFilename as string) || 'Unknown',
              size: formatBytes((item.fileSize as number) ?? 0),
              type: (item.mediaType as string) === 'video' ? 'video' : 'image',
              status: ((item.status as string) ?? 'queued') as QueueItem['status'],
            })));
          }
        });
      } catch (e) {
        console.warn('Native module not available for SyncStatus, using mock data');
      }
    };

    loadReal();

    return () => {
      syncSub?.remove();
      queueSub?.remove();
    };
  }, []);

  const handleHistory = useCallback(() => {
    navigation.navigate('History');
  }, [navigation]);

  const handleSettings = useCallback(() => {
    navigation.navigate('Settings');
  }, [navigation]);

  const renderQueueItem = useCallback(
    ({ item, index }: ListRenderItemInfo<QueueItem>) => (
      <QueueItemRow item={item} isLast={index === queue.length - 1} />
    ),
    [queue.length],
  );

  const keyExtractor = useCallback((item: QueueItem) => item.id, []);

  const isDone = overview.uploadState === 'completed' ||
    (overview.uploadState === 'idle' && queue.length === 0 && overview.progressPercent >= 100);

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

      {isDone ? (
        /* ---- Completion card ---- */
        <View style={styles.progressCard}>
          <CompletionCard completed={overview.completed} total={overview.total} />
        </View>
      ) : (
        <>
          {/* ---- Progress card ---- */}
          <View style={styles.progressCard}>
            <CircularProgress progress={overview.progressPercent} speed={overview.speed} />
            <Text style={styles.completedText}>
              {'\u5DF2\u5B8C\u6210 '}{overview.completed}{' / '}{overview.total}
            </Text>
          </View>

          {/* ---- Queue card ---- */}
          <View style={styles.queueCard}>
            <View style={styles.queueHeader}>
              <Text style={styles.queueTitle}>{'\u6392\u961F\u4E2D'}</Text>
              <View style={styles.queueBadge}>
                <Text style={styles.queueBadgeText}>{queue.length}</Text>
              </View>
            </View>
            <FlatList<QueueItem>
              data={queue}
              renderItem={renderQueueItem}
              keyExtractor={keyExtractor}
              scrollEnabled={true}
              showsVerticalScrollIndicator={false}
            />
          </View>
        </>
      )}
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
  queueFileMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },

  // Uploading row highlight
  queueRowUploading: {
    backgroundColor: UPLOADING_BG,
    borderLeftWidth: 3,
    borderLeftColor: UPLOADING_BORDER,
  },
  uploadingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(59,159,216,0.12)',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  uploadingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: BLUE,
  },
  uploadingLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: BLUE,
  },

  // Completion card
  completionContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
  },
  completionGlow: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(59,159,216,0.12)',
  },
  completionCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 4,
    borderColor: '#c5e5f5',
    backgroundColor: 'rgba(59,159,216,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  completionCheck: {
    fontSize: 36,
    fontWeight: '700',
    color: BLUE,
  },
  completionTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: BLUE,
    letterSpacing: -0.3,
  },
  completionMeta: {
    alignItems: 'center',
    gap: 4,
    marginTop: 16,
  },
  completionStats: {
    fontSize: 16,
    fontWeight: '700',
    color: BLUE,
  },
  completionSubtext: {
    fontSize: 12,
    color: '#9bb8c8',
  },
});
