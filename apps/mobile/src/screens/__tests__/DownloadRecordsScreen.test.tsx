import React from 'react';
import { Alert, NativeModules } from 'react-native';
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

jest.mock('../../components/GradientBackground', () => ({
  GradientBackground: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

jest.mock('../components/SyncActivityHomeSections', () => ({
  MediaPreviewIcon: ({ type }: { type: string }) => {
    const ReactInner = require('react');
    const { Text } = require('react-native');
    return ReactInner.createElement(Text, null, `preview-${type}`);
  },
}));

jest.mock('../../services/download-records-service', () => ({
  listDownloadRecords: jest.fn(),
  isPersonalDirRecord: jest.fn((resourceId: string) =>
    resourceId.startsWith('personal-dir:'),
  ),
}));

jest.mock('../../services/desktop-local-service', () => ({
  downloadGlobalLocalComputerResource: jest.fn(),
  downloadReceivedLibraryItem: jest.fn(),
  downloadResourceForGlobal: jest.fn(),
  getGlobalLocalComputerPreviewUrl: jest
    .fn()
    .mockResolvedValue('http://192.168.1.100:39394/personal/stream/live'),
  getGlobalLocalComputerThumbnailUrl: jest
    .fn()
    .mockResolvedValue('http://192.168.1.100:39394/personal/thumbnail/live'),
  isDownloadSavedLocally: jest.fn(
    (result: {
      savedToPhotos?: boolean;
      localPath?: string | null;
      savedLocation?: string | null;
    }) =>
      result.savedToPhotos === true ||
      (typeof result.localPath === 'string' &&
        result.localPath.trim().length > 0) ||
      (typeof result.savedLocation === 'string' &&
        result.savedLocation.trim().length > 0),
  ),
  isDownloadSavedToPhotos: jest.fn(
    (result: {
      savedToPhotos?: boolean;
      localPath?: string | null;
      savedLocation?: string | null;
    }) =>
      result.savedToPhotos === true ||
      (typeof result.localPath === 'string' &&
        result.localPath.trim().toLowerCase().startsWith('ph://')) ||
      (typeof result.savedLocation === 'string' &&
        ['photos', 'pictures/lynavo drive', 'movies/lynavo drive'].includes(
          result.savedLocation.trim().toLowerCase(),
        )),
  ),
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
import {
  downloadReceivedLibraryItem,
  downloadResourceForGlobal,
} from '../../services/desktop-local-service';
import { viewDocument } from '@react-native-documents/viewer';
import { openFileWithOtherApp } from '../../utils/file-preview';
import { DownloadRecordsScreen } from '../DownloadRecordsScreen';

const mockedListDownloadRecords = listDownloadRecords as jest.MockedFunction<
  typeof listDownloadRecords
>;
const mockedViewDocument = viewDocument as jest.Mock;
const mockedOpenFileWithOtherApp = openFileWithOtherApp as jest.Mock;
const mockedDownloadReceivedLibraryItem =
  downloadReceivedLibraryItem as jest.Mock;
const mockedDownloadResourceForGlobal = downloadResourceForGlobal as jest.Mock;

describe('DownloadRecordsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVisualQaEnabled = false;
    NativeModules.NativeSyncEngine = {
      getBindingState: jest.fn().mockResolvedValue({
        host: '192.168.1.100',
      }),
    };
  });

  it('renders a dedicated empty download records page', async () => {
    mockedListDownloadRecords.mockResolvedValueOnce([]);

    const { getByText, queryByText } = render(<DownloadRecordsScreen />);

    await waitFor(() => {
      expect(getByText('Recent Downloads')).toBeTruthy();
      expect(getByText('No Recent Downloads')).toBeTruthy();
      expect(
        getByText(
          'Files downloaded from your computer to this device will appear here.',
        ),
      ).toBeTruthy();
    });
    expect(queryByText('Client-Handoff.mov')).toBeNull();
    expect(queryByText('Campaign-Keyframes.zip')).toBeNull();
  });

  it('renders visual QA mock downloads when the download history is empty', async () => {
    mockVisualQaEnabled = true;
    mockedListDownloadRecords.mockResolvedValueOnce([]);

    const { getByText, queryByText } = render(<DownloadRecordsScreen />);

    await waitFor(() => {
      expect(getByText('Client-Handoff.mov')).toBeTruthy();
      expect(getByText('Campaign-Keyframes.zip')).toBeTruthy();
    });
    expect(queryByText('No Recent Downloads')).toBeNull();
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

    const { getByText } = render(<DownloadRecordsScreen />);

    await waitFor(() => {
      expect(getByText('Vacation-01.JPG')).toBeTruthy();
      expect(getByText('Photo - 8.4 MB')).toBeTruthy();
    });
  });

  it('renders video record thumbnails as images and falls back to icon without thumbnailUrl', async () => {
    mockedListDownloadRecords.mockResolvedValueOnce([
      {
        id: 'video-with-thumb',
        resourceId: 'video-with-thumb',
        filename: 'clip.mov',
        mediaType: 'video',
        fileSize: 2048,
        downloadedAt: '2026-06-17T08:00:00.000Z',
        thumbnailUrl:
          'http://192.168.1.100:39394/personal/thumbnail/clip.mov?v=2048-1780000',
        streamUrl: 'http://192.168.1.100:39394/personal/stream/clip.mov',
      },
      {
        id: 'video-no-thumb',
        resourceId: 'video-no-thumb',
        filename: 'fallback.mov',
        mediaType: 'video',
        fileSize: 4096,
        downloadedAt: '2026-06-17T08:01:00.000Z',
        streamUrl: 'http://192.168.1.100:39394/personal/stream/fallback.mov',
      },
    ]);

    const { getByTestId, getByText, queryByTestId } = render(
      <DownloadRecordsScreen />,
    );

    await waitFor(() => {
      expect(getByText('clip.mov')).toBeTruthy();
      expect(getByText('fallback.mov')).toBeTruthy();
    });

    expect(
      getByTestId('download-record-thumbnail-video-with-thumb').props.source,
    ).toEqual({
      uri: 'http://192.168.1.100:39394/personal/thumbnail/clip.mov?v=2048-1780000',
    });
    expect(
      queryByTestId('download-record-thumbnail-video-no-thumb'),
    ).toBeNull();
    expect(getByText('preview-video')).toBeTruthy();
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

    const { getByTestId } = render(<DownloadRecordsScreen />);

    await waitFor(() => {
      expect(getByTestId('download-record-row-image-1')).toBeTruthy();
    });
    fireEvent.press(getByTestId('download-record-row-image-1'));

    expect(getByTestId('download-record-preview-image').props.source).toEqual({
      uri: 'https://desktop.local/full.jpg',
    });
  });

  it('renders image record thumbnails from the full preview source when available', async () => {
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
    const recordDiagnosticsLog = jest.fn();
    NativeModules.NativeSyncEngine.recordDiagnosticsLog = recordDiagnosticsLog;

    const { getByTestId } = render(<DownloadRecordsScreen />);

    await waitFor(() => {
      expect(getByTestId('download-record-thumbnail-image-1')).toBeTruthy();
    });

    expect(
      getByTestId('download-record-thumbnail-image-1').props.source,
    ).toEqual({
      uri: 'https://desktop.local/full.jpg',
    });
    expect(recordDiagnosticsLog).toHaveBeenCalledWith(
      'DownloadRecords',
      expect.stringContaining('thumbnail render state'),
    );
    expect(recordDiagnosticsLog).toHaveBeenCalledWith(
      'DownloadRecords',
      expect.stringContaining('thumbnailSource=previewUrl'),
    );
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

    const { getByTestId } = render(<DownloadRecordsScreen />);

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

  it('download button shares a local file or re-downloads from a computer record', async () => {
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
    mockedDownloadResourceForGlobal.mockResolvedValueOnce({
      savedToPhotos: false,
      localPath: '/downloads/Missing.pdf',
      savedLocation: 'Downloads/Lynavo Drive',
    });

    const { getByTestId } = render(<DownloadRecordsScreen />);

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
      expect(mockedDownloadResourceForGlobal).toHaveBeenCalledWith(
        { host: '192.168.1.100', port: 39394 },
        'missing-1',
        'Missing.pdf',
        'application/pdf',
      );
      expect(alertSpy).toHaveBeenCalledWith(
        'Download complete',
        'Missing.pdf saved to Files',
      );
    });
  });

  it('re-downloads a recent received image saved to Photos even when localPath is missing', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    mockedListDownloadRecords.mockResolvedValueOnce([
      {
        id: 'received-image-1',
        resourceId:
          '50cd567dd5610903b1016351646a7f910f3df6525b53ade18646f14a238260be',
        filename: 'CAP_5FA32EEE-723F-4B25-ABB7-1EF7B23290FA.jpg',
        fileSize: 267404,
        mediaType: 'image',
        downloadedAt: '2026-06-18T09:16:54.000Z',
        previewUrl:
          'http://192.168.1.100:39394/resources/mobile/received/preview?fileKey=50cd567dd5610903b1016351646a7f910f3df6525b53ade18646f14a238260be',
        thumbnailUrl:
          'http://192.168.1.100:39394/resources/mobile/received/thumbnail?fileKey=50cd567dd5610903b1016351646a7f910f3df6525b53ade18646f14a238260be',
        savedToPhotos: true,
        localPath: null,
      },
    ]);
    mockedDownloadReceivedLibraryItem.mockResolvedValueOnce({
      savedToPhotos: true,
      localPath: null,
      savedLocation: 'Photos',
    });

    const { getByTestId } = render(<DownloadRecordsScreen />);

    await waitFor(() => {
      expect(
        getByTestId('download-record-download-received-image-1'),
      ).toBeTruthy();
    });
    fireEvent.press(getByTestId('download-record-download-received-image-1'));

    await waitFor(() => {
      expect(mockedDownloadReceivedLibraryItem).toHaveBeenCalledWith(
        { host: '192.168.1.100', port: 39394 },
        expect.objectContaining({
          fileKey:
            '50cd567dd5610903b1016351646a7f910f3df6525b53ade18646f14a238260be',
          filename: 'CAP_5FA32EEE-723F-4B25-ABB7-1EF7B23290FA.jpg',
          mediaType: 'image',
        }),
      );
      expect(mockedDownloadResourceForGlobal).not.toHaveBeenCalled();
      expect(alertSpy).toHaveBeenCalledWith(
        'Download complete',
        'CAP_5FA32EEE-723F-4B25-ABB7-1EF7B23290FA.jpg saved to Photos',
      );
    });
  });
});
