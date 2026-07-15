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

  it('renders the page title "Me"', () => {
    render(<SettingsPage />);
    expect(screen.getByText('Me')).toBeInTheDocument();
  });

  it('renders the community local LAN section without account or membership CTAs', () => {
    render(<SettingsPage />);

    expect(screen.getByText('Open-source local sync')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Pair, discover, and sync automatically on the same LAN. No Lynavo cloud login is required.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('My account')).not.toBeInTheDocument();
    expect(screen.queryByText('test@unexpected.example')).not.toBeInTheDocument();
    expect(screen.queryByText('Membership status')).not.toBeInTheDocument();
    expect(screen.queryByText('Pro')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('renders the prevent sleep standby option', async () => {
    render(<SettingsPage />);
    expect(screen.getByText('Prevent sleep')).toBeInTheDocument();
    expect(
      screen.getByText('Keep the computer awake while transfer jobs are running'),
    ).toBeInTheDocument();

    const switchBtn = screen.getByRole('button', { name: 'Prevent sleep' });
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
        name: 'Allow paired phones to browse all received files',
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
        name: 'Allow paired phones to browse all received files',
      }),
    );

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to update received file browsing access');
    });
  });

  it('does not render the connection devices section in settings', async () => {
    render(<SettingsPage />);

    expect(screen.queryByText('Connected devices')).not.toBeInTheDocument();
    expect(screen.queryByTestId('connection-devices-section')).not.toBeInTheDocument();
  });

  it('does not import connection device management into settings', () => {
    const source = readFileSync(resolve(__dirname, '../SettingsPage.tsx'), 'utf8');

    expect(source).not.toContain('ConnectionDevicesSection');
  });

  it('opens a searchable language picker', () => {
    render(<SettingsPage />);

    fireEvent.click(screen.getByRole('button', { name: /Interface language/ }));

    const search = screen.getByRole('searchbox', { name: 'Search languages' });
    expect(search).toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'English' } });
    expect(screen.getAllByRole('button', { name: /English/ }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Traditional Chinese/ })).not.toBeInTheDocument();
  });

  it('renders the local IP', () => {
    render(<SettingsPage />);
    expect(screen.getByText('Local IP')).toBeInTheDocument();
    expect(screen.getByText('192.168.0.227')).toBeInTheDocument();
  });

  it('does not render desktop version polling controls', async () => {
    render(<SettingsPage />);

    expect(screen.queryByRole('button', { name: 'Check for updates' })).not.toBeInTheDocument();
    expect(screen.queryByText('Already on the latest version')).not.toBeInTheDocument();
  });

  it('renders the installed desktop version from app info', async () => {
    render(<SettingsPage />);

    expect(
      await screen.findByText('v1.0.1 (56) \u00b7 Current version installed'),
    ).toBeInTheDocument();
  });

  it('renders the product helper name in the version card', async () => {
    render(<SettingsPage />);

    expect(await screen.findByText('LynavoDriveDemo')).toBeInTheDocument();
    expect(screen.queryByText('Lynavo Drive Desktop')).not.toBeInTheDocument();
  });

  it('renders support section and exports diagnostics locally', async () => {
    render(<SettingsPage />);
    const exportBtn = screen.getByRole('button', { name: 'Export' });
    expect(exportBtn).toBeInTheDocument();

    fireEvent.click(exportBtn);

    // Dialog should be open, find the description textarea
    const textarea = screen.getByPlaceholderText(
      'Describe the steps, phone model, network environment, or error symptoms (optional)',
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
      expect(toast.success).toHaveBeenCalledWith('Diagnostics bundle exported', {
        description: '/tmp/lynavo-drive-diagnostics.zip',
      });
    });
  });

  it('opens feedback panel and sends a composed GitHub issue link', async () => {
    render(<SettingsPage />);
    await screen.findByText('v1.0.1 (56) \u00b7 Current version installed');

    fireEvent.click(screen.getByRole('button', { name: /Feedback/ }));
    fireEvent.change(
      screen.getByPlaceholderText('Describe the issue, steps, or improvements you want'),
      {
        target: { value: 'Phone cannot connect to the computer' },
      },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    const issueUrl = new URL(
      vi.mocked(window.electronAPI?.files.openExternal).mock.calls[0]?.[0] ?? '',
    );
    expect(issueUrl.href).toContain('https://github.com/lynavo/lynavo-drive/issues/new');
    expect(issueUrl.searchParams.get('title')).toBe('Lynavo Drive Desktop feedback v1.0.1 (56)');
    expect(issueUrl.searchParams.get('body')).toContain('Phone cannot connect to the computer');
    expect(issueUrl.searchParams.get('body')).toContain('Current version: v1.0.1 (56)');
  });
});
