import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SidecarEvent } from '@lynavo-drive/contracts';
import { useAppStore } from '@renderer/stores/app-store';
import { useDirectoryStore } from '@renderer/stores/directory-store';
import { useSettingsStore } from '@renderer/stores/settings-store';
import { useSidecarRuntimeStore } from '@renderer/stores/sidecar-runtime-store';
import { mockSettings } from '@renderer/mocks/settings';
import { installScrollbarActivityTracker } from '@renderer/hooks/scrollbar-activity';
import i18n from '@renderer/i18n';
import { INITIAL_SIDECAR_RUNTIME_STATE } from '../../../../shared/sidecar-runtime';
import { AppShell, getTopActionsRight } from '../AppShell';

vi.mock('../Sidebar', () => ({
  Sidebar: () => <aside data-testid="sidebar" />,
}));

vi.mock('../SidecarStatusBanner', () => ({
  SidecarStatusBanner: () => <div data-testid="sidecar-status-banner" />,
}));

vi.mock('@renderer/features/dashboard/Dashboard', () => ({
  Dashboard: () => <main>DashboardPage</main>,
}));

vi.mock('@renderer/features/settings/SettingsPage', () => ({
  SettingsPage: () => <main>SettingsPage</main>,
}));

vi.mock('@renderer/features/help/HelpDialog', () => ({
  HelpDialog: () => <div data-testid="help-dialog">HelpDialog</div>,
}));

vi.mock('@renderer/features/device-detail/DeviceDetailPage', () => ({
  DeviceDetailPage: () => <main>DeviceDetailPage</main>,
}));

vi.mock('@renderer/features/devices/DevicesPage', () => ({
  DevicesPage: () => <main>DevicesPage</main>,
}));

vi.mock('@renderer/features/records/RecordsPage', () => ({
  RecordsPage: () => <main>RecordsPage</main>,
}));

vi.mock('@renderer/features/shared/SharedResourcesPage', () => ({
  SharedResourcesPage: () => <main>SharedResourcesPage</main>,
}));

vi.mock('@renderer/features/library/ReceivedLibraryPage', () => ({
  ReceivedLibraryPage: () => <main>ReceivedLibraryPage</main>,
}));

vi.mock('@renderer/features/directory/DirectoryPage', () => ({
  DirectoryPage: () => <main data-testid="directory-page">DirectoryPage</main>,
}));

vi.mock('@renderer/hooks/scrollbar-activity', () => ({
  installScrollbarActivityTracker: vi.fn(() => vi.fn()),
}));

function installElectronAPI(
  _session: unknown = null,
  platform: Partial<Window['electronAPI']['platform']> = {},
) {
  let sidecarEventCallback: ((event: SidecarEvent) => void) | null = null;
  const openExternal = vi.fn().mockResolvedValue(undefined);
  const onSidecarEvent = vi.fn((callback: (event: SidecarEvent) => void) => {
    sidecarEventCallback = callback;
    return vi.fn();
  });
  const onSidecarRuntimeState = vi.fn(() => vi.fn());

  (window as Window & { electronAPI?: unknown }).electronAPI = {
    sidecar: {
      getRuntimeState: vi.fn().mockResolvedValue({
        ...INITIAL_SIDECAR_RUNTIME_STATE,
        status: 'healthy',
        messageCode: null,
      }),
      getSettings: vi.fn().mockResolvedValue(mockSettings),
      getDashboardSummary: vi.fn().mockResolvedValue({
        todayUploadCount: 0,
        todayOccupiedBytes: 0,
        remainingBytes: 0,
        isDiskLow: false,
      }),
      getDashboardDevices: vi.fn().mockResolvedValue([]),
      setConnectionCode: vi.fn().mockResolvedValue({ code: mockSettings.connectionCode }),
    },
    events: {
      onSidecarEvent,
      onSidecarRuntimeState,
    },
    platform: {
      isMac: vi.fn(() => true),
      isWindows: vi.fn(() => false),
      usesTitleBarOverlayControls: vi.fn(() => false),
      setModalOverlayActive: vi.fn().mockResolvedValue(undefined),
      getHomeDir: vi.fn(() => '/Users/ada'),
      getHostName: vi.fn(() => 'Ada-MacBook-Pro'),
      getLocalIPs: vi.fn(() => ['192.168.1.10']),
      ...platform,
    },
    files: {
      openExternal,
    },
  } as unknown as Window['electronAPI'];

  return {
    emitSidecarEvent(event: SidecarEvent) {
      if (!sidecarEventCallback) {
        throw new Error('AppShell did not subscribe to sidecar events');
      }
      sidecarEventCallback(event);
    },
    onSidecarEvent,
    onSidecarRuntimeState,
    openExternal,
  };
}

async function completeConnectionCodeSetup() {
  fireEvent.click(await screen.findByRole('button', { name: 'Save and enter Lynavo Drive' }));
  await waitFor(() => {
    expect(screen.queryByRole('heading', { name: 'Set pairing code' })).not.toBeInTheDocument();
  });
}

describe('AppShell', () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, 'electronAPI');
    delete process.env.LYNAVO_DEV_SKIP_AUTH;
    delete process.env.LYNAVO_DEV_SKIP_AUTH_EMAIL;
    useAppStore.setState({
      currentView: 'dashboard',
      selectedDevice: null,
      isModalOpen: false,
      isHelpOpen: false,
    });
    useSidecarRuntimeStore.setState({ runtime: INITIAL_SIDECAR_RUNTIME_STATE });
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
    vi.restoreAllMocks();
    vi.mocked(installScrollbarActivityTracker).mockClear();
    vi.mocked(installScrollbarActivityTracker).mockReturnValue(vi.fn());
  });

  it('renders the local desktop shell instead of the full-page login screen when not authenticated', async () => {
    const { onSidecarEvent } = installElectronAPI(null);

    render(<AppShell />);

    await completeConnectionCodeSetup();

    expect(screen.queryByRole('heading', { name: 'Login' })).not.toBeInTheDocument();
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(await screen.findByText('DashboardPage')).toBeInTheDocument();
    expect(onSidecarEvent).toHaveBeenCalled();
  });

  it('subscribes to sidecar runtime updates while running as a local guest', async () => {
    const { onSidecarEvent, onSidecarRuntimeState } = installElectronAPI(null);

    render(<AppShell />);

    await waitFor(() => {
      expect(window.electronAPI?.sidecar.getRuntimeState).toHaveBeenCalledTimes(1);
    });

    expect(onSidecarRuntimeState).toHaveBeenCalledTimes(1);
    expect(onSidecarEvent).toHaveBeenCalledTimes(1);
  });

  it('does not bootstrap official auth before showing local pairing setup', async () => {
    installElectronAPI();

    render(<AppShell />);

    expect(await screen.findByRole('heading', { name: 'Set pairing code' })).toBeInTheDocument();
    expect(window.electronAPI).not.toHaveProperty('auth');
  });

  it('ignores dev skip-auth for official auth while keeping local pairing setup available', async () => {
    process.env.LYNAVO_DEV_SKIP_AUTH = '1';
    process.env.LYNAVO_DEV_SKIP_AUTH_EMAIL = 'functional@example.com';
    const { onSidecarEvent } = installElectronAPI(null);

    render(<AppShell />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Set pairing code' })).toBeInTheDocument();
    });
    expect(onSidecarEvent).toHaveBeenCalled();
  });

  it('installs the scrollbar activity tracker for the shell lifetime', async () => {
    const cleanup = vi.fn();
    vi.mocked(installScrollbarActivityTracker).mockReturnValue(cleanup);
    installElectronAPI();

    const { unmount } = render(<AppShell />);

    await completeConnectionCodeSetup();
    expect(await screen.findByTestId('sidebar')).toBeInTheDocument();
    expect(installScrollbarActivityTracker).toHaveBeenCalledTimes(1);

    unmount();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('renders the connection code setup page before the desktop shell', async () => {
    installElectronAPI(null);

    const { container } = render(<AppShell />);

    expect(await screen.findByRole('heading', { name: 'Set pairing code' })).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass('lynavo-window-drag-region');
    expect(
      screen.getByRole('heading', { name: 'Set pairing code' }).closest('section'),
    ).toHaveClass('lynavo-window-no-drag-region');
    expect(screen.getByDisplayValue(mockSettings.connectionCode)).toBeInTheDocument();
    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();
    expect(screen.queryByText('DashboardPage')).not.toBeInTheDocument();
  });

  it('allows changing language on the connection code setup page before entering the shell', async () => {
    installElectronAPI();

    render(<AppShell />);

    expect(await screen.findByRole('heading', { name: 'Set pairing code' })).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Interface language' }), {
      target: { value: 'zh-Hant' },
    });

    const zhHant = i18n.getFixedT('zh-Hant');
    expect(
      await screen.findByRole('heading', { name: zhHant('layout.connectionSetup.title') }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: zhHant('layout.connectionSetup.saveAndEnter') }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(zhHant('layout.connectionSetup.steps.download.title')),
    ).toBeInTheDocument();
  });

  it('saves the connection code setup before entering the dashboard', async () => {
    window.confirm = vi.fn().mockReturnValue(true);
    installElectronAPI();

    render(<AppShell />);

    fireEvent.change(await screen.findByLabelText('Pairing code'), {
      target: { value: '238416' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save and enter Lynavo Drive' }));

    await waitFor(() => {
      expect(window.electronAPI?.sidecar.setConnectionCode).toHaveBeenCalledWith('238416');
    });
    expect(window.confirm).toHaveBeenCalledWith(
      'Changing the pairing code will invalidate all currently paired phones. They will need to pair again with the new code. Continue?',
    );
    expect(await screen.findByTestId('sidebar')).toBeInTheDocument();
    expect(await screen.findByText('DashboardPage')).toBeInTheDocument();
  });

  it('stays on setup when connection code change confirmation is declined', async () => {
    window.confirm = vi.fn().mockReturnValue(false);
    installElectronAPI();

    render(<AppShell />);

    fireEvent.change(await screen.findByLabelText('Pairing code'), {
      target: { value: '238416' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save and enter Lynavo Drive' }));

    expect(window.confirm).toHaveBeenCalledWith(
      'Changing the pairing code will invalidate all currently paired phones. They will need to pair again with the new code. Continue?',
    );
    expect(window.electronAPI?.sidecar.setConnectionCode).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Set pairing code' })).toBeInTheDocument();
    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();
  });

  it('enters the dashboard without revoking pairings when the connection code is unchanged', async () => {
    window.confirm = vi.fn();
    installElectronAPI();

    render(<AppShell />);

    fireEvent.click(await screen.findByRole('button', { name: 'Save and enter Lynavo Drive' }));

    expect(await screen.findByTestId('sidebar')).toBeInTheDocument();
    expect(await screen.findByText('DashboardPage')).toBeInTheDocument();
    expect(window.electronAPI?.sidecar.setConnectionCode).not.toHaveBeenCalled();
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it.each([
    ['shared', 'SharedResourcesPage'],
    ['library', 'ReceivedLibraryPage'],
    ['devices', 'DevicesPage'],
    ['records', 'RecordsPage'],
  ] as const)('renders the %s page', async (view, pageText) => {
    installElectronAPI();
    useAppStore.setState({ currentView: view });

    render(<AppShell />);

    await completeConnectionCodeSetup();
    expect(screen.getByTestId('global-window-drag-strip')).toHaveClass('lynavo-window-drag-region');
    expect(await screen.findByText(pageText)).toBeInTheDocument();
  });

  it('does not refresh the directory store when shared.directory.changed arrives', async () => {
    const fetchSharedFiles = vi
      .spyOn(useDirectoryStore.getState(), 'fetchSharedFiles')
      .mockResolvedValue();
    const { emitSidecarEvent } = installElectronAPI();

    render(<AppShell />);

    await waitFor(() => {
      expect(window.electronAPI?.events.onSidecarEvent).toHaveBeenCalledTimes(1);
    });
    emitSidecarEvent({ type: 'shared.directory.changed', payload: { path: '/tmp/shared' } });

    expect(fetchSharedFiles).not.toHaveBeenCalled();
  });

  it('does not load the directory page for desktop-local management views', async () => {
    installElectronAPI();
    useAppStore.setState({ currentView: 'devices' });

    render(<AppShell />);

    await completeConnectionCodeSetup();
    expect(screen.queryByTestId('directory-page')).not.toBeInTheDocument();
  });

  it('opens help dialog when clicking help button', async () => {
    installElectronAPI();
    const setHelpOpenSpy = vi.spyOn(useAppStore.getState(), 'setHelpOpen');

    render(<AppShell />);

    await completeConnectionCodeSetup();
    const helpButton = await screen.findByRole('button', {
      name: /Help|layout\.nav\.help/i,
    });
    helpButton.click();

    expect(setHelpOpenSpy).toHaveBeenCalledWith(true);
  });

  it('updates the non-macOS title bar overlay while the help dialog is open', async () => {
    installElectronAPI(undefined, {
      isMac: vi.fn(() => false),
      isWindows: vi.fn(() => true),
      usesTitleBarOverlayControls: vi.fn(() => true),
      setModalOverlayActive: vi.fn().mockResolvedValue(undefined),
    });

    render(<AppShell />);

    await completeConnectionCodeSetup();
    expect(window.electronAPI?.platform.setModalOverlayActive).toHaveBeenLastCalledWith(false);

    fireEvent.click(await screen.findByRole('button', { name: /Help|layout\.nav\.help/i }));

    await waitFor(() => {
      expect(window.electronAPI?.platform.setModalOverlayActive).toHaveBeenLastCalledWith(true);
    });
  });

  it('opens the mobile download QR panel from the top action', async () => {
    installElectronAPI();

    render(<AppShell />);

    await completeConnectionCodeSetup();
    fireEvent.click(await screen.findByRole('button', { name: 'Download mobile app' }));

    expect(screen.getByText('Scan to download mobile app')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'iOS' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Android' })).toBeInTheDocument();
  });

  it('opens OSS repository links from setup and the QR panel', async () => {
    const { openExternal } = installElectronAPI();

    render(<AppShell />);

    fireEvent.click(await screen.findByRole('button', { name: 'iOS download QR code' }));
    expect(openExternal).toHaveBeenLastCalledWith('https://github.com/lynavo/lynavo-drive');

    await completeConnectionCodeSetup();
    fireEvent.click(await screen.findByRole('button', { name: 'Download mobile app' }));
    fireEvent.click(screen.getByRole('button', { name: 'Android' }));

    expect(openExternal).toHaveBeenLastCalledWith('https://github.com/lynavo/lynavo-drive');
    expect(openExternal).not.toHaveBeenCalledWith(expect.stringContaining('unexpected.example'));
  });

  it('keeps top actions clear of non-macOS native caption buttons', async () => {
    expect(getTopActionsRight(true)).toBe(
      'calc(100vw - env(titlebar-area-width, calc(100vw - 128px)) + 10px)',
    );
    expect(getTopActionsRight(false)).toBe(28);

    installElectronAPI(undefined, {
      isMac: vi.fn(() => false),
      isWindows: vi.fn(() => false),
      usesTitleBarOverlayControls: vi.fn(() => true),
    });

    render(<AppShell />);

    await completeConnectionCodeSetup();
    expect(await screen.findByTestId('global-top-actions')).toBeInTheDocument();
  });
});
