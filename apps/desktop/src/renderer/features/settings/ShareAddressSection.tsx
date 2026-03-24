import { AlertTriangle, ArrowUpRight, CheckCircle2, Link2, Loader2, RefreshCw, Settings2 } from 'lucide-react';
import { Button } from '@renderer/components/ui/button';
import { CopyButton } from '@renderer/components/shared/CopyButton';
import { useSettingsStore } from '@renderer/stores/settings-store';

const MAC_SHARING_GUIDE_URL =
  'https://support.apple.com/guide/mac-help/set-up-file-sharing-on-mac-mh17131/mac';

export function ShareAddressSection() {
  const { shareAddress, shareName, shareStatus } = useSettingsStore((s) => s.settings);
  const shareStatusInfo = useSettingsStore((s) => s.shareStatusInfo);
  const validatingShare = useSettingsStore((s) => s.validatingShare);
  const refreshShareStatus = useSettingsStore((s) => s.refreshShareStatus);

  const effectiveStatus = validatingShare ? 'validating' : shareStatusInfo.status ?? shareStatus;
  const effectiveShareName = shareStatusInfo.shareName || shareName || 'SyncFlow';
  const statusMeta = {
    validating: {
      label: '检测中',
      detail: '正在检查当前接收目录是否已在 macOS 文件共享中开放。',
      tone: 'text-amber-700 bg-amber-50 border-amber-200',
      icon: Loader2,
      iconClassName: 'animate-spin',
    },
    ready: {
      label: '已就绪',
      detail: `当前接收目录已经处于共享状态，手机可通过 ${effectiveShareName} 访问。`,
      tone: 'text-emerald-700 bg-emerald-50 border-emerald-200',
      icon: CheckCircle2,
      iconClassName: '',
    },
    needs_manual_enable: {
      label: '未开启共享',
      detail: '尚未检测到 macOS 文件共享服务，请先在系统设置中启用文件共享。',
      tone: 'text-amber-700 bg-amber-50 border-amber-200',
      icon: Settings2,
      iconClassName: '',
      showGuide: true,
    },
    share_registered: {
      label: '已检测到共享',
      detail: '系统里已经存在 SMB 共享，但当前接收目录还没有被这条共享覆盖。',
      tone: 'text-sky-700 bg-sky-50 border-sky-200',
      icon: Link2,
      iconClassName: '',
      showGuide: true,
    },
    error: {
      label: '检测失败',
      detail: shareStatusInfo.lastError ?? '共享状态检测失败，请稍后重试。',
      tone: 'text-rose-700 bg-rose-50 border-rose-200',
      icon: AlertTriangle,
      iconClassName: '',
    },
    unknown: {
      label: '未检测',
      detail: '尚未执行共享状态检测，进入设置页后会自动检测一次。',
      tone: 'text-slate-700 bg-slate-50 border-slate-200',
      icon: Link2,
      iconClassName: '',
    },
  } as const;

  const meta = statusMeta[effectiveStatus];
  const StatusIcon = meta.icon;

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            共享地址（局域网）
          </label>
          <div
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${meta.tone}`}
          >
            <StatusIcon className={`h-3.5 w-3.5 ${meta.iconClassName}`} />
            {meta.label}
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void refreshShareStatus(false)}
          disabled={validatingShare}
          className="shrink-0"
        >
          <RefreshCw className={`h-4 w-4 ${validatingShare ? 'animate-spin' : ''}`} />
          重新检测
        </Button>
      </div>

      <p className="mb-3 text-sm text-muted-foreground">
        {meta.detail}
      </p>

      {'showGuide' in meta && meta.showGuide ? (
        <button
          type="button"
          onClick={() => window.open(MAC_SHARING_GUIDE_URL, '_blank')}
          className="mb-3 inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50 hover:text-blue-700"
        >
          查看系统共享设置指南
          <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
      ) : null}

      <div className="flex items-center gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm text-muted-foreground">
          <Link2 className="h-4 w-4 shrink-0" />
          <span className="truncate">{shareAddress || '当前还没有可用的共享地址'}</span>
        </div>
        <CopyButton
          text={shareAddress}
          label="复制"
          className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-secondary"
        />
      </div>
    </div>
  );
}
