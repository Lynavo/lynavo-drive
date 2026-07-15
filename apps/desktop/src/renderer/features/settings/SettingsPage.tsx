import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BadgeCheck,
  ChevronDown,
  ChevronRight,
  FileUp,
  Languages,
  Mail,
  Power,
  Send,
  Smartphone,
  Wifi,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { LYNAVO_SUPPORT_URL } from '@lynavo-drive/contracts';
import { persistLocale } from '@renderer/i18n';
import {
  isSupportedLocale,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from '@renderer/i18n/locale-resolver';
import { useSettingsStore } from '@renderer/stores/settings-store';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { Label } from '@renderer/components/ui/label';
import type { PowerSaveState } from '../../../preload/api';
import { getProductName } from '../../../shared/product';

type Tone = 'blue' | 'sky' | 'green' | 'amber' | 'rose' | 'slate';
type AppInfo = Awaited<ReturnType<NonNullable<Window['electronAPI']>['support']['getAppInfo']>>;

const developerFeedbackUrl = `${LYNAVO_SUPPORT_URL}/new`;
const installedVersionFallback = '0.1.0';

const localeLabels: Record<SupportedLocale, { label: string; caption: string }> = {
  en: { label: 'English', caption: 'English UI' },
  'zh-Hans': { label: 'Simplified Chinese', caption: 'Simplified Chinese UI' },
  'zh-Hant': { label: 'Traditional Chinese', caption: 'Traditional Chinese UI' },
};

const languageOptions = SUPPORTED_LOCALES.map((locale) => ({
  id: locale,
  ...localeLabels[locale],
}));

export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);

  const [localIps, setLocalIps] = useState<string[]>([]);
  const [powerState, setPowerState] = useState<PowerSaveState | null>(null);
  const [exportingDiagnostics, setExportingDiagnostics] = useState(false);
  const [powerLoading, setPowerLoading] = useState(true);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [languageSearch, setLanguageSearch] = useState('');
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackContact, setFeedbackContact] = useState('');
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [diagnosticsDialogOpen, setDiagnosticsDialogOpen] = useState(false);
  const [diagnosticsDescription, setDiagnosticsDescription] = useState('');
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);

  const currentLocale = isSupportedLocale(i18n.resolvedLanguage) ? i18n.resolvedLanguage : 'en';
  const activeLanguage = localeLabels[currentLocale];
  const languageKeyword = languageSearch.trim().toLowerCase();
  const filteredLanguages = useMemo(() => {
    if (!languageKeyword) return languageOptions;

    return languageOptions.filter((option) =>
      `${option.id} ${option.label} ${option.caption}`.toLowerCase().includes(languageKeyword),
    );
  }, [languageKeyword]);
  const preventStandbyVal = powerState?.preventSleepDuringTransfer ?? false;
  const crossDeviceReceivedAccessEnabled = settings.allowCrossDeviceReceivedAccess !== false;
  const localIp = localIps[0] || '192.168.0.227';
  const feedbackReady = feedbackText.trim().length > 0;
  const productName = getProductName();
  const installedVersionLabel = appInfo
    ? `${appInfo.version}${appInfo.buildNumber ? ` (${appInfo.buildNumber})` : ''}`
    : installedVersionFallback;

  useEffect(() => {
    const ips = window.electronAPI?.platform.getLocalIPs?.() ?? [];
    setLocalIps(ips);
  }, []);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    void api.support
      .getAppInfo()
      .then(setAppInfo)
      .catch(() => undefined);
  }, []);

  const refreshPowerState = useCallback(async () => {
    try {
      const state = await window.electronAPI?.power.getState();
      if (state) setPowerState(state);
    } catch {
      console.warn('Failed to load power state');
    }
  }, []);

  useEffect(() => {
    refreshPowerState().finally(() => setPowerLoading(false));

    const unsub = window.electronAPI?.events.onSidecarEvent((event) => {
      if (event.type === 'transfer.active.changed') {
        void refreshPowerState();
      }
    });
    return unsub;
  }, [refreshPowerState]);

  const handleLanguageChange = (value: SupportedLocale) => {
    persistLocale(value);
    void i18n.changeLanguage(value);
    setLanguageOpen(false);
    setLanguageSearch('');
    toast.success(t('settings.profile.toasts.languageChanged'));
  };

  const togglePreventSleep = async () => {
    if (powerLoading) return;
    const currentEnabled = powerState?.preventSleepDuringTransfer ?? false;
    try {
      const nextState =
        await window.electronAPI?.power.setPreventSleepDuringTransfer(!currentEnabled);
      if (nextState) {
        setPowerState(nextState);
        toast.success(
          t(
            !currentEnabled
              ? 'settings.profile.toasts.preventSleepEnabled'
              : 'settings.profile.toasts.preventSleepDisabled',
          ),
        );
      }
    } catch {
      toast.error(t('settings.profile.toasts.preventSleepFailed'));
    }
  };

  const handleToggleCrossDeviceReceivedAccess = async (next: boolean) => {
    try {
      const updated = await window.electronAPI?.sidecar.updateSettings({
        allowCrossDeviceReceivedAccess: next,
      });
      if (updated) {
        updateSettings(updated);
      }
    } catch {
      toast.error(t('settings.profile.toasts.receivedAccessFailed'));
    }
  };

  const handleExportDiagnostics = async () => {
    const description = diagnosticsDescription.trim();
    setExportingDiagnostics(true);
    try {
      const archivePath = await window.electronAPI?.support.exportDiagnostics(
        i18n.resolvedLanguage ?? i18n.language,
        description,
      );
      if (archivePath) {
        toast.success(t('errors.settings.diagnosticsExported'), {
          description: archivePath,
        });
        setDiagnosticsDescription('');
        setDiagnosticsDialogOpen(false);
      }
    } catch (error) {
      toast.error(t('errors.settings.diagnosticsExportFailed'), {
        description: error instanceof Error ? error.message : t('errors.common.retryLater'),
      });
    } finally {
      setExportingDiagnostics(false);
    }
  };

  const handleSendFeedback = () => {
    if (!feedbackReady) return;

    const issueUrl = new URL(developerFeedbackUrl);
    issueUrl.searchParams.set(
      'title',
      t('settings.profile.feedback.issueTitle', { version: installedVersionLabel }),
    );
    issueUrl.searchParams.set(
      'body',
      t('settings.profile.feedback.issueBody', {
        description: feedbackText.trim(),
        contact: feedbackContact.trim() || t('settings.profile.feedback.contactEmpty'),
        version: installedVersionLabel,
      }),
    );

    void window.electronAPI?.files.openExternal(issueUrl.toString());
    setFeedbackSent(true);
    setFeedbackText('');
    setFeedbackOpen(false);
    toast.success(t('settings.profile.toasts.feedbackOpened'));
  };

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[1460px] px-8 py-6">
        <header className="mb-5 flex min-h-12 items-center justify-between gap-5 border-b border-white/60 pb-5">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold leading-tight text-[#17191c]">
              {t('settings.profile.title')}
            </h1>
          </div>
        </header>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,0.96fr)_minmax(0,1.04fr)]">
          <div className="space-y-5">
            <SettingsCard title={t('settings.profile.cards.community')}>
              <SettingsItem
                icon={Wifi}
                tone="green"
                title={t('settings.profile.community.title')}
                caption={t('settings.profile.community.caption')}
                action={
                  <span className="rounded-md bg-[#e9f8ee] px-2.5 py-1 text-xs font-semibold text-[#2d8f54]">
                    OSS
                  </span>
                }
              />
              <SettingsItem
                icon={Smartphone}
                tone="sky"
                title={t('settings.profile.community.devicesTitle')}
                caption={t('settings.profile.community.devicesCaption')}
              />
            </SettingsCard>

            <SettingsCard title={t('settings.profile.cards.localMachine')}>
              <SettingsItem
                icon={Wifi}
                tone="blue"
                title={t('settings.profile.localIp')}
                caption={localIp}
              />
            </SettingsCard>
          </div>

          <div className="space-y-5">
            <SettingsCard title={t('settings.profile.cards.general')}>
              <SettingsItem
                asButton
                icon={Languages}
                tone="blue"
                title={t('settings.language.label')}
                caption={activeLanguage.caption}
                onClick={() => setLanguageOpen((open) => !open)}
                action={
                  <span className="inline-flex items-center gap-2 text-xs font-semibold text-[#59616d]">
                    {activeLanguage.label}
                    <ChevronDown
                      className={`h-4 w-4 transition ${languageOpen ? 'rotate-180' : ''}`}
                    />
                  </span>
                }
              />
              {languageOpen && (
                <div className="mx-4 mb-4 rounded-lg border border-white/70 bg-white/48 p-1.5">
                  <input
                    type="search"
                    value={languageSearch}
                    onChange={(event) => setLanguageSearch(event.currentTarget.value)}
                    placeholder={t('settings.profile.language.search')}
                    aria-label={t('settings.profile.language.search')}
                    className="mb-1.5 h-9 w-full rounded-md border border-white/70 bg-white/62 px-3 text-sm text-[#17191c] outline-none transition placeholder:text-[#a4acb7] focus:border-[#66c6ff] focus:ring-2 focus:ring-[#66c6ff]/18"
                  />
                  <div className="max-h-[264px] overflow-y-auto">
                    <div className="grid grid-cols-2 gap-1.5">
                      {filteredLanguages.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => handleLanguageChange(option.id)}
                          className={`flex min-h-9 flex-col items-start justify-center rounded-md px-2.5 py-1.5 text-left transition ${
                            currentLocale === option.id
                              ? 'bg-[#eaf6ff] ring-1 ring-[#bde5ff]'
                              : 'hover:bg-white/74'
                          }`}
                        >
                          <span
                            className={`text-sm font-semibold ${
                              currentLocale === option.id ? 'text-[#1677d2]' : 'text-[#3a424d]'
                            }`}
                          >
                            {option.label}
                          </span>
                          <span className="text-[11px] text-[#8d96a3]">{option.caption}</span>
                        </button>
                      ))}
                    </div>
                    {filteredLanguages.length === 0 && (
                      <p className="px-2.5 py-3 text-center text-xs text-[#8d96a3]">
                        {t('settings.profile.language.empty')}
                      </p>
                    )}
                  </div>
                </div>
              )}
              <SettingsItem
                icon={Power}
                tone="green"
                title={t('settings.profile.preventSleep.title')}
                caption={t('settings.profile.preventSleep.caption')}
                action={
                  <button
                    type="button"
                    onClick={togglePreventSleep}
                    aria-label={t('settings.profile.preventSleep.title')}
                    aria-pressed={preventStandbyVal}
                    disabled={powerLoading}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:cursor-not-allowed ${
                      preventStandbyVal ? 'bg-[#17191c]' : 'bg-slate-200'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                        preventStandbyVal ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                }
              />
              <SettingsItem
                icon={Smartphone}
                tone="sky"
                title={t('settings.profile.receivedAccess.title')}
                caption={
                  crossDeviceReceivedAccessEnabled
                    ? t('settings.profile.receivedAccess.captionEnabled')
                    : t('settings.profile.receivedAccess.captionDisabled')
                }
                action={
                  <button
                    type="button"
                    role="switch"
                    aria-label={t('settings.profile.receivedAccess.title')}
                    aria-checked={crossDeviceReceivedAccessEnabled}
                    onClick={() =>
                      void handleToggleCrossDeviceReceivedAccess(!crossDeviceReceivedAccessEnabled)
                    }
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      crossDeviceReceivedAccessEnabled ? 'bg-[#17191c]' : 'bg-slate-200'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                        crossDeviceReceivedAccessEnabled ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                }
              />
            </SettingsCard>

            <SettingsCard title={t('settings.profile.cards.version')}>
              <SettingsItem
                icon={BadgeCheck}
                tone="green"
                title={productName}
                caption={t('settings.profile.version.caption', {
                  version: installedVersionLabel,
                })}
              />
            </SettingsCard>

            <SettingsCard title={t('settings.profile.cards.support')}>
              <SettingsItem
                asButton
                icon={Mail}
                tone="rose"
                title={t('settings.profile.feedback.title')}
                caption={
                  feedbackSent
                    ? t('settings.profile.feedback.openedCaption')
                    : t('settings.profile.feedback.issueCaption')
                }
                onClick={() => setFeedbackOpen((open) => !open)}
                action={
                  <ChevronRight
                    className={`h-4 w-4 text-[#9aa3af] transition ${
                      feedbackOpen ? 'rotate-90' : ''
                    }`}
                  />
                }
              />
              {feedbackOpen && (
                <div className="mx-4 mb-4 space-y-3 rounded-lg border border-white/70 bg-white/50 p-3">
                  <textarea
                    value={feedbackText}
                    onChange={(event) => {
                      setFeedbackText(event.currentTarget.value);
                      setFeedbackSent(false);
                    }}
                    placeholder={t('settings.profile.feedback.placeholder')}
                    rows={4}
                    className="min-h-[112px] w-full resize-none rounded-lg border border-white/80 bg-white/70 px-3 py-2.5 text-sm leading-6 text-[#17191c] outline-none transition placeholder:text-[#a4acb7] focus:border-[#66c6ff] focus:ring-2 focus:ring-[#66c6ff]/18"
                  />
                  <div className="flex items-center gap-2 rounded-lg border border-white/80 bg-white/70 px-3 py-2.5">
                    <Mail className="h-4 w-4 shrink-0 text-[#7b8490]" />
                    <input
                      value={feedbackContact}
                      onChange={(event) => setFeedbackContact(event.currentTarget.value)}
                      placeholder={t('settings.profile.feedback.contactPlaceholder')}
                      className="min-w-0 flex-1 bg-transparent text-sm text-[#17191c] outline-none placeholder:text-[#a4acb7]"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setFeedbackOpen(false)}
                      className="rounded-md border border-white/80 bg-white/58 px-3 py-2 text-sm font-semibold text-[#59616d] transition hover:bg-white/82"
                    >
                      {t('settings.profile.actions.cancel')}
                    </button>
                    <button
                      type="button"
                      onClick={handleSendFeedback}
                      disabled={!feedbackReady}
                      className="inline-flex items-center justify-center gap-2 rounded-md bg-[#17191c] px-3 py-2 text-sm font-semibold text-white shadow-[0_12px_22px_rgba(23,25,28,0.16)] transition hover:bg-[#2b2f36] disabled:cursor-not-allowed disabled:bg-[#cfd6df] disabled:text-white/80"
                    >
                      <Send className="h-4 w-4" />
                      {t('settings.profile.actions.send')}
                    </button>
                  </div>
                </div>
              )}
              <SettingsItem
                icon={FileUp}
                tone="sky"
                title={t('settings.support.exportDiagnostics')}
                caption={
                  exportingDiagnostics
                    ? t('settings.profile.diagnostics.exportingCaption')
                    : t('settings.profile.diagnostics.caption')
                }
                action={
                  <button
                    type="button"
                    onClick={() => setDiagnosticsDialogOpen(true)}
                    disabled={exportingDiagnostics}
                    className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-md bg-white/60 px-3 text-xs font-semibold text-[#59616d] transition hover:bg-white/82 disabled:cursor-not-allowed disabled:text-[#aab2bd]"
                  >
                    <FileUp className="h-3.5 w-3.5" />
                    {t('settings.support.diagnosticsSubmit')}
                  </button>
                }
              />
              <Dialog open={diagnosticsDialogOpen} onOpenChange={setDiagnosticsDialogOpen}>
                <DialogContent className="border border-white/80 bg-white/90 shadow-2xl backdrop-blur-xl">
                  <DialogHeader>
                    <DialogTitle className="text-lg font-semibold text-[#17191c]">
                      {t('settings.support.exportDiagnostics')}
                    </DialogTitle>
                    <DialogDescription className="text-xs text-[#7b8490]">
                      {t('settings.profile.diagnostics.description')}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-2">
                    <Label
                      htmlFor="diagnostics-description"
                      className="text-xs font-semibold text-[#858b96]"
                    >
                      {t('settings.support.diagnosticsDescriptionLabel')}
                    </Label>
                    <textarea
                      id="diagnostics-description"
                      value={diagnosticsDescription}
                      onChange={(event) => setDiagnosticsDescription(event.target.value)}
                      placeholder={t('settings.profile.diagnostics.placeholder')}
                      maxLength={500}
                      className="min-h-28 w-full resize-none rounded-lg border border-white/80 bg-white/70 px-3 py-2.5 text-sm leading-6 text-[#17191c] outline-none transition placeholder:text-[#a4acb7] focus:border-[#66c6ff] focus:ring-2 focus:ring-[#66c6ff]/18 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={exportingDiagnostics}
                    />
                    <div className="flex justify-end text-[11px] text-[#9aa3af]">
                      {diagnosticsDescription.length}/500
                    </div>
                  </div>
                  <DialogFooter className="flex justify-end gap-2">
                    <button
                      type="button"
                      data-testid="cancel-diagnostics-btn"
                      disabled={exportingDiagnostics}
                      onClick={() => {
                        setDiagnosticsDialogOpen(false);
                        setDiagnosticsDescription('');
                      }}
                      className="rounded-md border border-white/80 bg-white/58 px-3 py-2 text-sm font-semibold text-[#59616d] transition hover:bg-white/82 disabled:opacity-50"
                    >
                      {t('settings.support.diagnosticsCancel')}
                    </button>
                    <button
                      type="button"
                      data-testid="submit-diagnostics-btn"
                      disabled={exportingDiagnostics}
                      onClick={() => void handleExportDiagnostics()}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#17191c] px-4 py-2 text-sm font-semibold text-white shadow-[0_12px_22px_rgba(23,25,28,0.16)] transition hover:bg-[#2b2f36] disabled:cursor-not-allowed disabled:bg-[#cfd6df]"
                    >
                      <FileUp className="h-4 w-4" />
                      {t('settings.support.diagnosticsSubmit')}
                    </button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </SettingsCard>
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 px-1 text-xs font-semibold text-[#6e7784]">{title}</h2>
      <div className="overflow-hidden rounded-lg border border-white/70 bg-white/56 shadow-[0_18px_54px_rgba(70,96,138,0.1)] backdrop-blur-xl">
        {children}
      </div>
    </section>
  );
}

function SettingsItem({
  action,
  asButton = false,
  caption,
  icon,
  onClick,
  title,
  tone,
}: {
  action?: ReactNode;
  asButton?: boolean;
  caption: string;
  icon: LucideIcon;
  onClick?: () => void;
  title: string;
  tone: Tone;
}) {
  const Icon = icon;
  const content = (
    <>
      <ToneIcon icon={Icon} tone={tone} />
      <div className="min-w-0 flex-1 text-left">
        <p className="truncate text-sm font-semibold text-[#17191c]">{title}</p>
        <p className="mt-1 truncate text-xs leading-5 text-[#7b8490]">{caption}</p>
      </div>
      {action && <div className="flex shrink-0 items-center">{action}</div>}
    </>
  );
  const className =
    'flex min-h-[72px] w-full items-center gap-3 border-b border-white/62 px-4 py-3 last:border-b-0 transition';

  if (asButton) {
    return (
      <button type="button" onClick={onClick} className={`${className} hover:bg-white/54`}>
        {content}
      </button>
    );
  }

  return <div className={className}>{content}</div>;
}

function ToneIcon({ icon: Icon, tone }: { icon: LucideIcon; tone: Tone }) {
  const cls = {
    blue: 'bg-[#eaf6ff] text-[#1677d2]',
    sky: 'bg-[#e8fbff] text-[#0d8bbf]',
    green: 'bg-[#e9f8ee] text-[#2d8f54]',
    amber: 'bg-[#fff5dc] text-[#9a6700]',
    rose: 'bg-[#fff0f4] text-[#af4560]',
    slate: 'bg-white/54 text-[#626a76]',
  }[tone];

  return (
    <div
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] ${cls}`}
    >
      <Icon className="h-5 w-5" />
    </div>
  );
}
