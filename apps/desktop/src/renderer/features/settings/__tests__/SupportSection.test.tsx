import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { DashboardDeviceDTO } from '@syncflow/contracts';
import { useDashboardStore } from '@renderer/stores/dashboard-store';
import { SupportSection } from '../SupportSection';

const transferringDevice: DashboardDeviceDTO = {
  deviceId: 'device-1',
  displayName: 'iPhone',
  clientName: 'iPhone',
  platform: 'ios',
  ip: '192.168.1.20',
  status: 'transferring',
  todayFileCount: 1,
  todayBytes: 1024,
  storageLeft: '100 GB',
  storagePath: '/tmp/SyncFlow',
  devicePath: '/tmp/SyncFlow/iPhone',
  currentFile: {
    filename: 'IMG_0001.mov',
    progress: 42,
    fileSize: 2048,
  },
};

function setElectronAPI() {
  (window as Window & { electronAPI?: unknown }).electronAPI = {
    support: {
      exportDiagnostics: vi.fn().mockResolvedValue(null),
      getAppInfo: vi.fn().mockResolvedValue({
        name: 'Vivi Drop',
        version: '0.1.0',
        buildNumber: '1',
      }),
    },
    sidecar: {
      resetState: vi.fn().mockResolvedValue({ ok: true }),
    },
  } as unknown as Window['electronAPI'];
}

describe('SupportSection', () => {
  beforeEach(() => {
    setElectronAPI();
    useDashboardStore.setState({
      devices: [],
      summary: {
        todayUploadCount: 0,
        todayOccupiedBytes: 0,
        remainingBytes: 0,
        isDiskLow: false,
        lastSuccessfulSyncAt: undefined,
        lastSuccessfulDeviceName: undefined,
      },
    });
  });

  it('disables reset data while a transfer is active', () => {
    useDashboardStore.setState({ devices: [transferringDevice] });

    render(<SupportSection />);

    expect(screen.getByRole('button', { name: /重置数据/ })).toBeDisabled();
  });
});
