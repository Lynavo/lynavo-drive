import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Dashboard } from '../Dashboard';
import { useDashboardStore } from '@renderer/stores/dashboard-store';
import { useSettingsStore } from '@renderer/stores/settings-store';
import { toast } from 'sonner';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({
    value,
    title,
  }: {
    value: string;
    title?: string;
  }) => (
    <svg data-testid="connection-qr-code" data-value={value}>
      {title ? <title>{title}</title> : null}
    </svg>
  ),
}));

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDashboardStore.setState({
      summary: {
        isDiskLow: false,
        remainingBytes: 71500000000, // ~66.6 GB
        todayUploadCount: 0,
        todayOccupiedBytes: 0,
      },
      devices: [],
    });
    useSettingsStore.setState({
      settings: {
        deviceName: 'Test PC',
        connectionCode: '998877',
        rootPath: '/tmp',
        receivePath: '/tmp/received',
        personalPath: '/tmp/personal',
        sharedPath: '/tmp/shared',
        shareAddress: '',
        shareStatus: 'unknown',
        shareName: '',
      },
    });

    (window as any).electronAPI = {
      files: {
        copyToClipboard: vi.fn().mockResolvedValue(undefined),
        selectFolder: vi.fn().mockResolvedValue('/new/receive/path'),
        checkFolderPermission: vi.fn().mockResolvedValue({ granted: true }),
        requestFolderPermission: vi.fn().mockResolvedValue({ granted: true }),
        openExternal: vi.fn().mockResolvedValue(undefined),
      },
      support: {},
      sidecar: {
        getTransferActive: vi.fn().mockResolvedValue({ active: false }),
        regenerateConnectionCode: vi.fn().mockResolvedValue({ code: '112233' }),
        updateSettings: vi.fn().mockImplementation(async (updates) => ({
          deviceName: 'Test PC',
          connectionCode: '998877',
          rootPath: updates.rootPath || '/tmp',
          receivePath: updates.rootPath || '/tmp/received',
          personalPath: '/tmp/personal',
          sharedPath: '/tmp/shared',
          shareAddress: '',
          shareStatus: 'unknown',
          shareName: '',
        })),
      },
      events: {
        onSidecarEvent: vi.fn(() => vi.fn()),
      },
      platform: {
        isMac: vi.fn().mockReturnValue(false),
        isWindows: vi.fn().mockReturnValue(false),
        getHomeDir: vi.fn().mockReturnValue('/home/test'),
        getHostName: vi.fn().mockReturnValue('test-host'),
        getLocalIPs: vi.fn().mockReturnValue(['192.168.31.8']),
      },
    };

  });

  it('renders the 3 main cards: 连接码, 远程访问, 接收目录', () => {
    render(<Dashboard />);

    expect(screen.getByText('连接码')).toBeInTheDocument();
    expect(screen.getByText('远程访问')).toBeInTheDocument();
    expect(screen.getByText('接收目录')).toBeInTheDocument();
  });

  it('displays masked connection code by default and toggles mask', () => {
    render(<Dashboard />);

    // Masked code is 6 dots
    expect(screen.getByText('••••••')).toBeInTheDocument();

    const toggleBtn = screen.getByRole('button', { name: '显示连接码' });
    expect(toggleBtn).toBeInTheDocument();

    fireEvent.click(toggleBtn);
    expect(screen.getByText('998877')).toBeInTheDocument();
  });

  it('expands the connection QR code from the connection code card', () => {
    render(<Dashboard />);

    expect(screen.queryByText('手机扫码配对该电脑')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '显示连接二维码' }));

    expect(screen.getByText('手机扫码配对该电脑')).toBeInTheDocument();
    expect(screen.getByTitle('ViviDrop 连接二维码')).toBeInTheDocument();
  });

  it('includes the desktop LAN IP in the connection QR code payload', () => {
    render(<Dashboard />);

    fireEvent.click(screen.getByRole('button', { name: '显示连接二维码' }));

    const qrValue = screen
      .getByTestId('connection-qr-code')
      .getAttribute('data-value');

    expect(qrValue).toBe(
      'vividrop://connect?ip=192.168.31.8&device=Test%20PC&code=998877',
    );
  });

  it('triggers copy connection code', async () => {
    render(<Dashboard />);
    // Reveal first to make it copyable or test copy directly
    const copyBtn = screen.getByRole('button', { name: '复制' });
    fireEvent.click(copyBtn);

    expect(window.electronAPI?.files.copyToClipboard).toHaveBeenCalledWith('998877');
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('连接码已复制');
    });
  });

  it('triggers regenerate connection code on double click', async () => {
    render(<Dashboard />);
    // First reveal
    fireEvent.click(screen.getByRole('button', { name: '显示连接码' }));

    const codeSpan = screen.getByText('998877');
    fireEvent.doubleClick(codeSpan);

    expect(window.electronAPI?.sidecar.regenerateConnectionCode).toHaveBeenCalled();
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('连接码已重新生成！旧配对设备已失效');
    });
  });

  it('displays the receive path and handles modify directory action', async () => {
    render(<Dashboard />);

    expect(screen.getByText('/tmp/received')).toBeInTheDocument();
    // 71500000000 bytes ~ 66.6 GB
    expect(screen.getByText(/剩余 66.6 GB/)).toBeInTheDocument();

    const modifyBtn = screen.getByRole('button', { name: '修改目录' });
    fireEvent.click(modifyBtn);

    expect(window.electronAPI?.files.selectFolder).toHaveBeenCalled();
    await waitFor(() => {
      expect(window.electronAPI?.sidecar.updateSettings).toHaveBeenCalledWith({
        rootPath: '/new/receive/path',
      });
      expect(toast.success).toHaveBeenCalledWith('接收目录修改成功');
    });
  });
});
