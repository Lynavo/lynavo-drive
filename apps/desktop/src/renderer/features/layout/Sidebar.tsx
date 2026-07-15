import {
  HardDrive,
  Smartphone,
  FolderOpen,
  History,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import lynavoLogo from '@renderer/assets/lynavo-logo-cutout.png';
import { useAppStore, type AppView } from '@renderer/stores/app-store';
import { getProductName } from '../../../shared/product';

const navItems: { key: AppView; labelKey: string; icon: LucideIcon }[] = [
  { key: 'dashboard', labelKey: 'layout.nav.dashboard', icon: HardDrive },
  { key: 'devices', labelKey: 'layout.nav.devices', icon: Smartphone },
  { key: 'library', labelKey: 'layout.nav.library', icon: FolderOpen },
  { key: 'records', labelKey: 'layout.nav.records', icon: History },
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

  return (
    <aside
      className="z-10 m-3 mr-0 flex w-[238px] shrink-0 flex-col rounded-lg border border-white/70 shadow-[0_24px_70px_rgba(70,96,138,0.14)]"
      style={{
        background: 'rgba(255,255,255,0.52)',
        backdropFilter: 'blur(20px)',
      }}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5" style={dragRegionStyle}>
        <img
          src={lynavoLogo}
          alt={getProductName()}
          draggable={false}
          className="h-7 w-auto object-contain"
        />
        <span className="text-[15px] font-semibold leading-none" style={{ color: '#17191c' }}>
          {getProductName().replace(' ', '')}
        </span>
      </div>

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
                active ? 'text-[#534b71]' : 'text-[#626d7c] hover:bg-white/60 hover:text-[#17191c]'
              }`}
              style={active ? activeNavStyle : noDragRegionStyle}
            >
              <Icon
                className={`h-4 w-4 shrink-0 transition-colors ${active ? 'text-[#746aa8]' : 'text-[#858b96]'}`}
              />
              <span>{t(labelKey)}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
