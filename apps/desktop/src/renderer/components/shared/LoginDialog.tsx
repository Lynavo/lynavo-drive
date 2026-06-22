import React, { useState, useCallback } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Check, Loader2 } from 'lucide-react';
import * as countryContracts from '@syncflow/contracts/countries';
import type { CountryCodeInfo } from '@syncflow/contracts';
import { isGlobalMarket } from '@renderer/../shared/market';
import vividropLogo from '@renderer/assets/vividrop-logo-cutout.png';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { shouldShowAppleOAuth } from '@renderer/lib/oauth-platform';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select';

type AuthResult = {
  ok: boolean;
  message?: string;
  reason?: string;
  userId?: number;
  isNewUser?: boolean;
  merged?: boolean;
};

function getSMSSendErrorMessage(result: AuthResult, t: TFunction): string {
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

function getSMSLoginErrorMessage(result: AuthResult, t: TFunction): string {
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

type OAuthProvider = 'google' | 'apple';

const COUNTRY_CODE_STORAGE_KEY = 'syncflow.desktop.login.countryCode';
const DEFAULT_COUNTRY_ISO = 'CN';

type ContractsRuntime = {
  COUNTRY_CODES?: readonly CountryCodeInfo[];
  default?: unknown;
};

function findCountryCodesExport(value: unknown, depth = 0): readonly CountryCodeInfo[] | null {
  if (!value || (typeof value !== 'object' && typeof value !== 'function') || depth > 4) {
    return null;
  }

  const runtime = value as ContractsRuntime;
  if (Array.isArray(runtime.COUNTRY_CODES)) {
    return runtime.COUNTRY_CODES;
  }

  return findCountryCodesExport(runtime.default, depth + 1);
}

function getCountryCodes(): readonly CountryCodeInfo[] {
  const countryCodes = findCountryCodesExport(countryContracts);
  if (!countryCodes) {
    throw new Error('COUNTRY_CODES is unavailable from @syncflow/contracts');
  }
  return countryCodes;
}

const COUNTRY_CODES = getCountryCodes();

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" className={className}>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C4 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 4 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function AppleIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
    >
      <path d="M17.05 12.14c-.03-2.98 2.45-4.42 2.56-4.48-1.39-2.03-3.54-2.31-4.29-2.34-1.82-.18-3.58 1.08-4.5 1.08-.94 0-2.36-1.05-3.89-1.02-1.98.03-3.84 1.18-4.86 2.98-2.1 3.64-.53 8.98 1.48 11.94.99 1.42 2.14 3 3.67 2.94 1.48-.06 2.03-.94 3.82-.94 1.77 0 2.29.94 3.85.91 1.6-.03 2.61-1.43 3.57-2.86 1.14-1.63 1.59-3.24 1.61-3.32-.04-.01-3.04-1.16-3.07-4.89zM14.13 3.39c.8-.99 1.34-2.33 1.19-3.7-1.16.05-2.61.8-3.44 1.76-.74.85-1.4 2.24-1.23 3.55 1.31.1 2.64-.66 3.48-1.61z" />
    </svg>
  );
}

function getBrowserLanguages(): string[] {
  if (typeof navigator === 'undefined') {
    return [];
  }

  return navigator.languages?.length
    ? [...navigator.languages]
    : [navigator.language].filter(Boolean);
}

function getFallbackCountry(): CountryCodeInfo {
  const country = COUNTRY_CODES.find((candidate) => candidate.iso === DEFAULT_COUNTRY_ISO);
  if (!country) {
    throw new Error(`Missing default country code: ${DEFAULT_COUNTRY_ISO}`);
  }
  return country;
}

function findCountryByIso(value: string | null | undefined): CountryCodeInfo | null {
  const normalized = value?.trim().toUpperCase();
  if (!normalized) {
    return null;
  }
  return COUNTRY_CODES.find((country) => country.iso === normalized) ?? null;
}

function findCountryByCode(value: string | null | undefined): CountryCodeInfo | null {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }
  return COUNTRY_CODES.find((country) => country.code === normalized) ?? null;
}

function getCountryFromStoredValue(value: string | null | undefined): CountryCodeInfo | null {
  return findCountryByIso(value) ?? findCountryByCode(value);
}

function getStoredCountry(): CountryCodeInfo | null {
  try {
    const value = window.localStorage.getItem(COUNTRY_CODE_STORAGE_KEY);
    return getCountryFromStoredValue(value);
  } catch {
    return null;
  }
}

function persistCountryIso(countryIso: string): void {
  try {
    window.localStorage.setItem(COUNTRY_CODE_STORAGE_KEY, countryIso);
  } catch {
    // localStorage can be unavailable in restricted browser contexts.
  }
}

function resolveCountryFromLocale(locale: string): CountryCodeInfo | null {
  const normalized = locale.trim().toLowerCase().replace(/_/g, '-');

  if (!normalized) {
    return null;
  }

  const parts = normalized.split('-');
  const region = [...parts].reverse().find((part) => /^[a-z]{2}$/.test(part) && part !== parts[0]);
  const countryFromRegion = findCountryByIso(region);
  if (countryFromRegion) {
    return countryFromRegion;
  }

  if (normalized.startsWith('zh-hans')) {
    return findCountryByIso('CN');
  }

  if (normalized.startsWith('zh-hant')) {
    return findCountryByIso('TW');
  }

  if (normalized.startsWith('ja')) {
    return findCountryByIso('JP');
  }

  return null;
}

function resolveDefaultCountry({
  isGlobal,
  language,
  navigatorLanguages = [],
  storedCountryCode,
}: {
  isGlobal: boolean;
  language?: string;
  navigatorLanguages?: readonly string[];
  storedCountryCode?: string | null;
}): CountryCodeInfo {
  if (!isGlobal) {
    return getFallbackCountry();
  }

  const storedCountry = getCountryFromStoredValue(storedCountryCode);
  if (storedCountry) {
    return storedCountry;
  }

  const localeCandidates = [language, ...navigatorLanguages].filter(Boolean) as string[];
  for (const locale of localeCandidates) {
    const country = resolveCountryFromLocale(locale);
    if (country) {
      return country;
    }
  }

  return getFallbackCountry();
}

export function resolveDefaultCountryCode(options: {
  isGlobal: boolean;
  language?: string;
  navigatorLanguages?: readonly string[];
  storedCountryCode?: string | null;
}): string {
  return resolveDefaultCountry(options).code;
}

function getOAuthProviderLabel(provider: OAuthProvider, t: TFunction): string {
  return t(`settings.giftCard.phoneLogin.oauth.providers.${provider}`);
}

function getOAuthLoginErrorMessage(
  result: AuthResult,
  provider: OAuthProvider,
  t: TFunction,
): string {
  return (
    result.message ||
    t('errors.settings.oauthLoginFailed', { provider: getOAuthProviderLabel(provider, t) })
  );
}

function getErrorDescription(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined;
}

function normalizePhoneDigits(value: string): string {
  return value.replace(/\D/g, '');
}

type LoginDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLoginSuccess: () => void;
  title?: string;
  description?: string;
  successMessage?: string;
};

export function LoginDialog({
  open,
  onOpenChange,
  onLoginSuccess,
  title,
  description,
  successMessage,
}: LoginDialogProps) {
  const { t, i18n } = useTranslation();
  const isGlobal = isGlobalMarket();
  const showAppleOAuth = shouldShowAppleOAuth(window.electronAPI?.platform);

  const [selectedCountry, setSelectedCountry] = useState<CountryCodeInfo>(() =>
    resolveDefaultCountry({
      isGlobal,
      language: i18n.resolvedLanguage || i18n.language,
      navigatorLanguages: getBrowserLanguages(),
      storedCountryCode: getStoredCountry()?.iso,
    }),
  );
  const [phone, setPhone] = useState('');
  const [smsCode, setSMSCode] = useState('');
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [agreedToPrivacy, setAgreedToPrivacy] = useState(false);
  const [showAgreementHint, setShowAgreementHint] = useState(false);

  React.useEffect(() => {
    if (open) {
      setSelectedCountry(
        resolveDefaultCountry({
          isGlobal,
          language: i18n.resolvedLanguage || i18n.language,
          navigatorLanguages: getBrowserLanguages(),
          storedCountryCode: getStoredCountry()?.iso,
        }),
      );
      setPhone('');
      setSMSCode('');
      setAgreedToPrivacy(false);
      setShowAgreementHint(false);
    }
  }, [i18n.language, i18n.resolvedLanguage, isGlobal, open]);

  const termsCopy = getTermsCopy(i18n.resolvedLanguage || i18n.language);

  const ensureAgreementAccepted = useCallback(() => {
    if (agreedToPrivacy) {
      setShowAgreementHint(false);
      return true;
    }

    setShowAgreementHint(true);
    return false;
  }, [agreedToPrivacy]);

  const handleCountryChange = useCallback(
    (value: string) => {
      const country = findCountryByIso(value);
      if (!country) {
        return;
      }

      setSelectedCountry(country);
      if (isGlobal) {
        persistCountryIso(country.iso);
      }
    },
    [isGlobal],
  );

  const getFormattedPhone = useCallback(
    (rawPhone: string) => {
      const trimmed = rawPhone.trim();
      const digits = normalizePhoneDigits(trimmed);
      if (trimmed.startsWith('+')) {
        return '+' + digits;
      }

      if (isGlobal) {
        const countryCode = selectedCountry.code;
        if (countryCode === '+86' && digits.startsWith('86') && digits.length > 11) {
          return '+' + digits;
        }
        const localDigits =
          countryCode === '+1' || countryCode === '+86' ? digits : digits.replace(/^0+/, '');
        return countryCode + localDigits;
      } else {
        if (digits.startsWith('86') && digits.length > 11) {
          return '+' + digits;
        }
        return '+86' + digits;
      }
    },
    [isGlobal, selectedCountry.code],
  );

  const handleSendSMSCode = useCallback(async () => {
    const trimmedPhone = phone.trim();
    if (!trimmedPhone) {
      toast.error(t('errors.settings.phoneRequired'));
      return;
    }
    const fullPhone = getFormattedPhone(trimmedPhone);
    const auth = window.electronAPI?.auth;
    if (!auth?.sendSMSCode) {
      toast.error(t('errors.settings.authUnavailable'));
      return;
    }

    setIsSendingCode(true);
    try {
      const result: AuthResult = await auth.sendSMSCode({ phone: fullPhone });
      if (result.ok) {
        toast.success(t('settings.giftCard.phoneLogin.codeSent'));
      } else {
        toast.error(getSMSSendErrorMessage(result, t));
      }
    } catch (error: unknown) {
      toast.error(t('errors.settings.sendSMSCodeFailed'), {
        description: getErrorDescription(error),
      });
    } finally {
      setIsSendingCode(false);
    }
  }, [phone, getFormattedPhone, t]);

  const handleSMSLogin = useCallback(async () => {
    if (!ensureAgreementAccepted()) {
      return;
    }

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
    const fullPhone = getFormattedPhone(trimmedPhone);
    const auth = window.electronAPI?.auth;
    if (!auth?.loginWithSMSCode) {
      toast.error(t('errors.settings.authUnavailable'));
      return;
    }

    setIsLoggingIn(true);
    try {
      const result: AuthResult = await auth.loginWithSMSCode({
        phone: fullPhone,
        code: trimmedSMSCode,
      });
      if (result.ok) {
        toast.success(successMessage || t('settings.giftCard.phoneLogin.loginSuccessGeneric'));
        onOpenChange(false);
        setSMSCode('');
        onLoginSuccess();
      } else {
        toast.error(getSMSLoginErrorMessage(result, t));
      }
    } catch (error: unknown) {
      toast.error(t('errors.settings.loginWithSMSCodeFailed'), {
        description: getErrorDescription(error),
      });
    } finally {
      setIsLoggingIn(false);
    }
  }, [
    ensureAgreementAccepted,
    phone,
    smsCode,
    getFormattedPhone,
    onOpenChange,
    onLoginSuccess,
    successMessage,
    t,
  ]);

  const handleOAuthLogin = useCallback(
    async (provider: OAuthProvider) => {
      if (!ensureAgreementAccepted()) {
        return;
      }

      const auth = window.electronAPI?.auth;
      if (!auth?.loginWithOAuth) {
        toast.error(t('errors.settings.authUnavailable'));
        return;
      }

      setIsLoggingIn(true);
      try {
        const result: AuthResult = await auth.loginWithOAuth({ provider });
        if (result.ok) {
          toast.success(successMessage || t('settings.giftCard.phoneLogin.loginSuccessGeneric'));
          onOpenChange(false);
          onLoginSuccess();
        } else {
          toast.error(getOAuthLoginErrorMessage(result, provider, t));
        }
      } catch (error: unknown) {
        toast.error(
          t('errors.settings.oauthLoginError', { provider: getOAuthProviderLabel(provider, t) }),
          {
            description: getErrorDescription(error),
          },
        );
      } finally {
        setIsLoggingIn(false);
      }
    },
    [ensureAgreementAccepted, onOpenChange, onLoginSuccess, successMessage, t],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-white/70 bg-[#f7fbff]/96 p-0 text-[#17191c] shadow-[0_30px_90px_rgba(70,96,138,0.22)] backdrop-blur-2xl sm:max-w-[440px]">
        <DialogHeader className="items-center space-y-0 px-5 pb-3 pt-5 text-center">
          <div className="mb-4 flex items-center gap-3">
            <img
              src={vividropLogo}
              alt=""
              draggable={false}
              className="h-9 w-auto object-contain"
            />
            <p className="text-[18px] font-semibold leading-none text-[#17191c]">ViviDrop</p>
          </div>
          <DialogTitle className="text-xl font-semibold text-[#17191c]">
            {title ||
              (isGlobal
                ? t('settings.giftCard.phoneLogin.globalTitle')
                : t('settings.giftCard.phoneLogin.title'))}
          </DialogTitle>
          <DialogDescription className="mt-2 text-xs leading-5 text-[#7b8490]">
            {description ||
              (isGlobal
                ? t('settings.giftCard.phoneLogin.globalDescription')
                : t('settings.giftCard.phoneLogin.description'))}
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 pb-5">
          {isGlobal && (
            <div className="flex flex-col gap-2.5 pb-4">
              <Button
                variant="outline"
                type="button"
                onClick={() => void handleOAuthLogin('google')}
                disabled={isLoggingIn || isSendingCode}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-white/70 bg-white/58 text-sm font-semibold text-[#17191c] shadow-[0_10px_30px_rgba(90,120,170,0.08)] transition hover:bg-white/82"
              >
                {isLoggingIn ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <GoogleIcon className="h-4 w-4" />
                    {t('settings.giftCard.phoneLogin.oauth.continueWithGoogle')}
                  </>
                )}
              </Button>
              {showAppleOAuth ? (
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => void handleOAuthLogin('apple')}
                  disabled={isLoggingIn || isSendingCode}
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-white/70 bg-white/58 text-sm font-semibold text-[#17191c] shadow-[0_10px_30px_rgba(90,120,170,0.08)] transition hover:bg-white/82"
                >
                  {isLoggingIn ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <AppleIcon className="h-4 w-4" />
                      {t('settings.giftCard.phoneLogin.oauth.continueWithApple')}
                    </>
                  )}
                </Button>
              ) : null}
              <div className="my-2 flex items-center">
                <div className="h-[1px] flex-grow bg-white/70" />
                <span className="mx-3 text-[11px] font-semibold text-[#8d96a3]">
                  {t('settings.giftCard.phoneLogin.oauth.divider')}
                </span>
                <div className="h-[1px] flex-grow bg-white/70" />
              </div>
            </div>
          )}

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="login-phone" className="text-xs font-semibold text-[#7b8490]">
                {t('settings.giftCard.phoneLogin.phoneLabel')}
              </Label>
              <div className="flex gap-2">
                {isGlobal ? (
                  <Select value={selectedCountry.iso} onValueChange={handleCountryChange}>
                    <SelectTrigger className="h-10 w-[170px] shrink-0 rounded-lg border-white/70 bg-white/70 text-sm font-semibold text-[#17191c] shadow-[0_10px_30px_rgba(90,120,170,0.08)]">
                      <SelectValue
                        placeholder={t('settings.giftCard.phoneLogin.countryCodePlaceholder')}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {COUNTRY_CODES.map((country) => (
                        <SelectItem key={country.iso} value={country.iso}>
                          <span>{country.flag}</span>
                          <span className="font-medium">{country.code}</span>
                          <span className="text-muted-foreground">{country.nameEn}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="flex h-10 shrink-0 items-center justify-center rounded-lg border border-white/70 bg-white/70 px-3 text-sm font-semibold text-[#59616d] shadow-[0_10px_30px_rgba(90,120,170,0.08)]">
                    {getFallbackCountry().code}
                  </div>
                )}
                <Input
                  id="login-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={t('settings.giftCard.phoneLogin.phonePlaceholder')}
                  disabled={isLoggingIn}
                  className="h-10 rounded-lg border-white/70 bg-white/70 text-sm text-[#17191c] shadow-[0_10px_30px_rgba(90,120,170,0.08)] placeholder:text-[#a4acb7] focus-visible:ring-[#66c6ff]/18"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="login-sms-code" className="text-xs font-semibold text-[#7b8490]">
                {t('settings.giftCard.phoneLogin.codeLabel')}
              </Label>
              <div className="flex gap-2">
                <Input
                  id="login-sms-code"
                  value={smsCode}
                  onChange={(e) => setSMSCode(e.target.value)}
                  placeholder={t('settings.giftCard.phoneLogin.codePlaceholder')}
                  disabled={isLoggingIn}
                  maxLength={12}
                  className="h-10 rounded-lg border-white/70 bg-white/70 text-sm text-[#17191c] shadow-[0_10px_30px_rgba(90,120,170,0.08)] placeholder:text-[#a4acb7] focus-visible:ring-[#66c6ff]/18"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void handleSendSMSCode()}
                  disabled={isSendingCode || isLoggingIn || phone.trim().length === 0}
                  className="h-10 shrink-0 rounded-lg border border-white/70 bg-white/58 px-3 text-xs font-semibold text-[#59616d] shadow-[0_10px_30px_rgba(90,120,170,0.08)] transition hover:bg-white/82"
                >
                  {isSendingCode ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    t('settings.giftCard.phoneLogin.sendCode')
                  )}
                </Button>
              </div>
            </div>

            <div className="flex items-start gap-2 text-xs leading-5 text-[#7b8490]">
              <button
                type="button"
                role="checkbox"
                aria-checked={agreedToPrivacy}
                aria-label={termsCopy.checkboxLabel}
                onClick={() => {
                  setAgreedToPrivacy((prev) => !prev);
                  setShowAgreementHint(false);
                }}
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition ${
                  agreedToPrivacy
                    ? 'border-[#17191c] bg-[#17191c] text-white'
                    : 'border-[#cfd6df] bg-white/70 text-transparent'
                }`}
              >
                <Check className="h-3 w-3" strokeWidth={3} />
              </button>
              <span>
                {termsCopy.prefix}
                <button
                  type="button"
                  className="font-semibold text-[#17191c] underline-offset-2 hover:underline"
                >
                  {termsCopy.privacy}
                </button>
                {termsCopy.middle}
                <button
                  type="button"
                  className="font-semibold text-[#17191c] underline-offset-2 hover:underline"
                >
                  {termsCopy.terms}
                </button>
              </span>
            </div>

            {showAgreementHint ? (
              <p className="text-center text-xs font-medium text-[#d92d20]">{termsCopy.hint}</p>
            ) : null}
          </div>

          <DialogFooter className="mt-5">
            <Button
              type="button"
              className="h-11 w-full rounded-md bg-[#17191c] text-sm font-semibold text-white shadow-[0_16px_30px_rgba(23,25,28,0.18)] transition hover:bg-[#2b2f36] disabled:cursor-not-allowed disabled:bg-[#cfd6df]"
              onClick={() => void handleSMSLogin()}
              disabled={isLoggingIn || !phone.trim() || !smsCode.trim()}
            >
              {isLoggingIn ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t('settings.giftCard.phoneLogin.login')
              )}
            </Button>
          </DialogFooter>
          <p className="mt-4 text-center text-xs text-[#7b8490]">未注册的账号将自动注册</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function getTermsCopy(locale: string) {
  if (locale.startsWith('zh-Hant')) {
    return {
      checkboxLabel: '我已閱讀並同意《隱私政策》和《用戶協議》',
      hint: '請先勾選同意隱私政策後再登入',
      middle: '和',
      prefix: '我已閱讀並同意',
      privacy: '《隱私政策》',
      terms: '《用戶協議》',
    };
  }

  if (locale.startsWith('en')) {
    return {
      checkboxLabel: 'I have read and agree to the Privacy Policy and User Agreement',
      hint: 'Please agree to the privacy policy before logging in',
      middle: ' and ',
      prefix: 'I have read and agree to ',
      privacy: 'Privacy Policy',
      terms: 'User Agreement',
    };
  }

  return {
    checkboxLabel: '我已阅读并同意《隐私政策》和《用户协议》',
    hint: '请先勾选同意隐私政策后再登录',
    middle: '和',
    prefix: '我已阅读并同意',
    privacy: '《隐私政策》',
    terms: '《用户协议》',
  };
}
