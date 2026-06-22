import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BadgeCheck,
  ChevronDown,
  ChevronRight,
  Crown,
  FileUp,
  Globe,
  Languages,
  Mail,
  Power,
  RefreshCw,
  Send,
  Smartphone,
  UserCircle,
  Wifi,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { persistLocale } from '@renderer/i18n';
import {
  isSupportedLocale,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from '@renderer/i18n/locale-resolver';
import { useAuthStore } from '@renderer/stores/auth-store';
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
import { ShareAddressSection } from './ShareAddressSection';
import { SystemGuideSection } from './SystemGuideSection';

type Tone = 'blue' | 'sky' | 'green' | 'amber' | 'rose' | 'slate';
type AppInfo = Awaited<ReturnType<NonNullable<Window['electronAPI']>['support']['getAppInfo']>>;

const developerFeedbackEmail = 'developer@vividrop.app';
const installedVersionFallback = '0.1.0';

const localeLabels: Record<SupportedLocale, { label: string; caption: string }> = {
  en: { label: 'English', caption: 'English UI' },
  'zh-Hans': { label: '简体中文', caption: '简体中文界面' },
  'zh-Hant': { label: '繁體中文', caption: '繁體中文介面' },
};

const languageOptions = SUPPORTED_LOCALES.map((locale) => ({
  id: locale,
  ...localeLabels[locale],
}));

export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const session = useAuthStore((s) => s.session);
  const accountEmail =
    session?.email || session?.phone || session?.accountLabel || 'vividrop@studio.example';

  const [localIps, setLocalIps] = useState<string[]>([]);
  const [powerState, setPowerState] = useState<PowerSaveState | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [uploadingLogs, setUploadingLogs] = useState(false);
  const [powerLoading, setPowerLoading] = useState(true);
  const [accountOpen, setAccountOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [languageSearch, setLanguageSearch] = useState('');
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackContact, setFeedbackContact] = useState(accountEmail);
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
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
  const localIp = localIps[0] || '192.168.0.227';
  const feedbackReady = feedbackText.trim().length > 0;
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

  useEffect(() => {
    setFeedbackContact(accountEmail);
  }, [accountEmail]);

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
    toast.success('界面语言修改成功');
  };

  const togglePreventSleep = async () => {
    if (powerLoading) return;
    const currentEnabled = powerState?.preventSleepDuringTransfer ?? false;
    try {
      const nextState =
        await window.electronAPI?.power.setPreventSleepDuringTransfer(!currentEnabled);
      if (nextState) {
        setPowerState(nextState);
        toast.success(!currentEnabled ? '防止电脑待机已启用' : '防止电脑待机已关闭');
      }
    } catch {
      toast.error('修改防止待机配置失败');
    }
  };

  const handleCheckUpdates = async () => {
    setCheckingUpdates(true);
    try {
      await window.electronAPI?.support.checkForUpdates();
      toast.success('已是最新版本');
    } catch {
      toast.error('检查更新失败，请稍后重试');
    } finally {
      setCheckingUpdates(false);
    }
  };

  const handleUploadLogs = async () => {
    const description = diagnosticsDescription.trim();
    setUploadingLogs(true);
    try {
      await window.electronAPI?.support.uploadDiagnostics({
        description: description || 'Manual upload from desktop settings',
        locale: i18n.resolvedLanguage ?? i18n.language,
      });
      toast.success('诊断包上传成功！感谢您的反馈');
      setDiagnosticsDescription('');
      setUploadDialogOpen(false);
    } catch {
      toast.error('上传诊断包失败，请检查网络连接');
    } finally {
      setUploadingLogs(false);
    }
  };

  const handleSendFeedback = () => {
    if (!feedbackReady) return;

    const subject = encodeURIComponent(`ViviDrop 问题反馈 - v${installedVersionLabel}`);
    const body = encodeURIComponent(
      `问题描述：\n${feedbackText.trim()}\n\n联系方式：${
        feedbackContact.trim() || '未填写'
      }\n当前版本：v${installedVersionLabel}`,
    );

    void window.electronAPI?.files.openExternal(
      `mailto:${developerFeedbackEmail}?subject=${subject}&body=${body}`,
    );
    setFeedbackSent(true);
    setFeedbackText('');
    setFeedbackOpen(false);
    toast.success('已打开邮件反馈入口');
  };

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[1460px] px-8 py-6">
        <header className="mb-5 flex min-h-12 items-center justify-between gap-5 border-b border-white/60 pb-5">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold leading-tight text-[#17191c]">我的</h1>
          </div>
        </header>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,0.96fr)_minmax(0,1.04fr)]">
          <div className="space-y-5">
            <SettingsCard title="我的账户">
              <SettingsItem
                asButton
                icon={UserCircle}
                tone="rose"
                title="账户"
                caption={accountEmail}
                onClick={() => setAccountOpen((open) => !open)}
                action={
                  <ChevronRight
                    className={`h-4 w-4 text-[#9aa3af] transition ${
                      accountOpen ? 'rotate-90' : ''
                    }`}
                  />
                }
              />
              {accountOpen && (
                <div className="mx-4 mb-4 rounded-lg border border-white/70 bg-white/50 p-4">
                  <p className="text-xs font-semibold text-[#858b96]">账户绑定信息</p>
                  <ul className="mt-2 flex flex-col gap-2.5">
                    <AccountFact icon={Mail} label="账号" value={accountEmail} />
                    <AccountFact icon={Globe} label="登录方式" value="账号登录" />
                    <AccountFact icon={Smartphone} label="当前电脑" value={localIp} />
                  </ul>
                </div>
              )}
              <SettingsItem
                icon={Crown}
                tone="amber"
                title="会员状态"
                caption="免费版"
                action={
                  <span className="rounded-md bg-[#eaf6ff] px-2.5 py-1 text-xs font-semibold text-[#1677d2]">
                    Pro
                  </span>
                }
              />
            </SettingsCard>

            <SettingsCard title="本机">
              <SettingsItem icon={Wifi} tone="blue" title="本机 IP" caption={localIp} />
            </SettingsCard>

            <ShareAddressSection />

            <SystemGuideSection />
          </div>

          <div className="space-y-5">
            <SettingsCard title="通用">
              <SettingsItem
                asButton
                icon={Languages}
                tone="blue"
                title="界面语言"
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
                    placeholder="搜索语言"
                    aria-label="搜索语言"
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
                        没有匹配的语言
                      </p>
                    )}
                  </div>
                </div>
              )}
              <SettingsItem
                icon={Power}
                tone="green"
                title="防止待机"
                caption="传输任务运行时保持电脑唤醒"
                action={
                  <button
                    type="button"
                    onClick={togglePreventSleep}
                    aria-label="防止待机"
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
            </SettingsCard>

            <SettingsCard title="版本">
              <SettingsItem
                icon={BadgeCheck}
                tone="green"
                title="ViviDrop Desktop"
                caption={`v${installedVersionLabel} · 当前版本已安装`}
                action={
                  <button
                    type="button"
                    onClick={handleCheckUpdates}
                    disabled={checkingUpdates}
                    className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-md bg-white/60 px-3 text-xs font-semibold text-[#59616d] transition hover:bg-white/82 disabled:cursor-not-allowed disabled:text-[#aab2bd]"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${checkingUpdates ? 'animate-spin' : ''}`} />
                    检查更新
                  </button>
                }
              />
            </SettingsCard>

            <SettingsCard title="支持">
              <SettingsItem
                asButton
                icon={Mail}
                tone="rose"
                title="问题反馈"
                caption={feedbackSent ? '已打开邮件发送入口' : developerFeedbackEmail}
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
                    placeholder="请描述问题、发生步骤或希望改进的地方"
                    rows={4}
                    className="min-h-[112px] w-full resize-none rounded-lg border border-white/80 bg-white/70 px-3 py-2.5 text-sm leading-6 text-[#17191c] outline-none transition placeholder:text-[#a4acb7] focus:border-[#66c6ff] focus:ring-2 focus:ring-[#66c6ff]/18"
                  />
                  <div className="flex items-center gap-2 rounded-lg border border-white/80 bg-white/70 px-3 py-2.5">
                    <Mail className="h-4 w-4 shrink-0 text-[#7b8490]" />
                    <input
                      value={feedbackContact}
                      onChange={(event) => setFeedbackContact(event.currentTarget.value)}
                      placeholder="联系方式（选填）"
                      className="min-w-0 flex-1 bg-transparent text-sm text-[#17191c] outline-none placeholder:text-[#a4acb7]"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setFeedbackOpen(false)}
                      className="rounded-md border border-white/80 bg-white/58 px-3 py-2 text-sm font-semibold text-[#59616d] transition hover:bg-white/82"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      onClick={handleSendFeedback}
                      disabled={!feedbackReady}
                      className="inline-flex items-center justify-center gap-2 rounded-md bg-[#17191c] px-3 py-2 text-sm font-semibold text-white shadow-[0_12px_22px_rgba(23,25,28,0.16)] transition hover:bg-[#2b2f36] disabled:cursor-not-allowed disabled:bg-[#cfd6df] disabled:text-white/80"
                    >
                      <Send className="h-4 w-4" />
                      发送
                    </button>
                  </div>
                </div>
              )}
              <SettingsItem
                icon={FileUp}
                tone="sky"
                title="上传诊断包"
                caption={uploadingLogs ? '正在收集并上传日志' : '上传运行日志，帮助排查问题'}
                action={
                  <button
                    type="button"
                    onClick={() => setUploadDialogOpen(true)}
                    disabled={uploadingLogs}
                    className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-md bg-white/60 px-3 text-xs font-semibold text-[#59616d] transition hover:bg-white/82 disabled:cursor-not-allowed disabled:text-[#aab2bd]"
                  >
                    {uploadingLogs ? (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <FileUp className="h-3.5 w-3.5" />
                    )}
                    上传
                  </button>
                }
              />
              <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
                <DialogContent className="border border-white/80 bg-white/90 shadow-2xl backdrop-blur-xl">
                  <DialogHeader>
                    <DialogTitle className="text-lg font-semibold text-[#17191c]">
                      上传诊断包
                    </DialogTitle>
                    <DialogDescription className="text-xs text-[#7b8490]">
                      上传运行日志，包含配置与运行状态，帮助排查问题
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-2">
                    <Label
                      htmlFor="diagnostics-description"
                      className="text-xs font-semibold text-[#858b96]"
                    >
                      问题描述
                    </Label>
                    <textarea
                      id="diagnostics-description"
                      value={diagnosticsDescription}
                      onChange={(event) => setDiagnosticsDescription(event.target.value)}
                      placeholder="请描述出现问题的步骤、手机型号、网络环境或错误现象（选填）"
                      maxLength={500}
                      className="min-h-28 w-full resize-none rounded-lg border border-white/80 bg-white/70 px-3 py-2.5 text-sm leading-6 text-[#17191c] outline-none transition placeholder:text-[#a4acb7] focus:border-[#66c6ff] focus:ring-2 focus:ring-[#66c6ff]/18 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={uploadingLogs}
                    />
                    <div className="flex justify-end text-[11px] text-[#9aa3af]">
                      {diagnosticsDescription.length}/500
                    </div>
                  </div>
                  <DialogFooter className="flex justify-end gap-2">
                    <button
                      type="button"
                      data-testid="cancel-diagnostics-btn"
                      disabled={uploadingLogs}
                      onClick={() => {
                        setUploadDialogOpen(false);
                        setDiagnosticsDescription('');
                      }}
                      className="rounded-md border border-white/80 bg-white/58 px-3 py-2 text-sm font-semibold text-[#59616d] transition hover:bg-white/82 disabled:opacity-50"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      data-testid="submit-diagnostics-btn"
                      disabled={uploadingLogs}
                      onClick={() => void handleUploadLogs()}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#17191c] px-4 py-2 text-sm font-semibold text-white shadow-[0_12px_22px_rgba(23,25,28,0.16)] transition hover:bg-[#2b2f36] disabled:cursor-not-allowed disabled:bg-[#cfd6df]"
                    >
                      {uploadingLogs ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      ) : (
                        <FileUp className="h-4 w-4" />
                      )}
                      上传
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

function AccountFact({ icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  const Icon = icon;

  return (
    <li className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-[13px] text-[#17191c]">
        <Icon className="h-3.5 w-3.5 shrink-0 text-[#9aa2ad]" />
        {label}
      </span>
      <span className="truncate text-[13px] text-[#59616d]">{value}</span>
    </li>
  );
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
