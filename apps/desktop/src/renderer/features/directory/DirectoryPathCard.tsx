import { useCallback, useEffect, useState } from 'react';
import { FolderOpen, FolderInput, FolderSymlink, Lock, RotateCcw, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@renderer/components/ui/button';
import { GlassCard } from '@renderer/components/shared/GlassCard';
import { CopyButton } from '@renderer/components/shared/CopyButton';
import { useSettingsStore } from '@renderer/stores/settings-store';
import { isWindowsDriveRootPath } from '@renderer/lib/windows-path';

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

  const rootPath = settings.rootPath;
  const receivePath = settings.receivePath;
  const personalPath = settings.personalPath;
  const sharedPath = settings.sharedPath;
  const isWindowsHost = window.electronAPI?.platform.isWindows() ?? false;
  const isWindowsPersonalDrives = settings.personalPathMode === 'windowsDrives';
  const personalPathDisplay = isWindowsPersonalDrives
    ? isWindowsDriveRootPath(personalPath)
      ? t('directory.pathCard.windowsDrivesWithPath', { path: personalPath })
      : t('directory.pathCard.windowsDrives')
    : personalPath || '--';
  const canRestoreWindowsPersonalDrives =
    isWindowsHost && isWindowsPersonalDrives && isWindowsDriveRootPath(personalPath);

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

  const handleRestoreWindowsPersonalDrives = useCallback(async () => {
    const api = window.electronAPI;
    if (!api) return;
    try {
      const homeDir = api.platform.getHomeDir();
      if (!homeDir || homeDir === personalPath) {
        return;
      }
      setSaving(true);
      const updated = await api.sidecar.updateSettings({
        personalPath: homeDir,
      });
      updateSettings(updated);
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

  const handleOpenFolder = useCallback(
    async (path: string) => {
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
    },
    [t],
  );

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
        <GlassCard className="space-y-3 p-4">
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
          <code
            className="block w-full truncate rounded-md px-2.5 py-1.5 text-xs font-mono text-muted-foreground"
            style={{ background: colors.pathBg }}
            title={receivePath}
          >
            {receivePath || '--'}
          </code>
        </GlassCard>

        <GlassCard className="space-y-3 p-4">
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
          <code
            className="block w-full truncate rounded-md px-2.5 py-1.5 text-xs font-mono text-muted-foreground"
            style={{ background: colors.pathBg }}
            title={sharedPath}
          >
            {sharedPath || '--'}
          </code>
        </GlassCard>

        {/* Personal directory */}
        <GlassCard className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
              style={{ background: colors.iconPersonalBg }}
            >
              <UserRound className="h-4.5 w-4.5" style={{ color: colors.iconPersonal }} />
            </div>
            <div className="min-w-fit flex-1">
              <h4
                className="whitespace-nowrap text-sm font-semibold"
                style={{ color: colors.title }}
              >
                {t('directory.pathCard.myComputer')}
              </h4>
            </div>
            <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleOpenFolder(personalPath)}
                disabled={!personalPath || isWindowsPersonalDrives}
              >
                <FolderOpen className="mr-1 h-3.5 w-3.5" />
                {t('common.actions.open')}
              </Button>
              <Button variant="outline" size="sm" onClick={handleChangePersonal} disabled={saving}>
                {t('common.actions.change')}
              </Button>
              {canRestoreWindowsPersonalDrives && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRestoreWindowsPersonalDrives}
                  disabled={saving}
                >
                  <RotateCcw className="mr-1 h-3.5 w-3.5" />
                  {t('directory.pathCard.restoreWindowsDrives')}
                </Button>
              )}
            </div>
          </div>
          <code
            className="block w-full truncate rounded-md px-2.5 py-1.5 text-xs font-mono text-muted-foreground"
            style={{ background: colors.pathBg }}
            title={personalPathDisplay}
          >
            {personalPathDisplay}
          </code>
        </GlassCard>
      </div>
    </div>
  );
}
