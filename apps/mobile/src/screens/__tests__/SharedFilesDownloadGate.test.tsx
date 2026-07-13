import React from 'react';
import {
  render,
  fireEvent,
  waitFor,
  act,
  cleanup,
} from '@testing-library/react-native';
import {
  Alert,
  NativeEventEmitter,
  NativeModules,
  Platform,
  StyleSheet,
  type EmitterSubscription,
} from 'react-native';

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

jest.mock('react-i18next', () => {
  const ReactInner = require('react');
  const TranslationContext = ReactInner.createContext(null);
  return {
    useTranslation: () => {
      ReactInner.useContext(TranslationContext);
      return {
        t: (key: string, options?: any) => {
          const map: Record<string, string> = {
            'sharedFiles.loading': 'Loading...',
            'sharedFiles.deviceUnavailable.title': 'Device Unavailable',
            'sharedFiles.deviceUnavailable.message':
              'Please connect a device first',
            'sharedFiles.emptyState.title': 'No content yet',
            'sharedFiles.emptyState.message':
              'Files will appear here after sync completes',
            'sharedFiles.dialogs.downloadComplete': 'Download complete',
            'sharedFiles.scopes.team': 'File sharing',
            'sharedFiles.scopes.shared': 'Shared resources',
            'sharedFiles.scopes.received': 'Received files',
            'sharedFiles.networkError.title': 'Failed to Load',
            'sharedFiles.networkError.message': 'Please try again later',
            'sharedFiles.dialogs.downloadFailed': 'Download Failed',
            'sharedFiles.dialogs.downloadFailedMessage':
              'Could not download the file. Please try again later',
            'sharedFiles.dialogs.savedLocationPhotos': 'Photos',
            'sharedFiles.dialogs.previewFailed': 'Preview Failed',
            'sharedFiles.dialogs.previewFailedMessage':
              'Could not load file preview',
            'sharedFiles.dialogs.previewUnsupported': 'Cannot Preview',
            'sharedFiles.dialogs.previewUnsupportedMessage':
              'This file type cannot be previewed yet. Download it first, then open it with another app.',
            'sharedFiles.dialogs.openWithOtherApp': 'Open with another app',
            'sharedFiles.dialogs.cancel': 'Cancel',
            'sharedFiles.title': 'File',
            'sharedFiles.phoneSyncSpace.title': 'Phone Sync Space',
            'sharedFiles.phoneSyncSpace.desc':
              'View files synced to your computer and their upload sources',
            'sharedFiles.phoneSyncSpace.badgeSync': 'Shown after sync',
            'sharedFiles.phoneSyncSpace.badgeSource': 'Clear source',
            'sharedFiles.phoneSyncSpace.select': 'Select',
            'sharedFiles.phoneSyncSpace.empty': 'No synced files yet',
            'sharedFiles.phoneSyncSpace.emptySubtitle':
              'Once auto upload is enabled, assets synced to the computer will appear here.',
            'sharedFiles.phoneSyncSpace.filesCount': `${
              options?.count ?? 0
            }  files`,
            'sharedFiles.phoneSyncSpace.loadingTitle': 'Loading',
            'sharedFiles.phoneSyncSpace.loadingSubtitle':
              'The sync space list will refresh here.',
            'sharedFiles.phoneSyncSpace.mediaTypes.file': 'File',
            'sharedFiles.phoneSyncSpace.mediaTypes.photo': 'Photo',
            'sharedFiles.phoneSyncSpace.mediaTypes.video': 'Video',
            'sharedFiles.phoneSyncSpace.previewSyncedFile':
              'Preview synced file',
            'sharedFiles.phoneSyncSpace.downloadSyncedFile':
              'Download synced file',
            'sharedFiles.phoneSyncSpace.desktopDeleted': 'Deleted on computer',
            'sharedFiles.phoneSyncSpace.desktopDeletedMessage':
              'This file was deleted from the computer',
            'sharedFiles.phoneSyncSpace.deletedDownloadMessage':
              'Deleted files cannot be downloaded',
            'sharedFiles.phoneSyncSpace.previewFailedTitle':
              'Cannot load preview',
            'sharedFiles.phoneSyncSpace.previewFailedSubtitle':
              'Please make sure the computer is online and the file still exists.',
            'sharedFiles.localComputer.title': 'Computer Files',
            'sharedFiles.localComputer.desc':
              'Browse your computer shared directory and download files',
            'sharedFiles.localComputer.ossDesc':
              'Browse paired desktop files over your local LAN.',
            'sharedFiles.localComputer.badgeDesktop': 'Computer',
            'sharedFiles.localComputer.badgeView': 'Browse',
            'sharedFiles.localComputer.ossBadge': 'LAN',
            'sharedFiles.localComputer.empty': 'This folder is empty',
            'sharedFiles.localComputer.rootDirectoryLabel': 'User Directory',
            'sharedFiles.localComputer.fallbackDesktopLabel':
              'Current Computer',
            'sharedFiles.localComputer.unboundLocalComputerSubtitle':
              'Not connected to computer',
            'sharedFiles.localComputer.noFilesTitle': 'No Files',
            'sharedFiles.localComputer.noFilesSubtitle':
              'Files shared from the computer will appear here.',
            'sharedFiles.localComputer.localComputerDisabledTitle':
              'LAN Sharing Unavailable',
            'sharedFiles.localComputer.localComputerDisabledSubtitle':
              'Enable local sharing on the computer, then return to the phone and refresh.',
            'sharedFiles.localComputer.recheckPermission': 'Check Again',
            'sharedFiles.localComputer.loadingTitle': 'Computer files loading',
            'sharedFiles.localComputer.loadingSubtitle':
              'Reading the computer shared directory.',
            'sharedFiles.localComputer.networkDisconnectedTitle':
              'Network Disconnected',
            'sharedFiles.localComputer.networkDisconnectedSubtitle':
              'The current path will be kept. You can continue after the network is restored or the computer is online.',
            'sharedFiles.localComputer.retryConnection': 'Retry Connection',
            'sharedFiles.localComputer.listView': 'List View',
            'sharedFiles.localComputer.gridView': 'Grid View',
            'sharedFiles.localComputer.searchFilesPlaceholder':
              'Search computer files',
            'sharedFiles.localComputer.searchFolderPlaceholder':
              'Search current folder',
            'sharedFiles.localComputer.connectionStatePrefix':
              'Computer connection method:',
            'sharedFiles.localComputer.sortTitle': 'Sort By',
            'sharedFiles.localComputer.select': 'Select',
            'sharedFiles.localComputer.done': 'Done',
            'sharedFiles.localComputer.download': 'Download',
            'sharedFiles.localComputer.share': 'Share',
            'sharedFiles.connectionStatus.lan': 'LAN',
            'sharedFiles.connectionStatus.unavailable': 'Unreachable',
            'sharedFiles.sortBy.name': 'Name',
            'sharedFiles.sortBy.time': 'Time',
            'sharedFiles.sortBy.size': 'File Size',
            'common.back': 'Back',
            'common.today': 'Today',
            'common.yesterday': 'Yesterday',
            'sharedFiles.localComputer.selectedCount': `Selected ${
              options?.count ?? 0
            } items`,
          };
          if (key === 'sharedFiles.phoneSyncSpace.summary') {
            return `${options?.count ?? 0} items - ${options?.size ?? ''}`;
          }
          if (
            key === 'sharedFiles.dialogs.downloadSavedToPhotos' &&
            options?.name
          ) {
            return `${options.name} saved to ${options.location ?? ''}`;
          }
          if (
            key === 'sharedFiles.dialogs.downloadSavedToFiles' &&
            options?.name
          ) {
            return `${options.name} saved to Files`;
          }
          return map[key] || key;
        },
      };
    },
  };
});

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

jest.mock('../../components/GradientBackground', () => ({
  GradientBackground: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

jest.mock('../../components/BottomTabBar', () => ({
  BottomTabBar: () => null,
}));

jest.mock('../../components/shared/ModalBlurBackdrop', () => ({
  ModalBlurBackdrop: () => null,
}));

jest.mock('react-native-video', () => 'Video');

jest.mock('@react-native-documents/viewer', () => ({
  viewDocument: jest.fn(),
}));

const mockShareOpen = (
  globalThis as typeof globalThis & {
    __mockReactNativeShareOpen: jest.Mock;
  }
).__mockReactNativeShareOpen;

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
let mockAuthState: {
  isLoggedIn: boolean;
} = {
  isLoggedIn: true,
};

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
  useAuth: () => mockAuthState,
}));

function resetMockAuthState() {
  mockAuthState = {
    isLoggedIn: true,
  };
}

jest.mock('../../dev/visualQa', () => ({
  isVisualQaEnabled: () => mockVisualQaEnabled,
}));

// Mock local desktop service
jest.mock('../../services/desktop-local-service', () => ({
  listSharedResources: jest.fn(),
  listSharedFolderContents: jest.fn(),
  listGlobalLocalComputerResources: jest.fn(),
  listGlobalLocalComputerFolderContents: jest.fn(),
  listReceivedLibrary: jest.fn(),
  listCurrentClientReceivedLibrary: jest.fn(),
  listCurrentClientReceivedLibraryPage: jest.fn(),
  listGlobalReceivedLibraryPage: jest.fn(),
  downloadResource: jest.fn(),
  downloadResourceForGlobal: jest.fn(),
  downloadReceivedLibraryItem: jest.fn(),
  downloadGlobalLocalComputerResource: jest.fn(),
  getResourcePreviewUrl: jest.fn(),
  getReceivedLibraryPreviewUrl: jest.fn(),
  getGlobalLocalComputerPreviewUrl: jest.fn(),
  prepareResourcePreview: jest.fn(),
  prepareReceivedLibraryPreview: jest.fn(),
  prepareGlobalLocalComputerPreview: jest.fn(),
  prepareGlobalLocalComputerShareFile: jest.fn(),
  shareResources: jest.fn(),
  shareGlobalLocalComputerResources: jest.fn(),
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

jest.mock('../../services/download-records-service', () => ({
  recordDownloadedFile: jest.fn(),
}));

jest.mock('../../services/diagnostics-log-service', () => ({
  recordDiagnosticsLog: jest.fn(),
}));

import {
  SharedFilesScreen,
  normalizeDirectoryPath,
  parentDirectoryPath,
} from '../SharedFilesScreen';
import { LocalComputerScreen } from '../LocalComputerScreen';
import {
  listSharedResources,
  listSharedFolderContents,
  listGlobalLocalComputerResources,
  listGlobalLocalComputerFolderContents,
  listReceivedLibrary,
  listCurrentClientReceivedLibrary,
  listGlobalReceivedLibraryPage,
  downloadResource,
  downloadResourceForGlobal,
  downloadReceivedLibraryItem,
  downloadGlobalLocalComputerResource,
  getResourcePreviewUrl,
  getReceivedLibraryPreviewUrl,
  getGlobalLocalComputerPreviewUrl,
  prepareResourcePreview,
  prepareReceivedLibraryPreview,
  prepareGlobalLocalComputerPreview,
  prepareGlobalLocalComputerShareFile,
  shareResources,
  shareGlobalLocalComputerResources,
} from '../../services/desktop-local-service';
import { recordDownloadedFile } from '../../services/download-records-service';
import { recordDiagnosticsLog } from '../../services/diagnostics-log-service';
import { viewDocument } from '@react-native-documents/viewer';
import { PhoneSyncSpaceScreen } from '../PhoneSyncSpaceScreen';

const mockListSharedResources = listSharedResources as jest.Mock;
const mockListSharedFolderContents = listSharedFolderContents as jest.Mock;
const mockListGlobalLocalComputerResources =
  listGlobalLocalComputerResources as jest.Mock;
const mockListGlobalLocalComputerFolderContents =
  listGlobalLocalComputerFolderContents as jest.Mock;
const mockListReceivedLibrary = listReceivedLibrary as jest.Mock;
const mockListCurrentClientReceivedLibrary =
  listCurrentClientReceivedLibrary as jest.Mock;
const mockListGlobalReceivedLibraryPage =
  listGlobalReceivedLibraryPage as jest.Mock;
const mockDownloadResource = downloadResource as jest.Mock;
const mockDownloadResourceForGlobal = downloadResourceForGlobal as jest.Mock;
const mockDownloadReceivedLibraryItem =
  downloadReceivedLibraryItem as jest.Mock;
const mockDownloadGlobalLocalComputerResource =
  downloadGlobalLocalComputerResource as jest.Mock;
const mockGetResourcePreviewUrl = getResourcePreviewUrl as jest.Mock;
const mockGetReceivedLibraryPreviewUrl =
  getReceivedLibraryPreviewUrl as jest.Mock;
const mockGetGlobalLocalComputerPreviewUrl =
  getGlobalLocalComputerPreviewUrl as jest.Mock;
const mockPrepareResourcePreview = prepareResourcePreview as jest.Mock;
const mockPrepareReceivedLibraryPreview =
  prepareReceivedLibraryPreview as jest.Mock;
const mockPrepareGlobalLocalComputerPreview =
  prepareGlobalLocalComputerPreview as jest.Mock;
const mockPrepareGlobalLocalComputerShareFile =
  prepareGlobalLocalComputerShareFile as jest.Mock;
const mockShareResources = shareResources as jest.Mock;
const mockShareGlobalLocalComputerResources =
  shareGlobalLocalComputerResources as jest.Mock;
const mockRecordDownloadedFile = recordDownloadedFile as jest.Mock;
const mockRecordDiagnosticsLog = recordDiagnosticsLog as jest.Mock;
const mockViewDocument = viewDocument as jest.Mock;

beforeEach(() => {
  [
    mockListSharedResources,
    mockListSharedFolderContents,
    mockListGlobalLocalComputerResources,
    mockListGlobalLocalComputerFolderContents,
    mockListReceivedLibrary,
    mockListCurrentClientReceivedLibrary,
    mockListGlobalReceivedLibraryPage,
    mockDownloadResource,
    mockDownloadResourceForGlobal,
    mockDownloadReceivedLibraryItem,
    mockDownloadGlobalLocalComputerResource,
    mockGetResourcePreviewUrl,
    mockGetReceivedLibraryPreviewUrl,
    mockGetGlobalLocalComputerPreviewUrl,
    mockPrepareResourcePreview,
    mockPrepareReceivedLibraryPreview,
    mockPrepareGlobalLocalComputerPreview,
    mockPrepareGlobalLocalComputerShareFile,
    mockShareResources,
    mockShareGlobalLocalComputerResources,
    mockRecordDownloadedFile,
    mockRecordDiagnosticsLog,
    mockViewDocument,
    mockShareOpen,
  ].forEach(mock => {
    mock?.mockReset();
  });
});

afterEach(() => {
  cleanup();
});

function makeReceivedLibraryPage(
  items: Array<Record<string, unknown>>,
  overrides: Record<string, unknown> = {},
) {
  return {
    items,
    page: 1,
    pageSize: 20,
    totalItems: items.length,
    totalBytes: 0,
    deviceStats: [],
    ...overrides,
  };
}

function mockCurrentClientReceivedLibraryPageFromLegacyList() {
  mockListGlobalReceivedLibraryPage.mockImplementation(
    async (
      desktop: unknown,
      options?: { page?: number; pageSize?: number },
    ) => {
      const items = ((await mockListCurrentClientReceivedLibrary(desktop)) ||
        []) as Array<Record<string, unknown> & { fileSize?: number }>;
      return makeReceivedLibraryPage(items, {
        page: options?.page ?? 1,
        pageSize: options?.pageSize ?? 20,
        totalItems: items.length,
        totalBytes: items.reduce(
          (total: number, item: { fileSize?: number }) =>
            total + (item.fileSize ?? 0),
          0,
        ),
      });
    },
  );
}

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
describe('SharedFilesScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetMockAuthState();
    mockVisualQaEnabled = false;
  });

  it('uses neutral landing copy instead of fake daily counts', () => {
    const { getByText, queryByText } = render(
      <SharedFilesScreen showBottomTabBar={false} />,
    );

    expect(getByText('Shown after sync')).toBeTruthy();
    expect(queryByText('Today 5 items')).toBeNull();
  });

  it('records diagnostics before opening PhoneSyncSpace', () => {
    const { getByText } = render(
      <SharedFilesScreen showBottomTabBar={false} />,
    );

    fireEvent.press(getByText('Phone Sync Space'));
    expect(mockNavigate).toHaveBeenCalledWith('PhoneSyncSpace');
    expect(mockRecordDiagnosticsLog).toHaveBeenCalledWith(
      'PhoneSyncSpace',
      'entry pressed',
      { screen: 'SharedFilesScreen' },
    );
  });

  it('keeps global local computer local-LAN without an account service gate', () => {
    const { getByText, queryByText } = render(
      <SharedFilesScreen showBottomTabBar={false} />,
    );

    expect(getByText('LAN')).toBeTruthy();
    expect(
      getByText('Browse paired desktop files over your local LAN.'),
    ).toBeTruthy();
    fireEvent.press(getByText('Computer Files'));

    expect(mockNavigate).toHaveBeenCalledWith('LocalComputer');
    expect(queryByText('Network Disconnected')).toBeNull();
  });

  it('keeps guest users on local-LAN local computer access instead of login or account flow', () => {
    mockAuthState = {
      isLoggedIn: false,
    };

    const { getByText } = render(
      <SharedFilesScreen showBottomTabBar={false} />,
    );

    fireEvent.press(getByText('Computer Files'));

    expect(mockNavigate).toHaveBeenCalledWith('LocalComputer');
    expect(mockNavigate).not.toHaveBeenCalledWith('Login');
  });
});

describe('LocalComputerScreen', () => {
  const mockBindingState = jest.fn();
  const nativeEventHandlers: Partial<
    Record<string, (payload: unknown) => void>
  > = {};
  const testGlobal = globalThis as typeof globalThis & {
    __LYNAVO_SHARED_FILES_PREVIEW__?: boolean;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockVisualQaEnabled = false;
    delete testGlobal.__LYNAVO_SHARED_FILES_PREVIEW__;
    (NativeModules as Record<string, unknown>).NativeSyncEngine = {
      getBindingState: mockBindingState,
      addListener: jest.fn(),
      removeListeners: jest.fn(),
    };
    Object.keys(nativeEventHandlers).forEach(key => {
      delete nativeEventHandlers[key];
    });
    jest
      .spyOn(NativeEventEmitter.prototype, 'addListener')
      .mockImplementation((eventName, listener) => {
        nativeEventHandlers[String(eventName)] = listener as (
          payload: unknown,
        ) => void;
        return { remove: jest.fn() } as unknown as EmitterSubscription;
      });
    mockBindingState.mockResolvedValue({
      deviceId: 'desktop-device-id',
      host: '192.168.1.100',
      connectionState: 'connected',
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('does not crash when share target translations are unavailable on initial render', async () => {
    mockListGlobalLocalComputerResources.mockResolvedValueOnce([]);

    expect(() => {
      render(<LocalComputerScreen />);
    }).not.toThrow();

    await waitFor(() => {
      expect(mockListGlobalLocalComputerResources).toHaveBeenCalledWith();
    });
  });

  it('lists shared files without an off-LAN service gate', async () => {
    mockListGlobalLocalComputerResources.mockResolvedValueOnce([]);

    const { queryByText } = render(
      <TestErrorBoundary>
        <LocalComputerScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(mockListGlobalLocalComputerResources).toHaveBeenCalledWith();
    });
    expect(queryByText('Cloud account required')).toBeNull();
    expect(queryByText('Network Disconnected')).toBeNull();
  });

  it('renders local computer access list items without calling hooks from renderItem helpers', async () => {
    mockListGlobalLocalComputerResources.mockResolvedValueOnce([
      {
        resourceId: 'personal-dir:Project%20Files',
        desktopDeviceId: 'desktop-device-id',
        displayName: 'Project Files',
        kind: 'shared_folder',
        status: 'available',
        addedAt: '2026-06-16T08:00:00.000Z',
        downloadCount: 0,
      },
    ]);

    const { getByText } = render(<LocalComputerScreen />);

    await waitFor(() => {
      expect(getByText('Project Files')).toBeTruthy();
    });
  });

  it('keeps an empty real response empty unless the shared files preview gate is explicit', async () => {
    mockVisualQaEnabled = true;
    mockListGlobalLocalComputerResources.mockResolvedValueOnce([]);

    const { getByTestId, getByText, queryByText } = render(
      <TestErrorBoundary>
        <LocalComputerScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(mockListGlobalLocalComputerResources).toHaveBeenCalledWith();
    });

    await waitFor(() => {
      expect(getByText('No Files')).toBeTruthy();
    });
    expect(getByTestId('local-computer-empty-icon-computer')).toBeTruthy();
    expect(queryByText('Mac Client Setup Guide-2506.docx')).toBeNull();
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
    mockListGlobalLocalComputerResources.mockResolvedValueOnce([]);

    const { getByText, queryByText } = render(
      <TestErrorBoundary>
        <LocalComputerScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('Edit Bay / User Directory')).toBeTruthy();
    });
    expect(queryByText('MacBook Pro / User Directory')).toBeNull();
  });

  it('shows the current shared-files route from the binding snapshot', async () => {
    mockBindingState.mockResolvedValueOnce({
      deviceId: 'desktop-device-id',
      deviceName: 'Studio Mini',
      host: 'Studio-Mini.local',
      connectionState: 'connected',
      sharedFilesReachability: {
        deviceId: 'desktop-device-id',
        state: 'available',
        route: 'lan',
        reason: 'browse_shared_files_success',
        updatedAt: '2026-06-17T08:00:00.000Z',
      },
    });
    mockListGlobalLocalComputerResources.mockResolvedValueOnce([]);

    const { getByText } = render(
      <TestErrorBoundary>
        <LocalComputerScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('LAN')).toBeTruthy();
    });
  });

  it('keeps the shared-files route out of the top-right selection actions', async () => {
    mockBindingState.mockResolvedValueOnce({
      deviceId: 'desktop-device-id',
      deviceName: 'Studio Mini',
      host: 'Studio-Mini.local',
      connectionState: 'connected',
      sharedFilesReachability: {
        deviceId: 'desktop-device-id',
        state: 'available',
        route: 'lan',
        reason: 'browse_shared_files_success',
        updatedAt: '2026-06-17T08:00:00.000Z',
      },
    });
    mockListGlobalLocalComputerResources.mockResolvedValueOnce([]);

    const { getByText } = render(
      <TestErrorBoundary>
        <LocalComputerScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('LAN')).toBeTruthy();
    });

    let cursor = getByText('LAN').parent;
    let nestedInHeaderActions = false;
    while (cursor) {
      const ancestorStyle = StyleSheet.flatten(cursor.props.style);
      if (
        ancestorStyle?.alignItems === 'flex-end' &&
        ancestorStyle?.gap === 6
      ) {
        nestedInHeaderActions = true;
        break;
      }
      cursor = cursor.parent;
    }

    expect(nestedInHeaderActions).toBe(false);
  });

  it('ignores the native tunnel route and keeps the OSS badge local-LAN only', async () => {
    mockBindingState.mockResolvedValueOnce({
      deviceId: 'desktop-device-id',
      host: '192.168.1.100',
      connectionState: 'connected',
      sharedFilesReachability: {
        deviceId: 'desktop-device-id',
        state: 'available',
        route: 'tunnel',
        reason: 'browse_shared_files_success',
        updatedAt: '2026-06-17T08:00:00.000Z',
      },
    });
    mockListGlobalLocalComputerResources.mockResolvedValueOnce([]);

    const { getByText, queryByText } = render(
      <TestErrorBoundary>
        <LocalComputerScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('LAN')).toBeTruthy();
    });
    expect(queryByText('P2P')).toBeNull();
  });

  it('ignores relay reachability events in the OSS local-LAN runtime', async () => {
    mockListGlobalLocalComputerResources.mockResolvedValueOnce([]);

    const { getByText, queryByText } = render(
      <TestErrorBoundary>
        <LocalComputerScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(mockListGlobalLocalComputerResources).toHaveBeenCalledWith();
      expect(getByText('LAN')).toBeTruthy();
    });

    await act(async () => {
      nativeEventHandlers.onSharedFilesReachabilityChanged?.({
        deviceId: 'desktop-device-id',
        state: 'available',
        route: 'relay',
        reason: 'browse_shared_files_success',
        updatedAt: '2026-06-17T08:01:00.000Z',
      });
    });

    await waitFor(() => {
      expect(getByText('LAN')).toBeTruthy();
    });
    expect(queryByText('Relay server')).toBeNull();
  });

  it('keeps a successful LAN browse badge when a later native event is still waking', async () => {
    mockBindingState.mockResolvedValue({
      deviceId: 'desktop-device-id',
      deviceName: 'Studio Mini',
      host: 'Studio-Mini.local',
      connectionState: 'connected',
      sharedFilesReachability: {
        deviceId: 'desktop-device-id',
        state: 'waking',
        route: null,
        reason: 'wake_in_progress',
        updatedAt: '2026-06-17T08:00:00.000Z',
      },
    });
    mockListGlobalLocalComputerResources.mockResolvedValueOnce([
      {
        resourceId: 'personal-dir:Project%20Files',
        desktopDeviceId: 'desktop-device-id',
        displayName: 'Project Files',
        kind: 'shared_folder',
        status: 'available',
        addedAt: '2026-06-16T08:00:00.000Z',
        downloadCount: 0,
      },
    ]);

    const { getByText, queryByText } = render(
      <TestErrorBoundary>
        <LocalComputerScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('Project Files')).toBeTruthy();
      expect(getByText('LAN')).toBeTruthy();
    });

    await act(async () => {
      nativeEventHandlers.onSharedFilesReachabilityChanged?.({
        deviceId: 'desktop-device-id',
        state: 'waking',
        route: null,
        reason: 'wake_in_progress',
        updatedAt: '2026-06-17T08:01:00.000Z',
      });
    });

    expect(getByText('LAN')).toBeTruthy();
    expect(queryByText('Waking')).toBeNull();
  });

  it('keeps the LAN badge instead of showing fallback tunnel progress', async () => {
    mockBindingState.mockResolvedValue({
      deviceId: 'desktop-device-id',
      deviceName: 'Studio Mini',
      host: 'Studio-Mini.local',
      connectionState: 'connected',
      sharedFilesReachability: {
        deviceId: 'desktop-device-id',
        state: 'available',
        route: 'lan',
        reason: 'browse_shared_files_success',
        updatedAt: '2026-06-17T08:00:00.000Z',
      },
    });
    mockListGlobalLocalComputerResources.mockResolvedValueOnce([
      {
        resourceId: 'personal-dir:Project%20Files',
        desktopDeviceId: 'desktop-device-id',
        displayName: 'Project Files',
        kind: 'shared_folder',
        status: 'available',
        addedAt: '2026-06-16T08:00:00.000Z',
        downloadCount: 0,
      },
    ]);

    const { getByText, queryByText } = render(
      <TestErrorBoundary>
        <LocalComputerScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('Project Files')).toBeTruthy();
      expect(getByText('LAN')).toBeTruthy();
    });

    await act(async () => {
      nativeEventHandlers.onSharedFilesReachabilityChanged?.({
        deviceId: 'desktop-device-id',
        state: 'unknown',
        route: 'tunnel',
        reason: 'browse_shared_files_p2p_wait_started',
        updatedAt: '2026-06-17T08:01:00.000Z',
      });
    });

    expect(getByText('LAN')).toBeTruthy();
    expect(queryByText('P2P connecting')).toBeNull();
    expect(queryByText('Waking')).toBeNull();
  });

  it('does not render relay fallback progress as a community route badge', async () => {
    jest.useFakeTimers();
    mockBindingState.mockResolvedValueOnce({
      deviceId: 'desktop-device-id',
      host: '192.168.1.100',
      connectionState: 'connected',
      sharedFilesReachability: {
        deviceId: 'desktop-device-id',
        state: 'unknown',
        route: 'relay',
        reason: 'browse_shared_files_rejected_tunnel_p2p_retry_relay',
        updatedAt: '2026-06-17T08:00:00.000Z',
      },
    });
    mockListGlobalLocalComputerResources.mockImplementationOnce(
      () => new Promise(() => {}),
    );

    const { getByText, queryByText, unmount } = render(
      <TestErrorBoundary>
        <LocalComputerScreen />
      </TestErrorBoundary>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockListGlobalLocalComputerResources).toHaveBeenCalledWith();
    expect(getByText('Computer files loading')).toBeTruthy();
    expect(queryByText('Relay connecting')).toBeNull();
    expect(queryByText('Waking')).toBeNull();

    unmount();
    jest.clearAllTimers();
  });

  it('falls back to the disconnected state when local computer loading times out', async () => {
    jest.useFakeTimers();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockListGlobalLocalComputerResources.mockImplementationOnce(
      () => new Promise(() => {}),
    );

    const { getByText, queryByText } = render(
      <TestErrorBoundary>
        <LocalComputerScreen />
      </TestErrorBoundary>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockListGlobalLocalComputerResources).toHaveBeenCalledWith();
    expect(getByText('Computer files loading')).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(35_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(getByText('Network Disconnected')).toBeTruthy();
    expect(queryByText('Computer files loading')).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      '[LocalComputerScreen] Failed to load data:',
      expect.any(Error),
    );

    await act(async () => {
      jest.runOnlyPendingTimers();
    });
  });

  it('shows desktop local-computer disabled instead of network disconnected when the desktop rejects browsing', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockListGlobalLocalComputerResources.mockRejectedValueOnce(
      new Error('local computer access is disabled'),
    );

    const { getByText, queryByText } = render(
      <TestErrorBoundary>
        <LocalComputerScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('LAN Sharing Unavailable')).toBeTruthy();
    });
    expect(
      getByText(
        'Enable local sharing on the computer, then return to the phone and refresh.',
      ),
    ).toBeTruthy();
    expect(getByText('Check Again')).toBeTruthy();
    expect(queryByText('Network Disconnected')).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      '[LocalComputerScreen] Failed to load data:',
      expect.any(Error),
    );
  });

  it('shows generic LAN unavailable guidance for legacy desktop-identity errors', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockListGlobalLocalComputerResources.mockRejectedValueOnce(
      new Error('desktop account identity is unavailable'),
    );

    const { getByText, queryByText } = render(
      <TestErrorBoundary>
        <LocalComputerScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('Network Disconnected')).toBeTruthy();
    });
    expect(getByText('Retry Connection')).toBeTruthy();
    expect(queryByText('Desktop not signed in')).toBeNull();
    expect(queryByText('Account mismatch')).toBeNull();
    expect(
      queryByText('sharedFiles.localComputer.networkDisconnectedTitle'),
    ).toBeNull();
    expect(queryByText('LAN Sharing Unavailable')).toBeNull();
  });

  it('shows generic LAN unavailable guidance for legacy identity-mismatch errors', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockListGlobalLocalComputerResources.mockRejectedValueOnce(
      new Error('account mismatch'),
    );

    const { getByText, queryByText } = render(
      <TestErrorBoundary>
        <LocalComputerScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('Network Disconnected')).toBeTruthy();
    });
    expect(getByText('Retry Connection')).toBeTruthy();
    expect(queryByText('Desktop not signed in')).toBeNull();
    expect(queryByText('Account mismatch')).toBeNull();
    expect(
      queryByText('sharedFiles.localComputer.networkDisconnectedTitle'),
    ).toBeNull();
    expect(queryByText('LAN Sharing Unavailable')).toBeNull();
  });

  it('shows desktop local-computer disabled for generic personal directory HTTP 403', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockListGlobalLocalComputerResources.mockRejectedValueOnce(
      new Error('Sidecar returned HTTP 403 for /personal/list'),
    );

    const { getByText, queryByText } = render(
      <TestErrorBoundary>
        <LocalComputerScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('LAN Sharing Unavailable')).toBeTruthy();
    });
    expect(queryByText('Network Disconnected')).toBeNull();
  });

  it('shows desktop local-computer disabled when sidecar returns personal directory HTTP 403 with body', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockListGlobalLocalComputerResources.mockRejectedValueOnce(
      new Error(
        'Sidecar returned HTTP 403 for /personal/list: local computer access is disabled',
      ),
    );

    const { getByText, queryByText } = render(
      <TestErrorBoundary>
        <LocalComputerScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('LAN Sharing Unavailable')).toBeTruthy();
    });
    expect(queryByText('Network Disconnected')).toBeNull();
  });

  it('silently retries the first local computer list while the shared-files route is becoming ready', async () => {
    jest.useFakeTimers();
    mockListGlobalLocalComputerResources
      .mockRejectedValueOnce(new Error('No shared files route available'))
      .mockResolvedValueOnce([
        {
          resourceId: 'personal-dir:Project%20Files',
          desktopDeviceId: 'desktop-device-id',
          displayName: 'Project Files',
          kind: 'shared_folder',
          status: 'available',
          addedAt: '2026-06-16T08:00:00.000Z',
          downloadCount: 0,
        },
      ]);

    const { getByText, queryByText } = render(
      <TestErrorBoundary>
        <LocalComputerScreen />
      </TestErrorBoundary>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockListGlobalLocalComputerResources).toHaveBeenCalledTimes(1);
    expect(queryByText('Network Disconnected')).toBeNull();

    await act(async () => {
      jest.advanceTimersByTime(1_200);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(getByText('Project Files')).toBeTruthy();
    });
    expect(mockListGlobalLocalComputerResources).toHaveBeenCalledTimes(2);
    expect(queryByText('Network Disconnected')).toBeNull();
  });

  it('loads real shared folder contents when a production folder is opened', async () => {
    mockListGlobalLocalComputerResources.mockResolvedValueOnce([
      {
        resourceId: 'personal-dir:Project%20Files',
        desktopDeviceId: 'desktop-device-id',
        displayName: 'Project Files',
        kind: 'shared_folder',
        status: 'available',
        addedAt: '2026-06-16T08:00:00.000Z',
        downloadCount: 0,
      },
    ]);
    mockListGlobalLocalComputerFolderContents.mockResolvedValueOnce({
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
        {
          name: 'cover.jpg',
          path: 'cover.jpg',
          type: 'image',
          size: 4096,
          modifiedAt: '2026-06-16T08:32:00.000Z',
        },
        {
          name: 'walkthrough.mov',
          path: 'walkthrough.mov',
          type: 'video',
          size: 8192,
          modifiedAt: '2026-06-16T08:33:00.000Z',
          thumbnailUrl:
            'http://192.168.1.100:39394/personal/thumbnail/walkthrough.mov?v=8192-1780000',
        },
      ],
      totalCount: 4,
    });

    const { getByTestId, getByText, queryByTestId } = render(
      <TestErrorBoundary>
        <LocalComputerScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('Project Files')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText('Project Files'));
    });

    await waitFor(() => {
      expect(mockListGlobalLocalComputerFolderContents).toHaveBeenCalledWith(
        'personal-dir:Project%20Files',
        '',
      );
      expect(getByText('Contracts')).toBeTruthy();
      expect(getByText('brief.pdf')).toBeTruthy();
      expect(getByText('cover.jpg')).toBeTruthy();
      expect(getByText('walkthrough.mov')).toBeTruthy();
    });
    expect(getByTestId('local-computer-resource-thumbnail-image')).toBeTruthy();
    expect(queryByTestId('local-computer-resource-icon-video')).toBeNull();
  });

  it('keeps sparse local computer grid items constrained to a single column', async () => {
    mockListGlobalLocalComputerResources.mockResolvedValueOnce([
      {
        resourceId: 'personal-dir:command-line-tools',
        desktopDeviceId: 'desktop-device-id',
        displayName: 'command-line-tools',
        kind: 'shared_folder',
        status: 'available',
        addedAt: '2026-06-16T08:00:00.000Z',
        downloadCount: 0,
      },
    ]);

    const { getByText, queryAllByTestId, queryAllByText } = render(
      <TestErrorBoundary>
        <LocalComputerScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('command-line-tools')).toBeTruthy();
    });

    let gridToggle = queryAllByTestId('local-computer-toolbar-grid-icon')[0]
      .parent;
    while (gridToggle && typeof gridToggle.props.onPress !== 'function') {
      gridToggle = gridToggle.parent;
    }
    if (!gridToggle) {
      throw new Error('Unable to find grid layout toggle');
    }

    await act(async () => {
      fireEvent.press(gridToggle);
    });

    await waitFor(() => {
      const gridCardStyles = queryAllByText('command-line-tools').flatMap(
        node => {
          const ancestorStyles = [];
          let cursor = node.parent;
          while (cursor) {
            ancestorStyles.push(StyleSheet.flatten(cursor.props.style));
            cursor = cursor.parent;
          }
          return ancestorStyles;
        },
      );
      expect(
        gridCardStyles.some(
          style =>
            style?.flex !== 1 &&
            style?.flexGrow === 0 &&
            style?.flexShrink === 0,
        ),
      ).toBe(true);
    });
  });

  it('renders the reference-style media type icons in the global local computer list', async () => {
    mockListGlobalLocalComputerResources.mockResolvedValueOnce([
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
        <LocalComputerScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByTestId('local-computer-resource-icon-folder')).toBeTruthy();
      expect(getByTestId('local-computer-resource-icon-photo')).toBeTruthy();
      expect(getByTestId('local-computer-resource-icon-video')).toBeTruthy();
      expect(getByTestId('local-computer-resource-icon-file')).toBeTruthy();
    });
  });

  it('renders local computer image and video thumbnails from thumbnail urls', async () => {
    mockListGlobalLocalComputerResources.mockResolvedValueOnce([
      {
        resourceId: 'personal-dir:alpha.jpg',
        desktopDeviceId: 'desktop-device-id',
        displayName: 'alpha.jpg',
        kind: 'shared_file',
        fileSize: 1024,
        mediaType: 'image',
        status: 'available',
        addedAt: '2026-06-16T08:00:00.000Z',
        downloadCount: 0,
        thumbnailUrl:
          'http://192.168.1.100:39394/personal/thumbnail/alpha.jpg?v=1024-1780000',
      },
      {
        resourceId: 'personal-dir:beta.mov',
        desktopDeviceId: 'desktop-device-id',
        displayName: 'beta.mov',
        kind: 'shared_file',
        fileSize: 2048,
        mediaType: 'video',
        status: 'available',
        addedAt: '2026-06-16T08:01:00.000Z',
        downloadCount: 0,
        thumbnailUrl:
          'http://192.168.1.100:39394/personal/thumbnail/beta.mov?v=2048-1780000',
        streamUrl: 'http://192.168.1.100:39394/personal/stream/beta.mov',
      },
    ]);

    const { getAllByTestId, getByText, queryByTestId } = render(
      <TestErrorBoundary>
        <LocalComputerScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('alpha.jpg')).toBeTruthy();
      expect(getByText('beta.mov')).toBeTruthy();
    });

    const thumbnails = getAllByTestId(
      'local-computer-resource-thumbnail-image',
    );
    expect(thumbnails).toHaveLength(2);
    expect(queryByTestId('local-computer-resource-icon-photo')).toBeNull();
    expect(queryByTestId('local-computer-resource-icon-video')).toBeNull();
  });

  it('falls back to the image file type icon when a local computer thumbnail fails', async () => {
    mockListGlobalLocalComputerResources.mockResolvedValueOnce([
      {
        resourceId: 'personal-dir:broken.jpg',
        desktopDeviceId: 'desktop-device-id',
        displayName: 'broken.jpg',
        kind: 'shared_file',
        fileSize: 1024,
        mediaType: 'image',
        status: 'available',
        addedAt: '2026-06-16T08:00:00.000Z',
        downloadCount: 0,
        thumbnailUrl:
          'http://192.168.1.100:39394/personal/thumbnail/broken.jpg?v=1024-1780000',
      },
    ]);

    const { getByTestId, getByText, queryByTestId } = render(
      <TestErrorBoundary>
        <LocalComputerScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('broken.jpg')).toBeTruthy();
      expect(
        getByTestId('local-computer-resource-thumbnail-image'),
      ).toBeTruthy();
    });

    fireEvent(getByTestId('local-computer-resource-thumbnail-image'), 'error');

    await waitFor(() => {
      expect(
        queryByTestId('local-computer-resource-thumbnail-image'),
      ).toBeNull();
      expect(getByTestId('local-computer-resource-icon-photo')).toBeTruthy();
    });
  });

  it('falls back to the video file type icon when a local computer video thumbnail fails', async () => {
    mockListGlobalLocalComputerResources.mockResolvedValueOnce([
      {
        resourceId: 'personal-dir:broken.mov',
        desktopDeviceId: 'desktop-device-id',
        displayName: 'broken.mov',
        kind: 'shared_file',
        fileSize: 2048,
        mediaType: 'video',
        status: 'available',
        addedAt: '2026-06-16T08:00:00.000Z',
        downloadCount: 0,
        thumbnailUrl:
          'http://192.168.1.100:39394/personal/thumbnail/broken.mov?v=2048-1780000',
        streamUrl: 'http://192.168.1.100:39394/personal/stream/broken.mov',
      },
    ]);

    const { getByTestId, getByText, queryByTestId } = render(
      <TestErrorBoundary>
        <LocalComputerScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('broken.mov')).toBeTruthy();
      expect(
        getByTestId('local-computer-resource-thumbnail-image'),
      ).toBeTruthy();
    });

    fireEvent(getByTestId('local-computer-resource-thumbnail-image'), 'error');

    await waitFor(() => {
      expect(
        queryByTestId('local-computer-resource-thumbnail-image'),
      ).toBeNull();
      expect(getByTestId('local-computer-resource-icon-video')).toBeTruthy();
    });
  });

  it('limits the local computer FlatList render batch to ten rows', async () => {
    mockListGlobalLocalComputerResources.mockResolvedValueOnce(
      Array.from({ length: 12 }, (_, index) => ({
        resourceId: `personal-dir:photo-${index}.jpg`,
        desktopDeviceId: 'desktop-device-id',
        displayName: `photo-${index}.jpg`,
        kind: 'shared_file' as const,
        fileSize: 1024,
        mediaType: 'image',
        status: 'available' as const,
        addedAt: '2026-06-16T08:00:00.000Z',
        downloadCount: 0,
        thumbnailUrl: `http://192.168.1.100:39394/personal/thumbnail/photo-${index}.jpg?v=1024-1780000`,
      })),
    );

    const { UNSAFE_getByProps, getByText } = render(
      <TestErrorBoundary>
        <LocalComputerScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('photo-0.jpg')).toBeTruthy();
    });

    const list = UNSAFE_getByProps({ initialNumToRender: 10 });
    expect(list.props.initialNumToRender).toBe(10);
    expect(list.props.maxToRenderPerBatch).toBe(10);
    expect(list.props.windowSize).toBeLessThanOrEqual(7);
  });

  it('uses reference lucide toolbar icons instead of Ionicons glyph mappings', async () => {
    mockListGlobalLocalComputerResources.mockResolvedValueOnce([]);

    const { queryAllByTestId, queryByText } = render(
      <TestErrorBoundary>
        <LocalComputerScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(
        queryAllByTestId('local-computer-toolbar-sort-icon').length,
      ).toBeGreaterThan(0);
      expect(
        queryAllByTestId('local-computer-toolbar-list-icon').length,
      ).toBeGreaterThan(0);
      expect(
        queryAllByTestId('local-computer-toolbar-grid-icon').length,
      ).toBeGreaterThan(0);
    });
    expect(queryByText('list-outline')).toBeNull();
    expect(queryByText('grid-outline')).toBeNull();
  });

  it('uses neutral production copy when no desktop is bound', async () => {
    mockBindingState.mockResolvedValueOnce(null);

    const { getByText, queryByText } = render(
      <TestErrorBoundary>
        <LocalComputerScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('Not connected to computer')).toBeTruthy();
    });
    expect(queryByText('MacBook Pro / User Directory')).toBeNull();
  });

  it('keeps the demo desktop subtitle behind the explicit shared files preview gate', async () => {
    testGlobal.__LYNAVO_SHARED_FILES_PREVIEW__ = true;
    mockBindingState.mockResolvedValueOnce(null);

    const { getByText } = render(
      <TestErrorBoundary>
        <LocalComputerScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('MacBook Pro / User Directory')).toBeTruthy();
    });
  });

  it('records a saved local computer download after native persistence succeeds', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockListGlobalLocalComputerResources.mockResolvedValueOnce([
      {
        resourceId: 'personal-dir:alpha.jpg',
        desktopDeviceId: 'desktop-device-id',
        displayName: 'alpha.jpg',
        kind: 'shared_file',
        fileSize: 1024,
        mediaType: 'image',
        status: 'available',
        addedAt: '2026-06-16T08:00:00.000Z',
        downloadCount: 0,
        thumbnailUrl: 'http://192.168.1.100:39394/personal/thumbnail/alpha.jpg',
        previewUrl: 'http://192.168.1.100:39394/personal/stream/alpha.jpg',
        streamUrl: 'http://192.168.1.100:39394/personal/stream/alpha.jpg',
      },
    ]);
    mockDownloadGlobalLocalComputerResource.mockResolvedValueOnce({
      savedToPhotos: false,
      localPath: '/local/alpha.jpg',
    });

    const { getByText } = render(
      <TestErrorBoundary>
        <LocalComputerScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('alpha.jpg')).toBeTruthy();
    });

    fireEvent.press(getByText('download-outline'));

    await waitFor(() => {
      expect(mockDownloadGlobalLocalComputerResource).toHaveBeenCalledWith(
        'personal-dir:alpha.jpg',
      );
    });
    expect(mockRecordDownloadedFile).toHaveBeenCalledWith({
      resourceId: 'personal-dir:alpha.jpg',
      filename: 'alpha.jpg',
      fileSize: 1024,
      mediaType: 'image',
      localPath: '/local/alpha.jpg',
      thumbnailUrl: 'http://192.168.1.100:39394/personal/thumbnail/alpha.jpg',
      previewUrl: 'http://192.168.1.100:39394/personal/stream/alpha.jpg',
      streamUrl: 'http://192.168.1.100:39394/personal/stream/alpha.jpg',
      savedToPhotos: false,
    });
    expect(alertSpy).toHaveBeenCalledWith(
      'Download complete',
      'alpha.jpg saved to Files',
    );

    alertSpy.mockRestore();
  });

  it('records folder image downloads with stream urls for recent download previews', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockListGlobalLocalComputerResources.mockResolvedValueOnce([
      {
        resourceId: 'personal-dir:Album',
        desktopDeviceId: 'desktop-device-id',
        displayName: 'Album',
        kind: 'shared_folder',
        status: 'available',
        addedAt: '2026-06-16T08:00:00.000Z',
        downloadCount: 0,
      },
    ]);
    mockListGlobalLocalComputerFolderContents.mockResolvedValueOnce({
      path: 'Album',
      files: [
        {
          name: 'photo.jpg',
          path: 'Album/photo.jpg',
          type: 'image',
          size: 1024,
          modifiedAt: '2026-06-16T08:31:00.000Z',
          isDirectory: false,
          thumbnailUrl:
            'http://192.168.1.100:39394/personal/thumbnail/Album/photo.jpg?v=1024-1780000',
          streamUrl:
            'http://192.168.1.100:39394/personal/stream/Album/photo.jpg',
        },
      ],
      totalCount: 1,
    });
    mockDownloadGlobalLocalComputerResource.mockResolvedValueOnce({
      savedToPhotos: false,
      localPath: '/local/photo.jpg',
    });

    const { getByText } = render(
      <TestErrorBoundary>
        <LocalComputerScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('Album')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText('Album'));
    });

    await waitFor(() => {
      expect(getByText('photo.jpg')).toBeTruthy();
    });

    fireEvent.press(getByText('download-outline'));

    await waitFor(() => {
      expect(mockDownloadGlobalLocalComputerResource).toHaveBeenCalledWith(
        'personal-dir:Album/photo.jpg',
      );
    });
    expect(mockRecordDownloadedFile).toHaveBeenCalledWith({
      resourceId: 'personal-dir:Album/photo.jpg',
      filename: 'photo.jpg',
      fileSize: 1024,
      mediaType: 'image',
      localPath: '/local/photo.jpg',
      thumbnailUrl:
        'http://192.168.1.100:39394/personal/thumbnail/Album/photo.jpg?v=1024-1780000',
      previewUrl: 'http://192.168.1.100:39394/personal/stream/Album/photo.jpg',
      streamUrl: 'http://192.168.1.100:39394/personal/stream/Album/photo.jpg',
      savedToPhotos: false,
    });
    expect(mockRecordDiagnosticsLog).toHaveBeenCalledWith(
      'LocalComputer',
      'record download source',
      expect.objectContaining({
        resourceId: 'personal-dir:Album/photo.jpg',
        filename: 'photo.jpg',
        mediaType: 'image',
        savedToPhotos: false,
        hasThumbnailUrl: true,
        hasPreviewUrl: true,
        hasStreamUrl: true,
      }),
    );

    alertSpy.mockRestore();
  });

  it('runs the global download gate for every selected file instead of only the first selection', async () => {
    mockListGlobalLocalComputerResources.mockResolvedValueOnce([
      {
        resourceId: 'personal-dir:alpha.jpg',
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
        resourceId: 'personal-dir:beta.mov',
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
    mockDownloadGlobalLocalComputerResource.mockResolvedValue({
      savedToPhotos: false,
      localPath: null,
    });

    const { getByText } = render(
      <TestErrorBoundary>
        <LocalComputerScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('alpha.jpg')).toBeTruthy();
      expect(getByText('beta.mov')).toBeTruthy();
    });

    fireEvent.press(getByText('Select'));
    fireEvent.press(getByText('alpha.jpg'));
    fireEvent.press(getByText('beta.mov'));
    fireEvent.press(getByText(/^(Download|Download)$/));

    await waitFor(() => {
      expect(mockDownloadGlobalLocalComputerResource).toHaveBeenCalledTimes(2);
    });
    expect(mockDownloadGlobalLocalComputerResource).toHaveBeenNthCalledWith(
      1,
      'personal-dir:alpha.jpg',
    );
    expect(mockDownloadGlobalLocalComputerResource).toHaveBeenNthCalledWith(
      2,
      'personal-dir:beta.mov',
    );
  });

  it('opens the system share flow for selected local computer files', async () => {
    mockListGlobalLocalComputerResources.mockResolvedValueOnce([
      {
        resourceId: 'personal-dir:alpha.jpg',
        desktopDeviceId: 'desktop-device-id',
        displayName: 'alpha.jpg',
        kind: 'shared_file',
        fileSize: 1024,
        mediaType: 'image',
        status: 'available',
        addedAt: '2026-06-16T08:00:00.000Z',
        downloadCount: 0,
        thumbnailUrl: 'http://192.168.1.100:39394/personal/thumbnail/alpha.jpg',
      },
    ]);
    mockShareGlobalLocalComputerResources.mockResolvedValueOnce(undefined);

    const { getByText } = render(
      <TestErrorBoundary>
        <LocalComputerScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('alpha.jpg')).toBeTruthy();
    });

    fireEvent.press(getByText('Select'));
    fireEvent.press(getByText('alpha.jpg'));
    fireEvent.press(getByText('Share'));

    await waitFor(() => {
      expect(mockShareGlobalLocalComputerResources).toHaveBeenCalledWith([
        { resourceId: 'personal-dir:alpha.jpg', displayName: 'alpha.jpg' },
      ]);
    });
  });

  it('opens a local computer document with the system preview viewer', async () => {
    mockListGlobalLocalComputerResources.mockResolvedValueOnce([
      {
        resourceId: 'personal-dir:manual.pdf',
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
    mockPrepareGlobalLocalComputerPreview.mockResolvedValueOnce(
      '/cache/manual.pdf',
    );
    mockViewDocument.mockResolvedValueOnce(undefined);

    const { getByText } = render(
      <TestErrorBoundary>
        <LocalComputerScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('manual.pdf')).toBeTruthy();
    });

    fireEvent.press(getByText('manual.pdf'));

    await waitFor(() => {
      expect(mockPrepareGlobalLocalComputerPreview).toHaveBeenCalledWith(
        'personal-dir:manual.pdf',
        'manual.pdf',
      );
    });
    expect(mockViewDocument).toHaveBeenCalledWith({
      uri: 'file:///cache/manual.pdf',
      headerTitle: 'manual.pdf',
      mimeType: 'application/pdf',
    });
  });

  it('opens unsupported extensionless local computer documents through the system app chooser', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockListGlobalLocalComputerResources.mockResolvedValueOnce([
      {
        resourceId: 'personal-dir:protoc-gen-go',
        desktopDeviceId: 'desktop-device-id',
        displayName: 'protoc-gen-go',
        kind: 'shared_file',
        fileSize: 9071458,
        mediaType: 'document',
        status: 'available',
        addedAt: '2026-06-17T11:16:32.000Z',
        downloadCount: 0,
      },
    ]);
    mockPrepareGlobalLocalComputerShareFile.mockResolvedValueOnce(
      '/downloads/protoc-gen-go',
    );
    mockShareOpen.mockResolvedValueOnce(undefined);

    const { getByText } = render(
      <TestErrorBoundary>
        <LocalComputerScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('protoc-gen-go')).toBeTruthy();
    });

    fireEvent.press(getByText('protoc-gen-go'));

    await waitFor(() => {
      expect(mockPrepareGlobalLocalComputerShareFile).toHaveBeenCalledWith(
        'personal-dir:protoc-gen-go',
        'protoc-gen-go',
      );
    });

    expect(mockShareOpen).toHaveBeenCalledWith({
      url: 'file:///downloads/protoc-gen-go',
      type: 'application/octet-stream',
      filename: 'protoc-gen-go',
      title: 'protoc-gen-go',
      subject: 'protoc-gen-go',
      failOnCancel: false,
      showAppsToView: true,
    });
    expect(mockPrepareGlobalLocalComputerPreview).not.toHaveBeenCalled();
    expect(mockViewDocument).not.toHaveBeenCalled();
  });

  it('opens a local computer image inside the app preview instead of the system viewer', async () => {
    mockListGlobalLocalComputerResources.mockResolvedValueOnce([
      {
        resourceId: 'personal-dir:cover.png',
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
    mockGetGlobalLocalComputerPreviewUrl.mockResolvedValueOnce(
      'http://192.168.1.100:39394/personal/stream/cover.png',
    );

    const { getByTestId, getByText } = render(
      <TestErrorBoundary>
        <LocalComputerScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('cover.png')).toBeTruthy();
    });

    fireEvent.press(getByText('cover.png'));

    await waitFor(() => {
      expect(mockGetGlobalLocalComputerPreviewUrl).toHaveBeenCalledWith(
        'personal-dir:cover.png',
      );
      expect(getByTestId('local-computer-resource-preview-image')).toBeTruthy();
    });
    expect(mockPrepareGlobalLocalComputerPreview).not.toHaveBeenCalled();
    expect(mockViewDocument).not.toHaveBeenCalled();
  });
});

describe('PhoneSyncSpaceScreen', () => {
  const mockBindingState = jest.fn();
  const testGlobal = globalThis as typeof globalThis & {
    __LYNAVO_SHARED_FILES_PREVIEW__?: boolean;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockVisualQaEnabled = false;
    delete testGlobal.__LYNAVO_SHARED_FILES_PREVIEW__;
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
    mockCurrentClientReceivedLibraryPageFromLegacyList();
  });

  it('keeps an empty real received library empty unless the shared files preview gate is explicit', async () => {
    mockVisualQaEnabled = true;
    mockListCurrentClientReceivedLibrary.mockResolvedValueOnce([]);

    const { getByTestId, getByText, queryByText } = render(
      <TestErrorBoundary>
        <PhoneSyncSpaceScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(mockListCurrentClientReceivedLibrary).toHaveBeenCalledWith({
        host: '192.168.1.100',
        port: 39394,
      });
    });

    await waitFor(() => {
      expect(getByText('No synced files yet')).toBeTruthy();
    });
    expect(getByTestId('phone-sync-empty-icon')).toBeTruthy();
    expect(queryByText('IMG_8421.JPG')).toBeNull();
  });

  it('loads the next global sync-space page when the received list reaches the end', async () => {
    mockListGlobalReceivedLibraryPage
      .mockResolvedValueOnce(
        makeReceivedLibraryPage(
          [
            {
              resourceId: 'received-alpha',
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
          ],
          {
            page: 1,
            pageSize: 20,
            totalItems: 41,
            totalBytes: 8388608,
          },
        ),
      )
      .mockResolvedValueOnce(
        makeReceivedLibraryPage(
          [
            {
              resourceId: 'received-beta',
              desktopDeviceId: 'desktop-device-id',
              clientId: 'client-001',
              displayName: 'beta.mov',
              fileKey: 'received/beta.mov',
              filename: 'beta.mov',
              mediaType: 'video',
              fileSize: 2048,
              completedAt: '2026-06-16T07:00:00.000Z',
              shareStatus: 'shared',
            },
          ],
          {
            page: 2,
            pageSize: 20,
            totalItems: 41,
            totalBytes: 8388608,
          },
        ),
      );

    const { getByTestId, getByText } = render(
      <TestErrorBoundary>
        <PhoneSyncSpaceScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(mockListGlobalReceivedLibraryPage).toHaveBeenNthCalledWith(
        1,
        { host: '192.168.1.100', port: 39394 },
        { page: 1, pageSize: 20 },
      );
      expect(getByText('alpha.jpg')).toBeTruthy();
      expect(getByText(/41 items/)).toBeTruthy();
    });

    fireEvent(getByTestId('phone-sync-section-list'), 'onEndReached');

    await waitFor(() => {
      expect(mockListGlobalReceivedLibraryPage).toHaveBeenNthCalledWith(
        2,
        { host: '192.168.1.100', port: 39394 },
        { page: 2, pageSize: 20 },
      );
      expect(getByText('beta.mov')).toBeTruthy();
    });
  });

  it('shows a load error instead of the empty state when the global phone sync listing fails', async () => {
    mockListCurrentClientReceivedLibrary.mockRejectedValueOnce(
      new Error('route unavailable'),
    );

    const { getByText, queryByText } = render(
      <TestErrorBoundary>
        <PhoneSyncSpaceScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('Failed to Load')).toBeTruthy();
    });
    expect(getByText('Please try again later')).toBeTruthy();
    expect(queryByText('No synced files yet')).toBeNull();
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
    mockGetReceivedLibraryPreviewUrl.mockResolvedValueOnce(
      'http://192.168.1.100:39394/resources/mobile/received/preview?clientId=client-001&fileKey=received%2Falpha.jpg',
    );

    const {
      getByLabelText,
      getByTestId,
      getByText,
      queryAllByTestId,
      queryByLabelText,
    } = render(
      <TestErrorBoundary>
        <PhoneSyncSpaceScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('alpha.jpg')).toBeTruthy();
    });

    expect(getByTestId('phone-sync-thumbnail-image')).toBeTruthy();
    expect(queryByLabelText('Save Not Available')).toBeNull();
    expect(queryAllByTestId('phone-sync-download-icon').length).toBeGreaterThan(
      0,
    );

    const previewButton = getByLabelText('Preview synced file');
    expect(previewButton.props.accessibilityState?.disabled).not.toBe(true);

    fireEvent.press(previewButton);

    await waitFor(() => {
      expect(mockGetReceivedLibraryPreviewUrl).toHaveBeenCalledWith(
        { host: '192.168.1.100', port: 39394 },
        expect.objectContaining({ fileKey: 'received/alpha.jpg' }),
      );
      expect(getByTestId('phone-sync-preview-image')).toBeTruthy();
    });
  });

  it('renders received video thumbnail image without preloading the video and opens the real video preview', async () => {
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
        thumbnailUrl:
          'http://192.168.1.100:39394/resources/mobile/received/thumbnail?fileKey=received-video',
        previewUrl:
          'http://192.168.1.100:39394/resources/mobile/received/preview?fileKey=received-video',
        streamUrl:
          'http://192.168.1.100:39394/resources/mobile/received/stream?fileKey=received-video',
      },
    ]);
    mockGetReceivedLibraryPreviewUrl.mockResolvedValueOnce(
      'http://192.168.1.100:39394/resources/mobile/received/stream?clientId=client-001&fileKey=received%2Fbeta.mov',
    );

    const { getByLabelText, getByTestId, getByText, queryByTestId } = render(
      <TestErrorBoundary>
        <PhoneSyncSpaceScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('beta.mov')).toBeTruthy();
    });

    expect(getByTestId('phone-sync-thumbnail-image')).toBeTruthy();
    expect(queryByTestId('phone-sync-thumbnail-video')).toBeNull();
    expect(queryByTestId('phone-sync-media-icon-video')).toBeNull();

    fireEvent.press(getByLabelText('Preview synced file'));

    await waitFor(() => {
      expect(mockGetReceivedLibraryPreviewUrl).toHaveBeenCalledWith(
        { host: '192.168.1.100', port: 39394 },
        expect.objectContaining({ fileKey: 'received/beta.mov' }),
      );
      expect(getByTestId('phone-sync-preview-video')).toBeTruthy();
    });
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
    mockGetReceivedLibraryPreviewUrl.mockResolvedValueOnce(
      'http://192.168.1.100:39394/resources/mobile/received/preview?clientId=client-001&fileKey=received%2Falpha.jpg',
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
      expect(mockGetReceivedLibraryPreviewUrl).toHaveBeenCalledWith(
        { host: '192.168.1.100', port: 39394 },
        expect.objectContaining({ fileKey: 'received/alpha.jpg' }),
      );
      expect(getByTestId('phone-sync-preview-image')).toBeTruthy();
    });
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
    mockPrepareReceivedLibraryPreview.mockResolvedValueOnce('/cache/notes.pdf');
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
      expect(mockPrepareReceivedLibraryPreview).toHaveBeenCalledWith(
        { host: '192.168.1.100', port: 39394 },
        expect.objectContaining({ fileKey: 'received/notes.pdf' }),
      );
    });
    expect(mockViewDocument).toHaveBeenCalledWith({
      uri: 'file:///cache/notes.pdf',
      headerTitle: 'notes.pdf',
      mimeType: 'application/pdf',
    });
  });

  it('marks deleted global sync-space items and disables preview and download', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockListCurrentClientReceivedLibrary.mockResolvedValueOnce([
      {
        resourceId: 'received-deleted',
        desktopDeviceId: 'desktop-device-id',
        clientId: 'client-001',
        displayName: 'deleted.jpg',
        fileKey: 'received/deleted.jpg',
        filename: 'deleted.jpg',
        mediaType: 'image',
        fileSize: 1024,
        completedAt: '2026-06-16T08:00:00.000Z',
        shareStatus: 'shared',
        fileStatus: 'deleted',
        thumbnailUrl:
          'http://192.168.1.100:39394/resources/mobile/received/thumbnail?fileKey=received-deleted',
        previewUrl:
          'http://192.168.1.100:39394/resources/mobile/received/preview?fileKey=received-deleted',
      },
    ]);

    const { getByLabelText, getByText, queryByTestId } = render(
      <TestErrorBoundary>
        <PhoneSyncSpaceScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('deleted.jpg')).toBeTruthy();
    });

    expect(getByText('Deleted on computer')).toBeTruthy();
    expect(queryByTestId('phone-sync-thumbnail-image')).toBeNull();

    const previewButton = getByLabelText('Preview synced file');
    const downloadButton = getByLabelText('Download synced file');
    expect(previewButton.props.accessibilityState?.disabled).toBe(true);
    expect(downloadButton.props.accessibilityState?.disabled).toBe(true);

    fireEvent.press(previewButton);
    fireEvent.press(downloadButton);

    expect(mockGetReceivedLibraryPreviewUrl).not.toHaveBeenCalled();
    expect(mockPrepareReceivedLibraryPreview).not.toHaveBeenCalled();
    expect(mockDownloadReceivedLibraryItem).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();

    alertSpy.mockRestore();
  });

  it('downloads a not-shared global sync-space item by fileKey', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockListCurrentClientReceivedLibrary.mockResolvedValueOnce([
      {
        resourceId: '',
        desktopDeviceId: 'desktop-device-id',
        clientId: 'client-001',
        displayName: 'alpha.jpg',
        fileKey: 'received/alpha.jpg',
        filename: 'alpha.jpg',
        mediaType: 'image',
        fileSize: 1024,
        completedAt: '2026-06-16T08:00:00.000Z',
        shareStatus: 'not_shared',
        thumbnailUrl:
          'http://192.168.1.100:39394/resources/mobile/received/thumbnail?fileKey=received-1',
        previewUrl:
          'http://192.168.1.100:39394/resources/mobile/received/preview?fileKey=received-1',
      },
    ]);
    mockDownloadReceivedLibraryItem.mockResolvedValueOnce({
      savedToPhotos: true,
      localPath: 'ph://asset-001',
      savedLocation: 'Photos',
    });
    mockRecordDownloadedFile.mockResolvedValueOnce(undefined);

    const { getByLabelText, getByText } = render(
      <TestErrorBoundary>
        <PhoneSyncSpaceScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('alpha.jpg')).toBeTruthy();
    });

    fireEvent.press(getByLabelText('Download synced file'));

    await waitFor(() => {
      expect(mockDownloadReceivedLibraryItem).toHaveBeenCalledWith(
        { host: '192.168.1.100', port: 39394 },
        expect.objectContaining({ fileKey: 'received/alpha.jpg' }),
      );
    });
    expect(mockRecordDownloadedFile).toHaveBeenCalledWith({
      resourceId: 'received/alpha.jpg',
      filename: 'alpha.jpg',
      fileSize: 1024,
      mediaType: 'image',
      localPath: 'ph://asset-001',
      thumbnailUrl:
        'http://192.168.1.100:39394/resources/mobile/received/thumbnail?fileKey=received-1',
      previewUrl:
        'http://192.168.1.100:39394/resources/mobile/received/preview?fileKey=received-1',
      savedToPhotos: true,
    });
    expect(alertSpy).toHaveBeenCalledWith(
      'Download complete',
      'alpha.jpg saved to Photos',
    );

    alertSpy.mockRestore();
  });

  it('shows the photo-library alert for global sync-space downloads identified by PhotoKit path', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockListCurrentClientReceivedLibrary.mockResolvedValueOnce([
      {
        resourceId: '',
        desktopDeviceId: 'desktop-device-id',
        clientId: 'client-001',
        displayName: 'alpha.jpg',
        fileKey: 'received/alpha.jpg',
        filename: 'alpha.jpg',
        mediaType: 'image/jpeg',
        fileSize: 1024,
        completedAt: '2026-06-16T08:00:00.000Z',
        shareStatus: 'not_shared',
      },
    ]);
    mockDownloadReceivedLibraryItem.mockResolvedValueOnce({
      savedToPhotos: false,
      localPath: 'ph://asset-001',
      savedLocation: 'Photos',
    });
    mockRecordDownloadedFile.mockResolvedValueOnce(undefined);

    const { getByLabelText, getByText } = render(
      <TestErrorBoundary>
        <PhoneSyncSpaceScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('alpha.jpg')).toBeTruthy();
    });

    fireEvent.press(getByLabelText('Download synced file'));

    await waitFor(() => {
      expect(mockDownloadReceivedLibraryItem).toHaveBeenCalledWith(
        { host: '192.168.1.100', port: 39394 },
        expect.objectContaining({ fileKey: 'received/alpha.jpg' }),
      );
    });
    expect(mockRecordDownloadedFile).toHaveBeenCalledWith({
      resourceId: 'received/alpha.jpg',
      filename: 'alpha.jpg',
      fileSize: 1024,
      mediaType: 'image/jpeg',
      localPath: 'ph://asset-001',
      savedToPhotos: true,
    });
    expect(alertSpy).toHaveBeenCalledWith(
      'Download complete',
      'alpha.jpg saved to Photos',
    );

    alertSpy.mockRestore();
  });

  it('accepts global sync-space document downloads saved to device Downloads', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockListCurrentClientReceivedLibrary.mockResolvedValueOnce([
      {
        resourceId: '',
        desktopDeviceId: 'desktop-device-id',
        clientId: 'client-001',
        displayName: 'notes.txt',
        fileKey: 'received/notes.txt',
        filename: 'notes.txt',
        mediaType: 'document',
        fileSize: 128,
        completedAt: '2026-06-16T08:10:00.000Z',
        shareStatus: 'not_shared',
      },
    ]);
    mockDownloadReceivedLibraryItem.mockResolvedValueOnce({
      savedToPhotos: false,
      localPath: 'content://downloads/my_downloads/42',
      savedLocation: 'Downloads/Lynavo Drive',
    });
    mockRecordDownloadedFile.mockResolvedValueOnce(undefined);

    const { getByLabelText, getByText } = render(
      <TestErrorBoundary>
        <PhoneSyncSpaceScreen />
      </TestErrorBoundary>,
    );

    await waitFor(() => {
      expect(getByText('notes.txt')).toBeTruthy();
    });

    fireEvent.press(getByLabelText('Download synced file'));

    await waitFor(() => {
      expect(mockDownloadReceivedLibraryItem).toHaveBeenCalledWith(
        { host: '192.168.1.100', port: 39394 },
        expect.objectContaining({ fileKey: 'received/notes.txt' }),
      );
    });
    expect(mockRecordDownloadedFile).toHaveBeenCalledWith({
      resourceId: 'received/notes.txt',
      filename: 'notes.txt',
      fileSize: 128,
      mediaType: 'document',
      localPath: 'content://downloads/my_downloads/42',
      savedToPhotos: false,
    });
    expect(alertSpy).toHaveBeenCalledWith(
      'Download complete',
      'notes.txt saved to Files',
    );

    alertSpy.mockRestore();
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
        <PhoneSyncSpaceScreen />
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
        <PhoneSyncSpaceScreen />
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
    });
    expect(queryByText('list-outline')).toBeNull();
    expect(queryByText('download-outline')).toBeNull();
    expect(queryAllByTestId('phone-sync-download-icon').length).toBeGreaterThan(
      0,
    );
    expect(queryByText('folder-open-outline')).toBeNull();
    expect(queryByText('document-text')).toBeNull();
  });

  it('renders the global sync-space sort sheet in-tree on Android', async () => {
    const originalPlatformOS = Platform.OS;
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'android',
    });

    try {
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

      const { getByTestId, getByText, UNSAFE_queryAllByProps } = render(
        <TestErrorBoundary>
          <PhoneSyncSpaceScreen />
        </TestErrorBoundary>,
      );

      await waitFor(() => {
        expect(getByText('notes.pdf')).toBeTruthy();
      });

      fireEvent.press(getByText('Time'));

      expect(getByText('Sort By')).toBeTruthy();
      expect(getByTestId('phone-sync-sort-sheet-layer')).toBeTruthy();
      expect(UNSAFE_queryAllByProps({ transparent: true })).toHaveLength(0);
    } finally {
      Object.defineProperty(Platform, 'OS', {
        configurable: true,
        value: originalPlatformOS,
      });
    }
  });

  it('uses the default visible-range list rendering on Android without a six-row cap', async () => {
    const originalPlatformOS = Platform.OS;
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'android',
    });

    try {
      mockListGlobalReceivedLibraryPage.mockResolvedValueOnce(
        makeReceivedLibraryPage(
          [
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
          ],
          {
            page: 1,
            pageSize: 20,
            totalItems: 1,
            totalBytes: 512,
          },
        ),
      );

      const { getByTestId, getByText } = render(
        <TestErrorBoundary>
          <PhoneSyncSpaceScreen />
        </TestErrorBoundary>,
      );

      await waitFor(() => {
        expect(getByText('notes.pdf')).toBeTruthy();
      });

      const listProps = getByTestId('phone-sync-section-list').props;
      expect(listProps.initialNumToRender).toBeUndefined();
      expect(listProps.maxToRenderPerBatch).toBeUndefined();
      expect(listProps.updateCellsBatchingPeriod).toBeUndefined();
      expect(listProps.windowSize).toBeUndefined();
      expect(listProps.removeClippedSubviews).toBeUndefined();
    } finally {
      Object.defineProperty(Platform, 'OS', {
        configurable: true,
        value: originalPlatformOS,
      });
    }
  });
});
