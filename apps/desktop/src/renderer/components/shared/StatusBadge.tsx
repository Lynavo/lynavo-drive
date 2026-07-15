import { cva, type VariantProps } from 'class-variance-authority';
import { useTranslation } from 'react-i18next';
import { cn } from '@renderer/lib/utils';
import type { DeviceDashboardStatus } from '@lynavo-drive/contracts';

const dotVariants = cva('h-2 w-2 rounded-full', {
  variants: {
    status: {
      transferring: 'bg-blue-500 animate-pulse',
      connected_idle: 'bg-green-500',
      offline: 'bg-gray-400',
    },
  },
  defaultVariants: {
    status: 'offline',
  },
});

const labelKeyMap: Record<DeviceDashboardStatus, string> = {
  transferring: 'common.status.transferring',
  connected_idle: 'common.status.connectedIdle',
  offline: 'common.status.offline',
};

interface StatusBadgeProps extends VariantProps<typeof dotVariants> {
  status: DeviceDashboardStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        className,
      )}
    >
      <span className={dotVariants({ status })} />
      {t(labelKeyMap[status])}
    </span>
  );
}
