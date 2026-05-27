import { useCallback, useEffect, useState } from 'react';
import { FolderOpen, FolderInput, FolderSymlink, Lock, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@renderer/components/ui/button';
import { GlassCard } from '@renderer/components/shared/GlassCard';
import { CopyButton } from '@renderer/components/shared/CopyButton';
import { useSettingsStore } from '@renderer/stores/settings-store';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { LoginDialog } from '@renderer/components/shared/LoginDialog';

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

type RuntimeAuthAPI = Partial<Window['electronAPI']['auth']>;

function getRuntimeAuthAPI(): RuntimeAuthAPI | undefined {
  return (window as any).electronAPI?.auth as RuntimeAuthAPI | undefined;
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

function decodeJWT(token: string): { phone?: string } | null {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join(''),
    );
    return JSON.parse(jsonPayload) as { phone?: string };
  } catch {
    return null;
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

const colors = {
  title: '#1a2a3a',
  pathText: '#1a2a3a',
  pathBg: 'rgba(0,0,0,0.03)',
  iconReceived: '#3b82f6',
  iconShared: '#a855f7',
  iconReceivedBg: 'rgba(59,130,246,0.09)',
  iconSharedBg: 'rgba(168,85,247,0.09)',
} as const;

export function DirectoryPathCard() {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const [saving, setSaving] = useState(false);
  const [transferActive, setTransferActive] = useState(false);
  const [session, setSession] = useState<{ accessToken: string } | null>(null);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);

  const checkSession = useCallback(async () => {
    const auth = getRuntimeAuthAPI();
    if (auth?.getAuthSession) {
      try {
        const sess = await auth.getAuthSession();
        setSession(sess);
      } catch (error) {
        console.error('Failed to get auth session:', error);
      }
    }
  }, []);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  const handleLogout = useCallback(async () => {
    const auth = getRuntimeAuthAPI();
    if (!auth?.logout) {
      toast.error('Auth API unavailable');
      return;
    }
    try {
      const res = await auth.logout();
      if (res.ok) {
        toast.success(t('settings.giftCard.phoneLogin.logoutSuccess'));
        setSession(null);
      } else {
        toast.error('Logout failed');
      }
    } catch (error) {
      toast.error('Logout error', {
        description: extractErrorText(error, 'Logout error'),
      });
    }
  }, [t]);

  const rootPath = settings.rootPath;
  const receivePath = settings.receivePath;
  const sharedPath = settings.sharedPath;

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    void api.sidecar.getTransferActive().then(
      (result) => setTransferActive(result.active),
      () => {},
    );

    return api.events.onSidecarEvent((event) => {
      if (event.type !== 'transfer.active.changed') return;
      setTransferActive((event.payload as { isActive: boolean }).isActive);
    });
  }, []);

  const handleChangeRoot = useCallback(async () => {
    const api = window.electronAPI;
    if (!api) return;
    if (transferActive) {
      toast.error(t('errors.directory.transferActiveChangeRoot'));
      return;
    }
    try {
      const latestTransferState = await api.sidecar.getTransferActive();
      if (latestTransferState.active) {
        setTransferActive(true);
        toast.error(t('errors.directory.transferActiveChangeRoot'));
        return;
      }

      const selected = await api.files.selectFolder();
      if (selected && selected !== rootPath) {
        setSaving(true);
        const updated = await api.sidecar.updateSettings({
          rootPath: selected,
        });
        updateSettings(updated);
      }
    } catch (err: unknown) {
      const body = err instanceof Error ? err.message : '';
      if (body.includes('transfer')) {
        toast.error(t('errors.directory.transferActiveReceivePath'));
      } else if (
        body.includes('cannot create') ||
        body.includes('not writable') ||
        body.includes('read-only')
      ) {
        toast.error(t('errors.directory.locationNotWritable'));
      } else if (body.includes('must not be empty') || body.includes('absolute')) {
        toast.error(t('errors.directory.selectValidDirectory'));
      } else {
        toast.error(t('errors.directory.directoryUnavailable'));
      }
    } finally {
      setSaving(false);
    }
  }, [rootPath, t, transferActive, updateSettings]);

  const handleOpenFolder = useCallback(async (path: string) => {
    const api = window.electronAPI;
    if (!api || !path) {
      toast.error(t('errors.directory.pathMissing'));
      return;
    }
    try {
      await api.files.openFolder(path);
    } catch {
      toast.error(t('errors.directory.openFolderFailed'));
    }
  }, [t]);

  return (
    <div className="space-y-4">
      {/* Root directory card */}
      <GlassCard className="p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold" style={{ color: colors.title }}>
              {t('directory.pathCard.rootPath')}
            </h3>
            {transferActive && (
              <div className="mt-1 inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
                <Lock className="h-3 w-3" />
                {t('directory.pathCard.changeLocked')}
              </div>
            )}
            <code
              className="mt-1.5 block truncate rounded-md px-2.5 py-1.5 text-sm font-mono"
              style={{ color: colors.pathText, background: colors.pathBg }}
              title={rootPath}
            >
              {rootPath || t('common.fallback.notSet')}
            </code>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <CopyButton
              text={rootPath}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-secondary hover:text-foreground"
            />
            <Button
              size="sm"
              onClick={handleChangeRoot}
              disabled={saving || transferActive}
              className="bg-blue-500 text-white hover:bg-blue-600"
            >
              {t('common.actions.change')}
            </Button>
          </div>
        </div>
      </GlassCard>

      {/* Sub-directory cards */}
      <div className="grid grid-cols-2 gap-4">
        {/* Received directory */}
        <GlassCard className="p-4">
          <div className="flex items-center gap-3">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
              style={{ background: colors.iconReceivedBg }}
            >
              <FolderInput className="h-4.5 w-4.5" style={{ color: colors.iconReceived }} />
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="text-sm font-semibold" style={{ color: colors.title }}>
                {t('directory.pathCard.receivedDirectory')}
              </h4>
              <code
                className="mt-0.5 block truncate text-xs font-mono text-muted-foreground"
                title={receivePath}
              >
                {receivePath || '--'}
              </code>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleOpenFolder(receivePath)}
              disabled={!receivePath}
              className="shrink-0"
            >
              <FolderOpen className="mr-1 h-3.5 w-3.5" />
              {t('common.actions.open')}
            </Button>
          </div>
        </GlassCard>

        {/* Shared directory */}
        <GlassCard className="flex flex-col justify-between p-4">
          <div className="flex items-center gap-3">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
              style={{ background: colors.iconSharedBg }}
            >
              <FolderSymlink className="h-4.5 w-4.5" style={{ color: colors.iconShared }} />
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="text-sm font-semibold" style={{ color: colors.title }}>
                {t('directory.pathCard.sharedDirectory')}
              </h4>
              <code
                className="mt-0.5 block truncate text-xs font-mono text-muted-foreground"
                title={sharedPath}
              >
                {sharedPath || '--'}
              </code>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleOpenFolder(sharedPath)}
              disabled={!sharedPath}
              className="shrink-0"
            >
              <FolderOpen className="mr-1 h-3.5 w-3.5" />
              {t('common.actions.open')}
            </Button>
          </div>

          {/* Remote Sync Promotion / Account Panel */}
          <div className="mt-4 flex items-center justify-between border-t border-border/50 pt-3">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium text-foreground">
                {t('settings.filePath.remoteFeaturePrompt', { defaultValue: '遠端傳輸功能' })}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                {session ? (
                  <>
                    {t('settings.giftCard.phoneLogin.loggedInAs')}
                    {decodeJWT(session.accessToken)?.phone ? ` (${decodeJWT(session.accessToken)?.phone})` : ''}
                  </>
                ) : (
                  t('settings.filePath.remoteFeaturePromptDetail', { defaultValue: '登入後可使用遠端同步' })
                )}
              </p>
            </div>
            {session ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleLogout()}
                className="h-7 px-2.5 text-xs text-muted-foreground hover:text-destructive shrink-0"
              >
                {t('settings.giftCard.phoneLogin.logout')}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLoginDialogOpen(true)}
                className="h-7 px-2.5 text-xs border-blue-200 text-blue-600 hover:bg-blue-50/50 shrink-0"
              >
                {t('settings.giftCard.phoneLogin.login')}
              </Button>
            )}
          </div>
        </GlassCard>
      </div>

      <LoginDialog
        open={loginDialogOpen}
        onOpenChange={setLoginDialogOpen}
        onLoginSuccess={checkSession}
      />
    </div>
  );
}
