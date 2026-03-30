import { useState } from 'react';
import { AlertTriangle, Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@renderer/components/ui/button';
import { useAppStore } from '@renderer/stores/app-store';
import { useSidecarRuntimeStore } from '@renderer/stores/sidecar-runtime-store';

export function SidecarStatusBanner() {
  const runtime = useSidecarRuntimeStore((s) => s.runtime);
  const setView = useAppStore((s) => s.setView);
  const [retrying, setRetrying] = useState(false);
  const [installing, setInstalling] = useState(false);
  const showBonjourFallback = runtime.bonjour.status === 'fallback';

  if ((runtime.status === 'healthy' && !showBonjourFallback) || runtime.status === 'stopped') {
    return null;
  }

  const isStarting = runtime.status === 'starting';
  const isBonjourWarning = runtime.status === 'healthy' && showBonjourFallback;
  const title = isBonjourWarning
    ? 'Bonjour 广播未启用'
    : isStarting
      ? runtime.restartCount > 0
        ? '后台服务正在重试'
        : '后台服务启动中'
      : '后台服务启动失败';
  const detail = isBonjourWarning
    ? runtime.bonjour.message ?? 'Windows 当前未检测到 Bonjour for Windows。'
    : runtime.message ??
      (isStarting
        ? '桌面应用正在等待本地 sidecar 服务就绪。'
        : '本地 sidecar 未能成功启动。');

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await window.electronAPI.sidecar.retryStart();
    } catch {
      toast.error('重试启动后台服务失败');
    } finally {
      setRetrying(false);
    }
  };

  const handleInstall = async () => {
    setInstalling(true);
    try {
      const result = await window.electronAPI.sidecar.installBonjour();
      toast.success(result.message);
    } catch (error) {
      toast.error('Bonjour 安装失败', {
        description: error instanceof Error ? error.message : '请改到设置页查看安装说明。',
      });
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div
      className="mx-6 mt-4 flex items-start gap-3 rounded-2xl px-4 py-3 shadow-[0_12px_30px_rgba(15,23,42,0.08),0_2px_6px_rgba(15,23,42,0.04)]"
      style={{
        background: isStarting
          ? 'rgba(255,247,237,0.9)'
          : isBonjourWarning
            ? 'rgba(239,246,255,0.95)'
            : 'rgba(254,226,226,0.9)',
        color: isStarting ? '#92400e' : isBonjourWarning ? '#1d4ed8' : '#b91c1c',
        backdropFilter: 'blur(10px)',
      }}
      role="alert"
    >
      {isStarting ? (
        <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
      ) : (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      )}

      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{title}</div>
        <div className="mt-1 text-sm opacity-90">{detail}</div>
        {isBonjourWarning && runtime.bonjour.path && (
          <div className="mt-1 text-xs opacity-80">
            Bonjour 路径：{runtime.bonjour.path}
          </div>
        )}
        {runtime.lastExitCode !== null && (
          <div className="mt-1 text-xs opacity-80">
            最近退出码：{runtime.lastExitCode}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {isBonjourWarning && (
          <Button
            type="button"
            size="sm"
            onClick={() => void handleInstall()}
            disabled={installing || retrying || isStarting}
            className="shrink-0"
          >
            {installing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            一键安装 Bonjour
          </Button>
        )}
        {isBonjourWarning && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setView('settings')}
            className="shrink-0"
          >
            查看设置
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleRetry}
          disabled={retrying || isStarting || installing}
          className="shrink-0"
        >
          <RotateCcw className="h-4 w-4" />
          {isBonjourWarning ? '重试后台服务' : '重试'}
        </Button>
      </div>
    </div>
  );
}
