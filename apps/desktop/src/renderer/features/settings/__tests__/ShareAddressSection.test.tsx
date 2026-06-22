import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ShareAddressSection } from '../ShareAddressSection';
import { useSettingsStore } from '@renderer/stores/settings-store';

function setElectronAPI(
  platform: { isMac: boolean; isWindows: boolean; isLinux: boolean } = {
    isMac: false,
    isWindows: true,
    isLinux: false,
  },
) {
  (window as Window & { electronAPI?: unknown }).electronAPI = {
    platform: {
      isMac: () => platform.isMac,
      isWindows: () => platform.isWindows,
      isLinux: () => platform.isLinux,
      getHostName: () => 'STUDIO-PC',
    },
    files: {
      openExternal: vi.fn(),
      openFolder: vi.fn(),
      copyToClipboard: vi.fn(),
    },
  } as unknown as Window['electronAPI'];
}

describe('ShareAddressSection', () => {
  beforeEach(() => {
    setElectronAPI();
    useSettingsStore.setState({
      settings: {
        deviceName: 'Studio PC',
        connectionCode: '',
        rootPath: '',
        receivePath: 'C:\\Users\\Alice\\Vivi Drop\\received',
        personalPath: 'C:\\Users\\Alice\\Vivi Drop\\personal',
        sharedPath: 'C:\\Users\\Alice\\Vivi Drop\\shared',
        shareAddress: '',
        shareStatus: 'needs_manual_enable',
        shareName: 'SyncFlow',
      },
      shareStatusInfo: {
        enabled: false,
        smbUrl: null,
        status: 'needs_manual_enable',
        shareName: 'SyncFlow',
      },
      validatingShare: false,
      copiedField: null,
    });
  });

  it('shows Windows share status and refresh action', () => {
    render(<ShareAddressSection />);

    expect(screen.getByText('需要手动开启共享')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /重新检测/ })).toBeInTheDocument();
    expect(screen.getByText('Windows 快速配置')).toBeInTheDocument();
  });

  it('uses neutral Linux copy when sharing needs manual setup', () => {
    setElectronAPI({ isMac: false, isWindows: false, isLinux: true });

    render(<ShareAddressSection />);

    expect(screen.getByText('需要手动开启共享')).toBeInTheDocument();
    expect(screen.getByText('请在系统中手动配置文件共享后重新检测。')).toBeInTheDocument();
    expect(screen.queryByText('Windows 快速配置')).not.toBeInTheDocument();
    expect(screen.queryByText('系统指引')).not.toBeInTheDocument();
  });

  it('uses neutral Linux copy while validating sharing status', () => {
    setElectronAPI({ isMac: false, isWindows: false, isLinux: true });
    useSettingsStore.setState({
      validatingShare: true,
    });

    render(<ShareAddressSection />);

    expect(screen.getByText('正在检测共享状态')).toBeInTheDocument();
    expect(screen.getByText('正在检查系统文件共享配置。')).toBeInTheDocument();
    expect(screen.queryByText('正在检查 Windows 共享配置。')).not.toBeInTheDocument();
    expect(screen.queryByText('Windows 快速配置')).not.toBeInTheDocument();
  });

  it('uses neutral Linux copy when the share is registered', () => {
    setElectronAPI({ isMac: false, isWindows: false, isLinux: true });
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        shareStatus: 'share_registered',
      },
      shareStatusInfo: {
        ...useSettingsStore.getState().shareStatusInfo,
        status: 'share_registered',
      },
    });

    render(<ShareAddressSection />);

    expect(screen.getByText('团队共享目录已登记')).toBeInTheDocument();
    expect(screen.getByText('团队共享目录已登记，请确认系统文件共享可用。')).toBeInTheDocument();
    expect(screen.queryByText('Windows 快速配置')).not.toBeInTheDocument();
    expect(screen.queryByText('系统指引')).not.toBeInTheDocument();
  });

  it('hides Windows quick actions when Windows sharing is ready', () => {
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        shareAddress: '\\\\STUDIO-PC\\SyncFlow',
        shareStatus: 'ready',
      },
      shareStatusInfo: {
        ...useSettingsStore.getState().shareStatusInfo,
        enabled: true,
        smbUrl: '\\\\STUDIO-PC\\SyncFlow',
        status: 'ready',
      },
    });

    render(<ShareAddressSection />);

    expect(screen.getByText('共享已就绪')).toBeInTheDocument();
    expect(screen.queryByText('Windows 快速配置')).not.toBeInTheDocument();
  });
});
