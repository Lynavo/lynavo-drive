import { useEffect } from 'react';
import { Smartphone } from 'lucide-react';
import { GlassCard } from '@renderer/components/shared/GlassCard';
import { Button } from '@renderer/components/ui/button';
import { Skeleton } from '@renderer/components/ui/skeleton';
import { useManagementStore } from '@renderer/stores/management-store';
import { DeviceDetailPanel } from './DeviceDetailPanel';
import { DeviceManagementTable } from './DeviceManagementTable';

export function DevicesPage() {
  const devices = useManagementStore((state) => state.devices);
  const loading = useManagementStore((state) => state.devicesLoading);
  const error = useManagementStore((state) => state.devicesError);
  const loadDevices = useManagementStore((state) => state.loadDevices);
  const unblockDevice = useManagementStore((state) => state.unblockDevice);

  useEffect(() => {
    void loadDevices();
  }, [loadDevices]);

  return (
    <div className="flex flex-1 flex-col overflow-auto">
      <div className="mx-auto w-full max-w-6xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-[#1a2a3a]">設備管理</h1>
          <p className="mt-1 text-sm text-[#6b7a8d]">查看授權設備、封鎖狀態與同步統計。</p>
        </div>

        <div className="mb-6">
          <DeviceDetailPanel devices={devices} />
        </div>

        <GlassCard className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">設備列表</h2>
              <p className="mt-1 text-xs text-muted-foreground">所有資料來自本機 sidecar。</p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => void loadDevices()}>
              重新整理
            </Button>
          </div>

          {loading && devices.length === 0 && <Skeleton className="h-40 w-full" />}

          {error && !loading && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {!loading && !error && devices.length === 0 && (
            <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white/50 px-6 py-10 text-center">
              <Smartphone className="h-8 w-8 text-slate-400" />
              <h2 className="mt-3 text-base font-semibold text-foreground">尚無設備</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                透過連線碼授權後的行動裝置會顯示在這裡。
              </p>
            </div>
          )}

          {!error && devices.length > 0 && (
            <DeviceManagementTable
              devices={devices}
              onUnblock={(clientId) => {
                void unblockDevice(clientId);
              }}
            />
          )}
        </GlassCard>
      </div>
    </div>
  );
}
