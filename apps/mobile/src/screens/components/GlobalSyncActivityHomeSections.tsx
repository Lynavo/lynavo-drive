import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Video from 'react-native-video';
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Path,
  Rect,
  Stop,
} from 'react-native-svg';
import { ArrowDownCircle } from 'lucide-react-native';
import type { TFunction } from 'i18next';
import { colors } from '../../theme/colors';
import { Icon } from '../../components/Icon';
import { formatBytes } from '../../utils/format';

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

export interface RecentDownloadPlaceholder {
  key: string;
  label: string;
  iconName: string;
  iconColor: string;
  iconBackground: string;
  previewType?: GlobalMediaPreviewKind;
}

interface RecentDownloadsSectionProps {
  records: RecentDownloadRecord[];
  placeholders: RecentDownloadPlaceholder[];
  t: TFunction;
  onPressViewAll: () => void;
  title?: string;
  viewAllLabel?: string;
  sectionIconColor?: string;
  sectionIconName?: string;
  variant?: 'default' | 'globalPreview';
}

interface SyncRecordSummarySectionProps {
  boundDeviceName: string;
  fileCount: number;
  isSyncing: boolean;
  t: TFunction;
  totalBytes: number;
  variant?: 'default' | 'globalPreview';
}

export interface GlobalSyncRecordTimelineItem {
  id: string;
  deviceName: string;
  duration: string;
  fileCount: number;
  status: 'syncing' | 'completed';
  totalSize: string;
}

export interface GlobalSyncRecordTimelineDay {
  key: string;
  label: string;
  records: GlobalSyncRecordTimelineItem[];
  totalFiles: number;
  totalSize: string;
}

interface GlobalSyncRecordTimelineSectionProps {
  days: GlobalSyncRecordTimelineDay[];
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

type GlobalMediaPreviewKind = 'photo' | 'video' | 'file';
type RecentDownloadThumbnailSource = {
  uri: string;
  renderer: 'image' | 'video';
};

const GLOBAL_SECTION_EMPTY_ALIGNMENT_STYLE = {
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
};

function GlobalSectionEmptyState({
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
      style={[
        styles.globalSectionEmptyState,
        GLOBAL_SECTION_EMPTY_ALIGNMENT_STYLE,
      ]}
    >
      <View style={styles.globalSectionEmptyIcon}>
        <Icon name={iconName} size={24} color={BLUE} />
      </View>
      <Text style={styles.globalSectionEmptyTitle}>{title}</Text>
      <Text style={styles.globalSectionEmptyMessage}>{message}</Text>
    </View>
  );
}

export function RecentDownloadsSection({
  records,
  placeholders,
  t,
  onPressViewAll,
  title,
  viewAllLabel,
  sectionIconColor,
  sectionIconName,
  variant = 'default',
}: RecentDownloadsSectionProps) {
  const isGlobalPreview = variant === 'globalPreview';
  const isGlobalEmpty = isGlobalPreview && records.length === 0;
  const recentItems =
    records.length > 0
      ? records.slice(0, 4).map(rec => {
          const metadata = getRecordVisualMetadata(rec);
          return {
            key: rec.recordId,
            label: rec.filename,
            meta: formatRecordTimeLabel(rec),
            iconName: metadata.iconName,
            iconColor: metadata.iconColor,
            iconBackground: metadata.iconBackground,
            previewType: metadata.previewType,
            thumbnailSource: getRecentDownloadThumbnailSource(
              rec,
              metadata.previewType,
            ),
          };
        })
      : placeholders.slice(0, 4).map(item => ({
          key: item.key,
          label: item.label,
          meta: '',
          iconName: item.iconName,
          iconColor: item.iconColor,
          iconBackground: item.iconBackground,
          previewType: item.previewType,
          thumbnailSource: undefined,
        }));

  return (
    <View
      style={[
        styles.recentDownloadSection,
        isGlobalPreview && styles.globalRecentDownloadSection,
      ]}
    >
      <View style={styles.recentDownloadHeader}>
        <View style={styles.sectionTitleRow}>
          {isGlobalPreview ? (
            <ArrowDownCircle
              testID="global-recent-download-title-icon"
              size={18}
              color={sectionIconColor ?? BLUE}
              strokeWidth={1.9}
            />
          ) : (
            <Icon
              name={sectionIconName ?? 'download-outline'}
              size={18}
              color={sectionIconColor ?? DARK}
            />
          )}
          <Text
            style={[
              styles.sectionTitleText,
              isGlobalPreview && styles.globalSectionTitleText,
            ]}
          >
            {title ?? t('syncActivity.home.recentDownloadsTitle')}
          </Text>
        </View>
        <TouchableOpacity onPress={onPressViewAll} activeOpacity={0.7}>
          <Text style={styles.recentDownloadViewAll}>
            {viewAllLabel ??
              (t('syncActivity.recentDownload.viewAll') || '查看全部')}
          </Text>
        </TouchableOpacity>
      </View>
      {isGlobalEmpty ? (
        <GlobalSectionEmptyState
          testID="recent-download-empty-state"
          iconName="cloud-download-outline"
          title="暂无最近下载"
          message="从电脑下载到本机的文件会出现在这里。"
        />
      ) : (
        <View style={styles.recentDownloadGrid}>
          {recentItems.map(item => (
            <View key={item.key} style={styles.recentDownloadTile}>
              <View
                style={[
                  styles.recentDownloadIconWrap,
                  isGlobalPreview
                    ? styles.globalMediaPreviewWrap
                    : { backgroundColor: item.iconBackground },
                ]}
              >
                {isGlobalPreview ? (
                  <RecentDownloadPreview
                    label={item.label}
                    thumbnailSource={item.thumbnailSource}
                    type={
                      item.previewType ?? getPreviewTypeFromIcon(item.iconName)
                    }
                  />
                ) : (
                  <Icon name={item.iconName} size={28} color={item.iconColor} />
                )}
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
}: {
  label: string;
  thumbnailSource?: RecentDownloadThumbnailSource;
  type: GlobalMediaPreviewKind;
}) {
  const [thumbnailFailed, setThumbnailFailed] = React.useState(false);

  if (
    thumbnailSource &&
    !thumbnailFailed &&
    thumbnailSource.renderer === 'image'
  ) {
    return (
      <Image
        testID="recent-download-thumbnail-image"
        source={{ uri: thumbnailSource.uri }}
        style={styles.recentDownloadThumbnailImage}
        resizeMode="cover"
        accessibilityLabel={`${label} 縮圖`}
        onError={() => setThumbnailFailed(true)}
      />
    );
  }

  if (
    thumbnailSource &&
    !thumbnailFailed &&
    thumbnailSource.renderer === 'video'
  ) {
    return (
      <Video
        testID="recent-download-thumbnail-video"
        source={{ uri: thumbnailSource.uri }}
        style={styles.recentDownloadThumbnailImage}
        resizeMode="cover"
        paused
        muted
        onError={() => setThumbnailFailed(true)}
      />
    );
  }

  return <GlobalMediaPreviewIcon type={type} />;
}

export function SyncRecordSummarySection({
  boundDeviceName,
  fileCount,
  isSyncing,
  t,
  totalBytes,
  variant = 'default',
}: SyncRecordSummarySectionProps) {
  const isGlobalPreview = variant === 'globalPreview';
  const shouldRenderGlobalEmpty =
    isGlobalPreview && !isSyncing && fileCount === 0 && totalBytes === 0;

  return (
    <View
      style={[
        styles.syncRecordSection,
        isGlobalPreview && styles.globalSyncRecordSection,
      ]}
    >
      <View style={styles.syncRecordHeader}>
        <View style={styles.sectionTitleRow}>
          <Icon
            name="time-outline"
            size={18}
            color={isGlobalPreview ? '#746AA8' : DARK}
          />
          <Text
            style={[
              styles.sectionTitleText,
              isGlobalPreview && styles.globalSectionTitleText,
            ]}
          >
            {t('syncActivity.home.syncRecordsTitle')}
          </Text>
        </View>
        <Text style={styles.syncRecordTotal}>
          {t('syncActivity.home.syncRecordTotal', {
            size: formatBytes(totalBytes),
          })}
        </Text>
      </View>
      {shouldRenderGlobalEmpty ? (
        <GlobalSectionEmptyState
          testID="sync-record-empty-state"
          iconName="time-outline"
          title="暂无同步记录"
          message="完成第一次自动同步后，记录会按电脑完成日期显示在这里。"
        />
      ) : (
        <>
          <View style={styles.syncRecordDayRow}>
            <Text style={styles.syncRecordDay}>
              {t('syncActivity.home.today')}
            </Text>
            <Text style={styles.syncRecordDayStats}>
              {t('syncActivity.home.todayStats', {
                count: fileCount,
                size: formatBytes(totalBytes),
              })}
            </Text>
          </View>
          <View style={styles.syncRecordCard}>
            <View>
              <Text style={styles.syncRecordDeviceName}>{boundDeviceName}</Text>
              <Text style={styles.syncRecordSubtle}>
                {t('syncActivity.home.todaySyncRecord')}
              </Text>
            </View>
            <View style={styles.syncRecordStatusPill}>
              <Text style={styles.syncRecordStatusText}>
                {isSyncing
                  ? t('syncActivity.home.syncing')
                  : t('syncActivity.home.synced')}
              </Text>
            </View>
            <View style={styles.syncRecordStatsRow}>
              <View style={styles.syncRecordStat}>
                <Text style={styles.syncRecordSubtle}>
                  {t('syncActivity.home.uploadFiles')}
                </Text>
                <Text style={styles.syncRecordStatValue}>
                  {t('syncActivity.stats.transferredCount', {
                    count: fileCount,
                  })}
                </Text>
              </View>
              <View style={styles.syncRecordStat}>
                <Text style={styles.syncRecordSubtle}>
                  {t('syncActivity.stats.dataAmount')}
                </Text>
                <Text style={styles.syncRecordStatValue}>
                  {formatBytes(totalBytes)}
                </Text>
              </View>
            </View>
          </View>
        </>
      )}
    </View>
  );
}

export function GlobalSyncRecordTimelineSection({
  days,
  totalSyncedSize,
}: GlobalSyncRecordTimelineSectionProps) {
  const shouldRenderEmpty = days.length === 0;

  return (
    <View style={[styles.syncRecordSection, styles.globalSyncRecordSection]}>
      <View style={styles.globalSyncTimelineHeader}>
        <Icon name="time-outline" size={18} color="#746AA8" />
        <View style={styles.globalSyncTimelineHeaderCopy}>
          <Text
            style={[styles.sectionTitleText, styles.globalSectionTitleText]}
          >
            同步记录
          </Text>
          <Text style={styles.globalSyncRecordTotal}>
            累计已同步 {totalSyncedSize} 文件
          </Text>
        </View>
      </View>

      {shouldRenderEmpty ? (
        <GlobalSectionEmptyState
          testID="global-sync-record-empty-state"
          iconName="time-outline"
          title="暂无同步记录"
          message="完成第一次自动同步后，记录会按电脑完成日期显示在这里。"
        />
      ) : (
        <View style={styles.globalSyncTimelineDayList}>
          {days.slice(0, 3).map(day => (
            <View key={day.key}>
              <View style={styles.globalSyncRecordDayRow}>
                <Text style={styles.globalSyncRecordDay}>{day.label}</Text>
                <Text style={styles.globalSyncRecordDayStats}>
                  {day.totalFiles} 个 · {day.totalSize}
                </Text>
              </View>
              <View style={styles.globalSyncTimelineRecordList}>
                {day.records.map(record => {
                  const isCompleted = record.status === 'completed';
                  return (
                    <View key={record.id} style={styles.globalSyncRecordCard}>
                      <View style={styles.globalSyncRecordHeader}>
                        <View style={styles.globalSyncRecordTitleBlock}>
                          <Text
                            style={styles.globalSyncRecordDeviceName}
                            numberOfLines={1}
                          >
                            {record.deviceName}
                          </Text>
                          <Text style={styles.globalSyncRecordSubtle}>
                            当天同步记录
                          </Text>
                        </View>
                        <View
                          style={[
                            styles.globalSyncRecordStatusPill,
                            isCompleted
                              ? styles.globalSyncRecordStatusCompleted
                              : styles.globalSyncRecordStatusSyncing,
                          ]}
                        >
                          <Text
                            style={[
                              styles.globalSyncRecordStatusText,
                              isCompleted
                                ? styles.globalSyncRecordStatusTextCompleted
                                : styles.globalSyncRecordStatusTextSyncing,
                            ]}
                          >
                            {isCompleted ? '已完成' : '同步中'}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.globalSyncRecordStatsGrid}>
                        <View style={styles.globalSyncRecordStat}>
                          <Text style={styles.globalSyncRecordSubtle}>
                            上传文件
                          </Text>
                          <Text style={styles.globalSyncRecordStatValue}>
                            {record.fileCount} 个
                          </Text>
                        </View>
                        <View style={styles.globalSyncRecordStat}>
                          <Text style={styles.globalSyncRecordSubtle}>
                            总大小
                          </Text>
                          <Text style={styles.globalSyncRecordStatValue}>
                            {record.totalSize}
                          </Text>
                        </View>
                        <View
                          style={[
                            styles.globalSyncRecordStat,
                            styles.globalSyncRecordStatRight,
                          ]}
                        >
                          <Text style={styles.globalSyncRecordSubtle}>
                            耗时
                          </Text>
                          <Text style={styles.globalSyncRecordStatValue}>
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

export function GlobalMediaPreviewIcon({
  type,
}: {
  type: GlobalMediaPreviewKind;
}) {
  if (type === 'photo') {
    return (
      <View style={[styles.globalMediaIcon, styles.globalPhotoIcon]}>
        <GlobalMediaIconGradient type="photo" />
        <View style={styles.globalPhotoSun} />
        <View style={styles.globalPhotoHillLeft} />
        <View style={styles.globalPhotoHillRight} />
        <PhotoGlyph />
      </View>
    );
  }

  if (type === 'video') {
    return (
      <View style={[styles.globalMediaIcon, styles.globalVideoIcon]}>
        <GlobalMediaIconGradient type="video" />
        <View style={styles.globalVideoDotRowTop}>
          {[0, 1, 2].map(item => (
            <View key={item} style={styles.globalVideoDot} />
          ))}
        </View>
        <View style={styles.globalPlayCircle}>
          <VideoPlayGlyph />
        </View>
        <View style={styles.globalVideoDotRowBottom}>
          {[0, 1, 2].map(item => (
            <View key={item} style={styles.globalVideoDotFaint} />
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.globalMediaIcon, styles.globalFileIcon]}>
      <GlobalMediaIconGradient type="file" />
      <View style={styles.globalFileCorner} />
      <FileGlyph />
    </View>
  );
}

function GlobalMediaIconGradient({ type }: { type: GlobalMediaPreviewKind }) {
  const stops =
    type === 'photo'
      ? ['#F7FCFF', '#D8F0FF', '#9FD6FF']
      : type === 'video'
        ? ['#F8F6FF', '#E3E6FF', '#9AAEFF']
        : ['#FFFFFF', '#EFF5FB', '#D7E2F0'];
  const gradientId = `globalHome${type}MediaGradient`;

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

function getRecordVisualMetadata(record: RecentDownloadRecord) {
  const isVideo =
    record.mediaType === 'video' ||
    /\.(mp4|mov|avi|mkv|webm)$/i.test(record.filename);
  const isImage =
    record.mediaType === 'image' ||
    /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(record.filename);

  if (isVideo) {
    return {
      iconName: 'videocam-outline',
      iconColor: '#8b5cf6',
      iconBackground: 'rgba(139,92,246,0.1)',
      previewType: 'video' as const,
    };
  }

  if (isImage) {
    return {
      iconName: 'image-outline',
      iconColor: BLUE,
      iconBackground: 'rgba(59,130,246,0.1)',
      previewType: 'photo' as const,
    };
  }

  return {
    iconName: 'document-outline',
    iconColor: '#10b981',
    iconBackground: 'rgba(16,185,129,0.1)',
    previewType: 'file' as const,
  };
}

function getPreviewTypeFromIcon(iconName: string): GlobalMediaPreviewKind {
  if (iconName === 'image-outline') {
    return 'photo';
  }
  if (iconName === 'play-circle-outline' || iconName === 'videocam-outline') {
    return 'video';
  }
  return 'file';
}

function getRecentDownloadThumbnailSource(
  record: RecentDownloadRecord,
  previewType: GlobalMediaPreviewKind,
): RecentDownloadThumbnailSource | undefined {
  if (previewType === 'file') {
    return undefined;
  }

  const thumbnailUrl = readNonEmptyUri(record.thumbnailUrl);
  if (thumbnailUrl) {
    return { uri: thumbnailUrl, renderer: 'image' };
  }

  const mediaUri =
    readNonEmptyUri(record.previewUrl) ??
    readNonEmptyUri(record.streamUrl) ??
    readLocalPathUri(record.localPath);
  if (!mediaUri) {
    return undefined;
  }

  return {
    uri: mediaUri,
    renderer: previewType === 'video' ? 'video' : 'image',
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
  },
  globalRecentDownloadSection: {
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
  globalSectionTitleText: {
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
  },
  globalMediaPreviewWrap: {
    borderRadius: 14,
    backgroundColor: '#EDF4FB',
    borderWidth: 0,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 1,
  },
  recentDownloadThumbnailImage: {
    width: '100%',
    height: '100%',
    borderRadius: 14,
  },
  globalMediaIcon: {
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
  globalPhotoIcon: {
    backgroundColor: '#D8F0FF',
  },
  globalPhotoSun: {
    position: 'absolute',
    left: 9,
    top: 9,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.86)',
  },
  globalPhotoHillLeft: {
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
  globalPhotoHillRight: {
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
  globalVideoIcon: {
    backgroundColor: '#E3E6FF',
  },
  globalVideoDotRowTop: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  globalVideoDotRowBottom: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    right: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  globalVideoDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.72)',
  },
  globalVideoDotFaint: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.54)',
  },
  globalPlayCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.74)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  globalFileIcon: {
    backgroundColor: '#EFF5FB',
  },
  globalFileCorner: {
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
  },
  globalSyncRecordSection: {
    marginHorizontal: 20,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.58)',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.12,
    shadowRadius: 52,
  },
  globalSectionEmptyState: {
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
  globalSectionEmptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: '#E4F5FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  globalSectionEmptyTitle: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    color: '#203D63',
    textAlign: 'center',
  },
  globalSectionEmptyMessage: {
    marginTop: 6,
    fontSize: 11,
    lineHeight: 19,
    color: '#7B8490',
    textAlign: 'center',
  },
  syncRecordHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  globalSyncTimelineHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 14,
  },
  globalSyncTimelineHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  globalSyncTimelineDayList: {
    gap: 16,
  },
  globalSyncTimelineRecordList: {
    gap: 10,
  },
  syncRecordTotal: {
    fontSize: 12,
    fontWeight: '600',
    color: SOFT_TEXT,
  },
  globalSyncRecordTotal: {
    marginTop: 1,
    fontSize: 11,
    lineHeight: 16,
    color: '#59616D',
  },
  syncRecordDayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  syncRecordDay: {
    fontSize: 13,
    fontWeight: '700',
    color: DARK,
  },
  syncRecordDayStats: {
    fontSize: 12,
    color: SOFT_TEXT,
  },
  globalSyncRecordDayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  globalSyncRecordDay: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    color: '#4D6C90',
  },
  globalSyncRecordDayStats: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '500',
    color: '#9AB0C6',
  },
  globalSyncRecordCard: {
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: 'rgba(255,255,255,0.52)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
  },
  globalSyncRecordHeader: {
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  globalSyncRecordTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  globalSyncRecordDeviceName: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    color: '#203D63',
  },
  globalSyncRecordSubtle: {
    marginTop: 1,
    fontSize: 10,
    lineHeight: 14,
    color: '#9AB0C6',
  },
  globalSyncRecordStatusPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  globalSyncRecordStatusCompleted: {
    backgroundColor: '#E8F7ED',
  },
  globalSyncRecordStatusSyncing: {
    backgroundColor: '#EAF2FF',
  },
  globalSyncRecordStatusText: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '500',
  },
  globalSyncRecordStatusTextCompleted: {
    color: '#21A453',
  },
  globalSyncRecordStatusTextSyncing: {
    color: '#357CFF',
  },
  globalSyncRecordStatsGrid: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  globalSyncRecordStat: {
    flex: 1,
    minWidth: 0,
  },
  globalSyncRecordStatRight: {
    alignItems: 'flex-end',
  },
  globalSyncRecordStatValue: {
    marginTop: 5,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
    color: '#203D63',
  },
  syncRecordCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: 12,
    borderRadius: 14,
    padding: 16,
    backgroundColor: 'rgba(255,255,255,0.52)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
  },
  syncRecordDeviceName: {
    fontSize: 15,
    fontWeight: '700',
    color: DARK,
  },
  syncRecordSubtle: {
    fontSize: 11,
    color: SOFT_TEXT,
  },
  syncRecordStatusPill: {
    marginLeft: 'auto',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: 'rgba(34,197,94,0.12)',
  },
  syncRecordStatusText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#16a34a',
  },
  syncRecordStatsRow: {
    width: '100%',
    flexDirection: 'row',
    gap: 10,
  },
  syncRecordStat: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(247,251,255,0.78)',
    borderWidth: 1,
    borderColor: 'rgba(221,232,244,0.78)',
  },
  syncRecordStatValue: {
    marginTop: 4,
    fontSize: 14,
    fontWeight: '700',
    color: DARK,
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
