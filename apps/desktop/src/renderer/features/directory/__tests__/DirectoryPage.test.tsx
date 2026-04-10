import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DirectoryPage } from '../DirectoryPage';
import { useDirectoryStore } from '@renderer/stores/directory-store';
import { useSettingsStore } from '@renderer/stores/settings-store';
import { mockSettings } from '@renderer/mocks/settings';
import { DirectoryPathCard } from '../DirectoryPathCard';
import { ReceivedFileList } from '../ReceivedFileList';
import { SharedFileList } from '../SharedFileList';

/** Shared electronAPI mock wired up for all tests */
function setupElectronAPI() {
  (window as Window & { electronAPI?: unknown }).electronAPI = {
    sidecar: {
      getDashboardDevices: vi.fn().mockResolvedValue([]),
      getDeviceDates: vi.fn().mockResolvedValue({ dates: [] }),
      getDeviceFiles: vi.fn().mockResolvedValue({
        items: [],
        page: 1,
        pageSize: 500,
        totalItems: 0,
        totalBytes: 0,
        totalActiveTransmissionMs: 0,
      }),
      getSettings: vi.fn().mockResolvedValue(mockSettings),
      getSharedList: vi.fn().mockResolvedValue({ path: '', files: [], totalCount: 0 }),
      validateShare: vi.fn().mockResolvedValue({
        enabled: true,
        smbUrl: mockSettings.shareAddress,
        status: mockSettings.shareStatus,
        shareName: mockSettings.shareName,
      }),
      getTransferActive: vi.fn().mockResolvedValue({ active: false }),
      updateSettings: vi.fn().mockResolvedValue(mockSettings),
    },
    files: {
      openFolder: vi.fn(),
      openFile: vi.fn(),
      openExternal: vi.fn(),
      selectFolder: vi.fn(),
      copyToClipboard: vi.fn(),
    },
    platform: {
      isMac: () => true,
      isWindows: () => false,
      getHostName: () => 'Test-Mac',
      getLocalIPs: () => ['192.168.1.10'],
    },
    events: {
      onSidecarEvent: vi.fn(() => vi.fn()),
      onSidecarRuntimeState: vi.fn(() => vi.fn()),
    },
    support: {
      exportDiagnostics: vi.fn().mockResolvedValue(null),
      getAppInfo: vi
        .fn()
        .mockResolvedValue({ name: 'SyncFlow', version: '0.1.0', buildNumber: '1' }),
    },
  } as unknown as Window['electronAPI'];
}

describe('DirectoryPage', () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, 'electronAPI');
    useDirectoryStore.setState(useDirectoryStore.getInitialState());
    useSettingsStore.setState({
      settings: mockSettings,
      shareStatusInfo: {
        enabled: true,
        smbUrl: mockSettings.shareAddress,
        status: mockSettings.shareStatus,
        shareName: mockSettings.shareName,
      },
      validatingShare: false,
      copiedField: null,
    });
    setupElectronAPI();
  });

  it('renders page header', () => {
    render(<DirectoryPage />);
    expect(screen.getByText('目录管理')).toBeInTheDocument();
  });

  it('renders two tab buttons', () => {
    render(<DirectoryPage />);
    // Tab buttons are within the GlassCard tab bar; use getAllBy to handle label appearing in other places
    const receivedMatches = screen.getAllByText(/接收目录/);
    const sharedMatches = screen.getAllByText(/共享目录/);
    // At least one of each should be a button element
    expect(receivedMatches.some((el) => el.closest('button'))).toBe(true);
    expect(sharedMatches.some((el) => el.closest('button'))).toBe(true);
  });

  it('clicking shared tab switches the active tab', () => {
    render(<DirectoryPage />);

    // Find the tab button specifically (not the heading in DirectoryPathCard)
    const sharedButtons = screen.getAllByText(/共享目录/);
    const sharedTabButton = sharedButtons.find((el) => el.tagName === 'BUTTON')!;
    fireEvent.click(sharedTabButton);

    expect(useDirectoryStore.getState().activeTab).toBe('shared');
  });
});

describe('DirectoryPathCard', () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, 'electronAPI');
    useSettingsStore.setState({
      settings: mockSettings,
      shareStatusInfo: {
        enabled: true,
        smbUrl: mockSettings.shareAddress,
        status: mockSettings.shareStatus,
        shareName: mockSettings.shareName,
      },
      validatingShare: false,
      copiedField: null,
    });
    setupElectronAPI();
  });

  it('renders root path derived from receivePath', () => {
    // receivePath = '/Users/alice/SyncFlow/Received' — derivePaths checks for lowercase 'received'
    // Since the mock has 'Received' (capitalized), the whole path is treated as root
    render(<DirectoryPathCard />);
    // Root path appears in the root card and also as received sub-card — use getAllByText
    const rootMatches = screen.getAllByText(mockSettings.receivePath);
    expect(rootMatches.length).toBeGreaterThanOrEqual(1);
  });

  it('renders received directory label', () => {
    render(<DirectoryPathCard />);
    expect(screen.getByText('接收目录')).toBeInTheDocument();
  });

  it('renders shared directory label', () => {
    render(<DirectoryPathCard />);
    expect(screen.getByText('共享目录')).toBeInTheDocument();
  });

  it('renders root directory label', () => {
    render(<DirectoryPathCard />);
    expect(screen.getByText('根目录路径')).toBeInTheDocument();
  });

  it('derives root and shared path when receivePath ends with lowercase received', () => {
    useSettingsStore.setState({
      settings: {
        ...mockSettings,
        receivePath: '/Users/alice/SyncFlow/received',
      },
    });

    render(<DirectoryPathCard />);

    // Root should be /Users/alice/SyncFlow
    expect(screen.getByText('/Users/alice/SyncFlow')).toBeInTheDocument();
    // Shared should be /Users/alice/SyncFlow/shared
    expect(screen.getByText('/Users/alice/SyncFlow/shared')).toBeInTheDocument();
  });
});

describe('ReceivedFileList', () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, 'electronAPI');
    useDirectoryStore.setState(useDirectoryStore.getInitialState());
    setupElectronAPI();
  });

  it('renders empty state when no files', () => {
    render(<ReceivedFileList />);
    expect(screen.getByText('暂无接收文件')).toBeInTheDocument();
  });

  it('renders file rows with correct columns', () => {
    useDirectoryStore.setState({
      receivedFiles: [
        {
          fileKey: 'fk-1',
          originalFilename: 'vacation.mp4',
          mediaType: 'video/mp4',
          fileSize: 10485760,
          completedAt: '2026-04-10T09:30:00Z',
          activeTransmissionMs: 500,
          finalPath: '/tmp/vacation.mp4',
          deviceName: 'iPhone 15',
          deviceId: 'dev-1',
        },
      ],
      receivedTotalBytes: 10485760,
      loading: false,
    });

    render(<ReceivedFileList />);

    expect(screen.getByText('vacation.mp4')).toBeInTheDocument();
    expect(screen.getByText('iPhone 15')).toBeInTheDocument();
    // Stats bar should reflect 1 file
    expect(screen.getByText(/共 1 个文件/)).toBeInTheDocument();
  });

  it('renders loading state', () => {
    useDirectoryStore.setState({ loading: true });

    render(<ReceivedFileList />);

    expect(screen.getByText('正在加载文件列表...')).toBeInTheDocument();
  });

  it('resolves relative receive paths before opening media preview', () => {
    useSettingsStore.setState({
      settings: {
        ...mockSettings,
        receivePath: '/Users/alice/SyncFlow/Received',
      },
    });
    useDirectoryStore.setState({
      receivedFiles: [
        {
          fileKey: 'fk-1',
          originalFilename: 'vacation clip.mp4',
          mediaType: 'video/mp4',
          fileSize: 10485760,
          completedAt: '2026-04-10T09:30:00Z',
          activeTransmissionMs: 500,
          finalPath: 'iPhone 15/2026-04-10/vacation clip.mp4',
          deviceName: 'iPhone 15',
          deviceId: 'dev-1',
        },
      ],
      receivedTotalBytes: 10485760,
      loading: false,
    });

    render(<ReceivedFileList />);
    fireEvent.click(screen.getByRole('button', { name: '打开' }));

    expect(useDirectoryStore.getState().previewFile).toMatchObject({
      mediaType: 'video',
      url: 'media:///Users/alice/SyncFlow/Received/iPhone%2015/2026-04-10/vacation%20clip.mp4',
    });
  });
});

describe('SharedFileList', () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, 'electronAPI');
    useDirectoryStore.setState(useDirectoryStore.getInitialState());
    setupElectronAPI();
  });

  it('renders empty state when no shared files', () => {
    render(<SharedFileList />);
    expect(screen.getByText('共享目录暂无文件')).toBeInTheDocument();
  });

  it('renders shared file rows when files exist', () => {
    useDirectoryStore.setState({
      sharedFiles: [
        {
          name: 'report.pdf',
          path: '/shared/report.pdf',
          type: 'document',
          size: 8192,
          modifiedAt: '2026-04-09T12:00:00Z',
        },
      ],
    });

    render(<SharedFileList />);

    expect(screen.getByText('report.pdf')).toBeInTheDocument();
    expect(screen.getByText(/共 1 个文件/)).toBeInTheDocument();
  });

  it('renders empty state message', () => {
    render(<SharedFileList />);
    expect(screen.getByText('共享目录暂无文件')).toBeInTheDocument();
  });

  it('resolves relative shared paths before opening files', () => {
    const openFile = vi.fn();
    (window as Window & { electronAPI?: unknown }).electronAPI = {
      ...(window.electronAPI ?? {}),
      files: {
        ...(window.electronAPI?.files ?? {}),
        openFile,
      },
    } as unknown as Window['electronAPI'];

    useSettingsStore.setState({
      settings: {
        ...mockSettings,
        sharedPath: '/Users/alice/SyncFlow/shared',
      },
    });
    useDirectoryStore.setState({
      sharedFiles: [
        {
          name: 'report.pdf',
          path: 'nested/report.pdf',
          type: 'document',
          size: 8192,
          modifiedAt: '2026-04-09T12:00:00Z',
        },
      ],
    });

    render(<SharedFileList />);
    fireEvent.click(screen.getByRole('button', { name: '打开' }));

    expect(openFile).toHaveBeenCalledWith('/Users/alice/SyncFlow/shared/nested/report.pdf');
  });
});
