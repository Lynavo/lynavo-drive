import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text } from 'react-native';
import type { TFunction } from 'i18next';

import {
  GlobalSyncRecordTimelineSection,
  RecentDownloadsSection,
  SyncRecordSummarySection,
  type RecentDownloadPlaceholder,
} from '../GlobalSyncActivityHomeSections';

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

const placeholders: RecentDownloadPlaceholder[] = [
  {
    key: 'photo',
    label: '照片',
    iconName: 'image-outline',
    iconColor: '#1677D2',
    iconBackground: '#B8DDF8',
    previewType: 'photo',
  },
  {
    key: 'video',
    label: '视频',
    iconName: 'play-circle-outline',
    iconColor: '#ffffff',
    iconBackground: '#AAB7FF',
    previewType: 'video',
  },
];
const tMock = ((key: string) => key) as TFunction;

describe('RecentDownloadsSection', () => {
  it('renders an explicit empty recent downloads state for global preview', () => {
    let tree: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(
        <RecentDownloadsSection
          records={[]}
          placeholders={placeholders}
          t={tMock}
          onPressViewAll={jest.fn()}
          variant="globalPreview"
        />,
      );
    });

    const textValues = tree!.root
      .findAllByType(Text)
      .map(node => node.props.children);
    expect(textValues).toContain('暂无最近下载');
    expect(textValues).toContain('从电脑下载到本机的文件会出现在这里。');
    expect(textValues).not.toContain(
      '开启自动上传后，同步到电脑的素材会出现在这里。',
    );
    expect(textValues).not.toContain('照片');
    expect(textValues).not.toContain('arrow-down-circle-outline');

    expect(
      tree!.root.findByProps({ testID: 'recent-download-empty-state' }),
    ).toBeTruthy();
    expect(
      tree!.root.findByProps({ testID: 'global-recent-download-title-icon' }),
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
          placeholders={placeholders}
          t={tMock}
          onPressViewAll={jest.fn()}
          variant="globalPreview"
        />,
      );
    });

    const items = tree!.root
      .findAllByProps({ testID: 'recent-download-tile-dummy' })
      .filter(item => typeof item.type === 'string');
    expect(items.length).toBe(3);
  });

  it('renders an explicit empty sync record state for global preview summaries', () => {
    let tree: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(
        <SyncRecordSummarySection
          boundDeviceName="Mini4"
          fileCount={0}
          isSyncing={false}
          t={tMock}
          totalBytes={0}
          variant="globalPreview"
        />,
      );
    });

    const textValues = tree!.root
      .findAllByType(Text)
      .map(node => node.props.children);
    expect(textValues).toContain('暂无同步记录');
    expect(textValues).toContain(
      '完成第一次自动同步后，记录会按电脑完成日期显示在这里。',
    );
    expect(textValues).not.toContain('Mini4');
  });

  it('renders an explicit empty sync record state for empty global timelines', () => {
    let tree: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(
        <GlobalSyncRecordTimelineSection days={[]} totalSyncedSize="0 B" />,
      );
    });

    const textValues = tree!.root
      .findAllByType(Text)
      .map(node => node.props.children);
    expect(textValues).toContain('暂无同步记录');
    expect(textValues).toContain(
      '完成第一次自动同步后，记录会按电脑完成日期显示在这里。',
    );
  });
});
