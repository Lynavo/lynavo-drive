import { Copy, Folder, FolderOpen, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DeviceReceiveLocationDTO } from '@lynavo-drive/contracts';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusElement?.focus();
        }}
        className="flex max-h-[80vh] flex-col gap-0 overflow-hidden rounded-lg border-white/70 bg-[#f7fbff]/96 p-0 text-[#17191c] shadow-[0_30px_90px_rgba(23,25,28,0.18)] sm:max-w-[620px]"
      >
        <DialogHeader className="relative border-b border-white/70 px-5 py-4 pr-14 text-left">
          <DialogTitle className="text-base font-semibold text-[#17191c]">
            {t('directory.library.locationDialog.title')}
          </DialogTitle>
          <DialogDescription className="flex min-w-0 items-center gap-1.5 text-xs text-[#626a76]">
            <span>{t('directory.library.locationDialog.description')}</span>
            <span className="truncate font-semibold text-[#3d4653]" title={deviceName}>
              {deviceName}
            </span>
          </DialogDescription>
          <DialogClose asChild>
            <button
              type="button"
              className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-md text-[#626a76] transition hover:bg-white/80 hover:text-[#17191c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1677d2]/45"
              aria-label={t('directory.library.locationDialog.close')}
              title={t('directory.library.locationDialog.close')}
            >
              <X className="h-4 w-4" />
            </button>
          </DialogClose>
        </DialogHeader>

        <ul className="min-h-0 max-h-[52vh] overflow-y-auto divide-y divide-white/70 px-5">
          {locations.map((location) => (
            <li
              key={location.path}
              className="grid grid-cols-[minmax(0,1fr)_36px] items-center gap-3 py-3"
            >
              <button
                type="button"
                disabled={!location.available || opening}
                onClick={() => onOpenLocation(location)}
                className="flex min-w-0 items-center gap-3 rounded-md px-2 py-2 text-left transition hover:bg-white/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1677d2]/45 disabled:cursor-not-allowed disabled:opacity-70"
                aria-label={`${t('directory.library.locationDialog.open')}: ${location.path}`}
                title={
                  location.available
                    ? t('directory.library.locationDialog.open')
                    : t('directory.library.locationDialog.unavailableAction')
                }
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#eaf6ff] text-[#1677d2]">
                  {location.available ? (
                    <FolderOpen className="h-4 w-4" />
                  ) : (
                    <Folder className="h-4 w-4" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    data-testid="receive-location-path"
                    className="block truncate text-[13px] font-semibold text-[#17191c]"
                    title={location.path}
                  >
                    {location.path}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
                    <span className={location.isCurrent ? 'text-[#1677d2]' : 'text-[#697786]'}>
                      {t(
                        location.isCurrent
                          ? 'directory.library.locationDialog.current'
                          : 'directory.library.locationDialog.history',
                      )}
                    </span>
                    {!location.available ? (
                      <span className="text-[#d04f41]">
                        {t('directory.library.locationDialog.unavailable')}
                      </span>
                    ) : null}
                  </span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleCopyPath(location.path)}
                className="flex h-9 w-9 items-center justify-center rounded-md text-[#626a76] transition hover:bg-white/80 hover:text-[#1677d2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1677d2]/45"
                aria-label={t('directory.library.locationDialog.copyPath')}
                title={t('directory.library.locationDialog.copyPath')}
              >
                <Copy className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
