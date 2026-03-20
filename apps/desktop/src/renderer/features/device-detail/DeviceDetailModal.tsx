import { useMemo } from 'react';
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { ScrollArea } from '@renderer/components/ui/scroll-area';
import { useAppStore } from '@renderer/stores/app-store';
import { useDeviceDetailStore } from '@renderer/stores/device-detail-store';
import { DeviceHeader } from './DeviceHeader';
import { DateFilter } from './DateFilter';
import { StatsBar } from './StatsBar';
import { FileLedgerTable } from './FileLedgerTable';

export function DeviceDetailModal() {
  const isModalOpen = useAppStore((s) => s.isModalOpen);
  const selectedDevice = useAppStore((s) => s.selectedDevice);
  const closeDeviceDetail = useAppStore((s) => s.closeDeviceDetail);

  const files = useDeviceDetailStore((s) => s.files);
  const selectedDate = useDeviceDetailStore((s) => s.selectedDate);
  const availableDates = useDeviceDetailStore((s) => s.availableDates);
  const setDate = useDeviceDetailStore((s) => s.setDate);

  const { fileCount, totalBytes, totalTransmissionMs } = useMemo(() => {
    let bytes = 0;
    let ms = 0;
    for (const f of files) {
      bytes += f.fileSize;
      ms += f.activeTransmissionMs;
    }
    return { fileCount: files.length, totalBytes: bytes, totalTransmissionMs: ms };
  }, [files]);

  if (!selectedDevice) return null;

  return (
    <Dialog open={isModalOpen} onOpenChange={(open) => { if (!open) closeDeviceDetail(); }}>
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
          className="flex flex-col overflow-hidden border-none p-0"
          style={{
            background: 'rgba(248,252,255,0.88)',
            backdropFilter: 'blur(24px)',
            border: '1px solid rgba(255,255,255,0.85)',
            borderRadius: 20,
            boxShadow:
              '0 24px 80px rgba(80,150,200,0.18), 0 4px 20px rgba(0,0,0,0.06)',
            width: 'min(720px, 92vw)',
            maxWidth: 'min(720px, 92vw)',
            maxHeight: '82vh',
          }}
        >
          {/* Visually hidden but accessible title */}
          <DialogTitle className="sr-only">
            {selectedDevice.clientName} 设备详情
          </DialogTitle>

          <DeviceHeader device={selectedDevice} onClose={closeDeviceDetail} />

          <div className="flex items-center gap-3 px-6 py-3">
            <DateFilter
              dates={availableDates}
              selected={selectedDate}
              onSelect={setDate}
            />
          </div>

          <StatsBar
            fileCount={fileCount}
            totalBytes={totalBytes}
            activeTransmissionMs={totalTransmissionMs}
          />

          <ScrollArea className="flex-1 px-6 pb-6">
            <FileLedgerTable />
          </ScrollArea>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
