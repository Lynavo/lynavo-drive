import { lazy, Suspense, useEffect, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { GlassCard } from '@renderer/components/shared/GlassCard';
import { Skeleton } from '@renderer/components/ui/skeleton';
import { useAppStore } from '@renderer/stores/app-store';
import { useDashboardStore } from '@renderer/stores/dashboard-store';
import { useSettingsStore } from '@renderer/stores/settings-store';
import { useSidecarRuntimeStore } from '@renderer/stores/sidecar-runtime-store';
import { useResourcesStore } from '@renderer/stores/resources-store';
import { ErrorBoundary } from '@renderer/components/shared/ErrorBoundary';
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
const HelpPage = lazy(() =>
  import('@renderer/features/help/HelpPage').then((m) => ({
    default: m.HelpPage,
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

function PageFallback() {
  return <Skeleton className="flex-1" />;
}

export function AppShell() {
  const { t } = useTranslation();
  const currentView = useAppStore((s) => s.currentView);
  const sidecarStatus = useSidecarRuntimeStore((s) => s.runtime.status);

  useEffect(() => {
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
  }, []);

  // Subscribe to sidecar events for real-time updates
  useEffect(() => {
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
  }, []);

  // Periodic polling fallback in case WebSocket events are missed
  useEffect(() => {
    if (sidecarStatus !== 'healthy') {
      return;
    }

    const interval = setInterval(() => {
      useDashboardStore.getState().fetchDashboard();
    }, 10_000);
    return () => clearInterval(interval);
  }, [sidecarStatus]);

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
        className="m-3 min-w-0 flex-1 overflow-hidden flex flex-col rounded-2xl border border-white/60 bg-white/35 shadow-[0_30px_90px_rgba(70,96,138,0.12)]"
        style={{
          backdropFilter: 'blur(20px)',
        }}
      >
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
          {currentView === 'help' && (
            <ErrorBoundary fallbackMessage={t('layout.errorBoundary.helpLoadFailed')}>
              <HelpPage />
            </ErrorBoundary>
          )}
        </Suspense>
      </main>
    </div>
  );
}

