import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FileIcon, Plus, Loader2 } from 'lucide-react';
import { useResourcesStore } from '@renderer/stores/resources-store';
import { useDashboardStore } from '@renderer/stores/dashboard-store';
import { GlassCard } from '@renderer/components/shared/GlassCard';
import { Button } from '@renderer/components/ui/button';
import { Skeleton } from '@renderer/components/ui/skeleton';
import { ErrorState } from '@renderer/components/shared/ErrorState';
import { Badge } from '@renderer/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@renderer/components/ui/table';
import { formatBytes, formatSmartDate } from '@renderer/lib/format';

export function ReceivedLibraryPage() {
  const { t } = useTranslation();
  const {
    receivedItems,
    receivedLoading,
    receivedError,
    loadReceivedLibrary,
    addSharedFromReceived,
  } = useResourcesStore();

  const dashboardDevices = useDashboardStore((s) => s.devices);

  useEffect(() => {
    void loadReceivedLibrary();
  }, [loadReceivedLibrary]);

  const getSourceDeviceName = (clientId: string) => {
    const matched = dashboardDevices.find(
      (d) => d.stableDeviceId === clientId || d.deviceId === clientId,
    );
    return matched?.displayName || clientId;
  };

  const getShareStatusBadge = (status: string) => {
    switch (status) {
      case 'shared':
        return (
          <Badge variant="default" className="bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15">
            {t('common.library.statusShared')}
          </Badge>
        );
      case 'not_shared':
        return (
          <Badge variant="secondary" className="bg-slate-500/10 text-slate-700 hover:bg-slate-500/15">
            {t('common.library.statusNotShared')}
          </Badge>
        );
      case 'missing':
        return (
          <Badge variant="destructive" className="bg-rose-500/10 text-rose-700 hover:bg-rose-500/15">
            {t('common.library.statusMissing')}
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="flex-1 overflow-auto px-6 py-8">
      <div className="mx-auto max-w-6xl">
        {/* Header section */}
        <div className="mb-6">
          <h1 className="text-xl font-bold text-slate-900">{t('layout.placeholders.library.title')}</h1>
          <p className="mt-1 text-sm text-slate-500">{t('layout.placeholders.library.description')}</p>
        </div>

        {/* Error State */}
        {receivedError && (
          <GlassCard className="p-6 mb-6">
            <ErrorState message={receivedError} onRetry={loadReceivedLibrary} />
          </GlassCard>
        )}

        {/* Content area */}
        {receivedLoading && receivedItems.length === 0 ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-full rounded-xl" />
            <Skeleton className="h-32 w-full rounded-xl" />
          </div>
        ) : (
          <GlassCard className="p-6 border-white/20">
            {receivedLoading && (
              <div className="mb-4 flex items-center gap-2 text-xs text-blue-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>{t('common.fallback.loading')}</span>
              </div>
            )}

            {receivedItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <p className="text-sm text-muted-foreground">{t('common.library.noData')}</p>
              </div>
            ) : (
              <div className="rounded-xl border border-white/20 bg-white/40 shadow-sm overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-100/50 hover:bg-slate-100/50">
                      <TableHead className="font-semibold text-slate-800">{t('common.library.tableName')}</TableHead>
                      <TableHead className="font-semibold text-slate-800">{t('common.library.tableMediaType')}</TableHead>
                      <TableHead className="font-semibold text-slate-800">{t('common.library.tableSize')}</TableHead>
                      <TableHead className="font-semibold text-slate-800">{t('common.library.tableSource')}</TableHead>
                      <TableHead className="font-semibold text-slate-800">{t('common.library.tableCompletedAt')}</TableHead>
                      <TableHead className="font-semibold text-slate-800">{t('common.library.tableShareStatus')}</TableHead>
                      <TableHead className="text-right font-semibold text-slate-800">{t('common.library.tableActions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {receivedItems.map((item) => (
                      <TableRow key={item.resourceId} className="hover:bg-white/50 transition-colors">
                        <TableCell className="font-medium text-slate-900 max-w-[200px] truncate">
                          <div className="flex items-center gap-2">
                            <FileIcon className="h-4 w-4 text-slate-500 shrink-0" />
                            <span className="truncate" title={item.filename}>
                              {item.filename}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-slate-600 text-sm">
                          {item.mediaType || '\u2014'}
                        </TableCell>
                        <TableCell className="text-slate-600 text-sm">
                          {formatBytes(item.fileSize)}
                        </TableCell>
                        <TableCell className="text-slate-600 text-sm">
                          {getSourceDeviceName(item.clientId)}
                        </TableCell>
                        <TableCell className="text-slate-600 text-sm">
                          {formatSmartDate(item.completedAt)}
                        </TableCell>
                        <TableCell>{getShareStatusBadge(item.shareStatus)}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="bg-white/80 border-white/30 hover:bg-white flex items-center gap-1.5 ml-auto text-xs"
                            disabled={item.shareStatus === 'shared'}
                            onClick={() => addSharedFromReceived(item)}
                          >
                            <Plus className="h-3.5 w-3.5 text-blue-600" />
                            {t('common.library.addToShared')}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </GlassCard>
        )}
      </div>
    </div>
  );
}
