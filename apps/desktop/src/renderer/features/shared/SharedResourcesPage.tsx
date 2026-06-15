import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FilePlus2, FolderPlus, Loader2 } from 'lucide-react';
import { useResourcesStore } from '@renderer/stores/resources-store';
import { GlassCard } from '@renderer/components/shared/GlassCard';
import { Button } from '@renderer/components/ui/button';
import { Skeleton } from '@renderer/components/ui/skeleton';
import { ErrorState } from '@renderer/components/shared/ErrorState';
import { SharedResourceTable } from './SharedResourceTable';

export function SharedResourcesPage() {
  const { t } = useTranslation();
  const {
    sharedResources,
    sharedLoading,
    sharedError,
    loadSharedResources,
    removeSharedResource,
    shareFile,
    shareFolder,
  } = useResourcesStore();

  useEffect(() => {
    void loadSharedResources();
  }, [loadSharedResources]);

  return (
    <div className="flex-1 overflow-auto px-6 py-8">
      <div className="mx-auto max-w-6xl">
        {/* Header section */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900">{t('layout.placeholders.shared.title')}</h1>
            <p className="mt-1 text-sm text-slate-500">{t('layout.placeholders.shared.description')}</p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={shareFile}
              className="bg-white/60 backdrop-blur-sm border-white/20 hover:bg-white/80 flex items-center gap-2"
            >
              <FilePlus2 className="h-4 w-4 text-blue-600" />
              {t('common.shared.addFile')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={shareFolder}
              className="bg-white/60 backdrop-blur-sm border-white/20 hover:bg-white/80 flex items-center gap-2"
            >
              <FolderPlus className="h-4 w-4 text-blue-600" />
              {t('common.shared.addFolder')}
            </Button>
          </div>
        </div>

        {/* Error State */}
        {sharedError && (
          <GlassCard className="p-6 mb-6">
            <ErrorState message={sharedError} onRetry={loadSharedResources} />
          </GlassCard>
        )}

        {/* Content area */}
        {sharedLoading && sharedResources.length === 0 ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-full rounded-xl" />
            <Skeleton className="h-32 w-full rounded-xl" />
          </div>
        ) : (
          <GlassCard className="p-6 border-white/20">
            {sharedLoading && (
              <div className="mb-4 flex items-center gap-2 text-xs text-blue-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>{t('common.fallback.loading')}</span>
              </div>
            )}
            <SharedResourceTable
              resources={sharedResources}
              onRemove={removeSharedResource}
            />
          </GlassCard>
        )}
      </div>
    </div>
  );
}
