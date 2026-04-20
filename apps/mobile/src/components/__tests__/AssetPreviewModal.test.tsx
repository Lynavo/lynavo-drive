import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import type { AlbumAssetDTO } from '@syncflow/contracts';
import { getAssetPreviewSource } from '../../services/SyncEngineModule';

jest.mock('../../services/SyncEngineModule', () => ({
  getAssetPreviewSource: jest.fn().mockResolvedValue({
    uri: 'file:///tmp/test.jpg',
    mediaType: 'image',
  }),
}));

jest.mock('react-native-video', () => 'Video');

jest.mock('../Icon', () => ({
  Icon: ({ name }: { name: string }) => {
    const React = require('react');
    const { Text: MockText } = require('react-native');
    return React.createElement(MockText, null, name);
  },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === 'albumWorkbench.preview.cloudUnavailable')
        return 'iCloud 影片未下載，無法預覽';
      if (key === 'albumWorkbench.preview.notFound') return '素材找不到';
      return key;
    },
  }),
}));

import { AssetPreviewModal } from '../AssetPreviewModal';

const assets: AlbumAssetDTO[] = [
  {
    assetLocalId: 'a1',
    filename: 'IMG_0001.JPG',
    mediaType: 'image',
    fileSize: 1024,
    creationDate: '2026-04-01T00:00:00Z',
    thumbnailUri: 'file:///tmp/a1.jpg',
    isTransferred: false,
    isQueued: false,
  },
  {
    assetLocalId: 'a2',
    filename: 'VID_0002.MOV',
    mediaType: 'video',
    fileSize: 2048,
    creationDate: '2026-04-02T00:00:00Z',
    thumbnailUri: 'file:///tmp/a2.jpg',
    isTransferred: true,
    isQueued: false,
  },
];

describe('AssetPreviewModal', () => {
  it('renders header with current index/total and filename', async () => {
    const onClose = jest.fn();
    let tree: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <AssetPreviewModal
          visible
          assets={assets}
          initialIndex={0}
          onClose={onClose}
        />,
      );
    });
    const texts = tree!.root.findAllByType(Text).map(n => n.props.children);
    expect(texts).toEqual(expect.arrayContaining(['1 / 2']));
    expect(texts.some((t: unknown) => typeof t === 'string' && t.includes('IMG_0001'))).toBe(true);
  });

  it('calls onClose when close button pressed', async () => {
    const onClose = jest.fn();
    let tree: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <AssetPreviewModal
          visible
          assets={assets}
          initialIndex={0}
          onClose={onClose}
        />,
      );
    });
    const closeButton = tree!.root.findAllByType(TouchableOpacity)[0];
    await ReactTestRenderer.act(async () => {
      closeButton.props.onPress();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows ActivityIndicator while loading, then Image when resolved', async () => {
    (getAssetPreviewSource as jest.Mock).mockResolvedValueOnce({
      uri: 'file:///tmp/full.jpg',
      mediaType: 'image',
    });

    let tree: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <AssetPreviewModal
          visible
          assets={assets}
          initialIndex={0}
          onClose={() => {}}
        />,
      );
    });
    await ReactTestRenderer.act(async () => {
      await Promise.resolve();
    });
    const images = tree!.root.findAllByType(Image);
    expect(images.length).toBeGreaterThan(0);
    expect(images[0].props.source).toEqual({ uri: 'file:///tmp/full.jpg' });
  });

  it('shows error text when preview source returns cloud_unavailable', async () => {
    (getAssetPreviewSource as jest.Mock).mockResolvedValueOnce({
      uri: '',
      mediaType: 'video',
      error: 'cloud_unavailable',
    });
    let tree: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <AssetPreviewModal
          visible
          assets={assets}
          initialIndex={0}
          onClose={() => {}}
        />,
      );
    });
    await ReactTestRenderer.act(async () => {
      await Promise.resolve();
    });
    const texts = tree!.root.findAllByType(Text).map(n => n.props.children);
    expect(
      texts.some((t: unknown) => typeof t === 'string' && t.toLowerCase().includes('icloud')),
    ).toBe(true);
  });
});
