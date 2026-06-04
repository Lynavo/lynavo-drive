import { useTranslation } from 'react-i18next';
import { BonjourRuntimeSection } from './BonjourRuntimeSection';
import { ConnectionCodeSection } from './ConnectionCodeSection';
import { DeviceNameSection } from './DeviceNameSection';
import { LanguageSection } from './LanguageSection';
import { ShareAddressSection } from './ShareAddressSection';
import { SupportSection } from './SupportSection';

export function SettingsPage() {
  const { t } = useTranslation();
  const isWindows = window.electronAPI?.platform.isWindows?.() ?? false;

  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto max-w-2xl px-6 py-8">
        <h1 className="mb-8 text-xl font-semibold text-foreground">{t('settings.title')}</h1>

        <section className="mb-8">
          <h2 className="mb-1 text-sm font-semibold text-foreground">
            {t('settings.sections.language')}
          </h2>
          <LanguageSection />
        </section>

        {/* Device Name */}
        <section className="mb-8">
          <h2 className="mb-1 text-sm font-semibold text-foreground">
            {t('settings.sections.deviceName')}
          </h2>
          <p className="mb-4 text-xs text-muted-foreground">
            {t('settings.sections.deviceNameDescription')}
          </p>
          <DeviceNameSection />
        </section>

        {/* Connection Code */}
        <section className="mb-8">
          <h2 className="mb-1 text-sm font-semibold text-foreground">
            {t('settings.sections.connectionCode')}
          </h2>
          <p className="mb-4 text-xs text-muted-foreground">
            {t('settings.sections.connectionCodeDescription')}
          </p>
          <ConnectionCodeSection />
        </section>

        {isWindows && (
          <section className="mb-8">
            <h2 className="mb-1 text-sm font-semibold text-foreground">
              {t('settings.sections.bonjour')}
            </h2>
            <p className="mb-4 text-xs text-muted-foreground">
              {t('settings.sections.bonjourDescription')}
            </p>
            <BonjourRuntimeSection />
          </section>
        )}

        <section className="mb-8">
          <h2 className="mb-1 text-sm font-semibold text-foreground">
            {t('settings.sections.shareAddress')}
          </h2>
          <p className="mb-4 text-xs text-muted-foreground">
            {t('settings.sections.shareAddressDescription')}
          </p>
          <ShareAddressSection />
        </section>

        <section className="mt-8">
          <SupportSection />
        </section>
      </div>
    </div>
  );
}
