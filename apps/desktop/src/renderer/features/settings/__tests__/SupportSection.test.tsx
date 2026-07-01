import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, createRef, type ComponentType, type RefAttributes } from 'react';
import type { DashboardDeviceDTO } from '@lynavo-drive/contracts';
import { Dialog, DialogOverlay, DialogPortal } from '@renderer/components/ui/dialog';
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
  storagePath: '/tmp/LynavoDrive',
  devicePath: '/tmp/LynavoDrive/iPhone',
  currentFile: {
    filename: 'IMG_0001.mov',
    progress: 42,
    fileSize: 2048,
  },
};

function setElectronAPI(overrides?: {
  exportDiagnostics?: ReturnType<typeof vi.fn>;
  openExternal?: ReturnType<typeof vi.fn>;
}) {
  (window as Window & { electronAPI?: unknown }).electronAPI = {
    support: {
      exportDiagnostics: overrides?.exportDiagnostics ?? vi.fn().mockResolvedValue(null),
      getAppInfo: vi.fn().mockResolvedValue({
        name: 'Lynavo Drive',
        version: '0.1.0',
        buildNumber: '1',
      }),
    },
    files: {
      openExternal: overrides?.openExternal ?? vi.fn().mockResolvedValue(undefined),
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('disables reset data while a transfer is active', () => {
    useDashboardStore.setState({ devices: [transferringDevice] });

    render(<SupportSection />);

    expect(screen.getByRole('button', { name: /重置数据/ })).toBeDisabled();
  });

  it('shows the desktop version with build number', async () => {
    render(<SupportSection />);

    expect(await screen.findByText('Lynavo Drive v0.1.0 (1)')).toBeInTheDocument();
  });

  it('exports diagnostics locally with an optional description', async () => {
    const exportDiagnostics = vi.fn().mockResolvedValue('/tmp/lynavo-drive-diagnostics.zip');
    setElectronAPI({ exportDiagnostics });

    render(<SupportSection />);

    fireEvent.click(screen.getByRole('button', { name: /导出诊断包/ }));
    fireEvent.change(screen.getByLabelText('问题描述'), {
      target: { value: 'Wi-Fi 断开后无法继续同步' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^导出$/ }));

    await waitFor(() => {
      expect(exportDiagnostics).toHaveBeenCalledWith('zh-Hans', 'Wi-Fi 断开后无法继续同步');
    });
  });

  it('allows dialog overlay refs to reach the DOM element', () => {
    const overlayRef = createRef<HTMLDivElement>();

    render(
      <Dialog open>
        <DialogPortal>
          {createElement(DialogOverlay as ComponentType<RefAttributes<HTMLDivElement>>, {
            ref: overlayRef,
          })}
        </DialogPortal>
      </Dialog>,
    );

    expect(overlayRef.current).toBeInstanceOf(HTMLDivElement);
  });

  it('does not render update check content', async () => {
    const exportDiagnostics = vi.fn().mockResolvedValue('/tmp/lynavo-drive-diagnostics.zip');
    setElectronAPI({ exportDiagnostics });

    render(<SupportSection />);

    expect(screen.queryByRole('button', { name: /检查更新/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/有新版本/)).not.toBeInTheDocument();
    expect(screen.queryByText(/更新内容/)).not.toBeInTheDocument();
  });
});
