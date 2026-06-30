import { useState } from 'react';
import { Smartphone, ShieldAlert, Unlock, Wifi } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DashboardDeviceDTO, DesktopManagedDeviceDTO } from '@lynavo-drive/contracts';
import { useDashboardStore } from '@renderer/stores/dashboard-store';
import { Button } from '@renderer/components/ui/button';
import { Progress } from '@renderer/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';

function findDashboardDevice(
  dashboardDevices: DashboardDeviceDTO[],
  device: DesktopManagedDeviceDTO,
): DashboardDeviceDTO | undefined {
  return dashboardDevices.find(
    (dashboardDevice) =>
      dashboardDevice.deviceId === device.clientId ||
      dashboardDevice.stableDeviceId === device.clientId ||
      (device.stableDeviceId !== undefined &&
        dashboardDevice.stableDeviceId === device.stableDeviceId),
  );
}

export function DeviceManagementTable({
  actionsDisabled = false,
  dashboardDevices: dashboardDevicesOverride,
  devices,
  onBlock,
  onUnblock,
}: {
  actionsDisabled?: boolean;
  dashboardDevices?: DashboardDeviceDTO[];
  devices: DesktopManagedDeviceDTO[];
  onBlock: (clientId: string) => void;
  onUnblock: (clientId: string) => void;
}) {
  const { t } = useTranslation();
  const [blockTarget, setBlockTarget] = useState<DesktopManagedDeviceDTO | null>(null);
  const storeDashboardDevices = useDashboardStore((s) => s.devices);
  const dashboardDevices = dashboardDevicesOverride ?? storeDashboardDevices;

  const getDeviceStatus = (device: DesktopManagedDeviceDTO) => {
    if (device.blockStatus === 'active') {
      return 'blocked';
    }
    const matched = findDashboardDevice(dashboardDevices, device);
    if (matched?.status === 'transferring') {
      return 'transferring';
    }
    if (matched && matched.status !== 'offline') {
      return 'connected';
    }
    return 'offline';
  };

  const confirmBlockDevice = () => {
    if (!blockTarget || actionsDisabled) {
      return;
    }
    onBlock(blockTarget.clientId);
    setBlockTarget(null);
  };

  return (
    <>
      <div className="flex flex-col gap-3">
        {devices.map((device) => {
          const status = getDeviceStatus(device);
          const isBlocked = status === 'blocked';
          const isTransferring = status === 'transferring';
          const isConnected = status === 'connected' || isTransferring;
          const dashboardDevice = findDashboardDevice(dashboardDevices, device);
          const currentFile = isTransferring ? dashboardDevice?.currentFile : undefined;
          const displayName = device.displayName || t('devices.table.unnamedDevice');

          return (
            <div
              key={`${device.desktopDeviceId}:${device.clientId}`}
              className={`overflow-hidden rounded-lg border shadow-[0_14px_44px_rgba(70,96,138,0.08)] transition hover:-translate-y-0.5 ${
                isBlocked || !isConnected
                  ? 'border-white/45 bg-white/20 opacity-70 hover:bg-white/30'
                  : 'border-white/60 bg-white/34 hover:bg-white/58'
              }`}
            >
              <div className="grid w-full grid-cols-[minmax(220px,1.35fr)_104px_minmax(220px,1fr)_minmax(220px,auto)] items-center gap-4 px-4 py-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] ${
                      isConnected ? 'bg-[#eaf6ff] text-[#1677d2]' : 'bg-white/58 text-[#8d96a3]'
                    }`}
                  >
                    <Smartphone className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <h3
                        className={`truncate text-sm font-semibold ${
                          isConnected ? 'text-[#17191c]' : 'text-[#7b8490]'
                        }`}
                      >
                        {displayName}
                      </h3>
                      {isBlocked && (
                        <span className="shrink-0 rounded-md bg-[#fff0eb] px-2 py-0.5 text-[11px] font-semibold text-[#b42318]">
                          {t('devices.status.disabled')}
                        </span>
                      )}
                    </div>
                    <p
                      className={`mt-0.5 truncate text-xs ${
                        isConnected ? 'text-[#626a76]' : 'text-[#9aa2ad]'
                      }`}
                    >
                      {device.platform || 'iPhone'}
                    </p>
                  </div>
                </div>

                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      isTransferring
                        ? 'bg-[#1677d2] shadow-[0_0_0_4px_rgba(22,119,210,0.12)]'
                        : isConnected
                        ? 'bg-[#2d8f54] shadow-[0_0_0_4px_rgba(45,143,84,0.12)]'
                        : isBlocked
                          ? 'bg-[#d92d20] shadow-[0_0_0_4px_rgba(217,45,32,0.12)]'
                          : 'bg-[#b5bdc8]'
                    }`}
                  />
                  <span className="text-[11px] font-semibold text-[#626a76]">
                    {isTransferring
                      ? t('common.status.transferring')
                      : isConnected
                      ? t('devices.status.connected')
                      : isBlocked
                        ? t('devices.status.disabled')
                        : t('devices.status.offline')}
                  </span>
                </div>

                <span className="min-w-0">
                  {isBlocked && device.blockReason === 'too_many_failed_attempts' && (
                    <span className="flex items-center gap-1.5 text-[11px] font-medium text-[#b42318]">
                      <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">
                        {t('devices.blockReason.tooManyFailedAttempts')}
                      </span>
                    </span>
                  )}
                  {!isBlocked && (
                    <div className="min-w-0">
                      {isTransferring ? (
                        <div className="flex min-w-0 flex-col gap-1.5">
                          <div className="flex min-w-0 items-center justify-between gap-3 text-[11px] text-[#2f7fd3]">
                            <span className="truncate font-medium">
                              {currentFile?.filename ?? t('common.status.transferring')}
                            </span>
                            {currentFile ? (
                              <span className="shrink-0 font-semibold">
                                {Math.round(currentFile.progress)}%
                              </span>
                            ) : null}
                          </div>
                          {currentFile ? (
                            <Progress
                              value={currentFile.progress}
                              className="h-1.5 bg-[#d7ecff]"
                            />
                          ) : null}
                        </div>
                      ) : (
                        <span
                          className={`mb-1 flex items-center text-[11px] ${
                            isConnected ? 'text-[#626a76]' : 'text-[#9aa2ad]'
                          }`}
                        >
                          <span className="truncate">
                            {isConnected ? t('devices.status.connectedWaitingSync') : ''}
                          </span>
                        </span>
                      )}
                    </div>
                  )}
                </span>

                <div className="flex min-w-0 items-center justify-end gap-2">
                  {isBlocked ? (
                    <Button
                      type="button"
                      disabled={actionsDisabled}
                      onClick={() => onUnblock(device.clientId)}
                      className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[#eaf6ff] px-3 text-xs font-semibold text-[#1677d2] transition hover:bg-[#dcefff] active:scale-[0.98]"
                    >
                      <Unlock className="h-3.5 w-3.5" />
                      {t('devices.actions.unblock')}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      disabled={actionsDisabled}
                      onClick={() => setBlockTarget(device)}
                      className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[#fff0eb] px-3 text-xs font-semibold text-[#b42318] transition hover:bg-[#ffe2da] active:scale-[0.98]"
                    >
                      <Wifi className="h-3.5 w-3.5" />
                      {t('devices.actions.block')}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <Dialog
        open={blockTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setBlockTarget(null);
          }
        }}
      >
        <DialogContent className="border-white/70 bg-[#f7fbff]/96 p-0 text-[#17191c] shadow-[0_30px_90px_rgba(23,25,28,0.18)] sm:max-w-[420px]">
          <div className="space-y-5 p-5">
            <DialogHeader className="text-left">
              <DialogTitle className="text-base font-semibold text-[#17191c]">
                {t('devices.dialog.disableTitle')}
              </DialogTitle>
              <DialogDescription className="mt-1 text-xs leading-5 text-[#7b8490]">
                {blockTarget
                  ? t('devices.dialog.disableDescription', {
                      deviceName:
                        blockTarget.displayName || t('devices.table.unnamedDevice'),
                    })
                  : ''}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:justify-between">
              <button
                type="button"
                onClick={() => setBlockTarget(null)}
                className="h-10 rounded-md border border-white/70 bg-white/52 px-4 text-sm font-semibold text-[#59616d] transition hover:bg-white/78"
              >
                {t('devices.actions.cancel')}
              </button>
              <button
                type="button"
                onClick={confirmBlockDevice}
                className="h-10 rounded-md bg-[#d92d20] px-4 text-sm font-semibold text-white shadow-[0_16px_30px_rgba(217,45,32,0.22)] transition hover:bg-[#b42318]"
              >
                {t('devices.actions.confirmBlock')}
              </button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
