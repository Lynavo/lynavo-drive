import { useCallback, useEffect, useState } from 'react';
import { FolderOpen, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@renderer/components/ui/input';
import { Button } from '@renderer/components/ui/button';
import { CopyButton } from '@renderer/components/shared/CopyButton';
import { useSettingsStore } from '@renderer/stores/settings-store';

export function FilePathSection() {
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const refreshShareStatus = useSettingsStore((s) => s.refreshShareStatus);
  const fetchSettings = useSettingsStore((s) => s.fetchSettings);
  const receivePath = settings.receivePath;
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
      toast.error('传输进行中，无法更改接收路径');
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
      toast.error('保存接收路径失败');
    } finally {
      setSaving(false);
    }
  }, [settings.rootPath, refreshShareStatus, transferActive, updateSettings]);

  const handleOpenReceivedFolder = useCallback(async () => {
    if (!receivePath) {
      toast.error('当前还没有可打开的接收路径');
      return;
    }
    try {
      await window.electronAPI.files.openFolder(receivePath);
    } catch {
      toast.error('打开文件夹失败');
    }
  }, [receivePath]);

  const handleOpenSharedFolder = useCallback(async () => {
    if (!sharedPath) {
      toast.error('当前还没有可打开的共享路径');
      return;
    }
    try {
      await window.electronAPI.files.openFolder(sharedPath);
    } catch {
      toast.error('打开共享文件夹失败');
    }
  }, [sharedPath]);

  const isLocked = transferActive;

  return (
    <div className="flex flex-col gap-3">
      {/* Received directory */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="mb-2 flex items-center gap-2">
          <label className="block text-xs font-medium text-muted-foreground">
            接收地址
          </label>
          {isLocked && (
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
              <Lock className="h-3 w-3" />
              传输中
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
            aria-label="选择文件夹"
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
          打开接收目录
        </Button>
      </div>

      {/* Shared directory */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <label className="mb-2 block text-xs font-medium text-muted-foreground">
          共享地址
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
          打开共享目录
        </Button>
      </div>
    </div>
  );
}
