import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileVideo, HardDrive, Database, Server, Radio, Smartphone, Copy, Check } from 'lucide-react';
import { toast } from 'sonner';
import { useDashboardStore } from '@renderer/stores/dashboard-store';
import { useAppStore } from '@renderer/stores/app-store';
import { useSettingsStore } from '@renderer/stores/settings-store';
import { useSidecarRuntimeStore } from '@renderer/stores/sidecar-runtime-store';
import { formatBytes, formatDateTime } from '@renderer/lib/format';
import { ErrorState } from '@renderer/components/shared/ErrorState';
import { GlassCard } from '@renderer/components/shared/GlassCard';
import { Button } from '@renderer/components/ui/button';
import { DiskWarningBanner } from './DiskWarningBanner';
import { StatCard } from './StatCard';
import { DeviceCard } from './DeviceCard';

export function Dashboard() {
  const { t } = useTranslation();
  const { summary, devices, error, fetchDashboard } = useDashboardStore();
  const openDeviceDetail = useAppStore((s) => s.openDeviceDetail);
  const sidecarState = useSidecarRuntimeStore((s) => s.runtime);
  const settings = useSettingsStore((s) => s.settings);

  const [copied, setCopied] = useState(false);

  const activeDevicesCount = devices.filter((d) => d.status !== 'offline').length;

  const handleCopyCode = async () => {
    if (!settings.connectionCode) return;
    const api = window.electronAPI;
    if (api) {
      try {
        await api.files.copyToClipboard(settings.connectionCode);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        toast.success(t('dashboard.statusPanel.copySuccess'));
      } catch (err) {
        console.error('Failed to copy to clipboard:', err);
      }
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-auto">
      <DiskWarningBanner />

      <div className="px-6 pt-5 pb-1">
        <h1 className="text-xl font-bold">{t('dashboard.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {summary.lastSuccessfulSyncAt
            ? t('dashboard.lastSuccess.withDevice', {
                time: formatDateTime(summary.lastSuccessfulSyncAt),
                device: summary.lastSuccessfulDeviceName ?? t('common.fallback.unknownDevice'),
              })
            : t('dashboard.lastSuccess.none')}
        </p>
      </div>

      {/* Status summary banner */}
      <div className="px-6 pt-2 pb-2">
        <GlassCard className="grid grid-cols-1 divide-y divide-white/10 rounded-2xl bg-white/30 border-white/20 p-4 sm:grid-cols-3 sm:divide-y-0 sm:divide-x sm:p-5">
          {/* Sidecar status */}
          <div className="flex items-center gap-3 pb-3 sm:pb-0 sm:pr-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/10">
              <Server className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t('dashboard.statusPanel.sidecarStatus')}</p>
              <div className="mt-0.5 flex items-center gap-1.5">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    sidecarState.status === 'healthy'
                      ? 'bg-emerald-500 animate-pulse'
                      : sidecarState.status === 'starting'
                        ? 'bg-amber-500 animate-pulse'
                        : 'bg-rose-500'
                  }`}
                />
                <span className="text-sm font-semibold text-slate-800">
                  {t(`dashboard.statusPanel.status.${sidecarState.status}`, {
                    defaultValue: sidecarState.status,
                  })}
                </span>
              </div>
            </div>
          </div>

          {/* Pairing Code */}
          <div className="flex items-center justify-between py-3 sm:py-0 sm:px-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-500/10">
                <Radio className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t('dashboard.statusPanel.pairingCode')}</p>
                <p className="mt-0.5 font-mono text-sm font-bold tracking-wider text-slate-800">
                  {settings.connectionCode || '\u2014'}
                </p>
              </div>
            </div>
            {settings.connectionCode && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1 px-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50/50"
                onClick={handleCopyCode}
                title={t('dashboard.statusPanel.clickToCopy')}
              >
                {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                <span className="text-xs">{copied ? t('common.actions.copy') + '...' : t('common.actions.copy')}</span>
              </Button>
            )}
          </div>

          {/* Active Devices */}
          <div className="flex items-center gap-3 pt-3 sm:pt-0 sm:pl-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-500/10">
              <Smartphone className="h-5 w-5 text-sky-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t('dashboard.statusPanel.activeDevices')}</p>
              <p className="mt-0.5 text-sm font-bold text-slate-800">
                {activeDevicesCount} <span className="text-xs font-normal text-slate-500">/ {devices.length}</span>
              </p>
            </div>
          </div>
        </GlassCard>
      </div>

      {/* Stat cards */}
      <div className="flex flex-wrap gap-4 px-6 pt-3 pb-4">
        <StatCard
          icon={FileVideo}
          tone="blue"
          label={t('dashboard.stats.todayMediaCount')}
          value={summary.todayUploadCount.toLocaleString()}
        />
        <StatCard
          icon={HardDrive}
          tone="green"
          label={t('dashboard.stats.todayOccupied')}
          value={formatBytes(summary.todayOccupiedBytes)}
        />
        <StatCard
          icon={Database}
          tone="cyan"
          label={t('dashboard.stats.remainingSpace')}
          value={formatBytes(summary.remainingBytes)}
          alert={summary.isDiskLow}
        />
      </div>

      {/* Error state */}
      {error && devices.length === 0 && (
        <div className="px-6">
          <ErrorState message={error} onRetry={fetchDashboard} />
        </div>
      )}

      {/* Device grid */}
      {!(error && devices.length === 0) && (
        <div className="px-6 pb-8">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {devices.map((device) => (
              <DeviceCard
                key={device.deviceId}
                device={device}
                onClick={() => openDeviceDetail(device)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

