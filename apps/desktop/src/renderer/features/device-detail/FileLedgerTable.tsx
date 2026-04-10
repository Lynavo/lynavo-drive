import { useMemo } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '@renderer/components/ui/table';
import { FileIcon } from '@renderer/components/shared/FileIcon';
import { formatBytes, formatDuration } from '@renderer/lib/format';
import {
  useDeviceDetailStore,
  type SortField,
} from '@renderer/stores/device-detail-store';
import { useAppStore } from '@renderer/stores/app-store';

const colors = {
  headerText: '#8a9ab0',
  emptyText: '#8a9ab0',
  fileName: '#1a2a3a',
  cellText: '#6b7a8d',
  actionButton: '#3b82f6',
} as const;

function SortIcon({ field }: { field: SortField }) {
  const sortField = useDeviceDetailStore((s) => s.sortField);
  const sortDirection = useDeviceDetailStore((s) => s.sortDirection);

  if (sortField !== field) {
    return <ArrowUpDown className="h-3 w-3 opacity-30" />;
  }
  return sortDirection === 'asc' ? (
    <ArrowUp className="h-3 w-3 text-blue-500" />
  ) : (
    <ArrowDown className="h-3 w-3 text-blue-500" />
  );
}

function formatTime(iso?: string): string {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatSmartDate(iso?: string): string {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  const now = new Date();
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.floor((todayStart.getTime() - targetStart.getTime()) / 86400000);

  if (diffDays === 0) return time;
  if (diffDays === 1) return `昨天 ${time}`;
  if (diffDays > 1 && diffDays < 7) {
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return `${weekdays[d.getDay()]} ${time}`;
  }
  const month = d.getMonth() + 1;
  const day = d.getDate();
  if (d.getFullYear() !== now.getFullYear()) {
    return `${d.getFullYear()}/${month}/${day} ${time}`;
  }
  return `${month}月${day}日 ${time}`;
}

export function FileLedgerTable({ storagePath }: { storagePath: string }) {
  const files = useDeviceDetailStore((s) => s.files);
  const sortField = useDeviceDetailStore((s) => s.sortField);
  const sortDirection = useDeviceDetailStore((s) => s.sortDirection);
  const toggleSort = useDeviceDetailStore((s) => s.toggleSort);
  const selectedDevice = useAppStore((s) => s.selectedDevice);

  const sortedFiles = useMemo(() => {
    const result = [...files];
    result.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name':
          cmp = a.originalFilename.localeCompare(b.originalFilename);
          break;
        case 'size':
          cmp = a.fileSize - b.fileSize;
          break;
        case 'completedAt':
          cmp = (a.completedAt ?? '').localeCompare(b.completedAt ?? '');
          break;
        case 'createdAt':
          cmp = (a.createdAtRemote ?? '').localeCompare(
            b.createdAtRemote ?? '',
          );
          break;
        case 'duration':
          cmp = a.activeTransmissionMs - b.activeTransmissionMs;
          break;
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });
    return result;
  }, [files, sortField, sortDirection]);

  const handleOpen = async (relativePath?: string) => {
    if (!relativePath || !storagePath) return;
    const fullPath = `${storagePath}/${relativePath}`;
    try {
      await window.electronAPI?.files.openFile(fullPath);
    } catch {
      toast.error('文件不存在或已被移除', { description: fullPath });
    }
  };

  const columns: { label: string; field: SortField }[] = [
    { label: '文件名称', field: 'name' },
    { label: '文件大小', field: 'size' },
    { label: '完成时间', field: 'completedAt' },
    { label: '创建时间', field: 'createdAt' },
    { label: '传输耗时', field: 'duration' },
  ];

  return (
    <Table className="table-fixed w-full">
      <TableHeader>
        <TableRow style={{ borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
          {columns.map((col) => (
            <TableHead
              key={col.field}
              className="pr-2"
              style={{ width: col.field === 'name' ? '35%' : undefined }}
            >
              <button
                onClick={() => {
                  if (!selectedDevice) return;
                  void toggleSort(selectedDevice.deviceId, col.field);
                }}
                className="flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-1 text-xs font-medium transition-[color,background-color,transform] duration-150 ease-out hover:bg-blue-50 hover:text-blue-500 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30"
                style={{ color: colors.headerText }}
              >
                {col.label}
                <SortIcon field={col.field} />
              </button>
            </TableHead>
          ))}
          <TableHead className="text-right w-20 pr-2">
            <span className="text-xs font-medium" style={{ color: colors.headerText }}>
              操作
            </span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sortedFiles.length === 0 ? (
          <TableRow>
            <TableCell
              colSpan={6}
              className="py-16 text-center text-sm"
              style={{ color: colors.emptyText }}
            >
              该日期暂无传输记录
            </TableCell>
          </TableRow>
        ) : (
          sortedFiles.map((file) => (
            <TableRow
              key={file.fileKey}
              className="transition-colors hover:bg-blue-50/40"
            >
              <TableCell className="pr-2">
                <div className="flex items-center gap-2 min-w-0">
                  <FileIcon name={file.originalFilename} />
                  <span
                    className="font-medium truncate"
                    style={{ color: colors.fileName }}
                    title={file.originalFilename}
                  >
                    {file.originalFilename}
                  </span>
                </div>
              </TableCell>
              <TableCell
                className="pr-2 text-sm whitespace-nowrap"
                style={{ color: colors.cellText }}
              >
                {formatBytes(file.fileSize)}
              </TableCell>
              <TableCell
                className="pr-2 text-sm whitespace-nowrap"
                style={{ color: colors.cellText }}
              >
                {formatTime(file.completedAt)}
              </TableCell>
              <TableCell
                className="pr-2 text-sm whitespace-nowrap"
                style={{ color: colors.cellText }}
              >
                {formatSmartDate(file.createdAtRemote)}
              </TableCell>
              <TableCell
                className="pr-2 text-sm whitespace-nowrap"
                style={{ color: colors.cellText }}
              >
                {formatDuration(file.activeTransmissionMs)}
              </TableCell>
              <TableCell className="text-right pr-2">
                <button
                  onClick={() => handleOpen(file.finalPath)}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium shadow-sm transition-[opacity,transform,box-shadow] duration-150 ease-out hover:opacity-90 hover:shadow-md active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/35 focus-visible:ring-offset-1"
                  style={{
                    color: '#fff',
                    background: colors.actionButton,
                  }}
                  title="打开文件"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  打开
                </button>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
