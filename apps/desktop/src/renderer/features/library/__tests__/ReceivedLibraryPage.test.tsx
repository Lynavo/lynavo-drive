import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReceivedLibraryPage } from '../ReceivedLibraryPage';
import { useResourcesStore } from '@renderer/stores/resources-store';
import { useDashboardStore } from '@renderer/stores/dashboard-store';

vi.mock('@renderer/stores/resources-store', () => ({
  useResourcesStore: vi.fn(),
}));

vi.mock('@renderer/stores/dashboard-store', () => ({
  useDashboardStore: vi.fn(),
}));

describe('ReceivedLibraryPage', () => {
  const mockStore = {
    receivedItems: [],
    receivedLoading: false,
    receivedError: null,
    loadReceivedLibrary: vi.fn(),
    addSharedFromReceived: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useResourcesStore as any).mockReturnValue(mockStore);
    (useDashboardStore as any).mockReturnValue([]);
  });

  it('renders page layout and titles', () => {
    render(<ReceivedLibraryPage />);
    expect(screen.getByText('资料库')).toBeInTheDocument();
  });

  it('displays loading state with skeletons when empty', () => {
    (useResourcesStore as any).mockReturnValue({
      ...mockStore,
      receivedLoading: true,
      receivedItems: [],
    });
    const { container } = render(<ReceivedLibraryPage />);
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('displays loading indicator when not empty', () => {
    (useResourcesStore as any).mockReturnValue({
      ...mockStore,
      receivedLoading: true,
      receivedItems: [
        {
          resourceId: 'rec-1',
          desktopDeviceId: 'dev-1',
          clientId: 'client-1',
          displayName: 'image.png',
          fileKey: 'key-1',
          filename: 'image.png',
          mediaType: 'image/png',
          fileSize: 1024,
          completedAt: '2026-06-15T00:00:00Z',
          shareStatus: 'not_shared',
        },
      ],
    });
    render(<ReceivedLibraryPage />);
    expect(screen.getByText('加载中...')).toBeInTheDocument();
  });

  it('displays empty state when no items', () => {
    render(<ReceivedLibraryPage />);
    expect(screen.getByText('暂无接收数据')).toBeInTheDocument();
  });

  it('displays error state', () => {
    (useResourcesStore as any).mockReturnValue({
      ...mockStore,
      receivedError: 'Something went wrong',
    });
    render(<ReceivedLibraryPage />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('renders items and resolves source device name', () => {
    (useResourcesStore as any).mockReturnValue({
      ...mockStore,
      receivedItems: [
        {
          resourceId: 'rec-1',
          desktopDeviceId: 'dev-1',
          clientId: 'client-1',
          displayName: 'image.png',
          fileKey: 'key-1',
          filename: 'image.png',
          mediaType: 'image/png',
          fileSize: 1024,
          completedAt: '2026-06-15T00:00:00Z',
          shareStatus: 'not_shared',
        },
      ],
    });

    (useDashboardStore as any).mockReturnValue([
      {
        stableDeviceId: 'client-1',
        displayName: 'My iPhone',
      },
    ]);

    render(<ReceivedLibraryPage />);
    expect(screen.getByText('image.png')).toBeInTheDocument();
    expect(screen.getByText('image/png')).toBeInTheDocument();
    expect(screen.getByText('My iPhone')).toBeInTheDocument();
    expect(screen.getByText('未共享')).toBeInTheDocument();
  });

  it('triggers addSharedFromReceived on button click', () => {
    const addSharedFromReceived = vi.fn();
    const mockItem = {
      resourceId: 'rec-1',
      desktopDeviceId: 'dev-1',
      clientId: 'client-1',
      displayName: 'image.png',
      fileKey: 'key-1',
      filename: 'image.png',
      mediaType: 'image/png',
      fileSize: 1024,
      completedAt: '2026-06-15T00:00:00Z',
      shareStatus: 'not_shared',
    };

    (useResourcesStore as any).mockReturnValue({
      ...mockStore,
      receivedItems: [mockItem],
      addSharedFromReceived,
    });

    render(<ReceivedLibraryPage />);
    const addBtn = screen.getByRole('button', { name: '加入共享' });
    fireEvent.click(addBtn);
    expect(addSharedFromReceived).toHaveBeenCalledWith(mockItem);
  });
});
