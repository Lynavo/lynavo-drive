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
  background: 'rgba(255,255,255,0.85)',
  boxShadow: '0 2px 12px rgba(59,130,246,0.10)',
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
        className="z-10 flex w-56 flex-col pt-8"
        style={{
          background: glass.sidebar.background,
          backdropFilter: `blur(${glass.sidebar.blur})`,
          borderRight: '1px solid rgba(255,255,255,0.7)',
          boxShadow: elevation.sidebar,
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5" style={dragRegionStyle}>
          <img
            src={syncflowLogo}
            alt={getProductName()}
            draggable={false}
            className="h-9 w-9 object-contain"
          />
          <span className="text-base font-bold" style={{ color: '#1a2a3a' }}>
            {getProductName()}
          </span>
        </div>

        {authInitialized ? (
          <div className="px-3 pb-2" style={noDragRegionStyle}>
            {session ? (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-500/15 bg-emerald-500/10 px-3 py-2">
                <UserRound className="h-4 w-4 shrink-0 text-emerald-700" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-emerald-800">
                    {t('layout.account.signedIn')}
                  </p>
                  <p className="truncate text-[11px] text-emerald-700/80" title={accountLabel}>
                    {accountLabel}
                  </p>
                </div>
                <button
                  type="button"
                  className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-emerald-700/80 transition-[background-color,color,transform] duration-150 ease-out hover:bg-white/70 hover:text-emerald-800 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/25 focus-visible:ring-offset-2"
                  aria-label={t('layout.account.logout')}
                  title={t('layout.account.logout')}
                  onClick={handleLogout}
                >
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div className="rounded-lg border border-blue-500/15 bg-white/65 px-3 py-3 shadow-sm">
                <div className="mb-2 flex items-start gap-2">
                  <LogIn className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[#1a2a3a]">
                      {t('layout.account.promptTitle')}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-4 text-[#6b7a8d]">
                      {t('layout.account.dialogDescription')}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className="flex h-8 w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-blue-600 px-3 text-xs font-semibold text-white transition-[background-color,transform] duration-150 ease-out hover:bg-blue-700 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 focus-visible:ring-offset-2"
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
        <nav className="flex flex-1 flex-col gap-1 px-3 py-2">
          {navItems.map(({ key, labelKey, icon: Icon }) => {
            const active =
              currentView === key || (key === 'dashboard' && currentView === 'device-detail');
            return (
              <button
                key={key}
                onClick={() => setView(key)}
                className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-[color,background-color,box-shadow,transform] duration-150 ease-out active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 focus-visible:ring-offset-2 ${
                  active ? 'text-primary' : 'text-[#6b7a8d] hover:bg-white/70 hover:text-[#1a2a3a]'
                }`}
                style={active ? activeNavStyle : noDragRegionStyle}
              >
                <Icon className="h-4 w-4" />
                {t(labelKey)}
              </button>
            );
          })}
        </nav>

        {/* Help at bottom */}
        <div className="px-3 pb-4">
          <button
            onClick={() => setView('help')}
            className={`flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-[color,background-color,box-shadow,transform] duration-150 ease-out active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 focus-visible:ring-offset-2 ${
              currentView === 'help'
                ? 'text-primary'
                : 'text-[#6b7a8d] hover:bg-white/70 hover:text-[#1a2a3a]'
            }`}
            style={currentView === 'help' ? activeNavStyle : noDragRegionStyle}
          >
            <HelpCircle className="h-4 w-4" />
            {t('layout.nav.help')}
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
