import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DesktopManagedDeviceDTO } from '@syncflow/contracts';
import { DevicesPage } from '../DevicesPage';
import { useManagementStore } from '@renderer/stores/management-store';

const authorizedDevice: DesktopManagedDeviceDTO = {
  desktopDeviceId: 'desktop-1',
  clientId: 'client-1234567890abcdefghijklmnopqrstuvwxyz',
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
  clientId: 'blocked-client-1234567890abcdefghijklmnopqrstuvwxyz',
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
}

describe('DevicesPage', () => {
  beforeEach(() => {
    resetStore();
    vi.spyOn(useManagementStore.getState(), 'loadDevices').mockResolvedValue();
  });

  it('displays authorized device', () => {
    useManagementStore.setState({ devices: [authorizedDevice] });

    render(<DevicesPage />);

    expect(screen.getByText('iPhone 15 Pro')).toBeInTheDocument();
    expect(screen.getByText('已授權')).toBeInTheDocument();
    expect(screen.getByText('192.168.1.20')).toBeInTheDocument();
  });

  it('displays blocked device with manual unblock action', () => {
    useManagementStore.setState({ devices: [blockedDevice] });

    render(<DevicesPage />);

    expect(screen.getByText('Galaxy S24')).toBeInTheDocument();
    expect(screen.getByText('已封鎖')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '解除封鎖 Galaxy S24' })).toBeInTheDocument();
  });

  it('renders multiple mobile devices on the same desktop without duplicate row keys', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    useManagementStore.setState({
      devices: [
        authorizedDevice,
        {
          ...blockedDevice,
          desktopDeviceId: authorizedDevice.desktopDeviceId,
        },
      ],
    });

    render(<DevicesPage />);

    expect(screen.getByText('iPhone 15 Pro')).toBeInTheDocument();
    expect(screen.getByText('Galaxy S24')).toBeInTheDocument();
    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining('Encountered two children with the same key'),
      expect.anything(),
    );
  });

  it('masks long clientId', () => {
    useManagementStore.setState({ devices: [authorizedDevice] });

    render(<DevicesPage />);

    expect(screen.getByText('client-12...uvwxyz')).toBeInTheDocument();
    expect(screen.queryByText(authorizedDevice.clientId)).not.toBeInTheDocument();
  });

  it('renders a real empty state', () => {
    render(<DevicesPage />);

    expect(screen.getByText('尚無設備')).toBeInTheDocument();
    expect(screen.getByText('透過連線碼授權後的行動裝置會顯示在這裡。')).toBeInTheDocument();
  });

  it('clicking unblock calls store action', async () => {
    const unblockDevice = vi
      .spyOn(useManagementStore.getState(), 'unblockDevice')
      .mockResolvedValue();
    useManagementStore.setState({ devices: [blockedDevice], unblockDevice });

    render(<DevicesPage />);
    fireEvent.click(screen.getByRole('button', { name: '解除封鎖 Galaxy S24' }));

    await waitFor(() => {
      expect(unblockDevice).toHaveBeenCalledWith(blockedDevice.clientId);
    });
  });
});
