import type { DesktopManagedDeviceDTO } from '@lynavo-drive/contracts';
import { useTranslation } from 'react-i18next';
import { GlassCard } from '@renderer/components/shared/GlassCard';
import { formatBytes, formatDateTime } from '@renderer/lib/format';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-foreground">{value}</dd>
    </div>
  );
}

export function DeviceDetailPanel({ devices }: { devices: DesktopManagedDeviceDTO[] }) {
  const { t } = useTranslation();
  const totalFiles = devices.reduce((sum, device) => sum + device.totalFileCount, 0);
  const totalBytes = devices.reduce((sum, device) => sum + device.totalBytes, 0);
  const blockedCount = devices.filter((device) => device.blockStatus === 'active').length;
  const authorizedCount = devices.filter(
    (device) => device.authorizationStatus === 'authorized',
  ).length;
  const latestSeenAt = devices
    .map((device) => device.lastSeenAt)
    .filter((lastSeenAt): lastSeenAt is string => Boolean(lastSeenAt))
    .sort((a, b) => b.localeCompare(a))[0];

  return (
    <GlassCard className="p-5">
      <h2 className="text-base font-semibold text-foreground">
        {t('deviceDetail.overview.title')}
      </h2>
      <dl className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label={t('deviceDetail.overview.authorizedDevices')} value={`${authorizedCount}`} />
        <Stat label={t('deviceDetail.overview.blockedDevices')} value={`${blockedCount}`} />
        <Stat label={t('deviceDetail.overview.totalFiles')} value={`${totalFiles}`} />
        <Stat label={t('deviceDetail.overview.totalBytes')} value={formatBytes(totalBytes)} />
      </dl>
      {latestSeenAt && (
        <p className="mt-4 text-xs text-muted-foreground">
          {t('deviceDetail.overview.latestSeenAt', { time: formatDateTime(latestSeenAt) })}
        </p>
      )}
    </GlassCard>
  );
}
