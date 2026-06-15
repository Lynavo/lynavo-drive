import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SharedResourcesPage } from '../SharedResourcesPage';
import { useResourcesStore } from '@renderer/stores/resources-store';

vi.mock('@renderer/stores/resources-store', () => ({
  useResourcesStore: vi.fn(),
}));

describe('SharedResourcesPage', () => {
  const mockStore = {
    sharedResources: [],
    sharedLoading: false,
    sharedError: null,
    loadSharedResources: vi.fn(),
    removeSharedResource: vi.fn(),
    shareFile: vi.fn(),
    shareFolder: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useResourcesStore as any).mockReturnValue(mockStore);
  });

  it('renders page layout and titles', () => {
    render(<SharedResourcesPage />);
    expect(screen.getByText('共享管理')).toBeInTheDocument();
  });

  it('displays loading state with skeletons when empty', () => {
    (useResourcesStore as any).mockReturnValue({
      ...mockStore,
      sharedLoading: true,
      sharedResources: [],
    });
    const { container } = render(<SharedResourcesPage />);
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('displays loading indicator when not empty', () => {
    (useResourcesStore as any).mockReturnValue({
      ...mockStore,
      sharedLoading: true,
      sharedResources: [
        {
          resourceId: 'res-1',
          desktopDeviceId: 'dev-1',
          kind: 'shared_file',
          displayName: 'test-doc.pdf',
          status: 'available',
          addedAt: '2026-06-15T00:00:00Z',
          downloadCount: 5,
        },
      ],
    });
    render(<SharedResourcesPage />);
    expect(screen.getByText('加载中...')).toBeInTheDocument();
  });

  it('displays empty state when no resources', () => {
    render(<SharedResourcesPage />);
    expect(screen.getByText('暂无共享资源')).toBeInTheDocument();
  });

  it('displays error state', () => {
    (useResourcesStore as any).mockReturnValue({
      ...mockStore,
      sharedError: 'Something went wrong',
    });
    render(<SharedResourcesPage />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('renders resources in table', () => {
    (useResourcesStore as any).mockReturnValue({
      ...mockStore,
      sharedResources: [
        {
          resourceId: 'res-1',
          desktopDeviceId: 'dev-1',
          kind: 'shared_file',
          displayName: 'test-doc.pdf',
          status: 'available',
          addedAt: '2026-06-15T00:00:00Z',
          downloadCount: 5,
          lastAccessedAt: '2026-06-15T01:00:00Z',
        },
      ],
    });

    render(<SharedResourcesPage />);
    expect(screen.getByText('test-doc.pdf')).toBeInTheDocument();
    expect(screen.getByText('本地文件')).toBeInTheDocument();
    expect(screen.getByText('可用')).toBeInTheDocument();
  });

  it('triggers remove action on trash click', () => {
    const removeSharedResource = vi.fn();
    (useResourcesStore as any).mockReturnValue({
      ...mockStore,
      sharedResources: [
        {
          resourceId: 'res-1',
          desktopDeviceId: 'dev-1',
          kind: 'shared_file',
          displayName: 'test-doc.pdf',
          status: 'available',
          addedAt: '2026-06-15T00:00:00Z',
          downloadCount: 5,
        },
      ],
      removeSharedResource,
    });

    render(<SharedResourcesPage />);
    const deleteBtn = screen.getByRole('button', { name: '取消共享' });
    fireEvent.click(deleteBtn);
    expect(removeSharedResource).toHaveBeenCalledWith('res-1');
  });

  it('triggers shareFile and shareFolder on button click', () => {
    const shareFile = vi.fn();
    const shareFolder = vi.fn();
    (useResourcesStore as any).mockReturnValue({
      ...mockStore,
      shareFile,
      shareFolder,
    });

    render(<SharedResourcesPage />);
    fireEvent.click(screen.getByRole('button', { name: '共享文件' }));
    expect(shareFile).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '共享文件夹' }));
    expect(shareFolder).toHaveBeenCalled();
  });
});
