import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPage } from '../AuthPage';

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

function installElectronAPI(platform: Partial<Window['electronAPI']['platform']> = {}) {
  (window as Window & { electronAPI?: unknown }).electronAPI = {
    auth: {
      loginWithOAuth: vi.fn().mockResolvedValue({ ok: true }),
      sendEmailCode: vi.fn().mockResolvedValue({ ok: true }),
      loginWithEmailCode: vi.fn().mockResolvedValue({ ok: true }),
    },
    platform: {
      isMac: vi.fn(() => true),
      isWindows: vi.fn(() => false),
      supportsAppleAuth: vi.fn(() => true),
      getHomeDir: vi.fn(() => '/Users/ada'),
      getHostName: vi.fn(() => 'Ada-MacBook-Pro'),
      getLocalIPs: vi.fn(() => ['192.168.1.10']),
      ...platform,
    },
  } as unknown as Window['electronAPI'];
}

describe('AuthPage', () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, 'electronAPI');
    vi.clearAllMocks();
  });

  it('keeps Apple sign-in available on macOS', () => {
    installElectronAPI();

    render(<AuthPage onAuthenticated={vi.fn()} />);

    expect(screen.getByRole('button', { name: '使用 Google 继续' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '使用 Apple 继续' })).toBeInTheDocument();
  });

  it('hides Apple sign-in when the desktop platform does not support Apple auth', () => {
    installElectronAPI({
      isMac: vi.fn(() => false),
      isWindows: vi.fn(() => false),
      supportsAppleAuth: vi.fn(() => false),
    });

    render(<AuthPage onAuthenticated={vi.fn()} />);

    expect(screen.getByRole('button', { name: '使用 Google 继续' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '使用 Apple 继续' })).not.toBeInTheDocument();
  });

  it('hides Apple sign-in when platform capability detection is unavailable', () => {
    (window as Window & { electronAPI?: unknown }).electronAPI = {
      auth: {
        loginWithOAuth: vi.fn().mockResolvedValue({ ok: true }),
        sendEmailCode: vi.fn().mockResolvedValue({ ok: true }),
        loginWithEmailCode: vi.fn().mockResolvedValue({ ok: true }),
      },
    } as unknown as Window['electronAPI'];

    render(<AuthPage onAuthenticated={vi.fn()} />);

    expect(screen.getByRole('button', { name: '使用 Google 继续' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '使用 Apple 继续' })).not.toBeInTheDocument();
  });
});
