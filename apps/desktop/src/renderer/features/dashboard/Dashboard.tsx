import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Eye,
  EyeOff,
  ChevronDown,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Smartphone,
  Copy,
  Check,
  ShieldAlert,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';
import { useDashboardStore } from '@renderer/stores/dashboard-store';
import { useSettingsStore } from '@renderer/stores/settings-store';
import { formatBytes } from '@renderer/lib/format';
import { Button } from '@renderer/components/ui/button';

export function Dashboard() {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const summary = useDashboardStore((s) => s.summary);
  const fetchDashboard = useDashboardStore((s) => s.fetchDashboard);

  const [masked, setMasked] = useState(true);
  const [qrVisible, setQrVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [transferActive, setTransferActive] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopyCode = async () => {
    const api = window.electronAPI;
    if (!api) return;
    try {
      await api.files.copyToClipboard(settings.connectionCode || '000000');
      setCopied(true);
      toast.success(t('dashboard.share.toast.connectionCodeCopied'));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t('dashboard.share.toast.copyFailed'));
    }
  };



  // macOS folder permission state (null = unknown / not mac)
  const [folderPermissionGranted, setFolderPermissionGranted] = useState<boolean | null>(null);

  // Load stats on mount
  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

  // Subscribe to transfer active state
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    void api.sidecar.getTransferActive().then(
      (r) => setTransferActive(r.active),
      () => {},
    );

    const unsub = api.events.onSidecarEvent((event) => {
      if (event.type === 'transfer.active.changed') {
        setTransferActive((event.payload as { isActive: boolean }).isActive);
      }
    });
    return unsub;
  }, []);

  // Check macOS Files & Folders permission on mount
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    if (!api.platform.isMac()) {
      setFolderPermissionGranted(null); // not applicable on non-mac
      return;
    }
    void api.files.checkFolderPermission().then((r) => {
      setFolderPermissionGranted(r.granted);
    });
  }, []);

  const handleRequestFolderPermission = async () => {
    const api = window.electronAPI;
    if (!api) return;
    try {
      const result = await api.files.requestFolderPermission();
      setFolderPermissionGranted(result.granted);
      if (result.granted) {
        toast.success(t('dashboard.share.toast.folderPermissionGranted'));
      } else {
        toast.error(t('dashboard.share.toast.folderPermissionDenied'));
        // Open macOS Privacy & Security settings
        void api.files.openExternal(
          'x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders',
        );
      }
    } catch {
      toast.error(t('dashboard.share.toast.folderPermissionRequestFailed'));
    }
  };

  const handleDoubleClickCode = async () => {
    if (masked) {
      toast.error(t('dashboard.share.toast.showCodeBeforeRegenerate'));
      return;
    }
    const api = window.electronAPI;
    if (!api) return;
    if (!window.confirm(t('dashboard.share.connectionCode.regenerateConfirm'))) {
      return;
    }
    try {
      const result = await api.sidecar.regenerateConnectionCode();
      useSettingsStore.getState().updateSettings({
        ...settings,
        connectionCode: result.code,
      });
      toast.success(t('dashboard.share.toast.connectionCodeRegenerated'));
    } catch (err) {
      console.error('Failed to regenerate code:', err);
      toast.error(t('dashboard.share.toast.regenerateFailed'));
    }
  };

  const handleSelectFolder = async () => {
    if (transferActive) {
      toast.error(t('dashboard.share.toast.transferActiveReceivePathLocked'));
      return;
    }
    try {
      const selected = await window.electronAPI?.files.selectFolder();
      if (selected && selected !== settings.rootPath) {
        setSaving(true);
        const updated = await window.electronAPI?.sidecar.updateSettings({
          rootPath: selected,
        });
        if (updated) {
          useSettingsStore.getState().updateSettings(updated);
          void useSettingsStore.getState().refreshShareStatus(true);
          toast.success(t('dashboard.share.toast.receivePathUpdated'));
        }
      }
    } catch {
      toast.error(t('dashboard.share.toast.receivePathUpdateFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadApp = () => {
    window.dispatchEvent(new Event('vividrop:open-download'));
  };

  const connectionCode = settings.connectionCode || '000000';
  const localDeviceName = settings.deviceName || 'ViviDrop';
  const localIp =
    window.electronAPI?.platform?.getLocalIPs?.()[0] || '127.0.0.1';
  const connectionQrPayload = `vividrop://connect?ip=${encodeURIComponent(
    localIp,
  )}&device=${encodeURIComponent(localDeviceName)}&code=${connectionCode.replace(
    /\s/g,
    '',
  )}`;

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[1460px] px-8 py-6">
        <header className="mb-5 flex min-h-12 items-center justify-between gap-5 border-b border-white/60 pb-5">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold leading-tight text-[#17191c]">
              {t('dashboard.share.title')}
            </h1>
          </div>
        </header>

        <div className="mx-auto max-w-[980px] space-y-5">
          {/* Card 1: Connection Code */}
          <section className="rounded-lg border border-white/70 bg-white/46 p-5 shadow-[0_18px_54px_rgba(70,96,138,0.1)] backdrop-blur-xl">
            <div className="mb-4 flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#eaf6ff] text-[#1677d2] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
                <HardDrive className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-[#17191c]">
                  {t('dashboard.share.connectionCode.title')}
                </h2>
              </div>
            </div>

            <div className="rounded-lg border border-white/70 bg-white/56 p-5 shadow-[0_10px_30px_rgba(90,120,170,0.08)]">
              <div className="relative">
                <div
                  onDoubleClick={handleDoubleClickCode}
                  className={`min-w-0 select-none flex flex-col items-center px-12 text-center ${
                    !masked ? 'cursor-pointer' : 'cursor-default'
                  }`}
                  title={
                    !masked
                      ? t('dashboard.share.connectionCode.regenerateTitle')
                      : t('dashboard.share.connectionCode.showBeforeRegenerateTitle')
                  }
                >
                  <p className="whitespace-nowrap font-mono text-3xl font-semibold tracking-[0.06em] text-[#17191c] [font-variant-numeric:tabular-nums]">
                    {masked ? '••••••' : connectionCode}
                  </p>
                  <p className="mt-1.5 text-xs text-[#9aa2ad]">
                    {!masked
                      ? t('dashboard.share.connectionCode.regenerateHint')
                      : t('dashboard.share.connectionCode.showBeforeRegenerateTitle')}
                  </p>
                </div>

                <div className="absolute right-0 top-1/2 flex -translate-y-1/2 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setMasked(!masked)}
                    className="flex h-10 w-10 items-center justify-center rounded-md text-[#626a76] transition hover:bg-[#e9f7ff] hover:text-[#1677d2]"
                    aria-label={
                      masked
                        ? t('dashboard.share.connectionCode.show')
                        : t('dashboard.share.connectionCode.hide')
                    }
                    title={
                      masked
                        ? t('dashboard.share.connectionCode.show')
                        : t('dashboard.share.connectionCode.hide')
                    }
                  >
                    {masked ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    className="flex h-10 w-10 items-center justify-center rounded-md text-[#626a76] transition hover:bg-[#e9f7ff] hover:text-[#1677d2]"
                    aria-label={t('dashboard.share.connectionCode.copy')}
                    title={t('dashboard.share.connectionCode.copy')}
                  >
                    {copied ? (
                      <Check className="h-4 w-4 text-[#2d8f54]" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setQrVisible((visible) => !visible)}
                    className="flex h-10 w-10 items-center justify-center rounded-md text-[#626a76] transition hover:bg-[#e9f7ff] hover:text-[#1677d2]"
                    aria-label={
                      qrVisible
                        ? t('dashboard.share.connectionCode.collapseQr')
                        : t('dashboard.share.connectionCode.showQr')
                    }
                    title={
                      qrVisible
                        ? t('dashboard.share.connectionCode.collapseQr')
                        : t('dashboard.share.connectionCode.showQr')
                    }
                  >
                    <ChevronDown
                      className={`h-4 w-4 transition ${qrVisible ? 'rotate-180' : ''}`}
                    />
                  </button>
                </div>
              </div>

              {qrVisible && (
                <div className="mt-5 rounded-lg border border-white/70 bg-white/68 p-4 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.68)]">
                  <div className="mx-auto flex h-[152px] w-[152px] items-center justify-center rounded-lg bg-white p-2 shadow-[0_12px_28px_rgba(70,96,138,0.12)]">
                    <QRCodeSVG
                      value={connectionQrPayload}
                      size={132}
                      bgColor="#ffffff"
                      fgColor="#17191c"
                      level="M"
                      marginSize={1}
                      title={t('dashboard.share.connectionCode.qrTitle')}
                    />
                  </div>
                  <p className="mt-2 text-[11px] font-medium text-[#7b8490]">
                    {t('dashboard.share.connectionCode.qrDescription')}
                  </p>
                </div>
              )}
            </div>

            <p className="mt-3 flex items-center gap-1.5 text-xs leading-5 text-[#7b8490]">
              <Smartphone className="h-3.5 w-3.5 shrink-0 text-[#9aa3af]" />
              <span>
                <button
                  type="button"
                  onClick={handleDownloadApp}
                  className="font-semibold text-[#1677d2] underline-offset-2 transition hover:text-[#0d68bd] hover:underline"
                >
                  {t('dashboard.share.connectionCode.downloadApp')}
                </button>
                {t('dashboard.share.connectionCode.downloadInstruction')}
              </span>
            </p>
          </section>

          <section className="rounded-lg border border-white/70 bg-white/46 p-5 shadow-[0_18px_54px_rgba(70,96,138,0.1)] backdrop-blur-xl">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#e9f8ee] text-[#2d8f54] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
                  <FolderOpen className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-[#17191c]">
                    {t('dashboard.share.remoteAccess.title')}
                  </h2>
                  <p className="mt-1 text-xs text-[#7b8490]">
                    {t('dashboard.share.remoteAccess.description')}
                  </p>
                </div>
              </div>

            </div>

            {/* macOS Files & Folders permission banner */}
            {folderPermissionGranted === false && (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-amber-200/80 bg-amber-50/70 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <ShieldAlert className="h-4 w-4 shrink-0 text-amber-500" />
                  <p className="text-xs text-amber-700">
                    {t('dashboard.share.remoteAccess.folderPermissionWarning')}
                  </p>
                </div>
                <button
                  id="btn-request-folder-permission"
                  type="button"
                  onClick={handleRequestFolderPermission}
                  className="shrink-0 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-amber-600 active:scale-[0.97]"
                >
                  {t('dashboard.share.remoteAccess.authorize')}
                </button>
              </div>
            )}
          </section>

          <section className="rounded-lg border border-white/70 bg-white/46 p-5 shadow-[0_18px_54px_rgba(70,96,138,0.1)] backdrop-blur-xl">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#e8fbff] text-[#0d8bbf] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
                  <FolderOpen className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-[#17191c]">
                    {t('dashboard.share.receiveFolder.title')}
                  </h2>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#7b8490]">
                    <span className="truncate">
                      {settings.receivePath || t('dashboard.share.receiveFolder.defaultPath')}
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-[#e6f7f1] px-2 py-0.5 font-semibold text-[#1e7d5f]">
                      <HardDrive className="h-3.5 w-3.5 shrink-0" />
                      {t('dashboard.share.receiveFolder.remaining', {
                        space: formatBytes(summary.remainingBytes),
                      })}
                    </span>
                  </p>
                </div>
              </div>

              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={handleSelectFolder}
                disabled={saving}
                className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-md bg-[#1677d2] px-3 text-xs font-semibold text-white shadow-[0_12px_22px_rgba(22,119,210,0.18)] transition hover:bg-[#0d68bd] active:scale-[0.98]"
              >
                <FolderPlus className="h-3.5 w-3.5" />
                {t('dashboard.share.receiveFolder.changeFolder')}
              </Button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
