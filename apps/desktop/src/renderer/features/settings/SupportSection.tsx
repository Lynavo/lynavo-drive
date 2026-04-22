import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivitySquare, Archive, CheckCircle2, Loader2, RotateCcw, Wifi } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@renderer/components/ui/button';
import { CopyButton } from '@renderer/components/shared/CopyButton';
import { formatDateTime } from '@renderer/lib/format';
import { useDashboardStore } from '@renderer/stores/dashboard-store';
import { useSidecarRuntimeStore } from '@renderer/stores/sidecar-runtime-store';

export function SupportSection() {
  const summary = useDashboardStore((s) => s.summary);
  const advertisedIP = useSidecarRuntimeStore((s) => s.runtime.bonjour.advertisedIP);
  const [appInfo, setAppInfo] = useState<{
    name: string;
    version: string;
    buildNumber: string;
  } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    void api.support
      .getAppInfo()
      .then(setAppInfo)
      .catch(() => undefined);
  }, []);

  const lastSuccessfulSyncLabel = useMemo(() => {
    if (!summary.lastSuccessfulSyncAt) return '暂无记录';
    return `${formatDateTime(summary.lastSuccessfulSyncAt)} · ${summary.lastSuccessfulDeviceName ?? '未知设备'}`;
  }, [summary.lastSuccessfulDeviceName, summary.lastSuccessfulSyncAt]);

  const handleExport = async () => {
    const api = window.electronAPI;
    if (!api || exporting) return;

    try {
      setExporting(true);
      const archivePath = await api.support.exportDiagnostics();
      if (archivePath) {
        toast.success('诊断包已导出', {
          description: archivePath,
        });
      }
    } catch (error) {
      toast.error('诊断包导出失败', {
        description: error instanceof Error ? error.message : '请稍后重试',
      });
    } finally {
      setExporting(false);
    }
  };

  const handleResetClick = useCallback(() => {
    if (resetting) return;

    if (!confirmReset) {
      setConfirmReset(true);
      confirmTimerRef.current = setTimeout(() => setConfirmReset(false), 4000);
      return;
    }

    clearTimeout(confirmTimerRef.current);
    setConfirmReset(false);
    void handleReset();
  }, [confirmReset, resetting]);

  const handleReset = async () => {
    const api = window.electronAPI;
    if (!api || resetting) return;

    try {
      setResetting(true);
      await api.sidecar.resetState();
      toast.success('已重置所有数据', {
        description: '配对设备、上传记录、会话已全部清除',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '請稍後重試';
      toast.error('重置失敗', {
        description: message.includes('transfer')
          ? '正在接收檔案，完成後再重置資料'
          : message,
      });
    } finally {
      setResetting(false);
    }
  };

  useEffect(() => {
    return () => clearTimeout(confirmTimerRef.current);
  }, []);

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-foreground">支持与诊断</h3>
            <p className="text-xs text-muted-foreground">
              遇到同步、重连或共享问题时，建议先导出诊断包再反馈。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={exporting}
              onClick={() => void handleExport()}
            >
              {exporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Archive className="h-4 w-4" />
              )}
              导出诊断包
            </Button>
            <Button
              type="button"
              variant={confirmReset ? 'destructive' : 'outline'}
              size="sm"
              disabled={resetting}
              onClick={handleResetClick}
            >
              {resetting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
              {confirmReset ? '确认重置？' : '重置数据'}
            </Button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl bg-secondary/60 px-4 py-3">
            <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              最近一次成功同步
            </div>
            <p className="text-sm font-medium text-foreground">{lastSuccessfulSyncLabel}</p>
          </div>

          <div className="rounded-xl bg-secondary/60 px-4 py-3">
            <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Wifi className="h-4 w-4 text-sky-500" />
              广播 IP（iPhone 连接地址）
            </div>
            <div className="flex items-center gap-2">
              <p className="font-mono text-sm font-medium text-foreground">
                {advertisedIP ?? '侦测中…'}
              </p>
              {advertisedIP ? <CopyButton text={advertisedIP} /> : null}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              iPhone 需与此 IP 在同一局域网段
            </p>
          </div>

          <div className="rounded-xl bg-secondary/60 px-4 py-3 md:col-span-2">
            <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <ActivitySquare className="h-4 w-4 text-sky-500" />
              桌面端版本
            </div>
            <p className="text-sm font-medium text-foreground">
              {appInfo
                ? `${appInfo.name} v${appInfo.version}${appInfo.buildNumber ? ` (${appInfo.buildNumber})` : ''}`
                : '读取中…'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
