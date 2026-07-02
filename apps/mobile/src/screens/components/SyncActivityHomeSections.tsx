import React from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { TFunction } from 'i18next';
import type { DesktopSyncRecordDTO } from '@lynavo-drive/contracts';
import { colors } from '../../theme/colors';
import { Icon } from '../../components/Icon';
import { formatBytes } from '../../utils/format';

const BLUE = colors.accent;
const DARK = colors.primary;
const SOFT_TEXT = colors.secondaryForeground;

export interface RecentDownloadPlaceholder {
  key: string;
  label: string;
  iconName: string;
  iconColor: string;
  iconBackground: string;
}

interface RecentDownloadsSectionProps {
  records: DesktopSyncRecordDTO[];
  placeholders: RecentDownloadPlaceholder[];
  t: TFunction;
  onPressViewAll: () => void;
}

interface SyncRecordSummarySectionProps {
  boundDeviceName: string;
  fileCount: number;
  isSyncing: boolean;
  t: TFunction;
  totalBytes: number;
}

export function RecentDownloadsSection({
  records,
  placeholders,
  t,
  onPressViewAll,
}: RecentDownloadsSectionProps) {
  return (
    <View style={styles.recentDownloadSection}>
      <View style={styles.recentDownloadHeader}>
        <View style={styles.sectionTitleRow}>
          <Icon name="download-outline" size={18} color={DARK} />
          <Text style={styles.sectionTitleText}>
            {t('syncActivity.home.recentDownloadsTitle')}
          </Text>
        </View>
        <TouchableOpacity onPress={onPressViewAll} activeOpacity={0.7}>
          <Text style={styles.recentDownloadViewAll}>
            {t('syncActivity.recentDownload.viewAll') || 'View All'}
          </Text>
        </TouchableOpacity>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.recentDownloadList}
        contentContainerStyle={styles.recentDownloadListContent}
      >
        {records.length > 0
          ? records.map(rec => {
              const metadata = getRecordVisualMetadata(rec);
              const timeLabel = formatRecordTimeLabel(rec);

              return (
                <View key={rec.recordId} style={styles.recentDownloadCard}>
                  <View
                    style={[
                      styles.recentDownloadIconWrap,
                      { backgroundColor: metadata.iconBackground },
                    ]}
                  >
                    <Icon
                      name={metadata.iconName}
                      size={26}
                      color={metadata.iconColor}
                    />
                  </View>
                  <Text style={styles.recentDownloadName} numberOfLines={2}>
                    {rec.filename}
                  </Text>
                  {timeLabel ? (
                    <Text style={styles.recentDownloadTime}>{timeLabel}</Text>
                  ) : null}
                </View>
              );
            })
          : placeholders.map(item => (
              <View key={item.key} style={styles.recentDownloadCard}>
                <View
                  style={[
                    styles.recentDownloadIconWrap,
                    { backgroundColor: item.iconBackground },
                  ]}
                >
                  <Icon name={item.iconName} size={26} color={item.iconColor} />
                </View>
                <Text style={styles.recentDownloadName}>{item.label}</Text>
              </View>
            ))}
      </ScrollView>
    </View>
  );
}

export function SyncRecordSummarySection({
  boundDeviceName,
  fileCount,
  isSyncing,
  t,
  totalBytes,
}: SyncRecordSummarySectionProps) {
  return (
    <View style={styles.syncRecordSection}>
      <View style={styles.syncRecordHeader}>
        <View style={styles.sectionTitleRow}>
          <Icon name="time-outline" size={18} color={DARK} />
          <Text style={styles.sectionTitleText}>
            {t('syncActivity.home.syncRecordsTitle')}
          </Text>
        </View>
        <Text style={styles.syncRecordTotal}>
          {t('syncActivity.home.syncRecordTotal', {
            size: formatBytes(totalBytes),
          })}
        </Text>
      </View>
      <View style={styles.syncRecordDayRow}>
        <Text style={styles.syncRecordDay}>{t('syncActivity.home.today')}</Text>
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
    </View>
  );
}

function getRecordVisualMetadata(record: DesktopSyncRecordDTO) {
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
    };
  }

  if (isImage) {
    return {
      iconName: 'image-outline',
      iconColor: BLUE,
      iconBackground: 'rgba(59,130,246,0.1)',
    };
  }

  return {
    iconName: 'document-outline',
    iconColor: '#10b981',
    iconBackground: 'rgba(16,185,129,0.1)',
  };
}

function formatRecordTimeLabel(record: DesktopSyncRecordDTO) {
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
  recentDownloadViewAll: {
    fontSize: 13,
    fontWeight: '600',
    color: BLUE,
  },
  recentDownloadList: {
    marginRight: -20,
  },
  recentDownloadListContent: {
    gap: 10,
    paddingRight: 20,
  },
  recentDownloadCard: {
    width: 100,
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#4f8fbc',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.07,
    shadowRadius: 12,
    elevation: 2,
  },
  recentDownloadIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  recentDownloadName: {
    fontSize: 11,
    fontWeight: '600',
    color: DARK,
    textAlign: 'center',
    lineHeight: 15,
  },
  recentDownloadTime: {
    fontSize: 10,
    color: SOFT_TEXT,
    marginTop: 4,
    textAlign: 'center',
  },
  syncRecordSection: {
    paddingHorizontal: 20,
    marginTop: 18,
  },
  syncRecordHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  syncRecordTotal: {
    fontSize: 12,
    fontWeight: '600',
    color: SOFT_TEXT,
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
  syncRecordCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: 12,
    borderRadius: 18,
    padding: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#4f8fbc',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 2,
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
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  syncRecordStatValue: {
    marginTop: 4,
    fontSize: 14,
    fontWeight: '700',
    color: DARK,
  },
});
