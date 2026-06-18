import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

let mockVisualQaEnabled = false;

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    canGoBack: jest.fn(() => true),
    goBack: jest.fn(),
    reset: jest.fn(),
  }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const ReactInner = require('react');
    ReactInner.useEffect(effect, [effect]);
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('../../components/Icon', () => ({
  Icon: ({ name }: { name: string }) => {
    const ReactInner = require('react');
    const { Text } = require('react-native');
    return ReactInner.createElement(Text, null, name);
  },
}));

jest.mock('../../components/GlobalGradientBackground', () => ({
  GlobalGradientBackground: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

jest.mock('../components/GlobalSyncActivityHomeSections', () => ({
  GlobalMediaPreviewIcon: ({ type }: { type: string }) => {
    const ReactInner = require('react');
    const { Text } = require('react-native');
    return ReactInner.createElement(Text, null, `preview-${type}`);
  },
}));

jest.mock('../../services/download-records-service', () => ({
  listDownloadRecords: jest.fn(),
}));

jest.mock('@react-native-documents/viewer', () => ({
  viewDocument: jest.fn(),
}));

jest.mock('react-native-video', () => 'Video');

jest.mock('../../utils/file-preview', () => {
  const isImageFile = (mediaType?: string | null, filename?: string | null) =>
    mediaType?.startsWith('image/') === true ||
    /\.(jpg|jpeg|png)$/i.test(filename ?? '');
  const isVideoFile = (mediaType?: string | null, filename?: string | null) =>
    mediaType?.startsWith('video/') === true ||
    /\.(mov|mp4)$/i.test(filename ?? '');
  return {
    canPreviewDocumentFile: jest.fn(
      (_mediaType?: string | null, filename?: string | null) =>
        /\.pdf$/i.test(filename ?? ''),
    ),
    documentMimeType: jest.fn((filename?: string | null) =>
      /\.pdf$/i.test(filename ?? '') ? 'application/pdf' : undefined,
    ),
    documentPreviewUri: jest.fn((localPath: string) => `file://${localPath}`),
    isImageFile,
    isVideoFile,
    openFileWithOtherApp: jest.fn().mockResolvedValue(undefined),
  };
});

jest.mock('../../dev/visualQa', () => ({
  isVisualQaEnabled: () => mockVisualQaEnabled,
}));

import { listDownloadRecords } from '../../services/download-records-service';
import { viewDocument } from '@react-native-documents/viewer';
import { openFileWithOtherApp } from '../../utils/file-preview';
import { DownloadRecordsGlobalScreen } from '../DownloadRecordsGlobalScreen';

const mockedListDownloadRecords = listDownloadRecords as jest.MockedFunction<
  typeof listDownloadRecords
>;
const mockedViewDocument = viewDocument as jest.Mock;
const mockedOpenFileWithOtherApp = openFileWithOtherApp as jest.Mock;

describe('DownloadRecordsGlobalScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVisualQaEnabled = false;
  });

  it('renders a dedicated empty download records page', async () => {
    mockedListDownloadRecords.mockResolvedValueOnce([]);

    const { getByText, queryByText } = render(<DownloadRecordsGlobalScreen />);

    await waitFor(() => {
      expect(getByText('最近下载')).toBeTruthy();
      expect(getByText('暂无最近下载')).toBeTruthy();
      expect(getByText('从电脑下载到本机的文件会出现在这里。')).toBeTruthy();
    });
    expect(queryByText('Client-Handoff.mov')).toBeNull();
    expect(queryByText('Campaign-Keyframes.zip')).toBeNull();
  });

  it('renders visual QA mock downloads when the download history is empty', async () => {
    mockVisualQaEnabled = true;
    mockedListDownloadRecords.mockResolvedValueOnce([]);

    const { getByText, queryByText } = render(<DownloadRecordsGlobalScreen />);

    await waitFor(() => {
      expect(getByText('Client-Handoff.mov')).toBeTruthy();
      expect(getByText('Campaign-Keyframes.zip')).toBeTruthy();
    });
    expect(queryByText('暂无最近下载')).toBeNull();
  });

  it('renders downloaded files using the reference list layout copy', async () => {
    mockedListDownloadRecords.mockResolvedValueOnce([
      {
        id: 'download-1',
        resourceId: 'download-1',
        filename: 'Vacation-01.JPG',
        fileSize: 8.4 * 1024 * 1024,
        mediaType: 'image/jpeg',
        downloadedAt: '2026-06-16T02:42:00.000Z',
      },
    ]);

    const { getByText } = render(<DownloadRecordsGlobalScreen />);

    await waitFor(() => {
      expect(getByText('Vacation-01.JPG')).toBeTruthy();
      expect(getByText('照片 · 8.4 MB')).toBeTruthy();
    });
  });

  it('renders thumbnails for image and video download records when preview sources exist', async () => {
    mockedListDownloadRecords.mockResolvedValueOnce([
      {
        id: 'image-1',
        resourceId: 'image-1',
        filename: 'Vacation-01.JPG',
        mediaType: 'image/jpeg',
        downloadedAt: '2026-06-16T02:42:00.000Z',
        thumbnailUrl: 'https://desktop.local/thumb.jpg',
      },
      {
        id: 'video-1',
        resourceId: 'video-1',
        filename: 'Clip.mov',
        mediaType: 'video/quicktime',
        downloadedAt: '2026-06-16T02:41:00.000Z',
        localPath: '/tmp/Clip.mov',
      },
    ]);

    const { getByTestId, queryByText } = render(
      <DownloadRecordsGlobalScreen />,
    );

    await waitFor(() => {
      expect(
        getByTestId('download-record-thumbnail-image-1').props.source,
      ).toEqual({
        uri: 'https://desktop.local/thumb.jpg',
      });
      expect(
        getByTestId('download-record-thumbnail-video-1').props.source,
      ).toEqual({
        uri: 'file:///tmp/Clip.mov',
      });
    });
    expect(queryByText('preview-photo')).toBeNull();
    expect(queryByText('preview-video')).toBeNull();
  });

  it('opens an in-app media preview modal when an image row is pressed', async () => {
    mockedListDownloadRecords.mockResolvedValueOnce([
      {
        id: 'image-1',
        resourceId: 'image-1',
        filename: 'Vacation-01.JPG',
        mediaType: 'image/jpeg',
        downloadedAt: '2026-06-16T02:42:00.000Z',
        previewUrl: 'https://desktop.local/full.jpg',
        thumbnailUrl: 'https://desktop.local/thumb.jpg',
      },
    ]);

    const { getByTestId } = render(<DownloadRecordsGlobalScreen />);

    await waitFor(() => {
      expect(getByTestId('download-record-row-image-1')).toBeTruthy();
    });
    fireEvent.press(getByTestId('download-record-row-image-1'));

    expect(getByTestId('download-record-preview-image').props.source).toEqual({
      uri: 'https://desktop.local/full.jpg',
    });
  });

  it('opens QuickLook for previewable documents and share sheet for unsupported files', async () => {
    mockedListDownloadRecords.mockResolvedValueOnce([
      {
        id: 'doc-1',
        resourceId: 'doc-1',
        filename: 'Report.pdf',
        mediaType: 'application/pdf',
        downloadedAt: '2026-06-16T02:42:00.000Z',
        localPath: '/tmp/Report.pdf',
      },
      {
        id: 'file-1',
        resourceId: 'file-1',
        filename: 'README',
        mediaType: 'application/octet-stream',
        downloadedAt: '2026-06-16T02:41:00.000Z',
        localPath: '/tmp/README',
      },
    ]);

    const { getByTestId } = render(<DownloadRecordsGlobalScreen />);

    await waitFor(() => {
      expect(getByTestId('download-record-row-doc-1')).toBeTruthy();
    });
    fireEvent.press(getByTestId('download-record-row-doc-1'));
    fireEvent.press(getByTestId('download-record-row-file-1'));

    await waitFor(() => {
      expect(mockedViewDocument).toHaveBeenCalledWith({
        uri: 'file:///tmp/Report.pdf',
        headerTitle: 'Report.pdf',
        mimeType: 'application/pdf',
      });
      expect(mockedOpenFileWithOtherApp).toHaveBeenCalledWith(
        '/tmp/README',
        'README',
      );
    });
  });

  it('download button shares a local file or explains when re-download is unavailable', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    mockedListDownloadRecords.mockResolvedValueOnce([
      {
        id: 'local-1',
        resourceId: 'local-1',
        filename: 'Local.pdf',
        mediaType: 'application/pdf',
        downloadedAt: '2026-06-16T02:42:00.000Z',
        localPath: '/tmp/Local.pdf',
      },
      {
        id: 'missing-1',
        resourceId: 'missing-1',
        filename: 'Missing.pdf',
        mediaType: 'application/pdf',
        downloadedAt: '2026-06-16T02:41:00.000Z',
      },
    ]);

    const { getByTestId } = render(<DownloadRecordsGlobalScreen />);

    await waitFor(() => {
      expect(getByTestId('download-record-download-local-1')).toBeTruthy();
    });
    fireEvent.press(getByTestId('download-record-download-local-1'));
    fireEvent.press(getByTestId('download-record-download-missing-1'));

    await waitFor(() => {
      expect(mockedOpenFileWithOtherApp).toHaveBeenCalledWith(
        '/tmp/Local.pdf',
        'Local.pdf',
      );
      expect(alertSpy).toHaveBeenCalledWith(
        '無法重新下載',
        '這筆紀錄沒有可用的本機檔案，也沒有足夠的遠端路由資訊可重新下載。',
      );
    });
  });
});
