import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import i18n from '../../../i18n';
import { LoginDialog, resolveDefaultCountryCode } from '../LoginDialog';

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    message: vi.fn(),
    success: vi.fn(),
  },
}));

function setAuthAPI({
  sendSMSCode = vi.fn().mockResolvedValue({ ok: true }),
  loginWithSMSCode = vi.fn().mockResolvedValue({ ok: true }),
  loginWithOAuth = vi.fn().mockResolvedValue({ ok: true }),
  platform = {},
}: {
  sendSMSCode?: ReturnType<typeof vi.fn>;
  loginWithSMSCode?: ReturnType<typeof vi.fn>;
  loginWithOAuth?: ReturnType<typeof vi.fn>;
  platform?: Partial<Window['electronAPI']['platform']>;
} = {}) {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      auth: {
        sendSMSCode,
        loginWithSMSCode,
        loginWithOAuth,
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
    } as unknown as Window['electronAPI'],
  });

  return { sendSMSCode, loginWithSMSCode, loginWithOAuth };
}

function renderLoginDialog() {
  return render(<LoginDialog open onOpenChange={vi.fn()} onLoginSuccess={vi.fn()} />);
}

function agreeToLoginTerms() {
  fireEvent.click(screen.getByRole('checkbox', { name: /隐私政策|隱私政策/ }));
}

describe('resolveDefaultCountryCode', () => {
  it('keeps cn market fixed on +86', () => {
    expect(
      resolveDefaultCountryCode({
        isGlobal: false,
        language: 'zh-Hant',
        storedCountryCode: '+886',
      }),
    ).toBe('+86');
  });

  it('uses a remembered country code before locale inference', () => {
    expect(
      resolveDefaultCountryCode({
        isGlobal: true,
        language: 'en',
        storedCountryCode: '+81',
      }),
    ).toBe('+81');
  });

  it('infers conservative global defaults from locale candidates', () => {
    expect(resolveDefaultCountryCode({ isGlobal: true, language: 'zh-Hant' })).toBe('+886');
    expect(resolveDefaultCountryCode({ isGlobal: true, language: 'zh-Hans' })).toBe('+86');
    expect(
      resolveDefaultCountryCode({
        isGlobal: true,
        navigatorLanguages: ['ja-JP'],
      }),
    ).toBe('+81');
    expect(
      resolveDefaultCountryCode({
        isGlobal: true,
        navigatorLanguages: ['en-US'],
      }),
    ).toBe('+1');
    expect(resolveDefaultCountryCode({ isGlobal: true })).toBe('+86');
  });
});

describe('LoginDialog', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    window.localStorage.clear();
    setAuthAPI();
    await i18n.changeLanguage('zh-Hans');
  });

  it('renders global OAuth and phone labels through i18n', async () => {
    vi.stubEnv('SYNCFLOW_MARKET', 'global');
    await i18n.changeLanguage('zh-Hant');

    renderLoginDialog();

    expect(screen.getByText('登入或註冊')).toBeInTheDocument();
    expect(screen.getByText('登入後可使用遠端同步與帳號功能。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '使用 Google 繼續' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '使用 Apple 繼續' })).toBeInTheDocument();
    expect(screen.getByText('或')).toBeInTheDocument();
    expect(screen.getByLabelText('手機號碼')).toBeInTheDocument();
    expect(screen.getByLabelText('驗證碼')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /隱私政策/ })).toBeInTheDocument();
  });

  it('uses the reference login agreement gate before sending credentials', () => {
    const loginWithSMSCode = vi.fn().mockResolvedValue({ ok: true });
    setAuthAPI({ loginWithSMSCode });

    renderLoginDialog();

    fireEvent.change(screen.getByLabelText('手机号'), {
      target: { value: '13800138000' },
    });
    fireEvent.change(screen.getByLabelText('验证码'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: '登入' }));

    expect(loginWithSMSCode).not.toHaveBeenCalled();
    expect(screen.getByText('请先勾选同意隐私政策后再登录')).toBeInTheDocument();
  });

  it('uses the zh-Hant global default country code for SMS login', async () => {
    vi.stubEnv('SYNCFLOW_MARKET', 'global');
    await i18n.changeLanguage('zh-Hant');
    const loginWithSMSCode = vi.fn().mockResolvedValue({ ok: true });
    setAuthAPI({ loginWithSMSCode });

    renderLoginDialog();
    agreeToLoginTerms();

    fireEvent.change(screen.getByLabelText('手機號碼'), {
      target: { value: '0912-345-678' },
    });
    fireEvent.change(screen.getByLabelText('驗證碼'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: '登入' }));

    await waitFor(() => {
      expect(loginWithSMSCode).toHaveBeenCalledWith({
        phone: '+886912345678',
        code: '123456',
      });
    });
  });

  it('uses the remembered global country code for SMS login', async () => {
    vi.stubEnv('SYNCFLOW_MARKET', 'global');
    window.localStorage.setItem('syncflow.desktop.login.countryCode', '+81');
    const loginWithSMSCode = vi.fn().mockResolvedValue({ ok: true });
    setAuthAPI({ loginWithSMSCode });

    renderLoginDialog();
    agreeToLoginTerms();

    fireEvent.change(screen.getByLabelText('手机号'), {
      target: { value: '9012345678' },
    });
    fireEvent.change(screen.getByLabelText('验证码'), {
      target: { value: '654321' },
    });
    fireEvent.click(screen.getByRole('button', { name: '登入' }));

    await waitFor(() => {
      expect(loginWithSMSCode).toHaveBeenCalledWith({
        phone: '+819012345678',
        code: '654321',
      });
    });
  });

  it('shows the generic success message by default', async () => {
    const loginWithSMSCode = vi.fn().mockResolvedValue({ ok: true });
    setAuthAPI({ loginWithSMSCode });

    renderLoginDialog();
    agreeToLoginTerms();

    fireEvent.change(screen.getByLabelText('手机号'), {
      target: { value: '13800138000' },
    });
    fireEvent.change(screen.getByLabelText('验证码'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: '登入' }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('登入成功');
    });
    expect(toast.success).not.toHaveBeenCalledWith('登入成功，正在继续兑换');
  });

  it('uses a custom success message for contextual login flows', async () => {
    const loginWithSMSCode = vi.fn().mockResolvedValue({ ok: true });
    setAuthAPI({ loginWithSMSCode });

    render(
      <LoginDialog
        open
        onOpenChange={vi.fn()}
        onLoginSuccess={vi.fn()}
        successMessage="登入成功，正在继续兑换"
      />,
    );
    agreeToLoginTerms();

    fireEvent.change(screen.getByLabelText('手机号'), {
      target: { value: '13800138000' },
    });
    fireEvent.change(screen.getByLabelText('验证码'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: '登入' }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('登入成功，正在继续兑换');
    });
  });

  it('uses i18n for OAuth fallback errors', async () => {
    vi.stubEnv('SYNCFLOW_MARKET', 'global');
    await i18n.changeLanguage('zh-Hant');
    const loginWithOAuth = vi.fn().mockResolvedValue({ ok: false });
    setAuthAPI({ loginWithOAuth });

    renderLoginDialog();
    agreeToLoginTerms();

    fireEvent.click(screen.getByRole('button', { name: '使用 Google 繼續' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Google 登入失敗');
    });
  });

  it('hides Apple OAuth when the desktop platform does not support Apple auth', () => {
    vi.stubEnv('SYNCFLOW_MARKET', 'global');
    setAuthAPI({
      platform: {
        isMac: vi.fn(() => false),
        isWindows: vi.fn(() => false),
        supportsAppleAuth: vi.fn(() => false),
      },
    });

    renderLoginDialog();

    expect(screen.getByRole('button', { name: '使用 Google 继续' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '使用 Apple 继续' })).not.toBeInTheDocument();
  });

  it('hides Apple OAuth when platform capability detection is unavailable', () => {
    vi.stubEnv('SYNCFLOW_MARKET', 'global');
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        auth: {
          sendSMSCode: vi.fn().mockResolvedValue({ ok: true }),
          loginWithSMSCode: vi.fn().mockResolvedValue({ ok: true }),
          loginWithOAuth: vi.fn().mockResolvedValue({ ok: true }),
        },
      } as unknown as Window['electronAPI'],
    });

    renderLoginDialog();

    expect(screen.getByRole('button', { name: '使用 Google 继续' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '使用 Apple 继续' })).not.toBeInTheDocument();
  });
});
