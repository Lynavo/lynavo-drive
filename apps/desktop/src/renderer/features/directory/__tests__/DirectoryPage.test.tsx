import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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
      getHomeDir: () => '/Users/alice',
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
        .mockResolvedValue({ name: 'LynavoDrive', version: '0.1.0', buildNumber: '1' }),
    },
  } as unknown as Window['electronAPI'];
}

describe('DirectoryPage', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
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
    expect(screen.getByText('Folder Management')).toBeInTheDocument();
  });

  it('renders local received and shared tabs in the OSS product', () => {
    render(<DirectoryPage />);
    const receivedMatches = screen.getAllByText(/^Received$/);
    expect(receivedMatches.some((el) => el.closest('button'))).toBe(true);
    expect(screen.getByRole('button', { name: /Team Shared/ })).toBeInTheDocument();
  });

  it('allows switching to the local shared tab', async () => {
    const fetchSharedFiles = vi.fn().mockResolvedValue(undefined);
    useDirectoryStore.setState({
      fetchSharedFiles,
    });

    render(<DirectoryPage />);

    await waitFor(() => {
      expect(fetchSharedFiles).toHaveBeenCalled();
    });
    fetchSharedFiles.mockClear();

    fireEvent.click(screen.getByRole('button', { name: /Team Shared/ }));

    expect(useDirectoryStore.getState().activeTab).toBe('shared');
    expect(fetchSharedFiles).toHaveBeenCalledTimes(1);
  });

  it('keeps the local shared tab visible without reading external env', () => {
    render(<DirectoryPage />);

    expect(screen.getByRole('button', { name: /Team Shared/ })).toBeInTheDocument();
  });

  it('polls the active tab while the page stays visible', async () => {
    vi.useFakeTimers();

    const fetchReceivedFiles = vi.fn().mockResolvedValue(undefined);
    const fetchSharedFiles = vi.fn().mockResolvedValue(undefined);
    const fetchAll = vi.fn().mockResolvedValue(undefined);
    useDirectoryStore.setState({
      activeTab: 'received',
      fetchReceivedFiles,
      fetchSharedFiles,
      fetchAll,
    });

    render(<DirectoryPage />);
    fetchReceivedFiles.mockClear();

    await vi.advanceTimersByTimeAsync(3000);

    expect(fetchReceivedFiles).toHaveBeenCalledTimes(1);
    expect(fetchSharedFiles).not.toHaveBeenCalled();
  });

  it('refreshes local received and shared files on focus and visibility changes', async () => {
    const fetchReceivedFiles = vi.fn().mockResolvedValue(undefined);
    const fetchSharedFiles = vi.fn().mockResolvedValue(undefined);
    const fetchAll = vi.fn().mockResolvedValue(undefined);
    useDirectoryStore.setState({
      activeTab: 'received',
      fetchReceivedFiles,
      fetchSharedFiles,
      fetchAll,
    });

    const visibilityStateSpy = vi
      .spyOn(document, 'visibilityState', 'get')
      .mockReturnValue('visible');

    render(<DirectoryPage />);

    await waitFor(() => {
      expect(fetchAll).toHaveBeenCalled();
    });
    fetchReceivedFiles.mockClear();
    fetchSharedFiles.mockClear();
    fetchAll.mockClear();

    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));

    expect(fetchAll).toHaveBeenCalledTimes(2);
    expect(fetchReceivedFiles).not.toHaveBeenCalled();
    expect(fetchSharedFiles).not.toHaveBeenCalled();

    visibilityStateSpy.mockRestore();
  });
});

describe('DirectoryPathCard', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
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
    // receivePath = '/Users/alice/LynavoDrive/Received' — derivePaths checks for lowercase 'received'
    // Since the mock has 'Received' (capitalized), the whole path is treated as root
    render(<DirectoryPathCard />);
    // Root path appears in the root card and also as received sub-card — use getAllByText
    const rootMatches = screen.getAllByText(mockSettings.receivePath);
    expect(rootMatches.length).toBeGreaterThanOrEqual(1);
  });

  it('renders received directory label', () => {
    render(<DirectoryPathCard />);
    expect(screen.getByText('Received folder')).toBeInTheDocument();
  });

  it('renders shared directory label in the OSS product', () => {
    render(<DirectoryPathCard />);
    expect(screen.getByText('Team shared folder')).toBeInTheDocument();
  });

  it('renders the Lynavo personal directory label', () => {
    render(<DirectoryPathCard />);
    expect(screen.getByText('My Computer')).toBeInTheDocument();
  });

  it('renders personal and team shared directories without reading external env', () => {
    render(<DirectoryPathCard />);

    expect(screen.getByText('My Computer')).toBeInTheDocument();
    expect(screen.getByText('Team shared folder')).toBeInTheDocument();
  });

  it('renders selected Windows drive root in personal virtual drives mode', () => {
    (window as Window & { electronAPI?: unknown }).electronAPI = {
      ...(window.electronAPI ?? {}),
      platform: {
        ...(window.electronAPI?.platform ?? {}),
        isWindows: () => true,
      },
    } as unknown as Window['electronAPI'];
    useSettingsStore.setState({
      settings: {
        ...mockSettings,
        personalPath: 'C:\\',
        personalPathMode: 'windowsDrives',
      },
    });

    render(<DirectoryPathCard />);

    const personalCard = screen.getByText('My Computer').closest('.rounded-2xl');
    expect(personalCard).not.toBeNull();
    expect(within(personalCard as HTMLElement).getByText('Local disks (C:\\)')).toBeInTheDocument();
    expect(
      within(personalCard as HTMLElement).getByRole('button', { name: 'Restore local disks' }),
    ).toBeInTheDocument();
    expect(
      within(personalCard as HTMLElement).getByRole('button', { name: 'Open' }),
    ).toBeDisabled();
  });

  it('does not render Windows restore action on non-Windows hosts', () => {
    useSettingsStore.setState({
      settings: {
        ...mockSettings,
        personalPath: 'C:\\',
        personalPathMode: 'windowsDrives',
      },
    });

    render(<DirectoryPathCard />);

    const personalCard = screen.getByText('My Computer').closest('.rounded-2xl');
    expect(personalCard).not.toBeNull();
    expect(
      within(personalCard as HTMLElement).queryByRole('button', { name: 'Restore local disks' }),
    ).not.toBeInTheDocument();
  });

  it('renders default Windows personal virtual drives without exposing the home path', () => {
    (window as Window & { electronAPI?: unknown }).electronAPI = {
      ...(window.electronAPI ?? {}),
      platform: {
        ...(window.electronAPI?.platform ?? {}),
        isWindows: () => true,
      },
    } as unknown as Window['electronAPI'];
    useSettingsStore.setState({
      settings: {
        ...mockSettings,
        personalPath: 'C:\\Users\\Alice',
        personalPathMode: 'windowsDrives',
      },
    });

    render(<DirectoryPathCard />);

    const personalCard = screen.getByText('My Computer').closest('.rounded-2xl');
    expect(personalCard).not.toBeNull();
    expect(within(personalCard as HTMLElement).getByText('Local disks')).toBeInTheDocument();
    expect(
      within(personalCard as HTMLElement).queryByText('C:\\Users\\Alice'),
    ).not.toBeInTheDocument();
    expect(
      within(personalCard as HTMLElement).queryByRole('button', { name: 'Restore local disks' }),
    ).not.toBeInTheDocument();
    expect(
      within(personalCard as HTMLElement).getByRole('button', { name: 'Open' }),
    ).toBeDisabled();
  });

  it('restores Windows personal virtual drives display from a selected drive root', async () => {
    const updateSettings = vi.fn().mockResolvedValue({
      ...mockSettings,
      personalPath: 'C:\\Users\\Alice',
      personalPathMode: 'windowsDrives',
    });
    (window as Window & { electronAPI?: unknown }).electronAPI = {
      ...(window.electronAPI ?? {}),
      sidecar: {
        ...(window.electronAPI?.sidecar ?? {}),
        updateSettings,
      },
      platform: {
        ...(window.electronAPI?.platform ?? {}),
        isWindows: () => true,
        getHomeDir: () => 'C:\\Users\\Alice',
      },
    } as unknown as Window['electronAPI'];
    useSettingsStore.setState({
      settings: {
        ...mockSettings,
        personalPath: 'C:\\',
        personalPathMode: 'windowsDrives',
      },
    });

    render(<DirectoryPathCard />);

    const personalCard = screen.getByText('My Computer').closest('.rounded-2xl');
    expect(personalCard).not.toBeNull();
    fireEvent.click(
      within(personalCard as HTMLElement).getByRole('button', { name: 'Restore local disks' }),
    );

    await waitFor(() => {
      expect(updateSettings).toHaveBeenCalledWith({ personalPath: 'C:\\Users\\Alice' });
    });
    expect(useSettingsStore.getState().settings.personalPath).toBe('C:\\Users\\Alice');
    expect(useSettingsStore.getState().settings.personalPathMode).toBe('windowsDrives');
  });

  it('renders received directory before the Lynavo personal directory', () => {
    render(<DirectoryPathCard />);

    const receivedLabel = screen.getByText('Received folder');
    const personalLabel = screen.getByText('My Computer');

    expect(
      receivedLabel.compareDocumentPosition(personalLabel) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('does not render account login or logout controls in the personal directory card', () => {
    render(<DirectoryPathCard />);

    const personalCard = screen.getByText('My Computer').closest('.rounded-2xl');
    expect(personalCard).not.toBeNull();
    expect(
      within(personalCard as HTMLElement).queryByText('Remote sync and transfer'),
    ).not.toBeInTheDocument();
    expect(
      within(personalCard as HTMLElement).queryByRole('button', { name: 'Sign in' }),
    ).not.toBeInTheDocument();
    expect(
      within(personalCard as HTMLElement).queryByRole('button', { name: 'Sign out' }),
    ).not.toBeInTheDocument();
  });

  it('renders root directory label', () => {
    render(<DirectoryPathCard />);
    expect(screen.getByText('Root folder path')).toBeInTheDocument();
  });

  it('derives root path and keeps the shared path when receivePath ends with lowercase received', () => {
    useSettingsStore.setState({
      settings: {
        ...mockSettings,
        receivePath: '/Users/alice/LynavoDrive/received',
      },
    });

    render(<DirectoryPathCard />);

    // Root should be /Users/alice/LynavoDrive
    expect(screen.getByText('/Users/alice/LynavoDrive')).toBeInTheDocument();
    expect(screen.getByText('/Users/alice/LynavoDrive/shared')).toBeInTheDocument();
  });

  it('blocks root directory changes while a transfer is active', async () => {
    const selectFolder = vi.fn();
    const updateSettings = vi.fn();
    (window as Window & { electronAPI?: unknown }).electronAPI = {
      ...(window.electronAPI ?? {}),
      sidecar: {
        ...(window.electronAPI?.sidecar ?? {}),
        getTransferActive: vi.fn().mockResolvedValue({ active: true }),
        updateSettings,
      },
      files: {
        ...(window.electronAPI?.files ?? {}),
        selectFolder,
      },
    } as unknown as Window['electronAPI'];

    render(<DirectoryPathCard />);

    await waitFor(() => {
      expect(
        screen.getByText('Files are being received. You can change this after transfer finishes.'),
      ).toBeInTheDocument();
    });

    const rootCard = screen.getByText('Root folder path').closest('.rounded-2xl');
    expect(rootCard).not.toBeNull();
    fireEvent.click(within(rootCard as HTMLElement).getByRole('button', { name: 'Change' }));

    expect(selectFolder).not.toHaveBeenCalled();
    expect(updateSettings).not.toHaveBeenCalled();
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
    expect(screen.getByText('No received files')).toBeInTheDocument();
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
    expect(screen.getByText(/1 files/)).toBeInTheDocument();
  });

  it('renders loading state', () => {
    useDirectoryStore.setState({ loading: true });

    render(<ReceivedFileList />);

    expect(screen.getByText('Loading file list...')).toBeInTheDocument();
  });

  it('opens media files via system shell instead of in-app preview', () => {
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
        receivePath: '/Users/alice/LynavoDrive/Received',
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
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    expect(openFile).toHaveBeenCalledWith(
      '/Users/alice/LynavoDrive/Received/iPhone 15/2026-04-10/vacation clip.mp4',
    );
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
    expect(screen.getByText('No files in the team shared folder')).toBeInTheDocument();
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
    expect(screen.getByText(/1 files/)).toBeInTheDocument();
  });

  it('renders empty state message', () => {
    render(<SharedFileList />);
    expect(screen.getByText('No files in the team shared folder')).toBeInTheDocument();
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
        sharedPath: '/Users/alice/LynavoDrive/shared',
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
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    expect(openFile).toHaveBeenCalledWith('/Users/alice/LynavoDrive/shared/nested/report.pdf');
  });
});
