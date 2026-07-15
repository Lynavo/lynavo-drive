import { AlertCircle, RefreshCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { GlassCard } from './GlassCard';

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-center py-16">
      <GlassCard variant="muted" className="flex flex-col items-center gap-4 px-8 py-8">
        <AlertCircle className="h-8 w-8 text-slate-400" />
        <p className="text-sm text-muted-foreground">{message ?? t('errors.common.loadFailed')}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition-[opacity,transform] duration-150 ease-out hover:bg-blue-600 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30"
          >
            <RefreshCcw className="h-3.5 w-3.5" />
            {t('common.actions.retry')}
          </button>
        )}
      </GlassCard>
    </div>
  );
}
