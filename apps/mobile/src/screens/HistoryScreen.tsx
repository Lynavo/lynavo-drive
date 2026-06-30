import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  NativeModules,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useTranslation } from 'react-i18next';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { colors } from '../theme/colors';
import { formatBytes } from '../utils/format';
import { Icon } from '../components/Icon';
import { GradientBackground } from '../components/GradientBackground';
import { BottomTabBar } from '../components/BottomTabBar';
import { listHistory, downloadResource } from '../services/desktop-local-service';
import type { DesktopSyncRecordDTO } from '@lynavo-drive/contracts';

type NavigationProp = StackNavigationProp<RootStackParamList, 'History'>;

export function HistoryScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [historyItems, setHistoryItems] = useState<DesktopSyncRecordDTO[]>([]);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      const { NativeSyncEngine } = NativeModules;
      if (!NativeSyncEngine) {
        setLoading(false);
        return;
      }

      const binding = await NativeSyncEngine.getBindingState();
      if (!binding || !binding.host) {
        setHistoryItems([]);
        setLoading(false);
        return;
      }

      const desktop = { host: binding.host, port: 39394 };
      const result = await listHistory(desktop);
      // Filter out files that were completed successfully
      const completedFiles = (result || []).filter(item => item.status === 'completed');
      setHistoryItems(completedFiles);
    } catch (e) {
      console.warn('[HistoryScreen] Failed to load history:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      loadHistory();
    }, [loadHistory])
  );

  const handleDownload = useCallback(
    async (fileKey: string, filename: string) => {
      if (downloadingId) return;
      setDownloadingId(fileKey);

      try {
        const { NativeSyncEngine } = NativeModules;
        const binding = await NativeSyncEngine?.getBindingState();
        if (!binding || !binding.host) {
          Alert.alert(t('sharedFiles.deviceUnavailable.title') || '設備不可用');
          return;
        }

        const desktop = { host: binding.host, port: 39394 };
        await downloadResource(desktop, fileKey);

        Alert.alert(
          t('sharedFiles.dialogs.downloadComplete') || '下載完成',
          t('sharedFiles.dialogs.downloadSavedToPhotos', {
            name: filename,
            location: t('sharedFiles.dialogs.savedLocationPhotos') || '相簿',
          }) ||
            `${filename} 已儲存至相簿`
        );
      } catch (err) {
        console.warn('[HistoryScreen] Download failed:', err);
        Alert.alert(
          t('sharedFiles.dialogs.downloadFailed') || '下載失敗',
          t('sharedFiles.dialogs.downloadFailedMessage') ||
            '無法下載檔案，請稍後重試'
        );
      } finally {
        setDownloadingId(null);
      }
    },
    [downloadingId, t]
  );

  const getFileIcon = (mediaType: string, filename: string) => {
    const isVideo = mediaType === 'video' || /\.(mp4|mov|avi|mkv|webm)$/i.test(filename);
    const isImage = mediaType === 'image' || /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(filename);
    if (isVideo) {
      return { name: 'play', color: '#8b5cf6', bg: 'rgba(139,92,246,0.08)' };
    }
    if (isImage) {
      return { name: 'image', color: '#3b82f6', bg: 'rgba(59,130,246,0.08)' };
    }
    return { name: 'document-text', color: '#10b981', bg: 'rgba(16,185,129,0.08)' };
  };

  const getFileTypeText = (mediaType: string, filename: string) => {
    const isVideo = mediaType === 'video' || /\.(mp4|mov|avi|mkv|webm)$/i.test(filename);
    const isImage = mediaType === 'image' || /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(filename);
    if (isVideo) return '視頻';
    if (isImage) return '照片';
    return '文件';
  };

  const formatItemTime = (isoString?: string) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return '';

    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    const timeString = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

    if (date.toDateString() === today.toDateString()) {
      return `今天 ${timeString}`;
    }
    if (date.toDateString() === yesterday.toDateString()) {
      return `昨天 ${timeString}`;
    }
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${timeString}`;
  };

  const renderItem = ({ item }: { item: DesktopSyncRecordDTO }) => {
    const iconConfig = getFileIcon(item.mediaType, item.filename);
    const fileType = getFileTypeText(item.mediaType, item.filename);
    const formattedTime = formatItemTime(item.completedAt || item.failedAt);
    const isDownloading = downloadingId === item.fileKey;

    return (
      <View style={styles.card}>
        <View style={[styles.iconWrapper, { backgroundColor: iconConfig.bg }]}>
          <Icon name={iconConfig.name} size={20} color={iconConfig.color} />
        </View>

        <View style={styles.infoWrapper}>
          <Text style={styles.fileName} numberOfLines={1}>
            {item.filename}
          </Text>
          <Text style={styles.fileMeta}>
            {`${fileType} · ${formatBytes(item.fileSize)}`}
          </Text>
          {formattedTime ? <Text style={styles.fileTime}>{formattedTime}</Text> : null}
        </View>

        <TouchableOpacity
          style={styles.downloadButton}
          activeOpacity={0.7}
          disabled={isDownloading}
          onPress={() => handleDownload(item.fileKey, item.filename)}
        >
          {isDownloading ? (
            <ActivityIndicator size="small" color="#3b82f6" />
          ) : (
            <Icon name="download-outline" size={18} color="#3b82f6" />
          )}
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <GradientBackground>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
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
                  navigation.reset({ index: 0, routes: [{ name: 'SyncActivity' }] });
                }
              }}
              accessibilityLabel={t('common.back')}
            >
              <Icon name="chevron-back" size={20} color={colors.screenTitle} />
            </TouchableOpacity>
            <Text style={styles.title}>最近下載</Text>
          </View>

          {/* Content */}
          {loading ? (
            <View style={styles.centerSection}>
              <ActivityIndicator size="large" color="#3b9fd8" />
            </View>
          ) : (
            <FlatList
              data={historyItems}
              renderItem={renderItem}
              keyExtractor={item => item.recordId}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Icon name="cloud-download-outline" size={48} color="#b0c8da" />
                  <Text style={styles.emptyText}>暫無下載記錄</Text>
                </View>
              }
            />
          )}
        </View>
      </SafeAreaView>
      <BottomTabBar activeTab="home" />
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
    gap: 12,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: 'rgba(120,172,210,0.12)',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 2,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1c304a',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
    shadowColor: 'rgba(0,0,0,0.03)',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 1,
    shadowRadius: 12,
    elevation: 1,
  },
  iconWrapper: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoWrapper: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  fileName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a3a5c',
  },
  fileMeta: {
    fontSize: 11,
    color: '#8fa0b5',
    marginTop: 4,
  },
  fileTime: {
    fontSize: 10,
    color: '#a0aec0',
    marginTop: 3,
  },
  downloadButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(59,130,246,0.06)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  centerSection: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 120,
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    color: '#8fa0b5',
  },
});
