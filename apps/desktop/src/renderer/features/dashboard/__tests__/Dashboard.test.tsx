import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Dashboard } from '../Dashboard';
import { useDashboardStore } from '@renderer/stores/dashboard-store';
import { mockDashboardSummary } from '@renderer/mocks/dashboard';
import { mockDevices } from '@renderer/mocks/devices';

describe('Dashboard', () => {
  beforeEach(() => {
    useDashboardStore.setState({
      summary: mockDashboardSummary,
      devices: mockDevices,
      diskWarningDismissed: false,
    });
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
    expect(
      screen.getByText(
        /接收磁盘剩余空间.*500MB.*已暂停新的接收任务/,
      ),
    ).toBeInTheDocument();
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
