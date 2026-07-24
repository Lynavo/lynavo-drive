import { useState } from 'react';
import { AlertTriangle, Download, Loader2, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@renderer/components/ui/button';
import { getBonjourRuntimeMessage, getSidecarRuntimeMessage } from '@renderer/lib/runtime-messages';
import { useSidecarRuntimeStore } from '@renderer/stores/sidecar-runtime-store';

export function SidecarStatusBanner() {
  const { t } = useTranslation();
  const runtime = useSidecarRuntimeStore((s) => s.runtime);
  const [retrying, setRetrying] = useState(false);
  const [installingBonjour, setInstallingBonjour] = useState(false);
  const showBonjourFallback = runtime.bonjour.status === 'fallback';
  const isWindows = window.electronAPI?.platform?.isWindows?.() ?? false;

  if ((runtime.status === 'healthy' && !showBonjourFallback) || runtime.status === 'stopped') {
    return null;
  }

  const isStarting = runtime.status === 'starting';
  const isBonjourWarning = runtime.status === 'healthy' && showBonjourFallback;
  const title = isBonjourWarning
    ? t('layout.sidecar.bonjourWarningTitle')
    : isStarting
      ? runtime.restartCount > 0
        ? t('layout.sidecar.retryingTitle')
        : t('layout.sidecar.startingTitle')
      : t('layout.sidecar.failedTitle');
  const detail = isBonjourWarning
    ? getBonjourRuntimeMessage(runtime.bonjour, t)
    : getSidecarRuntimeMessage(
        runtime,
        t,
        isStarting ? 'layout.sidecar.startingDetail' : 'layout.sidecar.failedDetail',
      );

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await window.electronAPI.sidecar.retryStart();
    } catch {
      toast.error(t('errors.settings.sidecarRetryFailed'));
    } finally {
      setRetrying(false);
    }
  };

  const handleInstallBonjour = async () => {
    setInstallingBonjour(true);
    try {
      await window.electronAPI.sidecar.installBonjour();
      toast.success(t('layout.sidecar.bonjourInstallSuccess'));
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t('layout.sidecar.bonjourInstallFailed'),
      );
    } finally {
      setInstallingBonjour(false);
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
            {t('layout.sidecar.bonjourPath', { path: runtime.bonjour.path })}
          </div>
        )}
        {runtime.lastExitCode !== null && (
          <div className="mt-1 text-xs opacity-80">
            {t('layout.sidecar.lastExitCode', { code: runtime.lastExitCode })}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {isBonjourWarning && isWindows && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleInstallBonjour}
            disabled={installingBonjour || retrying || isStarting}
            className="shrink-0"
          >
            {installingBonjour ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {installingBonjour
              ? t('layout.sidecar.installingBonjour')
              : t('layout.sidecar.installBonjour')}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleRetry}
          disabled={retrying || isStarting || installingBonjour}
          className="shrink-0"
        >
          <RotateCcw className="h-4 w-4" />
          {isBonjourWarning ? t('layout.sidecar.retrySidecar') : t('common.actions.retry')}
        </Button>
      </div>
    </div>
  );
}
