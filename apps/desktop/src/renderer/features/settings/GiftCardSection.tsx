import { useCallback, useEffect, useState } from 'react';
import { Gift, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { useAuthStore } from '@renderer/stores/auth-store';
import { LogoutConfirmDialog } from '@renderer/components/shared/LogoutConfirmDialog';

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
  userId?: number;
  isNewUser?: boolean;
  merged?: boolean;
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

export function GiftCardSection() {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<ResultState | null>(null);
  const session = useAuthStore((state) => state.session);
  const refreshSession = useAuthStore((state) => state.refreshSession);
  const logout = useAuthStore((state) => state.logout);
  const clearSession = useAuthStore((state) => state.clearSession);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const accountLabel =
    session?.phone?.trim() || session?.email?.trim() || session?.accountLabel?.trim() || '';

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const handleLogout = useCallback(() => {
    setShowLogoutConfirm(true);
  }, []);

  const handleConfirmLogout = useCallback(async () => {
    setShowLogoutConfirm(false);
    if (!window.electronAPI?.auth?.logout) {
      toast.error(t('errors.settings.authUnavailable'));
      return;
    }
    try {
      const res = await logout();
      if (res.ok) {
        toast.success(t('settings.giftCard.phoneLogin.logoutSuccess'));
      } else {
        toast.error(t('settings.giftCard.phoneLogin.logoutFailed'));
      }
    } catch (error) {
      toast.error(t('settings.giftCard.phoneLogin.logoutError'), {
        description: extractErrorText(error, t('settings.giftCard.phoneLogin.logoutError')),
      });
    }
  }, [logout, t]);

  const performRedeem = useCallback(
    async (trimmedCode: string) => {
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
          const message = getRedeemErrorMessage(result, t);
          setLastResult({
            kind: 'error',
            text: message,
          });
          toast.error(message);
          if (result.reason === 'auth_required') {
            clearSession();
          }
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
    },
    [clearSession, t],
  );

  const handleRedeem = useCallback(async () => {
    const trimmedCode = code.trim();
    if (!trimmedCode) {
      toast.error(t('errors.settings.redeemGiftCardInvalidCode'));
      return;
    }

    setIsSubmitting(true);
    try {
      await performRedeem(trimmedCode);
    } finally {
      setIsSubmitting(false);
    }
  }, [code, performRedeem, t]);

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-start gap-3">
        <div className="mt-0.5 rounded-lg bg-secondary p-2 text-muted-foreground">
          <Gift className="h-4 w-4" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">{t('settings.giftCard.title')}</h3>
          <p className="text-xs text-muted-foreground">{t('settings.giftCard.description')}</p>
        </div>
      </div>

      {/* Account login/logout section */}
      <div className="mb-5 flex items-center justify-between border-b border-border/50 pb-4">
        <div className="flex flex-col">
          <span className="text-xs font-semibold text-foreground">
            {t('settings.giftCard.phoneLogin.accountStatus')}
          </span>
          <span className="text-xs text-muted-foreground mt-0.5">
            {session ? (
              <>
                {t('settings.giftCard.phoneLogin.loggedInAs')}
                {session.phone ? ` (${session.phone})` : session.email ? ` (${session.email})` : ''}
              </>
            ) : (
              t('settings.giftCard.phoneLogin.notLoggedIn')
            )}
          </span>
        </div>
        {session ? (
          <Button type="button" variant="outline" size="sm" onClick={() => void handleLogout()}>
            {t('settings.giftCard.phoneLogin.logout')}
          </Button>
        ) : null}
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

      <LogoutConfirmDialog
        isOpen={showLogoutConfirm}
        onClose={() => setShowLogoutConfirm(false)}
        onConfirm={() => {
          void handleConfirmLogout();
        }}
        accountLabel={accountLabel}
      />
    </div>
  );
}
