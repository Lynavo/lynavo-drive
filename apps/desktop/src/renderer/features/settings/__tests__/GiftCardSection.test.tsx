import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GiftCardSection } from '../GiftCardSection';
import { useAuthStore } from '@renderer/stores/auth-store';

const toastFns = vi.hoisted(() => ({
  error: vi.fn(),
  message: vi.fn(),
  success: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    error: toastFns.error,
    message: toastFns.message,
    success: toastFns.success,
  },
}));

function setElectronAPI(
  redeemGiftCard?: ReturnType<typeof vi.fn>,
  auth?: {
    sendSMSCode?: ReturnType<typeof vi.fn>;
    loginWithSMSCode?: ReturnType<typeof vi.fn>;
    getAuthSession?: ReturnType<typeof vi.fn>;
    logout?: ReturnType<typeof vi.fn>;
  },
) {
  (window as Window & { electronAPI?: unknown }).electronAPI = {
    sidecar: redeemGiftCard
      ? {
          redeemGiftCard,
        }
      : {},
    auth: auth
      ? {
          getAuthSession: vi.fn().mockResolvedValue(null),
          logout: vi.fn().mockResolvedValue({ ok: true }),
          ...auth,
        }
      : undefined,
  } as unknown as Window['electronAPI'];
}

describe('GiftCardSection', () => {
  beforeEach(() => {
    toastFns.error.mockReset();
    toastFns.message.mockReset();
    toastFns.success.mockReset();
    Reflect.deleteProperty(window, 'electronAPI');
    useAuthStore.setState({ session: null, loading: false });
  });

  it('disables redeem when the code is blank', () => {
    render(<GiftCardSection />);

    expect(screen.getByRole('button', { name: '兑换' })).toBeDisabled();
  });

  it('shows an unavailable error when the sidecar API is missing', () => {
    render(<GiftCardSection />);

    fireEvent.change(screen.getByLabelText('礼品卡编号'), {
      target: { value: '  ABCD-EFGH-IJKL  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: '兑换' }));

    expect(toastFns.error).toHaveBeenCalledWith('目前无法使用礼品卡兑换服务');
  });

  it('submits a trimmed code and shows success feedback', async () => {
    const redeemGiftCard = vi.fn().mockResolvedValue({ ok: true, message: 'done' });
    setElectronAPI(redeemGiftCard);

    render(<GiftCardSection />);

    fireEvent.change(screen.getByLabelText('礼品卡编号'), {
      target: { value: '  ABCD-EFGH-IJKL  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: '兑换' }));

    await waitFor(() => {
      expect(redeemGiftCard).toHaveBeenCalledWith({ code: 'ABCD-EFGH-IJKL' });
    });
    expect(toastFns.success).toHaveBeenCalledWith('礼品卡兑换成功');
    expect(screen.getByLabelText('礼品卡编号')).toHaveValue('');
    expect(screen.getByText('done')).toBeInTheDocument();
  });

  it('shows the server error when redeem fails', async () => {
    const redeemGiftCard = vi.fn().mockResolvedValue({ ok: false, message: 'bad code' });
    setElectronAPI(redeemGiftCard);

    render(<GiftCardSection />);

    fireEvent.change(screen.getByLabelText('礼品卡编号'), {
      target: { value: 'ABCD-EFGH-IJKL' },
    });
    fireEvent.click(screen.getByRole('button', { name: '兑换' }));

    await waitFor(() => {
      expect(screen.getByText('bad code')).toBeInTheDocument();
    });
    expect(toastFns.error).toHaveBeenCalledWith('bad code');
  });

  it('shows localized already-redeemed guidance when the same account redeems again', async () => {
    const redeemGiftCard = vi.fn().mockResolvedValue({
      ok: false,
      reason: 'already_redeemed',
      message: '此帳號已兌換過此禮品卡',
    });
    setElectronAPI(redeemGiftCard);

    render(<GiftCardSection />);

    fireEvent.change(screen.getByLabelText('礼品卡编号'), {
      target: { value: 'ABCD-EFGH-IJKL' },
    });
    fireEvent.click(screen.getByRole('button', { name: '兑换' }));

    const message = '此账号已兑换过此礼品卡';
    await waitFor(() => {
      expect(screen.getByText(message)).toBeInTheDocument();
    });
    expect(toastFns.error).toHaveBeenCalledWith(message);
  });

  it('shows localized invalid-code guidance instead of the server message', async () => {
    const redeemGiftCard = vi.fn().mockResolvedValue({
      ok: false,
      reason: 'invalid_code',
      message: '禮品卡碼無效',
    });
    setElectronAPI(redeemGiftCard);

    render(<GiftCardSection />);

    fireEvent.change(screen.getByLabelText('礼品卡编号'), {
      target: { value: 'ABCD-EFGH-IJKL' },
    });
    fireEvent.click(screen.getByRole('button', { name: '兑换' }));

    const message = '请输入有效的礼品卡编号';
    await waitFor(() => {
      expect(screen.getByText(message)).toBeInTheDocument();
    });
    expect(toastFns.error).toHaveBeenCalledWith(message);
    expect(screen.queryByText('禮品卡碼無效')).not.toBeInTheDocument();
  });

  it('shows auth guidance when redeem requires a signed-in user token', async () => {
    const redeemGiftCard = vi.fn().mockResolvedValue({ ok: false, reason: 'auth_required' });
    setElectronAPI(redeemGiftCard);

    render(<GiftCardSection />);

    fireEvent.change(screen.getByLabelText('礼品卡编号'), {
      target: { value: 'ABCD-EFGH-IJKL' },
    });
    fireEvent.click(screen.getByRole('button', { name: '兑换' }));

    const message = '请先用手机号登入后继续兑换礼品卡。';
    await waitFor(() => {
      expect(screen.getByText(message)).toBeInTheDocument();
    });
    expect(toastFns.error).toHaveBeenCalledWith(message);
  });

  it('opens phone login and retries redeem after login succeeds', async () => {
    const redeemGiftCard = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, reason: 'auth_required' })
      .mockResolvedValueOnce({ ok: true, message: 'done' });
    const sendSMSCode = vi.fn().mockResolvedValue({ ok: true });
    const loginWithSMSCode = vi.fn().mockResolvedValue({ ok: true });
    setElectronAPI(redeemGiftCard, { sendSMSCode, loginWithSMSCode });

    render(<GiftCardSection />);

    fireEvent.change(screen.getByLabelText('礼品卡编号'), {
      target: { value: 'ABCD-EFGH-IJKL' },
    });
    fireEvent.click(screen.getByRole('button', { name: '兑换' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('手机号'), {
      target: { value: '13800138000' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送验证码' }));

    await waitFor(() => {
      expect(sendSMSCode).toHaveBeenCalledWith({ phone: '+8613800138000' });
    });

    fireEvent.change(screen.getByLabelText('验证码'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: '登入' }));

    await waitFor(() => {
      expect(loginWithSMSCode).toHaveBeenCalledWith({
        phone: '+8613800138000',
        code: '123456',
      });
      expect(redeemGiftCard).toHaveBeenCalledTimes(2);
    });
    expect(redeemGiftCard).toHaveBeenLastCalledWith({ code: 'ABCD-EFGH-IJKL' });
    expect(screen.getByText('done')).toBeInTheDocument();
  });

  it('shows localized SMS throttling guidance instead of the server message', async () => {
    const redeemGiftCard = vi.fn().mockResolvedValue({ ok: false, reason: 'auth_required' });
    const sendSMSCode = vi.fn().mockResolvedValue({
      ok: false,
      reason: 'sms_too_frequent',
      message: '驗證碼發送過於頻繁',
    });
    const loginWithSMSCode = vi.fn();
    setElectronAPI(redeemGiftCard, { sendSMSCode, loginWithSMSCode });

    render(<GiftCardSection />);

    fireEvent.change(screen.getByLabelText('礼品卡编号'), {
      target: { value: 'ABCD-EFGH-IJKL' },
    });
    fireEvent.click(screen.getByRole('button', { name: '兑换' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('手机号'), {
      target: { value: '13800138000' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送验证码' }));

    await waitFor(() => {
      expect(toastFns.error).toHaveBeenCalledWith('验证码发送过于频繁，请稍后再试');
    });
  });

  it('shows localized invalid SMS code guidance instead of the server message', async () => {
    const redeemGiftCard = vi.fn().mockResolvedValue({ ok: false, reason: 'auth_required' });
    const sendSMSCode = vi.fn();
    const loginWithSMSCode = vi.fn().mockResolvedValue({
      ok: false,
      reason: 'sms_code_invalid',
      message: '驗證碼錯誤',
    });
    setElectronAPI(redeemGiftCard, { sendSMSCode, loginWithSMSCode });

    render(<GiftCardSection />);

    fireEvent.change(screen.getByLabelText('礼品卡编号'), {
      target: { value: 'ABCD-EFGH-IJKL' },
    });
    fireEvent.click(screen.getByRole('button', { name: '兑换' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('手机号'), {
      target: { value: '13800138000' },
    });
    fireEvent.change(screen.getByLabelText('验证码'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: '登入' }));

    await waitFor(() => {
      expect(toastFns.error).toHaveBeenCalledWith('验证码错误，请重新输入');
    });
  });

  it('shows the thrown error detail and fallback toast', async () => {
    const redeemGiftCard = vi.fn().mockRejectedValue(new Error('offline'));
    setElectronAPI(redeemGiftCard);

    render(<GiftCardSection />);

    fireEvent.change(screen.getByLabelText('礼品卡编号'), {
      target: { value: 'ABCD-EFGH-IJKL' },
    });
    fireEvent.click(screen.getByRole('button', { name: '兑换' }));

    await waitFor(() => {
      expect(screen.getByText('offline')).toBeInTheDocument();
    });
    expect(toastFns.error).toHaveBeenCalledWith('礼品卡兑换失败', {
      description: 'offline',
    });
  });
});
