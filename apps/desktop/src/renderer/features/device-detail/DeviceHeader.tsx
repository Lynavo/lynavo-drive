import { Smartphone, Monitor, FolderOpen, X } from 'lucide-react';
import { toast } from 'sonner';
import type { DashboardDeviceDTO } from '@syncflow/contracts';
import { Button } from '@renderer/components/ui/button';

const colors = {
  titleText: '#1a2a3a',
  subtitleText: '#8a9ab0',
  folderButton: '#3b82f6',
  closeButton: '#8a9ab0',
} as const;

interface DeviceHeaderProps {
  device: DashboardDeviceDTO;
  selectedDate: string;
  availableDates: string[];
  onClose: () => void;
}

export function DeviceHeader({
  device,
  selectedDate,
  availableDates,
  onClose,
}: DeviceHeaderProps) {
  const isPhone =
    device.platform === 'ios' || /android|mobile/i.test(device.platform);
  const DeviceIcon = isPhone ? Smartphone : Monitor;
  const hasMaterializedDateDir = availableDates.includes(selectedDate);
  const selectedFolderPath =
    hasMaterializedDateDir && selectedDate
      ? `${device.devicePath}/${selectedDate}`
      : device.devicePath;

  const handleOpenFolder = async () => {
    const api = window.electronAPI;
    if (!api) return;
    try {
      await api.files.openFolder(selectedFolderPath);
    } catch {
      if (selectedFolderPath !== device.devicePath) {
        try {
          await api.files.openFolder(device.devicePath);
          return;
        } catch {
          // Fall through to toast below.
        }
      }
      toast.error('打开文件夹失败');
    }
  };

  return (
    <div
      className="flex items-center gap-4 px-6 py-5"
      style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}
    >
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
        <h2 className="text-base font-bold" style={{ color: colors.titleText }}>
          {device.displayName}
          <span
            className="ml-2 text-xs font-normal"
            style={{ color: colors.subtitleText }}
          >
            {device.ip}
          </span>
        </h2>
        <p className="truncate text-xs" style={{ color: colors.subtitleText }}>
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

      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onClose}
        className="shrink-0"
        style={{ color: colors.closeButton }}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
