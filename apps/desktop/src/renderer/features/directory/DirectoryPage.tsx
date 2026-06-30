import { useEffect } from 'react';
import { FolderInput, Globe } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { GlassCard } from '@renderer/components/shared/GlassCard';
import { ErrorState } from '@renderer/components/shared/ErrorState';
import { useDirectoryStore, type DirectoryTab } from '@renderer/stores/directory-store';
import { useSettingsStore } from '@renderer/stores/settings-store';
import { DirectoryPathCard } from './DirectoryPathCard';
import { ReceivedFileList } from './ReceivedFileList';
import { SharedFileList } from './SharedFileList';

const colors = {
  title: '#1a2a3a',
  subtitle: '#6b7a8d',
} as const;

const DIRECTORY_AUTO_REFRESH_MS = 3000;

function TabButton({
  active,
  label,
  count,
  icon: Icon,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  icon: LucideIcon;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-[color,background-color,box-shadow] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 ${
        active
          ? 'bg-blue-500 text-white shadow-sm'
          : 'text-[#6b7a8d] hover:bg-blue-50 hover:text-blue-500'
      }`}
    >
      <Icon className="h-4 w-4" />
      {label} {count > 0 ? count : ''}
    </button>
  );
}

export function DirectoryPage() {
  const { t } = useTranslation();
  const activeTab = useDirectoryStore((s) => s.activeTab);
  const setTab = useDirectoryStore((s) => s.setTab);
  const receivedFiles = useDirectoryStore((s) => s.receivedFiles);
  const sharedFiles = useDirectoryStore((s) => s.sharedFiles);
  const fetchAll = useDirectoryStore((s) => s.fetchAll);
  const receivedError = useDirectoryStore((s) => s.receivedError);
  const sharedError = useDirectoryStore((s) => s.sharedError);
  const loading = useDirectoryStore((s) => s.loading);
  const fetchSettings = useSettingsStore((s) => s.fetchSettings);

  useEffect(() => {
    void fetchSettings();
    void fetchAll();
  }, [fetchSettings, fetchAll]);

  useEffect(() => {
    const refreshDirectory = () => {
      const { fetchAll } = useDirectoryStore.getState();
      void fetchAll();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshDirectory();
      }
    };

    window.addEventListener('focus', refreshDirectory);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('focus', refreshDirectory);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (document.visibilityState !== 'visible') {
      return;
    }

    const refreshActiveTab = () => {
      const {
        activeTab: currentTab,
        fetchReceivedFiles,
        fetchSharedFiles,
      } = useDirectoryStore.getState();
      if (currentTab === 'received') {
        void fetchReceivedFiles();
      } else {
        void fetchSharedFiles();
      }
    };

    const intervalId = window.setInterval(refreshActiveTab, DIRECTORY_AUTO_REFRESH_MS);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeTab]);

  const handleTabChange = (tab: DirectoryTab) => {
    setTab(tab);
    if (tab === 'received') {
      void useDirectoryStore.getState().fetchReceivedFiles();
    } else {
      void useDirectoryStore.getState().fetchSharedFiles();
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-auto">
      <div className="mx-auto w-full max-w-5xl px-6 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-bold" style={{ color: colors.title }}>
            {t('directory.title')}
          </h1>
          <p className="mt-1 text-sm" style={{ color: colors.subtitle }}>
            {t('directory.subtitle')}
          </p>
        </div>

        {/* Path cards */}
        <div className="mb-6">
          <DirectoryPathCard />
        </div>

        {/* File list with tabs */}
        <GlassCard className="p-5">
          {/* Tab bar */}
          <div className="mb-4 flex gap-1">
            <TabButton
              active={activeTab === 'received'}
              label={t('directory.tabs.received')}
              count={receivedFiles.length}
              icon={FolderInput}
              onClick={() => handleTabChange('received')}
            />
            <TabButton
              active={activeTab === 'shared'}
              label={t('directory.tabs.shared')}
              count={sharedFiles.length}
              icon={Globe}
              onClick={() => handleTabChange('shared')}
            />
          </div>

          {/* Tab description with background */}
          <div className="mb-4 rounded-xl bg-blue-50/60 px-4 py-2.5">
            <p className="text-xs text-muted-foreground">
              {activeTab === 'received'
                ? t('directory.tabs.receivedDescription')
                : t('directory.tabs.sharedDescription')}
            </p>
          </div>

          {/* Tab content */}
          {(() => {
            const tabError = activeTab === 'received' ? receivedError : sharedError;
            if (tabError && !loading) {
              return (
                <ErrorState
                  message={tabError}
                  onRetry={() => {
                    if (activeTab === 'received') {
                      void useDirectoryStore.getState().fetchReceivedFiles();
                    } else {
                      void useDirectoryStore.getState().fetchSharedFiles();
                    }
                  }}
                />
              );
            }
            return (
              <>
                {activeTab === 'received' && <ReceivedFileList />}
                {activeTab === 'shared' && <SharedFileList />}
              </>
            );
          })()}
        </GlassCard>
      </div>
    </div>
  );
}
