import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DesktopManagedDeviceDTO } from '@syncflow/contracts';
import { DevicesPage } from '../DevicesPage';
import { useManagementStore } from '@renderer/stores/management-store';
import { useDashboardStore } from '@renderer/stores/dashboard-store';

vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
  },
}));

const authorizedDevice: DesktopManagedDeviceDTO = {
  desktopDeviceId: 'desktop-1',
  clientId: 'client-1',
  clientIdShort: 'client-1234',
  displayName: 'iPhone 15 Pro',
  platform: 'ios',
  lastIp: '192.168.1.20',
  authorizedAt: '2026-06-01T08:00:00Z',
  lastSeenAt: '2026-06-15T09:30:00Z',
  authorizationStatus: 'authorized',
  blockStatus: 'none',
  failedAttemptCount: 0,
  todayFileCount: 4,
  todayBytes: 4096,
  totalFileCount: 20,
  totalBytes: 8192,
};

const blockedDevice: DesktopManagedDeviceDTO = {
  ...authorizedDevice,
  desktopDeviceId: 'desktop-2',
  clientId: 'blocked-client',
  clientIdShort: 'blocked-client',
  displayName: 'Galaxy S24',
  platform: 'android',
  authorizationStatus: 'revoked',
  blockStatus: 'active',
  failedAttemptCount: 5,
  blockedAt: '2026-06-15T09:00:00Z',
  blockReason: 'too_many_failed_attempts',
};

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
  useDashboardStore.setState({
    devices: [],
  });
}

describe('DevicesPage', () => {
  beforeEach(() => {
    resetStore();
    vi.spyOn(useManagementStore.getState(), 'loadDevices').mockResolvedValue();
  });

  it('displays authorized device', () => {
    useManagementStore.setState({ devices: [authorizedDevice] });
    // Mock the dashboard state to show the device is connected
    useDashboardStore.setState({
      devices: [
        {
          deviceId: 'client-1',
          stableDeviceId: 'client-1',
          displayName: 'iPhone 15 Pro',
          clientName: 'iPhone',
          platform: 'ios',
          ip: '192.168.1.100',
          status: 'connected_idle',
          todayFileCount: 0,
          todayBytes: 0,
          storageLeft: '10 GB',
          storagePath: '/tmp',
          devicePath: '/tmp/client-1',
        },
      ],
    });

    render(<DevicesPage />);

    expect(screen.getByText('iPhone 15 Pro')).toBeInTheDocument();
    expect(screen.getAllByText('已连接').length).toBeGreaterThan(0);
  });

  it('displays blocked device with manual unblock action', () => {
    useManagementStore.setState({ devices: [blockedDevice] });

    render(<DevicesPage />);

    expect(screen.getByText('Galaxy S24')).toBeInTheDocument();
    expect(screen.getAllByText('已禁用').length).toBeGreaterThan(0);
    expect(screen.getByText('输错连接码超过 5 次，已自动禁用')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消禁用' })).toBeInTheDocument();
  });

  it('renders the real empty state when the device list is empty in development', () => {
    render(<DevicesPage />);

    expect(screen.getByText('暂无设备')).toBeInTheDocument();
    expect(screen.queryByText('iPhone 15 Pro')).not.toBeInTheDocument();
    expect(screen.queryByText('Galaxy S24 Ultra')).not.toBeInTheDocument();
  });

  it('opens a confirmation dialog before disabling an active device', () => {
    useManagementStore.setState({ devices: [authorizedDevice] });

    render(<DevicesPage />);
    fireEvent.click(screen.getByRole('button', { name: '禁用' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('禁用设备')).toBeInTheDocument();
    expect(
      screen.getByText('禁用后 iPhone 15 Pro 将断开连接并停止所有传输，确定要禁用该设备吗？'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认禁用' })).toBeInTheDocument();
  });

  it('marks a device as disabled after confirming the disable dialog', async () => {
    // Mock blockDevice to simulate successful block and update the store
    const blockedVersion: DesktopManagedDeviceDTO = {
      ...authorizedDevice,
      authorizationStatus: 'revoked',
      blockStatus: 'active',
      failedAttemptCount: 5,
      blockedAt: new Date().toISOString(),
      blockReason: 'too_many_failed_attempts',
    };
    const blockDevice = vi.fn().mockImplementation(async () => {
      useManagementStore.setState({ devices: [blockedVersion] });
    });
    useManagementStore.setState({ devices: [authorizedDevice], blockDevice });

    render(<DevicesPage />);
    fireEvent.click(screen.getByRole('button', { name: '禁用' }));
    fireEvent.click(screen.getByRole('button', { name: '确认禁用' }));

    await waitFor(() => {
      expect(screen.getAllByText('已禁用').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('输错连接码超过 5 次，已自动禁用')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消禁用' })).toBeInTheDocument();
  });

  it('clicking unblock calls store action', async () => {
    const unblockDevice = vi
      .spyOn(useManagementStore.getState(), 'unblockDevice')
      .mockResolvedValue();
    useManagementStore.setState({ devices: [blockedDevice], unblockDevice });

    render(<DevicesPage />);
    fireEvent.click(screen.getByRole('button', { name: '取消禁用' }));

    await waitFor(() => {
      expect(unblockDevice).toHaveBeenCalledWith(blockedDevice.clientId);
    });
  });

  it('keeps device status display in device management items', () => {
    useManagementStore.setState({ devices: [authorizedDevice, blockedDevice] });
    useDashboardStore.setState({
      devices: [
        {
          deviceId: 'client-1',
          stableDeviceId: 'client-1',
          displayName: 'iPhone 15 Pro',
          clientName: 'iPhone',
          platform: 'ios',
          ip: '192.168.1.100',
          status: 'connected_idle',
          todayFileCount: 0,
          todayBytes: 0,
          storageLeft: '10 GB',
          storagePath: '/tmp',
          devicePath: '/tmp/client-1',
        },
      ],
    });

    render(<DevicesPage />);

    expect(screen.getByText('iPhone 15 Pro')).toBeInTheDocument();
    expect(screen.getByText('Galaxy S24')).toBeInTheDocument();
    expect(screen.getAllByText('已连接').length).toBeGreaterThan(0);
    expect(screen.getAllByText('已禁用').length).toBeGreaterThan(0);
    expect(screen.getByText('输错连接码超过 5 次，已自动禁用')).toBeInTheDocument();
  });

  it('does not hardcode localized Chinese copy in device management source', () => {
    const devicesPageSource = readFileSync(resolve(__dirname, '../DevicesPage.tsx'), 'utf8');
    const tableSource = readFileSync(resolve(__dirname, '../DeviceManagementTable.tsx'), 'utf8');

    expect(devicesPageSource).not.toMatch(/[\u4e00-\u9fff]/);
    expect(tableSource).not.toMatch(/[\u4e00-\u9fff]/);
  });
});
