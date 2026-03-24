import { FileVideo, HardDrive, Database } from 'lucide-react';
import { useDashboardStore } from '@renderer/stores/dashboard-store';
import { useAppStore } from '@renderer/stores/app-store';
import { formatBytes, formatDateTime } from '@renderer/lib/format';
import { DiskWarningBanner } from './DiskWarningBanner';
import { StatCard } from './StatCard';
import { DeviceCard } from './DeviceCard';

export function Dashboard() {
  const { summary, devices } = useDashboardStore();
  const openDeviceDetail = useAppStore((s) => s.openDeviceDetail);

  return (
    <div className="flex flex-1 flex-col overflow-auto">
      <DiskWarningBanner />

      <div className="px-6 pt-5 pb-1">
        <h1 className="text-xl font-bold">所有设备</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {summary.lastSuccessfulSyncAt
            ? `最近一次成功同步：${formatDateTime(summary.lastSuccessfulSyncAt)} · ${summary.lastSuccessfulDeviceName ?? '未知设备'}`
            : '最近一次成功同步：暂无记录'}
        </p>
      </div>

      {/* Stat cards */}
      <div className="flex flex-wrap gap-4 px-6 pt-3 pb-4">
        <StatCard
          icon={FileVideo}
          iconGradient="linear-gradient(135deg, #3b82f6 0%, #60c4f0 100%)"
          label="今日接收媒体总数"
          value={summary.todayUploadCount.toLocaleString()}
        />
        <StatCard
          icon={HardDrive}
          iconGradient="linear-gradient(135deg, #a855f7 0%, #c084fc 100%)"
          label="今日占用总空间"
          value={formatBytes(summary.todayOccupiedBytes)}
        />
        <StatCard
          icon={Database}
          iconGradient="linear-gradient(135deg, #0ea5e9 0%, #38bdf8 100%)"
          label="设备剩余空间"
          value={formatBytes(summary.remainingBytes)}
        />
      </div>

      {/* Device grid */}
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
    </div>
  );
}
