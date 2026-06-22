import { useCallback } from 'react';
import { BookOpen, FolderOpen, Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@renderer/components/ui/button';
import { useSettingsStore } from '@renderer/stores/settings-store';

const MAC_SHARING_GUIDE_URL =
  'https://support.apple.com/guide/mac-help/set-up-file-sharing-on-mac-mh17131/mac';
const WINDOWS_SHARING_SETTINGS_URI = 'ms-settings:network-advancedsettings';

export function SystemGuideSection() {
  const { t } = useTranslation();
  const sharedPath = useSettingsStore((s) => s.settings.sharedPath);
  const isMac = window.electronAPI?.platform.isMac() ?? true;
  const isWindows = window.electronAPI?.platform.isWindows?.() ?? false;
  const isLinux = window.electronAPI?.platform.isLinux?.() ?? false;
  const handleOpenMacGuide = useCallback(() => {
    void window.electronAPI?.files.openExternal(MAC_SHARING_GUIDE_URL);
  }, []);
  const handleOpenWindowsSettings = useCallback(() => {
    void window.electronAPI?.files.openExternal(WINDOWS_SHARING_SETTINGS_URI);
  }, []);
  const handleOpenSharedFolder = useCallback(() => {
    void window.electronAPI?.files.openFolder(sharedPath);
  }, [sharedPath]);

  if (isMac) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <button
          onClick={handleOpenMacGuide}
          className="flex cursor-pointer items-center gap-3 rounded-xl bg-secondary px-4 py-3 text-left transition-[background-color,transform,box-shadow] duration-150 ease-out hover:bg-secondary/80 hover:shadow-sm active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 focus-visible:ring-offset-2"
        >
          <BookOpen className="h-5 w-5 text-primary" />
          <div>
            <p className="text-sm font-medium text-foreground">
              {t('settings.systemGuide.macTitle')}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('settings.systemGuide.macSubtitle')}
            </p>
          </div>
        </button>
      </div>
    );
  }

  if (isLinux) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="mb-3">
          <p className="text-sm font-medium text-foreground">
            {t('settings.systemGuide.linuxTitle')}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('settings.systemGuide.linuxDescription')}
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleOpenSharedFolder}
          disabled={!sharedPath}
        >
          <FolderOpen className="h-4 w-4" />
          {t('settings.filePath.openShared')}
        </Button>
      </div>
    );
  }

  const windowsSteps = t('settings.systemGuide.steps', { returnObjects: true }) as string[];

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-3">
        <p className="text-sm font-medium text-foreground">
          {t('settings.systemGuide.windowsTitle')}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('settings.systemGuide.windowsDescription')}
        </p>
      </div>

      {isWindows ? (
        <div className="mb-3 flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={handleOpenWindowsSettings}>
            <Settings2 className="h-4 w-4" />
            {t('settings.shareAddress.openAdvancedSharing')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleOpenSharedFolder}
            disabled={!sharedPath}
          >
            <FolderOpen className="h-4 w-4" />
            {t('settings.filePath.openShared')}
          </Button>
        </div>
      ) : null}

      <ol className="space-y-2 text-sm text-muted-foreground">
        {windowsSteps.map((step, index) => (
          <li key={step}>
            {index + 1}. {step}
          </li>
        ))}
      </ol>
    </div>
  );
}
