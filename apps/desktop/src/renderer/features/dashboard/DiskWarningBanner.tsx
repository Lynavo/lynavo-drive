import { AlertTriangle, X } from 'lucide-react';
import { useDashboardStore } from '@renderer/stores/dashboard-store';

const colors = {
  errorText: '#dc2626',
} as const;

export function DiskWarningBanner() {
  const { summary, diskWarningDismissed, dismissDiskWarning } =
    useDashboardStore();

  if (!summary.isDiskLow || diskWarningDismissed) return null;

  return (
    <div
      className="mx-6 mt-4 flex items-center gap-3 rounded-2xl px-4 py-3 text-sm shadow-[0_12px_30px_rgba(220,38,38,0.08),0_2px_6px_rgba(220,38,38,0.04)]"
      style={{
        background: 'rgba(254,226,226,0.85)',
        color: colors.errorText,
        backdropFilter: 'blur(8px)',
      }}
      role="alert"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="flex-1 text-sm font-medium">
        接收磁盘剩余空间小于 500MB，已暂停新的接收任务
      </span>
      <button
        onClick={dismissDiskWarning}
        className="ml-auto flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-[background-color,transform] duration-150 ease-out hover:bg-red-100 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
        style={{ color: colors.errorText }}
        aria-label="dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
