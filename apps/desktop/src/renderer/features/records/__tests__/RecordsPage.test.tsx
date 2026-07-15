import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { DesktopAccessRecordDTO } from '@lynavo-drive/contracts';
import { RecordsPage } from '../RecordsPage';
import { useManagementStore } from '@renderer/stores/management-store';

const accessRecord1: DesktopAccessRecordDTO = {
  recordId: 'access-1',
  desktopDeviceId: 'desktop-1',
  clientId: 'client-1',
  displayName: 'Galaxy S24',
  resourceId: 'res-1',
  resourceKind: 'received_file',
  resourceName: 'clip.mp4',
  action: 'download',
  result: 'ok',
  accessedAt: '2026-06-15T10:10:00Z',
};

const accessRecord2: DesktopAccessRecordDTO = {
  recordId: 'access-2',
  desktopDeviceId: 'desktop-1',
  clientId: 'client-1',
  displayName: 'Galaxy S24',
  resourceId: 'res-2',
  resourceKind: 'received_file',
  resourceName: 'photo.jpg',
  action: 'view',
  result: 'ok',
  accessedAt: '2026-06-15T10:15:00Z',
};

const revealPath = vi.fn().mockResolvedValue(undefined);

function resetStore() {
  useManagementStore.setState({
    devices: [],
    syncRecords: [],
    accessRecords: [],
    devicesLoading: false,
    syncRecordsLoading: false,
    accessRecordsLoading: false,
    devicesError: null,
    syncRecordsError: null,
    accessRecordsError: null,
  });
}

describe('RecordsPage', () => {
  beforeEach(() => {
    resetStore();
    revealPath.mockClear();
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        files: {
          revealPath,
        },
      },
    });
    vi.spyOn(useManagementStore.getState(), 'loadAccessRecords').mockResolvedValue();
    vi.spyOn(useManagementStore.getState(), 'loadDevices').mockResolvedValue();
  });

  it('renders filter search and date inputs', () => {
    render(<RecordsPage />);
    expect(screen.getByPlaceholderText('Search username, device, or IP')).toBeInTheDocument();
    const startDateInput = screen.getByLabelText('Start date') as HTMLInputElement;
    const endDateInput = screen.getByLabelText('End date') as HTMLInputElement;
    expect(startDateInput.type).toBe('date');
    expect(endDateInput.type).toBe('date');
    expect(screen.getAllByText('iPhone 15 Pro').length).toBeGreaterThan(0);
    expect(screen.getByText('Product requirements v3.pdf')).toBeInTheDocument();
  });

  it('shows date clearing and reference pagination for preview access records', () => {
    render(<RecordsPage />);

    fireEvent.change(screen.getByLabelText('Start date'), {
      target: { value: '2026-06-01' },
    });
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();

    const pagination = screen.getByRole('navigation', { name: 'Access records pagination' });
    expect(pagination).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '3' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '2' }));
    expect(screen.getByRole('button', { name: '2' })).toHaveAttribute('aria-current', 'page');
  });

  it('groups access records by device and date and displays them', () => {
    useManagementStore.setState({
      accessRecords: [accessRecord1, accessRecord2],
      devices: [
        {
          desktopDeviceId: 'dev-1',
          clientId: 'client-1',
          clientIdShort: 'cl-1',
          displayName: 'Galaxy S24',
          platform: 'Android',
          stableDeviceId: 'client-1',
          authorizationStatus: 'authorized',
          blockStatus: 'none',
          failedAttemptCount: 0,
          todayFileCount: 0,
          todayBytes: 0,
          totalFileCount: 0,
          totalBytes: 0,
          lastIp: '192.168.1.112',
          authorizedAt: '2026-06-15T00:00:00Z',
          lastSeenAt: '2026-06-15T10:15:00Z',
        },
      ],
    });

    render(<RecordsPage />);

    expect(screen.getByText('Galaxy S24')).toBeInTheDocument();
    expect(screen.getByText('Android')).toBeInTheDocument();
    expect(screen.getByText('clip.mp4')).toBeInTheDocument();
    expect(screen.getByText('photo.jpg')).toBeInTheDocument();
    expect(screen.getByText('Download')).toBeInTheDocument();
    expect(screen.getByText('Preview')).toBeInTheDocument();
    expect(screen.getByText('2026-06-15')).toBeInTheDocument();
    expect(screen.getByText('LAN')).toBeInTheDocument();
    expect(screen.getByText('192.168.1.112')).toBeInTheDocument();
    expect(screen.queryByText(/Guangdong Province/)).not.toBeInTheDocument();
  });

  it('does not invent an IP address when a device has not been matched', () => {
    useManagementStore.setState({
      accessRecords: [accessRecord1],
      devices: [],
    });

    render(<RecordsPage />);

    expect(screen.getByText('IP not recorded')).toBeInTheDocument();
    expect(screen.queryByText('192.168.1.106')).not.toBeInTheDocument();
  });

  it('shows the full local path on hover and reveals it from access records', () => {
    const recordWithPath = {
      ...accessRecord1,
      localPath: '/Users/alice/Lynavo Drive/received/Alice iPhone/2026-06-15/clip.mp4',
    } as DesktopAccessRecordDTO;
    useManagementStore.setState({
      accessRecords: [recordWithPath],
    });

    render(<RecordsPage />);

    const fileButton = screen.getByRole('button', { name: 'Show clip.mp4 in folder' });
    expect(fileButton).toHaveAttribute(
      'title',
      '/Users/alice/Lynavo Drive/received/Alice iPhone/2026-06-15/clip.mp4',
    );

    fireEvent.click(fileButton);

    expect(revealPath).toHaveBeenCalledWith(
      '/Users/alice/Lynavo Drive/received/Alice iPhone/2026-06-15/clip.mp4',
    );
  });

  it('filters sessions by search query', () => {
    useManagementStore.setState({
      accessRecords: [accessRecord1],
      devices: [
        {
          desktopDeviceId: 'dev-1',
          clientId: 'client-1',
          clientIdShort: 'cl-1',
          displayName: 'Galaxy S24',
          platform: 'Android',
          stableDeviceId: 'client-1',
          authorizationStatus: 'authorized',
          blockStatus: 'none',
          failedAttemptCount: 0,
          todayFileCount: 0,
          todayBytes: 0,
          totalFileCount: 0,
          totalBytes: 0,
          lastIp: '192.168.1.112',
          authorizedAt: '2026-06-15T00:00:00Z',
          lastSeenAt: '2026-06-15T10:15:00Z',
        },
      ],
    });

    render(<RecordsPage />);

    const searchInput = screen.getByPlaceholderText('Search username, device, or IP');
    fireEvent.change(searchInput, { target: { value: 'nonexistent' } });

    expect(screen.queryByText('Galaxy S24')).not.toBeInTheDocument();
    expect(screen.getByText('No matching access records')).toBeInTheDocument();
  });

  it('renders preview access records for an empty real list and still renders error states', () => {
    const { rerender } = render(<RecordsPage />);
    expect(screen.getAllByText('iPhone 15 Pro').length).toBeGreaterThan(0);
    expect(screen.queryByText('No matching access records')).not.toBeInTheDocument();

    useManagementStore.setState({ accessRecordsError: 'load failed' });
    rerender(<RecordsPage />);
    expect(screen.getByText('load failed')).toBeInTheDocument();
  });
});
