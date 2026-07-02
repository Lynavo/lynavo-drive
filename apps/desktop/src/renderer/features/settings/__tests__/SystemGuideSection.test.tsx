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
        receivePath: '/Users/alice/Lynavo Drive/received',
        personalPath: '/Users/alice/Lynavo Drive/personal',
        sharedPath: '/Users/alice/Lynavo Drive/shared',
        shareAddress: '',
        shareStatus: 'unknown',
        shareName: 'LynavoDrive',
      },
      validatingShare: false,
      copiedField: null,
    });
  });

  it('renders only the macOS file sharing guide on macOS', () => {
    render(<SystemGuideSection />);

    expect(screen.getByText('macOS File Sharing')).toBeInTheDocument();
    expect(screen.queryByText('Windows File Sharing')).not.toBeInTheDocument();
    expect(screen.queryByText('Linux File Sharing')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open advanced sharing/ })).not.toBeInTheDocument();
  });

  it('renders only Windows guidance and actions on Windows', () => {
    setElectronAPI({ isMac: false, isWindows: true, isLinux: false });

    render(<SystemGuideSection />);

    expect(screen.getByText('Windows File Sharing')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open advanced sharing/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open team shared folder/ })).toBeInTheDocument();
    expect(screen.queryByText('macOS File Sharing')).not.toBeInTheDocument();
    expect(screen.queryByText('Linux File Sharing')).not.toBeInTheDocument();
  });

  it('renders neutral Linux manual sharing guidance with an open folder action', () => {
    setElectronAPI({ isMac: false, isWindows: false, isLinux: true });

    render(<SystemGuideSection />);

    expect(screen.getByText('Linux File Sharing')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Configure Samba or file sharing in the system, then return to Lynavo Drive and check again.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open team shared folder/ })).toBeInTheDocument();
    expect(screen.queryByText('macOS File Sharing')).not.toBeInTheDocument();
    expect(screen.queryByText('Windows File Sharing')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open advanced sharing/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Open team shared folder/ }));

    expect(openFolder).toHaveBeenCalledWith('/Users/alice/Lynavo Drive/shared');
  });
});
