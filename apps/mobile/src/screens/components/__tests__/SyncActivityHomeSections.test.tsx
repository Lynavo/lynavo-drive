import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Image, Text } from 'react-native';
import type { TFunction } from 'i18next';

import {
  SyncRecordTimelineSection,
  RecentDownloadsSection,
} from '../SyncActivityHomeSections';

jest.mock('react-native-video', () => 'Video');

jest.mock('../../../components/Icon', () => ({
  Icon: ({ name }: { name: string }) => {
    const React = require('react');
    const { Text: MockText } = require('react-native');
    return React.createElement(MockText, null, name);
  },
}));

jest.mock('lucide-react-native', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    ArrowDownCircle: ({ testID }: { testID?: string }) =>
      React.createElement(View, {
        testID: testID ?? 'mock-arrow-down-circle-icon',
      }),
  };
});

jest.mock('react-native-svg', () => {
  const React = require('react');
  const { View } = require('react-native');
  const SvgMock = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(View, null, children);
  return {
    __esModule: true,
    default: SvgMock,
    Circle: View,
    Defs: View,
    LinearGradient: View,
    Path: View,
    Rect: View,
    Stop: View,
  };
});

const tMock = ((key: string) => key) as TFunction;

describe('RecentDownloadsSection', () => {
  it('renders an explicit empty recent downloads state', () => {
    let tree: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(
        <RecentDownloadsSection
          records={[]}
          t={tMock}
          onPressViewAll={jest.fn()}
        />,
      );
    });

    const textValues = tree!.root
      .findAllByType(Text)
      .map(node => node.props.children);
    expect(textValues).toContain('syncActivity.recentDownload.emptyTitle');
    expect(textValues).toContain('syncActivity.recentDownload.emptyMessage');
    expect(textValues).not.toContain('syncActivity.empty.title');
    expect(textValues).not.toContain('Photo');
    expect(textValues).not.toContain('arrow-down-circle-outline');

    expect(
      tree!.root.findByProps({ testID: 'recent-download-empty-state' }),
    ).toBeTruthy();
    expect(
      tree!.root.findByProps({ testID: 'recent-download-title-icon' }),
    ).toBeTruthy();
  });

  it('renders dummy tiles to prevent stretching when records length is less than 4', () => {
    let tree: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(
        <RecentDownloadsSection
          records={[
            {
              recordId: 'rec-1',
              filename: '1.jpeg',
              mediaType: 'image',
              completedAt: new Date().toISOString(),
            },
          ]}
          t={tMock}
          onPressViewAll={jest.fn()}
        />,
      );
    });

    const items = tree!.root
      .findAllByProps({ testID: 'recent-download-tile-dummy' })
      .filter(item => typeof item.type === 'string');
    expect(items.length).toBe(3);
  });

  it('renders recent image and video thumbnails from available preview sources', () => {
    let tree: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(
        <RecentDownloadsSection
          records={[
            {
              recordId: 'rec-image',
              filename: 'Desktop-Mockup.png',
              mediaType: 'image',
              completedAt: '2026-06-17T08:30:00.000Z',
              previewUrl: 'http://127.0.0.1:39594/preview/image.png',
            },
            {
              recordId: 'rec-video',
              filename: 'Client-Handoff.mov',
              mediaType: 'video',
              completedAt: '2026-06-17T08:31:00.000Z',
              thumbnailUrl: 'http://127.0.0.1:39594/thumbnail/video.jpg',
              streamUrl: 'http://127.0.0.1:39594/stream/video.mov',
            },
            {
              recordId: 'rec-fallback',
              filename: 'No-Preview.jpg',
              mediaType: 'image',
              completedAt: '2026-06-17T08:32:00.000Z',
            },
          ]}
          t={tMock}
          onPressViewAll={jest.fn()}
        />,
      );
    });

    const imageSources = tree!.root
      .findAllByType(Image)
      .map(node => node.props.source);
    const videoNodes = tree!.root.findAllByProps({
      testID: 'recent-download-thumbnail-video',
    });
    expect(imageSources).toContainEqual({
      uri: 'http://127.0.0.1:39594/preview/image.png',
    });
    expect(imageSources).toContainEqual({
      uri: 'http://127.0.0.1:39594/thumbnail/video.jpg',
    });
    expect(videoNodes).toHaveLength(0);

    const dummyItems = tree!.root
      .findAllByProps({ testID: 'recent-download-tile-dummy' })
      .filter(item => typeof item.type === 'string');
    expect(dummyItems.length).toBe(1);
  });

  it('does not render local video paths as recent download thumbnails', () => {
    let tree: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(
        <RecentDownloadsSection
          records={[
            {
              recordId: 'rec-video',
              filename: 'Local-Only.mov',
              mediaType: 'video',
              completedAt: '2026-06-17T08:31:00.000Z',
              localPath: '/var/mobile/Containers/Data/clip.mov',
            },
          ]}
          t={tMock}
          onPressViewAll={jest.fn()}
        />,
      );
    });

    expect(
      tree!.root.findAllByProps({ testID: 'recent-download-thumbnail-video' }),
    ).toHaveLength(0);
    expect(tree!.root.findAllByType(Image)).toHaveLength(0);
  });

  it('renders an explicit empty sync record state for empty timelines', () => {
    let tree: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(
        <SyncRecordTimelineSection days={[]} totalSyncedSize="0 B" />,
      );
    });

    const textValues = tree!.root
      .findAllByType(Text)
      .map(node => node.props.children);
    expect(textValues).toContain('syncActivity.syncRecords.emptyTitle');
    expect(textValues).toContain('syncActivity.syncRecords.emptyMessage');
  });
});
