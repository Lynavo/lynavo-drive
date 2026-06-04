import { useCallback, useEffect, useState } from 'react';
import { FolderOpen, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Input } from '@renderer/components/ui/input';
import { Button } from '@renderer/components/ui/button';
import { CopyButton } from '@renderer/components/shared/CopyButton';
import { useSettingsStore } from '@renderer/stores/settings-store';

export function FilePathSection() {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const refreshShareStatus = useSettingsStore((s) => s.refreshShareStatus);
  const fetchSettings = useSettingsStore((s) => s.fetchSettings);
  const receivePath = settings.receivePath;
  const personalPath = settings.personalPath ?? '';
  const [saving, setSaving] = useState(false);
  const [transferActive, setTransferActive] = useState(false);

  // Use the authoritative shared path from sidecar (not client-side regex)
  const sharedPath = settings.sharedPath ?? '';

  // Listen for transfer active state changes via event + initial fetch
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    // Initial fetch
    void api.sidecar.getTransferActive().then(
      (r) => setTransferActive(r.active),
      () => {},
    );

    // Subscribe to real-time events
    const unsub = api.events.onSidecarEvent((event) => {
      if (event.type === 'transfer.active.changed') {
        setTransferActive((event.payload as { isActive: boolean }).isActive);
      }
      if (event.type === 'shared.directory.changed') {
        void fetchSettings();
      }
    });
    return unsub;
  }, [fetchSettings]);

  const handleSelectFolder = useCallback(async () => {
    if (transferActive) {
      toast.error(t('errors.settings.transferActiveCannotChangeReceivePath'));
      return;
    }
    try {
      const selected = await window.electronAPI.files.selectFolder();
      if (selected && selected !== settings.rootPath) {
        setSaving(true);
        const updated = await window.electronAPI.sidecar.updateSettings({
          rootPath: selected,
        });
        updateSettings(updated);
        void refreshShareStatus(true);
      }
    } catch {
      toast.error(t('errors.settings.saveReceivePathFailed'));
    } finally {
      setSaving(false);
    }
  }, [settings.rootPath, refreshShareStatus, t, transferActive, updateSettings]);

  const handleOpenReceivedFolder = useCallback(async () => {
    if (!receivePath) {
      toast.error(t('errors.settings.noReceivePathToOpen'));
      return;
    }
    try {
      await window.electronAPI.files.openFolder(receivePath);
    } catch {
      toast.error(t('errors.settings.openFolderFailed'));
    }
  }, [receivePath, t]);

  const handleOpenSharedFolder = useCallback(async () => {
    if (!sharedPath) {
      toast.error(t('errors.settings.noSharedPathToOpen'));
      return;
    }
    try {
      await window.electronAPI.files.openFolder(sharedPath);
    } catch {
      toast.error(t('errors.settings.openSharedFolderFailed'));
    }
  }, [sharedPath, t]);

  const handleOpenPersonalFolder = useCallback(async () => {
    if (!personalPath) {
      toast.error(t('errors.settings.noPersonalPathToOpen'));
      return;
    }
    try {
      await window.electronAPI.files.openFolder(personalPath);
    } catch {
      toast.error(t('errors.settings.openPersonalFolderFailed'));
    }
  }, [personalPath, t]);

  const handleSelectPersonalFolder = useCallback(async () => {
    try {
      const selected = await window.electronAPI.files.selectFolder();
      if (selected && selected !== personalPath) {
        setSaving(true);
        const updated = await window.electronAPI.sidecar.updateSettings({
          personalPath: selected,
        });
        updateSettings(updated);
      }
    } catch {
      toast.error(t('errors.settings.savePersonalPathFailed'));
    } finally {
      setSaving(false);
    }
  }, [personalPath, t, updateSettings]);

  const isLocked = transferActive;

  return (
    <div className="flex flex-col gap-3">
      {/* Received directory */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="mb-2 flex items-center gap-2">
          <label className="block text-xs font-medium text-muted-foreground">
            {t('settings.filePath.receiveAddress')}
          </label>
          {isLocked && (
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
              <Lock className="h-3 w-3" />
              {t('common.status.transferring')}
            </span>
          )}
        </div>
        <div className="mb-3 flex items-center gap-2">
          <Input
            type="text"
            value={receivePath}
            readOnly
            className="flex-1"
          />
          <Button
            variant="outline"
            size="icon"
            onClick={handleSelectFolder}
            disabled={saving || isLocked}
            aria-label={t('settings.filePath.chooseFolder')}
          >
            <FolderOpen className="h-4 w-4" />
          </Button>
          <CopyButton
            text={receivePath}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-secondary hover:text-foreground"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleOpenReceivedFolder}
          disabled={!receivePath}
        >
          <FolderOpen className="h-4 w-4" />
          {t('settings.filePath.openReceived')}
        </Button>
      </div>

      {/* Personal directory */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <label className="mb-2 block text-xs font-medium text-muted-foreground">
          {t('settings.filePath.personalAddress')}
        </label>
        <div className="mb-3 flex items-center gap-2">
          <Input
            type="text"
            value={personalPath}
            readOnly
            className="flex-1"
          />
          <Button
            variant="outline"
            size="icon"
            onClick={handleSelectPersonalFolder}
            disabled={saving}
            aria-label={t('settings.filePath.chooseFolder')}
          >
            <FolderOpen className="h-4 w-4" />
          </Button>
          <CopyButton
            text={personalPath}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-secondary hover:text-foreground"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleOpenPersonalFolder}
          disabled={!personalPath}
        >
          <FolderOpen className="h-4 w-4" />
          {t('settings.filePath.openPersonal')}
        </Button>
      </div>

      {/* Shared directory */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <label className="mb-2 block text-xs font-medium text-muted-foreground">
          {t('settings.filePath.sharedAddress')}
        </label>
        <div className="mb-3 flex items-center gap-2">
          <Input
            type="text"
            value={sharedPath}
            readOnly
            className="flex-1"
          />
          <CopyButton
            text={sharedPath}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-secondary hover:text-foreground"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleOpenSharedFolder}
          disabled={!sharedPath}
        >
          <FolderOpen className="h-4 w-4" />
          {t('settings.filePath.openShared')}
        </Button>
      </div>
    </div>
  );
}
