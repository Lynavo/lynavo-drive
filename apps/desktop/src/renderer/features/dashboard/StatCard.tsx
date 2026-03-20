import type { LucideIcon } from 'lucide-react';
import { GlassCard } from '@renderer/components/shared/GlassCard';

interface StatCardProps {
  icon: LucideIcon;
  iconGradient: string;
  label: string;
  value: string | number;
  unit?: string;
}

export function StatCard({
  icon: Icon,
  iconGradient,
  label,
  value,
  unit,
}: StatCardProps) {
  return (
    <GlassCard className="flex min-w-[200px] items-center gap-4 px-5 py-4">
      <div
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
        style={{
          background: iconGradient,
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        }}
      >
        <Icon className="h-6 w-6 text-white" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-2xl font-bold tracking-tight">
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
