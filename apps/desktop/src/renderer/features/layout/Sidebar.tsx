import type { CSSProperties } from 'react';
import { LayoutDashboard, Settings } from 'lucide-react';
import { glass, elevation } from '@syncflow/design-tokens';
import syncflowLogo from '@renderer/assets/syncflow-mark-transparent.png';
import { useAppStore, type AppState } from '@renderer/stores/app-store';

const navItems: { key: AppState['currentView']; label: string; icon: typeof LayoutDashboard }[] = [
  { key: 'dashboard', label: '首页看板', icon: LayoutDashboard },
  { key: 'settings', label: '全局设置', icon: Settings },
];

const dragRegionStyle = { WebkitAppRegion: 'drag' } as CSSProperties;
const noDragRegionStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties;
const activeNavStyle = {
  background: 'rgba(255,255,255,0.85)',
  boxShadow: '0 2px 12px rgba(59,130,246,0.10)',
  WebkitAppRegion: 'no-drag',
} as CSSProperties;

export function Sidebar() {
  const currentView = useAppStore((s) => s.currentView);
  const setView = useAppStore((s) => s.setView);

  return (
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
          alt="Vivi Drop"
          draggable={false}
          className="h-9 w-9 object-contain"
        />
        <span className="text-base font-bold" style={{ color: '#1a2a3a' }}>
          Vivi Drop
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex flex-col gap-1 px-3 py-2">
        {navItems.map(({ key, label, icon: Icon }) => {
          const active = currentView === key;
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
              {label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
