import { useCallback, useState } from 'react';
import { Gift, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';

type RedeemResult = {
  ok: boolean;
  message?: string;
  reason?:
    | 'auth_required'
    | 'invalid_code'
    | 'expired'
    | 'not_available'
    | 'already_redeemed'
    | 'plan_mismatch';
};

type AuthResult = {
  ok: boolean;
  message?: string;
  reason?:
    | 'phone_invalid'
    | 'sms_too_frequent'
    | 'sms_send_failed'
    | 'sms_code_invalid'
    | 'sms_code_expired'
    | 'token_invalid'
    | 'sms_max_attempts'
    | 'session_replaced';
};

type ResultState = {
  kind: 'success' | 'error';
  text: string;
};

type RuntimeAuthAPI = Partial<Window['electronAPI']['auth']>;

function getRuntimeAuthAPI(): RuntimeAuthAPI | undefined {
  return (window as Window & { electronAPI?: Partial<Window['electronAPI']> }).electronAPI
    ?.auth as RuntimeAuthAPI | undefined;
}

function extractErrorText(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message || fallback;
  }
  if (typeof error === 'string') {
    return error || fallback;
  }
  return fallback;
}

function getRedeemErrorMessage(result: RedeemResult, t: (key: string) => string): string {
  switch (result.reason) {
    case 'auth_required':
      return t('errors.settings.redeemGiftCardAuthRequired');
    case 'invalid_code':
      return t('errors.settings.redeemGiftCardInvalidCode');
    case 'expired':
      return t('errors.settings.redeemGiftCardExpired');
    case 'not_available':
      return t('errors.settings.redeemGiftCardNotAvailable');
    case 'already_redeemed':
      return t('errors.settings.redeemGiftCardAlreadyRedeemed');
    case 'plan_mismatch':
      return t('errors.settings.redeemGiftCardPlanMismatch');
    default:
      return result.message || t('errors.settings.redeemGiftCardFailed');
  }
}

function getSMSSendErrorMessage(result: AuthResult, t: (key: string) => string): string {
  switch (result.reason) {
    case 'phone_invalid':
      return t('errors.settings.phoneInvalid');
    case 'sms_too_frequent':
      return t('errors.settings.smsTooFrequent');
    case 'sms_send_failed':
      return t('errors.settings.smsSendFailed');
    default:
      return result.message || t('errors.settings.sendSMSCodeFailed');
  }
}

function getSMSLoginErrorMessage(result: AuthResult, t: (key: string) => string): string {
  switch (result.reason) {
    case 'phone_invalid':
      return t('errors.settings.phoneInvalid');
    case 'sms_code_invalid':
      return t('errors.settings.smsCodeInvalid');
    case 'sms_code_expired':
      return t('errors.settings.smsCodeExpired');
    case 'sms_max_attempts':
      return t('errors.settings.smsMaxAttempts');
    case 'session_replaced':
      return t('errors.settings.sessionReplaced');
    default:
      return result.message || t('errors.settings.loginWithSMSCodeFailed');
  }
}

export function GiftCardSection() {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<ResultState | null>(null);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [pendingRedeemCode, setPendingRedeemCode] = useState('');
  const [phone, setPhone] = useState('');
  const [smsCode, setSMSCode] = useState('');
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const performRedeem = useCallback(async (trimmedCode: string, openLoginOnAuth: boolean) => {
    const api = window.electronAPI?.sidecar;
    if (!api?.redeemGiftCard) {
      toast.error(t('errors.settings.redeemGiftCardUnavailable'));
      return false;
    }

    setLastResult(null);

    try {
      const result: RedeemResult = await api.redeemGiftCard({ code: trimmedCode });
      if (result.ok) {
        setLastResult({
          kind: 'success',
          text: result.message || t('settings.giftCard.redeemSuccess'),
        });
        setCode('');
        toast.success(t('settings.giftCard.redeemSuccess'));
        return true;
      } else {
        if (
          result.reason === 'auth_required' &&
          openLoginOnAuth &&
          getRuntimeAuthAPI()?.loginWithSMSCode
        ) {
          setPendingRedeemCode(trimmedCode);
          setLoginDialogOpen(true);
          toast.message(t('settings.giftCard.phoneLogin.loginRequired'));
          return false;
        }

        const message = getRedeemErrorMessage(result, t);
        setLastResult({
          kind: 'error',
          text: message,
        });
        toast.error(message);
        return false;
      }
    } catch (error) {
      const message = extractErrorText(error, t('errors.settings.redeemGiftCardFailed'));
      setLastResult({
        kind: 'error',
        text: message,
      });
      toast.error(t('errors.settings.redeemGiftCardFailed'), {
        description: message,
      });
      return false;
    }
  }, [t]);

  const handleRedeem = useCallback(async () => {
    const trimmedCode = code.trim();
    if (!trimmedCode) {
      toast.error(t('errors.settings.redeemGiftCardInvalidCode'));
      return;
    }

    setIsSubmitting(true);
    try {
      await performRedeem(trimmedCode, true);
    } finally {
      setIsSubmitting(false);
    }
  }, [code, performRedeem, t]);

  const handleSendSMSCode = useCallback(async () => {
    const trimmedPhone = phone.trim();
    if (!trimmedPhone) {
      toast.error(t('errors.settings.phoneRequired'));
      return;
    }

    const auth = getRuntimeAuthAPI();
    if (!auth?.sendSMSCode) {
      toast.error(t('errors.settings.authUnavailable'));
      return;
    }

    setIsSendingCode(true);
    try {
      const result: AuthResult = await auth.sendSMSCode({ phone: trimmedPhone });
      if (result.ok) {
        toast.success(t('settings.giftCard.phoneLogin.codeSent'));
      } else {
        toast.error(getSMSSendErrorMessage(result, t));
      }
    } catch (error) {
      toast.error(t('errors.settings.sendSMSCodeFailed'), {
        description: extractErrorText(error, t('errors.settings.sendSMSCodeFailed')),
      });
    } finally {
      setIsSendingCode(false);
    }
  }, [phone, t]);

  const handleLoginAndRedeem = useCallback(async () => {
    const trimmedPhone = phone.trim();
    const trimmedSMSCode = smsCode.trim();
    if (!trimmedPhone) {
      toast.error(t('errors.settings.phoneRequired'));
      return;
    }
    if (!trimmedSMSCode) {
      toast.error(t('errors.settings.smsCodeRequired'));
      return;
    }

    const auth = getRuntimeAuthAPI();
    if (!auth?.loginWithSMSCode) {
      toast.error(t('errors.settings.authUnavailable'));
      return;
    }

    setIsLoggingIn(true);
    try {
      const loginResult: AuthResult = await auth.loginWithSMSCode({
        phone: trimmedPhone,
        code: trimmedSMSCode,
      });
      if (!loginResult.ok) {
        toast.error(getSMSLoginErrorMessage(loginResult, t));
        return;
      }

      toast.success(t('settings.giftCard.phoneLogin.loginSuccess'));
      setLoginDialogOpen(false);
      setSMSCode('');

      if (pendingRedeemCode) {
        setIsSubmitting(true);
        try {
          await performRedeem(pendingRedeemCode, false);
        } finally {
          setIsSubmitting(false);
        }
      }
    } catch (error) {
      toast.error(t('errors.settings.loginWithSMSCodeFailed'), {
        description: extractErrorText(error, t('errors.settings.loginWithSMSCodeFailed')),
      });
    } finally {
      setIsLoggingIn(false);
    }
  }, [pendingRedeemCode, performRedeem, phone, smsCode, t]);

  return (
    <>
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="mb-4 flex items-start gap-3">
          <div className="mt-0.5 rounded-lg bg-secondary p-2 text-muted-foreground">
            <Gift className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {t('settings.giftCard.title')}
            </h3>
            <p className="text-xs text-muted-foreground">{t('settings.giftCard.description')}</p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="gift-card-code">{t('settings.giftCard.codeLabel')}</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="gift-card-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder={t('settings.giftCard.placeholder')}
              disabled={isSubmitting}
              maxLength={64}
            />
            <Button
              type="button"
              onClick={() => void handleRedeem()}
              disabled={isSubmitting || code.trim().length === 0}
              className="w-full sm:w-auto"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t('settings.giftCard.redeem')
              )}
            </Button>
          </div>
        </div>

        {lastResult ? (
          <p
            className={`mt-3 rounded-md px-3 py-2 text-sm ${
              lastResult.kind === 'success'
                ? 'bg-emerald-500/10 text-emerald-600'
                : 'bg-destructive/10 text-destructive'
            }`}
          >
            {lastResult.text}
          </p>
        ) : null}
      </div>

      <Dialog open={loginDialogOpen} onOpenChange={setLoginDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.giftCard.phoneLogin.title')}</DialogTitle>
            <DialogDescription>
              {t('settings.giftCard.phoneLogin.description')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="gift-card-phone">
                {t('settings.giftCard.phoneLogin.phoneLabel')}
              </Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="gift-card-phone"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder={t('settings.giftCard.phoneLogin.phonePlaceholder')}
                  disabled={isLoggingIn}
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void handleSendSMSCode()}
                  disabled={isSendingCode || isLoggingIn || phone.trim().length === 0}
                  className="w-full sm:w-auto"
                >
                  {isSendingCode ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    t('settings.giftCard.phoneLogin.sendCode')
                  )}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="gift-card-sms-code">
                {t('settings.giftCard.phoneLogin.codeLabel')}
              </Label>
              <Input
                id="gift-card-sms-code"
                value={smsCode}
                onChange={(event) => setSMSCode(event.target.value)}
                placeholder={t('settings.giftCard.phoneLogin.codePlaceholder')}
                disabled={isLoggingIn}
                maxLength={12}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              onClick={() => void handleLoginAndRedeem()}
              disabled={isLoggingIn || !phone.trim() || !smsCode.trim()}
            >
              {isLoggingIn ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t('settings.giftCard.phoneLogin.loginAndRedeem')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
