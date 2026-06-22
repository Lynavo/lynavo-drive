import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SidecarEvent } from '@syncflow/contracts';
import type { AuthSessionView } from '../../../../preload/api';
import { useAppStore } from '@renderer/stores/app-store';
import { useAuthStore } from '@renderer/stores/auth-store';
import { useDirectoryStore } from '@renderer/stores/directory-store';
import { useSettingsStore } from '@renderer/stores/settings-store';
import { useSidecarRuntimeStore } from '@renderer/stores/sidecar-runtime-store';
import { mockSettings } from '@renderer/mocks/settings';
import { INITIAL_SIDECAR_RUNTIME_STATE } from '../../../../shared/sidecar-runtime';
import { AppShell } from '../AppShell';

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
  DirectoryPage: () => <main data-testid="legacy-directory-page">DirectoryPage</main>,
}));

function installElectronAPI(
  session: AuthSessionView | null = { loggedIn: true, email: 'ada@example.com' },
  platform: Partial<Window['electronAPI']['platform']> = {},
) {
  let sidecarEventCallback: ((event: SidecarEvent) => void) | null = null;
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
    auth: {
      getAuthSession: vi.fn().mockResolvedValue(session),
      logout: vi.fn().mockResolvedValue({ ok: true }),
    },
    platform: {
      isMac: vi.fn(() => true),
      isWindows: vi.fn(() => false),
      usesTitleBarOverlayControls: vi.fn(() => false),
      getHomeDir: vi.fn(() => '/Users/ada'),
      getHostName: vi.fn(() => 'Ada-MacBook-Pro'),
      getLocalIPs: vi.fn(() => ['192.168.1.10']),
      ...platform,
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
  };
}

async function completeConnectionCodeSetup() {
  fireEvent.click(await screen.findByRole('button', { name: '保存并进入ViviDrop' }));
  await waitFor(() => {
    expect(screen.queryByRole('heading', { name: '设置连接码' })).not.toBeInTheDocument();
  });
}

describe('AppShell', () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, 'electronAPI');
    delete process.env.SYNCFLOW_DEV_SKIP_AUTH;
    delete process.env.SYNCFLOW_DEV_SKIP_AUTH_EMAIL;
    useAppStore.setState({
      currentView: 'dashboard',
      selectedDevice: null,
      isModalOpen: false,
      isHelpOpen: false,
    });
    useSidecarRuntimeStore.setState({ runtime: INITIAL_SIDECAR_RUNTIME_STATE });
    useAuthStore.setState({ session: null, loading: false });
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
  });

  it('renders the full-page login screen instead of the desktop shell when not authenticated', async () => {
    installElectronAPI(null);

    render(<AppShell />);

    expect(await screen.findByRole('heading', { name: '登录' })).toBeInTheDocument();
    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();
    expect(screen.queryByText('DashboardPage')).not.toBeInTheDocument();
  });

  it('uses the dev skip-auth session without calling the real auth bridge', async () => {
    process.env.SYNCFLOW_DEV_SKIP_AUTH = '1';
    process.env.SYNCFLOW_DEV_SKIP_AUTH_EMAIL = 'functional@example.com';
    const { onSidecarEvent } = installElectronAPI(null);
    const getAuthSession = window.electronAPI?.auth.getAuthSession as ReturnType<typeof vi.fn>;

    render(<AppShell />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '设置连接码' })).toBeInTheDocument();
    });
    expect(getAuthSession).not.toHaveBeenCalled();
    expect(onSidecarEvent).toHaveBeenCalled();
  });

  it('enters the desktop shell immediately when auth bypass is enabled for QA', async () => {
    installElectronAPI(undefined, {
      isAuthBypassEnabled: vi.fn(() => true),
    } as Partial<Window['electronAPI']['platform']>);

    render(<AppShell />);

    expect(await screen.findByTestId('sidebar')).toBeInTheDocument();
    expect(await screen.findByText('DashboardPage')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '设置连接码' })).not.toBeInTheDocument();
  });

  it('renders the connection code setup page after authentication before the desktop shell', async () => {
    installElectronAPI();

    render(<AppShell />);

    expect(await screen.findByRole('heading', { name: '设置连接码' })).toBeInTheDocument();
    expect(screen.getByDisplayValue(mockSettings.connectionCode)).toBeInTheDocument();
    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();
    expect(screen.queryByText('DashboardPage')).not.toBeInTheDocument();
  });

  it('saves the connection code setup before entering the dashboard', async () => {
    installElectronAPI();

    render(<AppShell />);

    fireEvent.change(await screen.findByLabelText('连接码'), {
      target: { value: '238416' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存并进入ViviDrop' }));

    await waitFor(() => {
      expect(window.electronAPI?.sidecar.setConnectionCode).toHaveBeenCalledWith('238416');
    });
    expect(await screen.findByTestId('sidebar')).toBeInTheDocument();
    expect(await screen.findByText('DashboardPage')).toBeInTheDocument();
  });

  it('enters the dashboard without revoking pairings when the connection code is unchanged', async () => {
    installElectronAPI();

    render(<AppShell />);

    fireEvent.click(await screen.findByRole('button', { name: '保存并进入ViviDrop' }));

    expect(await screen.findByTestId('sidebar')).toBeInTheDocument();
    expect(await screen.findByText('DashboardPage')).toBeInTheDocument();
    expect(window.electronAPI?.sidecar.setConnectionCode).not.toHaveBeenCalled();
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
    expect(await screen.findByText(pageText)).toBeInTheDocument();
  });

  it('does not refresh the legacy directory store when shared.directory.changed arrives', async () => {
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

  it('does not load the legacy directory page for desktop-local management views', async () => {
    installElectronAPI();
    useAppStore.setState({ currentView: 'devices' });

    render(<AppShell />);

    await completeConnectionCodeSetup();
    expect(screen.queryByTestId('legacy-directory-page')).not.toBeInTheDocument();
  });

  it('opens help dialog when clicking help button', async () => {
    installElectronAPI();
    const setHelpOpenSpy = vi.spyOn(useAppStore.getState(), 'setHelpOpen');

    render(<AppShell />);

    await completeConnectionCodeSetup();
    const helpButton = await screen.findByRole('button', {
      name: /帮助|幫助|layout\.nav\.help/i,
    });
    helpButton.click();

    expect(setHelpOpenSpy).toHaveBeenCalledWith(true);
  });

  it('opens the mobile download QR panel from the top action', async () => {
    installElectronAPI();

    render(<AppShell />);

    await completeConnectionCodeSetup();
    fireEvent.click(await screen.findByRole('button', { name: '下载移动端' }));

    expect(screen.getByText('扫码下载移动端')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'App Store' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Android' })).toBeInTheDocument();
  });

  it('keeps top actions clear of non-macOS native caption buttons', async () => {
    installElectronAPI(undefined, {
      isMac: vi.fn(() => false),
      isWindows: vi.fn(() => false),
      usesTitleBarOverlayControls: vi.fn(() => true),
    });

    render(<AppShell />);

    await completeConnectionCodeSetup();
    expect(await screen.findByTestId('global-top-actions')).toHaveStyle({ right: '154px' });
  });
});
