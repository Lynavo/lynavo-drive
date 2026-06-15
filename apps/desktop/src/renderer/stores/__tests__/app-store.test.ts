import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../app-store';
import type { DashboardDeviceDTO } from '@syncflow/contracts';

const mockDevice: DashboardDeviceDTO = {
  deviceId: 'd1',
  displayName: 'iPhone 15 Pro',
  clientName: 'iPhone 15 Pro',
  platform: 'ios',
  ip: '192.168.1.201',
  status: 'transferring',
  todayFileCount: 12,
  todayBytes: 24.5 * 1024 ** 3,
  storageLeft: '1.2 TB',
  storagePath: '/Users/alice/SyncFlow',
  devicePath: '/Users/alice/SyncFlow/iPhone_15_Pro',
  currentFile: {
    filename: 'DJI_0421_4K_RAW.mp4',
    progress: 67,
    fileSize: 3_435_973_837,
  },
};

describe('app-store', () => {
  beforeEach(() => {
    useAppStore.setState({
      currentView: 'dashboard',
      selectedDevice: null,
      isModalOpen: false,
    });
  });

  it('starts with dashboard view', () => {
    const state = useAppStore.getState();
    expect(state.currentView).toBe('dashboard');
    expect(state.isModalOpen).toBe(false);
    expect(state.selectedDevice).toBeNull();
  });

  it('switches view to settings', () => {
    useAppStore.getState().setView('settings');
    expect(useAppStore.getState().currentView).toBe('settings');
  });

  it('switches view back to dashboard', () => {
    useAppStore.getState().setView('settings');
    useAppStore.getState().setView('dashboard');
    expect(useAppStore.getState().currentView).toBe('dashboard');
  });

  it('supports desktop-local management views', () => {
    const desktopLocalViews = ['devices', 'shared', 'library', 'records'] as const;

    for (const view of desktopLocalViews) {
      useAppStore.getState().setView(view);
      expect(useAppStore.getState().currentView).toBe(view);
    }
  });

  it('opens device detail modal', () => {
    useAppStore.getState().openDeviceDetail(mockDevice);
    const state = useAppStore.getState();
    expect(state.isModalOpen).toBe(true);
    expect(state.selectedDevice).toEqual(mockDevice);
  });

  it('closes device detail modal', () => {
    useAppStore.getState().openDeviceDetail(mockDevice);
    useAppStore.getState().closeDeviceDetail();
    const state = useAppStore.getState();
    expect(state.isModalOpen).toBe(false);
    expect(state.selectedDevice).toBeNull();
  });

  it('can reopen modal after closing', () => {
    useAppStore.getState().openDeviceDetail(mockDevice);
    useAppStore.getState().closeDeviceDetail();
    useAppStore.getState().openDeviceDetail(mockDevice);
    const state = useAppStore.getState();
    expect(state.isModalOpen).toBe(true);
    expect(state.selectedDevice).toEqual(mockDevice);
  });
});
