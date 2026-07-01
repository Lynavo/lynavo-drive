import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { INITIAL_SIDECAR_RUNTIME_STATE } from '../../../../shared/sidecar-runtime';
import { useSettingsStore } from '@renderer/stores/settings-store';
import { useSidecarRuntimeStore } from '@renderer/stores/sidecar-runtime-store';
import { ConnectionCodeSection } from '../ConnectionCodeSection';

function installElectronAPI() {
  (window as Window & { electronAPI?: unknown }).electronAPI = {
    platform: {
      getHostName: vi.fn(() => 'Studio-PC'),
      getLocalIPs: vi.fn(() => ['192.168.0.227']),
    },
    sidecar: {
      regenerateConnectionCode: vi.fn().mockResolvedValue({ code: '112233' }),
    },
  } as unknown as Window['electronAPI'];
}

describe('ConnectionCodeSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installElectronAPI();
    useSidecarRuntimeStore.setState({ runtime: INITIAL_SIDECAR_RUNTIME_STATE });
    useSettingsStore.setState({
      settings: {
        deviceName: 'Studio PC',
        connectionCode: '998877',
        rootPath: '',
        receivePath: '',
        personalPath: '',
        sharedPath: '',
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

  it('confirms before regenerating the connection code from settings', async () => {
    window.confirm = vi.fn().mockReturnValue(true);

    render(<ConnectionCodeSection />);

    fireEvent.click(screen.getByRole('button', { name: '重新生成' }));

    expect(window.confirm).toHaveBeenCalledWith(
      '修改配对码会中断当前已配对的手机，所有手机需使用新配对码重新配对。要继续吗？',
    );
    await waitFor(() => {
      expect(window.electronAPI?.sidecar.regenerateConnectionCode).toHaveBeenCalled();
    });
    expect(useSettingsStore.getState().settings.connectionCode).toBe('112233');
  });

  it('cancels settings connection code regeneration when confirmation is declined', () => {
    window.confirm = vi.fn().mockReturnValue(false);

    render(<ConnectionCodeSection />);

    fireEvent.click(screen.getByRole('button', { name: '重新生成' }));

    expect(window.confirm).toHaveBeenCalledWith(
      '修改配对码会中断当前已配对的手机，所有手机需使用新配对码重新配对。要继续吗？',
    );
    expect(window.electronAPI?.sidecar.regenerateConnectionCode).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().settings.connectionCode).toBe('998877');
  });
});
