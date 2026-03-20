import { Smartphone, Monitor, FolderOpen, X } from 'lucide-react';
import type { DashboardDeviceDTO } from '@syncflow/contracts';
import { Button } from '@renderer/components/ui/button';

interface DeviceHeaderProps {
  device: DashboardDeviceDTO;
  onClose: () => void;
}

export function DeviceHeader({ device, onClose }: DeviceHeaderProps) {
  const isPhone = /iphone|ipad|galaxy|pixel|android|mobile/i.test(
    device.clientName,
  );
  const DeviceIcon = isPhone ? Smartphone : Monitor;

  const handleOpenFolder = () => {
    window.electronAPI?.files.openFolder(device.storagePath);
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
        <h2 className="text-base font-bold" style={{ color: '#1a2a3a' }}>
          {device.clientName}
          <span
            className="ml-2 text-xs font-normal"
            style={{ color: '#8a9ab0' }}
          >
            {device.ip}
          </span>
        </h2>
        <p className="truncate text-xs" style={{ color: '#8a9ab0' }}>
          {device.storagePath}
        </p>
      </div>

      <button
        onClick={handleOpenFolder}
        className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition-colors"
        style={{
          background: 'rgba(59,130,246,0.08)',
          color: '#3b82f6',
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
        style={{ color: '#8a9ab0' }}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
