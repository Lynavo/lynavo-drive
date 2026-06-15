import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import {
  LayoutDashboard,
  Library,
  ListChecks,
  MonitorSmartphone,
  Share2,
  Settings,
  HelpCircle,
  LogIn,
  LogOut,
  UserRound,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { glass, elevation } from '@syncflow/design-tokens';
import syncflowLogo from '@renderer/assets/syncflow-mark-transparent.png';
import { LoginDialog } from '@renderer/components/shared/LoginDialog';
import { useAppStore, type AppView } from '@renderer/stores/app-store';
import { useAuthStore } from '@renderer/stores/auth-store';
import { getProductName } from '../../../shared/market';

const navItems: { key: AppView; labelKey: string; icon: typeof LayoutDashboard }[] = [
  { key: 'dashboard', labelKey: 'layout.nav.dashboard', icon: LayoutDashboard },
  { key: 'devices', labelKey: 'layout.nav.devices', icon: MonitorSmartphone },
  { key: 'shared', labelKey: 'layout.nav.shared', icon: Share2 },
  { key: 'library', labelKey: 'layout.nav.library', icon: Library },
  { key: 'records', labelKey: 'layout.nav.records', icon: ListChecks },
  { key: 'settings', labelKey: 'layout.nav.settings', icon: Settings },
];

const dragRegionStyle = { WebkitAppRegion: 'drag' } as CSSProperties;
const noDragRegionStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties;
const activeNavStyle = {
  background: 'rgba(238,234,255,0.7)',
  boxShadow: '0 12px 28px rgba(126,116,190,0.12)',
  border: '1px solid rgba(216,210,255,0.6)',
  WebkitAppRegion: 'no-drag',
} as CSSProperties;

export function Sidebar() {
  const { t } = useTranslation();
  const currentView = useAppStore((s) => s.currentView);
  const setView = useAppStore((s) => s.setView);
  const session = useAuthStore((s) => s.session);
  const refreshSession = useAuthStore((s) => s.refreshSession);
  const logout = useAuthStore((s) => s.logout);
  const [authInitialized, setAuthInitialized] = useState(false);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);

  useEffect(() => {
    let active = true;
    void refreshSession().finally(() => {
      if (active) {
        setAuthInitialized(true);
      }
    });
    return () => {
      active = false;
    };
  }, [refreshSession]);

  const handleLoginSuccess = useCallback(() => {
    void refreshSession();
  }, [refreshSession]);

  const handleLogout = useCallback(() => {
    void logout();
  }, [logout]);

  const accountIdentifier =
    session?.phone?.trim() || session?.email?.trim() || session?.accountLabel?.trim();
  const accountLabel = accountIdentifier || t('layout.account.connected');

  return (
    <>
      <aside
        className="z-10 flex w-[238px] shrink-0 flex-col pt-6 m-3 mr-0 rounded-2xl border border-white/70 shadow-[0_24px_70px_rgba(70,96,138,0.14)]"
        style={{
          background: 'rgba(255,255,255,0.52)',
          backdropFilter: 'blur(20px)',
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5" style={dragRegionStyle}>
          <img
            src={syncflowLogo}
            alt={getProductName()}
            draggable={false}
            className="h-7 w-auto object-contain"
          />
          <span className="text-[15px] font-semibold leading-none" style={{ color: '#17191c' }}>
            {getProductName().replace(' ', '')}
          </span>
        </div>

        {authInitialized ? (
          <div className="px-3 pb-2" style={noDragRegionStyle}>
            {session ? (
              <button
                type="button"
                onClick={handleLogout}
                className="group flex w-full items-center gap-3 rounded-lg border border-white/60 bg-white/45 p-2.5 text-left transition hover:bg-white/65 hover:shadow-sm"
                title={t('layout.account.logout')}
                aria-label={t('layout.account.logout')}
              >
                <div className="relative h-8 w-8 shrink-0 rounded-full bg-gradient-to-tr from-[#c8dffa] to-[#d6c7ff] flex items-center justify-center font-bold text-xs text-[#527094] border border-white/80 shadow-[0_4px_10px_rgba(126,116,190,0.1)]">
                  {accountLabel.substring(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1 text-[11px] font-bold leading-none text-[#17191c]">
                    {t('layout.account.signedIn')}
                    <span className="flex h-3 w-3 items-center justify-center rounded-full bg-[#fde047] text-[#854d0e] scale-90">
                      <UserRound className="h-2 w-2" />
                    </span>
                  </p>
                  <p className="mt-0.5 truncate text-[12px] leading-tight text-[#327db3]" title={accountLabel}>
                    {accountLabel}
                  </p>
                </div>
                <LogOut className="h-4 w-4 shrink-0 text-[#327db3] transition group-hover:text-[#185f9a]" />
              </button>
            ) : (
              <div className="rounded-lg border border-white/70 bg-white/45 p-3 shadow-sm">
                <div className="mb-2 flex items-start gap-2">
                  <LogIn className="mt-0.5 h-4 w-4 shrink-0 text-[#746aa8]" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[#1a2a3a]">
                      {t('layout.account.promptTitle')}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-4 text-[#5f6671]">
                      {t('layout.account.dialogDescription')}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className="flex h-8 w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-[#746aa8] px-3 text-xs font-semibold text-white transition-[background-color,transform] duration-150 ease-out hover:bg-[#5f5592] active:scale-[0.985] focus-visible:outline-none"
                  onClick={() => setLoginDialogOpen(true)}
                >
                  <LogIn className="h-3.5 w-3.5" />
                  {t('layout.account.login')}
                </button>
              </div>
            )}
          </div>
        ) : null}

        {/* Navigation */}
        <nav className="flex flex-1 flex-col gap-1 px-3 py-5">
          {navItems.map(({ key, labelKey, icon: Icon }) => {
            const active =
              currentView === key || (key === 'dashboard' && currentView === 'device-detail');
            return (
              <button
                key={key}
                onClick={() => setView(key)}
                className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-3 text-sm font-semibold transition-[color,background-color,box-shadow,transform] duration-150 ease-out active:scale-[0.985] focus-visible:outline-none ${
                  active ? 'text-[#4d4961]' : 'text-[#5f6671] hover:bg-white/55 hover:text-[#17191c]'
                }`}
                style={active ? activeNavStyle : noDragRegionStyle}
              >
                <Icon className={`h-4 w-4 shrink-0 transition-colors ${active ? 'text-[#746aa8]' : 'text-[#858b96]'}`} />
                <span>{t(labelKey)}</span>
              </button>
            );
          })}
        </nav>

        {/* Help at bottom */}
        <div className="px-3 pb-4">
          <button
            onClick={() => setView('help')}
            className={`flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-3 text-sm font-semibold transition-[color,background-color,box-shadow,transform] duration-150 ease-out active:scale-[0.985] focus-visible:outline-none ${
              currentView === 'help'
                ? 'text-[#4d4961]'
                : 'text-[#5f6671] hover:bg-white/55 hover:text-[#17191c]'
            }`}
            style={currentView === 'help' ? activeNavStyle : noDragRegionStyle}
          >
            <HelpCircle className={`h-4 w-4 shrink-0 transition-colors ${currentView === 'help' ? 'text-[#746aa8]' : 'text-[#858b96]'}`} />
            <span>{t('layout.nav.help')}</span>
          </button>
        </div>
      </aside>

      <LoginDialog
        open={loginDialogOpen}
        onOpenChange={setLoginDialogOpen}
        onLoginSuccess={handleLoginSuccess}
        title={t('layout.account.dialogTitle')}
        description={t('layout.account.dialogDescription')}
      />
    </>
  );
}
