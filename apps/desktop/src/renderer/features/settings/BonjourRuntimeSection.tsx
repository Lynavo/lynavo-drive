import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@renderer/components/ui/button';
import { useSidecarRuntimeStore } from '@renderer/stores/sidecar-runtime-store';
import { BONJOUR_WINDOWS_SUPPORT_URL } from '../../../shared/bonjour';

export function BonjourRuntimeSection() {
  const runtime = useSidecarRuntimeStore((s) => s.runtime);
  const [retrying, setRetrying] = useState(false);
  const [installing, setInstalling] = useState(false);
  const isWindows = window.electronAPI?.platform.isWindows?.() ?? false;

  if (!isWindows) {
    return null;
  }

  const usingBonjour = runtime.bonjour.status === 'native';

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await window.electronAPI.sidecar.retryStart();
      toast.success('后台服务已重新检测 Bonjour 运行时');
    } catch {
      toast.error('重新检测 Bonjour 运行时失败');
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
        description:
          error instanceof Error ? error.message : '请稍后重试，或改用苹果官方安装页面。',
      });
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div
      className="rounded-2xl border p-5 shadow-sm"
      style={{
        borderColor: usingBonjour ? 'rgba(34,197,94,0.25)' : 'rgba(59,130,246,0.2)',
        background: usingBonjour ? 'rgba(240,253,244,0.9)' : 'rgba(239,246,255,0.9)',
      }}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              {usingBonjour ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-sky-600" />
              )}
              Windows Bonjour 广播
            </div>
            <p className="text-xs text-muted-foreground">
              {runtime.bonjour.message ??
                'Vivi Drop 会在 Windows 上优先使用 Bonjour for Windows，让 iPhone 扫描更稳定。'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!usingBonjour && (
              <Button
                type="button"
                size="sm"
                disabled={installing || retrying}
                onClick={() => void handleInstall()}
              >
                {installing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                一键安装 Bonjour
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={retrying || runtime.status === 'starting' || installing}
              onClick={() => void handleRetry()}
            >
              {retrying ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
              重试后台服务
            </Button>
            {!usingBonjour && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={installing}
                onClick={() =>
                  void window.electronAPI.files.openExternal(BONJOUR_WINDOWS_SUPPORT_URL)
                }
              >
                打开苹果官方页面
              </Button>
            )}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl bg-white/70 px-4 py-3">
            <div className="mb-1 text-xs font-medium text-muted-foreground">当前广播模式</div>
            <p className="text-sm font-medium text-foreground">
              {usingBonjour ? 'Apple Bonjour' : '兼容模式（zeroconf fallback）'}
            </p>
          </div>

          <div className="rounded-xl bg-white/70 px-4 py-3">
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              广播 IP（iPhone 连接地址）
            </div>
            <p className="break-all text-sm font-medium text-foreground font-mono">
              {runtime.bonjour.advertisedIP ?? '启动中…'}
            </p>
            {runtime.bonjour.advertisedIP ? (
              <p className="mt-1 text-xs text-muted-foreground">iPhone 需与此 IP 在同一局域网段</p>
            ) : null}
          </div>

          <div className="rounded-xl bg-white/70 px-4 py-3">
            <div className="mb-1 text-xs font-medium text-muted-foreground">运行时路径</div>
            <p className="break-all text-sm font-medium text-foreground">
              {runtime.bonjour.path ?? '未检测到 Bonjour 运行时'}
            </p>
          </div>
        </div>

        {!usingBonjour && (
          <div className="rounded-xl bg-white/60 px-4 py-3 text-xs text-muted-foreground">
            建议在系统中安装 Bonjour for Windows，或把 `dns-sd.exe` 与 `dnssd.dll` 放到桌面端
            `resources` 目录后，再点击“重试后台服务”。
          </div>
        )}
      </div>
    </div>
  );
}
