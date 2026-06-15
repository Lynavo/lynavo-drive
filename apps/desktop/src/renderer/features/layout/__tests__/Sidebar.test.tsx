import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthSessionView } from '../../../../preload/api';
import { useAppStore } from '@renderer/stores/app-store';
import { useAuthStore } from '@renderer/stores/auth-store';
import { Sidebar } from '../Sidebar';

vi.mock('@renderer/components/shared/LoginDialog', () => ({
  LoginDialog: ({
    open,
    title,
    description,
  }: {
    open: boolean;
    title?: string;
    description?: string;
  }) =>
    open ? (
      <div data-testid="login-dialog">
        <p>{title}</p>
        <p>{description}</p>
      </div>
    ) : null,
}));

function setAuthSession(session: AuthSessionView | null) {
  const getAuthSession = vi.fn().mockResolvedValue(session);
  const logout = vi.fn().mockResolvedValue({ ok: true });
  (window as Window & { electronAPI?: unknown }).electronAPI = {
    auth: {
      getAuthSession,
      logout,
    },
  } as unknown as Window['electronAPI'];
  return { getAuthSession, logout };
}

describe('Sidebar', () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, 'electronAPI');
    useAuthStore.setState({ session: null, loading: false });
    useAppStore.setState({
      currentView: 'dashboard',
      selectedDevice: null,
      isModalOpen: false,
    });
  });

  it('shows a sign-in entry when the desktop is not authenticated', async () => {
    const { getAuthSession } = setAuthSession(null);

    render(<Sidebar />);

    await waitFor(() => {
      expect(screen.getByText('登录后可使用远端传输。')).toBeInTheDocument();
    });
    expect(getAuthSession).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '登录' })).toBeInTheDocument();
  });

  it('opens the login dialog from the sign-in entry', async () => {
    setAuthSession(null);

    render(<Sidebar />);

    fireEvent.click(await screen.findByRole('button', { name: '登录' }));

    expect(screen.getByTestId('login-dialog')).toBeInTheDocument();
    expect(screen.getAllByText('登录后可使用远端传输。')).toHaveLength(2);
  });

  it('shows the authenticated account instead of the sign-in prompt', async () => {
    setAuthSession({ loggedIn: true, phone: '+8613800138000' });

    render(<Sidebar />);

    await waitFor(() => {
      expect(screen.getByText('已登录')).toBeInTheDocument();
    });
    expect(screen.getByText('+8613800138000')).toBeInTheDocument();
    expect(screen.queryByText('登录后可使用远端传输。')).not.toBeInTheDocument();
  });

  it('shows the authenticated email when it is available', async () => {
    setAuthSession({ loggedIn: true, email: 'ada@example.com' });

    render(<Sidebar />);

    expect(await screen.findByText('ada@example.com')).toBeInTheDocument();
    expect(screen.queryByText('登录后可使用远端传输。')).not.toBeInTheDocument();
  });

  it('shows the authenticated account label when it is provided by the session view', async () => {
    setAuthSession({ loggedIn: true, accountLabel: 'ada@example.com' });

    render(<Sidebar />);

    expect(await screen.findByText('ada@example.com')).toBeInTheDocument();
    expect(screen.queryByText('登录后可使用远端传输。')).not.toBeInTheDocument();
  });

  it('does not repeat the signed-in label when the session has no account identifier', async () => {
    setAuthSession({ loggedIn: true });

    render(<Sidebar />);

    expect(await screen.findByText('账号已连接')).toBeInTheDocument();
    expect(screen.getAllByText('已登录')).toHaveLength(1);
  });

  it('signs out from the authenticated account card', async () => {
    const { logout } = setAuthSession({ loggedIn: true, phone: '+8613800138000' });

    render(<Sidebar />);

    fireEvent.click(await screen.findByRole('button', { name: '登出' }));

    await waitFor(() => {
      expect(logout).toHaveBeenCalledTimes(1);
    });
  });

  it('exposes the desktop-local navigation entries and hides legacy folder management', async () => {
    setAuthSession(null);

    render(<Sidebar />);

    expect(screen.getByRole('button', { name: '首页看板' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '设备' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '共享' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '资料库' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '记录' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '全局设置' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '帮助' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '目录管理' })).not.toBeInTheDocument();
  });

  it('switches to each desktop-local view from the sidebar', async () => {
    setAuthSession(null);

    render(<Sidebar />);

    fireEvent.click(screen.getByRole('button', { name: '设备' }));
    expect(useAppStore.getState().currentView).toBe('devices');

    fireEvent.click(screen.getByRole('button', { name: '共享' }));
    expect(useAppStore.getState().currentView).toBe('shared');

    fireEvent.click(screen.getByRole('button', { name: '资料库' }));
    expect(useAppStore.getState().currentView).toBe('library');

    fireEvent.click(screen.getByRole('button', { name: '记录' }));
    expect(useAppStore.getState().currentView).toBe('records');
  });
});
