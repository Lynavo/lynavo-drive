import { FileVideo2, HardDrive, Clock } from 'lucide-react';
import { formatBytes, formatDuration } from '@renderer/lib/format';

interface StatsBarProps {
  fileCount: number;
  totalBytes: number;
  activeTransmissionMs: number;
}

export function StatsBar({
  fileCount,
  totalBytes,
  activeTransmissionMs,
}: StatsBarProps) {
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
        <FileVideo2 className="h-3.5 w-3.5" style={{ color: '#3b82f6' }} />
        <span className="text-xs font-semibold" style={{ color: '#1a2a3a' }}>
          {fileCount}
          <span className="ml-1 font-normal" style={{ color: '#8a9ab0' }}>
            个文件
          </span>
        </span>
      </div>

      <div
        className="h-3 w-px"
        style={{ background: 'rgba(59,130,246,0.15)' }}
      />

      <div className="flex items-center gap-2">
        <HardDrive className="h-3.5 w-3.5" style={{ color: '#7c6fdd' }} />
        <span className="text-xs font-semibold" style={{ color: '#1a2a3a' }}>
          {formatBytes(totalBytes)}
        </span>
      </div>

      <div
        className="h-3 w-px"
        style={{ background: 'rgba(59,130,246,0.15)' }}
      />

      <div className="flex items-center gap-2">
        <Clock className="h-3.5 w-3.5" style={{ color: '#f59e0b' }} />
        <span className="text-xs font-semibold" style={{ color: '#1a2a3a' }}>
          耗时{' '}
          <span className="font-normal" style={{ color: '#8a9ab0' }}>
            {formatDuration(activeTransmissionMs)}
          </span>
        </span>
      </div>
    </div>
  );
}
