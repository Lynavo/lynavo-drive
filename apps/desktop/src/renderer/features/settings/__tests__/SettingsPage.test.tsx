import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SettingsPage } from '../SettingsPage';
import { useSettingsStore } from '@renderer/stores/settings-store';
import { toast } from 'sonner';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

function setElectronPlatform(
  platform: { isMac: boolean; isWindows: boolean; isLinux: boolean } = {
    isMac: true,
    isWindows: false,
    isLinux: false,
  },
) {
  (window as Window & { electronAPI?: unknown }).electronAPI = {
    platform: {
      isMac: () => platform.isMac,
      isWindows: () => platform.isWindows,
      isLinux: () => platform.isLinux,
      getHostName: () => 'STUDIO-PC',
      getLocalIPs: () => ['192.168.0.227'],
    },
    power: {
      getState: vi.fn().mockResolvedValue({ preventSleepDuringTransfer: false }),
      setPreventSleepDuringTransfer: vi
        .fn()
        .mockResolvedValue({ preventSleepDuringTransfer: true }),
    },
    support: {
      getAppInfo: vi.fn().mockResolvedValue({
        name: 'Lynavo Drive Desktop',
        version: '1.0.1',
        buildNumber: '56',
      }),
      exportDiagnostics: vi.fn().mockResolvedValue('/tmp/lynavo-drive-diagnostics.zip'),
    },
    files: {
      openExternal: vi.fn().mockResolvedValue(null),
      openFolder: vi.fn().mockResolvedValue(null),
      copyToClipboard: vi.fn().mockResolvedValue(null),
    },
    sidecar: {
      updateSettings: vi.fn(),
    },
    events: {
      onSidecarEvent: vi.fn(() => vi.fn()),
      onSidecarRuntimeState: vi.fn(() => vi.fn()),
    },
  } as unknown as Window['electronAPI'];
}

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    setElectronPlatform();
    useSettingsStore.setState({
      settings: {
        deviceName: 'Studio PC',
        connectionCode: '',
        rootPath: '',
        receivePath: '/Users/alice/Lynavo Drive/received',
        personalPath: '/Users/alice/Lynavo Drive/personal',
        sharedPath: '/Users/alice/Lynavo Drive/shared',
        shareAddress: '',
        shareStatus: 'unknown',
        shareName: 'LynavoDrive',
        allowCrossDeviceReceivedAccess: true,
      },
      shareStatusInfo: {
        enabled: false,
        smbUrl: null,
        status: 'unknown',
        shareName: 'LynavoDrive',
      },
      validatingShare: false,
      copiedField: null,
    });
  });

  it('renders the page title "我的"', () => {
    render(<SettingsPage />);
    expect(screen.getByText('我的')).toBeInTheDocument();
  });

  it('renders the community local LAN section without account or membership CTAs', () => {
    render(<SettingsPage />);

    expect(screen.getByText('开源本地同步')).toBeInTheDocument();
    expect(screen.getByText('同一局域网内可直接配对、发现并自动同步。')).toBeInTheDocument();
    expect(screen.queryByText('我的账户')).not.toBeInTheDocument();
    expect(screen.queryByText('test@old-product.example')).not.toBeInTheDocument();
    expect(screen.queryByText('会员状态')).not.toBeInTheDocument();
    expect(screen.queryByText('Pro')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '登入' })).not.toBeInTheDocument();
  });

  it('renders the prevent sleep standby option', async () => {
    render(<SettingsPage />);
    expect(screen.getByText('防止待机')).toBeInTheDocument();
    expect(screen.getByText('传输任务运行时保持电脑唤醒')).toBeInTheDocument();

    const switchBtn = screen.getByRole('button', { name: '防止待机' });
    expect(switchBtn).toBeInTheDocument();
  });

  it('toggles cross-device received library access', async () => {
    const updateSettings = vi.fn().mockResolvedValue({
      ...useSettingsStore.getState().settings,
      allowCrossDeviceReceivedAccess: false,
    });
    window.electronAPI!.sidecar.updateSettings = updateSettings;

    render(<SettingsPage />);

    fireEvent.click(
      screen.getByRole('switch', {
        name: '允许已配对手机浏览所有已接收文件',
      }),
    );

    await waitFor(() => {
      expect(updateSettings).toHaveBeenCalledWith({
        allowCrossDeviceReceivedAccess: false,
      });
    });
  });

  it('shows an error when cross-device received library access update fails', async () => {
    const updateSettings = vi.fn().mockRejectedValue(new Error('sidecar unavailable'));
    window.electronAPI!.sidecar.updateSettings = updateSettings;

    render(<SettingsPage />);

    fireEvent.click(
      screen.getByRole('switch', {
        name: '允许已配对手机浏览所有已接收文件',
      }),
    );

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('修改已接收文件浏览权限失败');
    });
  });

  it('does not render the connection devices section in settings', async () => {
    render(<SettingsPage />);

    expect(screen.queryByText('连接设备')).not.toBeInTheDocument();
    expect(screen.queryByTestId('connection-devices-section')).not.toBeInTheDocument();
  });

  it('does not import connection device management into settings', () => {
    const source = readFileSync(resolve(__dirname, '../SettingsPage.tsx'), 'utf8');

    expect(source).not.toContain('ConnectionDevicesSection');
  });

  it('opens a searchable language picker', () => {
    render(<SettingsPage />);

    fireEvent.click(screen.getByRole('button', { name: /界面语言/ }));

    const search = screen.getByRole('searchbox', { name: '搜索语言' });
    expect(search).toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'English' } });
    expect(screen.getByRole('button', { name: /English/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /繁體中文/ })).not.toBeInTheDocument();
  });

  it('renders the local IP', () => {
    render(<SettingsPage />);
    expect(screen.getByText('本机 IP')).toBeInTheDocument();
    expect(screen.getByText('192.168.0.227')).toBeInTheDocument();
  });

  it('hides local share address guidance in the Lynavo global product', () => {
    setElectronPlatform({ isMac: false, isWindows: false, isLinux: true });

    render(<SettingsPage />);

    expect(screen.queryByText('局域网共享地址')).not.toBeInTheDocument();
    expect(screen.queryByText('Linux 文件共享')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /打开团队共享目录/ })).not.toBeInTheDocument();
  });

  it('keeps Linux sharing guidance hidden in the Lynavo global product', () => {
    setElectronPlatform({ isMac: false, isWindows: false, isLinux: true });
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        shareStatus: 'needs_manual_enable',
      },
      shareStatusInfo: {
        ...useSettingsStore.getState().shareStatusInfo,
        status: 'needs_manual_enable',
      },
    });

    render(<SettingsPage />);

    expect(screen.queryByText('请在系统中手动配置文件共享后重新检测。')).not.toBeInTheDocument();
    expect(screen.queryByText('Linux 文件共享')).not.toBeInTheDocument();
    expect(screen.queryByText('Windows 快速配置')).not.toBeInTheDocument();
    expect(screen.queryByText('Windows 文件共享')).not.toBeInTheDocument();
  });

  it('does not render desktop version polling controls', async () => {
    render(<SettingsPage />);

    expect(screen.queryByRole('button', { name: '检查更新' })).not.toBeInTheDocument();
    expect(screen.queryByText('已是最新版本')).not.toBeInTheDocument();
  });

  it('renders the installed desktop version from app info', async () => {
    render(<SettingsPage />);

    expect(await screen.findByText('v1.0.1 (56) · 当前版本已安装')).toBeInTheDocument();
  });

  it('renders the product helper name in the version card', async () => {
    render(<SettingsPage />);

    expect(await screen.findByText('Lynavo Drive')).toBeInTheDocument();
    expect(screen.queryByText('Lynavo Drive Desktop')).not.toBeInTheDocument();
  });

  it('renders support section and exports diagnostics locally', async () => {
    render(<SettingsPage />);
    const exportBtn = screen.getByRole('button', { name: '导出' });
    expect(exportBtn).toBeInTheDocument();

    fireEvent.click(exportBtn);

    // Dialog should be open, find the description textarea
    const textarea = screen.getByPlaceholderText(
      '请描述出现问题的步骤、手机型号、网络环境或错误现象（选填）',
    );
    expect(textarea).toBeInTheDocument();

    // Fill in a description
    fireEvent.change(textarea, { target: { value: 'Test log description' } });

    // Click the submit button inside the Dialog (using data-testid)
    const submitBtn = screen.getByTestId('submit-diagnostics-btn');
    fireEvent.click(submitBtn);

    expect(window.electronAPI?.support.exportDiagnostics).toHaveBeenCalledWith(
      expect.any(String),
      'Test log description',
    );
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('诊断包已导出', {
        description: '/tmp/lynavo-drive-diagnostics.zip',
      });
    });
  });

  it('opens feedback panel and sends a composed email link', async () => {
    render(<SettingsPage />);
    await screen.findByText('v1.0.1 (56) · 当前版本已安装');

    fireEvent.click(screen.getByRole('button', { name: /问题反馈/ }));
    fireEvent.change(screen.getByPlaceholderText('请描述问题、发生步骤或希望改进的地方'), {
      target: { value: '手机无法连接电脑' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    expect(window.electronAPI?.files.openExternal).toHaveBeenCalledWith(
      expect.stringContaining('mailto:support@lynavo.com'),
    );
    expect(window.electronAPI?.files.openExternal).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent('Lynavo Drive Desktop 问题反馈 v1.0.1 (56)')),
    );
    expect(window.electronAPI?.files.openExternal).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent('手机无法连接电脑')),
    );
    expect(window.electronAPI?.files.openExternal).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent('当前版本：v1.0.1 (56)')),
    );
  });
});
