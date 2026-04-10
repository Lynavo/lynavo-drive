import { useEffect } from 'react';
import { FolderInput, Globe } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { GlassCard } from '@renderer/components/shared/GlassCard';
import { ErrorState } from '@renderer/components/shared/ErrorState';
import { useDirectoryStore, type DirectoryTab } from '@renderer/stores/directory-store';
import { useSettingsStore } from '@renderer/stores/settings-store';
import { DirectoryPathCard } from './DirectoryPathCard';
import { PreviewModal } from './PreviewModal';
import { ReceivedFileList } from './ReceivedFileList';
import { SharedFileList } from './SharedFileList';

const colors = {
  title: '#1a2a3a',
  subtitle: '#6b7a8d',
} as const;

const tabDescriptions: Record<DirectoryTab, string> = {
  received: '接收移动端上传的素材文件，仅供 PC 本地保管使用',
  shared: '共享目录中的文件，可供局域网内其他设备访问',
};

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
  const activeTab = useDirectoryStore((s) => s.activeTab);
  const setTab = useDirectoryStore((s) => s.setTab);
  const receivedFiles = useDirectoryStore((s) => s.receivedFiles);
  const sharedFiles = useDirectoryStore((s) => s.sharedFiles);
  const fetchAll = useDirectoryStore((s) => s.fetchAll);
  const error = useDirectoryStore((s) => s.error);
  const loading = useDirectoryStore((s) => s.loading);
  const fetchSettings = useSettingsStore((s) => s.fetchSettings);

  useEffect(() => {
    void fetchSettings();
    void fetchAll();
  }, [fetchSettings, fetchAll]);

  const handleTabChange = (tab: DirectoryTab) => {
    setTab(tab);
    if (tab === 'received') {
      void useDirectoryStore.getState().fetchReceivedFiles();
    } else {
      void useDirectoryStore.getState().fetchSharedFiles();
    }
  };

  const previewFile = useDirectoryStore((s) => s.previewFile);

  return (
    <div className="flex flex-1 flex-col overflow-auto">
      <div className="mx-auto w-full max-w-5xl px-6 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-bold" style={{ color: colors.title }}>
            目录管理
          </h1>
          <p className="mt-1 text-sm" style={{ color: colors.subtitle }}>
            配置根目录路径并管理接收与共享目录的内容
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
              label="接收目录"
              count={receivedFiles.length}
              icon={FolderInput}
              onClick={() => handleTabChange('received')}
            />
            <TabButton
              active={activeTab === 'shared'}
              label="共享目录"
              count={sharedFiles.length}
              icon={Globe}
              onClick={() => handleTabChange('shared')}
            />
          </div>

          {/* Tab description with background */}
          <div className="mb-4 rounded-xl bg-blue-50/60 px-4 py-2.5">
            <p className="text-xs text-muted-foreground">{tabDescriptions[activeTab]}</p>
          </div>

          {/* Tab content */}
          {error && !loading ? (
            <ErrorState
              message={error}
              onRetry={() => {
                if (activeTab === 'received') {
                  void useDirectoryStore.getState().fetchReceivedFiles();
                } else {
                  void useDirectoryStore.getState().fetchSharedFiles();
                }
              }}
            />
          ) : (
            <>
              {activeTab === 'received' && <ReceivedFileList />}
              {activeTab === 'shared' && <SharedFileList />}
            </>
          )}
        </GlassCard>
      </div>

      {previewFile && <PreviewModal />}
    </div>
  );
}
