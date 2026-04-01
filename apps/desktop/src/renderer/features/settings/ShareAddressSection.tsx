import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  CopyPlus,
  FolderOpen,
  Link2,
  Loader2,
  RefreshCw,
  Settings2,
} from 'lucide-react';
import { Button } from '@renderer/components/ui/button';
import { CopyButton } from '@renderer/components/shared/CopyButton';
import { useSettingsStore } from '@renderer/stores/settings-store';

const MAC_SHARING_GUIDE_URL =
  'https://support.apple.com/guide/mac-help/set-up-file-sharing-on-mac-mh17131/mac';
const WINDOWS_SHARING_SETTINGS_URI = 'ms-settings:network-advancedsettings';

export function ShareAddressSection() {
  const { receivePath, shareAddress, shareName, shareStatus } = useSettingsStore((s) => s.settings);
  const shareStatusInfo = useSettingsStore((s) => s.shareStatusInfo);
  const validatingShare = useSettingsStore((s) => s.validatingShare);
  const refreshShareStatus = useSettingsStore((s) => s.refreshShareStatus);
  const isMac = window.electronAPI?.platform.isMac() ?? true;
  const isWindows = window.electronAPI?.platform.isWindows?.() ?? false;
  const hostName = window.electronAPI?.platform.getHostName?.() ?? '';

  const effectiveStatus = validatingShare ? 'validating' : shareStatusInfo.status ?? shareStatus;
  const effectiveShareName = shareStatusInfo.shareName || shareName || '小豹闪传';
  const recommendedShareAddress = `\\\\${hostName || '电脑名'}\\${effectiveShareName}`;
  const effectiveShareAddress = shareAddress || recommendedShareAddress;

  const statusMeta = {
    validating: {
      label: '检测中',
      detail: isMac
        ? '正在检查当前接收目录是否已在 macOS 文件共享中开放。'
        : '正在检查当前接收目录的共享状态。',
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
      detail: isMac
        ? '尚未检测到 macOS 文件共享服务，请先在系统设置中启用文件共享。'
        : 'Windows 版本暂未支持自动检测共享状态。请根据下方的[Windows 手动配置共享方法]设置',
      tone: 'text-amber-700 bg-amber-50 border-amber-200',
      icon: Settings2,
      iconClassName: '',
      showGuide: isMac,
    },
    share_registered: {
      label: '已检测到共享',
      detail: isMac
        ? '系统里已经存在 SMB 共享，但当前接收目录还没有被这条共享覆盖。'
        : '检测到系统里已有 SMB 共享，但当前接收目录还没有被这条共享覆盖。',
      tone: 'text-sky-700 bg-sky-50 border-sky-200',
      icon: Link2,
      iconClassName: '',
      showGuide: isMac,
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
  const showWindowsQuickActions = isWindows && effectiveStatus !== 'ready';

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            共享地址（局域网）
          </label>
          {isWindows ? null : (
            <div
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${meta.tone}`}
            >
              <StatusIcon className={`h-3.5 w-3.5 ${meta.iconClassName}`} />
              {meta.label}
            </div>
          )}
        </div>
        {isWindows ? null : (
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
        )}
      </div>

      <p className="mb-3 text-sm text-muted-foreground">
        {meta.detail}
      </p>

      {showWindowsQuickActions ? (
        <p className="mb-3 text-xs text-muted-foreground">
          配置方式请查看下面的“Windows 手动配置共享方法”。
        </p>
      ) : null}

      {showWindowsQuickActions ? (
        <div className="mb-3 rounded-xl border border-sky-200 bg-sky-50/70 p-3">
          <div className="mb-2">
            <p className="text-sm font-medium text-sky-900">
              Windows 快速配置
            </p>
            <p className="mt-1 text-xs text-sky-700">
              先打开系统共享设置，再打开当前接收目录做共享；共享名建议与应用里的目录别名保持一致。
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void window.electronAPI?.files.openExternal(WINDOWS_SHARING_SETTINGS_URI)}
              className="bg-white"
            >
              <Settings2 className="h-4 w-4" />
              打开高级共享设置
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void window.electronAPI?.files.openFolder(receivePath)}
              disabled={!receivePath}
              className="bg-white"
            >
              <FolderOpen className="h-4 w-4" />
              打开接收目录
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                void window.electronAPI?.files.copyToClipboard(effectiveShareAddress)
              }
              className="bg-white"
            >
              <CopyPlus className="h-4 w-4" />
              复制推荐地址
            </Button>
          </div>

          <p className="mt-2 text-xs text-sky-700">
            推荐地址：<span className="font-mono">{effectiveShareAddress}</span>
          </p>
        </div>
      ) : null}

      {'showGuide' in meta && meta.showGuide ? (
        <button
          type="button"
          onClick={() => void window.electronAPI?.files.openExternal(MAC_SHARING_GUIDE_URL)}
          className="mb-3 inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50 hover:text-blue-700"
        >
          查看系统共享设置指南
          <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
      ) : null}

      <div className="flex items-center gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm text-muted-foreground">
          <Link2 className="h-4 w-4 shrink-0" />
          <span className="truncate">{effectiveShareAddress}</span>
        </div>
        <CopyButton
          text={effectiveShareAddress}
          label="复制"
          className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-secondary"
        />
      </div>
    </div>
  );
}
