import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Dashboard } from '../Dashboard';
import { useDashboardStore } from '@renderer/stores/dashboard-store';

describe('Dashboard', () => {
  beforeEach(() => {
    // Reset store to defaults (with mock data) before each test
    useDashboardStore.setState({
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
        /接收磁盘剩余空间.*500MB.*已暂停所有设备的接收任务/,
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
