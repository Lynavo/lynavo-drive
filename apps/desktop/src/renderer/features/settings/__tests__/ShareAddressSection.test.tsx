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
        receivePath: 'C:\\Users\\Alice\\Lynavo Drive\\received',
        personalPath: 'C:\\Users\\Alice\\Lynavo Drive\\personal',
        sharedPath: 'C:\\Users\\Alice\\Lynavo Drive\\shared',
        shareAddress: '',
        shareStatus: 'needs_manual_enable',
        shareName: 'LynavoDrive',
      },
      shareStatusInfo: {
        enabled: false,
        smbUrl: null,
        status: 'needs_manual_enable',
        shareName: 'LynavoDrive',
      },
      validatingShare: false,
      copiedField: null,
    });
  });

  it('shows Windows share status and refresh action', () => {
    render(<ShareAddressSection />);

    expect(screen.getByText('Manual sharing setup required')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Check again/ })).toBeInTheDocument();
    expect(screen.getByText('Windows quick setup')).toBeInTheDocument();
  });

  it('uses neutral Linux copy when sharing needs manual setup', () => {
    setElectronAPI({ isMac: false, isWindows: false, isLinux: true });

    render(<ShareAddressSection />);

    expect(screen.getByText('Manual sharing setup required')).toBeInTheDocument();
    expect(
      screen.getByText('Configure file sharing in Linux system settings, then check again.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Windows quick setup')).not.toBeInTheDocument();
    expect(screen.queryByText('System guide')).not.toBeInTheDocument();
  });

  it('uses neutral Linux copy while validating sharing status', () => {
    setElectronAPI({ isMac: false, isWindows: false, isLinux: true });
    useSettingsStore.setState({
      validatingShare: true,
    });

    render(<ShareAddressSection />);

    expect(screen.getByText('Checking sharing status')).toBeInTheDocument();
    expect(screen.getByText('Checking system file sharing settings.')).toBeInTheDocument();
    expect(screen.queryByText('Checking Windows sharing settings.')).not.toBeInTheDocument();
    expect(screen.queryByText('Windows quick setup')).not.toBeInTheDocument();
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

    expect(screen.getByText('Team shared folder registered')).toBeInTheDocument();
    expect(
      screen.getByText(
        'The team shared folder is registered. Confirm system file sharing is available.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Windows quick setup')).not.toBeInTheDocument();
    expect(screen.queryByText('System guide')).not.toBeInTheDocument();
  });

  it('hides Windows quick actions when Windows sharing is ready', () => {
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        shareAddress: '\\\\STUDIO-PC\\LynavoDrive',
        shareStatus: 'ready',
      },
      shareStatusInfo: {
        ...useSettingsStore.getState().shareStatusInfo,
        enabled: true,
        smbUrl: '\\\\STUDIO-PC\\LynavoDrive',
        status: 'ready',
      },
    });

    render(<ShareAddressSection />);

    expect(screen.getByText('Sharing is ready')).toBeInTheDocument();
    expect(screen.queryByText('Windows quick setup')).not.toBeInTheDocument();
  });
});
