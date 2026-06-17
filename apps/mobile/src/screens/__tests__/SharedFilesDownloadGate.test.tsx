import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { Alert, NativeModules } from 'react-native';

let mockVisualQaEnabled = false;

// Mock react-native-localize
jest.mock('react-native-localize', () => ({
  getLocales: () => [
    {
      languageCode: 'zh',
      scriptCode: 'Hant',
      countryCode: 'TW',
      languageTag: 'zh-Hant-TW',
      isRTL: false,
    },
  ],
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: any) => {
      const map: Record<string, string> = {
        'sharedFiles.loading': '載入中...',
        'sharedFiles.deviceUnavailable.title': '設備不可用',
        'sharedFiles.deviceUnavailable.message': '請先連接設備',
        'sharedFiles.emptyState.title': '目前沒有內容',
        'sharedFiles.emptyState.message': '同步完成後，檔案將顯示在這裡',
        'sharedFiles.dialogs.downloadComplete': '下載完成',
        'sharedFiles.scopes.team': '檔案共享',
        'sharedFiles.scopes.shared': '已分享的資源',
        'sharedFiles.scopes.received': '已接收的檔案',
        'sharedFiles.networkError.title': '載入失敗',
        'sharedFiles.networkError.message': '請稍後重試',
        'sharedFiles.dialogs.downloadFailed': '下載失敗',
        'sharedFiles.dialogs.downloadFailedMessage': '無法下載檔案，请稍後重試',
        'sharedFiles.dialogs.previewFailed': '預覽失敗',
        'sharedFiles.dialogs.previewFailedMessage': '無法取得檔案預覽',
        'sharedFiles.title': '遠端資源',
        'sharedFiles.phoneSyncSpace.title': '手機同步空間',
        'sharedFiles.phoneSyncSpace.desc': '檢視已同步至电脑的檔案與上传来源',
        'sharedFiles.phoneSyncSpace.empty': '尚無同步檔案',
        'sharedFiles.remoteAccess.title': '遠端訪問電腦',
        'sharedFiles.remoteAccess.desc': '流覽電腦端共享的目錄結構並下載文件',
        'sharedFiles.remoteAccess.empty': '此資料夾為空',
        'sharedFiles.remoteAccess.select': '選擇',
        'sharedFiles.remoteAccess.done': '完成',
        'sharedFiles.remoteAccess.download': '下載',
        'sharedFiles.remoteAccess.share': '分享',
        'sharedFiles.remoteAccess.selectedCount': `已選擇 ${options?.count ?? 0} 個`,
      };
      if (
        key === 'sharedFiles.dialogs.downloadSavedToPhotos' &&
        options?.name
      ) {
        return `${options.name} 已儲存至相簿`;
      }
      return map[key] || key;
    },
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
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

jest.mock('../../components/GlobalBottomTabBar', () => ({
  GlobalBottomTabBar: () => null,
}));

jest.mock('../../components/shared/ModalBlurBackdrop', () => ({
  ModalBlurBackdrop: () => null,
}));

jest.mock('react-native-video', () => 'Video');

jest.mock('@react-native-documents/viewer', () => ({
  viewDocument: jest.fn(),
}));

jest.mock('react-native-svg', () => {
  const ReactInner = require('react');
  const { View } = require('react-native');
  const createSvgMock =
    (name: string) =>
    ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
      ReactInner.createElement(
        View,
        { testID: testID ?? `svg-${name}` },
        children,
      );
  return {
    __esModule: true,
    default: createSvgMock('Svg'),
    Svg: createSvgMock('Svg'),
    Circle: createSvgMock('Circle'),
    ClipPath: createSvgMock('ClipPath'),
    Defs: createSvgMock('Defs'),
    Ellipse: createSvgMock('Ellipse'),
    G: createSvgMock('G'),
    Line: createSvgMock('Line'),
    LinearGradient: createSvgMock('LinearGradient'),
    Mask: createSvgMock('Mask'),
    Path: createSvgMock('Path'),
    Polygon: createSvgMock('Polygon'),
    Polyline: createSvgMock('Polyline'),
    Rect: createSvgMock('Rect'),
    Stop: createSvgMock('Stop'),
  };
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockCanGoBack = jest.fn(() => true);
const mockReset = jest.fn();
const mockDispatch = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    canGoBack: mockCanGoBack,
    reset: mockReset,
    dispatch: mockDispatch,
  }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const ReactInner = require('react');
    ReactInner.useEffect(effect, [effect]);
  },
}));

jest.mock('../../stores/auth-store', () => ({
  useAuth: () => ({
    subscription: { status: 'subscribed' },
  }),
}));

jest.mock('../../dev/visualQa', () => ({
  isVisualQaEnabled: () => mockVisualQaEnabled,
}));

// Mock local desktop service
jest.mock('../../services/desktop-local-service', () => ({
  listSharedResources: jest.fn(),
  listSharedFolderContents: jest.fn(),
  listReceivedLibrary: jest.fn(),
  listCurrentClientReceivedLibrary: jest.fn(),
  downloadResource: jest.fn(),
  downloadResourceForGlobal: jest.fn(),
  getResourcePreviewUrl: jest.fn(),
  prepareResourcePreview: jest.fn(),
  shareResources: jest.fn(),
  isDownloadSavedLocally: jest.fn(
    (result: { savedToPhotos?: boolean; localPath?: string | null }) =>
      result.savedToPhotos === true ||
      (typeof result.localPath === 'string' &&
        result.localPath.trim().length > 0),
  ),
}));

jest.mock('../../services/download-records-service', () => ({
  recordDownloadedFile: jest.fn(),
}));

import {
  SharedFilesScreen,
  normalizeDirectoryPath,
  parentDirectoryPath,
} from '../SharedFilesScreen';
import { RemoteAccessScreen } from '../RemoteAccessScreen';
import {
  listSharedResources,
  listSharedFolderContents,
  listReceivedLibrary,
  listCurrentClientReceivedLibrary,
  downloadResource,
  downloadResourceForGlobal,
  getResourcePreviewUrl,
  prepareResourcePreview,
  shareResources,
} from '../../services/desktop-local-service';
import { recordDownloadedFile } from '../../services/download-records-service';
import { viewDocument } from '@react-native-documents/viewer';
import { SharedFilesGlobalScreen } from '../SharedFilesGlobalScreen';
import { RemoteAccessGlobalScreen } from '../RemoteAccessGlobalScreen';
import { PhoneSyncSpaceGlobalScreen } from '../PhoneSyncSpaceGlobalScreen';
import { PhoneSyncSpaceScreen } from '../PhoneSyncSpaceScreen';

const mockListSharedResources = listSharedResources as jest.Mock;
const mockListSharedFolderContents = listSharedFolderContents as jest.Mock;
const mockListReceivedLibrary = listReceivedLibrary as jest.Mock;
const mockListCurrentClientReceivedLibrary =
  listCurrentClientReceivedLibrary as jest.Mock;
const mockDownloadResource = downloadResource as jest.Mock;
const mockDownloadResourceForGlobal = downloadResourceForGlobal as jest.Mock;
const mockGetResourcePreviewUrl = getResourcePreviewUrl as jest.Mock;
const mockPrepareResourcePreview = prepareResourcePreview as jest.Mock;
const mockShareResources = shareResources as jest.Mock;
const mockRecordDownloadedFile = recordDownloadedFile as jest.Mock;
const mockViewDocument = viewDocument as jest.Mock;

class TestErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: any, errorInfo: any) {
    console.error('TEST ERROR BOUNDARY CAUGHT:', error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}

describe('SharedFilesScreen Helpers', () => {
  test('normalizeDirectoryPath normalizes directory paths', () => {
    expect(normalizeDirectoryPath(' Projects/June ')).toBe('Projects/June');
    expect(normalizeDirectoryPath('/Projects/June/')).toBe('Projects/June');
    expect(normalizeDirectoryPath('Projects\\June')).toBe('Projects/June');
  });

  test('parentDirectoryPath returns parent directory path', () => {
    expect(parentDirectoryPath('Projects/June')).toBe('Projects');
    expect(parentDirectoryPath('/Projects/June/')).toBe('Projects');
    expect(parentDirectoryPath('Projects')).toBe('');
    expect(parentDirectoryPath('')).toBe('');
  });
});

describe('SharedFilesScreen V2 (Landing Menu)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVisualQaEnabled = false;
  });

  it('renders landing page with correct options', () => {
    const { getByText } = render(
      <TestErrorBoundary>
        <SharedFilesScreen />
      </TestErrorBoundary>,
    );

    expect(getByText('手機同步空間')).toBeTruthy();
    expect(getByText('遠端訪問電腦')).toBeTruthy();
  });

  it('navigates to PhoneSyncSpace on card press', () => {
    const { getByText } = render(
      <TestErrorBoundary>
        <SharedFilesScreen />
      </TestErrorBoundary>,
    );

    fireEvent.press(getByText('手機同步空間'));
    expect(mockNavigate).toHaveBeenCalledWith('PhoneSyncSpace');
  });

  it('navigates to RemoteAccess on card press', () => {
    const { getByText } = render(
      <TestErrorBoundary>
        <SharedFilesScreen />
      </TestErrorBoundary>,
    );

    fireEvent.press(getByText('遠端訪問電腦'));
    expect(mockNavigate).toHaveBeenCalledWith('RemoteAccess');
  });
});

describe('SharedFilesGlobalScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVisualQaEnabled = false;
  });

  it('uses neutral landing copy instead of fake daily counts', () => {
    const { getByText, queryByText } = render(
      <SharedFilesGlobalScreen showBottomTabBar={false} />,
    );

    expect(getByText('同步后显示')).toBeTruthy();
    expect(queryByText('今日 5 个')).toBeNull();
  });
});

describe('RemoteAccessGlobalScreen', () => {
  const mockBindingState = jest.fn();
  const testGlobal = globalThis as typeof globalThis & {
    __SYNCFLOW_REMOTE_RESOURCES_PREVIEW__?: boolean;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockVisualQaEnabled = false;
    delete testGlobal.__SYNCFLOW_REMOTE_RESOURCES_PREVIEW__;
    (NativeModules as Record<string, unknown>).NativeSyncEngine = {
      getBindingState: mockBindingState,
      addListener: jest.fn(),
      removeListeners: jest.fn(),
    };
    mockBindingState.mockResolvedValue({
      deviceId: 'desktop-device-id',
      host: '192.168.1.100',
      connectionState: 'connected',
    });
  });

  it('keeps an empty real response empty unless the remote preview gate is explicit', async () => {
    mockVisualQaEnabled = true;
    mockListSharedResources.mockResolvedValueOnce([]);

    const { getByTestId, getByText, queryByText } = render(
      <TestErrorBoundary>
        <RemoteAccessGlobalScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(mockListSharedResources).toHaveBeenCalledWith({
        host: '192.168.1.100',
        port: 39394,
      });
    });

    await waitFor(() => {
      expect(getByText('暂无文件')).toBeTruthy();
    });
    expect(getByTestId('remote-access-empty-icon-remote')).toBeTruthy();
    expect(queryByText('Mac 客户端安装手册-2506.docx')).toBeNull();
    expect(queryByText('document-outline')).toBeNull();
  });

  it('uses the bound desktop name in the production subtitle', async () => {
    mockBindingState.mockResolvedValueOnce({
      deviceId: 'desktop-device-id',
      deviceName: 'Studio Mini',
      deviceAlias: 'Edit Bay',
      host: '192.168.1.100',
      connectionState: 'connected',
    });
    mockListSharedResources.mockResolvedValueOnce([]);

    const { getByText, queryByText } = render(
      <TestErrorBoundary>
        <RemoteAccessGlobalScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('Edit Bay / 用户目录')).toBeTruthy();
    });
    expect(queryByText('MacBook Pro / 用户目录')).toBeNull();
  });

  it('loads real shared folder contents when a production folder is opened', async () => {
    mockListSharedResources.mockResolvedValueOnce([
      {
        resourceId: 'res-folder',
        desktopDeviceId: 'desktop-device-id',
        displayName: 'Project Files',
        kind: 'shared_folder',
        status: 'available',
        addedAt: '2026-06-16T08:00:00.000Z',
        downloadCount: 0,
      },
    ]);
    mockListSharedFolderContents.mockResolvedValueOnce({
      path: '',
      files: [
        {
          name: 'Contracts',
          path: 'Contracts',
          type: 'other',
          size: 96,
          modifiedAt: '2026-06-16T08:30:00.000Z',
          isDirectory: true,
        },
        {
          name: 'brief.pdf',
          path: 'brief.pdf',
          type: 'document',
          size: 2048,
          modifiedAt: '2026-06-16T08:31:00.000Z',
        },
      ],
      totalCount: 2,
    });

    const { getByText } = render(
      <TestErrorBoundary>
        <RemoteAccessGlobalScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('Project Files')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText('Project Files'));
    });

    await waitFor(() => {
      expect(mockListSharedFolderContents).toHaveBeenCalledWith(
        { host: '192.168.1.100', port: 39394 },
        'res-folder',
        '',
      );
      expect(getByText('Contracts')).toBeTruthy();
      expect(getByText('brief.pdf')).toBeTruthy();
    });
  });

  it('renders the reference-style media type icons in the global remote access list', async () => {
    mockListSharedResources.mockResolvedValueOnce([
      {
        resourceId: 'res-folder',
        desktopDeviceId: 'desktop-device-id',
        displayName: 'Project Files',
        kind: 'shared_folder',
        status: 'available',
        addedAt: '2026-06-16T08:00:00.000Z',
        downloadCount: 0,
      },
      {
        resourceId: 'res-image',
        desktopDeviceId: 'desktop-device-id',
        displayName: 'cover.png',
        kind: 'shared_file',
        fileSize: 1024,
        mediaType: 'image',
        status: 'available',
        addedAt: '2026-06-16T08:01:00.000Z',
        downloadCount: 0,
      },
      {
        resourceId: 'res-video',
        desktopDeviceId: 'desktop-device-id',
        displayName: 'demo.mov',
        kind: 'shared_file',
        fileSize: 2048,
        mediaType: 'video',
        status: 'available',
        addedAt: '2026-06-16T08:02:00.000Z',
        downloadCount: 0,
      },
      {
        resourceId: 'res-doc',
        desktopDeviceId: 'desktop-device-id',
        displayName: 'readme.txt',
        kind: 'shared_file',
        fileSize: 512,
        mediaType: 'document',
        status: 'available',
        addedAt: '2026-06-16T08:03:00.000Z',
        downloadCount: 0,
      },
    ]);

    const { getByTestId } = render(
      <TestErrorBoundary>
        <RemoteAccessGlobalScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByTestId('remote-resource-icon-folder')).toBeTruthy();
      expect(getByTestId('remote-resource-icon-photo')).toBeTruthy();
      expect(getByTestId('remote-resource-icon-video')).toBeTruthy();
      expect(getByTestId('remote-resource-icon-file')).toBeTruthy();
    });
  });

  it('uses reference lucide toolbar icons instead of Ionicons glyph mappings', async () => {
    mockListSharedResources.mockResolvedValueOnce([]);

    const { queryAllByTestId, queryByText } = render(
      <TestErrorBoundary>
        <RemoteAccessGlobalScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(
        queryAllByTestId('remote-toolbar-sort-icon').length,
      ).toBeGreaterThan(0);
      expect(
        queryAllByTestId('remote-toolbar-list-icon').length,
      ).toBeGreaterThan(0);
      expect(
        queryAllByTestId('remote-toolbar-grid-icon').length,
      ).toBeGreaterThan(0);
    });
    expect(queryByText('list-outline')).toBeNull();
    expect(queryByText('grid-outline')).toBeNull();
  });

  it('uses neutral production copy when no desktop is bound', async () => {
    mockBindingState.mockResolvedValueOnce(null);

    const { getByText, queryByText } = render(
      <TestErrorBoundary>
        <RemoteAccessGlobalScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('尚未连接电脑')).toBeTruthy();
    });
    expect(queryByText('MacBook Pro / 用户目录')).toBeNull();
  });

  it('keeps the demo desktop subtitle behind the explicit remote resources preview gate', async () => {
    testGlobal.__SYNCFLOW_REMOTE_RESOURCES_PREVIEW__ = true;
    mockBindingState.mockResolvedValueOnce(null);

    const { getByText } = render(
      <TestErrorBoundary>
        <RemoteAccessGlobalScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('MacBook Pro / 用户目录')).toBeTruthy();
    });
  });

  it('records a saved global remote download after native persistence succeeds', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockListSharedResources.mockResolvedValueOnce([
      {
        resourceId: 'res-1',
        desktopDeviceId: 'desktop-device-id',
        displayName: 'alpha.jpg',
        kind: 'shared_file',
        fileSize: 1024,
        mediaType: 'image',
        status: 'available',
        addedAt: '2026-06-16T08:00:00.000Z',
        downloadCount: 0,
      },
    ]);
    mockDownloadResourceForGlobal.mockResolvedValueOnce({
      savedToPhotos: false,
      localPath: '/local/alpha.jpg',
    });

    const { getByText } = render(
      <TestErrorBoundary>
        <RemoteAccessGlobalScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('alpha.jpg')).toBeTruthy();
    });

    fireEvent.press(getByText('download-outline'));

    await waitFor(() => {
      expect(mockDownloadResourceForGlobal).toHaveBeenCalledWith(
        { host: '192.168.1.100', port: 39394 },
        'res-1',
        'alpha.jpg',
        'image',
      );
    });
    expect(mockRecordDownloadedFile).toHaveBeenCalledWith({
      resourceId: 'res-1',
      filename: 'alpha.jpg',
      fileSize: 1024,
      mediaType: 'image',
      localPath: '/local/alpha.jpg',
      savedToPhotos: false,
    });
    expect(alertSpy).toHaveBeenCalledWith(
      '下載完成',
      'alpha.jpg 已保存至 /local/alpha.jpg',
    );

    alertSpy.mockRestore();
  });

  it('runs the global download gate for every selected file instead of only the first selection', async () => {
    mockListSharedResources.mockResolvedValueOnce([
      {
        resourceId: 'res-1',
        desktopDeviceId: 'desktop-device-id',
        displayName: 'alpha.jpg',
        kind: 'shared_file',
        fileSize: 1024,
        mediaType: 'image',
        status: 'available',
        addedAt: '2026-06-16T08:00:00.000Z',
        downloadCount: 0,
      },
      {
        resourceId: 'res-2',
        desktopDeviceId: 'desktop-device-id',
        displayName: 'beta.mov',
        kind: 'shared_file',
        fileSize: 2048,
        mediaType: 'video',
        status: 'available',
        addedAt: '2026-06-16T08:01:00.000Z',
        downloadCount: 0,
      },
    ]);
    mockDownloadResourceForGlobal.mockResolvedValue({
      savedToPhotos: false,
      localPath: null,
    });

    const { getByText } = render(
      <TestErrorBoundary>
        <RemoteAccessGlobalScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('alpha.jpg')).toBeTruthy();
      expect(getByText('beta.mov')).toBeTruthy();
    });

    fireEvent.press(getByText('選擇'));
    fireEvent.press(getByText('alpha.jpg'));
    fireEvent.press(getByText('beta.mov'));
    fireEvent.press(getByText('下载'));

    await waitFor(() => {
      expect(mockDownloadResourceForGlobal).toHaveBeenCalledTimes(2);
    });
    expect(mockDownloadResourceForGlobal).toHaveBeenNthCalledWith(
      1,
      { host: '192.168.1.100', port: 39394 },
      'res-1',
      'alpha.jpg',
      'image',
    );
    expect(mockDownloadResourceForGlobal).toHaveBeenNthCalledWith(
      2,
      { host: '192.168.1.100', port: 39394 },
      'res-2',
      'beta.mov',
      'video',
    );
  });

  it('opens the system share flow for selected global remote files', async () => {
    mockListSharedResources.mockResolvedValueOnce([
      {
        resourceId: 'res-1',
        desktopDeviceId: 'desktop-device-id',
        displayName: 'alpha.jpg',
        kind: 'shared_file',
        fileSize: 1024,
        mediaType: 'image',
        status: 'available',
        addedAt: '2026-06-16T08:00:00.000Z',
        downloadCount: 0,
      },
    ]);
    mockShareResources.mockResolvedValueOnce(undefined);

    const { getByText } = render(
      <TestErrorBoundary>
        <RemoteAccessGlobalScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('alpha.jpg')).toBeTruthy();
    });

    fireEvent.press(getByText('選擇'));
    fireEvent.press(getByText('alpha.jpg'));
    fireEvent.press(getByText('分享'));

    await waitFor(() => {
      expect(mockShareResources).toHaveBeenCalledWith(
        { host: '192.168.1.100', port: 39394 },
        [{ resourceId: 'res-1', displayName: 'alpha.jpg' }],
      );
    });
  });

  it('opens a global remote document with the system preview viewer', async () => {
    mockListSharedResources.mockResolvedValueOnce([
      {
        resourceId: 'res-doc',
        desktopDeviceId: 'desktop-device-id',
        displayName: 'manual.pdf',
        kind: 'shared_file',
        fileSize: 1024,
        mediaType: 'document',
        status: 'available',
        addedAt: '2026-06-16T08:00:00.000Z',
        downloadCount: 0,
      },
    ]);
    mockPrepareResourcePreview.mockResolvedValueOnce('/cache/manual.pdf');
    mockViewDocument.mockResolvedValueOnce(undefined);

    const { getByText } = render(
      <TestErrorBoundary>
        <RemoteAccessGlobalScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('manual.pdf')).toBeTruthy();
    });

    fireEvent.press(getByText('manual.pdf'));

    await waitFor(() => {
      expect(mockPrepareResourcePreview).toHaveBeenCalledWith(
        { host: '192.168.1.100', port: 39394 },
        'res-doc',
        'manual.pdf',
      );
    });
    expect(mockViewDocument).toHaveBeenCalledWith({
      uri: '/cache/manual.pdf',
      headerTitle: 'manual.pdf',
      mimeType: 'application/pdf',
    });
  });

  it('opens a global remote image inside the app preview instead of the system viewer', async () => {
    mockListSharedResources.mockResolvedValueOnce([
      {
        resourceId: 'res-image',
        desktopDeviceId: 'desktop-device-id',
        displayName: 'cover.png',
        kind: 'shared_file',
        fileSize: 1024,
        mediaType: 'image',
        status: 'available',
        addedAt: '2026-06-16T08:00:00.000Z',
        downloadCount: 0,
      },
    ]);
    mockGetResourcePreviewUrl.mockResolvedValueOnce(
      'http://192.168.1.100:39394/resources/mobile/download/res-image',
    );

    const { getByTestId, getByText } = render(
      <TestErrorBoundary>
        <RemoteAccessGlobalScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('cover.png')).toBeTruthy();
    });

    fireEvent.press(getByText('cover.png'));

    await waitFor(() => {
      expect(mockGetResourcePreviewUrl).toHaveBeenCalledWith(
        { host: '192.168.1.100', port: 39394 },
        'res-image',
      );
      expect(getByTestId('remote-resource-preview-image')).toBeTruthy();
    });
    expect(mockPrepareResourcePreview).not.toHaveBeenCalled();
    expect(mockViewDocument).not.toHaveBeenCalled();
  });
});

describe('PhoneSyncSpaceGlobalScreen', () => {
  const mockBindingState = jest.fn();
  const testGlobal = globalThis as typeof globalThis & {
    __SYNCFLOW_REMOTE_RESOURCES_PREVIEW__?: boolean;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockVisualQaEnabled = false;
    delete testGlobal.__SYNCFLOW_REMOTE_RESOURCES_PREVIEW__;
    (NativeModules as Record<string, unknown>).NativeSyncEngine = {
      getBindingState: mockBindingState,
      addListener: jest.fn(),
      removeListeners: jest.fn(),
    };
    mockBindingState.mockResolvedValue({
      deviceId: 'desktop-device-id',
      host: '192.168.1.100',
      connectionState: 'connected',
    });
  });

  it('keeps an empty real received library empty unless the remote preview gate is explicit', async () => {
    mockVisualQaEnabled = true;
    mockListCurrentClientReceivedLibrary.mockResolvedValueOnce([]);

    const { getByTestId, getByText, queryByText } = render(
      <TestErrorBoundary>
        <PhoneSyncSpaceGlobalScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(mockListCurrentClientReceivedLibrary).toHaveBeenCalledWith({
        host: '192.168.1.100',
        port: 39394,
      });
    });

    await waitFor(() => {
      expect(getByText('尚無同步檔案')).toBeTruthy();
    });
    expect(getByTestId('phone-sync-empty-icon')).toBeTruthy();
    expect(queryByText('IMG_8421.JPG')).toBeNull();
  });

  it('renders received image thumbnail and opens the real image preview', async () => {
    mockListCurrentClientReceivedLibrary.mockResolvedValueOnce([
      {
        resourceId: 'received-1',
        desktopDeviceId: 'desktop-device-id',
        clientId: 'client-001',
        displayName: 'alpha.jpg',
        fileKey: 'received/alpha.jpg',
        filename: 'alpha.jpg',
        mediaType: 'image',
        fileSize: 1024,
        completedAt: '2026-06-16T08:00:00.000Z',
        shareStatus: 'shared',
        thumbnailUrl:
          'http://192.168.1.100:39394/resources/mobile/received/thumbnail?fileKey=received-1',
        previewUrl:
          'http://192.168.1.100:39394/resources/mobile/received/preview?fileKey=received-1',
      },
    ]);

    const {
      getByLabelText,
      getByTestId,
      getByText,
      queryAllByTestId,
      queryByLabelText,
    } = render(
      <TestErrorBoundary>
        <PhoneSyncSpaceGlobalScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('alpha.jpg')).toBeTruthy();
    });

    expect(getByTestId('phone-sync-thumbnail-image')).toBeTruthy();
    expect(queryByLabelText('保存暂不可用')).toBeNull();
    expect(queryAllByTestId('phone-sync-download-icon').length).toBeGreaterThan(0);

    const previewButton = getByLabelText('预览已同步文件');
    expect(previewButton.props.accessibilityState?.disabled).not.toBe(true);

    fireEvent.press(previewButton);
    expect(getByTestId('phone-sync-preview-image')).toBeTruthy();
  });

  it('renders received video preview frame and opens the real video preview', async () => {
    mockListCurrentClientReceivedLibrary.mockResolvedValueOnce([
      {
        resourceId: 'received-video',
        desktopDeviceId: 'desktop-device-id',
        clientId: 'client-001',
        displayName: 'beta.mov',
        fileKey: 'received/beta.mov',
        filename: 'beta.mov',
        mediaType: 'video',
        fileSize: 2048,
        completedAt: '2026-06-16T07:00:00.000Z',
        shareStatus: 'shared',
        previewUrl:
          'http://192.168.1.100:39394/resources/mobile/received/preview?fileKey=received-video',
        streamUrl:
          'http://192.168.1.100:39394/resources/mobile/received/stream?fileKey=received-video',
      },
    ]);

    const { getByLabelText, getByTestId, getByText } = render(
      <TestErrorBoundary>
        <PhoneSyncSpaceGlobalScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('beta.mov')).toBeTruthy();
    });

    expect(getByTestId('phone-sync-thumbnail-video')).toBeTruthy();

    fireEvent.press(getByLabelText('预览已同步文件'));
    expect(getByTestId('phone-sync-preview-video')).toBeTruthy();
  });

  it('opens the received image preview when the global sync-space row is pressed', async () => {
    mockListCurrentClientReceivedLibrary.mockResolvedValueOnce([
      {
        resourceId: 'received-image',
        desktopDeviceId: 'desktop-device-id',
        clientId: 'client-001',
        displayName: 'alpha.jpg',
        fileKey: 'received/alpha.jpg',
        filename: 'alpha.jpg',
        mediaType: 'image',
        fileSize: 1024,
        completedAt: '2026-06-16T08:00:00.000Z',
        shareStatus: 'shared',
        previewUrl:
          'http://192.168.1.100:39394/resources/mobile/received/preview?fileKey=received-image',
      },
    ]);

    const { getByTestId, getByText } = render(
      <TestErrorBoundary>
        <PhoneSyncSpaceGlobalScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('alpha.jpg')).toBeTruthy();
    });

    fireEvent.press(getByText('alpha.jpg'));
    expect(getByTestId('phone-sync-preview-image')).toBeTruthy();
  });

  it('opens received documents from global sync space with the system preview viewer', async () => {
    mockListCurrentClientReceivedLibrary.mockResolvedValueOnce([
      {
        resourceId: 'received-doc',
        desktopDeviceId: 'desktop-device-id',
        clientId: 'client-001',
        displayName: 'notes.pdf',
        fileKey: 'received/notes.pdf',
        filename: 'notes.pdf',
        mediaType: 'document',
        fileSize: 512,
        completedAt: '2026-06-16T06:00:00.000Z',
        shareStatus: 'shared',
      },
    ]);
    mockPrepareResourcePreview.mockResolvedValueOnce('/cache/notes.pdf');
    mockViewDocument.mockResolvedValueOnce(undefined);

    const { getByText } = render(
      <TestErrorBoundary>
        <PhoneSyncSpaceGlobalScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('notes.pdf')).toBeTruthy();
    });

    fireEvent.press(getByText('notes.pdf'));

    await waitFor(() => {
      expect(mockPrepareResourcePreview).toHaveBeenCalledWith(
        { host: '192.168.1.100', port: 39394 },
        'received-doc',
        'notes.pdf',
      );
    });
    expect(mockViewDocument).toHaveBeenCalledWith({
      uri: '/cache/notes.pdf',
      headerTitle: 'notes.pdf',
      mimeType: 'application/pdf',
    });
  });

  it('uses received-library filename as the global sync-space row title', async () => {
    mockListCurrentClientReceivedLibrary.mockResolvedValueOnce([
      {
        resourceId: '',
        desktopDeviceId: 'desktop-device-id',
        clientId: 'client-001',
        displayName: 'iPhone 17 Pro',
        fileKey: 'received/IMG_0003.JPG',
        filename: 'IMG_0003.JPG',
        mediaType: 'image',
        fileSize: 2505426,
        completedAt: '2026-06-17T02:10:27.000Z',
        shareStatus: 'shared',
      },
      {
        resourceId: '',
        desktopDeviceId: 'desktop-device-id',
        clientId: 'client-001',
        displayName: 'iPhone 17 Pro',
        fileKey: 'received/sync-activity-panel.png',
        filename: 'sync-activity-panel.png',
        mediaType: 'image',
        fileSize: 1024,
        completedAt: '2026-06-17T02:10:28.000Z',
        shareStatus: 'shared',
      },
    ]);

    const { getByText } = render(
      <TestErrorBoundary>
        <PhoneSyncSpaceGlobalScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('IMG_0003.JPG')).toBeTruthy();
      expect(getByText('sync-activity-panel.png')).toBeTruthy();
    });
  });

  it('uses reference lucide icons instead of Ionicons glyph mappings', async () => {
    mockListCurrentClientReceivedLibrary.mockResolvedValueOnce([
      {
        resourceId: 'received-photo',
        desktopDeviceId: 'desktop-device-id',
        clientId: 'client-001',
        displayName: 'alpha.jpg',
        fileKey: 'received/alpha.jpg',
        filename: 'alpha.jpg',
        mediaType: 'image',
        fileSize: 1024,
        completedAt: '2026-06-16T08:00:00.000Z',
        shareStatus: 'shared',
      },
      {
        resourceId: 'received-video',
        desktopDeviceId: 'desktop-device-id',
        clientId: 'client-001',
        displayName: 'beta.mov',
        fileKey: 'received/beta.mov',
        filename: 'beta.mov',
        mediaType: 'video',
        fileSize: 2048,
        completedAt: '2026-06-16T07:00:00.000Z',
        shareStatus: 'missing',
      },
      {
        resourceId: 'received-file',
        desktopDeviceId: 'desktop-device-id',
        clientId: 'client-001',
        displayName: 'notes.pdf',
        fileKey: 'received/notes.pdf',
        filename: 'notes.pdf',
        mediaType: 'document',
        fileSize: 512,
        completedAt: '2026-06-16T06:00:00.000Z',
        shareStatus: 'shared',
      },
    ]);

    const { getByText, queryAllByTestId, queryByText } = render(
      <TestErrorBoundary>
        <PhoneSyncSpaceGlobalScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('alpha.jpg')).toBeTruthy();
      expect(queryAllByTestId('phone-sync-sort-icon').length).toBeGreaterThan(
        0,
      );
      expect(
        queryAllByTestId('phone-sync-media-icon-photo').length,
      ).toBeGreaterThan(0);
      expect(
        queryAllByTestId('phone-sync-media-icon-video').length,
      ).toBeGreaterThan(0);
      expect(
        queryAllByTestId('phone-sync-media-icon-file').length,
      ).toBeGreaterThan(0);
      expect(
        queryAllByTestId('phone-sync-preview-icon').length,
      ).toBeGreaterThan(0);
    });
    expect(queryByText('list-outline')).toBeNull();
    expect(queryByText('download-outline')).toBeNull();
    expect(queryAllByTestId('phone-sync-download-icon').length).toBeGreaterThan(0);
    expect(queryByText('folder-open-outline')).toBeNull();
    expect(queryByText('document-text')).toBeNull();
  });
});

describe('RemoteAccessScreen', () => {
  const mockBindingState = jest.fn();

  beforeAll(() => {
    (NativeModules as Record<string, unknown>).NativeSyncEngine = {
      getBindingState: mockBindingState,
      addListener: jest.fn(),
      removeListeners: jest.fn(),
    };
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockBindingState.mockResolvedValue({
      deviceId: 'desktop-device-id',
      host: '192.168.1.100',
      connectionState: 'connected',
    });
  });

  it('renders empty root list when no device is bound', async () => {
    mockBindingState.mockResolvedValueOnce(null);
    const { getByText } = render(
      <TestErrorBoundary>
        <RemoteAccessScreen />
      </TestErrorBoundary>,
    );
    await waitFor(() => {
      expect(getByText('此資料夾為空')).toBeTruthy();
    });
  });

  it('renders list of shared resources', async () => {
    mockListSharedResources.mockResolvedValueOnce([
      {
        resourceId: 'res-1',
        displayName: 'test-folder',
        kind: 'shared_folder',
        fileSize: 0,
      },
      {
        resourceId: 'res-2',
        displayName: 'photo.jpg',
        kind: 'shared_file',
        fileSize: 1572864, // 1.5 MB
      },
    ]);

    const { getByText } = render(
      <TestErrorBoundary>
        <RemoteAccessScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('test-folder')).toBeTruthy();
      expect(getByText('photo.jpg')).toBeTruthy();
    });
  });

  it('loads real folder contents when a folder is opened', async () => {
    mockListSharedResources.mockResolvedValueOnce([
      {
        resourceId: 'res-folder',
        displayName: 'Project Files',
        kind: 'shared_folder',
        fileSize: 0,
      },
    ]);
    mockListSharedFolderContents.mockResolvedValueOnce({
      path: '',
      files: [
        {
          name: 'real-contract.pdf',
          path: 'real-contract.pdf',
          type: 'document',
          size: 4096,
          modifiedAt: '2026-06-16T08:31:00.000Z',
        },
      ],
      totalCount: 1,
    });

    const { getByText, queryByText } = render(
      <TestErrorBoundary>
        <RemoteAccessScreen />
      </TestErrorBoundary>
    );

    await waitFor(() => {
      expect(getByText('Project Files')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText('Project Files'));
    });

    await waitFor(() => {
      expect(mockListSharedFolderContents).toHaveBeenCalledWith(
        { host: '192.168.1.100', port: 39394 },
        'res-folder',
        '',
      );
      expect(getByText('real-contract.pdf')).toBeTruthy();
    });
    expect(queryByText('vividrop-presentation.pdf')).toBeNull();
  });

  it('triggers download when download button is pressed', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockListSharedResources.mockResolvedValueOnce([
      {
        resourceId: 'res-2',
        displayName: 'photo.jpg',
        kind: 'shared_file',
        fileSize: 1048576, // 1.0 MB
        mediaType: 'image',
      },
    ]);
    mockDownloadResource.mockResolvedValueOnce(undefined);
    mockRecordDownloadedFile.mockResolvedValueOnce(undefined);

    const { getByText } = render(
      <TestErrorBoundary>
        <RemoteAccessScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('photo.jpg')).toBeTruthy();
    });

    // Press download button (has testID or Icon name or layout element in item row)
    fireEvent.press(getByText('download-outline'));

    await waitFor(() => {
      expect(mockDownloadResource).toHaveBeenCalledWith(
        { host: '192.168.1.100', port: 39394 },
        'res-2',
      );
    });

    await waitFor(() => {
      expect(mockRecordDownloadedFile).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceId: 'res-2',
          filename: 'photo.jpg',
          fileSize: 1048576,
          mediaType: 'image',
        })
      );
    });

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('下載完成', 'photo.jpg 已儲存至相簿');
    });

    alertSpy.mockRestore();
  });

  it('records folder-entry sub-file downloads into 「最近下载」', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockListSharedResources.mockResolvedValueOnce([
      {
        resourceId: 'folder-root',
        displayName: 'Project Files',
        kind: 'shared_folder',
        fileSize: 0,
      },
    ]);
    mockListSharedFolderContents.mockResolvedValueOnce({
      path: '',
      files: [
        {
          name: 'contract.pdf',
          path: 'contract.pdf',
          type: 'document',
          size: 204800,
          modifiedAt: '2026-06-16T08:00:00.000Z',
        },
      ],
      totalCount: 1,
    });
    mockDownloadResource.mockResolvedValueOnce(undefined);
    mockRecordDownloadedFile.mockResolvedValueOnce(undefined);

    const { getByText } = render(
      <TestErrorBoundary>
        <RemoteAccessScreen />
      </TestErrorBoundary>
    );

    // Open the folder
    await waitFor(() => {
      expect(getByText('Project Files')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(getByText('Project Files'));
    });
    await waitFor(() => {
      expect(getByText('contract.pdf')).toBeTruthy();
    });

    // Download the sub-file
    fireEvent.press(getByText('download-outline'));

    await waitFor(() => {
      expect(mockDownloadResource).toHaveBeenCalledWith(
        { host: '192.168.1.100', port: 39394 },
        'shared-folder-entry:folder-root:contract.pdf',
      );
    });

    await waitFor(() => {
      expect(mockRecordDownloadedFile).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceId: 'shared-folder-entry:folder-root:contract.pdf',
          filename: 'contract.pdf',
          fileSize: 204800,
          mediaType: 'document',
        })
      );
    });

    alertSpy.mockRestore();
  });

  it('keeps download available for selected remote files', async () => {
    mockListSharedResources.mockResolvedValueOnce([
      {
        resourceId: 'res-1',
        displayName: 'alpha.jpg',
        kind: 'shared_file',
        fileSize: 1024,
        mediaType: 'image',
      },
      {
        resourceId: 'res-2',
        displayName: 'beta.mov',
        kind: 'shared_file',
        fileSize: 2048,
        mediaType: 'video',
      },
    ]);
    mockDownloadResource.mockResolvedValue(undefined);
    mockRecordDownloadedFile.mockResolvedValue(undefined);

    const { getByText } = render(
      <TestErrorBoundary>
        <RemoteAccessScreen />
      </TestErrorBoundary>
    );

    await waitFor(() => {
      expect(getByText('alpha.jpg')).toBeTruthy();
      expect(getByText('beta.mov')).toBeTruthy();
    });

    fireEvent.press(getByText('選擇'));
    fireEvent.press(getByText('alpha.jpg'));
    fireEvent.press(getByText('beta.mov'));
    fireEvent.press(getByText('下載'));

    await waitFor(() => {
      expect(mockDownloadResource).toHaveBeenCalledTimes(2);
    });
    expect(mockDownloadResource).toHaveBeenNthCalledWith(
      1,
      { host: '192.168.1.100', port: 39394 },
      'res-1',
    );
    expect(mockDownloadResource).toHaveBeenNthCalledWith(
      2,
      { host: '192.168.1.100', port: 39394 },
      'res-2',
    );
  });

  it('opens the system share flow for selected remote files', async () => {
    mockListSharedResources.mockResolvedValueOnce([
      {
        resourceId: 'res-2',
        displayName: 'photo.jpg',
        kind: 'shared_file',
        fileSize: 1048576,
      },
    ]);
    mockShareResources.mockResolvedValueOnce(undefined);

    const { getByText } = render(
      <TestErrorBoundary>
        <RemoteAccessScreen />
      </TestErrorBoundary>
    );

    await waitFor(() => {
      expect(getByText('photo.jpg')).toBeTruthy();
    });

    fireEvent.press(getByText('選擇'));
    fireEvent.press(getByText('photo.jpg'));
    fireEvent.press(getByText('分享'));

    await waitFor(() => {
      expect(mockShareResources).toHaveBeenCalledWith(
        { host: '192.168.1.100', port: 39394 },
        [{ resourceId: 'res-2', displayName: 'photo.jpg' }],
      );
    });
  });

  it('opens a remote document with the system preview viewer', async () => {
    mockListSharedResources.mockResolvedValueOnce([
      {
        resourceId: 'res-doc',
        displayName: 'contract.pdf',
        kind: 'shared_file',
        fileSize: 1024,
        mediaType: 'document',
      },
    ]);
    mockPrepareResourcePreview.mockResolvedValueOnce('/cache/contract.pdf');
    mockViewDocument.mockResolvedValueOnce(undefined);

    const { getByText } = render(
      <TestErrorBoundary>
        <RemoteAccessScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('contract.pdf')).toBeTruthy();
    });

    fireEvent.press(getByText('contract.pdf'));

    await waitFor(() => {
      expect(mockPrepareResourcePreview).toHaveBeenCalledWith(
        { host: '192.168.1.100', port: 39394 },
        'res-doc',
        'contract.pdf',
      );
    });
    expect(mockViewDocument).toHaveBeenCalledWith({
      uri: '/cache/contract.pdf',
      headerTitle: 'contract.pdf',
      mimeType: 'application/pdf',
    });
  });

  it('keeps selection-mode row presses from opening remote previews', async () => {
    mockListSharedResources.mockResolvedValueOnce([
      {
        resourceId: 'res-doc',
        displayName: 'contract.pdf',
        kind: 'shared_file',
        fileSize: 1024,
        mediaType: 'document',
      },
    ]);

    const { getByText } = render(
      <TestErrorBoundary>
        <RemoteAccessScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('contract.pdf')).toBeTruthy();
    });

    fireEvent.press(getByText('選擇'));
    fireEvent.press(getByText('contract.pdf'));

    expect(mockPrepareResourcePreview).not.toHaveBeenCalled();
    expect(mockViewDocument).not.toHaveBeenCalled();
    expect(getByText('已選擇 1 個')).toBeTruthy();
  });

  it('opens a remote image inside the app preview', async () => {
    mockListSharedResources.mockResolvedValueOnce([
      {
        resourceId: 'res-image',
        displayName: 'photo.jpg',
        kind: 'shared_file',
        fileSize: 1024,
        mediaType: 'image',
      },
    ]);
    mockGetResourcePreviewUrl.mockResolvedValueOnce(
      'http://192.168.1.100:39394/resources/mobile/download/res-image',
    );

    const { getByTestId, getByText } = render(
      <TestErrorBoundary>
        <RemoteAccessScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('photo.jpg')).toBeTruthy();
    });

    fireEvent.press(getByText('photo.jpg'));

    await waitFor(() => {
      expect(mockGetResourcePreviewUrl).toHaveBeenCalledWith(
        { host: '192.168.1.100', port: 39394 },
        'res-image',
      );
      expect(getByTestId('remote-access-preview-image')).toBeTruthy();
    });
  });
});

describe('PhoneSyncSpaceScreen', () => {
  const mockBindingState = jest.fn();

  beforeAll(() => {
    (NativeModules as Record<string, unknown>).NativeSyncEngine = {
      getBindingState: mockBindingState,
      addListener: jest.fn(),
      removeListeners: jest.fn(),
    };
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockBindingState.mockResolvedValue({
      deviceId: 'desktop-device-id',
      host: '192.168.1.100',
      connectionState: 'connected',
    });
  });

  it('downloads a received phone-sync item and records it in recent downloads', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockListReceivedLibrary.mockResolvedValueOnce([
      {
        resourceId: 'received-1',
        desktopDeviceId: 'desktop-device-id',
        clientId: 'client-001',
        displayName: 'alpha.jpg',
        fileKey: 'received/alpha.jpg',
        filename: 'alpha.jpg',
        mediaType: 'image',
        fileSize: 1024,
        completedAt: '2026-06-16T08:00:00.000Z',
        shareStatus: 'shared',
      },
    ]);
    mockDownloadResource.mockResolvedValueOnce(undefined);
    mockRecordDownloadedFile.mockResolvedValueOnce(undefined);

    const { getByText } = render(
      <TestErrorBoundary>
        <PhoneSyncSpaceScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('alpha.jpg')).toBeTruthy();
    });

    fireEvent.press(getByText('download-outline'));

    await waitFor(() => {
      expect(mockDownloadResource).toHaveBeenCalledWith(
        { host: '192.168.1.100', port: 39394 },
        'received-1',
      );
    });
    expect(mockDownloadResourceForGlobal).not.toHaveBeenCalled();
    expect(mockRecordDownloadedFile).toHaveBeenCalledWith({
      resourceId: 'received-1',
      filename: 'alpha.jpg',
      fileSize: 1024,
      mediaType: 'image',
      localPath: null,
      savedToPhotos: false,
    });
    expect(alertSpy).toHaveBeenCalledWith('下載完成', 'alpha.jpg 已儲存至相簿');

    alertSpy.mockRestore();
  });

  it('opens a received image inside the app preview when a phone-sync row is pressed', async () => {
    mockListReceivedLibrary.mockResolvedValueOnce([
      {
        resourceId: 'received-image',
        desktopDeviceId: 'desktop-device-id',
        clientId: 'client-001',
        displayName: 'alpha.jpg',
        fileKey: 'received/alpha.jpg',
        filename: 'alpha.jpg',
        mediaType: 'image',
        fileSize: 1024,
        completedAt: '2026-06-16T08:00:00.000Z',
        shareStatus: 'shared',
      },
    ]);
    mockGetResourcePreviewUrl.mockResolvedValueOnce(
      'http://192.168.1.100:39394/resources/mobile/download/received-image',
    );

    const { getByTestId, getByText } = render(
      <TestErrorBoundary>
        <PhoneSyncSpaceScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('alpha.jpg')).toBeTruthy();
    });

    fireEvent.press(getByText('alpha.jpg'));

    await waitFor(() => {
      expect(mockGetResourcePreviewUrl).toHaveBeenCalledWith(
        { host: '192.168.1.100', port: 39394 },
        'received-image',
      );
      expect(getByTestId('phone-sync-cn-preview-image')).toBeTruthy();
    });
    expect(mockViewDocument).not.toHaveBeenCalled();
  });

  it('opens received documents from phone sync space with the system preview viewer', async () => {
    mockListReceivedLibrary.mockResolvedValueOnce([
      {
        resourceId: 'received-doc',
        desktopDeviceId: 'desktop-device-id',
        clientId: 'client-001',
        displayName: 'notes.pdf',
        fileKey: 'received/notes.pdf',
        filename: 'notes.pdf',
        mediaType: 'document',
        fileSize: 512,
        completedAt: '2026-06-16T06:00:00.000Z',
        shareStatus: 'shared',
      },
    ]);
    mockPrepareResourcePreview.mockResolvedValueOnce('/cache/notes.pdf');
    mockViewDocument.mockResolvedValueOnce(undefined);

    const { getByText } = render(
      <TestErrorBoundary>
        <PhoneSyncSpaceScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('notes.pdf')).toBeTruthy();
    });

    fireEvent.press(getByText('notes.pdf'));

    await waitFor(() => {
      expect(mockPrepareResourcePreview).toHaveBeenCalledWith(
        { host: '192.168.1.100', port: 39394 },
        'received-doc',
        'notes.pdf',
      );
    });
    expect(mockViewDocument).toHaveBeenCalledWith({
      uri: '/cache/notes.pdf',
      headerTitle: 'notes.pdf',
      mimeType: 'application/pdf',
    });
  });
});
