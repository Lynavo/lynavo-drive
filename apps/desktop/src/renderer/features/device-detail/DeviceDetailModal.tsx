import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { Button } from '@renderer/components/ui/button';
import { useAppStore } from '@renderer/stores/app-store';
import { useDeviceDetailStore } from '@renderer/stores/device-detail-store';
import { ErrorState } from '@renderer/components/shared/ErrorState';
import { DeviceHeader } from './DeviceHeader';
import { DateFilter } from './DateFilter';
import { StatsBar } from './StatsBar';
import { FileLedgerTable } from './FileLedgerTable';

const DETAIL_REFRESH_INTERVAL_MS = 10_000;

export function DeviceDetailModal() {
  const { t } = useTranslation();
  const isModalOpen = useAppStore((s) => s.isModalOpen);
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

  // Fetch files when modal opens with a device
  useEffect(() => {
    if (isModalOpen && selectedDevice) {
      useDeviceDetailStore.getState().fetchDeviceFiles(selectedDevice.deviceId);
    }
    if (!isModalOpen) {
      useDeviceDetailStore.getState().reset();
    }
  }, [isModalOpen, selectedDevice]);

  useEffect(() => {
    if (!isModalOpen || !selectedDevice) return;

    const interval = setInterval(() => {
      useDeviceDetailStore.getState().fetchDeviceFiles(selectedDevice.deviceId, { silent: true });
    }, DETAIL_REFRESH_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [isModalOpen, selectedDevice]);

  const { totalPages, pageStart, pageEnd } = useMemo(() => {
    const safeTotalPages = Math.max(1, Math.ceil(totalItems / Math.max(pageSize, 1)));
    const safePage = Math.min(Math.max(page, 1), safeTotalPages);
    const start = totalItems === 0 ? 0 : (safePage - 1) * pageSize + 1;
    const end = totalItems === 0 ? 0 : Math.min(safePage * pageSize, totalItems);
    return { totalPages: safeTotalPages, pageStart: start, pageEnd: end };
  }, [page, pageSize, totalItems]);

  if (!selectedDevice) return null;

  return (
    <Dialog
      open={isModalOpen}
      onOpenChange={(open) => {
        if (!open) closeDeviceDetail();
      }}
    >
      <DialogPortal>
        <DialogOverlay
          className="fixed inset-0 z-50"
          style={{
            background: 'rgba(180,210,235,0.35)',
            backdropFilter: 'blur(8px)',
          }}
        />
        <DialogContent
          showCloseButton={false}
          className="flex min-h-0 flex-col overflow-hidden border-none p-0"
          style={{
            background: 'rgba(248,252,255,0.88)',
            backdropFilter: 'blur(24px)',
            border: '1px solid rgba(255,255,255,0.85)',
            borderRadius: 20,
            boxShadow: '0 24px 80px rgba(80,150,200,0.18), 0 4px 20px rgba(0,0,0,0.06)',
            width: 'min(960px, 92vw)',
            maxWidth: 'min(960px, 92vw)',
            height: 'min(82vh, 760px)',
            maxHeight: '82vh',
          }}
        >
          {/* Visually hidden but accessible title */}
          <DialogTitle className="sr-only">
            {selectedDevice.displayName} {t('deviceDetail.title')}
          </DialogTitle>

          <DeviceHeader
            device={selectedDevice}
            selectedDate={selectedDate}
            availableDates={availableDates}
            onClose={closeDeviceDetail}
          />

          <div className="flex items-center gap-3 px-6 py-3">
            <DateFilter
              dates={availableDates}
              startDate={startDate}
              endDate={endDate}
              onStartDateChange={(date) => {
                if (selectedDevice) {
                  const store = useDeviceDetailStore.getState();
                  // If new start > current end, also move end
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
                  // Reload from start date within range
                  store.fetchDeviceFiles(selectedDevice.deviceId, {
                    date: startDate,
                    page: 1,
                  });
                }
              }}
            />
          </div>

          <StatsBar
            fileCount={totalItems}
            totalBytes={totalBytes}
            activeTransmissionMs={totalTransmissionMs}
          />

          <div className="min-h-0 flex-1 overflow-y-auto px-4">
            {loading ? (
              <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
                {t('common.fallback.loading')}
              </div>
            ) : error ? (
              <ErrorState
                message={error}
                onRetry={() =>
                  useDeviceDetailStore.getState().fetchDeviceFiles(selectedDevice.deviceId)
                }
              />
            ) : (
              <FileLedgerTable storagePath={selectedDevice.storagePath} />
            )}
          </div>

          <div className="flex items-center justify-between border-t border-black/5 px-6 py-4">
            <div className="text-xs text-slate-500">
              {totalItems === 0
                ? t('common.pagination.empty')
                : t('common.pagination.range', {
                    start: pageStart,
                    end: pageEnd,
                    total: totalItems,
                  })}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">
                {t('common.pagination.page', {
                  page: Math.min(page, totalPages),
                  totalPages,
                })}
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
                {t('common.pagination.previous')}
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
                {t('common.pagination.next')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
