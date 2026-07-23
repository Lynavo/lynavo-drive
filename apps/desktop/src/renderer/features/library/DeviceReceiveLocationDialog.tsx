import { Copy, Folder, FolderOpen, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DeviceReceiveLocationDTO } from '@lynavo-drive/contracts';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';

interface DeviceReceiveLocationDialogProps {
  open: boolean;
  deviceName: string;
  locations: DeviceReceiveLocationDTO[];
  opening: boolean;
  returnFocusElement: HTMLButtonElement | null;
  onOpenChange(open: boolean): void;
  onOpenLocation(location: DeviceReceiveLocationDTO): void;
}

export function DeviceReceiveLocationDialog({
  open,
  deviceName,
  locations,
  opening,
  returnFocusElement,
  onOpenChange,
  onOpenLocation,
}: DeviceReceiveLocationDialogProps) {
  const { t } = useTranslation();

  const handleCopyPath = (path: string) => {
    const copyToClipboard = window.electronAPI?.files.copyToClipboard;
    if (!copyToClipboard) return;
    void copyToClipboard(path).catch(() => undefined);
  };

  const getStatus = (location: DeviceReceiveLocationDTO) => {
    if (!location.available) return t('directory.library.locationDialog.unavailable');
    if (location.isCurrent) return t('directory.library.locationDialog.current');
    return t('directory.library.locationDialog.history');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusElement?.focus();
        }}
        className="gap-0 overflow-hidden border-[#dce7f1] bg-[#f7fbff] p-0 text-[#17191c] shadow-[0_24px_72px_rgba(35,58,80,0.18)] sm:max-w-[640px]"
      >
        <DialogClose asChild>
          <button
            type="button"
            aria-label={t('directory.library.locationDialog.closeDialog')}
            title={t('directory.library.locationDialog.close')}
            className="absolute right-4 top-5 flex h-8 w-8 items-center justify-center rounded-md text-[#687585] transition hover:bg-[#e7f3fc] hover:text-[#1677d2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#48a7f4]/40"
          >
            <X className="h-4 w-4" />
          </button>
        </DialogClose>
        <DialogHeader className="flex-row items-center gap-3 border-b border-[#dce7f1] px-5 py-4 pr-14 text-left">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#e6f4ff] text-[#1683e6]">
            <Folder className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <DialogTitle className="text-base font-semibold leading-6">
              {t('directory.library.locationDialog.title')}
            </DialogTitle>
            <DialogDescription
              className="truncate text-xs leading-5 text-[#687585]"
              title={deviceName}
            >
              {t('directory.library.locationDialog.description', { deviceName })}
            </DialogDescription>
          </div>
        </DialogHeader>
        <div className="max-h-[min(60vh,420px)] overflow-y-auto px-5 py-4">
          <ul className="divide-y divide-[#d7e3ee] overflow-hidden rounded-lg border border-[#d7e3ee] bg-white/45">
            {locations.map((location) => (
              <li
                key={location.path}
                className="flex min-h-[60px] items-center gap-3 px-3 py-2.5 transition-colors hover:bg-white/70"
              >
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
                    location.available
                      ? 'bg-[#e6f4ff] text-[#1683e6]'
                      : 'bg-[#edf1f5] text-[#8a96a3]'
                  }`}
                >
                  <Folder className="h-[18px] w-[18px]" />
                </div>
                {location.available ? (
                  <button
                    type="button"
                    disabled={opening}
                    onClick={() => onOpenLocation(location)}
                    className="min-w-0 flex-1 rounded px-1 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#48a7f4]/40 disabled:cursor-wait"
                  >
                    <span
                      data-testid="receive-location-path"
                      className="block truncate font-mono text-[13px] font-medium text-[#303943]"
                      title={location.path}
                    >
                      {location.path}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-[#748190]">
                      {getStatus(location)}
                    </span>
                  </button>
                ) : (
                  <div className="min-w-0 flex-1 px-1 py-1 text-left">
                    <span
                      data-testid="receive-location-path"
                      className="block truncate font-mono text-[13px] font-medium text-[#7b8794]"
                      title={location.path}
                    >
                      {location.path}
                    </span>
                    <span className="mt-0.5 block text-[11px] font-medium text-[#a04b43]">
                      {getStatus(location)}
                    </span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => handleCopyPath(location.path)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[#687585] transition hover:bg-[#e6f4ff] hover:text-[#1677d2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#48a7f4]/40"
                  aria-label={t('directory.library.locationDialog.copyPath')}
                  title={t('directory.library.locationDialog.copyPath')}
                >
                  <Copy className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  disabled={!location.available || opening}
                  onClick={() => onOpenLocation(location)}
                  className="flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-[#b9dcf8] bg-[#edf8ff] px-3 text-xs font-medium text-[#0878d1] transition hover:border-[#88c6f4] hover:bg-[#e2f3ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#48a7f4]/40 disabled:cursor-not-allowed disabled:border-[#d7e0e8] disabled:bg-[#f1f4f7] disabled:text-[#98a3ae]"
                >
                  <FolderOpen className="h-4 w-4" />
                  {location.available
                    ? t('directory.library.locationDialog.open')
                    : t('directory.library.locationDialog.unavailableAction')}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <DialogFooter className="flex-row items-center justify-between border-t border-[#dce7f1] px-5 py-3.5">
          <span className="text-xs text-[#687585]">
            {t('directory.library.locationDialog.folderCount', { count: locations.length })}
          </span>
          <DialogClose asChild>
            <button
              type="button"
              className="h-9 rounded-md border border-[#d7e0e8] bg-white px-4 text-xs font-medium text-[#3b4652] shadow-sm transition hover:bg-[#f4f8fb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#48a7f4]/40"
            >
              {t('directory.library.locationDialog.close')}
            </button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
