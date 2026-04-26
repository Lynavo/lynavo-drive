import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
  Linking,
  NativeModules,
  NativeEventEmitter,
  Modal,
  type ListRenderItemInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import type { SharedFileDTO } from '@syncflow/contracts';
import { FEATURES } from '../constants/features';
import { useAuth, isFeatureAccessAllowed } from '../stores/auth-store';
import { Icon } from '../components/Icon';
import {
  browseSharedFiles,
  downloadSharedFile,
  getSharedFileStreamUrl,
} from '../services/SyncEngineModule';
import { formatBytes } from '../utils/format';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ErrorKind = 'device_unavailable' | 'directory_inaccessible' | 'network_error';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCREEN_BG = '#d6ecf8';
const DARK = '#1a3a5c';
const BLUE = '#3b9fd8';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fileTypeIcon(file: SharedFileDTO): { name: string; color: string } {
  if (file.isDirectory) return { name: 'folder-outline', color: '#f59e0b' };
  if (file.type === 'video') return { name: 'videocam-outline', color: '#3b82f6' };
  if (file.type === 'image') return { name: 'image-outline', color: '#06b6d4' };
  return { name: 'document-outline', color: '#8b5cf6' };
}

function hasPreview(file: SharedFileDTO): boolean {
  return file.type === 'image' || file.type === 'video';
}

async function checkDeviceAvailable(): Promise<boolean> {
  try {
    const binding = await NativeModules.NativeSyncEngine?.getBindingState();
    if (!binding?.deviceId) return false;
    return (
      binding.connectionState === 'connected' ||
      binding.connectionState === 'bound'
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// SharedFilesScreen
// ---------------------------------------------------------------------------

export function SharedFilesScreen() {
  const navigation = useNavigation();
  const { t } = useTranslation();
  const { subscription } = useAuth();
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState<SharedFileDTO[]>([]);
  const [currentPath, setCurrentPath] = useState('');
  const [errorKind, setErrorKind] = useState<ErrorKind | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  // Preview state
  const [previewFile, setPreviewFile] = useState<SharedFileDTO | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Load files via native bridge
  // ---------------------------------------------------------------------------

  const loadFiles = useCallback(async (path: string) => {
    setLoading(true);
    setErrorKind(null);

    // P1#3: Pre-check device availability
    const available = await checkDeviceAvailable();
    if (!available) {
      setErrorKind('device_unavailable');
      setFiles([]);
      setLoading(false);
      return;
    }

    try {
      const result = await browseSharedFiles(path);
      setFiles(result.files ?? []);
      setErrorKind(null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // 404 / 403 → directory genuinely missing or access denied.
      // 400 is intentionally excluded: sidecar returns 400 for path
      // traversal rejects, "not a directory", and resolve failures —
      // none of which mean "shared directory inaccessible".
      if (
        msg.includes('403') ||
        msg.includes('404') ||
        msg.includes('not found')
      ) {
        setErrorKind('directory_inaccessible');
      } else {
        setErrorKind('network_error');
      }
      setFiles([]);
      console.warn('[SharedFiles] loadFiles error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Initial load
  // ---------------------------------------------------------------------------

  useEffect(() => {
    void loadFiles(currentPath);
  }, [currentPath, loadFiles]);

  // ---------------------------------------------------------------------------
  // P1#3: Subscribe to binding state changes
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const { NativeSyncEngine } = NativeModules;
    if (!NativeSyncEngine) return;

    const emitter = new NativeEventEmitter(NativeSyncEngine);
    const sub = emitter.addListener(
      'onBindingStateChanged',
      (state: Record<string, unknown> | null) => {
        if (!state || !state.deviceId) {
          setErrorKind('device_unavailable');
          setFiles([]);
          return;
        }

        const connState = (state.connectionState as string) || 'bound';
        if (connState === 'connected' || connState === 'bound') {
          // Device reconnected — reload current path
          void loadFiles(currentPath);
        } else {
          setErrorKind('device_unavailable');
          setFiles([]);
        }
      },
    );

    return () => sub.remove();
  }, [loadFiles, currentPath]);

  // ---------------------------------------------------------------------------
  // Directory navigation
  // ---------------------------------------------------------------------------

  const navigateIntoDir = useCallback((path: string) => {
    setCurrentPath(path);
  }, []);

  const navigateBack = useCallback(() => {
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    setCurrentPath(parts.join('/'));
  }, [currentPath]);

  // ---------------------------------------------------------------------------
  // Download handler
  // ---------------------------------------------------------------------------

  const handleDownload = useCallback(async (file: SharedFileDTO) => {
    // --- PRD §7.1 — downloads require active subscription ---
    if (!FEATURES.SUBSCRIPTION_ENFORCEMENT) {
      // Soft-off: skip the gate until enforcement is globally enabled.
    } else if (!isFeatureAccessAllowed(subscription?.status)) {
      Alert.alert(
        t('subscription.gate.downloadTitle'),
        t('subscription.gate.downloadBody'),
        [
          { text: t('subscription.gate.cancel'), style: 'cancel' },
          {
            text: t('subscription.gate.goSubscribe'),
            onPress: () => navigation.navigate('Subscription' as never),
          },
        ],
      );
      return;
    }

    setDownloading(file.path);
    try {
      const result = await downloadSharedFile(file.path);
      if (result.savedToPhotos) {
        Alert.alert(t('sharedFiles.dialogs.downloadComplete'), t('sharedFiles.dialogs.downloadSavedToPhotos', { name: file.name }));
      } else if (result.localPath) {
        Alert.alert(t('sharedFiles.dialogs.downloadComplete'), t('sharedFiles.dialogs.downloadSaved', { name: file.name }));
      }
    } catch (e) {
      Alert.alert(t('sharedFiles.dialogs.downloadFailed'), t('sharedFiles.dialogs.downloadFailedMessage'));
      console.warn('[SharedFiles] download error:', e);
    } finally {
      setDownloading(null);
    }
  }, [subscription?.status, t, navigation]);

  // ---------------------------------------------------------------------------
  // Preview handler
  // ---------------------------------------------------------------------------

  const handlePreview = useCallback(async (file: SharedFileDTO) => {
    try {
      const url = await getSharedFileStreamUrl(file.path);
      setPreviewFile(file);
      setPreviewUrl(url);
    } catch (e) {
      Alert.alert(t('sharedFiles.dialogs.previewFailed'), t('sharedFiles.dialogs.previewFailedMessage'));
      console.warn('[SharedFiles] getStreamUrl error:', e);
    }
  }, []);

  const closePreview = useCallback(() => {
    setPreviewFile(null);
    setPreviewUrl(null);
  }, []);

  // ---------------------------------------------------------------------------
  // Render item
  // ---------------------------------------------------------------------------

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<SharedFileDTO>) => {
      const icon = fileTypeIcon(item);
      const isDownloading = downloading === item.path;

      return (
        <TouchableOpacity
          style={styles.fileRow}
          activeOpacity={0.7}
          onPress={() => {
            if (item.isDirectory) {
              navigateIntoDir(item.path);
            } else if (hasPreview(item)) {
              void handlePreview(item);
            }
          }}
        >
          {/* Thumbnail or icon */}
          {item.thumbnailUrl ? (
            <Image
              source={{ uri: item.thumbnailUrl }}
              style={styles.fileThumbnail}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.fileIconWrapper}>
              <Icon name={icon.name} size={18} color={icon.color} />
            </View>
          )}

          {/* File info */}
          <View style={styles.fileInfo}>
            <Text style={styles.fileName} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.fileMeta}>
              {item.isDirectory ? t('sharedFiles.files.folder') : formatBytes(item.size)}
            </Text>
          </View>

          {/* Actions */}
          {item.isDirectory ? (
            <Icon name="chevron-forward" size={16} color="#8aabbd" />
          ) : (
            <TouchableOpacity
              style={styles.downloadBtn}
              activeOpacity={0.7}
              disabled={isDownloading}
              testID="shared-file-download-button"
              onPress={() => void handleDownload(item)}
            >
              {isDownloading ? (
                <ActivityIndicator size="small" color={BLUE} />
              ) : (
                <Icon name="download-outline" size={18} color={BLUE} />
              )}
            </TouchableOpacity>
          )}
        </TouchableOpacity>
      );
    },
    [downloading, navigateIntoDir, handlePreview, handleDownload],
  );

  const keyExtractor = useCallback((item: SharedFileDTO) => item.path, []);

  // ---------------------------------------------------------------------------
  // Content
  // ---------------------------------------------------------------------------

  let content: React.ReactElement;

  if (loading) {
    content = (
      <View style={styles.stateContainer}>
        <ActivityIndicator size="large" color={BLUE} />
        <Text style={styles.loadingText}>{t('sharedFiles.loading')}</Text>
      </View>
    );
  } else if (errorKind === 'device_unavailable') {
    content = (
      <View style={styles.stateContainer}>
        <View style={styles.stateIconCircle}>
          <Icon name="desktop-outline" size={32} color="#9ab8cc" />
        </View>
        <Text style={styles.stateTitle}>{t('sharedFiles.deviceUnavailable.title')}</Text>
        <Text style={styles.stateMessage}>{t('sharedFiles.deviceUnavailable.message')}</Text>
        <TouchableOpacity
          style={styles.retryButton}
          activeOpacity={0.7}
          onPress={() => void loadFiles(currentPath)}
        >
          <Icon name="refresh-outline" size={16} color="#fff" />
          <Text style={styles.retryButtonText}>{t('sharedFiles.deviceUnavailable.recheck')}</Text>
        </TouchableOpacity>
      </View>
    );
  } else if (errorKind === 'directory_inaccessible') {
    content = (
      <View style={styles.stateContainer}>
        <View style={styles.stateIconCircle}>
          <Icon name="folder-outline" size={32} color="#9ab8cc" />
        </View>
        <Text style={styles.stateTitle}>{t('sharedFiles.directoryInaccessible.title')}</Text>
        <Text style={styles.stateMessage}>{t('sharedFiles.directoryInaccessible.message')}</Text>
        <TouchableOpacity
          style={styles.retryButton}
          activeOpacity={0.7}
          onPress={() => void loadFiles(currentPath)}
        >
          <Icon name="refresh-outline" size={16} color="#fff" />
          <Text style={styles.retryButtonText}>{t('common.retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  } else if (errorKind === 'network_error') {
    content = (
      <View style={styles.stateContainer}>
        <View style={styles.stateIconCircle}>
          <Icon name="alert-circle-outline" size={32} color="#9ab8cc" />
        </View>
        <Text style={styles.stateTitle}>{t('sharedFiles.networkError.title')}</Text>
        <Text style={styles.stateMessage}>{t('sharedFiles.networkError.message')}</Text>
        <TouchableOpacity
          style={styles.retryButton}
          activeOpacity={0.7}
          onPress={() => void loadFiles(currentPath)}
        >
          <Icon name="refresh-outline" size={16} color="#fff" />
          <Text style={styles.retryButtonText}>{t('common.retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  } else if (files.length === 0) {
    content = (
      <View style={styles.stateContainer}>
        <View style={styles.stateIconCircle}>
          <Icon name="folder-outline" size={32} color="#9ab8cc" />
        </View>
        <Text style={styles.stateTitle}>{t('sharedFiles.emptyState.title')}</Text>
        <Text style={styles.stateMessage}>{t('sharedFiles.emptyState.message')}</Text>
      </View>
    );
  } else {
    content = (
      <FlatList
        data={files}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    );
  }

  // Current folder name for header
  const folderName = currentPath
    ? currentPath.split('/').filter(Boolean).pop() ?? t('sharedFiles.defaultFolderName')
    : t('sharedFiles.defaultFolderName');

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            activeOpacity={0.7}
            onPress={currentPath !== '' ? navigateBack : () => navigation.goBack()}
          >
            <Icon name="chevron-back" size={18} color={DARK} />
          </TouchableOpacity>
          <Text style={styles.title}>{folderName}</Text>
          <View style={{ flex: 1 }} />
          <TouchableOpacity
            style={styles.refreshButton}
            activeOpacity={0.7}
            onPress={() => void loadFiles(currentPath)}
          >
            <Icon name="refresh-outline" size={18} color={DARK} />
          </TouchableOpacity>
        </View>

        {content}
      </View>

      {/* Preview modal */}
      {previewFile && previewUrl && (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={closePreview}
        >
          <View style={styles.previewOverlay}>
            <View style={styles.previewHeader}>
              <TouchableOpacity onPress={closePreview} activeOpacity={0.7}>
                <Icon name="close" size={24} color="#fff" />
              </TouchableOpacity>
              <Text style={styles.previewTitle} numberOfLines={1}>
                {previewFile.name}
              </Text>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => void handleDownload(previewFile)}
              >
                <Icon name="download-outline" size={22} color="#fff" />
              </TouchableOpacity>
            </View>

            <View style={styles.previewBody}>
              {previewFile.type === 'image' ? (
                <Image
                  source={{ uri: previewUrl }}
                  style={styles.previewImage}
                  resizeMode="contain"
                />
              ) : (
                <TouchableOpacity
                  style={styles.videoPlayButton}
                  activeOpacity={0.7}
                  onPress={() => void Linking.openURL(previewUrl)}
                >
                  <Icon name="play-circle-outline" size={64} color="#fff" />
                  <Text style={styles.videoPlayText}>{t('sharedFiles.preview.playVideo')}</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: SCREEN_BG,
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
    gap: 8,
  },
  backButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: DARK,
  },
  refreshButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // List
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },

  // File row
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  fileThumbnail: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#eef6fc',
  },
  fileIconWrapper: {
    width: 44,
    height: 44,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#eef6fc',
  },
  fileInfo: {
    flex: 1,
    minWidth: 0,
  },
  fileName: {
    fontSize: 14,
    fontWeight: '600',
    color: DARK,
  },
  fileMeta: {
    fontSize: 12,
    color: '#9ab8cc',
    marginTop: 2,
  },
  downloadBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(59,159,216,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  separator: {
    height: 8,
  },

  // State views
  stateContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingBottom: 60,
  },
  stateIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  stateTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: DARK,
    marginBottom: 6,
  },
  stateMessage: {
    fontSize: 13,
    color: '#8aabbd',
    textAlign: 'center',
    lineHeight: 18,
  },
  loadingText: {
    fontSize: 14,
    color: '#8aabbd',
    marginTop: 12,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: BLUE,
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginTop: 20,
  },
  retryButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },

  // Preview modal
  previewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
  },
  previewTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    textAlign: 'center',
    marginHorizontal: 12,
  },
  previewBody: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  videoPlayButton: {
    alignItems: 'center',
    gap: 12,
  },
  videoPlayText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
  },
});
