import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SettingsPage } from '../SettingsPage';
import { useAuthStore } from '@renderer/stores/auth-store';
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
        name: 'ViviDrop Desktop',
        version: '1.0.1',
        buildNumber: '56',
      }),
      checkForUpdates: vi.fn().mockResolvedValue(null),
      uploadDiagnostics: vi.fn().mockResolvedValue(null),
    },
    files: {
      openExternal: vi.fn().mockResolvedValue(null),
      openFolder: vi.fn().mockResolvedValue(null),
      copyToClipboard: vi.fn().mockResolvedValue(null),
    },
    events: {
      onSidecarEvent: vi.fn(() => vi.fn()),
      onSidecarRuntimeState: vi.fn(() => vi.fn()),
    },
  } as unknown as Window['electronAPI'];
}

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setElectronPlatform();
    useAuthStore.setState({
      session: {
        loggedIn: true,
        email: 'test@vividrop.app',
        phone: '',
      },
    });
    useSettingsStore.setState({
      settings: {
        deviceName: 'Studio PC',
        connectionCode: '',
        rootPath: '',
        receivePath: '/Users/alice/Vivi Drop/received',
        personalPath: '/Users/alice/Vivi Drop/personal',
        sharedPath: '/Users/alice/Vivi Drop/shared',
        shareAddress: '',
        shareStatus: 'unknown',
        shareName: 'SyncFlow',
      },
      shareStatusInfo: {
        enabled: false,
        smbUrl: null,
        status: 'unknown',
        shareName: 'SyncFlow',
      },
      validatingShare: false,
      copiedField: null,
    });
  });

  it('renders the page title "我的"', () => {
    render(<SettingsPage />);
    expect(screen.getByText('我的')).toBeInTheDocument();
  });

  it('renders the "我的账户" section with membership status', () => {
    render(<SettingsPage />);
    expect(screen.getByText('我的账户')).toBeInTheDocument();
    expect(screen.getByText('test@vividrop.app')).toBeInTheDocument();
    expect(screen.getByText('会员状态')).toBeInTheDocument();
    expect(screen.getByText('Pro')).toBeInTheDocument();
  });

  it('renders the prevent sleep standby option', async () => {
    render(<SettingsPage />);
    expect(screen.getByText('防止待机')).toBeInTheDocument();
    expect(screen.getByText('传输任务运行时保持电脑唤醒')).toBeInTheDocument();

    const switchBtn = screen.getByRole('button', { name: '防止待机' });
    expect(switchBtn).toBeInTheDocument();
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

  it('renders neutral Linux sharing guidance on the real settings page', () => {
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

    expect(screen.getByText('请在系统中手动配置文件共享后重新检测。')).toBeInTheDocument();
    expect(screen.getByText('Linux 文件共享')).toBeInTheDocument();
    expect(
      screen.getByText('在系统中手动配置 Samba 或文件共享后，回到 Vivi Drop 重新检测。'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Windows 快速配置')).not.toBeInTheDocument();
    expect(screen.queryByText('Windows 文件共享')).not.toBeInTheDocument();
  });

  it('renders check for updates and triggers check updates action', async () => {
    render(<SettingsPage />);
    const updateBtn = screen.getByRole('button', { name: '检查更新' });
    expect(updateBtn).toBeInTheDocument();

    fireEvent.click(updateBtn);
    expect(window.electronAPI?.support.checkForUpdates).toHaveBeenCalled();
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('已是最新版本');
    });
  });

  it('renders the installed desktop version from app info', async () => {
    render(<SettingsPage />);

    expect(
      await screen.findByText('v1.0.1 (56) · 当前版本已安装'),
    ).toBeInTheDocument();
  });

  it('renders support section and handles log upload', async () => {
    render(<SettingsPage />);
    const uploadBtn = screen.getByRole('button', { name: '上传' });
    expect(uploadBtn).toBeInTheDocument();

    fireEvent.click(uploadBtn);

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

    expect(window.electronAPI?.support.uploadDiagnostics).toHaveBeenCalledWith({
      description: 'Test log description',
      locale: expect.any(String),
    });
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('诊断包上传成功！感谢您的反馈');
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
      expect.stringContaining('mailto:developer@vividrop.app'),
    );
    expect(window.electronAPI?.files.openExternal).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent('手机无法连接电脑')),
    );
    expect(window.electronAPI?.files.openExternal).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent('当前版本：v1.0.1 (56)')),
    );
  });
});
