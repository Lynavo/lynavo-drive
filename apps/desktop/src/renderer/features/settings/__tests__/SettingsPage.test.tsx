import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SettingsPage } from '../SettingsPage';

vi.mock('../DeviceNameSection', () => ({
  DeviceNameSection: () => <div data-testid="device-name-section">DeviceNameSection</div>,
}));

vi.mock('../ConnectionCodeSection', () => ({
  ConnectionCodeSection: () => (
    <div data-testid="connection-code-section">ConnectionCodeSection</div>
  ),
}));

vi.mock('../BonjourRuntimeSection', () => ({
  BonjourRuntimeSection: () => (
    <div data-testid="bonjour-runtime-section">BonjourRuntimeSection</div>
  ),
}));

vi.mock('../SupportSection', () => ({
  SupportSection: () => <div data-testid="support-section">SupportSection</div>,
}));

function setElectronPlatform(overrides: { isMac?: boolean; isWindows?: boolean }) {
  const isMac = overrides.isMac ?? true;
  const isWindows = overrides.isWindows ?? false;

  (window as Window & { electronAPI?: unknown }).electronAPI = {
    platform: {
      isMac: () => isMac,
      isWindows: () => isWindows,
      getHostName: () => 'TestHost',
      getLocalIPs: () => ['192.168.1.10'],
    },
    events: {
      onSidecarEvent: vi.fn(() => vi.fn()),
      onSidecarRuntimeState: vi.fn(() => vi.fn()),
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
}

describe('SettingsPage', () => {
  beforeEach(() => {
    setElectronPlatform({ isMac: true, isWindows: false });
  });

  it('renders the page title "设置"', () => {
    render(<SettingsPage />);

    expect(screen.getByText('设置')).toBeInTheDocument();
  });

  it('renders the "设备名称" section heading', () => {
    render(<SettingsPage />);

    expect(screen.getByRole('heading', { name: '设备名称' })).toBeInTheDocument();
    expect(screen.getByTestId('device-name-section')).toBeInTheDocument();
  });

  it('renders the "连接码管理" section heading', () => {
    render(<SettingsPage />);

    expect(screen.getByText('连接码管理')).toBeInTheDocument();
    expect(screen.getByTestId('connection-code-section')).toBeInTheDocument();
  });

  it('renders SupportSection', () => {
    render(<SettingsPage />);

    expect(screen.getByTestId('support-section')).toBeInTheDocument();
  });

  it('does NOT render BonjourRuntimeSection on macOS', () => {
    setElectronPlatform({ isMac: true, isWindows: false });
    render(<SettingsPage />);

    expect(screen.queryByTestId('bonjour-runtime-section')).not.toBeInTheDocument();
  });

  it('renders BonjourRuntimeSection on Windows', () => {
    setElectronPlatform({ isMac: false, isWindows: true });
    render(<SettingsPage />);

    expect(screen.getByTestId('bonjour-runtime-section')).toBeInTheDocument();
    expect(screen.getByText('Windows Bonjour 广播')).toBeInTheDocument();
  });

  it('does NOT render FilePathSection (removed in v2 refactor)', () => {
    render(<SettingsPage />);

    expect(screen.queryByText('文件地址配置')).not.toBeInTheDocument();
  });

  it('does NOT render SystemGuideSection (removed in v2 refactor)', () => {
    render(<SettingsPage />);

    expect(screen.queryByText('系统权限指引')).not.toBeInTheDocument();
  });
});
