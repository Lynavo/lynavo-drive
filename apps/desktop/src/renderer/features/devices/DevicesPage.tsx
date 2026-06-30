import { useEffect, useMemo, useState } from 'react';
import { Smartphone, ShieldAlert, Wifi } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DesktopManagedDeviceDTO } from '@lynavo-drive/contracts';
import { useManagementStore } from '@renderer/stores/management-store';
import { useDashboardStore } from '@renderer/stores/dashboard-store';
import { DeviceManagementTable } from './DeviceManagementTable';
import { Skeleton } from '@renderer/components/ui/skeleton';

type DeviceStatusFilter = 'all' | 'blocked' | 'connected';

export function DevicesPage() {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<DeviceStatusFilter>('all');

  const devices = useManagementStore((state) => state.devices);
  const loading = useManagementStore((state) => state.devicesLoading);
  const error = useManagementStore((state) => state.devicesError);
  const loadDevices = useManagementStore((state) => state.loadDevices);
  const unblockDevice = useManagementStore((state) => state.unblockDevice);
  const blockDevice = useManagementStore((state) => state.blockDevice);

  const dashboardDevices = useDashboardStore((state) => state.devices);
  const fetchDashboard = useDashboardStore((state) => state.fetchDashboard);

  useEffect(() => {
    void loadDevices();
    void fetchDashboard();
  }, [loadDevices, fetchDashboard]);

  const visibleDevices = devices;
  const visibleDashboardDevices = dashboardDevices;

  const totalDevices = visibleDevices.length;
  const blockedDevices = visibleDevices.filter((d) => d.blockStatus === 'active').length;

  const connectedDevices = visibleDevices.filter((d) => {
    if (d.blockStatus === 'active') {
      return false;
    }

    const matched = visibleDashboardDevices.find(
      (dd) => dd.stableDeviceId === d.clientId || dd.deviceId === d.clientId,
    );
    return matched && matched.status !== 'offline';
  }).length;

  const isConnectedDevice = (device: DesktopManagedDeviceDTO) => {
    if (device.blockStatus === 'active') {
      return false;
    }

    const matched = visibleDashboardDevices.find(
      (dd) => dd.stableDeviceId === device.clientId || dd.deviceId === device.clientId,
    );
    return Boolean(matched && matched.status !== 'offline');
  };

  const filteredDevices =
    statusFilter === 'blocked'
      ? visibleDevices.filter((device) => device.blockStatus === 'active')
      : statusFilter === 'connected'
        ? visibleDevices.filter(isConnectedDevice)
        : visibleDevices;

  const handleBlockDevice = (clientId: string) => {
    void blockDevice(clientId);
  };

  const handleUnblockDevice = (clientId: string) => {
    void unblockDevice(clientId);
  };

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[1460px] px-8 py-6">
        <header className="mb-5 flex min-h-12 items-center justify-between gap-5 border-b border-white/60 pb-5">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold leading-tight text-[#17191c]">
              {t('devices.title')}
            </h1>
          </div>
        </header>

        {/* 3 Overview Stat Cards */}
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {/* Card 1: Total Devices */}
          <button
            type="button"
            aria-pressed={statusFilter === 'all'}
            onClick={() => setStatusFilter('all')}
            className={`flex min-h-[84px] items-center gap-4 rounded-lg border px-5 py-4 text-left text-[#2788dc] shadow-[0_14px_36px_rgba(75,158,226,0.11)] backdrop-blur-xl transition hover:-translate-y-0.5 hover:bg-[#eaf6ff]/82 ${
              statusFilter === 'all'
                ? 'border-[#9ed8ff] bg-[#eaf6ff]/82 ring-2 ring-[#1677d2]/15'
                : 'border-white/70 bg-[#f0f8ff]/72'
            }`}
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[#48a7f4] text-white shadow-[0_12px_26px_rgba(72,167,244,0.28)]">
              <Smartphone className="h-5 w-5" />
            </div>
            <div className="min-w-0 text-left">
              <p className="truncate text-xs font-semibold text-[#697786]">
                {t('devices.stats.total')}
              </p>
              <p className="mt-1 text-2xl font-semibold leading-none text-[#17191c]">
                {totalDevices}
              </p>
            </div>
          </button>

          {/* Card 2: Blocked/Disabled */}
          <button
            type="button"
            aria-pressed={statusFilter === 'blocked'}
            onClick={() =>
              setStatusFilter((current) => (current === 'blocked' ? 'all' : 'blocked'))
            }
            className={`flex min-h-[84px] items-center gap-4 rounded-lg border px-5 py-4 text-left text-[#2c9c5a] shadow-[0_14px_36px_rgba(64,176,101,0.11)] backdrop-blur-xl transition hover:-translate-y-0.5 hover:bg-[#ecf9ef]/82 ${
              statusFilter === 'blocked'
                ? 'border-[#a8e2bc] bg-[#ecf9ef]/82 ring-2 ring-[#2c9c5a]/15'
                : 'border-white/70 bg-[#f1fbf3]/76'
            }`}
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[#46c878] text-white shadow-[0_12px_26px_rgba(70,200,120,0.25)]">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div className="min-w-0 text-left">
              <p className="truncate text-xs font-semibold text-[#697786]">
                {t('devices.stats.disabled')}
              </p>
              <p className="mt-1 text-2xl font-semibold leading-none text-[#17191c]">
                {blockedDevices}
              </p>
            </div>
          </button>

          {/* Card 3: Connected */}
          <button
            type="button"
            aria-pressed={statusFilter === 'connected'}
            onClick={() =>
              setStatusFilter((current) => (current === 'connected' ? 'all' : 'connected'))
            }
            className={`flex min-h-[84px] items-center gap-4 rounded-lg border px-5 py-4 text-left text-[#14a4d8] shadow-[0_14px_36px_rgba(49,176,215,0.11)] backdrop-blur-xl transition hover:-translate-y-0.5 hover:bg-[#e7faff]/82 ${
              statusFilter === 'connected'
                ? 'border-[#98e0f3] bg-[#e7faff]/82 ring-2 ring-[#14a4d8]/15'
                : 'border-white/70 bg-[#eefbff]/74'
            }`}
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[#22b5e4] text-white shadow-[0_12px_26px_rgba(34,181,228,0.24)]">
              <Wifi className="h-5 w-5" />
            </div>
            <div className="min-w-0 text-left">
              <p className="truncate text-xs font-semibold text-[#697786]">
                {t('devices.stats.connected')}
              </p>
              <p className="mt-1 text-2xl font-semibold leading-none text-[#17191c]">
                {connectedDevices}
              </p>
            </div>
          </button>
        </div>

        {/* Device List Container */}
        <div className="flex flex-col gap-3 border-y border-white/60 py-3">
          {loading && visibleDevices.length === 0 && (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full rounded-lg" />
              <Skeleton className="h-16 w-full rounded-lg" />
            </div>
          )}

          {error && !loading && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 shadow-sm">
              {error}
            </div>
          )}

          {!loading && !error && filteredDevices.length === 0 && (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-white/70 bg-white/24 px-6 text-center">
              <Smartphone className="h-8 w-8 text-slate-400" />
              <h2 className="mt-3 text-sm font-bold text-slate-800">
                {t('devices.empty.title')}
              </h2>
              <p className="mt-1 text-xs text-slate-400">
                {t('devices.empty.description')}
              </p>
            </div>
          )}

          {!error && filteredDevices.length > 0 && (
            <DeviceManagementTable
              dashboardDevices={visibleDashboardDevices}
              devices={filteredDevices}
              onBlock={handleBlockDevice}
              onUnblock={handleUnblockDevice}
            />
          )}
        </div>
      </div>
    </div>
  );
}
