import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Path,
  Rect,
  Stop,
} from 'react-native-svg';
import { ArrowDownCircle } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { colors } from '../../theme/colors';
import { Icon } from '../../components/Icon';
import { androidBoxShadow } from '../../utils/androidShadow';
import { getLocalComputerThumbnailUrl } from '../../services/desktop-local-service';
import { isPersonalDirRecord } from '../../services/download-records-service';

const BLUE = colors.accent;
const DARK = colors.primary;
const SOFT_TEXT = colors.secondaryForeground;

export interface RecentDownloadRecord {
  recordId: string;
  filename: string;
  fileSize?: number;
  mediaType?: string;
  thumbnailUrl?: string;
  previewUrl?: string;
  streamUrl?: string;
  localPath?: string | null;
  completedAt?: string;
  failedAt?: string;
}

interface RecentDownloadsSectionProps {
  records: RecentDownloadRecord[];
  t: TFunction;
  onPressViewAll: () => void;
  title?: string;
  viewAllLabel?: string;
  sectionIconColor?: string;
}

export interface SyncRecordTimelineItem {
  id: string;
  deviceName: string;
  duration: string;
  fileCount: number;
  status: 'syncing' | 'completed';
  totalSize: string;
}

export interface SyncRecordTimelineDay {
  key: string;
  label: string;
  records: SyncRecordTimelineItem[];
  totalFiles: number;
  totalSize: string;
}

interface SyncRecordTimelineSectionProps {
  days: SyncRecordTimelineDay[];
  totalSyncedSize: string;
}

export interface SyncStatePreviewItem {
  key: string;
  title: string;
  description: string;
  iconName: string;
  iconColor: string;
  iconBackground: string;
  actionLabel?: string;
  actionTone?: 'blue' | 'amber' | 'red';
}

interface SyncStatePreviewSectionProps {
  title: string;
  description: string;
  items: SyncStatePreviewItem[];
}

type MediaPreviewKind = 'photo' | 'video' | 'file';
type RecentDownloadThumbnailSource = {
  uri: string;
  renderer: 'image';
};

const SECTION_EMPTY_ALIGNMENT_STYLE = {
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
};

function SectionEmptyState({
  iconName,
  message,
  testID,
  title,
}: {
  iconName: string;
  message: string;
  testID: string;
  title: string;
}) {
  return (
    <View
      testID={testID}
      style={[styles.sectionEmptyState, SECTION_EMPTY_ALIGNMENT_STYLE]}
    >
      <View style={styles.sectionEmptyIcon}>
        <Icon name={iconName} size={24} color={BLUE} />
      </View>
      <Text style={styles.sectionEmptyTitle}>{title}</Text>
      <Text style={styles.sectionEmptyMessage}>{message}</Text>
    </View>
  );
}

export function RecentDownloadsSection({
  records,
  t,
  onPressViewAll,
  title,
  viewAllLabel,
  sectionIconColor,
}: RecentDownloadsSectionProps) {
  const isEmpty = records.length === 0;
  const recentItems = records.slice(0, 4).map(record => {
    const previewType = getRecordPreviewType(record);
    return {
      key: record.recordId,
      label: record.filename,
      meta: formatRecordTimeLabel(record),
      previewType,
      thumbnailSource: getRecentDownloadThumbnailSource(record, previewType),
    };
  });

  return (
    <View style={[styles.recentDownloadSection, styles.recentDownloadSurface]}>
      <View style={styles.recentDownloadHeader}>
        <View style={styles.sectionTitleRow}>
          <ArrowDownCircle
            testID="recent-download-title-icon"
            size={18}
            color={sectionIconColor ?? BLUE}
            strokeWidth={1.9}
          />
          <Text style={[styles.sectionTitleText, styles.sectionTitleEmphasis]}>
            {title ?? t('syncActivity.home.recentDownloadsTitle')}
          </Text>
        </View>
        <TouchableOpacity onPress={onPressViewAll} activeOpacity={0.7}>
          <Text style={styles.recentDownloadViewAll}>
            {viewAllLabel ??
              (t('syncActivity.recentDownload.viewAll') || 'View All')}
          </Text>
        </TouchableOpacity>
      </View>
      {isEmpty ? (
        <SectionEmptyState
          testID="recent-download-empty-state"
          iconName="cloud-download-outline"
          title={t('syncActivity.recentDownload.emptyTitle')}
          message={t('syncActivity.recentDownload.emptyMessage')}
        />
      ) : (
        <View style={styles.recentDownloadGrid}>
          {recentItems.map(item => (
            <View key={item.key} style={styles.recentDownloadTile}>
              <View
                style={[styles.recentDownloadIconWrap, styles.mediaPreviewWrap]}
              >
                <RecentDownloadPreview
                  label={item.label}
                  thumbnailSource={item.thumbnailSource}
                  type={item.previewType}
                  recordId={item.key}
                />
              </View>
              <Text style={styles.recentDownloadName} numberOfLines={1}>
                {item.label}
              </Text>
              {item.meta ? (
                <Text style={styles.recentDownloadTime}>{item.meta}</Text>
              ) : null}
            </View>
          ))}
          {Array.from({ length: 4 - recentItems.length }).map((_, index) => (
            <View
              key={`dummy-${index}`}
              style={styles.recentDownloadTileDummy}
              testID="recent-download-tile-dummy"
            />
          ))}
        </View>
      )}
    </View>
  );
}

function RecentDownloadPreview({
  label,
  thumbnailSource,
  type,
  recordId,
}: {
  label: string;
  thumbnailSource?: RecentDownloadThumbnailSource;
  type: MediaPreviewKind;
  recordId?: string;
}) {
  const [thumbnailFailed, setThumbnailFailed] = React.useState(false);
  const [liveUri, setLiveUri] = React.useState<string | null>(null);
  const { t } = useTranslation();

  React.useEffect(() => {
    setLiveUri(null);
    setThumbnailFailed(false);

    if (type !== 'photo' && type !== 'video') {
      return;
    }
    if (thumbnailSource) {
      return;
    }
    if (!recordId || !isPersonalDirRecord(recordId)) {
      return;
    }

    let cancelled = false;
    getLocalComputerThumbnailUrl(recordId)
      .then(url => {
        if (!cancelled && url) {
          setLiveUri(url);
        }
      })
      .catch(err => {
        console.warn(
          '[video-thumbnail][mobile] home recent download personal-dir live URL fetch failed',
          { recordId, err },
        );
      });

    return () => {
      cancelled = true;
    };
  }, [recordId, thumbnailSource, type]);

  const activeUri = thumbnailSource?.uri ?? liveUri ?? undefined;

  React.useEffect(() => {
    if (type !== 'photo' && type !== 'video') {
      return;
    }
    console.info('[video-thumbnail][mobile] recent download thumbnail state', {
      label,
      type,
      hasThumbnailSource: Boolean(thumbnailSource),
      hasLiveUri: Boolean(liveUri),
      activeUri: activeUri ?? null,
      renderer: thumbnailSource?.renderer ?? (liveUri ? 'image' : null),
      renderingImage: Boolean(activeUri && !thumbnailFailed),
      thumbnailFailed,
    });
  }, [label, thumbnailFailed, thumbnailSource, liveUri, activeUri, type]);

  if (activeUri && !thumbnailFailed) {
    return (
      <Image
        testID="recent-download-thumbnail-image"
        source={{ uri: activeUri }}
        style={styles.recentDownloadThumbnailImage}
        resizeMode="cover"
        accessibilityLabel={`${label} ${t('common.thumbnail')}`}
        onError={() => {
          console.warn(
            '[video-thumbnail][mobile] recent download image load failed',
            {
              label,
              type,
              uri: activeUri,
            },
          );
          setThumbnailFailed(true);
        }}
      />
    );
  }

  return <MediaPreviewIcon type={type} />;
}

export function SyncRecordTimelineSection({
  days,
  totalSyncedSize,
}: SyncRecordTimelineSectionProps) {
  const { t } = useTranslation();
  const shouldRenderEmpty = days.length === 0;

  return (
    <View style={[styles.syncRecordSection, styles.syncRecordSurface]}>
      <View style={styles.syncTimelineHeader}>
        <Icon name="time-outline" size={18} color="#746AA8" />
        <View style={styles.syncTimelineHeaderCopy}>
          <Text style={[styles.sectionTitleText, styles.sectionTitleEmphasis]}>
            {t('syncActivity.syncRecords.title')}
          </Text>
          <Text style={styles.syncTimelineTotal}>
            {t('syncActivity.syncRecords.totalSynced', {
              size: totalSyncedSize,
            })}
          </Text>
        </View>
      </View>

      {shouldRenderEmpty ? (
        <SectionEmptyState
          testID="sync-record-empty-state"
          iconName="time-outline"
          title={t('syncActivity.syncRecords.emptyTitle')}
          message={t('syncActivity.syncRecords.emptyMessage')}
        />
      ) : (
        <View style={styles.syncTimelineDayList}>
          {days.slice(0, 3).map(day => (
            <View key={day.key}>
              <View style={styles.syncTimelineDayRow}>
                <Text style={styles.syncTimelineDay}>{day.label}</Text>
                <Text style={styles.syncTimelineDayStats}>
                  {t('syncActivity.syncRecords.dayStats', {
                    count: day.totalFiles,
                    size: day.totalSize,
                  })}
                </Text>
              </View>
              <View style={styles.syncTimelineRecordList}>
                {day.records.map(record => {
                  const isCompleted = record.status === 'completed';
                  return (
                    <View key={record.id} style={styles.syncTimelineRecordCard}>
                      <View style={styles.syncTimelineRecordHeader}>
                        <View style={styles.syncTimelineRecordTitleBlock}>
                          <Text
                            style={styles.syncTimelineRecordDeviceName}
                            numberOfLines={1}
                          >
                            {record.deviceName}
                          </Text>
                          <Text style={styles.syncTimelineRecordSubtle}>
                            {t('syncActivity.syncRecords.todayRecord')}
                          </Text>
                        </View>
                        <View
                          style={[
                            styles.syncTimelineStatusPill,
                            isCompleted
                              ? styles.syncTimelineStatusCompleted
                              : styles.syncTimelineStatusSyncing,
                          ]}
                        >
                          <Text
                            style={[
                              styles.syncTimelineStatusText,
                              isCompleted
                                ? styles.syncTimelineStatusTextCompleted
                                : styles.syncTimelineStatusTextSyncing,
                            ]}
                          >
                            {isCompleted
                              ? t('syncActivity.syncRecords.statusCompleted')
                              : t('syncActivity.syncRecords.statusSyncing')}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.syncTimelineStatsGrid}>
                        <View style={styles.syncTimelineStat}>
                          <Text style={styles.syncTimelineRecordSubtle}>
                            {t('syncActivity.syncRecords.uploadFiles')}
                          </Text>
                          <Text style={styles.syncTimelineStatValue}>
                            {t('syncActivity.syncRecords.fileCount', {
                              count: record.fileCount,
                            })}
                          </Text>
                        </View>
                        <View style={styles.syncTimelineStat}>
                          <Text style={styles.syncTimelineRecordSubtle}>
                            {t('syncActivity.syncRecords.totalSize')}
                          </Text>
                          <Text style={styles.syncTimelineStatValue}>
                            {record.totalSize}
                          </Text>
                        </View>
                        <View
                          style={[
                            styles.syncTimelineStat,
                            styles.syncTimelineStatRight,
                          ]}
                        >
                          <Text style={styles.syncTimelineRecordSubtle}>
                            {t('syncActivity.syncRecords.duration')}
                          </Text>
                          <Text style={styles.syncTimelineStatValue}>
                            {record.duration}
                          </Text>
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

export function MediaPreviewIcon({ type }: { type: MediaPreviewKind }) {
  if (type === 'photo') {
    return (
      <View style={[styles.mediaIcon, styles.photoIcon]}>
        <MediaIconGradient type="photo" />
        <View style={styles.photoSun} />
        <View style={styles.photoHillLeft} />
        <View style={styles.photoHillRight} />
        <PhotoGlyph />
      </View>
    );
  }

  if (type === 'video') {
    return (
      <View style={[styles.mediaIcon, styles.videoIcon]}>
        <MediaIconGradient type="video" />
        <View style={styles.videoDotRowTop}>
          {[0, 1, 2].map(item => (
            <View key={item} style={styles.videoDot} />
          ))}
        </View>
        <View style={styles.playCircle}>
          <VideoPlayGlyph />
        </View>
        <View style={styles.videoDotRowBottom}>
          {[0, 1, 2].map(item => (
            <View key={item} style={styles.videoDotFaint} />
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.mediaIcon, styles.fileIcon]}>
      <MediaIconGradient type="file" />
      <View style={styles.fileCorner} />
      <FileGlyph />
    </View>
  );
}

function MediaIconGradient({ type }: { type: MediaPreviewKind }) {
  const stops =
    type === 'photo'
      ? ['#F7FCFF', '#D8F0FF', '#9FD6FF']
      : type === 'video'
        ? ['#F8F6FF', '#E3E6FF', '#9AAEFF']
        : ['#FFFFFF', '#EFF5FB', '#D7E2F0'];
  const gradientId = `home${type}MediaGradient`;

  return (
    <Svg pointerEvents="none" style={StyleSheet.absoluteFillObject}>
      <Defs>
        <LinearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0%" stopColor={stops[0]} />
          <Stop offset="56%" stopColor={stops[1]} />
          <Stop offset="100%" stopColor={stops[2]} />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" fill={`url(#${gradientId})`} />
    </Svg>
  );
}

function PhotoGlyph() {
  return (
    <Svg width={21} height={21} viewBox="0 0 24 24" fill="none">
      <Rect
        x={5}
        y={4.5}
        width={14}
        height={15}
        rx={2.4}
        stroke="#1677D2"
        strokeWidth={2}
      />
      <Circle cx={15.2} cy={8.8} r={1.55} fill="#1677D2" />
      <Path
        d="M6.5 16.9l3.75-4.05a1.35 1.35 0 0 1 1.96-.02l1.28 1.33.62-.72a1.35 1.35 0 0 1 1.98-.05l1.4 1.42"
        stroke="#1677D2"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function VideoPlayGlyph() {
  return (
    <Svg width={15} height={15} viewBox="0 0 18 18">
      <Path d="M6.2 4.15v9.7l7.55-4.86-7.55-4.84z" fill="#746AA8" />
    </Svg>
  );
}

function FileGlyph() {
  return (
    <Svg width={21} height={21} viewBox="0 0 24 24" fill="none">
      <Path
        d="M7 3.8h6.15L18 8.65V19a1.6 1.6 0 0 1-1.6 1.6H7A1.6 1.6 0 0 1 5.4 19V5.4A1.6 1.6 0 0 1 7 3.8z"
        stroke="#59616D"
        strokeWidth={1.9}
        strokeLinejoin="round"
      />
      <Path
        d="M13.1 3.9v4.75H18"
        stroke="#59616D"
        strokeWidth={1.9}
        strokeLinejoin="round"
      />
      <Path
        d="M8.5 12.4h7M8.5 15.7h5.4"
        stroke="#59616D"
        strokeWidth={1.9}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function SyncStatePreviewSection({
  title,
  description,
  items,
}: SyncStatePreviewSectionProps) {
  return (
    <View style={styles.syncStateSection}>
      <Text style={styles.syncStateTitle}>{title}</Text>
      <Text style={styles.syncStateDescription}>{description}</Text>
      <View style={styles.syncStateList}>
        {items.map(item => (
          <View key={item.key} style={styles.syncStateCard}>
            <View
              style={[
                styles.syncStateIconWrap,
                { backgroundColor: item.iconBackground },
              ]}
            >
              <Icon name={item.iconName} size={22} color={item.iconColor} />
            </View>
            <View style={styles.syncStateContent}>
              <View style={styles.syncStateCardHeader}>
                <Text style={styles.syncStateCardTitle}>{item.title}</Text>
                {item.actionLabel ? (
                  <View
                    style={[
                      styles.syncStateActionPill,
                      item.actionTone === 'amber'
                        ? styles.syncStateActionPillAmber
                        : item.actionTone === 'red'
                          ? styles.syncStateActionPillRed
                          : styles.syncStateActionPillBlue,
                    ]}
                  >
                    <Text
                      style={[
                        styles.syncStateActionText,
                        item.actionTone === 'amber'
                          ? styles.syncStateActionTextAmber
                          : item.actionTone === 'red'
                            ? styles.syncStateActionTextRed
                            : styles.syncStateActionTextBlue,
                      ]}
                    >
                      {item.actionLabel}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.syncStateCardDescription}>
                {item.description}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function getRecordPreviewType(record: RecentDownloadRecord): MediaPreviewKind {
  const isVideo =
    record.mediaType === 'video' ||
    /\.(mp4|mov|avi|mkv|webm)$/i.test(record.filename);
  const isImage =
    record.mediaType === 'image' ||
    /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(record.filename);

  if (isVideo) {
    return 'video';
  }

  if (isImage) {
    return 'photo';
  }

  return 'file';
}

function getRecentDownloadThumbnailSource(
  record: RecentDownloadRecord,
  previewType: MediaPreviewKind,
): RecentDownloadThumbnailSource | undefined {
  if (previewType === 'file') {
    return undefined;
  }

  // 1. For images, prefer the local physical file when it has already downloaded locally and has localPath
  if (previewType === 'photo') {
    const localUri = readLocalPathUri(record.localPath);
    if (localUri) {
      return { uri: localUri, renderer: 'image' };
    }
  }

  // 2. Next use the desktop thumbnail for both videos and images
  const thumbnailUrl = readNonEmptyUri(record.thumbnailUrl);
  if (thumbnailUrl) {
    return { uri: thumbnailUrl, renderer: 'image' };
  }

  if (previewType === 'video') {
    return undefined;
  }

  // 3. For image types without a local file, use the remote previewUrl or streamUrl
  const mediaUri =
    readNonEmptyUri(record.previewUrl) ?? readNonEmptyUri(record.streamUrl);
  if (!mediaUri) {
    return undefined;
  }

  return {
    uri: mediaUri,
    renderer: 'image',
  };
}

function readNonEmptyUri(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function readLocalPathUri(
  value: string | null | undefined,
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.startsWith('file://') ? trimmed : `file://${trimmed}`;
}

function formatRecordTimeLabel(record: RecentDownloadRecord) {
  const dateObj = new Date(record.completedAt || record.failedAt || '');
  if (Number.isNaN(dateObj.getTime())) {
    return '';
  }

  const today = new Date();
  if (dateObj.toDateString() === today.toDateString()) {
    return dateObj.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  return `${String(dateObj.getMonth() + 1).padStart(2, '0')}/${String(
    dateObj.getDate(),
  ).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  recentDownloadSection: {
    paddingHorizontal: 20,
    marginTop: 18,
    paddingVertical: 16,
    marginHorizontal: 16,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.62)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.72)',
    shadowColor: '#46608A',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 2,
    ...androidBoxShadow({
      offsetY: 10,
      blurRadius: 24,
      color: 'rgba(70, 96, 138, 0.08)',
    }),
  },
  recentDownloadSurface: {
    marginHorizontal: 20,
    paddingHorizontal: 16,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.58)',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.12,
    shadowRadius: 52,
  },
  recentDownloadHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitleText: {
    fontSize: 15,
    fontWeight: '700',
    color: DARK,
  },
  sectionTitleEmphasis: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
    color: '#17191C',
  },
  recentDownloadViewAll: {
    fontSize: 13,
    fontWeight: '600',
    color: BLUE,
  },
  recentDownloadGrid: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  recentDownloadTile: {
    flex: 1,
    minWidth: 0,
    alignSelf: 'flex-start',
    justifyContent: 'flex-start',
  },
  recentDownloadTileDummy: {
    flex: 1,
    minWidth: 0,
  },
  recentDownloadIconWrap: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
    overflow: 'hidden',
    shadowColor: '#46608A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 1,
    ...androidBoxShadow({
      offsetY: 4,
      blurRadius: 10,
      color: 'rgba(70, 96, 138, 0.08)',
    }),
  },
  mediaPreviewWrap: {
    borderRadius: 14,
    backgroundColor: '#EDF4FB',
    borderWidth: 0,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 1,
    ...androidBoxShadow({
      offsetY: 2,
      blurRadius: 4,
      color: 'rgba(70, 96, 138, 0.08)',
    }),
  },
  recentDownloadThumbnailImage: {
    width: '100%',
    height: '100%',
    borderRadius: 14,
  },
  mediaIcon: {
    flex: 1,
    width: '100%',
    height: '100%',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photoIcon: {
    backgroundColor: '#D8F0FF',
  },
  photoSun: {
    position: 'absolute',
    left: 9,
    top: 9,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.86)',
  },
  photoHillLeft: {
    position: 'absolute',
    left: 3,
    bottom: -2,
    width: 28,
    height: 16,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.62)',
    transform: [{ rotate: '-8deg' }],
  },
  photoHillRight: {
    position: 'absolute',
    right: -1,
    bottom: -2,
    width: 30,
    height: 19,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    backgroundColor: 'rgba(191,227,255,0.78)',
    transform: [{ rotate: '10deg' }],
  },
  videoIcon: {
    backgroundColor: '#E3E6FF',
  },
  videoDotRowTop: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  videoDotRowBottom: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    right: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  videoDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.72)',
  },
  videoDotFaint: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.54)',
  },
  playCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.74)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileIcon: {
    backgroundColor: '#EFF5FB',
  },
  fileCorner: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 12,
    height: 12,
    borderBottomLeftRadius: 8,
    borderLeftWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#C6D2DF',
    backgroundColor: 'rgba(255,255,255,0.76)',
  },
  recentDownloadName: {
    fontSize: 10,
    fontWeight: '600',
    color: '#203D63',
    lineHeight: 13,
  },
  recentDownloadTime: {
    fontSize: 9,
    color: SOFT_TEXT,
    marginTop: 2,
  },
  syncRecordSection: {
    marginHorizontal: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginTop: 18,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.62)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.72)',
    shadowColor: '#46608A',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 2,
    ...androidBoxShadow({
      offsetY: 10,
      blurRadius: 24,
      color: 'rgba(70, 96, 138, 0.08)',
    }),
  },
  syncRecordSurface: {
    marginHorizontal: 20,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.58)',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.12,
    shadowRadius: 52,
  },
  sectionEmptyState: {
    minHeight: 128,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.70)',
    backgroundColor: 'rgba(255,255,255,0.50)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 22,
  },
  sectionEmptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: '#E4F5FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  sectionEmptyTitle: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    color: '#203D63',
    textAlign: 'center',
  },
  sectionEmptyMessage: {
    marginTop: 6,
    fontSize: 11,
    lineHeight: 19,
    color: '#7B8490',
    textAlign: 'center',
  },
  syncTimelineHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 14,
  },
  syncTimelineHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  syncTimelineDayList: {
    gap: 16,
  },
  syncTimelineRecordList: {
    gap: 10,
  },
  syncTimelineTotal: {
    marginTop: 1,
    fontSize: 11,
    lineHeight: 16,
    color: '#59616D',
  },
  syncTimelineDayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  syncTimelineDay: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    color: '#4D6C90',
  },
  syncTimelineDayStats: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '500',
    color: '#9AB0C6',
  },
  syncTimelineRecordCard: {
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: 'rgba(255,255,255,0.52)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
  },
  syncTimelineRecordHeader: {
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  syncTimelineRecordTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  syncTimelineRecordDeviceName: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    color: '#203D63',
  },
  syncTimelineRecordSubtle: {
    marginTop: 1,
    fontSize: 10,
    lineHeight: 14,
    color: '#9AB0C6',
  },
  syncTimelineStatusPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  syncTimelineStatusCompleted: {
    backgroundColor: '#E8F7ED',
  },
  syncTimelineStatusSyncing: {
    backgroundColor: '#EAF2FF',
  },
  syncTimelineStatusText: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '500',
  },
  syncTimelineStatusTextCompleted: {
    color: '#21A453',
  },
  syncTimelineStatusTextSyncing: {
    color: '#357CFF',
  },
  syncTimelineStatsGrid: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  syncTimelineStat: {
    flex: 1,
    minWidth: 0,
  },
  syncTimelineStatRight: {
    alignItems: 'flex-end',
  },
  syncTimelineStatValue: {
    marginTop: 5,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
    color: '#203D63',
  },
  syncStateSection: {
    marginHorizontal: 20,
    marginTop: 20,
  },
  syncStateTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: DARK,
  },
  syncStateDescription: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 20,
    color: SOFT_TEXT,
  },
  syncStateList: {
    gap: 12,
    marginTop: 12,
  },
  syncStateCard: {
    flexDirection: 'row',
    gap: 12,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: 'rgba(255,255,255,0.66)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.74)',
    shadowColor: '#46608A',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.07,
    shadowRadius: 22,
    elevation: 2,
    ...androidBoxShadow({
      offsetY: 10,
      blurRadius: 22,
      color: 'rgba(70, 96, 138, 0.07)',
    }),
  },
  syncStateIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncStateContent: {
    flex: 1,
    minWidth: 0,
  },
  syncStateCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  syncStateCardTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
    color: DARK,
  },
  syncStateCardDescription: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 20,
    color: SOFT_TEXT,
  },
  syncStateActionPill: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  syncStateActionPillBlue: {
    backgroundColor: '#EAF2FF',
  },
  syncStateActionPillAmber: {
    backgroundColor: '#FFF4DC',
  },
  syncStateActionPillRed: {
    backgroundColor: '#FFECEC',
  },
  syncStateActionText: {
    fontSize: 10,
    fontWeight: '700',
  },
  syncStateActionTextBlue: {
    color: BLUE,
  },
  syncStateActionTextAmber: {
    color: '#C27803',
  },
  syncStateActionTextRed: {
    color: '#EF4444',
  },
});
