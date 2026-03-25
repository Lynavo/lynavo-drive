import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DeviceDetailModal } from '../DeviceDetailModal';
import { useAppStore } from '@renderer/stores/app-store';
import { useDeviceDetailStore } from '@renderer/stores/device-detail-store';
import type { DashboardDeviceDTO } from '@syncflow/contracts';

const mockDevice: DashboardDeviceDTO = {
  deviceId: 'test-001',
  clientName: 'iPhone 15 Pro',
  ip: '192.168.1.42',
  status: 'connected_idle',
  todayFileCount: 3,
  todayBytes: 5_000_000_000,
  storageLeft: '1.2 TB',
  storagePath: '/Users/alice/SyncFlow',
  devicePath: '/Users/alice/SyncFlow/iPhone_15_Pro',
};

beforeEach(() => {
  useAppStore.setState({
    selectedDevice: null,
    isModalOpen: false,
  });
  useDeviceDetailStore.setState({
    files: [
      {
        fileKey: 'f1',
        originalFilename: 'DJI_0021_PRO.mp4',
        mediaType: 'video/mp4',
        fileSize: 1_610_612_736,
        createdAtRemote: '2026-03-19T08:14:00Z',
        completedAt: '2026-03-19T14:29:00Z',
        activeTransmissionMs: 195_000,
        finalPath: '/Users/alice/SyncFlow/DJI_0021_PRO.mp4',
      },
      {
        fileKey: 'f2',
        originalFilename: 'IMG_8493.HEIC',
        mediaType: 'image/heic',
        fileSize: 2_202_009,
        createdAtRemote: '2026-03-19T11:33:00Z',
        completedAt: '2026-03-19T14:27:00Z',
        activeTransmissionMs: 5_000,
        finalPath: '/Users/alice/SyncFlow/IMG_8493.HEIC',
      },
    ],
    selectedDate: '2026-03-19',
    availableDates: ['2026-03-19', '2026-03-18'],
    page: 1,
    pageSize: 200,
    totalItems: 2,
    totalBytes: 1_612_814_745,
    totalTransmissionMs: 200_000,
  });
});

describe('DeviceDetailModal', () => {
  it('does not render when modal is closed', () => {
    const { container } = render(<DeviceDetailModal />);
    expect(container.querySelector('[data-slot="dialog"]')).toBeNull();
  });

  it('shows device name when modal is open', () => {
    useAppStore.setState({ selectedDevice: mockDevice, isModalOpen: true });
    render(<DeviceDetailModal />);
    expect(screen.getByText('iPhone 15 Pro')).toBeInTheDocument();
  });

  it('renders file table with filenames from mock data', () => {
    useAppStore.setState({ selectedDevice: mockDevice, isModalOpen: true });
    render(<DeviceDetailModal />);
    expect(screen.getByText('DJI_0021_PRO.mp4')).toBeInTheDocument();
    expect(screen.getByText('IMG_8493.HEIC')).toBeInTheDocument();
  });

  it('shows file count in stats bar', () => {
    useAppStore.setState({ selectedDevice: mockDevice, isModalOpen: true });
    render(<DeviceDetailModal />);
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('个文件')).toBeInTheDocument();
  });
});
