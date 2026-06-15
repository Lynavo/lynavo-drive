import { useEffect, useState } from 'react';
import { FileClock, ShieldAlert } from 'lucide-react';
import type { DesktopAccessRecordDTO, DesktopSyncRecordDTO } from '@syncflow/contracts';
import { GlassCard } from '@renderer/components/shared/GlassCard';
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
import { formatBytes, formatDateTime } from '@renderer/lib/format';
import { useManagementStore } from '@renderer/stores/management-store';

type RecordsTab = 'sync' | 'access';

function syncStatusLabel(status: DesktopSyncRecordDTO['status']): string {
  return status === 'completed' ? '完成' : '失敗';
}

function EmptyState({ tab }: { tab: RecordsTab }) {
  const Icon = tab === 'sync' ? FileClock : ShieldAlert;
  return (
    <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white/50 px-6 py-10 text-center">
      <Icon className="h-8 w-8 text-slate-400" />
      <h2 className="mt-3 text-base font-semibold text-foreground">
        {tab === 'sync' ? '尚無同步紀錄' : '尚無存取紀錄'}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {tab === 'sync'
          ? '完成或失敗的檔案同步會顯示在這裡。'
          : '行動裝置存取本機共享資源的紀錄會顯示在這裡。'}
      </p>
    </div>
  );
}

function SyncRecordsTable({ records }: { records: DesktopSyncRecordDTO[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>檔名</TableHead>
          <TableHead>設備</TableHead>
          <TableHead>媒體類型</TableHead>
          <TableHead>大小</TableHead>
          <TableHead>狀態</TableHead>
          <TableHead>完成時間</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {records.map((record) => (
          <TableRow key={record.recordId}>
            <TableCell>
              <div className="flex flex-col">
                <span className="font-medium text-foreground">{record.filename}</span>
                <span className="text-xs text-muted-foreground">{record.fileKey}</span>
              </div>
            </TableCell>
            <TableCell>{record.displayName}</TableCell>
            <TableCell>{record.mediaType}</TableCell>
            <TableCell>{formatBytes(record.fileSize)}</TableCell>
            <TableCell>
              <Badge variant={record.status === 'completed' ? 'default' : 'destructive'}>
                {syncStatusLabel(record.status)}
              </Badge>
            </TableCell>
            <TableCell>{formatDateTime(record.completedAt ?? record.failedAt)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function AccessRecordsTable({ records }: { records: DesktopAccessRecordDTO[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>資源</TableHead>
          <TableHead>設備</TableHead>
          <TableHead>類型</TableHead>
          <TableHead>動作</TableHead>
          <TableHead>結果</TableHead>
          <TableHead>存取時間</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {records.map((record) => (
          <TableRow key={record.recordId}>
            <TableCell>
              <div className="flex flex-col">
                <span className="font-medium text-foreground">{record.resourceName}</span>
                <span className="text-xs text-muted-foreground">{record.resourceId}</span>
              </div>
            </TableCell>
            <TableCell>{record.displayName}</TableCell>
            <TableCell>{record.resourceKind}</TableCell>
            <TableCell>{record.action}</TableCell>
            <TableCell>{record.result}</TableCell>
            <TableCell>{formatDateTime(record.accessedAt)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function RecordsPage() {
  const [activeTab, setActiveTab] = useState<RecordsTab>('sync');
  const syncRecords = useManagementStore((state) => state.syncRecords);
  const accessRecords = useManagementStore((state) => state.accessRecords);
  const syncRecordsLoading = useManagementStore((state) => state.syncRecordsLoading);
  const accessRecordsLoading = useManagementStore((state) => state.accessRecordsLoading);
  const syncRecordsError = useManagementStore((state) => state.syncRecordsError);
  const accessRecordsError = useManagementStore((state) => state.accessRecordsError);
  const loadSyncRecords = useManagementStore((state) => state.loadSyncRecords);
  const loadAccessRecords = useManagementStore((state) => state.loadAccessRecords);

  useEffect(() => {
    void loadSyncRecords();
    void loadAccessRecords();
  }, [loadAccessRecords, loadSyncRecords]);

  const isSync = activeTab === 'sync';
  const loading = isSync ? syncRecordsLoading : accessRecordsLoading;
  const error = isSync ? syncRecordsError : accessRecordsError;
  const recordsCount = isSync ? syncRecords.length : accessRecords.length;

  return (
    <div className="flex flex-1 flex-col overflow-auto">
      <div className="mx-auto w-full max-w-6xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-[#1a2a3a]">紀錄</h1>
          <p className="mt-1 text-sm text-[#6b7a8d]">查詢本機保存的同步紀錄與資源存取紀錄。</p>
        </div>

        <GlassCard className="p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-lg bg-slate-100 p-1">
              <Button
                type="button"
                variant={isSync ? 'default' : 'ghost'}
                size="sm"
                aria-pressed={isSync}
                onClick={() => setActiveTab('sync')}
              >
                同步紀錄 {syncRecords.length}
              </Button>
              <Button
                type="button"
                variant={!isSync ? 'default' : 'ghost'}
                size="sm"
                aria-pressed={!isSync}
                onClick={() => setActiveTab('access')}
              >
                存取紀錄 {accessRecords.length}
              </Button>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                if (isSync) {
                  void loadSyncRecords();
                } else {
                  void loadAccessRecords();
                }
              }}
            >
              重新整理
            </Button>
          </div>

          {error && !loading && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {loading && recordsCount === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">載入紀錄中...</div>
          ) : recordsCount === 0 && !error ? (
            <EmptyState tab={activeTab} />
          ) : isSync ? (
            <SyncRecordsTable records={syncRecords} />
          ) : (
            <AccessRecordsTable records={accessRecords} />
          )}
        </GlassCard>
      </div>
    </div>
  );
}
