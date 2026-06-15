import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { Alert, NativeModules } from 'react-native';

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
        'sharedFiles.dialogs.downloadFailedMessage': '無法下載檔案，請稍後重試',
      };
      if (key === 'sharedFiles.dialogs.downloadSavedToPhotos' && options?.name) {
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

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
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

// Mock local desktop service
jest.mock('../../services/desktop-local-service', () => ({
  listSharedResources: jest.fn(),
  listReceivedLibrary: jest.fn(),
  downloadResource: jest.fn(),
}));

import {
  SharedFilesScreen,
  normalizeDirectoryPath,
  parentDirectoryPath,
} from '../SharedFilesScreen';
import {
  listSharedResources,
  listReceivedLibrary,
  downloadResource,
} from '../../services/desktop-local-service';

const mockListSharedResources = listSharedResources as jest.Mock;
const mockListReceivedLibrary = listReceivedLibrary as jest.Mock;
const mockDownloadResource = downloadResource as jest.Mock;

class TestErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
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

describe('SharedFilesScreen V2', () => {
  const mockBindingState = NativeModules.NativeSyncEngine.getBindingState as jest.Mock;


  beforeEach(() => {
    jest.clearAllMocks();
    mockBindingState.mockResolvedValue({
      deviceId: 'desktop-device-id',
      host: '192.168.1.100',
      connectionState: 'connected',
    });
  });

  it('renders device unavailable when no device is bound', async () => {
    mockBindingState.mockResolvedValueOnce(null);
    const { getByText } = render(
      <TestErrorBoundary>
        <SharedFilesScreen />
      </TestErrorBoundary>
    );
    await waitFor(() => {
      expect(getByText('設備不可用')).toBeTruthy();
    });
  });

  it('renders loading state and list of shared resources', async () => {
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
        kind: 'file',
        fileSize: 1572864, // 1.5 MB
      },
    ]);

    const { getByText, queryByText } = render(
      <TestErrorBoundary>
        <SharedFilesScreen />
      </TestErrorBoundary>
    );

    // Shows loading state initially
    expect(getByText('載入中...')).toBeTruthy();

    await waitFor(() => {
      expect(queryByText('載入中...')).toBeNull();
      expect(getByText('test-folder')).toBeTruthy();
      expect(getByText('photo.jpg')).toBeTruthy();
    });
  });

  it('triggers download when download button is pressed', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockListSharedResources.mockResolvedValueOnce([
      {
        resourceId: 'res-2',
        displayName: 'photo.jpg',
        kind: 'file',
        fileSize: 1048576, // 1.0 MB
      },
    ]);
    mockDownloadResource.mockResolvedValueOnce(undefined);

    const { getByText } = render(
      <TestErrorBoundary>
        <SharedFilesScreen />
      </TestErrorBoundary>
    );

    await waitFor(() => {
      expect(getByText('photo.jpg')).toBeTruthy();
    });

    // Press download by pressing the file text
    fireEvent.press(getByText('photo.jpg'));

    await waitFor(() => {
      expect(mockDownloadResource).toHaveBeenCalledWith(
        { host: '192.168.1.100', port: 39394 },
        'res-2'
      );
    });

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('下載完成', 'photo.jpg 已儲存至相簿');
    });

    alertSpy.mockRestore();
  });

  it('switches tabs to received files and lists them', async () => {
    mockListSharedResources.mockResolvedValueOnce([]);
    mockListReceivedLibrary.mockResolvedValueOnce([
      {
        resourceId: 'rec-1',
        displayName: 'received-file.mp4',
        fileSize: 2097152, // 2.0 MB
      },
    ]);

    const { getByText } = render(
      <TestErrorBoundary>
        <SharedFilesScreen />
      </TestErrorBoundary>
    );

    await waitFor(() => {
      expect(getByText('目前沒有內容')).toBeTruthy();
    });

    // Switch tab
    const receivedTabButton = getByText('已接收的檔案');
    fireEvent.press(receivedTabButton);

    await waitFor(() => {
      expect(getByText('received-file.mp4')).toBeTruthy();
    });
  });
});
