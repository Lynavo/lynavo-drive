import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivitySquare, CheckCircle2, Loader2, RotateCcw, UploadCloud, Wifi } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { Label } from '@renderer/components/ui/label';
import { CopyButton } from '@renderer/components/shared/CopyButton';
import { formatDateTime } from '@renderer/lib/format';
import { useDashboardStore } from '@renderer/stores/dashboard-store';
import { useSidecarRuntimeStore } from '@renderer/stores/sidecar-runtime-store';

export function SupportSection() {
  const { t, i18n } = useTranslation();
  const summary = useDashboardStore((s) => s.summary);
  const isTransferActive = useDashboardStore((s) =>
    s.devices.some((device) => device.status === 'transferring'),
  );
  const advertisedIP = useSidecarRuntimeStore((s) => s.runtime.bonjour.advertisedIP);
  const [appInfo, setAppInfo] = useState<{
    name: string;
    version: string;
    buildNumber: string;
  } | null>(null);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [diagnosticsDescription, setDiagnosticsDescription] = useState('');
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
    if (!summary.lastSuccessfulSyncAt) return t('common.fallback.noRecord');
    return `${formatDateTime(summary.lastSuccessfulSyncAt)} · ${
      summary.lastSuccessfulDeviceName ?? t('common.fallback.unknownDevice')
    }`;
  }, [summary.lastSuccessfulDeviceName, summary.lastSuccessfulSyncAt, t]);
  const desktopVersionLabel = appInfo
    ? `${appInfo.name} v${appInfo.version}${
        appInfo.buildNumber
          ? ` (${t('settings.support.buildNumber', { buildNumber: appInfo.buildNumber })})`
          : ''
      }`
    : t('common.fallback.reading');

  const handleExportDiagnostics = async () => {
    const api = window.electronAPI;
    const description = diagnosticsDescription.trim();
    if (!api || exporting) return;

    try {
      setExporting(true);
      const archivePath = await api.support.exportDiagnostics(
        i18n.resolvedLanguage ?? i18n.language,
        description,
      );
      if (archivePath) {
        toast.success(t('errors.settings.diagnosticsExported'), {
          description: archivePath,
        });
        setDiagnosticsDescription('');
        setUploadDialogOpen(false);
      }
    } catch (error) {
      toast.error(t('errors.settings.diagnosticsExportFailed'), {
        description: error instanceof Error ? error.message : t('errors.common.retryLater'),
      });
    } finally {
      setExporting(false);
    }
  };

  const handleReset = useCallback(async () => {
    const api = window.electronAPI;
    if (!api || resetting || isTransferActive) return;

    try {
      setResetting(true);
      await api.sidecar.resetState();
      toast.success(t('errors.settings.resetSuccess'), {
        description: t('errors.settings.resetSuccessDescription'),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : t('errors.common.retryLater');
      toast.error(t('errors.settings.resetFailed'), {
        description: message.includes('transfer')
          ? t('errors.settings.resetTransferActiveDescription')
          : message,
      });
    } finally {
      setResetting(false);
    }
  }, [isTransferActive, resetting, t]);

  const handleResetClick = useCallback(() => {
    if (resetting || isTransferActive) return;

    if (!confirmReset) {
      setConfirmReset(true);
      confirmTimerRef.current = setTimeout(() => setConfirmReset(false), 4000);
      return;
    }

    clearTimeout(confirmTimerRef.current);
    setConfirmReset(false);
    void handleReset();
  }, [confirmReset, handleReset, isTransferActive, resetting]);

  useEffect(() => {
    return () => clearTimeout(confirmTimerRef.current);
  }, []);

  useEffect(() => {
    if (!isTransferActive || !confirmReset) return;
    clearTimeout(confirmTimerRef.current);
    setConfirmReset(false);
  }, [confirmReset, isTransferActive]);

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-foreground">{t('settings.support.title')}</h3>
            <p className="text-xs text-muted-foreground">{t('settings.support.description')}</p>
          </div>
          <div className="flex items-center gap-2">
            <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={exporting}
                onClick={() => setUploadDialogOpen(true)}
              >
                {exporting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <UploadCloud className="h-4 w-4" />
                )}
                {t('settings.support.exportDiagnostics')}
              </Button>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('settings.support.exportDiagnostics')}</DialogTitle>
                  <DialogDescription>
                    {t('settings.support.diagnosticsDescriptionHelp')}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                  <Label htmlFor="diagnostics-description">
                    {t('settings.support.diagnosticsDescriptionLabel')}
                  </Label>
                  <textarea
                    id="diagnostics-description"
                    value={diagnosticsDescription}
                    onChange={(event) => setDiagnosticsDescription(event.target.value)}
                    placeholder={t('settings.support.diagnosticsDescriptionPlaceholder')}
                    className="min-h-28 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={exporting}
                  />
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={exporting}
                    onClick={() => setUploadDialogOpen(false)}
                  >
                    {t('settings.support.diagnosticsCancel')}
                  </Button>
                  <Button
                    type="button"
                    disabled={exporting}
                    onClick={() => void handleExportDiagnostics()}
                  >
                    {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {t('settings.support.diagnosticsSubmit')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Button
              type="button"
              variant={confirmReset ? 'destructive' : 'outline'}
              size="sm"
              disabled={resetting || isTransferActive}
              onClick={handleResetClick}
            >
              {resetting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
              {confirmReset ? t('settings.support.confirmReset') : t('settings.support.reset')}
            </Button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl bg-secondary/60 px-4 py-3">
            <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              {t('settings.support.lastSuccessfulSync')}
            </div>
            <p className="text-sm font-medium text-foreground">{lastSuccessfulSyncLabel}</p>
          </div>

          <div className="rounded-xl bg-secondary/60 px-4 py-3">
            <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Wifi className="h-4 w-4 text-sky-500" />
              {t('settings.support.advertisedIp')}
            </div>
            <div className="flex items-center gap-2">
              <p className="font-mono text-sm font-medium text-foreground">
                {advertisedIP ?? t('common.fallback.detecting')}
              </p>
              {advertisedIP ? <CopyButton text={advertisedIP} /> : null}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('settings.support.sameLanHint')}
            </p>
          </div>

          <div className="rounded-xl bg-secondary/60 px-4 py-3 md:col-span-2">
            <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <ActivitySquare className="h-4 w-4 text-sky-500" />
              {t('settings.support.desktopVersion')}
            </div>
            <p className="text-sm font-medium text-foreground">{desktopVersionLabel}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
