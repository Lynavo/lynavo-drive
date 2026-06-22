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
import { useTranslation } from 'react-i18next';
import { Button } from '@renderer/components/ui/button';
import { CopyButton } from '@renderer/components/shared/CopyButton';
import { useSettingsStore } from '@renderer/stores/settings-store';
import { getProductName } from '../../../shared/market';

const MAC_SHARING_GUIDE_URL =
  'https://support.apple.com/guide/mac-help/set-up-file-sharing-on-mac-mh17131/mac';
const WINDOWS_SHARING_SETTINGS_URI = 'ms-settings:network-advancedsettings';

export function ShareAddressSection() {
  const { t } = useTranslation();
  const { sharedPath, shareAddress, shareName, shareStatus } = useSettingsStore((s) => s.settings);
  const shareStatusInfo = useSettingsStore((s) => s.shareStatusInfo);
  const validatingShare = useSettingsStore((s) => s.validatingShare);
  const refreshShareStatus = useSettingsStore((s) => s.refreshShareStatus);
  const isMac = window.electronAPI?.platform.isMac() ?? true;
  const isWindows = window.electronAPI?.platform.isWindows?.() ?? false;
  const isLinux = window.electronAPI?.platform.isLinux?.() ?? false;
  const hostName = window.electronAPI?.platform.getHostName?.() ?? '';

  const effectiveStatus = validatingShare ? 'validating' : (shareStatusInfo.status ?? shareStatus);
  const effectiveShareName = shareStatusInfo.shareName || shareName || getProductName();
  const recommendedShareAddress = `\\\\${hostName || t('settings.shareAddress.recommendedHost')}\\${effectiveShareName}`;
  const effectiveShareAddress = shareAddress || recommendedShareAddress;

  const statusMeta = {
    validating: {
      label: t('settings.shareAddress.validating'),
      detail: isMac
        ? t('settings.shareAddress.validatingDetailMac')
        : isWindows
          ? t('settings.shareAddress.validatingDetail')
          : t('settings.shareAddress.validatingDetailLinux'),
      tone: 'text-amber-700 bg-amber-50 border-amber-200',
      icon: Loader2,
      iconClassName: 'animate-spin',
    },
    ready: {
      label: t('settings.shareAddress.ready'),
      detail: t('settings.shareAddress.readyDetail', { shareName: effectiveShareName }),
      tone: 'text-emerald-700 bg-emerald-50 border-emerald-200',
      icon: CheckCircle2,
      iconClassName: '',
    },
    needs_manual_enable: {
      label: t('settings.shareAddress.needsManualEnable'),
      detail: isMac
        ? t('settings.shareAddress.needsManualEnableDetailMac')
        : isLinux
          ? t('settings.shareAddress.needsManualEnableDetailLinux')
          : t('settings.shareAddress.needsManualEnableDetailWindows'),
      tone: 'text-amber-700 bg-amber-50 border-amber-200',
      icon: Settings2,
      iconClassName: '',
      showGuide: isMac,
    },
    share_registered: {
      label: t('settings.shareAddress.shareRegistered'),
      detail: isMac
        ? t('settings.shareAddress.shareRegisteredDetailMac')
        : isLinux
          ? t('settings.shareAddress.shareRegisteredDetailLinux')
          : t('settings.shareAddress.shareRegisteredDetailWindows'),
      tone: 'text-sky-700 bg-sky-50 border-sky-200',
      icon: Link2,
      iconClassName: '',
      showGuide: isMac,
    },
    error: {
      label: t('settings.shareAddress.error'),
      detail: shareStatusInfo.lastError ?? t('settings.shareAddress.errorDetail'),
      tone: 'text-rose-700 bg-rose-50 border-rose-200',
      icon: AlertTriangle,
      iconClassName: '',
    },
    unknown: {
      label: t('settings.shareAddress.unknown'),
      detail: t('settings.shareAddress.unknownDetail'),
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
            {t('settings.shareAddress.label')}
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
          {t('settings.shareAddress.refresh')}
        </Button>
      </div>

      <p className="mb-3 text-sm text-muted-foreground">{meta.detail}</p>

      {showWindowsQuickActions ? (
        <p className="mb-3 text-xs text-muted-foreground">
          {t('settings.shareAddress.windowsManualHint')}
        </p>
      ) : null}

      {showWindowsQuickActions ? (
        <div className="mb-3 rounded-xl border border-sky-200 bg-sky-50/70 p-3">
          <div className="mb-2">
            <p className="text-sm font-medium text-sky-900">
              {t('settings.shareAddress.windowsQuickConfig')}
            </p>
            <p className="mt-1 text-xs text-sky-700">
              {t('settings.shareAddress.windowsQuickConfigDescription')}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                void window.electronAPI?.files.openExternal(WINDOWS_SHARING_SETTINGS_URI)
              }
              className="bg-white"
            >
              <Settings2 className="h-4 w-4" />
              {t('settings.shareAddress.openAdvancedSharing')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void window.electronAPI?.files.openFolder(sharedPath)}
              disabled={!sharedPath}
              className="bg-white"
            >
              <FolderOpen className="h-4 w-4" />
              {t('settings.filePath.openShared')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void window.electronAPI?.files.copyToClipboard(effectiveShareAddress)}
              className="bg-white"
            >
              <CopyPlus className="h-4 w-4" />
              {t('settings.shareAddress.copyRecommendedAddress')}
            </Button>
          </div>

          <p className="mt-2 text-xs text-sky-700">
            {t('settings.shareAddress.recommendedAddress')}
            <span className="font-mono">{effectiveShareAddress}</span>
          </p>
        </div>
      ) : null}

      {'showGuide' in meta && meta.showGuide ? (
        <button
          type="button"
          onClick={() => void window.electronAPI?.files.openExternal(MAC_SHARING_GUIDE_URL)}
          className="mb-3 inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50 hover:text-blue-700"
        >
          {t('settings.shareAddress.systemGuide')}
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
          label={t('common.actions.copy')}
          className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-secondary"
        />
      </div>
    </div>
  );
}
