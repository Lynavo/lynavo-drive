import { describe, it, expect, beforeEach } from 'vitest';
import { useDeviceDetailStore } from '../device-detail-store';
import { mockFiles, mockAvailableDates } from '../../mocks/files';
import type { DeviceFileLedgerDTO } from '@lynavo-drive/contracts';

describe('device-detail-store', () => {
  beforeEach(() => {
    useDeviceDetailStore.setState({
      files: mockFiles,
      selectedDate: mockAvailableDates[0],
      availableDates: mockAvailableDates,
      page: 1,
      pageSize: 200,
      totalItems: mockFiles.length,
      totalBytes: mockFiles.reduce((sum, file) => sum + file.fileSize, 0),
      totalTransmissionMs: mockFiles.reduce(
        (sum, file) => sum + file.activeTransmissionMs,
        0,
      ),
      sortField: 'completedAt',
      sortDirection: 'desc',
      loading: false,
    });
  });

  it('initializes with mock files and first available date', () => {
    const state = useDeviceDetailStore.getState();
    expect(state.files.length).toBe(mockFiles.length);
    expect(state.selectedDate).toBe('2026-03-19');
    expect(state.availableDates).toEqual(mockAvailableDates);
    expect(state.page).toBe(1);
    expect(state.totalItems).toBe(mockFiles.length);
  });

  it('setDate updates selectedDate', () => {
    useDeviceDetailStore.getState().setDate('2026-03-18');
    expect(useDeviceDetailStore.getState().selectedDate).toBe('2026-03-18');
  });

  it('setAvailableDates updates dates list', () => {
    const newDates = ['2026-03-20', '2026-03-19'];
    useDeviceDetailStore.getState().setAvailableDates(newDates);
    expect(useDeviceDetailStore.getState().availableDates).toEqual(newDates);
  });

  it('toggleSort sets new field to asc', () => {
    useDeviceDetailStore.setState({
      fetchDeviceFiles: async (
        _deviceId: string,
        _options?: { date?: string; page?: number },
      ) => {},
    });
    void useDeviceDetailStore.getState().toggleSort('device-1', 'name');
    const state = useDeviceDetailStore.getState();
    expect(state.sortField).toBe('name');
    expect(state.sortDirection).toBe('asc');
  });

  it('toggleSort flips direction on same field', () => {
    useDeviceDetailStore.setState({
      fetchDeviceFiles: async (
        _deviceId: string,
        _options?: { date?: string; page?: number },
      ) => {},
    });
    void useDeviceDetailStore.getState().toggleSort('device-1', 'name');
    expect(useDeviceDetailStore.getState().sortDirection).toBe('asc');

    void useDeviceDetailStore.getState().toggleSort('device-1', 'name');
    expect(useDeviceDetailStore.getState().sortDirection).toBe('desc');
  });

  it('toggleSort resets to asc when switching to a different field', () => {
    useDeviceDetailStore.setState({
      fetchDeviceFiles: async (
        _deviceId: string,
        _options?: { date?: string; page?: number },
      ) => {},
    });
    void useDeviceDetailStore.getState().toggleSort('device-1', 'name');
    void useDeviceDetailStore.getState().toggleSort('device-1', 'name'); // desc
    void useDeviceDetailStore.getState().toggleSort('device-1', 'size');
    const state = useDeviceDetailStore.getState();
    expect(state.sortField).toBe('size');
    expect(state.sortDirection).toBe('asc');
  });

  it('setFiles replaces the files list', () => {
    const newFiles: DeviceFileLedgerDTO[] = [
      {
        fileKey: 'new1',
        originalFilename: 'NewFile.mp4',
        mediaType: 'video/mp4',
        fileSize: 100_000,
        activeTransmissionMs: 5_000,
      },
    ];
    useDeviceDetailStore.getState().setFiles(newFiles);
    const state = useDeviceDetailStore.getState();
    expect(state.files).toEqual(newFiles);
    expect(state.files.length).toBe(1);
  });

  it('reset clears pagination state', () => {
    useDeviceDetailStore.getState().reset();
    const state = useDeviceDetailStore.getState();
    expect(state.files).toEqual([]);
    expect(state.selectedDate).toBe('');
    expect(state.page).toBe(1);
    expect(state.totalItems).toBe(0);
  });
});
