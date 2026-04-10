import { useCallback, useState } from 'react';
import { FolderOpen, FolderInput, FolderSymlink, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@renderer/components/ui/button';
import { GlassCard } from '@renderer/components/shared/GlassCard';
import { CopyButton } from '@renderer/components/shared/CopyButton';
import { useSettingsStore } from '@renderer/stores/settings-store';

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
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const refreshShareStatus = useSettingsStore((s) => s.refreshShareStatus);
  const [saving, setSaving] = useState(false);

  const shareStatusInfo = useSettingsStore((s) => s.shareStatusInfo);
  const validatingShare = useSettingsStore((s) => s.validatingShare);

  const rootPath = settings.rootPath;
  const receivePath = settings.receivePath;
  const sharedPath = settings.sharedPath;

  const handleChangeRoot = useCallback(async () => {
    const api = window.electronAPI;
    if (!api) return;
    try {
      const selected = await api.files.selectFolder();
      if (selected && selected !== rootPath) {
        setSaving(true);
        const updated = await api.sidecar.updateSettings({
          rootPath: selected,
        });
        updateSettings(updated);
        void refreshShareStatus(true);
      }
    } catch (err: unknown) {
      const body = err instanceof Error ? err.message : '';
      if (body.includes('transfer')) {
        toast.error('当前正在接收文件，暂不能修改接收目录');
      } else if (body.includes('cannot create') || body.includes('not writable')) {
        toast.error('目录创建失败，请检查权限');
      } else if (body.includes('must not be empty') || body.includes('absolute')) {
        toast.error('请选择有效目录');
      } else {
        toast.error('目录不可用');
      }
    } finally {
      setSaving(false);
    }
  }, [rootPath, refreshShareStatus, updateSettings]);

  const handleOpenFolder = useCallback(async (path: string) => {
    const api = window.electronAPI;
    if (!api || !path) {
      toast.error('路径不存在');
      return;
    }
    try {
      await api.files.openFolder(path);
    } catch {
      toast.error('打开文件夹失败');
    }
  }, []);

  return (
    <div className="space-y-4">
      {/* Root directory card */}
      <GlassCard className="p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold" style={{ color: colors.title }}>
              根目录路径
            </h3>
            <code
              className="mt-1.5 block truncate rounded-md px-2.5 py-1.5 text-sm font-mono"
              style={{ color: colors.pathText, background: colors.pathBg }}
              title={rootPath}
            >
              {rootPath || '未设置'}
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
              disabled={saving}
              className="bg-blue-500 text-white hover:bg-blue-600"
            >
              更改
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
                接收目录
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
              打开
            </Button>
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
                共享目录
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
              打开
            </Button>
          </div>
        </GlassCard>
      </div>

      {/* Directory status */}
      <div className="flex items-center gap-4 rounded-xl bg-white/40 px-4 py-2.5">
        <div className="flex items-center gap-1.5 text-xs">
          {validatingShare ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
              <span className="text-muted-foreground">检测共享状态...</span>
            </>
          ) : shareStatusInfo.status === 'ready' || shareStatusInfo.status === 'ok' ? (
            <>
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              <span className="text-muted-foreground">
                共享已就绪{shareStatusInfo.smbUrl ? `  ·  ${shareStatusInfo.smbUrl}` : ''}
              </span>
            </>
          ) : shareStatusInfo.status === 'error' ? (
            <>
              <AlertCircle className="h-3.5 w-3.5 text-red-500" />
              <span className="text-red-600">
                共享异常{shareStatusInfo.lastError ? `：${shareStatusInfo.lastError}` : ''}
              </span>
            </>
          ) : (
            <>
              <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
              <span className="text-muted-foreground">共享未启用</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
