import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { Dashboard } from '../Dashboard';
import { useDashboardStore } from '@renderer/stores/dashboard-store';
import { mockDashboardSummary } from '@renderer/mocks/dashboard';
import { mockDevices } from '@renderer/mocks/devices';

describe('Dashboard', () => {
  beforeEach(() => {
    vi.useRealTimers();
    useDashboardStore.setState({
      summary: mockDashboardSummary,
      devices: mockDevices,
      diskWarningDismissed: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the "所有设备" heading', () => {
    render(<Dashboard />);
    expect(screen.getByText('所有设备')).toBeInTheDocument();
  });

  it('renders 3 stat cards', () => {
    render(<Dashboard />);
    expect(screen.getByText('今日接收媒体总数')).toBeInTheDocument();
    expect(screen.getByText('今日占用总空间')).toBeInTheDocument();
    expect(screen.getByText('设备剩余空间')).toBeInTheDocument();
  });

  it('renders device cards matching mock device count', () => {
    render(<Dashboard />);
    const devices = useDashboardStore.getState().devices;
    const deviceCards = screen.getAllByTestId('device-card');
    expect(deviceCards).toHaveLength(devices.length);
  });

  it('shows latest historical device stats when today has no files', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-27T12:00:00'));
    useDashboardStore.setState({
      devices: [
        {
          deviceId: 'history-device',
          displayName: 'iPhone History',
          clientName: 'iPhone History',
          platform: 'ios',
          ip: '192.168.1.9',
          status: 'offline',
          todayFileCount: 0,
          todayBytes: 0,
          latestDate: '2026-04-24',
          latestFileCount: 3,
          latestBytes: 12 * 1024,
          storageLeft: '1 TB',
          storagePath: '/tmp/received',
          devicePath: '/tmp/received/iPhone History',
        },
      ],
    });

    render(<Dashboard />);

    const card = screen.getByTestId('device-card');
    expect(within(card).getByText('最近 4月24日')).toBeInTheDocument();
    expect(within(card).getByText('3')).toBeInTheDocument();
    expect(within(card).getByText('12 KB')).toBeInTheDocument();
  });

  it('keeps today stats when latest stats have no date', () => {
    useDashboardStore.setState({
      devices: [
        {
          deviceId: 'partial-history-device',
          displayName: 'iPhone Partial History',
          clientName: 'iPhone Partial History',
          platform: 'ios',
          ip: '192.168.1.10',
          status: 'offline',
          todayFileCount: 0,
          todayBytes: 0,
          latestFileCount: 3,
          latestBytes: 12 * 1024,
          storageLeft: '1 TB',
          storagePath: '/tmp/received',
          devicePath: '/tmp/received/iPhone Partial History',
        },
      ],
    });

    render(<Dashboard />);

    const card = screen.getByTestId('device-card');
    expect(within(card).getByText('今日')).toBeInTheDocument();
    expect(within(card).getByText('0')).toBeInTheDocument();
    expect(within(card).getByText('0 B')).toBeInTheDocument();
    expect(within(card).queryByText('3')).not.toBeInTheDocument();
    expect(within(card).queryByText('12 KB')).not.toBeInTheDocument();
  });

  it('shows disk warning banner when isDiskLow is true', () => {
    useDashboardStore.setState({
      summary: {
        ...useDashboardStore.getState().summary,
        isDiskLow: true,
      },
      diskWarningDismissed: false,
    });

    render(<Dashboard />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/接收磁盘剩余空间小于 500MB，已暂停新的接收任务/)).toBeInTheDocument();
  });

  it('hides disk warning banner when isDiskLow is false', () => {
    useDashboardStore.setState({
      summary: {
        ...useDashboardStore.getState().summary,
        isDiskLow: false,
      },
    });

    render(<Dashboard />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
