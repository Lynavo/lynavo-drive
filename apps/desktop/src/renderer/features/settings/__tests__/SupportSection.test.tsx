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
  storagePath: '/tmp/SyncFlow',
  devicePath: '/tmp/SyncFlow/iPhone',
  currentFile: {
    filename: 'IMG_0001.mov',
    progress: 42,
    fileSize: 2048,
  },
};

function setElectronAPI(overrides?: {
  uploadDiagnostics?: ReturnType<typeof vi.fn>;
  exportDiagnostics?: ReturnType<typeof vi.fn>;
  checkForUpdates?: ReturnType<typeof vi.fn>;
  openExternal?: ReturnType<typeof vi.fn>;
}) {
  (window as Window & { electronAPI?: unknown }).electronAPI = {
    support: {
      uploadDiagnostics:
        overrides?.uploadDiagnostics ??
        vi.fn().mockResolvedValue({ refId: 'DIA1234', uploadedAt: '2026-05-08T03:00:00Z' }),
      exportDiagnostics: overrides?.exportDiagnostics ?? vi.fn().mockResolvedValue(null),
      getAppInfo: vi.fn().mockResolvedValue({
        name: 'Vivi Drop',
        version: '0.1.0',
        buildNumber: '1',
      }),
      checkForUpdates:
        overrides?.checkForUpdates ??
        vi.fn().mockResolvedValue({
          updateAvailable: false,
          latestVersion: '0.1.0',
          checkedAt: '2026-05-08T03:00:00Z',
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

    expect(await screen.findByText('Vivi Drop v0.1.0 (1)')).toBeInTheDocument();
  });

  it('requires a description before uploading diagnostics', async () => {
    const uploadDiagnostics = vi
      .fn()
      .mockResolvedValue({ refId: 'DIA1234', uploadedAt: '2026-05-08T03:00:00Z' });
    setElectronAPI({ uploadDiagnostics });

    render(<SupportSection />);

    fireEvent.click(screen.getByRole('button', { name: /上传诊断包/ }));
    fireEvent.change(screen.getByLabelText('问题描述'), {
      target: { value: 'Wi-Fi 断开后无法继续同步' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^上传$/ }));

    await waitFor(() => {
      expect(uploadDiagnostics).toHaveBeenCalledWith({
        description: 'Wi-Fi 断开后无法继续同步',
        locale: 'zh-Hans',
      });
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

  it('falls back to local export only when diagnostics upload reports network unreachable', async () => {
    const networkError = Object.assign(new Error('offline'), { code: 'NETWORK_UNREACHABLE' });
    const uploadDiagnostics = vi.fn().mockRejectedValue(networkError);
    const exportDiagnostics = vi.fn().mockResolvedValue('/tmp/vivi-drop-diagnostics.zip');
    setElectronAPI({ uploadDiagnostics, exportDiagnostics });

    render(<SupportSection />);

    fireEvent.click(screen.getByRole('button', { name: /上传诊断包/ }));
    fireEvent.change(screen.getByLabelText('问题描述'), {
      target: { value: '公司网络无法上传' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^上传$/ }));

    await waitFor(() => {
      expect(exportDiagnostics).toHaveBeenCalledWith('zh-Hans', '公司网络无法上传');
    });
  });

  it('falls back to local export when diagnostics upload reports bundle too large', async () => {
    const tooLargeError = Object.assign(new Error('too large'), { code: 'BUNDLE_TOO_LARGE' });
    const uploadDiagnostics = vi.fn().mockRejectedValue(tooLargeError);
    const exportDiagnostics = vi.fn().mockResolvedValue('/tmp/vivi-drop-diagnostics.zip');
    setElectronAPI({ uploadDiagnostics, exportDiagnostics });

    render(<SupportSection />);

    fireEvent.click(screen.getByRole('button', { name: /上传诊断包/ }));
    fireEvent.change(screen.getByLabelText('问题描述'), {
      target: { value: '日志太大无法上传' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^上传$/ }));

    await waitFor(() => {
      expect(exportDiagnostics).toHaveBeenCalledWith('zh-Hans', '日志太大无法上传');
    });
  });

  it('shows update availability and opens the download URL', async () => {
    const checkForUpdates = vi.fn().mockResolvedValue({
      updateAvailable: true,
      latestVersion: '0.2.0',
      downloadUrl: 'https://www.vividrop.cn/download',
      checkedAt: '2026-05-08T03:00:00Z',
    });
    const openExternal = vi.fn().mockResolvedValue(undefined);
    setElectronAPI({ checkForUpdates, openExternal });

    render(<SupportSection />);

    expect(await screen.findByText('有新版本 v0.2.0 可用')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /打开下载页/ }));

    expect(openExternal).toHaveBeenCalledWith('https://www.vividrop.cn/download');
  });

  it('does not render update content when release notes are blank', async () => {
    const checkForUpdates = vi.fn().mockResolvedValue({
      updateAvailable: true,
      latestVersion: '0.2.0',
      releaseNotes: '   ',
      checkedAt: '2026-05-08T03:00:00Z',
    });
    setElectronAPI({ checkForUpdates });

    render(<SupportSection />);

    expect(await screen.findByText('有新版本 v0.2.0 可用')).toBeInTheDocument();
    expect(screen.queryByText(/更新内容/)).not.toBeInTheDocument();
  });
});
