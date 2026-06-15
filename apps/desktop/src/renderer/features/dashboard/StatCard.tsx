import type { LucideIcon } from 'lucide-react';
import { GlassCard } from '@renderer/components/shared/GlassCard';

interface StatCardProps {
  icon: LucideIcon;
  iconGradient?: string;
  label: string;
  value: string | number;
  unit?: string;
  alert?: boolean;
  tone?: 'blue' | 'green' | 'cyan';
}

export function StatCard({
  icon: Icon,
  iconGradient,
  label,
  value,
  unit,
  alert,
  tone,
}: StatCardProps) {
  const toneClasses = tone
    ? {
        blue: 'bg-[#f0f8ff]/72 text-[#2788dc] shadow-[0_14px_36px_rgba(75,158,226,0.11)] border-blue-100/30',
        green: 'bg-[#f1fbf3]/76 text-[#2c9c5a] shadow-[0_14px_36px_rgba(64,176,101,0.11)] border-emerald-100/30',
        cyan: 'bg-[#eefbff]/74 text-[#14a4d8] shadow-[0_14px_36px_rgba(49,176,215,0.11)] border-cyan-100/30',
      }[tone]
    : '';

  const iconClasses = tone
    ? {
        blue: 'bg-[#48a7f4] text-white shadow-[0_12px_26px_rgba(72,167,244,0.28)]',
        green: 'bg-[#46c878] text-white shadow-[0_12px_26px_rgba(70,200,120,0.25)]',
        cyan: 'bg-[#22b5e4] text-white shadow-[0_12px_26px_rgba(34,181,228,0.24)]',
      }[tone]
    : '';

  return (
    <GlassCard className={`flex min-w-[200px] flex-1 items-center gap-4 px-5 py-4 ${toneClasses}`}>
      <div
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg ${
          tone ? iconClasses : 'rounded-2xl'
        }`}
        style={
          tone
            ? undefined
            : {
                background: iconGradient,
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              }
        }
      >
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-xs text-[#697786]">{label}</p>
        <p
          className={`mt-1 text-2xl font-bold tracking-tight ${
            alert ? 'text-red-600' : 'text-[#17191c]'
          }`}
        >
          {value}
          {unit && (
            <span className="ml-1 text-base font-normal text-muted-foreground">
              {unit}
            </span>
          )}
        </p>
      </div>
    </GlassCard>
  );
}
