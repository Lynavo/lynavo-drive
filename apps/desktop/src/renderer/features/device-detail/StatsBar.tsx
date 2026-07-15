import { FileVideo2, HardDrive, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatBytes, formatDuration } from '@renderer/lib/format';

const colors = {
  fileIcon: '#3b82f6',
  titleText: '#1a2a3a',
  labelText: '#8a9ab0',
  storageIcon: '#7c6fdd',
  clockIcon: '#f59e0b',
} as const;

interface StatsBarProps {
  fileCount: number;
  totalBytes: number;
  activeTransmissionMs: number;
}

export function StatsBar({ fileCount, totalBytes, activeTransmissionMs }: StatsBarProps) {
  const { t } = useTranslation();
  if (fileCount === 0) return null;

  return (
    <div
      className="mx-6 mb-3 flex items-center gap-4 rounded-xl px-4 py-2.5"
      style={{
        background: 'rgba(59,130,246,0.05)',
        border: '1px solid rgba(59,130,246,0.10)',
      }}
    >
      <div className="flex items-center gap-2">
        <FileVideo2 className="h-3.5 w-3.5" style={{ color: colors.fileIcon }} />
        <span className="text-xs font-semibold" style={{ color: colors.titleText }}>
          {fileCount}
          <span className="ml-1 font-normal" style={{ color: colors.labelText }}>
            {t('common.units.files')}
          </span>
        </span>
      </div>

      <div className="h-3 w-px" style={{ background: 'rgba(59,130,246,0.15)' }} />

      <div className="flex items-center gap-2">
        <HardDrive className="h-3.5 w-3.5" style={{ color: colors.storageIcon }} />
        <span className="text-xs font-semibold" style={{ color: colors.titleText }}>
          {formatBytes(totalBytes)}
        </span>
      </div>

      <div className="h-3 w-px" style={{ background: 'rgba(59,130,246,0.15)' }} />

      <div className="flex items-center gap-2">
        <Clock className="h-3.5 w-3.5" style={{ color: colors.clockIcon }} />
        <span className="text-xs font-semibold" style={{ color: colors.titleText }}>
          {t('deviceDetail.stats.duration')}{' '}
          <span className="font-normal" style={{ color: colors.labelText }}>
            {formatDuration(activeTransmissionMs)}
          </span>
        </span>
      </div>
    </div>
  );
}
