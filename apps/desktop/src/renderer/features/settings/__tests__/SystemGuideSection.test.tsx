import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SystemGuideSection } from '../SystemGuideSection';
import { useSettingsStore } from '@renderer/stores/settings-store';

const openFolder = vi.fn();

function setElectronAPI(platform: { isMac: boolean; isWindows: boolean; isLinux: boolean }) {
  (window as Window & { electronAPI?: unknown }).electronAPI = {
    platform: {
      isMac: () => platform.isMac,
      isWindows: () => platform.isWindows,
      isLinux: () => platform.isLinux,
    },
    files: {
      openExternal: vi.fn(),
      openFolder,
    },
  } as unknown as Window['electronAPI'];
}

describe('SystemGuideSection', () => {
  beforeEach(() => {
    openFolder.mockReset();
    setElectronAPI({ isMac: true, isWindows: false, isLinux: false });
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
      validatingShare: false,
      copiedField: null,
    });
  });

  it('renders only the macOS file sharing guide on macOS', () => {
    render(<SystemGuideSection />);

    expect(screen.getByText('macOS 文件共享')).toBeInTheDocument();
    expect(screen.queryByText('Windows 文件共享')).not.toBeInTheDocument();
    expect(screen.queryByText('Linux 文件共享')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /打开高级共享/ })).not.toBeInTheDocument();
  });

  it('renders only Windows guidance and actions on Windows', () => {
    setElectronAPI({ isMac: false, isWindows: true, isLinux: false });

    render(<SystemGuideSection />);

    expect(screen.getByText('Windows 文件共享')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /打开高级共享/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /打开团队共享目录/ })).toBeInTheDocument();
    expect(screen.queryByText('macOS 文件共享')).not.toBeInTheDocument();
    expect(screen.queryByText('Linux 文件共享')).not.toBeInTheDocument();
  });

  it('renders neutral Linux manual sharing guidance with an open folder action', () => {
    setElectronAPI({ isMac: false, isWindows: false, isLinux: true });

    render(<SystemGuideSection />);

    expect(screen.getByText('Linux 文件共享')).toBeInTheDocument();
    expect(
      screen.getByText('在系统中手动配置 Samba 或文件共享后，回到 Vivi Drop 重新检测。'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /打开团队共享目录/ })).toBeInTheDocument();
    expect(screen.queryByText('macOS 文件共享')).not.toBeInTheDocument();
    expect(screen.queryByText('Windows 文件共享')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /打开高级共享/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /打开团队共享目录/ }));

    expect(openFolder).toHaveBeenCalledWith('/Users/alice/Vivi Drop/shared');
  });
});
