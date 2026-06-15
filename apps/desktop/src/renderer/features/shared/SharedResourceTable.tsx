import { useTranslation } from 'react-i18next';
import { FileIcon, Folder, AlertCircle, Trash2, Download } from 'lucide-react';
import type { DesktopSharedResourceDTO } from '@syncflow/contracts';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@renderer/components/ui/table';
import { formatBytes, formatSmartDate } from '@renderer/lib/format';

interface SharedResourceTableProps {
  resources: DesktopSharedResourceDTO[];
  onRemove: (resourceId: string) => void;
}

export function SharedResourceTable({ resources, onRemove }: SharedResourceTableProps) {
  const { t } = useTranslation();

  const getKindLabel = (kind: string) => {
    switch (kind) {
      case 'shared_file':
        return t('common.shared.kindFile');
      case 'shared_folder':
        return t('common.shared.kindFolder');
      case 'received_file':
        return t('common.shared.kindReceived');
      default:
        return kind;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'available':
        return (
          <Badge variant="default" className="bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15">
            {t('common.shared.statusAvailable')}
          </Badge>
        );
      case 'missing':
        return (
          <Badge variant="destructive" className="bg-rose-500/10 text-rose-700 hover:bg-rose-500/15 flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            {t('common.shared.statusMissing')}
          </Badge>
        );
      case 'removed':
        return (
          <Badge variant="secondary" className="bg-slate-500/10 text-slate-700 hover:bg-slate-500/15">
            {t('common.shared.statusRemoved')}
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (resources.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-sm text-muted-foreground">{t('common.shared.noData')}</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/20 bg-white/40 shadow-sm overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-100/50 hover:bg-slate-100/50">
            <TableHead className="font-semibold text-slate-800">{t('common.shared.tableName')}</TableHead>
            <TableHead className="font-semibold text-slate-800">{t('common.shared.tableKind')}</TableHead>
            <TableHead className="font-semibold text-slate-800">{t('common.shared.tableSize')}</TableHead>
            <TableHead className="font-semibold text-slate-800">{t('common.shared.tableStatus')}</TableHead>
            <TableHead className="font-semibold text-slate-800">{t('common.shared.tableDownloads')}</TableHead>
            <TableHead className="font-semibold text-slate-800">{t('common.shared.tableLastAccessed')}</TableHead>
            <TableHead className="font-semibold text-slate-800">{t('common.shared.tableAddedAt')}</TableHead>
            <TableHead className="text-right font-semibold text-slate-800">{t('common.shared.tableActions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {resources.map((resource) => (
            <TableRow key={resource.resourceId} className="hover:bg-white/50 transition-colors">
              <TableCell className="font-medium text-slate-900 max-w-[200px] truncate">
                <div className="flex items-center gap-2">
                  {resource.kind === 'shared_folder' ? (
                    <Folder className="h-4 w-4 text-blue-500 shrink-0" />
                  ) : (
                    <FileIcon className="h-4 w-4 text-slate-500 shrink-0" />
                  )}
                  <span className="truncate" title={resource.displayName}>
                    {resource.displayName}
                  </span>
                </div>
              </TableCell>
              <TableCell className="text-slate-600 text-sm">
                {getKindLabel(resource.kind)}
              </TableCell>
              <TableCell className="text-slate-600 text-sm">
                {resource.fileSize ? formatBytes(resource.fileSize) : '\u2014'}
              </TableCell>
              <TableCell>{getStatusBadge(resource.status)}</TableCell>
              <TableCell className="text-slate-600 text-sm">
                <div className="flex items-center gap-1">
                  <Download className="h-3 w-3 text-slate-400" />
                  {resource.downloadCount}
                </div>
              </TableCell>
              <TableCell className="text-slate-600 text-sm">
                {formatSmartDate(resource.lastAccessedAt)}
              </TableCell>
              <TableCell className="text-slate-600 text-sm">
                {formatSmartDate(resource.addedAt)}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0 text-slate-500 hover:text-rose-600 hover:bg-rose-50/50"
                  aria-label={t('common.shared.remove')}
                  onClick={() => onRemove(resource.resourceId)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
