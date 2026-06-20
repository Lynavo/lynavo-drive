import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { viewDocument } from '@react-native-documents/viewer';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import Video from 'react-native-video';

import { GlobalGradientBackground } from '../components/GlobalGradientBackground';
import { Icon } from '../components/Icon';
import { isVisualQaEnabled } from '../dev/visualQa';
import { getVisualQaDownloadRecords } from '../dev/visualQaMockData';
import type { RootStackParamList } from '../navigation/RootNavigator';
import {
  listDownloadRecords,
  type DownloadRecord,
} from '../services/download-records-service';
import { colors } from '../theme/globalColors';
import { androidBoxShadow } from '../utils/androidShadow';
import {
  canPreviewDocumentFile,
  documentMimeType,
  documentPreviewUri,
  isImageFile,
  isVideoFile,
  openFileWithOtherApp,
} from '../utils/file-preview';
import { formatBytes } from '../utils/format';
import { GlobalMediaPreviewIcon } from './components/GlobalSyncActivityHomeSections';

type NavigationProp = StackNavigationProp<
  RootStackParamList,
  'DownloadRecords'
>;
type PreviewKind = 'photo' | 'video' | 'file';
type DownloadPreviewState = {
  record: DownloadRecord;
  url: string;
};

const BLUE = colors.accent;

export function DownloadRecordsGlobalScreen() {
  const navigation = useNavigation<NavigationProp>();
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<DownloadRecord[]>([]);
  const [preview, setPreview] = useState<DownloadPreviewState | null>(null);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    try {
      const nextRecords = await listDownloadRecords();
      if (nextRecords.length > 0) {
        setRecords(nextRecords);
        return;
      }

      setRecords(isVisualQaEnabled() ? getVisualQaDownloadRecords() : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadRecords();
    }, [loadRecords]),
  );

  const goBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.reset({ index: 0, routes: [{ name: 'SyncActivity' }] });
  }, [navigation]);

  const handleOpenRecord = useCallback(async (record: DownloadRecord) => {
    const kind = getDownloadRecordPreviewKind(record);
    const previewUrl = getDownloadRecordPreviewUri(record);

    if (kind === 'photo' || kind === 'video') {
      if (!previewUrl) {
        Alert.alert('無法預覽', '這筆紀錄沒有可用的本機或預覽來源。');
        return;
      }
      setPreview({ record, url: previewUrl });
      return;
    }

    if (!record.localPath) {
      Alert.alert('無法開啟', '這筆紀錄沒有可用的本機檔案。');
      return;
    }

    try {
      if (!canPreviewDocumentFile(record.mediaType, record.filename)) {
        await openFileWithOtherApp(record.localPath, record.filename);
        return;
      }

      await viewDocument({
        uri: documentPreviewUri(record.localPath),
        headerTitle: record.filename,
        mimeType: documentMimeType(record.filename),
      });
    } catch (err) {
      console.warn('[DownloadRecordsGlobalScreen] Preview failed:', err);
      Alert.alert('預覽失敗', '無法取得檔案預覽。');
    }
  }, []);

  const handleDownloadPress = useCallback(async (record: DownloadRecord) => {
    if (!record.localPath) {
      Alert.alert(
        '無法重新下載',
        '這筆紀錄沒有可用的本機檔案，也沒有足夠的遠端路由資訊可重新下載。',
      );
      return;
    }

    try {
      await openFileWithOtherApp(record.localPath, record.filename);
    } catch (err) {
      console.warn(
        '[DownloadRecordsGlobalScreen] Open local file failed:',
        err,
      );
      Alert.alert('開啟失敗', '無法開啟或分享這個本機檔案。');
    }
  }, []);

  return (
    <GlobalGradientBackground>
      <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            activeOpacity={0.72}
            onPress={goBack}
          >
            <Icon name="chevron-back" size={22} color="#59616D" />
          </TouchableOpacity>
          <Text style={styles.title}>最近下载</Text>
        </View>

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={BLUE} />
          </View>
        ) : records.length === 0 ? (
          <View style={styles.emptySection}>
            <View style={styles.emptyCard}>
              <View style={styles.emptyIcon}>
                <Icon name="cloud-download-outline" size={24} color={BLUE} />
              </View>
              <Text style={styles.emptyTitle}>暂无最近下载</Text>
              <Text style={styles.emptyMessage}>
                从电脑下载到本机的文件会出现在这里。
              </Text>
            </View>
          </View>
        ) : (
          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          >
            {records.map(record => (
              <View key={record.id} style={styles.recordCard}>
                <TouchableOpacity
                  testID={`download-record-row-${record.id}`}
                  style={styles.recordOpenArea}
                  activeOpacity={0.74}
                  onPress={() => {
                    void handleOpenRecord(record);
                  }}
                >
                  <View style={styles.preview}>
                    <DownloadRecordPreviewThumbnail record={record} />
                  </View>
                  <View style={styles.recordInfo}>
                    <Text style={styles.recordName} numberOfLines={1}>
                      {record.filename}
                    </Text>
                    <Text style={styles.recordMeta}>
                      {getDownloadRecordTypeLabel(record)} ·{' '}
                      {formatBytes(record.fileSize ?? 0)}
                    </Text>
                    <Text style={styles.recordTime}>
                      {formatDownloadTime(record.downloadedAt)}
                    </Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  testID={`download-record-download-${record.id}`}
                  style={styles.downloadIconButton}
                  accessibilityRole="button"
                  accessibilityLabel={`開啟或分享 ${record.filename}`}
                  activeOpacity={0.7}
                  onPress={() => {
                    void handleDownloadPress(record);
                  }}
                >
                  <Icon name="download-outline" size={18} color="#4C92E2" />
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        )}
      </SafeAreaView>
      <DownloadRecordMediaPreviewModal
        preview={preview}
        onClose={() => setPreview(null)}
      />
    </GlobalGradientBackground>
  );
}

function getDownloadRecordPreviewKind(record: DownloadRecord): PreviewKind {
  if (isImageFile(record.mediaType, record.filename)) {
    return 'photo';
  }
  if (isVideoFile(record.mediaType, record.filename)) {
    return 'video';
  }
  return 'file';
}

function getDownloadRecordTypeLabel(record: DownloadRecord): string {
  const kind = getDownloadRecordPreviewKind(record);
  if (kind === 'photo') return '照片';
  if (kind === 'video') return '影片';
  return '文件';
}

function getDownloadRecordPreviewUri(record: DownloadRecord): string | null {
  const candidate =
    record.previewUrl ?? record.streamUrl ?? record.thumbnailUrl ?? null;
  if (candidate?.trim()) return candidate.trim();
  if (record.localPath?.trim()) return documentPreviewUri(record.localPath);
  return null;
}

function getDownloadRecordThumbnailUri(record: DownloadRecord): string | null {
  const kind = getDownloadRecordPreviewKind(record);
  if (kind !== 'photo' && kind !== 'video') return null;

  const candidate =
    record.thumbnailUrl ?? record.previewUrl ?? record.streamUrl ?? null;
  if (candidate?.trim()) return candidate.trim();
  if (record.localPath?.trim()) return documentPreviewUri(record.localPath);
  return null;
}

function DownloadRecordPreviewThumbnail({
  record,
}: {
  record: DownloadRecord;
}) {
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const kind = getDownloadRecordPreviewKind(record);
  const uri = getDownloadRecordThumbnailUri(record);

  if (uri && !thumbnailFailed && kind === 'photo') {
    return (
      <Image
        testID={`download-record-thumbnail-${record.id}`}
        source={{ uri }}
        style={styles.previewMedia}
        resizeMode="cover"
        onError={() => setThumbnailFailed(true)}
      />
    );
  }

  if (uri && !thumbnailFailed && kind === 'video') {
    return (
      <Video
        testID={`download-record-thumbnail-${record.id}`}
        source={{ uri }}
        style={styles.previewMedia}
        resizeMode="cover"
        paused
        muted
        onError={() => setThumbnailFailed(true)}
      />
    );
  }

  return <GlobalMediaPreviewIcon type={kind} />;
}

function DownloadRecordMediaPreviewModal({
  preview,
  onClose,
}: {
  preview: DownloadPreviewState | null;
  onClose: () => void;
}) {
  if (!preview) return null;

  const kind = getDownloadRecordPreviewKind(preview.record);

  return (
    <Modal
      animationType="fade"
      presentationStyle="fullScreen"
      statusBarTranslucent
      visible={preview != null}
      onRequestClose={onClose}
    >
      <View style={styles.mediaPreviewModalRoot}>
        <View style={styles.mediaPreviewHeader}>
          <Text style={styles.mediaPreviewTitle} numberOfLines={1}>
            {preview.record.filename}
          </Text>
          <TouchableOpacity
            style={styles.mediaPreviewCloseButton}
            accessibilityRole="button"
            accessibilityLabel="關閉預覽"
            activeOpacity={0.7}
            onPress={onClose}
          >
            <Icon name="close" size={18} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        <View style={styles.mediaPreviewBody}>
          {kind === 'photo' ? (
            <Image
              testID="download-record-preview-image"
              source={{ uri: preview.url }}
              style={styles.mediaPreviewFullMedia}
              resizeMode="contain"
            />
          ) : null}
          {kind === 'video' ? (
            <Video
              testID="download-record-preview-video"
              source={{ uri: preview.url }}
              style={styles.mediaPreviewFullMedia}
              resizeMode="contain"
              controls
              paused={false}
              muted={false}
              playInBackground
              playWhenInactive
              ignoreSilentSwitch="ignore"
            />
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function formatDownloadTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetDay = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const time = date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const dayDiff = Math.round(
    (today.getTime() - targetDay.getTime()) / (24 * 60 * 60 * 1000),
  );
  if (dayDiff === 0) return `今天 ${time}`;
  if (dayDiff === 1) return `昨天 ${time}`;
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')} ${time}`;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    marginBottom: 24,
    paddingHorizontal: 20,
    paddingTop: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.78)',
    shadowColor: '#46608A',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.1,
    shadowRadius: 24,
    elevation: 3,
    ...androidBoxShadow({
      offsetY: 12,
      blurRadius: 24,
      color: 'rgba(70, 96, 138, 0.10)',
    }),
  },
  title: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600',
    color: '#17191C',
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptySection: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  emptyCard: {
    minHeight: 180,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.70)',
    backgroundColor: 'rgba(255,255,255,0.58)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 28,
    shadowColor: '#46608A',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.12,
    shadowRadius: 52,
    elevation: 6,
    ...androidBoxShadow({
      offsetY: 18,
      blurRadius: 52,
      color: 'rgba(70, 96, 138, 0.12)',
    }),
  },
  emptyIcon: {
    width: 58,
    height: 58,
    borderRadius: 18,
    backgroundColor: '#E4F5FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyTitle: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
    color: '#203D63',
    textAlign: 'center',
  },
  emptyMessage: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 20,
    color: '#7B8490',
    textAlign: 'center',
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    gap: 12,
  },
  recordCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.70)',
    backgroundColor: 'rgba(255,255,255,0.58)',
    paddingHorizontal: 16,
    paddingVertical: 16,
    shadowColor: '#46608A',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.12,
    shadowRadius: 52,
    elevation: 6,
    ...androidBoxShadow({
      offsetY: 18,
      blurRadius: 52,
      color: 'rgba(70, 96, 138, 0.12)',
    }),
  },
  recordOpenArea: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  preview: {
    width: 58,
    height: 58,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#EDF4FB',
  },
  previewMedia: {
    width: '100%',
    height: '100%',
  },
  recordInfo: {
    flex: 1,
    minWidth: 0,
  },
  recordName: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    color: '#203D63',
  },
  recordMeta: {
    marginTop: 4,
    fontSize: 11,
    lineHeight: 16,
    color: '#7D97B5',
  },
  recordTime: {
    marginTop: 4,
    fontSize: 10,
    lineHeight: 14,
    color: '#9EB2C8',
  },
  downloadIconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EEF5FD',
  },
  mediaPreviewModalRoot: {
    flex: 1,
    backgroundColor: '#05070A',
  },
  mediaPreviewHeader: {
    paddingHorizontal: 18,
    paddingTop: 54,
    paddingBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(5,7,10,0.92)',
  },
  mediaPreviewTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  mediaPreviewCloseButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  mediaPreviewBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaPreviewFullMedia: {
    width: '100%',
    height: '100%',
  },
});
