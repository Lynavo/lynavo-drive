import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReceivedLibraryPage } from '../ReceivedLibraryPage';
import { useResourcesStore } from '@renderer/stores/resources-store';
import { useDashboardStore } from '@renderer/stores/dashboard-store';
import { useManagementStore } from '@renderer/stores/management-store';
import { useSettingsStore } from '@renderer/stores/settings-store';
import { toast } from 'sonner';
import type { DashboardDeviceDTO, ReceivedLibraryItemDTO } from '@lynavo-drive/contracts';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

function buildMockReceivedLibraryPage() {
  const state = useResourcesStore.getState();
  const statsByClient = state.receivedItems.reduce((acc, item) => {
    const existing = acc.get(item.clientId) ?? {
      clientId: item.clientId,
      photoCount: 0,
      fileCount: 0,
      totalBytes: 0,
    };
    const mediaType = item.mediaType.toLowerCase();
    if (
      mediaType === 'image' ||
      mediaType === 'video' ||
      mediaType.startsWith('image/') ||
      mediaType.startsWith('video/')
    ) {
      existing.photoCount += 1;
    } else {
      existing.fileCount += 1;
    }
    existing.totalBytes += item.fileSize;
    acc.set(item.clientId, existing);
    return acc;
  }, new Map<string, { clientId: string; photoCount: number; fileCount: number; totalBytes: number }>());

  return {
    items: state.receivedItems,
    page: state.receivedPage,
    pageSize: state.receivedPageSize,
    totalItems: state.receivedTotalItems || state.receivedItems.length,
    totalBytes:
      state.receivedTotalBytes || state.receivedItems.reduce((sum, item) => sum + item.fileSize, 0),
    deviceStats: state.receivedDeviceStats.length
      ? state.receivedDeviceStats
      : Array.from(statsByClient.values()),
  };
}

describe('ReceivedLibraryPage', () => {
  let intersectionCallback: IntersectionObserverCallback | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    intersectionCallback = null;
    (window as any).IntersectionObserver = vi.fn(function MockIntersectionObserver(
      callback: IntersectionObserverCallback,
    ) {
      intersectionCallback = callback;
      return {
        observe: vi.fn(),
        unobserve: vi.fn(),
        disconnect: vi.fn(),
      };
    });
    useResourcesStore.setState({
      receivedItems: [],
      receivedPage: 1,
      receivedPageSize: 30,
      receivedTotalItems: 0,
      receivedTotalBytes: 0,
      receivedDeviceStats: [],
      receivedHasMore: false,
      receivedLoadingMore: false,
      receivedLoading: false,
      receivedError: null,
    });
    useDashboardStore.setState({
      summary: {
        isDiskLow: false,
        remainingBytes: 5000000000,
        todayUploadCount: 0,
        todayOccupiedBytes: 0,
      },
      devices: [],
    });
    useManagementStore.setState({
      devices: [],
    });
    useSettingsStore.setState({
      settings: {
        deviceName: 'Desktop-Test',
        connectionCode: '112233',
        rootPath: '/mock/root/path',
        receivePath: '/mock/receive/path',
        personalPath: '/mock/personal/path',
        sharedPath: '/mock/shared/path',
        shareAddress: '',
        shareStatus: 'unknown',
        shareName: '',
      },
    });

    (window as any).electronAPI = {
      files: {
        openFolder: vi.fn().mockResolvedValue(null),
      },
      sidecar: {
        getReceivedLibrary: vi.fn().mockImplementation(async () => buildMockReceivedLibraryPage()),
      },
    };
  });

  it('renders page layout and titles', () => {
    render(<ReceivedLibraryPage />);
    expect(screen.getByText('Sync records')).toBeInTheDocument();
    expect(screen.getByText('Total received files')).toBeInTheDocument();
    expect(screen.getByText('Total used space')).toBeInTheDocument();
    expect(screen.getByText('Remaining disk space')).toBeInTheDocument();
  });

  it('places the device count below the stats area instead of in the page header', async () => {
    const { container } = render(<ReceivedLibraryPage />);

    await waitFor(() => {
      expect(screen.getByText('0 devices')).toBeInTheDocument();
    });

    const header = container.querySelector('header');
    expect(header).not.toHaveTextContent('0 devices');
  });

  it('keeps the title and summary fixed while device and file lists scroll independently', () => {
    render(<ReceivedLibraryPage />);

    const root = screen.getByTestId('received-library-root');
    const fixedSummary = screen.getByTestId('received-library-fixed-summary');
    const scrollRegion = screen.getByTestId('received-library-scroll-region');

    expect(root).toHaveClass('overflow-hidden');
    expect(scrollRegion).toHaveClass('overflow-auto');
    expect(fixedSummary).toContainElement(screen.getByText('Sync records'));
    expect(fixedSummary).toContainElement(screen.getByText('Total received files'));
    expect(scrollRegion).not.toContainElement(screen.getByText('Sync records'));
  });

  it('loads the next received page when the scroll sentinel becomes visible', async () => {
    const firstPage = {
      items: [
        {
          resourceId: 'rec-1',
          desktopDeviceId: 'dev-1',
          clientId: 'client-1',
          displayName: 'first.jpg',
          fileKey: 'key-1',
          filename: 'first.jpg',
          mediaType: 'image/jpeg',
          fileSize: 1024,
          completedAt: '2026-06-15T00:00:00Z',
          shareStatus: 'not_shared' as const,
        },
      ],
      page: 1,
      pageSize: 30,
      totalItems: 31,
      totalBytes: 3072,
      deviceStats: [
        {
          clientId: 'client-1',
          photoCount: 2,
          fileCount: 0,
          totalBytes: 3072,
        },
      ],
    };
    const secondPage = {
      ...firstPage,
      items: [
        {
          ...firstPage.items[0],
          resourceId: 'rec-2',
          displayName: 'second.jpg',
          fileKey: 'key-2',
          filename: 'second.jpg',
          fileSize: 2048,
        },
      ],
      page: 2,
    };
    const getReceivedLibrary = vi
      .fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(secondPage);
    (window as any).electronAPI.sidecar.getReceivedLibrary = getReceivedLibrary;

    render(<ReceivedLibraryPage />);

    await waitFor(() => {
      expect(screen.getAllByText('first.jpg').length).toBeGreaterThan(0);
    });
    expect(screen.getByTestId('received-library-load-more-sentinel')).toBeInTheDocument();

    await act(async () => {
      intersectionCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    await waitFor(() => {
      expect(screen.getAllByText('second.jpg').length).toBeGreaterThan(0);
    });
    expect(getReceivedLibrary).toHaveBeenNthCalledWith(1, { page: 1, pageSize: 30 });
    expect(getReceivedLibrary).toHaveBeenNthCalledWith(2, { page: 2, pageSize: 30 });
  });

  it('displays the real empty state instead of preview sync records when no real items exist', async () => {
    render(<ReceivedLibraryPage />);
    await waitFor(() => {
      expect(screen.getByText('No sync records yet')).toBeInTheDocument();
    });
    expect(screen.getByText('0 devices')).toBeInTheDocument();
    expect(screen.queryByText('iPhone 15 Pro')).not.toBeInTheDocument();
    expect(screen.queryByText('Galaxy S24 Ultra')).not.toBeInTheDocument();
    expect(screen.queryByText('IMG_20260610_Office.mov')).not.toBeInTheDocument();
  });

  it('displays error state', async () => {
    useResourcesStore.setState({
      receivedError: 'Error message from sidecar',
    });
    // Override the mock to reject to test error
    (window as any).electronAPI.sidecar.getReceivedLibrary = vi
      .fn()
      .mockRejectedValue(new Error('Error message from sidecar'));

    render(<ReceivedLibraryPage />);
    await waitFor(() => {
      expect(screen.getByText('Error message from sidecar')).toBeInTheDocument();
    });
  });

  it('renders devices list and correctly sums up their counts and sizes', async () => {
    const mockItems: ReceivedLibraryItemDTO[] = [
      {
        resourceId: 'rec-1',
        desktopDeviceId: 'dev-1',
        clientId: 'client-1',
        displayName: 'photo.jpg',
        fileKey: 'key-1',
        filename: 'photo.jpg',
        mediaType: 'image/jpeg',
        fileSize: 1048576, // 1MB
        completedAt: '2026-06-15T00:00:00Z',
        shareStatus: 'not_shared',
      },
      {
        resourceId: 'rec-2',
        desktopDeviceId: 'dev-1',
        clientId: 'client-1',
        displayName: 'doc.pdf',
        fileKey: 'key-2',
        filename: 'doc.pdf',
        mediaType: 'application/pdf',
        fileSize: 2097152, // 2MB
        completedAt: '2026-06-15T00:00:00Z',
        shareStatus: 'not_shared',
      },
    ];

    useResourcesStore.setState({
      receivedItems: mockItems,
    });

    useManagementStore.setState({
      devices: [
        {
          desktopDeviceId: 'dev-1',
          clientId: 'client-1',
          clientIdShort: 'cl-1',
          displayName: 'My iPhone',
          platform: 'iOS',
          stableDeviceId: 'client-1-stable',
          authorizationStatus: 'authorized',
          blockStatus: 'none',
          failedAttemptCount: 0,
          todayFileCount: 2,
          todayBytes: 3145728,
          totalFileCount: 2,
          totalBytes: 3145728,
          lastIp: '192.168.0.10',
          authorizedAt: '2026-06-15T00:00:00Z',
          lastSeenAt: '2026-06-15T00:00:00Z',
        },
      ],
    });

    render(<ReceivedLibraryPage />);

    // Total file count card should show 2
    await waitFor(() => {
      expect(screen.getByText('2')).toBeInTheDocument();
    });
    // Total space card should show 3.0 MB
    expect(screen.getAllByText('3.0 MB').length).toBeGreaterThan(0);

    // Device card elements
    expect(screen.getAllByText('My iPhone').length).toBeGreaterThan(0);
    expect(screen.getByText('iOS')).toBeInTheDocument();

    // Stats
    expect(screen.getByText('Album uploads 1')).toBeInTheDocument();
    expect(screen.getByText('File uploads 1')).toBeInTheDocument();
    expect(screen.getAllByText('3.0 MB').length).toBeGreaterThan(0);
  });

  it('uses received stats as the device summary fallback while managed devices are still loading', async () => {
    const mockItems: ReceivedLibraryItemDTO[] = [
      {
        resourceId: 'rec-1',
        desktopDeviceId: 'dev-1',
        clientId: 'client-1',
        displayName: 'Alice iPhone',
        fileKey: 'key-1',
        filename: 'photo.jpg',
        mediaType: 'image/jpeg',
        fileSize: 1048576,
        completedAt: '2026-06-15T00:00:00Z',
        shareStatus: 'not_shared',
      },
    ];

    useResourcesStore.setState({
      receivedItems: mockItems,
      receivedTotalItems: 1,
      receivedTotalBytes: 1048576,
      receivedDeviceStats: [
        {
          clientId: 'client-1',
          photoCount: 1,
          fileCount: 0,
          totalBytes: 1048576,
        },
      ],
    });

    render(<ReceivedLibraryPage />);

    await waitFor(() => {
      expect(screen.getByText('1 devices')).toBeInTheDocument();
    });
    expect(screen.getAllByText('Alice iPhone').length).toBeGreaterThan(0);
    expect(screen.queryByText('No sync records yet')).not.toBeInTheDocument();
  });

  it('does not show a status badge for received files that are not shared', async () => {
    const mockItems: ReceivedLibraryItemDTO[] = [
      {
        resourceId: '',
        desktopDeviceId: 'dev-1',
        clientId: 'client-1',
        displayName: 'photo.jpg',
        fileKey: 'key-1',
        filename: 'photo.jpg',
        mediaType: 'image/jpeg',
        fileSize: 1048576,
        completedAt: '2026-06-15T00:00:00Z',
        shareStatus: 'not_shared',
      },
    ];

    useResourcesStore.setState({
      receivedItems: mockItems,
    });

    render(<ReceivedLibraryPage />);

    await waitFor(() => {
      expect(screen.getAllByText('photo.jpg').length).toBeGreaterThan(0);
    });
    expect(screen.queryByText('Only exists on desktop')).not.toBeInTheDocument();
  });

  it('renders received image thumbnails and falls back when the image fails', async () => {
    const mockItems: ReceivedLibraryItemDTO[] = [
      {
        resourceId: 'rec-thumb-1',
        desktopDeviceId: 'dev-1',
        clientId: 'client-1',
        displayName: 'photo.jpg',
        fileKey: 'key-thumb-1',
        filename: 'photo.jpg',
        mediaType: 'image/jpeg',
        fileSize: 1048576,
        completedAt: '2026-06-15T00:00:00Z',
        shareStatus: 'not_shared',
        thumbnailUrl: 'http://127.0.0.1:39594/resources/received/thumbnail?fileKey=key-thumb-1',
      },
    ];

    useResourcesStore.setState({
      receivedItems: mockItems,
    });

    render(<ReceivedLibraryPage />);

    await waitFor(() => {
      expect(screen.getAllByText('photo.jpg').length).toBeGreaterThan(0);
    });
    const thumbnail = screen.getByTestId('received-library-thumbnail-image');
    expect(thumbnail).toHaveAttribute(
      'src',
      'http://127.0.0.1:39594/resources/received/thumbnail?fileKey=key-thumb-1',
    );

    fireEvent.error(thumbnail);
    expect(screen.queryByTestId('received-library-thumbnail-image')).not.toBeInTheDocument();
    expect(screen.getAllByText('photo.jpg').length).toBeGreaterThan(0);
  });

  it('keeps video received items on the file type icon even if a thumbnail url is present', async () => {
    const mockItems: ReceivedLibraryItemDTO[] = [
      {
        resourceId: 'rec-video-1',
        desktopDeviceId: 'dev-1',
        clientId: 'client-1',
        displayName: 'clip.mov',
        fileKey: 'key-video-1',
        filename: 'clip.mov',
        mediaType: 'video/quicktime',
        fileSize: 1048576,
        completedAt: '2026-06-15T00:00:00Z',
        shareStatus: 'not_shared',
        thumbnailUrl: 'http://127.0.0.1:39594/resources/received/thumbnail?fileKey=key-video-1',
      },
    ];

    useResourcesStore.setState({
      receivedItems: mockItems,
    });

    render(<ReceivedLibraryPage />);

    await waitFor(() => {
      expect(screen.getAllByText('clip.mov').length).toBeGreaterThan(0);
    });
    expect(screen.queryByTestId('received-library-thumbnail-image')).not.toBeInTheDocument();
  });

  it('uses stable row keys when received items have no shared resource id', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mockItems: ReceivedLibraryItemDTO[] = [
      {
        resourceId: '',
        desktopDeviceId: 'dev-1',
        clientId: 'client-1',
        displayName: 'first.jpg',
        fileKey: 'key-1',
        filename: 'first.jpg',
        mediaType: 'image/jpeg',
        fileSize: 1024,
        completedAt: '2026-06-15T00:00:00Z',
        shareStatus: 'not_shared',
      },
      {
        resourceId: '',
        desktopDeviceId: 'dev-1',
        clientId: 'client-1',
        displayName: 'second.jpg',
        fileKey: 'key-2',
        filename: 'second.jpg',
        mediaType: 'image/jpeg',
        fileSize: 2048,
        completedAt: '2026-06-15T00:01:00Z',
        shareStatus: 'not_shared',
      },
    ];

    useResourcesStore.setState({
      receivedItems: mockItems,
    });
    useManagementStore.setState({
      devices: [
        {
          desktopDeviceId: 'dev-1',
          clientId: 'client-1',
          clientIdShort: 'cl-1',
          displayName: 'My iPhone',
          platform: 'iOS',
          stableDeviceId: 'client-1-stable',
          authorizationStatus: 'authorized',
          blockStatus: 'none',
          failedAttemptCount: 0,
          todayFileCount: 2,
          todayBytes: 3072,
          totalFileCount: 2,
          totalBytes: 3072,
          lastIp: '192.168.0.10',
          authorizedAt: '2026-06-15T00:00:00Z',
          lastSeenAt: '2026-06-15T00:00:00Z',
        },
      ],
    });

    try {
      render(<ReceivedLibraryPage />);

      await waitFor(() => {
        expect(screen.getByText('first.jpg')).toBeInTheDocument();
        expect(screen.getByText('second.jpg')).toBeInTheDocument();
      });

      expect(
        consoleError.mock.calls.some((call) =>
          String(call[0]).includes('Encountered two children with the same key'),
        ),
      ).toBe(false);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('triggers folder opening on button click', async () => {
    const dashboardDevice: DashboardDeviceDTO = {
      deviceId: 'client-1',
      stableDeviceId: 'client-1-stable',
      displayName: 'My iPhone',
      clientName: 'My iPhone',
      platform: 'iOS',
      ip: '192.168.0.10',
      status: 'connected_idle',
      todayFileCount: 2,
      todayBytes: 3145728,
      storageLeft: '4.7 GB',
      storagePath: '/mock/receive/path',
      devicePath: '/mock/receive/path/My iPhone',
      receiveDirName: 'My iPhone',
    };

    useManagementStore.setState({
      devices: [
        {
          desktopDeviceId: 'dev-1',
          clientId: 'client-1',
          clientIdShort: 'cl-1',
          displayName: 'My iPhone',
          platform: 'iOS',
          stableDeviceId: 'client-1-stable',
          authorizationStatus: 'authorized',
          blockStatus: 'none',
          failedAttemptCount: 0,
          todayFileCount: 2,
          todayBytes: 3145728,
          totalFileCount: 2,
          totalBytes: 3145728,
          lastIp: '192.168.0.10',
          authorizedAt: '2026-06-15T00:00:00Z',
          lastSeenAt: '2026-06-15T00:00:00Z',
        },
      ],
    });
    useDashboardStore.setState({ devices: [dashboardDevice] });
    useResourcesStore.setState({
      receivedItems: [
        {
          resourceId: 'rec-1',
          desktopDeviceId: 'dev-1',
          clientId: 'client-1',
          displayName: 'My iPhone',
          fileKey: 'key-1',
          filename: 'photo.jpg',
          mediaType: 'image/jpeg',
          fileSize: 1024,
          completedAt: '2026-06-15T00:00:00Z',
          shareStatus: 'not_shared',
        },
      ],
      receivedTotalItems: 1,
      receivedTotalBytes: 1024,
      receivedDeviceStats: [
        {
          clientId: 'client-1',
          photoCount: 1,
          fileCount: 0,
          totalBytes: 1024,
        },
      ],
    });

    render(<ReceivedLibraryPage />);

    await waitFor(() => {
      expect(screen.getByTitle('Open folder')).toBeInTheDocument();
    });

    const openBtn = screen.getByTitle('Open folder');
    fireEvent.click(openBtn);
    expect(window.electronAPI?.files.openFolder).toHaveBeenCalledWith(
      '/mock/receive/path/My iPhone',
    );
  });

  it('does not fall back to the receive root when opening a device folder fails', async () => {
    const openFolder = vi.fn().mockRejectedValue(new Error('missing folder'));
    (window as any).electronAPI.files.openFolder = openFolder;
    useManagementStore.setState({
      devices: [
        {
          desktopDeviceId: 'dev-1',
          clientId: 'client-1',
          clientIdShort: 'cl-1',
          displayName: 'My iPhone',
          platform: 'iOS',
          stableDeviceId: 'client-1-stable',
          authorizationStatus: 'authorized',
          blockStatus: 'none',
          failedAttemptCount: 0,
          todayFileCount: 0,
          todayBytes: 0,
          totalFileCount: 0,
          totalBytes: 0,
          lastIp: '192.168.0.10',
          authorizedAt: '2026-06-15T00:00:00Z',
          lastSeenAt: '2026-06-15T00:00:00Z',
        },
      ],
    });
    useDashboardStore.setState({
      devices: [
        {
          deviceId: 'client-1',
          displayName: 'My iPhone',
          clientName: 'My iPhone',
          platform: 'iOS',
          ip: '192.168.0.10',
          status: 'offline',
          todayFileCount: 0,
          todayBytes: 0,
          storageLeft: '4.7 GB',
          storagePath: '/mock/receive/path',
          devicePath: '/mock/receive/path/My iPhone',
        },
      ],
    });
    useResourcesStore.setState({
      receivedItems: [
        {
          resourceId: 'rec-1',
          desktopDeviceId: 'dev-1',
          clientId: 'client-1',
          displayName: 'My iPhone',
          fileKey: 'key-1',
          filename: 'photo.jpg',
          mediaType: 'image/jpeg',
          fileSize: 1024,
          completedAt: '2026-06-15T00:00:00Z',
          shareStatus: 'not_shared',
        },
      ],
      receivedTotalItems: 1,
      receivedTotalBytes: 1024,
      receivedDeviceStats: [
        {
          clientId: 'client-1',
          photoCount: 1,
          fileCount: 0,
          totalBytes: 1024,
        },
      ],
    });

    render(<ReceivedLibraryPage />);

    await waitFor(() => {
      expect(screen.getByTitle('Open folder')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('Open folder'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Device folder does not exist or cannot be opened');
    });
    expect(openFolder).toHaveBeenCalledTimes(1);
    expect(openFolder).not.toHaveBeenCalledWith('/mock/receive/path');
  });
});
