import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReceivedLibraryPage } from '../ReceivedLibraryPage';
import { useResourcesStore } from '@renderer/stores/resources-store';
import { useDashboardStore } from '@renderer/stores/dashboard-store';
import { useManagementStore } from '@renderer/stores/management-store';
import { useSettingsStore } from '@renderer/stores/settings-store';
import { toast } from 'sonner';
import type { ReceivedLibraryItemDTO } from '@syncflow/contracts';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('ReceivedLibraryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useResourcesStore.setState({
      receivedItems: [],
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
        getReceivedLibrary: vi.fn().mockImplementation(async () => {
          return { items: useResourcesStore.getState().receivedItems };
        }),
      },
    };
  });

  it('renders page layout and titles', () => {
    render(<ReceivedLibraryPage />);
    expect(screen.getByText('同步记录')).toBeInTheDocument();
    expect(screen.getByText('总接收文件数')).toBeInTheDocument();
    expect(screen.getByText('占用总空间')).toBeInTheDocument();
    expect(screen.getByText('磁盘剩余空间')).toBeInTheDocument();
  });

  it('places the device count below the stats area instead of in the page header', async () => {
    const { container } = render(<ReceivedLibraryPage />);

    await waitFor(() => {
      expect(screen.getByText('4 台设备')).toBeInTheDocument();
    });

    const header = container.querySelector('header');
    expect(header).not.toHaveTextContent('4 台设备');
  });

  it('displays preview sync records when no real items exist in development', async () => {
    render(<ReceivedLibraryPage />);
    await waitFor(() => {
      expect(screen.getAllByText('iPhone 15 Pro').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('Galaxy S24 Ultra').length).toBeGreaterThan(0);
    expect(screen.queryByText('尚无同步记录')).not.toBeInTheDocument();
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
    expect(screen.getByText('相册上传 1')).toBeInTheDocument();
    expect(screen.getByText('文件上传 1')).toBeInTheDocument();
    expect(screen.getAllByText('3.0 MB').length).toBeGreaterThan(0);
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

    await waitFor(() => {
      expect(screen.getByTitle('打开目录')).toBeInTheDocument();
    });

    const openBtn = screen.getByTitle('打开目录');
    fireEvent.click(openBtn);
    expect(window.electronAPI?.files.openFolder).toHaveBeenCalledWith(
      '/mock/receive/path/client-1-stable',
    );
  });
});
