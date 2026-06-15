import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SidecarEvent } from '@syncflow/contracts';
import { useAppStore } from '@renderer/stores/app-store';
import { useDirectoryStore } from '@renderer/stores/directory-store';
import { useSidecarRuntimeStore } from '@renderer/stores/sidecar-runtime-store';
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

vi.mock('@renderer/features/help/HelpPage', () => ({
  HelpPage: () => <main>HelpPage</main>,
}));

vi.mock('@renderer/features/device-detail/DeviceDetailPage', () => ({
  DeviceDetailPage: () => <main>DeviceDetailPage</main>,
}));

vi.mock('@renderer/features/directory/DirectoryPage', () => ({
  DirectoryPage: () => <main data-testid="legacy-directory-page">DirectoryPage</main>,
}));

function installElectronAPI() {
  let sidecarEventCallback: ((event: SidecarEvent) => void) | null = null;
  const onSidecarEvent = vi.fn((callback: (event: SidecarEvent) => void) => {
    sidecarEventCallback = callback;
    return vi.fn();
  });
  const onSidecarRuntimeState = vi.fn(() => vi.fn());

  (window as Window & { electronAPI?: unknown }).electronAPI = {
    sidecar: {
      getRuntimeState: vi.fn().mockResolvedValue(INITIAL_SIDECAR_RUNTIME_STATE),
    },
    events: {
      onSidecarEvent,
      onSidecarRuntimeState,
    },
    auth: {
      getAuthSession: vi.fn().mockResolvedValue(null),
      logout: vi.fn().mockResolvedValue({ ok: true }),
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

describe('AppShell', () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, 'electronAPI');
    useAppStore.setState({
      currentView: 'dashboard',
      selectedDevice: null,
      isModalOpen: false,
    });
    useSidecarRuntimeStore.setState({ runtime: INITIAL_SIDECAR_RUNTIME_STATE });
    vi.restoreAllMocks();
  });

  it.each([
    ['devices', '设备管理', '已连接设备、授权状态与封锁名单将在这里集中管理。'],
    ['shared', '共享管理', '电脑端本机共享资源与访问范围将在这里配置。'],
    ['library', '资料库', '接收素材、归档位置与本机资料库状态将在这里汇总。'],
    ['records', '记录', '连接、授权、封锁与同步记录将在这里查询。'],
  ] as const)('renders the %s desktop-local placeholder', (view, title, description) => {
    installElectronAPI();
    useAppStore.setState({ currentView: view });

    render(<AppShell />);

    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getByText(description)).toBeInTheDocument();
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

  it('does not load the legacy directory page for desktop-local management views', () => {
    installElectronAPI();
    useAppStore.setState({ currentView: 'devices' });

    render(<AppShell />);

    expect(screen.queryByTestId('legacy-directory-page')).not.toBeInTheDocument();
  });
});
