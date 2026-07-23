import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FileText,
  FolderOpen,
  HardDrive,
  ImageIcon,
  Smartphone,
  FileIcon as FileIconLucide,
  Share2,
  AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { useResourcesStore } from '@renderer/stores/resources-store';
import { useDashboardStore } from '@renderer/stores/dashboard-store';
import { useManagementStore } from '@renderer/stores/management-store';
import { formatBytes, formatSmartDate } from '@renderer/lib/format';
import { FileIcon } from '@renderer/components/shared/FileIcon';
import { Skeleton } from '@renderer/components/ui/skeleton';
import type { DeviceReceiveLocationDTO, ReceivedLibraryItemDTO } from '@lynavo-drive/contracts';
import { DeviceReceiveLocationDialog } from './DeviceReceiveLocationDialog';

interface LocationDialogState {
  sessionId: number;
  deviceName: string;
  locations: DeviceReceiveLocationDTO[];
  failedPaths: Set<string>;
  returnFocusElement: HTMLButtonElement;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function getMediaLabel(mediaType: string): { labelKey: string; color: string; bg: string } {
  const t = mediaType.toLowerCase();
  if (t.startsWith('video/'))
    return {
      labelKey: 'directory.library.media.video',
      color: '#3b82f6',
      bg: 'rgba(59,130,246,0.08)',
    };
  if (t.startsWith('image/'))
    return {
      labelKey: 'directory.library.media.photo',
      color: '#0ea5c9',
      bg: 'rgba(14,165,201,0.08)',
    };
  if (t.startsWith('audio/'))
    return {
      labelKey: 'directory.library.media.audio',
      color: '#a855f7',
      bg: 'rgba(168,85,247,0.08)',
    };
  return {
    labelKey: 'directory.library.media.file',
    color: '#6b7a8d',
    bg: 'rgba(107,122,141,0.08)',
  };
}

function getShareStatusBadge(shareStatus: ReceivedLibraryItemDTO['shareStatus']): {
  labelKey: string;
  color: string;
  bg: string;
  border: string;
} | null {
  switch (shareStatus) {
    case 'shared':
      return {
        labelKey: 'directory.library.shareStatus.shared',
        color: '#2c9c5a',
        bg: 'rgba(44,156,90,0.07)',
        border: 'rgba(44,156,90,0.18)',
      };
    case 'missing':
      return {
        labelKey: 'directory.library.shareStatus.missing',
        color: '#e35b4a',
        bg: 'rgba(227,91,74,0.07)',
        border: 'rgba(227,91,74,0.18)',
      };
    default:
      return null;
  }
}

function getReceivedItemKey(item: ReceivedLibraryItemDTO, index: number): string {
  if (item.resourceId.trim() !== '') return item.resourceId;
  if (item.fileKey.trim() !== '') return item.fileKey;
  return `${item.clientId}:${item.filename}:${item.completedAt}:${index}`;
}

function isReceivedImageItem(item: ReceivedLibraryItemDTO): boolean {
  const mediaType = item.mediaType.toLowerCase();
  return (
    mediaType === 'image' ||
    mediaType.startsWith('image/') ||
    /\.(jpe?g|png|gif)$/i.test(item.filename)
  );
}

function ReceivedItemVisual({ item }: { item: ReceivedLibraryItemDTO }) {
  const { t } = useTranslation();
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const thumbnailUrl =
    isReceivedImageItem(item) && !thumbnailFailed ? item.thumbnailUrl?.trim() : undefined;

  if (thumbnailUrl) {
    return (
      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-[rgba(14,165,201,0.09)] shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]">
        <img
          data-testid="received-library-thumbnail-image"
          src={thumbnailUrl}
          alt={t('directory.library.thumbnailAlt', { filename: item.filename })}
          className="h-full w-full object-cover"
          onError={() => setThumbnailFailed(true)}
        />
      </div>
    );
  }

  return <FileIcon name={item.filename} className="h-10 w-10 shrink-0" />;
}

// ─── FileItemRow ─────────────────────────────────────────────────────────────

function FileItemRow({
  item,
  deviceDisplayName,
}: {
  item: ReceivedLibraryItemDTO;
  deviceDisplayName: string;
}) {
  const { t } = useTranslation();
  const mediaLabel = getMediaLabel(item.mediaType);
  const statusBadge = getShareStatusBadge(item.shareStatus);
  const StatusIcon = item.shareStatus === 'shared' ? Share2 : AlertCircle;

  return (
    <div className="flex items-center gap-4 rounded-lg border border-white/55 bg-white/28 px-4 py-3 shadow-[0_8px_28px_rgba(70,96,138,0.06)] transition hover:-translate-y-px hover:bg-white/48 hover:shadow-[0_12px_36px_rgba(70,96,138,0.10)]">
      <ReceivedItemVisual item={item} />

      {/* Main info */}
      <div className="min-w-0 flex-1">
        <p
          className="truncate text-[13px] font-semibold leading-snug"
          style={{ color: '#17191c' }}
          title={item.filename}
        >
          {item.filename}
        </p>
        <div className="mt-1 flex items-center gap-2">
          {/* Media type badge */}
          <span
            className="inline-flex items-center rounded px-1.5 py-px text-[11px] font-semibold leading-none"
            style={{
              color: mediaLabel.color,
              background: mediaLabel.bg,
            }}
          >
            {t(mediaLabel.labelKey)}
          </span>
          <span className="text-[12px] text-[#97a3b0]">{'\u00b7'}</span>
          <span className="text-[12px] font-medium text-[#8a96a3]">
            {formatBytes(item.fileSize)}
          </span>
          <span className="text-[12px] text-[#97a3b0]">{'\u00b7'}</span>
          <span className="text-[12px] text-[#8a96a3]">{formatSmartDate(item.completedAt)}</span>
        </div>
      </div>

      {/* Right: device name + status */}
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <span className="flex items-center gap-1 text-[12px] font-medium text-[#626a76]">
          <Smartphone className="h-3 w-3 text-[#97a3b0]" />
          {deviceDisplayName}
        </span>
        {statusBadge ? (
          <span
            className="inline-flex items-center gap-1 rounded border px-1.5 py-px text-[11px] font-semibold leading-none"
            style={{
              color: statusBadge.color,
              background: statusBadge.bg,
              borderColor: statusBadge.border,
            }}
          >
            <StatusIcon className="h-2.5 w-2.5" />
            {t(statusBadge.labelKey)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ─── ReceivedLibraryPage ─────────────────────────────────────────────────────

export function ReceivedLibraryPage() {
  const { t } = useTranslation();
  const {
    receivedItems,
    receivedLoading,
    receivedLoadingMore,
    receivedError,
    receivedTotalItems,
    receivedTotalBytes,
    receivedDeviceStats,
    receivedHasMore,
    loadReceivedLibrary,
    loadMoreReceivedLibrary,
  } = useResourcesStore();

  const summary = useDashboardStore((s) => s.summary);
  const dashboardDevices = useDashboardStore((s) => s.devices);
  const managedDevices = useManagementStore((s) => s.devices);
  const loadDevices = useManagementStore((s) => s.loadDevices);
  const fetchDashboard = useDashboardStore((s) => s.fetchDashboard);
  const scrollRegionRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const locationQueryRequestRef = useRef(0);
  const nextLocationDialogSessionRef = useRef(0);
  const activeLocationDialogSessionRef = useRef<number | null>(null);
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  const [locationDialogState, setLocationDialogState] = useState<LocationDialogState | null>(null);

  useEffect(() => {
    void loadReceivedLibrary();
    void loadDevices();
    void fetchDashboard();
  }, [loadReceivedLibrary, loadDevices, fetchDashboard]);

  const visibleReceivedItems = receivedItems;
  const visibleManagedDevices = managedDevices;
  const visibleDashboardDevices = dashboardDevices;

  // Build a clientId → displayName map
  const deviceNameMap = new Map<string, string>(
    visibleManagedDevices.map((d) => [d.clientId, d.displayName]),
  );
  const dashboardDeviceMap = new Map<string, (typeof visibleDashboardDevices)[number]>(
    visibleDashboardDevices.map((d) => [d.deviceId, d]),
  );
  const receivedDeviceDisplayNameMap = new Map<string, string>(
    visibleReceivedItems.map((item) => [item.clientId, item.displayName]),
  );

  useEffect(() => {
    if (
      receivedLoading ||
      receivedLoadingMore ||
      !receivedHasMore ||
      typeof IntersectionObserver === 'undefined'
    ) {
      return;
    }

    const target = loadMoreRef.current;
    if (!target) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMoreReceivedLibrary();
        }
      },
      {
        root: scrollRegionRef.current,
        rootMargin: '180px 0px',
      },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [receivedLoading, receivedLoadingMore, receivedHasMore, loadMoreReceivedLibrary]);

  // Calculations for stats cards
  const totalFiles = receivedTotalItems;
  const totalOccupiedSpace = receivedTotalBytes;

  // Group received items by device (clientId)
  const statsByDevice = receivedDeviceStats.reduce(
    (acc, stat) => {
      acc[stat.clientId] = {
        photoCount: stat.photoCount,
        fileCount: stat.fileCount,
        totalBytes: stat.totalBytes,
      };
      return acc;
    },
    {} as Record<string, { photoCount: number; fileCount: number; totalBytes: number }>,
  );

  // Managed devices provide metadata; received stats provide fallback rows while management is loading.
  const managedDeviceIds = new Set(visibleManagedDevices.map((d) => d.clientId));
  const managedDeviceList = visibleManagedDevices.map((d) => {
    const stats = statsByDevice[d.clientId] || {
      photoCount: 0,
      fileCount: 0,
      totalBytes: 0,
    };
    return {
      clientId: d.clientId,
      displayName: d.displayName,
      platform: d.platform,
      ...stats,
    };
  });
  const fallbackDeviceList = Object.entries(statsByDevice)
    .filter(([clientId]) => !managedDeviceIds.has(clientId))
    .map(([clientId, stats]) => {
      const dashboardDevice = dashboardDeviceMap.get(clientId);
      return {
        clientId,
        displayName:
          dashboardDevice?.displayName ?? receivedDeviceDisplayNameMap.get(clientId) ?? clientId,
        platform: dashboardDevice?.platform ?? t('directory.library.mobileDevice'),
        ...stats,
      };
    });
  const deviceList = [...managedDeviceList, ...fallbackDeviceList];

  const handleOpenFolder = async (
    clientId: string,
    displayName: string,
    returnFocusElement: HTMLButtonElement,
  ) => {
    const requestId = ++locationQueryRequestRef.current;
    const getReceiveLocations = window.electronAPI?.sidecar.getDeviceReceiveLocations;
    if (!getReceiveLocations) {
      toast.error(t('directory.library.toasts.receiveLocationsUnavailable'));
      return;
    }

    try {
      const locations = await getReceiveLocations(clientId);
      if (requestId !== locationQueryRequestRef.current) return;

      if (locations.length === 0) {
        toast.error(t('directory.library.toasts.noReceiveLocations'));
        return;
      }

      if (locations.length === 1 && locations[0].available) {
        const openFolder = window.electronAPI?.files.openFolder;
        if (!openFolder) {
          toast.error(t('directory.library.toasts.fileManagerUnavailable'));
          return;
        }

        try {
          await openFolder(locations[0].path);
        } catch {
          if (requestId === locationQueryRequestRef.current) {
            toast.error(t('directory.library.toasts.devicePathMissing'));
          }
        }
        return;
      }

      const sessionId = ++nextLocationDialogSessionRef.current;
      activeLocationDialogSessionRef.current = sessionId;
      setLocationDialogState({
        sessionId,
        deviceName: displayName,
        locations,
        failedPaths: new Set(),
        returnFocusElement,
      });
      setLocationDialogOpen(true);
    } catch {
      if (requestId === locationQueryRequestRef.current) {
        toast.error(t('directory.library.toasts.receiveLocationsUnavailable'));
      }
    }
  };

  const markLocationUnavailable = (sessionId: number, path: string) => {
    setLocationDialogState((current) =>
      current?.sessionId === sessionId
        ? {
            ...current,
            failedPaths: new Set(current.failedPaths).add(path),
          }
        : current,
    );
  };

  const handleOpenLocation = (location: DeviceReceiveLocationDTO) => {
    const sessionId = locationDialogState?.sessionId;
    if (sessionId == null || activeLocationDialogSessionRef.current !== sessionId) return;

    const openFolder = window.electronAPI?.files.openFolder;
    if (!openFolder) {
      markLocationUnavailable(sessionId, location.path);
      toast.error(t('directory.library.toasts.fileManagerUnavailable'));
      return;
    }

    void openFolder(location.path)
      .then(() => {
        if (activeLocationDialogSessionRef.current !== sessionId) return;
        activeLocationDialogSessionRef.current = null;
        setLocationDialogOpen(false);
      })
      .catch(() => {
        if (activeLocationDialogSessionRef.current !== sessionId) return;
        markLocationUnavailable(sessionId, location.path);
        toast.error(t('directory.library.toasts.devicePathMissing'));
      });
  };

  const handleLocationDialogOpenChange = (open: boolean) => {
    if (!open) activeLocationDialogSessionRef.current = null;
    setLocationDialogOpen(open);
  };

  return (
    <div data-testid="received-library-root" className="min-h-0 flex-1 overflow-hidden">
      <div className="mx-auto flex h-full min-h-0 max-w-[1460px] flex-col px-8 py-6">
        <div data-testid="received-library-fixed-summary" className="shrink-0">
          <header className="mb-5 flex min-h-12 items-center justify-between gap-5 border-b border-white/60 pb-5">
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold leading-tight text-[#17191c]">
                {t('directory.library.title')}
              </h1>
            </div>
          </header>

          {/* 3 Overview Stat Cards */}
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {/* Card 1: Total Files */}
            <div className="flex min-h-[84px] items-center gap-4 rounded-lg border border-white/70 bg-[#f0f8ff]/72 px-5 py-4 text-[#2788dc] shadow-[0_14px_36px_rgba(75,158,226,0.11)] backdrop-blur-xl">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[#48a7f4] text-white shadow-[0_12px_26px_rgba(72,167,244,0.28)]">
                <FileText className="h-5 w-5" />
              </div>
              <div className="min-w-0 text-left">
                <p className="truncate text-xs font-semibold text-[#697786]">
                  {t('directory.library.stats.totalFiles')}
                </p>
                <p className="mt-1 text-2xl font-semibold leading-none text-[#17191c]">
                  {totalFiles}
                </p>
              </div>
            </div>

            {/* Card 2: Total Space */}
            <div className="flex min-h-[84px] items-center gap-4 rounded-lg border border-white/70 bg-[#f1fbf3]/76 px-5 py-4 text-[#2c9c5a] shadow-[0_14px_36px_rgba(64,176,101,0.11)] backdrop-blur-xl">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[#46c878] text-white shadow-[0_12px_26px_rgba(70,200,120,0.25)]">
                <HardDrive className="h-5 w-5" />
              </div>
              <div className="min-w-0 text-left">
                <p className="truncate text-xs font-semibold text-[#697786]">
                  {t('directory.library.stats.totalSpace')}
                </p>
                <p className="mt-1 text-2xl font-semibold leading-none text-[#17191c]">
                  {formatBytes(totalOccupiedSpace)}
                </p>
              </div>
            </div>

            {/* Card 3: Remaining Space */}
            <div className="flex min-h-[84px] items-center gap-4 rounded-lg border border-white/70 bg-[#eefbff]/74 px-5 py-4 text-[#14a4d8] shadow-[0_14px_36px_rgba(49,176,215,0.11)] backdrop-blur-xl">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[#22b5e4] text-white shadow-[0_12px_26px_rgba(34,181,228,0.24)]">
                <HardDrive className="h-5 w-5" />
              </div>
              <div className="min-w-0 text-left">
                <p className="truncate text-xs font-semibold text-[#697786]">
                  {t('directory.library.stats.remainingSpace')}
                </p>
                <p className="mt-1 text-2xl font-semibold leading-none text-[#17191c]">
                  {formatBytes(summary.remainingBytes)}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div
          ref={scrollRegionRef}
          data-testid="received-library-scroll-region"
          className="min-h-0 flex-1 overflow-auto pr-1"
        >
          {/* Sync Device Summary List */}
          <div className="mb-2 flex justify-end">
            <span className="px-1 text-xs font-semibold text-[#7b8490]">
              {t('directory.library.deviceCount', { count: deviceList.length })}
            </span>
          </div>

          <div className="flex flex-col gap-3 border-y border-white/60 py-3">
            {receivedLoading && deviceList.length === 0 && (
              <div className="space-y-3">
                <Skeleton className="h-16 w-full rounded-lg" />
                <Skeleton className="h-16 w-full rounded-lg" />
              </div>
            )}

            {receivedError && !receivedLoading && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 shadow-sm">
                {receivedError}
              </div>
            )}

            {!receivedLoading && !receivedError && deviceList.length === 0 && (
              <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-white/70 bg-white/24 px-6 text-center">
                <FolderOpen className="h-8 w-8 text-slate-400" />
                <h2 className="mt-3 text-sm font-bold text-slate-800">
                  {t('directory.library.empty.title')}
                </h2>
                <p className="mt-1 text-xs text-slate-400">
                  {t('directory.library.empty.description')}
                </p>
              </div>
            )}

            {!receivedError &&
              deviceList.map((device) => (
                <div
                  key={device.clientId}
                  className="rounded-lg border border-white/60 bg-white/34 px-4 py-4 text-left shadow-[0_14px_44px_rgba(70,96,138,0.08)] transition hover:-translate-y-0.5 hover:bg-white/58"
                >
                  <div className="grid grid-cols-[40px_minmax(0,1fr)_auto_76px] items-center gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#eaf6ff] text-[#1677d2] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
                      <Smartphone className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold text-[#17191c]">
                        {device.displayName || t('directory.library.unnamedDevice')}
                      </h3>
                      <p className="mt-0.5 truncate text-xs text-[#626a76]">
                        {device.platform || 'iPhone'}
                      </p>
                    </div>

                    {/* Statistics counts in middle */}
                    <div className="flex shrink-0 items-center gap-3 text-xs font-semibold text-[#4f5b68] [font-variant-numeric:tabular-nums]">
                      <span className="flex items-center gap-1">
                        <ImageIcon className="h-3.5 w-3.5 shrink-0 text-[#7b8794]" />
                        {t('directory.library.deviceStats.photoUploads', {
                          count: device.photoCount,
                        })}
                      </span>
                      <span className="flex items-center gap-1">
                        <FileIconLucide className="h-3.5 w-3.5 shrink-0 text-[#7b8794]" />
                        {t('directory.library.deviceStats.fileUploads', {
                          count: device.fileCount,
                        })}
                      </span>
                      <span className="flex items-center gap-1">
                        <HardDrive className="h-3.5 w-3.5 shrink-0 text-[#7b8794]" />
                        {formatBytes(device.totalBytes)}
                      </span>
                    </div>

                    {/* Open Folder Button */}
                    <button
                      type="button"
                      onClick={(event) => {
                        void handleOpenFolder(
                          device.clientId,
                          device.displayName || t('directory.library.unnamedDevice'),
                          event.currentTarget,
                        );
                      }}
                      className="flex h-12 w-[76px] items-center justify-center rounded-lg border border-[#cdeeff]/80 bg-[#edf8ff]/78 text-[#1677d2] shadow-[0_10px_24px_rgba(67,157,220,0.1)] transition hover:-translate-y-0.5 hover:bg-[#dff2ff] hover:text-[#0d68bd] hover:shadow-[0_16px_34px_rgba(67,157,220,0.15)]"
                      title={t('directory.library.openFolder')}
                    >
                      <FolderOpen className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              ))}
          </div>

          {/* ── File List ── */}
          {!receivedLoading && !receivedError && visibleReceivedItems.length > 0 && (
            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[#3d4653]">
                  {t('directory.library.filesTitle')}
                </h2>
                <span className="text-xs font-semibold text-[#7b8490]">
                  {visibleReceivedItems.length >= totalFiles
                    ? t('directory.library.loadedAll', { count: visibleReceivedItems.length })
                    : t('directory.library.loadedPartial', {
                        loaded: visibleReceivedItems.length,
                        total: totalFiles,
                      })}
                </span>
              </div>

              <div className="flex flex-col gap-2">
                {receivedLoading ? (
                  <div className="space-y-2">
                    {[...Array(4)].map((_, i) => (
                      <Skeleton key={i} className="h-[60px] w-full rounded-lg" />
                    ))}
                  </div>
                ) : (
                  visibleReceivedItems.map((item, index) => (
                    <FileItemRow
                      key={getReceivedItemKey(item, index)}
                      item={item}
                      deviceDisplayName={deviceNameMap.get(item.clientId) ?? item.displayName}
                    />
                  ))
                )}
                {receivedHasMore ? (
                  <div
                    ref={loadMoreRef}
                    data-testid="received-library-load-more-sentinel"
                    className="flex h-12 items-center justify-center text-xs font-semibold text-[#7b8490]"
                  >
                    {receivedLoadingMore
                      ? t('directory.library.loadingMore')
                      : t('directory.library.loadMore')}
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
      <DeviceReceiveLocationDialog
        open={locationDialogOpen}
        deviceName={locationDialogState?.deviceName ?? ''}
        locations={
          locationDialogState?.locations.map((location) =>
            locationDialogState.failedPaths.has(location.path)
              ? { ...location, available: false }
              : location,
          ) ?? []
        }
        returnFocusElement={locationDialogState?.returnFocusElement ?? null}
        onOpenChange={handleLocationDialogOpenChange}
        onOpenLocation={handleOpenLocation}
      />
    </div>
  );
}
