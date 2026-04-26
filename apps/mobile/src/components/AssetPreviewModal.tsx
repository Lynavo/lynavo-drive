import React, { useState, useEffect } from 'react';
import Video from 'react-native-video';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  useWindowDimensions,
  Image,
  ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import type { AlbumAssetDTO, AssetPreviewSourceDTO } from '@syncflow/contracts';
import { Icon } from './Icon';
import { getAssetPreviewSource } from '../services/SyncEngineModule';

const pageStyles = StyleSheet.create({
  page: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  media: { width: '100%', height: '100%' },
  errorText: { color: '#f87171', fontSize: 14 },
});

const PageShell: React.FC<{ width: number; children?: React.ReactNode }> = ({
  width,
  children,
}) => <View style={[pageStyles.page, { width }]}>{children}</View>;

interface PreviewPageProps {
  asset: AlbumAssetDTO;
  isActive: boolean;
  width: number;
}

const PreviewPage: React.FC<PreviewPageProps> = ({ asset, isActive, width }) => {
  const { t } = useTranslation();
  const [source, setSource] = useState<AssetPreviewSourceDTO | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getAssetPreviewSource(asset.assetLocalId)
      .then(result => {
        if (!cancelled) {
          setSource(result);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSource({ uri: '', mediaType: asset.mediaType, error: 'not_found' });
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [asset.assetLocalId, asset.mediaType]);

  if (loading) {
    return (
      <PageShell width={width}>
        <ActivityIndicator size="large" color="#fff" />
      </PageShell>
    );
  }

  if (source?.error) {
    const key =
      source.error === 'cloud_unavailable'
        ? 'albumWorkbench.preview.cloudUnavailable'
        : 'albumWorkbench.preview.notFound';
    return (
      <PageShell width={width}>
        <Text style={pageStyles.errorText}>{t(key)}</Text>
      </PageShell>
    );
  }

  if (source?.mediaType === 'image') {
    return (
      <PageShell width={width}>
        <Image
          source={{ uri: source.uri }}
          style={pageStyles.media}
          resizeMode="contain"
        />
      </PageShell>
    );
  }

  if (source?.mediaType === 'video') {
    return (
      <PageShell width={width}>
        <Video
          source={{ uri: source.uri }}
          style={pageStyles.media}
          controls
          paused={!isActive}
          resizeMode="contain"
          playInBackground
          playWhenInactive
          enterPictureInPictureOnLeave
          ignoreSilentSwitch="ignore"
        />
      </PageShell>
    );
  }

  return <PageShell width={width} />;
};

export interface AssetPreviewModalProps {
  visible: boolean;
  assets: AlbumAssetDTO[];
  initialIndex: number;
  onClose: () => void;
}

export const AssetPreviewModal: React.FC<AssetPreviewModalProps> = ({
  visible,
  assets,
  initialIndex,
  onClose,
}) => {
  const { width } = useWindowDimensions();
  const [activeIndex, setActiveIndex] = useState(initialIndex);

  useEffect(() => {
    setActiveIndex(initialIndex);
  }, [initialIndex]);

  const current = assets[activeIndex];

  return (
    <Modal
      visible={visible}
      presentationStyle="fullScreen"
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Icon name="close" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.counter}>
            {`${activeIndex + 1} / ${assets.length}`}
          </Text>
          <Text style={styles.filename} numberOfLines={1}>
            {current?.filename ?? ''}
          </Text>
        </View>
        <FlatList
          data={assets}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={initialIndex}
          keyExtractor={item => item.assetLocalId}
          getItemLayout={(_, index) => ({
            length: width,
            offset: width * index,
            index,
          })}
          onMomentumScrollEnd={event => {
            const newIndex = Math.round(
              event.nativeEvent.contentOffset.x / width,
            );
            setActiveIndex(newIndex);
          }}
          renderItem={({ item, index }) => (
            <PreviewPage asset={item} isActive={index === activeIndex} width={width} />
          )}
          extraData={`${width}-${activeIndex}`}
        />
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingTop: 48,
    gap: 12,
  },
  closeBtn: { padding: 4 },
  counter: { color: '#fff', fontSize: 14, minWidth: 60 },
  filename: { color: '#fff', fontSize: 13, flex: 1 },
});
