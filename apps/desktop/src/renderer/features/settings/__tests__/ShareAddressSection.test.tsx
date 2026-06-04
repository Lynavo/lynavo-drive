import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ShareAddressSection } from '../ShareAddressSection';
import { useSettingsStore } from '@renderer/stores/settings-store';

function setElectronAPI() {
  (window as Window & { electronAPI?: unknown }).electronAPI = {
    platform: {
      isMac: () => false,
      isWindows: () => true,
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
});
