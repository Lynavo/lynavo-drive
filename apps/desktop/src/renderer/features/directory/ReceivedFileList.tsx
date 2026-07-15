import { useMemo } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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
import {
  useDirectoryStore,
  type DirectorySortField,
  type ReceivedFileEntry,
} from '@renderer/stores/directory-store';
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

function SortIcon({ field }: { field: DirectorySortField }) {
  const sortField = useDirectoryStore((s) => s.sortField);
  const sortDirection = useDirectoryStore((s) => s.sortDirection);

  if (sortField !== field) {
    return <ArrowUpDown className="h-3 w-3 opacity-30" />;
  }
  return sortDirection === 'asc' ? (
    <ArrowUp className="h-3 w-3 text-blue-500" />
  ) : (
    <ArrowDown className="h-3 w-3 text-blue-500" />
  );
}

export function ReceivedFileList() {
  const { t } = useTranslation();
  const receivedFiles = useDirectoryStore((s) => s.receivedFiles);
  const receivedTotalBytes = useDirectoryStore((s) => s.receivedTotalBytes);
  const sortField = useDirectoryStore((s) => s.sortField);
  const sortDirection = useDirectoryStore((s) => s.sortDirection);
  const toggleSort = useDirectoryStore((s) => s.toggleSort);
  const loading = useDirectoryStore((s) => s.loading);
  const receivePath = useSettingsStore((s) => s.settings.receivePath);

  const sortedFiles = useMemo(() => {
    const result = [...receivedFiles];
    result.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'size':
          cmp = a.fileSize - b.fileSize;
          break;
        case 'completedAt':
          cmp = (a.completedAt ?? '').localeCompare(b.completedAt ?? '');
          break;
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });
    return result;
  }, [receivedFiles, sortField, sortDirection]);

  const handleOpen = (file: ReceivedFileEntry) => {
    if (!file.finalPath) return;
    const resolvedPath = resolveAbsolutePath(receivePath, file.finalPath);
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
          {t('directory.list.stats', {
            count: receivedFiles.length,
            size: formatBytes(receivedTotalBytes),
          })}
        </span>
      </div>

      {/* Table */}
      <Table className="table-fixed w-full">
        <TableHeader>
          <TableRow style={{ borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
            <TableHead className="pr-2" style={{ width: '30%' }}>
              <span className="text-xs font-medium" style={{ color: colors.headerText }}>
                {t('directory.list.fileName')}
              </span>
            </TableHead>
            <TableHead className="pr-2" style={{ width: '12%' }}>
              <button
                onClick={() => toggleSort('size')}
                className="flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-1 text-xs font-medium transition-[color,background-color,transform] duration-150 ease-out hover:bg-blue-50 hover:text-blue-500 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30"
                style={{ color: colors.headerText }}
              >
                {t('directory.list.size')}
                <SortIcon field="size" />
              </button>
            </TableHead>
            <TableHead className="pr-2" style={{ width: '18%' }}>
              <button
                onClick={() => toggleSort('completedAt')}
                className="flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-1 text-xs font-medium transition-[color,background-color,transform] duration-150 ease-out hover:bg-blue-50 hover:text-blue-500 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30"
                style={{ color: colors.headerText }}
              >
                {t('directory.list.receivedAt')}
                <SortIcon field="completedAt" />
              </button>
            </TableHead>
            <TableHead className="pr-2" style={{ width: '20%' }}>
              <span className="text-xs font-medium" style={{ color: colors.headerText }}>
                {t('directory.list.sourceDevice')}
              </span>
            </TableHead>
            <TableHead className="w-20 pr-2 text-right">
              <span className="text-xs font-medium" style={{ color: colors.headerText }}>
                {t('directory.list.actions')}
              </span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell
                colSpan={5}
                className="py-16 text-center text-sm"
                style={{ color: colors.emptyText }}
              >
                {t('directory.list.loading')}
              </TableCell>
            </TableRow>
          ) : sortedFiles.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={5}
                className="py-16 text-center text-sm"
                style={{ color: colors.emptyText }}
              >
                {t('directory.list.emptyReceived')}
              </TableCell>
            </TableRow>
          ) : (
            sortedFiles.map((file) => (
              <TableRow
                key={`${file.deviceId}-${file.fileKey}`}
                className="transition-colors hover:bg-blue-50/40"
              >
                <TableCell className="pr-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileIcon name={file.originalFilename} />
                    <span
                      className="truncate text-sm font-medium"
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
                  {formatSmartDate(file.completedAt)}
                </TableCell>
                <TableCell
                  className="pr-2 text-sm whitespace-nowrap"
                  style={{ color: colors.cellText }}
                >
                  {file.deviceName}
                </TableCell>
                <TableCell className="pr-2 text-right">
                  <button
                    onClick={() => handleOpen(file)}
                    disabled={!file.finalPath}
                    className="inline-flex cursor-pointer items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition-[opacity,transform] duration-150 ease-out hover:opacity-80 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30"
                    style={{ color: colors.actionButton }}
                    title={t('common.actions.openFile')}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {t('common.actions.open')}
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
