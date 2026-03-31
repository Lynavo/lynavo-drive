import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SettingsPage } from '../SettingsPage';
import { useSettingsStore } from '@renderer/stores/settings-store';
import { mockSettings } from '@renderer/mocks/settings';

describe('SettingsPage', () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, 'electronAPI');
    useSettingsStore.setState({
      settings: mockSettings,
      shareStatusInfo: {
        enabled: true,
        smbUrl: mockSettings.shareAddress,
        status: mockSettings.shareStatus,
        shareName: mockSettings.shareName,
      },
      validatingShare: false,
      copiedField: null,
    });
  });

  it('renders section headings', () => {
    render(<SettingsPage />);

    expect(screen.getByRole('heading', { name: '设备名称' })).toBeInTheDocument();
    expect(screen.getByText('连接码管理')).toBeInTheDocument();
    expect(screen.getByText('文件地址配置')).toBeInTheDocument();
    expect(screen.getByText('系统权限指引')).toBeInTheDocument();
  });

  it('displays 6 individual code digit boxes', () => {
    render(<SettingsPage />);

    const digits = screen.getAllByTestId('code-digit');
    expect(digits).toHaveLength(6);
  });

  it('renders the page title', () => {
    render(<SettingsPage />);

    expect(screen.getByText('设置')).toBeInTheDocument();
  });

  it('displays the connection code digits from the store', () => {
    render(<SettingsPage />);

    const digits = screen.getAllByTestId('code-digit');
    const code = mockSettings.connectionCode;
    digits.forEach((el, i) => {
      expect(el.textContent).toBe(code[i]);
    });
  });

  it('displays the receive path', () => {
    render(<SettingsPage />);

    const input = screen.getByDisplayValue(mockSettings.receivePath);
    expect(input).toBeInTheDocument();
  });

  it('displays the share address', () => {
    render(<SettingsPage />);

    expect(screen.getByText(mockSettings.shareAddress)).toBeInTheDocument();
  });

  it('displays the system guide card', () => {
    render(<SettingsPage />);

    expect(
      screen.getByText('Mac 开启本地共享操作手册'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('适用于 macOS Ventura 及以上'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Windows 手动配置共享方法'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/开启“网络发现”和“文件和打印机共享”/),
    ).toBeInTheDocument();
  });

  it('renders Windows quick actions for share setup', async () => {
    (window as Window & { electronAPI?: unknown }).electronAPI = {
      sidecar: {
        validateShare: vi.fn().mockResolvedValue({
          enabled: false,
          smbUrl: null,
          status: 'needs_manual_enable',
          shareName: 'SyncFlow',
        }),
      },
      files: {
        openExternal: vi.fn(),
        openFolder: vi.fn(),
        openFile: vi.fn(),
        selectFolder: vi.fn(),
        copyToClipboard: vi.fn(),
      },
      platform: {
        isMac: () => false,
        isWindows: () => true,
        getHostName: () => 'DESKTOP-01',
      },
      events: {
        onSidecarEvent: vi.fn(),
        onSidecarRuntimeState: vi.fn(),
      },
      support: {
        exportDiagnostics: vi.fn().mockResolvedValue(null),
        getAppInfo: vi.fn().mockResolvedValue({
          name: 'SyncFlow',
          version: '0.1.0',
          buildNumber: '5',
        }),
      },
    } as unknown as Window['electronAPI'];

    useSettingsStore.setState({
      settings: {
        ...mockSettings,
        shareAddress: '',
        shareStatus: 'needs_manual_enable',
      },
      shareStatusInfo: {
        enabled: false,
        smbUrl: null,
        status: 'needs_manual_enable',
        shareName: 'SyncFlow',
      },
    });

    render(<SettingsPage />);

    expect(await screen.findByText('Windows 快速配置')).toBeInTheDocument();
    expect(screen.getByText('配置方式请查看下面的“Windows 手动配置共享方法”。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重新检测' })).not.toBeInTheDocument();
    expect(screen.queryByText('未开启共享')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '打开高级共享设置' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: '打开接收目录' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: '复制推荐地址' })).toBeInTheDocument();
    expect(screen.getAllByText('\\\\DESKTOP-01\\SyncFlow')).toHaveLength(2);
  });
});
