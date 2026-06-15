import { lazy, Suspense, useEffect, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { GlassCard } from '@renderer/components/shared/GlassCard';
import { Skeleton } from '@renderer/components/ui/skeleton';
import { useAppStore } from '@renderer/stores/app-store';
import { useDashboardStore } from '@renderer/stores/dashboard-store';
import { useSettingsStore } from '@renderer/stores/settings-store';
import { useSidecarRuntimeStore } from '@renderer/stores/sidecar-runtime-store';
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

function PageFallback() {
  return <Skeleton className="flex-1" />;
}

function DesktopLocalPlaceholder({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex-1 overflow-auto px-6 py-8">
      <GlassCard className="mx-auto max-w-3xl p-8">
        <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{description}</p>
      </GlassCard>
    </div>
  );
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
      }
    });

    const unsub = api.events.onSidecarRuntimeState((runtime) => {
      useSidecarRuntimeStore.getState().setRuntime(runtime);
      if (runtime.status === 'healthy') {
        useDashboardStore.getState().fetchDashboard();
        useSettingsStore.getState().fetchSettings();
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
      className="flex h-screen overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, #daeef8 0%, #e8f5fb 40%, #f0f8fd 70%, #f8fbff 100%)',
      }}
    >
      <Sidebar />

      {/* Content area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div
          className="shrink-0 px-6 pt-2 pb-2"
          style={{ WebkitAppRegion: 'drag' } as CSSProperties}
        />
        <SidecarStatusBanner />
        <Suspense fallback={<PageFallback />}>
          {currentView === 'dashboard' && <Dashboard />}
          {currentView === 'device-detail' && <DeviceDetailPage />}
          {currentView === 'devices' && (
            <DesktopLocalPlaceholder
              title={t('layout.placeholders.devices.title')}
              description={t('layout.placeholders.devices.description')}
            />
          )}
          {currentView === 'shared' && (
            <DesktopLocalPlaceholder
              title={t('layout.placeholders.shared.title')}
              description={t('layout.placeholders.shared.description')}
            />
          )}
          {currentView === 'library' && (
            <DesktopLocalPlaceholder
              title={t('layout.placeholders.library.title')}
              description={t('layout.placeholders.library.description')}
            />
          )}
          {currentView === 'records' && (
            <DesktopLocalPlaceholder
              title={t('layout.placeholders.records.title')}
              description={t('layout.placeholders.records.description')}
            />
          )}
          {currentView === 'settings' && <SettingsPage />}
          {currentView === 'help' && (
            <ErrorBoundary fallbackMessage={t('layout.errorBoundary.helpLoadFailed')}>
              <HelpPage />
            </ErrorBoundary>
          )}
        </Suspense>
      </div>
    </div>
  );
}
