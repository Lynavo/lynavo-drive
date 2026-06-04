import { useCallback, useEffect, useState } from 'react';
import {
  FolderOpen,
  FolderInput,
  FolderSymlink,
  Lock,
  UserRound,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@renderer/components/ui/button';
import { GlassCard } from '@renderer/components/shared/GlassCard';
import { CopyButton } from '@renderer/components/shared/CopyButton';
import { useSettingsStore } from '@renderer/stores/settings-store';
import { LoginDialog } from '@renderer/components/shared/LoginDialog';
import { useAuthStore } from '@renderer/stores/auth-store';

function extractErrorText(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message || fallback;
  }
  if (typeof error === 'string') {
    return error || fallback;
  }
  return fallback;
}

const colors = {
  title: '#1a2a3a',
  pathText: '#1a2a3a',
  pathBg: 'rgba(0,0,0,0.03)',
  iconReceived: '#3b82f6',
  iconPersonal: '#0f766e',
  iconShared: '#a855f7',
  iconReceivedBg: 'rgba(59,130,246,0.09)',
  iconPersonalBg: 'rgba(15,118,110,0.09)',
  iconSharedBg: 'rgba(168,85,247,0.09)',
} as const;

export function DirectoryPathCard() {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const [saving, setSaving] = useState(false);
  const [transferActive, setTransferActive] = useState(false);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const session = useAuthStore((state) => state.session);
  const refreshSession = useAuthStore((state) => state.refreshSession);
  const logout = useAuthStore((state) => state.logout);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const handleLogout = useCallback(async () => {
    if (!window.electronAPI?.auth?.logout) {
      toast.error('Auth API unavailable');
      return;
    }
    try {
      const res = await logout();
      if (res.ok) {
        toast.success(t('settings.giftCard.phoneLogin.logoutSuccess'));
      } else {
        toast.error('Logout failed');
      }
    } catch (error) {
      toast.error('Logout error', {
        description: extractErrorText(error, 'Logout error'),
      });
    }
  }, [logout, t]);

  const rootPath = settings.rootPath;
  const receivePath = settings.receivePath;
  const personalPath = settings.personalPath;
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

  const handleChangePersonal = useCallback(async () => {
    const api = window.electronAPI;
    if (!api) return;
    try {
      const selected = await api.files.selectFolder();
      if (selected && selected !== personalPath) {
        setSaving(true);
        const updated = await api.sidecar.updateSettings({
          personalPath: selected,
        });
        updateSettings(updated);
      }
    } catch (err: unknown) {
      const body = err instanceof Error ? err.message : '';
      if (
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
  }, [personalPath, t, updateSettings]);

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
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
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

        {/* Personal directory */}
        <GlassCard className="flex flex-col justify-between p-4">
          <div className="flex items-center gap-3">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
              style={{ background: colors.iconPersonalBg }}
            >
              <UserRound className="h-4.5 w-4.5" style={{ color: colors.iconPersonal }} />
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="text-sm font-semibold" style={{ color: colors.title }}>
                {t('directory.pathCard.personalDirectory')}
              </h4>
              <code
                className="mt-0.5 block truncate text-xs font-mono text-muted-foreground"
                title={personalPath}
              >
                {personalPath || '--'}
              </code>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleOpenFolder(personalPath)}
                disabled={!personalPath}
              >
                <FolderOpen className="mr-1 h-3.5 w-3.5" />
                {t('common.actions.open')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleChangePersonal}
                disabled={saving}
              >
                {t('common.actions.change')}
              </Button>
            </div>
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
                    {session.phone ? ` (${session.phone})` : session.email ? ` (${session.email})` : ''}
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

        {/* Shared directory */}
        <GlassCard className="p-4">
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
        </GlassCard>
      </div>

      <LoginDialog
        open={loginDialogOpen}
        onOpenChange={setLoginDialogOpen}
        onLoginSuccess={refreshSession}
        title={t('settings.filePath.remoteFeaturePrompt')}
        description={t('settings.filePath.remoteFeaturePromptDetail')}
      />
    </div>
  );
}
