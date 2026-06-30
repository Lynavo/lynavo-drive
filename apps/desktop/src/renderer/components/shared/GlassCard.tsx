import { cn } from '@renderer/lib/utils';
import { glass, elevation } from '@lynavo-drive/design-tokens';
import type { ReactNode } from 'react';

interface GlassCardProps {
  variant?: 'default' | 'muted' | 'modal';
  shadow?: keyof typeof elevation;
  className?: string;
  children: ReactNode;
}

export function GlassCard({
  variant = 'default',
  shadow = 'card',
  className,
  children,
}: GlassCardProps) {
  const preset =
    glass[variant === 'muted' ? 'cardMuted' : variant === 'modal' ? 'modal' : 'card'];

  return (
    <div
      className={cn('rounded-2xl', className)}
      style={{
        background: preset.background,
        backdropFilter: `blur(${preset.blur})`,
        boxShadow: elevation[shadow],
        border: '1px solid rgba(255,255,255,0.85)',
      }}
    >
      {children}
    </div>
  );
}
