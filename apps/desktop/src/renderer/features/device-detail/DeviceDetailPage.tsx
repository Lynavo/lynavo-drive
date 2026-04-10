import { useEffect, useMemo } from 'react';
import { ArrowLeft, Smartphone, Monitor, FolderOpen } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@renderer/components/ui/button';
import { GlassCard } from '@renderer/components/shared/GlassCard';
import { ErrorState } from '@renderer/components/shared/ErrorState';
import { useAppStore } from '@renderer/stores/app-store';
import { useDeviceDetailStore } from '@renderer/stores/device-detail-store';
import { DateFilter } from './DateFilter';
import { StatsBar } from './StatsBar';
import { FileLedgerTable } from './FileLedgerTable';

const colors = {
  titleText: '#1a2a3a',
  subtitleText: '#6b7a8d',
  backText: '#6b7a8d',
  folderButton: '#3b82f6',
} as const;

export function DeviceDetailPage() {
  const selectedDevice = useAppStore((s) => s.selectedDevice);
  const closeDeviceDetail = useAppStore((s) => s.closeDeviceDetail);

  const selectedDate = useDeviceDetailStore((s) => s.selectedDate);
  const startDate = useDeviceDetailStore((s) => s.startDate);
  const endDate = useDeviceDetailStore((s) => s.endDate);
  const availableDates = useDeviceDetailStore((s) => s.availableDates);
  const page = useDeviceDetailStore((s) => s.page);
  const pageSize = useDeviceDetailStore((s) => s.pageSize);
  const totalItems = useDeviceDetailStore((s) => s.totalItems);
  const totalBytes = useDeviceDetailStore((s) => s.totalBytes);
  const totalTransmissionMs = useDeviceDetailStore((s) => s.totalTransmissionMs);
  const loading = useDeviceDetailStore((s) => s.loading);
  const error = useDeviceDetailStore((s) => s.error);

  // Fetch files when page mounts with a device
  useEffect(() => {
    if (selectedDevice) {
      useDeviceDetailStore.getState().fetchDeviceFiles(selectedDevice.deviceId);
    }
    return () => {
      useDeviceDetailStore.getState().reset();
    };
  }, [selectedDevice]);

  const { totalPages, pageStart, pageEnd } = useMemo(() => {
    const safeTotalPages = Math.max(1, Math.ceil(totalItems / Math.max(pageSize, 1)));
    const safePage = Math.min(Math.max(page, 1), safeTotalPages);
    const start = totalItems === 0 ? 0 : (safePage - 1) * pageSize + 1;
    const end = totalItems === 0 ? 0 : Math.min(safePage * pageSize, totalItems);
    return { totalPages: safeTotalPages, pageStart: start, pageEnd: end };
  }, [page, pageSize, totalItems]);

  if (!selectedDevice) return null;

  const isPhone = /iphone|ipad|galaxy|pixel|android|mobile/i.test(
    selectedDevice.clientName,
  );
  const DeviceIcon = isPhone ? Smartphone : Monitor;

  const hasMaterializedDateDir = availableDates.includes(selectedDate);
  const selectedFolderPath =
    hasMaterializedDateDir && selectedDate
      ? `${selectedDevice.devicePath}/${selectedDate}`
      : selectedDevice.devicePath;

  const handleOpenFolder = async () => {
    const api = window.electronAPI;
    if (!api) return;
    try {
      await api.files.openFolder(selectedFolderPath);
    } catch {
      if (selectedFolderPath !== selectedDevice.devicePath) {
        try {
          await api.files.openFolder(selectedDevice.devicePath);
          return;
        } catch {
          // Fall through to toast below.
        }
      }
      toast.error('打开文件夹失败');
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-auto">
      <div className="mx-auto w-full max-w-5xl px-6 py-8">
        {/* Back button */}
        <button
          onClick={closeDeviceDetail}
          className="mb-4 flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium transition-[color,background-color,transform] duration-150 ease-out hover:bg-white/70 hover:text-[#1a2a3a] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30"
          style={{ color: colors.backText }}
        >
          <ArrowLeft className="h-4 w-4" />
          返回设备列表
        </button>

        {/* Device header */}
        <GlassCard className="mb-6 px-6 py-5">
          <div className="flex items-center gap-4">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
              style={{
                background: 'linear-gradient(135deg, #3b82f6 0%, #60c4f0 100%)',
                boxShadow: '0 2px 8px rgba(59,130,246,0.3)',
              }}
            >
              <DeviceIcon className="h-5 w-5 text-white" />
            </div>

            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-bold" style={{ color: colors.titleText }}>
                {selectedDevice.clientName}
                <span
                  className="ml-2 text-xs font-normal"
                  style={{ color: colors.subtitleText }}
                >
                  {selectedDevice.ip}
                </span>
              </h1>
              <p className="mt-0.5 truncate text-xs" style={{ color: colors.subtitleText }}>
                {selectedFolderPath}
              </p>
            </div>

            <button
              onClick={handleOpenFolder}
              className="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition-[opacity,transform,box-shadow] duration-150 ease-out hover:opacity-95 hover:shadow-sm active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 focus-visible:ring-offset-2"
              style={{
                background: 'rgba(59,130,246,0.08)',
                color: colors.folderButton,
                border: '1px solid rgba(59,130,246,0.15)',
              }}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              打开文件夹
            </button>
          </div>
        </GlassCard>

        {/* File list card */}
        <GlassCard className="flex min-h-0 flex-col">
          {/* Date filter */}
          <div className="flex items-center gap-3 px-6 py-4">
            <DateFilter
              dates={availableDates}
              startDate={startDate}
              endDate={endDate}
              onStartDateChange={(date) => {
                if (selectedDevice) {
                  const store = useDeviceDetailStore.getState();
                  const newEnd = date > endDate ? date : endDate;
                  store.setDateRange(date, newEnd);
                  store.fetchDeviceFiles(selectedDevice.deviceId, {
                    date,
                    page: 1,
                  });
                }
              }}
              onEndDateChange={(date) => {
                if (selectedDevice) {
                  const store = useDeviceDetailStore.getState();
                  store.setDateRange(startDate, date);
                  store.fetchDeviceFiles(selectedDevice.deviceId, {
                    date: startDate,
                    page: 1,
                  });
                }
              }}
            />
          </div>

          {/* Stats */}
          <StatsBar
            fileCount={totalItems}
            totalBytes={totalBytes}
            activeTransmissionMs={totalTransmissionMs}
          />

          {/* File table */}
          <div className="min-h-0 flex-1 px-4 pb-2">
            {loading ? (
              <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
                加载中...
              </div>
            ) : error ? (
              <ErrorState
                message={error}
                onRetry={() =>
                  useDeviceDetailStore
                    .getState()
                    .fetchDeviceFiles(selectedDevice.deviceId)
                }
              />
            ) : (
              <FileLedgerTable storagePath={selectedDevice.storagePath} />
            )}
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between border-t border-black/5 px-6 py-4">
            <div className="text-xs text-slate-500">
              {totalItems === 0
                ? '该日期暂无传输记录'
                : `显示第 ${pageStart}-${pageEnd} 条，共 ${totalItems} 条`}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">
                第 {Math.min(page, totalPages)} / {totalPages} 页
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={loading || page <= 1}
                onClick={() =>
                  useDeviceDetailStore.getState().fetchDeviceFiles(selectedDevice.deviceId, {
                    page: Math.max(1, page - 1),
                  })
                }
              >
                上一页
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={loading || page >= totalPages || totalItems === 0}
                onClick={() =>
                  useDeviceDetailStore.getState().fetchDeviceFiles(selectedDevice.deviceId, {
                    page: Math.min(totalPages, page + 1),
                  })
                }
              >
                下一页
              </Button>
            </div>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
