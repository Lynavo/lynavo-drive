import { AlertTriangle, X } from 'lucide-react';
import { useDashboardStore } from '@renderer/stores/dashboard-store';

export function DiskWarningBanner() {
  const { summary, diskWarningDismissed, dismissDiskWarning } =
    useDashboardStore();

  if (!summary.isDiskLow || diskWarningDismissed) return null;

  return (
    <div
      className="mx-6 mt-5 flex items-center gap-3 rounded-xl px-4 py-3 text-sm"
      style={{
        background: 'rgba(254,226,226,0.85)',
        border: '1px solid rgba(252,165,165,0.5)',
        color: '#dc2626',
        backdropFilter: 'blur(8px)',
      }}
      role="alert"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="flex-1 text-sm font-medium">
        接收磁盘剩余空间 &lt; 500MB，已暂停所有设备的接收任务
      </span>
      <button
        onClick={dismissDiskWarning}
        className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-red-100"
        style={{ color: '#dc2626' }}
        aria-label="dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
