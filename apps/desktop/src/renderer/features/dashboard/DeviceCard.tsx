import { FileVideo, HardDrive, Smartphone } from 'lucide-react';
import type { DashboardDeviceDTO } from '@syncflow/contracts';
import { GlassCard } from '@renderer/components/shared/GlassCard';
import { StatusBadge } from '@renderer/components/shared/StatusBadge';
import { Progress } from '@renderer/components/ui/progress';
import { formatBytes } from '@renderer/lib/format';
import { cn } from '@renderer/lib/utils';

const colors = {
  iconGradient: 'linear-gradient(135deg, #3b82f6 0%, #60c4f0 100%)',
  iconOfflineBg: 'rgba(0,0,0,0.06)',
} as const;

interface DeviceCardProps {
  device: DashboardDeviceDTO;
  onClick: () => void;
}

export function DeviceCard({ device, onClick }: DeviceCardProps) {
  const isOffline = device.status === 'offline';
  const isTransferring = device.status === 'transferring';

  return (
    <button
      onClick={onClick}
      className="group flex cursor-pointer flex-col rounded-2xl text-left transition-transform duration-150 ease-out hover:-translate-y-0.5 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/35 focus-visible:ring-offset-2"
      style={{ opacity: isOffline ? 0.65 : 1 }}
      data-testid="device-card"
    >
      <GlassCard
        variant={isOffline ? 'muted' : 'default'}
        shadow={isTransferring ? 'card' : 'card'}
        className={cn(
          'flex w-full flex-col px-5 py-[18px] transition-[box-shadow,transform,border-color] duration-150 group-hover:shadow-[0_10px_30px_rgba(15,23,42,0.10),0_2px_6px_rgba(15,23,42,0.06)]',
          isTransferring &&
            'ring-1 ring-blue-500/35 shadow-[0_4px_24px_rgba(59,130,246,0.12),0_1px_4px_rgba(0,0,0,0.04)]',
        )}
      >
        {/* Header: icon + name + IP + status badge */}
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
              style={{
                background: isOffline
                  ? colors.iconOfflineBg
                  : colors.iconGradient,
                boxShadow: isOffline
                  ? 'none'
                  : '0 2px 8px rgba(59,130,246,0.3)',
              }}
            >
              <Smartphone className="h-5 w-5 text-white" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">{device.displayName}</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {device.ip}
              </p>
            </div>
          </div>
          <StatusBadge status={device.status} />
        </div>

        {/* Transfer progress */}
        {isTransferring && device.currentFile && (
          <div
            className="mb-3 rounded-xl px-3 py-2.5"
            style={{ background: 'rgba(59,130,246,0.06)' }}
          >
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="max-w-44 truncate font-medium">
                {device.currentFile.filename}
              </span>
              <span className="font-semibold text-blue-500">
                {Math.round(device.currentFile.progress)}%
              </span>
            </div>
            <Progress
              value={device.currentFile.progress}
              className="h-1.5"
              style={{ background: 'rgba(59,130,246,0.12)' }}
            />
          </div>
        )}
        {/* Preparing state: transferring but no file data yet */}
        {isTransferring && !device.currentFile && (
          <div
            className="mb-3 rounded-xl px-3 py-2.5"
            style={{ background: 'rgba(59,130,246,0.06)' }}
          >
            <div className="flex items-center gap-2 text-xs text-blue-500">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
              <span className="font-medium">准备传输中…</span>
            </div>
          </div>
        )}

        {/* Bottom stats */}
        <div
          className="mt-auto flex items-center gap-4 pt-2.5 text-xs"
          style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}
        >
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <FileVideo className="h-3.5 w-3.5" />
            <span className="font-semibold text-foreground">
              {device.todayFileCount}
            </span>
            个文件
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <HardDrive className="h-3.5 w-3.5" />
            <span className="font-semibold text-foreground">
              {formatBytes(device.todayBytes)}
            </span>
          </div>
        </div>
      </GlassCard>
    </button>
  );
}
