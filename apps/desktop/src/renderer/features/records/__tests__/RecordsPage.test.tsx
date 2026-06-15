import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { DesktopAccessRecordDTO, DesktopSyncRecordDTO } from '@syncflow/contracts';
import { RecordsPage } from '../RecordsPage';
import { useManagementStore } from '@renderer/stores/management-store';

const syncRecord: DesktopSyncRecordDTO = {
  recordId: 'sync-1',
  desktopDeviceId: 'desktop-1',
  clientId: 'client-1',
  displayName: 'iPhone 15 Pro',
  fileKey: '2026/06/15/IMG_0001.HEIC',
  filename: 'IMG_0001.HEIC',
  mediaType: 'image/heic',
  fileSize: 12345,
  status: 'completed',
  completedAt: '2026-06-15T10:00:00Z',
};

const accessRecord: DesktopAccessRecordDTO = {
  recordId: 'access-1',
  desktopDeviceId: 'desktop-1',
  clientId: 'client-1',
  displayName: 'Galaxy S24',
  resourceId: 'res-1',
  resourceKind: 'received_file',
  resourceName: 'clip.mp4',
  action: 'download',
  result: 'ok',
  accessedAt: '2026-06-15T10:10:00Z',
};

function resetStore() {
  useManagementStore.setState({
    devices: [],
    syncRecords: [],
    accessRecords: [],
    devicesLoading: false,
    syncRecordsLoading: false,
    accessRecordsLoading: false,
    devicesError: null,
    syncRecordsError: null,
    accessRecordsError: null,
  });
}

describe('RecordsPage', () => {
  beforeEach(() => {
    resetStore();
    vi.spyOn(useManagementStore.getState(), 'loadSyncRecords').mockResolvedValue();
    vi.spyOn(useManagementStore.getState(), 'loadAccessRecords').mockResolvedValue();
  });

  it('renders sync and access segmented controls', () => {
    render(<RecordsPage />);

    expect(screen.getByRole('button', { name: '同步紀錄 0' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '存取紀錄 0' })).toBeInTheDocument();
  });

  it('displays real sync DTO fields', () => {
    useManagementStore.setState({ syncRecords: [syncRecord] });

    render(<RecordsPage />);

    expect(screen.getByText('IMG_0001.HEIC')).toBeInTheDocument();
    expect(screen.getByText('iPhone 15 Pro')).toBeInTheDocument();
    expect(screen.getByText('image/heic')).toBeInTheDocument();
    expect(screen.getByText('完成')).toBeInTheDocument();
  });

  it('displays real access DTO fields', () => {
    useManagementStore.setState({ accessRecords: [accessRecord] });

    render(<RecordsPage />);
    fireEvent.click(screen.getByRole('button', { name: '存取紀錄 1' }));

    expect(screen.getByText('clip.mp4')).toBeInTheDocument();
    expect(screen.getByText('Galaxy S24')).toBeInTheDocument();
    expect(screen.getByText('download')).toBeInTheDocument();
    expect(screen.getByText('ok')).toBeInTheDocument();
  });

  it('renders empty and error states', () => {
    const { rerender } = render(<RecordsPage />);

    expect(screen.getByText('尚無同步紀錄')).toBeInTheDocument();

    useManagementStore.setState({ syncRecordsError: 'records unavailable' });
    rerender(<RecordsPage />);

    expect(screen.getByText('records unavailable')).toBeInTheDocument();
  });

  it('does not render delete or ledger mutation buttons', () => {
    useManagementStore.setState({ syncRecords: [syncRecord], accessRecords: [accessRecord] });

    render(<RecordsPage />);

    expect(
      screen.queryByRole('button', { name: /刪除|删除|移除|跳過|跳过|重排/ }),
    ).not.toBeInTheDocument();
  });
});
