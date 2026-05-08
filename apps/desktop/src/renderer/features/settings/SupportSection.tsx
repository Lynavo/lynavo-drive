import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivitySquare,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  RotateCcw,
  UploadCloud,
  Wifi,
} from 'lucide-react';
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

type UpdateCheckResult = Awaited<
  ReturnType<NonNullable<Window['electronAPI']>['support']['checkForUpdates']>
>;

function isNetworkUnreachable(error: unknown): boolean {
  if (error && typeof error === 'object' && 'code' in error) {
    return (error as { code?: unknown }).code === 'NETWORK_UNREACHABLE';
  }
  return error instanceof Error && error.message.includes('NETWORK_UNREACHABLE');
}

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
  const [uploading, setUploading] = useState(false);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckResult | null>(null);
  const [updateCheckFailed, setUpdateCheckFailed] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const checkingUpdatesRef = useRef(false);
  const updateReleaseNotes = updateCheck?.releaseNotes?.trim();

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    void api.support
      .getAppInfo()
      .then(setAppInfo)
      .catch(() => undefined);
  }, []);

  const handleCheckUpdates = useCallback(
    async (options?: { silent?: boolean }) => {
      const api = window.electronAPI;
      if (!api || checkingUpdatesRef.current) return;

      try {
        checkingUpdatesRef.current = true;
        setCheckingUpdates(true);
        setUpdateCheckFailed(false);
        const result = await api.support.checkForUpdates();
        setUpdateCheck(result);
      } catch {
        setUpdateCheckFailed(true);
        if (!options?.silent) {
          toast.error(t('errors.settings.updateCheckFailed'));
        }
      } finally {
        checkingUpdatesRef.current = false;
        setCheckingUpdates(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void handleCheckUpdates({ silent: true });
  }, [handleCheckUpdates]);

  const lastSuccessfulSyncLabel = useMemo(() => {
    if (!summary.lastSuccessfulSyncAt) return t('common.fallback.noRecord');
    return `${formatDateTime(summary.lastSuccessfulSyncAt)} · ${
      summary.lastSuccessfulDeviceName ?? t('common.fallback.unknownDevice')
    }`;
  }, [summary.lastSuccessfulDeviceName, summary.lastSuccessfulSyncAt, t]);

  const handleUploadDiagnostics = async () => {
    const api = window.electronAPI;
    const description = diagnosticsDescription.trim();
    if (!api || uploading || !description) return;

    try {
      setUploading(true);
      const upload = await api.support.uploadDiagnostics({
        description,
        locale: i18n.resolvedLanguage ?? i18n.language,
      });
      toast.success(t('errors.settings.diagnosticsUploaded'), {
        description: upload.refId,
      });
      setDiagnosticsDescription('');
      setUploadDialogOpen(false);
    } catch (error) {
      if (!isNetworkUnreachable(error)) {
        toast.error(t('errors.settings.diagnosticsUploadFailed'), {
          description: error instanceof Error ? error.message : t('errors.common.retryLater'),
        });
        return;
      }

      try {
        const archivePath = await api.support.exportDiagnostics(
          i18n.resolvedLanguage ?? i18n.language,
        );
        if (archivePath) {
          toast.success(t('errors.settings.diagnosticsUploadFallbackExported'), {
            description: archivePath,
          });
          setDiagnosticsDescription('');
          setUploadDialogOpen(false);
        }
      } catch (fallbackError) {
        toast.error(t('errors.settings.diagnosticsUploadFallbackExportFailed'), {
          description:
            fallbackError instanceof Error ? fallbackError.message : t('errors.common.retryLater'),
        });
      }
    } finally {
      setUploading(false);
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
                disabled={uploading}
                onClick={() => setUploadDialogOpen(true)}
              >
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <UploadCloud className="h-4 w-4" />
                )}
                {t('settings.support.uploadDiagnostics')}
              </Button>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('settings.support.uploadDiagnostics')}</DialogTitle>
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
                    disabled={uploading}
                  />
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={uploading}
                    onClick={() => setUploadDialogOpen(false)}
                  >
                    {t('settings.support.diagnosticsCancel')}
                  </Button>
                  <Button
                    type="button"
                    disabled={uploading || diagnosticsDescription.trim().length === 0}
                    onClick={() => void handleUploadDiagnostics()}
                  >
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
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
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <ActivitySquare className="h-4 w-4 text-sky-500" />
                  {t('settings.support.desktopVersion')}
                </div>
                <p className="text-sm font-medium text-foreground">
                  {appInfo
                    ? `${appInfo.name} v${appInfo.version}${appInfo.buildNumber ? ` (${appInfo.buildNumber})` : ''}`
                    : t('common.fallback.reading')}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={checkingUpdates}
                onClick={() => void handleCheckUpdates()}
              >
                {checkingUpdates ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                {checkingUpdates
                  ? t('settings.support.checkingUpdates')
                  : t('settings.support.checkUpdates')}
              </Button>
            </div>
            {updateCheckFailed ? (
              <p className="text-xs text-muted-foreground">
                {t('settings.support.updateUnavailable')}
              </p>
            ) : null}
            {updateCheck && !updateCheck.updateAvailable ? (
              <p className="text-xs text-emerald-600">{t('settings.support.upToDate')}</p>
            ) : null}
            {updateCheck?.updateAvailable ? (
              <div className="mt-2 flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium">
                      {t('settings.support.updateAvailable', {
                        version: updateCheck.latestVersion,
                      })}
                    </p>
                    {updateCheck.minimumRequired ? (
                      <p className="mt-1 text-xs">{t('settings.support.minimumRequired')}</p>
                    ) : null}
                  </div>
                  {updateCheck.downloadUrl ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void window.electronAPI?.files.openExternal(updateCheck.downloadUrl!)
                      }
                    >
                      <ExternalLink className="h-4 w-4" />
                      {t('settings.support.openDownload')}
                    </Button>
                  ) : null}
                </div>
                {updateReleaseNotes ? (
                  <p className="text-xs">
                    <span className="font-medium">{t('settings.support.releaseNotes')}：</span>
                    {updateReleaseNotes}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
