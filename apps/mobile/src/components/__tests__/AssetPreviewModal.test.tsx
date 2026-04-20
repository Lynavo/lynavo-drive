import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
import type { AlbumAssetDTO } from '@syncflow/contracts';

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
});
