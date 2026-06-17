import { useEffect } from 'react';
import {
  FileText,
  FolderOpen,
  HardDrive,
  ImageIcon,
  Smartphone,
  FileIcon as FileIconLucide,
  Share2,
  Monitor,
  AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { useResourcesStore } from '@renderer/stores/resources-store';
import { useDashboardStore } from '@renderer/stores/dashboard-store';
import { useManagementStore } from '@renderer/stores/management-store';
import { useSettingsStore } from '@renderer/stores/settings-store';
import { formatBytes, formatSmartDate } from '@renderer/lib/format';
import { FileIcon } from '@renderer/components/shared/FileIcon';
import { Skeleton } from '@renderer/components/ui/skeleton';
import {
  previewManagedDevices,
  previewReceivedLibraryItems,
  shouldUsePreviewData,
} from '@renderer/features/preview/demo-data';
import type { ReceivedLibraryItemDTO } from '@syncflow/contracts';

// ─── helpers ────────────────────────────────────────────────────────────────

function getMediaLabel(mediaType: string): { label: string; color: string; bg: string } {
  const t = mediaType.toLowerCase();
  if (t.startsWith('video/')) return { label: '视频', color: '#3b82f6', bg: 'rgba(59,130,246,0.08)' };
  if (t.startsWith('image/')) return { label: '照片', color: '#0ea5c9', bg: 'rgba(14,165,201,0.08)' };
  if (t.startsWith('audio/')) return { label: '音频', color: '#a855f7', bg: 'rgba(168,85,247,0.08)' };
  return { label: '文件', color: '#6b7a8d', bg: 'rgba(107,122,141,0.08)' };
}

function getShareStatusBadge(
  shareStatus: ReceivedLibraryItemDTO['shareStatus'],
): { label: string; color: string; bg: string; border: string } {
  switch (shareStatus) {
    case 'shared':
      return {
        label: '已共享至手机',
        color: '#2c9c5a',
        bg: 'rgba(44,156,90,0.07)',
        border: 'rgba(44,156,90,0.18)',
      };
    case 'missing':
      return {
        label: '文件丢失',
        color: '#e35b4a',
        bg: 'rgba(227,91,74,0.07)',
        border: 'rgba(227,91,74,0.18)',
      };
    default:
      return {
        label: '仅电脑端存在',
        color: '#697786',
        bg: 'rgba(105,119,134,0.07)',
        border: 'rgba(105,119,134,0.18)',
      };
  }
}

function getReceivedItemKey(item: ReceivedLibraryItemDTO, index: number): string {
  if (item.resourceId.trim() !== '') return item.resourceId;
  if (item.fileKey.trim() !== '') return item.fileKey;
  return `${item.clientId}:${item.filename}:${item.completedAt}:${index}`;
}

// ─── FileItemRow ─────────────────────────────────────────────────────────────

function FileItemRow({
  item,
  deviceDisplayName,
}: {
  item: ReceivedLibraryItemDTO;
  deviceDisplayName: string;
}) {
  const mediaLabel = getMediaLabel(item.mediaType);
  const statusBadge = getShareStatusBadge(item.shareStatus);

  const StatusIcon =
    item.shareStatus === 'shared'
      ? Share2
      : item.shareStatus === 'missing'
        ? AlertCircle
        : Monitor;

  return (
    <div className="flex items-center gap-4 rounded-lg border border-white/55 bg-white/28 px-4 py-3 shadow-[0_8px_28px_rgba(70,96,138,0.06)] transition hover:-translate-y-px hover:bg-white/48 hover:shadow-[0_12px_36px_rgba(70,96,138,0.10)]">
      {/* File type icon */}
      <FileIcon name={item.filename} className="h-10 w-10 shrink-0" />

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
            {mediaLabel.label}
          </span>
          <span className="text-[12px] text-[#97a3b0]">·</span>
          <span className="text-[12px] font-medium text-[#8a96a3]">
            {formatBytes(item.fileSize)}
          </span>
          <span className="text-[12px] text-[#97a3b0]">·</span>
          <span className="text-[12px] text-[#8a96a3]">{formatSmartDate(item.completedAt)}</span>
        </div>
      </div>

      {/* Right: device name + status */}
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <span className="flex items-center gap-1 text-[12px] font-medium text-[#626a76]">
          <Smartphone className="h-3 w-3 text-[#97a3b0]" />
          {deviceDisplayName}
        </span>
        <span
          className="inline-flex items-center gap-1 rounded border px-1.5 py-px text-[11px] font-semibold leading-none"
          style={{
            color: statusBadge.color,
            background: statusBadge.bg,
            borderColor: statusBadge.border,
          }}
        >
          <StatusIcon className="h-2.5 w-2.5" />
          {statusBadge.label}
        </span>
      </div>
    </div>
  );
}

// ─── ReceivedLibraryPage ─────────────────────────────────────────────────────

export function ReceivedLibraryPage() {
  const { receivedItems, receivedLoading, receivedError, loadReceivedLibrary } =
    useResourcesStore();

  const settings = useSettingsStore((s) => s.settings);
  const summary = useDashboardStore((s) => s.summary);
  const managedDevices = useManagementStore((s) => s.devices);
  const loadDevices = useManagementStore((s) => s.loadDevices);
  const fetchDashboard = useDashboardStore((s) => s.fetchDashboard);

  useEffect(() => {
    void loadReceivedLibrary();
    void loadDevices();
    void fetchDashboard();
  }, [loadReceivedLibrary, loadDevices, fetchDashboard]);

  const usingPreviewItems =
    !receivedLoading && !receivedError && shouldUsePreviewData(receivedItems.length > 0);
  const visibleReceivedItems = usingPreviewItems ? previewReceivedLibraryItems : receivedItems;
  const visibleManagedDevices =
    usingPreviewItems && managedDevices.length === 0 ? previewManagedDevices : managedDevices;

  // Build a clientId → displayName map
  const deviceNameMap = new Map<string, string>(
    visibleManagedDevices.map((d) => [d.clientId, d.displayName]),
  );

  // Calculations for stats cards
  const totalFiles = visibleReceivedItems.length;
  const totalOccupiedSpace = visibleReceivedItems.reduce((sum, item) => sum + item.fileSize, 0);

  // Group received items by device (clientId)
  const statsByDevice = visibleReceivedItems.reduce(
    (acc, item) => {
      const cid = item.clientId;
      if (!acc[cid]) {
        acc[cid] = {
          photoCount: 0,
          fileCount: 0,
          totalBytes: 0,
        };
      }
      const isMedia =
        item.mediaType === 'image' ||
        item.mediaType === 'video' ||
        item.mediaType?.startsWith('image/') ||
        item.mediaType?.startsWith('video/');
      if (isMedia) {
        acc[cid].photoCount += 1;
      } else {
        acc[cid].fileCount += 1;
      }
      acc[cid].totalBytes += item.fileSize;
      return acc;
    },
    {} as Record<string, { photoCount: number; fileCount: number; totalBytes: number }>,
  );

  // Fallback to managed devices or dashboard devices, unified into list
  const deviceList = visibleManagedDevices.map((d) => {
    const stats = statsByDevice[d.clientId] || {
      photoCount: 0,
      fileCount: 0,
      totalBytes: 0,
    };
    return {
      clientId: d.clientId,
      displayName: d.displayName,
      platform: d.platform,
      devicePath: d.stableDeviceId || d.clientIdShort || d.clientId,
      ...stats,
    };
  });

  const handleOpenFolder = (devicePath?: string) => {
    if (!settings.receivePath) {
      toast.error('未配置接收目录');
      return;
    }
    const path = devicePath ? `${settings.receivePath}/${devicePath}` : settings.receivePath;
    void window.electronAPI?.files.openFolder(path).catch(() => {
      void window.electronAPI?.files.openFolder(settings.receivePath);
    });
  };

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[1460px] px-8 py-6">
        <header className="mb-5 flex min-h-12 items-center justify-between gap-5 border-b border-white/60 pb-5">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold leading-tight text-[#17191c]">
              同步记录
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
              <p className="truncate text-xs font-semibold text-[#697786]">总接收文件数</p>
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
              <p className="truncate text-xs font-semibold text-[#697786]">占用总空间</p>
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
              <p className="truncate text-xs font-semibold text-[#697786]">磁盘剩余空间</p>
              <p className="mt-1 text-2xl font-semibold leading-none text-[#17191c]">
                {formatBytes(summary.remainingBytes)}
              </p>
            </div>
          </div>
        </div>

        {/* Sync Device Summary List */}
        <div className="mb-2 flex justify-end">
          <span className="px-1 text-xs font-semibold text-[#7b8490]">
            {deviceList.length} 台设备
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
              <h2 className="mt-3 text-sm font-bold text-slate-800">尚无同步记录</h2>
              <p className="mt-1 text-xs text-slate-400">设备同步传输后的文件历史会汇总在这里。</p>
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
                      {device.displayName || '未命名设备'}
                    </h3>
                    <p className="mt-0.5 truncate text-xs text-[#626a76]">
                      {device.platform || 'iPhone'}
                    </p>
                  </div>

                  {/* Statistics counts in middle */}
                  <div className="flex shrink-0 items-center gap-3 text-xs font-semibold text-[#4f5b68] [font-variant-numeric:tabular-nums]">
                    <span className="flex items-center gap-1">
                      <ImageIcon className="h-3.5 w-3.5 shrink-0 text-[#7b8794]" />
                      相册上传 {device.photoCount}
                    </span>
                    <span className="flex items-center gap-1">
                      <FileIconLucide className="h-3.5 w-3.5 shrink-0 text-[#7b8794]" />
                      文件上传 {device.fileCount}
                    </span>
                    <span className="flex items-center gap-1">
                      <HardDrive className="h-3.5 w-3.5 shrink-0 text-[#7b8794]" />
                      {formatBytes(device.totalBytes)}
                    </span>
                  </div>

                  {/* Open Folder Button */}
                  <button
                    type="button"
                    onClick={() => handleOpenFolder(device.devicePath)}
                    className="flex h-12 w-[76px] items-center justify-center rounded-lg border border-[#cdeeff]/80 bg-[#edf8ff]/78 text-[#1677d2] shadow-[0_10px_24px_rgba(67,157,220,0.1)] transition hover:-translate-y-0.5 hover:bg-[#dff2ff] hover:text-[#0d68bd] hover:shadow-[0_16px_34px_rgba(67,157,220,0.15)]"
                    title="打开目录"
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
              <h2 className="text-sm font-semibold text-[#3d4653]">所有文件</h2>
              <span className="text-xs font-semibold text-[#7b8490]">
                {visibleReceivedItems.length} 个文件
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
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
