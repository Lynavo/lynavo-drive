import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Smartphone, Search, FileText, ChevronDown, Download, Globe, Wifi } from 'lucide-react';
import { useManagementStore } from '@renderer/stores/management-store';
import { Skeleton } from '@renderer/components/ui/skeleton';
import {
  previewAccessRecords,
  previewManagedDevices,
  shouldUsePreviewData,
} from '@renderer/features/preview/demo-data';
import type { DesktopAccessRecordDTO } from '@lynavo-drive/contracts';

const RECORDS_PER_PAGE = 5;

function getAccessActionLabelKey(action: DesktopAccessRecordDTO['action']): string {
  switch (action) {
    case 'list':
      return 'directory.records.actions.list';
    case 'view':
      return 'directory.records.actions.view';
    case 'download':
      return 'directory.records.actions.download';
    case 'error':
      return 'directory.records.actions.error';
    default:
      return action;
  }
}

function getAccessResultLabelKey(result: DesktopAccessRecordDTO['result']): string | null {
  switch (result) {
    case 'ok':
      return null;
    case 'missing':
      return 'directory.records.results.missing';
    case 'denied':
      return 'directory.records.results.denied';
    case 'error':
      return 'directory.records.results.error';
    default:
      return result;
  }
}

async function revealAccessRecordPath(localPath: string): Promise<void> {
  await window.electronAPI?.files.revealPath(localPath);
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map((part) => Number(part));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const [first, second] = parts;
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254) ||
    first === 127
  );
}

function getNetworkLabelKey(ip: string): string {
  if (!ip) return 'directory.records.network.missing';
  return isPrivateIPv4(ip) ? 'directory.records.network.lan' : 'directory.records.network.public';
}

export function RecordsPage() {
  const { t } = useTranslation();
  const accessRecords = useManagementStore((state) => state.accessRecords);
  const devices = useManagementStore((state) => state.devices);
  const loading = useManagementStore((state) => state.accessRecordsLoading);
  const error = useManagementStore((state) => state.accessRecordsError);
  const loadAccessRecords = useManagementStore((state) => state.loadAccessRecords);
  const loadDevices = useManagementStore((state) => state.loadDevices);

  const [searchQuery, setSearchQuery] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    void loadAccessRecords();
    void loadDevices();
  }, [loadAccessRecords, loadDevices]);

  const usingPreviewRecords = !loading && !error && shouldUsePreviewData(accessRecords.length > 0);
  const visibleAccessRecords = usingPreviewRecords ? previewAccessRecords : accessRecords;
  const visibleDevices =
    usingPreviewRecords && devices.length === 0 ? previewManagedDevices : devices;

  // Group access logs by device + date (YYYY-MM-DD)
  const groupedSessions = visibleAccessRecords.reduce(
    (acc, record) => {
      const dateKey = record.accessedAt ? record.accessedAt.split('T')[0] : '2026-06-11';
      const key = `${record.clientId}:${dateKey}`;

      const matchedDevice = visibleDevices.find(
        (d) => d.clientId === record.clientId || d.stableDeviceId === record.clientId,
      );
      const ip = matchedDevice?.lastIp ?? '';
      const platform = matchedDevice?.platform || 'iPhone';

      if (!acc[key]) {
        acc[key] = {
          key,
          clientId: record.clientId,
          displayName: record.displayName,
          platform,
          accessedAt: record.accessedAt,
          date: dateKey,
          ip,
          files: [] as Array<{
            key: string;
            name: string;
            localPath?: string;
            action: DesktopAccessRecordDTO['action'];
            result: DesktopAccessRecordDTO['result'];
          }>,
        };
      }

      if (record.resourceName) {
        const fileKey = `${record.resourceId}:${record.action}:${record.resourceName}:${
          record.localPath ?? ''
        }`;
        if (!acc[key].files.some((file) => file.key === fileKey)) {
          acc[key].files.push({
            key: fileKey,
            name: record.resourceName,
            localPath: record.localPath,
            action: record.action,
            result: record.result,
          });
        }
      }
      return acc;
    },
    {} as Record<
      string,
      {
        key: string;
        clientId: string;
        displayName: string;
        platform: string;
        accessedAt: string;
        date: string;
        ip: string;
        files: Array<{
          key: string;
          name: string;
          localPath?: string;
          action: DesktopAccessRecordDTO['action'];
          result: DesktopAccessRecordDTO['result'];
        }>;
      }
    >,
  );

  const sessions = Object.values(groupedSessions).sort((a, b) =>
    b.accessedAt.localeCompare(a.accessedAt),
  );

  const filteredSessions = sessions.filter((s) => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const nameMatch = s.displayName.toLowerCase().includes(q);
      const ipMatch = s.ip.includes(q);
      const fileMatch = s.files.some((f) => {
        const actionLabel = t(getAccessActionLabelKey(f.action)).toLowerCase();
        return (
          f.name.toLowerCase().includes(q) ||
          actionLabel.includes(q) ||
          (f.localPath?.toLowerCase().includes(q) ?? false)
        );
      });
      if (!nameMatch && !ipMatch && !fileMatch) return false;
    }
    if (startDate) {
      const formattedStart = startDate.replace(/\//g, '-');
      if (s.date < formattedStart) return false;
    }
    if (endDate) {
      const formattedEnd = endDate.replace(/\//g, '-');
      if (s.date > formattedEnd) return false;
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filteredSessions.length / RECORDS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const visibleSessions = filteredSessions.slice(
    (safePage - 1) * RECORDS_PER_PAGE,
    safePage * RECORDS_PER_PAGE,
  );
  const dateInputClass =
    'h-[46px] w-[150px] shrink-0 rounded-lg border border-white/70 bg-white/54 px-3 text-sm font-medium text-[#17191c] outline-none shadow-[0_10px_30px_rgba(90,120,170,0.08)] transition [font-variant-numeric:tabular-nums] focus:border-[#66c6ff] focus:bg-white/70 focus:ring-2 focus:ring-[#66c6ff]/18';

  useEffect(() => {
    setPage(1);
  }, [searchQuery, startDate, endDate]);

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[1460px] px-8 py-6">
        <header className="mb-5 flex min-h-12 items-center justify-between gap-5 border-b border-white/60 pb-5">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold leading-tight text-[#17191c]">
              {t('directory.records.title')}
            </h1>
          </div>
        </header>

        {/* Filter bar */}
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          {/* Search Input */}
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7b8490]" />
            <input
              type="text"
              placeholder={t('directory.records.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-white/70 bg-white/54 py-3 pl-10 pr-3 text-sm outline-none shadow-[0_10px_30px_rgba(90,120,170,0.08)] transition placeholder:text-[#9aa3af] focus:border-[#66c6ff] focus:bg-white/70 focus:ring-2 focus:ring-[#66c6ff]/18"
            />
          </div>

          {/* Date range inputs */}
          <div className="flex shrink-0 items-center gap-2">
            <input
              type="date"
              aria-label={t('directory.records.startDate')}
              value={startDate}
              max={endDate || undefined}
              onChange={(e) => setStartDate(e.target.value)}
              className={dateInputClass}
            />
            <span className="text-sm text-[#7b8490]">-</span>
            <input
              type="date"
              aria-label={t('directory.records.endDate')}
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => setEndDate(e.target.value)}
              className={dateInputClass}
            />
            {(startDate || endDate) && (
              <button
                type="button"
                onClick={() => {
                  setStartDate('');
                  setEndDate('');
                }}
                className="h-[46px] shrink-0 rounded-lg border border-white/70 bg-white/54 px-3 text-sm font-semibold text-[#59616d] transition hover:bg-white/78 hover:text-[#17191c]"
              >
                {t('directory.records.clear')}
              </button>
            )}
          </div>
        </div>

        {/* Access Log Sessions */}
        <div className="flex flex-col gap-4">
          {loading && sessions.length === 0 && (
            <div className="space-y-4">
              <Skeleton className="h-28 w-full rounded-lg" />
              <Skeleton className="h-28 w-full rounded-lg" />
            </div>
          )}

          {error && !loading && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 shadow-sm">
              {error}
            </div>
          )}

          {!loading && !error && filteredSessions.length === 0 && (
            <div className="rounded-lg border border-white/70 bg-white/46 px-5 py-10 text-center shadow-[0_18px_54px_rgba(70,96,138,0.1)] backdrop-blur-xl">
              <p className="text-sm font-semibold text-[#17191c]">
                {t('directory.records.empty.title')}
              </p>
              <p className="mt-1 text-xs text-[#7b8490]">
                {t('directory.records.empty.description')}
              </p>
            </div>
          )}

          {!error &&
            visibleSessions.map((session) => (
              <div
                key={session.key}
                className="rounded-lg border border-white/70 bg-white/46 p-5 shadow-[0_18px_54px_rgba(70,96,138,0.1)] backdrop-blur-xl"
              >
                {/* Header of card */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  {/* Left: Device Icon & Labels */}
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#eaf6ff] text-[#1677d2] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
                      <Smartphone className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-[#17191c]">
                        {session.displayName || t('directory.records.unnamedDevice')}
                      </h3>
                      <p className="mt-0.5 truncate text-xs text-[#626a76]">
                        {session.platform || 'iPhone'}
                      </p>
                    </div>
                  </div>

                  {/* Right: Date and actual network identity. Geolocation is not available here. */}
                  <div className="ml-auto flex shrink-0 items-center gap-3 text-xs font-medium text-[#4f5b68]">
                    <span className="w-[78px] whitespace-nowrap text-right [font-variant-numeric:tabular-nums]">
                      {session.date}
                    </span>
                    <span className="inline-flex h-6 shrink-0 items-center rounded-md border border-white/70 bg-white/52 px-2 font-semibold text-[#59616d]">
                      {t(getNetworkLabelKey(session.ip))}
                    </span>
                    <div className="inline-flex w-[128px] items-center justify-end gap-1.5 whitespace-nowrap font-mono [font-variant-numeric:tabular-nums]">
                      {isPrivateIPv4(session.ip) ? (
                        <Wifi className="h-3.5 w-3.5 shrink-0 text-[#7b8794]" />
                      ) : (
                        <Globe className="h-3.5 w-3.5 shrink-0 text-[#7b8794]" />
                      )}
                      <span>{session.ip || '-'}</span>
                    </div>
                  </div>
                </div>

                {/* Accessed Files Area */}
                <div className="mt-4 rounded-md border border-white/70 bg-white/52">
                  <div className="flex items-center gap-1.5 px-4 py-3 text-xs font-semibold text-[#4f5b68]">
                    <Download className="h-3.5 w-3.5 shrink-0 text-[#7b8794]" />
                    <span>
                      {t('directory.records.accessCount', { count: session.files.length })}
                    </span>
                  </div>

                  <ul className="grid grid-cols-1 gap-x-6 gap-y-1.5 border-t border-white/70 px-4 py-3 sm:grid-cols-2">
                    {session.files.map((file) => (
                      <li
                        key={file.key}
                        className="flex min-w-0 items-center gap-2 text-[13px] text-[#17191c]"
                      >
                        <FileText className="h-3.5 w-3.5 shrink-0 text-[#9aa2ad]" />
                        <span className="inline-flex shrink-0 items-center rounded border border-[#dbeafe] bg-[#eef6ff] px-1.5 py-px text-[11px] font-semibold leading-none text-[#1677d2]">
                          {t(getAccessActionLabelKey(file.action))}
                        </span>
                        {file.localPath ? (
                          <button
                            type="button"
                            title={file.localPath}
                            aria-label={t('directory.records.revealFile', { filename: file.name })}
                            onClick={() => {
                              void revealAccessRecordPath(file.localPath!).catch((err: unknown) => {
                                console.warn('[RecordsPage] reveal access record path failed', err);
                              });
                            }}
                            className="min-w-0 truncate text-left font-medium text-[#17191c] underline-offset-2 transition hover:text-[#1677d2] hover:underline"
                          >
                            {file.name}
                          </button>
                        ) : (
                          <span className="truncate" title={file.name}>
                            {file.name}
                          </span>
                        )}
                        {getAccessResultLabelKey(file.result) ? (
                          <span className="shrink-0 text-[11px] font-semibold text-[#e35b4a]">
                            {t(getAccessResultLabelKey(file.result)!)}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}

          {totalPages > 1 && (
            <nav
              className="flex items-center justify-center gap-2 pt-1"
              aria-label={t('directory.records.pagination')}
            >
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={safePage === 1}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-white/70 bg-white/52 px-3 text-xs font-semibold text-[#4f5b68] transition hover:bg-white/80 hover:text-[#17191c] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronDown className="h-3.5 w-3.5 rotate-90" />
                {t('directory.records.previousPage')}
              </button>
              {Array.from({ length: totalPages }, (_, index) => index + 1).map((pageNumber) => (
                <button
                  key={pageNumber}
                  type="button"
                  onClick={() => setPage(pageNumber)}
                  aria-current={safePage === pageNumber ? 'page' : undefined}
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-md text-xs font-semibold transition [font-variant-numeric:tabular-nums] ${
                    safePage === pageNumber
                      ? 'bg-[#1677d2] text-white shadow-[0_10px_22px_rgba(22,119,210,0.28)]'
                      : 'border border-white/70 bg-white/52 text-[#4f5b68] hover:bg-white/80 hover:text-[#17191c]'
                  }`}
                >
                  {pageNumber}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={safePage === totalPages}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-white/70 bg-white/52 px-3 text-xs font-semibold text-[#4f5b68] transition hover:bg-white/80 hover:text-[#17191c] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t('directory.records.nextPage')}
                <ChevronDown className="h-3.5 w-3.5 -rotate-90" />
              </button>
            </nav>
          )}
        </div>
      </div>
    </div>
  );
}
