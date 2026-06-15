import type { DesktopManagedDeviceDTO } from '@syncflow/contracts';
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
      <h2 className="text-base font-semibold text-foreground">設備概覽</h2>
      <dl className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="授權設備" value={`${authorizedCount}`} />
        <Stat label="封鎖中" value={`${blockedCount}`} />
        <Stat label="累計檔案" value={`${totalFiles}`} />
        <Stat label="累計容量" value={formatBytes(totalBytes)} />
      </dl>
      {latestSeenAt && (
        <p className="mt-4 text-xs text-muted-foreground">
          最近出現：{formatDateTime(latestSeenAt)}
        </p>
      )}
    </GlassCard>
  );
}
