import { useMemo, useState } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown, ExternalLink } from 'lucide-react';
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '@renderer/components/ui/table';
import { FileIcon } from '@renderer/components/shared/FileIcon';
import { formatBytes, formatSmartDate } from '@renderer/lib/format';
import { useDirectoryStore, type SharedFileEntry } from '@renderer/stores/directory-store';
import { useSettingsStore } from '@renderer/stores/settings-store';
import { resolveAbsolutePath } from './path-utils';

const colors = {
  headerText: '#8a9ab0',
  emptyText: '#8a9ab0',
  fileName: '#1a2a3a',
  cellText: '#6b7a8d',
  actionButton: '#3b82f6',
  statsBg: 'rgba(0,0,0,0.02)',
  statsText: '#6b7a8d',
} as const;

type SharedSortField = 'size' | 'modifiedAt';

function SortIcon({
  field,
  activeField,
  direction,
}: {
  field: SharedSortField;
  activeField: SharedSortField;
  direction: 'asc' | 'desc';
}) {
  if (activeField !== field) {
    return <ArrowUpDown className="h-3 w-3 opacity-30" />;
  }
  return direction === 'asc' ? (
    <ArrowUp className="h-3 w-3 text-blue-500" />
  ) : (
    <ArrowDown className="h-3 w-3 text-blue-500" />
  );
}

export function SharedFileList() {
  const sharedFiles = useDirectoryStore((s) => s.sharedFiles);
  const sharedPath = useSettingsStore((s) => s.settings.sharedPath);
  const [sortField, setSortField] = useState<SharedSortField>('modifiedAt');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const toggleSort = (field: SharedSortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const totalBytes = useMemo(() => sharedFiles.reduce((sum, f) => sum + f.size, 0), [sharedFiles]);

  const sortedFiles = useMemo(() => {
    const result = [...sharedFiles];
    result.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'size':
          cmp = a.size - b.size;
          break;
        case 'modifiedAt':
          cmp = a.modifiedAt.localeCompare(b.modifiedAt);
          break;
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });
    return result;
  }, [sharedFiles, sortField, sortDirection]);

  const handleOpen = (file: SharedFileEntry) => {
    if (!file.path) return;
    const resolvedPath = resolveAbsolutePath(sharedPath, file.path);
    void window.electronAPI?.files.openFile(resolvedPath);
  };

  return (
    <div>
      {/* Stats bar */}
      <div
        className="mb-3 flex items-center justify-between rounded-xl px-4 py-2.5"
        style={{ background: colors.statsBg }}
      >
        <span className="text-sm" style={{ color: colors.statsText }}>
          共 {sharedFiles.length} 个文件&nbsp;&nbsp;总大小: {formatBytes(totalBytes)}
        </span>
      </div>

      {/* Table */}
      <Table className="table-fixed w-full">
        <TableHeader>
          <TableRow style={{ borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
            <TableHead className="pr-2" style={{ width: '35%' }}>
              <span className="text-xs font-medium" style={{ color: colors.headerText }}>
                文件名称
              </span>
            </TableHead>
            <TableHead className="pr-2" style={{ width: '15%' }}>
              <button
                onClick={() => toggleSort('size')}
                className="flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-1 text-xs font-medium transition-[color,background-color,transform] duration-150 ease-out hover:bg-blue-50 hover:text-blue-500 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30"
                style={{ color: colors.headerText }}
              >
                大小
                <SortIcon field="size" activeField={sortField} direction={sortDirection} />
              </button>
            </TableHead>
            <TableHead className="pr-2" style={{ width: '25%' }}>
              <button
                onClick={() => toggleSort('modifiedAt')}
                className="flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-1 text-xs font-medium transition-[color,background-color,transform] duration-150 ease-out hover:bg-blue-50 hover:text-blue-500 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30"
                style={{ color: colors.headerText }}
              >
                修改时间
                <SortIcon field="modifiedAt" activeField={sortField} direction={sortDirection} />
              </button>
            </TableHead>
            <TableHead className="w-20 pr-2 text-right">
              <span className="text-xs font-medium" style={{ color: colors.headerText }}>
                操作
              </span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sharedFiles.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={4}
                className="py-16 text-center text-sm"
                style={{ color: colors.emptyText }}
              >
                共享目录暂无文件
              </TableCell>
            </TableRow>
          ) : (
            sortedFiles.map((file) => (
              <TableRow key={file.path} className="transition-colors hover:bg-blue-50/40">
                <TableCell className="pr-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileIcon name={file.name} />
                    <span
                      className="truncate text-sm font-medium"
                      style={{ color: colors.fileName }}
                      title={file.name}
                    >
                      {file.name}
                    </span>
                  </div>
                </TableCell>
                <TableCell
                  className="pr-2 text-sm whitespace-nowrap"
                  style={{ color: colors.cellText }}
                >
                  {formatBytes(file.size)}
                </TableCell>
                <TableCell
                  className="pr-2 text-sm whitespace-nowrap"
                  style={{ color: colors.cellText }}
                >
                  {formatSmartDate(file.modifiedAt)}
                </TableCell>
                <TableCell className="pr-2 text-right">
                  <button
                    onClick={() => handleOpen(file)}
                    className="inline-flex cursor-pointer items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition-[opacity,transform] duration-150 ease-out hover:opacity-80 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30"
                    style={{ color: colors.actionButton }}
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
    </div>
  );
}
