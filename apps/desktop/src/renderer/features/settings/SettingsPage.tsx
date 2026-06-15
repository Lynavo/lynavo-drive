import { useTranslation } from 'react-i18next';
import { DeviceNameSection } from './DeviceNameSection';
import { LanguageSection } from './LanguageSection';
import { PowerSaveSection } from './PowerSaveSection';

export function SettingsPage() {
  const { t } = useTranslation();

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

        <section className="mb-8">
          <h2 className="mb-1 text-sm font-semibold text-foreground">
            {t('settings.sections.powerSave')}
          </h2>
          <p className="mb-4 text-xs text-muted-foreground">
            {t('settings.sections.powerSaveDescription')}
          </p>
          <PowerSaveSection />
        </section>
      </div>
    </div>
  );
}
