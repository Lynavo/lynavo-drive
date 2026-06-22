import { lazy, Suspense, useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, HelpCircle, Loader2, QrCode, RefreshCw, Smartphone } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Skeleton } from '@renderer/components/ui/skeleton';
import { useAppStore } from '@renderer/stores/app-store';
import { useDashboardStore } from '@renderer/stores/dashboard-store';
import { useSettingsStore } from '@renderer/stores/settings-store';
import { useSidecarRuntimeStore } from '@renderer/stores/sidecar-runtime-store';
import { useResourcesStore } from '@renderer/stores/resources-store';
import { useAuthStore } from '@renderer/stores/auth-store';
import { AuthPage } from '@renderer/components/shared/AuthPage';
import { LogoutConfirmDialog } from '@renderer/components/shared/LogoutConfirmDialog';
import { Sidebar } from './Sidebar';
import { SidecarStatusBanner } from './SidecarStatusBanner';

const Dashboard = lazy(() =>
  import('@renderer/features/dashboard/Dashboard').then((m) => ({
    default: m.Dashboard,
  })),
);
const SettingsPage = lazy(() =>
  import('@renderer/features/settings/SettingsPage').then((m) => ({
    default: m.SettingsPage,
  })),
);
const HelpDialog = lazy(() =>
  import('@renderer/features/help/HelpDialog').then((m) => ({
    default: m.HelpDialog,
  })),
);
const DeviceDetailPage = lazy(() =>
  import('@renderer/features/device-detail/DeviceDetailPage').then((m) => ({
    default: m.DeviceDetailPage,
  })),
);
const DevicesPage = lazy(() =>
  import('@renderer/features/devices/DevicesPage').then((m) => ({
    default: m.DevicesPage,
  })),
);
const RecordsPage = lazy(() =>
  import('@renderer/features/records/RecordsPage').then((m) => ({
    default: m.RecordsPage,
  })),
);
const SharedResourcesPage = lazy(() =>
  import('@renderer/features/shared/SharedResourcesPage').then((m) => ({
    default: m.SharedResourcesPage,
  })),
);
const ReceivedLibraryPage = lazy(() =>
  import('@renderer/features/library/ReceivedLibraryPage').then((m) => ({
    default: m.ReceivedLibraryPage,
  })),
);

const TITLE_BAR_OVERLAY_CONTROLS_INSET = 154;

function PageFallback() {
  return <Skeleton className="flex-1" />;
}

function normalizeConnectionCode(value: string): string {
  return value.replace(/\D/g, '').slice(0, 6);
}

type ConnectionCodeSetupPageProps = {
  onComplete(): void;
  onLogout(): void | Promise<void>;
};

function ConnectionCodeSetupPage({ onComplete, onLogout }: ConnectionCodeSetupPageProps) {
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const session = useAuthStore((s) => s.session);
  const [draftCode, setDraftCode] = useState(() =>
    normalizeConnectionCode(settings.connectionCode || ''),
  );
  const [hasEdited, setHasEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const deviceName =
    settings.deviceName || window.electronAPI?.platform?.getHostName?.() || 'ViviDrop';
  const setupSteps = [
    {
      icon: Download,
      title: '扫码下载手机端',
      description: '用手机扫描右侧二维码，下载并安装 ViviDrop 手机端',
    },
    {
      icon: Smartphone,
      title: '输入连接码配对',
      description: '在手机端输入此连接码即可连接此电脑，同一局域网下自动同步手机相册和文件到此电脑',
    },
    {
      icon: RefreshCw,
      title: '远程访问电脑文件',
      description: '连接码连接成功后，手机可远程访问这台电脑的文件',
    },
  ];

  useEffect(() => {
    if (!hasEdited) {
      setDraftCode(normalizeConnectionCode(settings.connectionCode || ''));
    }
  }, [hasEdited, settings.connectionCode]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\d{6}$/.test(draftCode)) {
      setError('请输入 6 位数字连接码');
      return;
    }

    const savedCode = normalizeConnectionCode(settings.connectionCode || '');
    if (draftCode === savedCode) {
      onComplete();
      return;
    }

    const api = window.electronAPI;
    if (!api?.sidecar.setConnectionCode) {
      setError('连接码服务暂不可用');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const result = await api.sidecar.setConnectionCode(draftCode);
      updateSettings({ ...settings, connectionCode: result.code });
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存连接码失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center overflow-y-auto px-6 py-10 text-[#17191c]"
      style={{
        backgroundColor: '#f7fbff',
        backgroundImage:
          'linear-gradient(135deg, rgba(255,252,247,0.98) 0%, rgba(247,252,255,0.92) 38%, rgba(239,248,255,0.92) 68%, rgba(255,248,220,0.72) 100%), repeating-linear-gradient(0deg, rgba(23,25,28,0.024) 0 1px, transparent 1px 3px)',
        backgroundBlendMode: 'normal, overlay',
      }}
    >
      <section className="w-full max-w-[560px] rounded-lg border border-white/70 bg-white/66 p-5 shadow-[0_34px_110px_rgba(70,96,138,0.18)] backdrop-blur-2xl">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#17191c] text-white shadow-[0_12px_28px_rgba(23,25,28,0.18)]">
              <QrCode className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-[20px] font-semibold leading-6 text-[#17191c]">设置连接码</h1>
              <p className="mt-1 truncate text-xs text-[#7d8794]">{deviceName}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowLogoutConfirm(true)}
            className="inline-flex h-8 shrink-0 items-center justify-center rounded-md bg-white/58 px-3 text-xs font-medium text-[#687380] transition hover:bg-white/90 hover:text-[#17191c]"
          >
            退出
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <label htmlFor="connection-code" className="text-xs font-medium text-[#778392]">
            连接码
          </label>
          <input
            id="connection-code"
            inputMode="numeric"
            autoComplete="off"
            value={draftCode}
            onChange={(event) => {
              setHasEdited(true);
              setDraftCode(normalizeConnectionCode(event.target.value));
              setError(null);
            }}
            className="mt-2 h-12 w-full rounded-lg border border-white/80 bg-white/80 px-4 text-center font-mono text-2xl font-semibold text-[#17191c] shadow-inner outline-none transition focus:border-[#17191c]/30 focus:bg-white"
            maxLength={6}
          />
          {error ? <p className="mt-2 text-sm font-medium text-[#d92d20]">{error}</p> : null}

          <button
            type="submit"
            disabled={saving || draftCode.length !== 6}
            className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#17191c] px-5 text-sm font-semibold text-white shadow-[0_14px_34px_rgba(23,25,28,0.18)] transition hover:bg-[#303740] disabled:cursor-not-allowed disabled:opacity-55"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            保存并进入ViviDrop
          </button>
        </form>

        <div className="mt-4 rounded-lg border border-white/78 bg-white/58 p-5 shadow-[0_18px_54px_rgba(70,96,138,0.10)]">
          <h2 className="text-[15px] font-semibold text-[#17191c]">使用与下载手机端</h2>

          <div className="mt-4 space-y-4">
            {setupSteps.map((step) => {
              const Icon = step.icon;
              return (
                <div key={step.title} className="flex gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#eaf6ff] text-[#1684e8]">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold leading-5 text-[#17191c]">{step.title}</p>
                    <p className="mt-0.5 text-xs leading-5 text-[#85909e]">{step.description}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-6 flex justify-center gap-8">
            {[
              ['iOS', 'App Store', 'https://vividrop.app/download/ios'],
              ['Android', 'Android', 'https://vividrop.app/download/android'],
            ].map(([platform, label, url]) => (
              <div key={platform} className="flex w-[112px] flex-col items-center">
                <p className="mb-2 text-xs font-semibold text-[#17191c]">{platform}</p>
                <button
                  type="button"
                  aria-label={`${platform} 下载二维码`}
                  onClick={() => void window.electronAPI?.files?.openExternal(url)}
                  className="flex h-[112px] w-[112px] cursor-pointer items-center justify-center rounded-lg bg-white p-2 shadow-[0_16px_44px_rgba(70,96,138,0.12)] transition hover:scale-[1.015]"
                >
                  <QRCodeSVG
                    value={url}
                    size={88}
                    bgColor="#ffffff"
                    fgColor="#17191c"
                    title={`${platform} 下载二维码`}
                  />
                </button>
                <p className="mt-2 text-xs text-[#7d8794]">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <LogoutConfirmDialog
        isOpen={showLogoutConfirm}
        onClose={() => setShowLogoutConfirm(false)}
        onConfirm={() => {
          setShowLogoutConfirm(false);
          void onLogout();
        }}
        accountLabel={
          session?.phone?.trim() || session?.email?.trim() || session?.accountLabel?.trim() || ''
        }
      />
    </div>
  );
}

export function AppShell() {
  const { t } = useTranslation();
  const currentView = useAppStore((s) => s.currentView);
  const isHelpOpen = useAppStore((s) => s.isHelpOpen);
  const setHelpOpen = useAppStore((s) => s.setHelpOpen);
  const sidecarStatus = useSidecarRuntimeStore((s) => s.runtime.status);
  const session = useAuthStore((s) => s.session);
  const refreshSession = useAuthStore((s) => s.refreshSession);
  const logout = useAuthStore((s) => s.logout);
  const [downloadPanelOpen, setDownloadPanelOpen] = useState(false);
  const [authInitialized, setAuthInitialized] = useState(false);
  const authBypassEnabled = window.electronAPI?.platform?.isAuthBypassEnabled?.() ?? false;
  const [connectionSetupComplete, setConnectionSetupComplete] = useState(authBypassEnabled);
  const usesTitleBarOverlay =
    window.electronAPI?.platform?.usesTitleBarOverlayControls?.() ??
    !(window.electronAPI?.platform?.isMac?.() ?? true);

  useEffect(() => {
    let active = true;
    void refreshSession().finally(() => {
      if (active) {
        setAuthInitialized(true);
      }
    });
    return () => {
      active = false;
    };
  }, [refreshSession]);

  useEffect(() => {
    if (!session) {
      if (!authBypassEnabled) {
        setConnectionSetupComplete(false);
      }
      return;
    }

    if (authBypassEnabled) {
      setConnectionSetupComplete(true);
    }
  }, [authBypassEnabled, session]);

  useEffect(() => {
    if (!session) return;

    const api = window.electronAPI;
    if (!api) return;

    void api.sidecar.getRuntimeState().then((runtime) => {
      useSidecarRuntimeStore.getState().setRuntime(runtime);
      if (runtime.status === 'healthy') {
        useDashboardStore.getState().fetchDashboard();
        useSettingsStore.getState().fetchSettings();
        void useResourcesStore.getState().loadSharedResources();
        void useResourcesStore.getState().loadReceivedLibrary();
      }
    });

    const unsub = api.events.onSidecarRuntimeState((runtime) => {
      useSidecarRuntimeStore.getState().setRuntime(runtime);
      if (runtime.status === 'healthy') {
        useDashboardStore.getState().fetchDashboard();
        useSettingsStore.getState().fetchSettings();
        void useResourcesStore.getState().loadSharedResources();
        void useResourcesStore.getState().loadReceivedLibrary();
      }
    });

    return unsub;
  }, [session]);

  // Subscribe to sidecar events for real-time updates
  useEffect(() => {
    if (!session) return;

    const api = window.electronAPI;
    if (!api) return;
    const unsub = api.events.onSidecarEvent((event) => {
      switch (event.type) {
        case 'dashboard.updated':
          useDashboardStore.getState().updateSummary(event.payload);
          break;
        case 'upload.progress':
          useDashboardStore
            .getState()
            .updateDeviceProgress(
              event.payload.deviceId,
              event.payload.fileKey,
              event.payload.progress,
            );
          break;
        case 'device.state.changed':
          useDashboardStore
            .getState()
            .updateDeviceStatus(event.payload.deviceId, event.payload.status);
          break;
        case 'upload.completed':
        case 'upload.failed':
          useDashboardStore.getState().fetchDashboard();
          break;
        case 'disk.low':
          useDashboardStore.getState().updateSummary({
            ...useDashboardStore.getState().summary,
            isDiskLow: true,
            remainingBytes: event.payload.remainingBytes,
          });
          break;
        case 'share.status.changed':
          useSettingsStore.getState().fetchSettings();
          break;
      }
    });
    return unsub;
  }, [session]);

  // Periodic polling fallback in case WebSocket events are missed
  useEffect(() => {
    if (!session || sidecarStatus !== 'healthy') {
      return;
    }

    const interval = setInterval(() => {
      useDashboardStore.getState().fetchDashboard();
    }, 10_000);
    return () => clearInterval(interval);
  }, [session, sidecarStatus]);

  useEffect(() => {
    const openDownloadPanel = () => setDownloadPanelOpen(true);
    window.addEventListener('vividrop:open-download', openDownloadPanel);
    return () => {
      window.removeEventListener('vividrop:open-download', openDownloadPanel);
    };
  }, []);

  if (!authInitialized) {
    return (
      <div
        className="flex h-screen items-center justify-center text-[#17191c]"
        style={{
          backgroundColor: '#f7fbff',
          backgroundImage:
            'linear-gradient(135deg, rgba(255,252,247,0.98) 0%, rgba(247,252,255,0.92) 38%, rgba(239,248,255,0.92) 68%, rgba(255,248,220,0.72) 100%), repeating-linear-gradient(0deg, rgba(23,25,28,0.024) 0 1px, transparent 1px 3px)',
          backgroundBlendMode: 'normal, overlay',
        }}
      >
        <Skeleton className="h-10 w-44 rounded-lg bg-white/60" />
      </div>
    );
  }

  if (!session) {
    return <AuthPage onAuthenticated={refreshSession} />;
  }

  if (!connectionSetupComplete) {
    return (
      <ConnectionCodeSetupPage
        onComplete={() => setConnectionSetupComplete(true)}
        onLogout={async () => {
          setConnectionSetupComplete(false);
          await logout();
        }}
      />
    );
  }

  return (
    <div
      className="flex h-screen overflow-hidden text-[#17191c]"
      style={{
        backgroundColor: '#f7fbff',
        backgroundImage:
          'linear-gradient(135deg, rgba(255,252,247,0.98) 0%, rgba(247,252,255,0.92) 38%, rgba(239,248,255,0.92) 68%, rgba(255,248,220,0.72) 100%), repeating-linear-gradient(0deg, rgba(23,25,28,0.024) 0 1px, transparent 1px 3px)',
        backgroundBlendMode: 'normal, overlay',
      }}
    >
      <Sidebar />

      {/* Content area */}
      <main
        className="relative m-3 min-w-0 flex-1 overflow-hidden flex flex-col rounded-lg border border-white/60 bg-white/35 shadow-[0_30px_90px_rgba(70,96,138,0.12)] animate-in fade-in duration-300"
        style={{
          backdropFilter: 'blur(20px)',
        }}
      >
        {/* Global top-right header */}
        <div
          data-testid="global-top-actions"
          className="fixed top-6 z-50"
          style={
            {
              WebkitAppRegion: 'no-drag',
              right: usesTitleBarOverlay ? TITLE_BAR_OVERLAY_CONTROLS_INSET : 28,
            } as CSSProperties
          }
        >
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setDownloadPanelOpen(false);
                setHelpOpen(true);
              }}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full border border-white/70 bg-white/64 px-3 text-xs font-semibold text-[#4f5b68] shadow-[0_10px_26px_rgba(70,96,138,0.12)] backdrop-blur-xl transition hover:bg-white/88 hover:text-[#17191c] active:scale-[0.985] ${
                isHelpOpen ? 'border-[#746aa8] text-[#746aa8] bg-white' : ''
              }`}
            >
              <HelpCircle className="h-3.5 w-3.5" />
              {t('layout.nav.help')}
            </button>
            <button
              type="button"
              onClick={() => setDownloadPanelOpen((open) => !open)}
              aria-expanded={downloadPanelOpen}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/70 bg-white/64 px-3 text-xs font-semibold text-[#4f5b68] shadow-[0_10px_26px_rgba(70,96,138,0.12)] backdrop-blur-xl transition hover:bg-white/88 hover:text-[#17191c] active:scale-[0.985]"
            >
              <Smartphone className="h-3.5 w-3.5" />
              下载移动端
            </button>
          </div>

          {downloadPanelOpen && (
            <div className="absolute right-0 top-10 w-[300px] rounded-lg border border-white/70 bg-[#f7fbff]/96 p-4 text-[#17191c] shadow-[0_30px_80px_rgba(70,96,138,0.22)] backdrop-blur-2xl">
              <p className="text-sm font-semibold text-[#17191c]">扫码下载移动端</p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="flex flex-col items-center gap-2 rounded-md border border-white/80 bg-white/60 p-2.5">
                  <div className="text-xs font-semibold text-[#17191c]">iOS</div>
                  <div className="flex h-[88px] w-[88px] items-center justify-center rounded-md border border-white/80 bg-white p-1.5">
                    <QRCodeSVG
                      value="https://vividrop.app/download/ios"
                      size={74}
                      bgColor="#ffffff"
                      fgColor="#17191c"
                      title="iOS 下载二维码"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      void window.electronAPI?.files?.openExternal(
                        'https://vividrop.app/download/ios',
                      )
                    }
                    className="inline-flex min-h-7 w-full items-center justify-center rounded-md bg-white/70 px-2 text-[11px] font-semibold text-[#59616d] transition hover:bg-white/90 hover:text-[#17191c]"
                  >
                    App Store
                  </button>
                </div>
                <div className="flex flex-col items-center gap-2 rounded-md border border-white/80 bg-white/60 p-2.5">
                  <div className="text-xs font-semibold text-[#17191c]">Android</div>
                  <div className="flex h-[88px] w-[88px] items-center justify-center rounded-md border border-white/80 bg-white p-1.5">
                    <QRCodeSVG
                      value="https://vividrop.app/download/android"
                      size={74}
                      bgColor="#ffffff"
                      fgColor="#17191c"
                      title="Android 下载二维码"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      void window.electronAPI?.files?.openExternal(
                        'https://vividrop.app/download/android',
                      )
                    }
                    className="inline-flex min-h-7 w-full items-center justify-center rounded-md bg-white/70 px-2 text-[11px] font-semibold text-[#59616d] transition hover:bg-white/90 hover:text-[#17191c]"
                  >
                    Android
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div
          className="shrink-0 px-6 pt-2 pb-2"
          style={{ WebkitAppRegion: 'drag' } as CSSProperties}
        />
        <SidecarStatusBanner />
        <Suspense fallback={<PageFallback />}>
          {currentView === 'dashboard' && <Dashboard />}
          {currentView === 'device-detail' && <DeviceDetailPage />}
          {currentView === 'devices' && <DevicesPage />}
          {currentView === 'shared' && <SharedResourcesPage />}
          {currentView === 'library' && <ReceivedLibraryPage />}
          {currentView === 'records' && <RecordsPage />}
          {currentView === 'settings' && <SettingsPage />}
        </Suspense>
        <Suspense fallback={null}>
          <HelpDialog />
        </Suspense>
      </main>
    </div>
  );
}
