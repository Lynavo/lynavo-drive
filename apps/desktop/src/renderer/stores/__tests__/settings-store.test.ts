import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSettingsStore } from '../settings-store';
import { mockSettings } from '../../mocks/settings';
import type { SettingsDTO } from '@syncflow/contracts';
import { useSidecarRuntimeStore } from '../sidecar-runtime-store';

describe('settings-store', () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, 'electronAPI');
    useSidecarRuntimeStore.setState((state) => ({
      runtime: {
        ...state.runtime,
        status: 'healthy',
        message: null,
      },
    }));
    useSettingsStore.setState({
      settings: mockSettings,
      shareStatusInfo: {
        enabled: true,
        smbUrl: mockSettings.shareAddress,
        status: mockSettings.shareStatus,
        shareName: mockSettings.shareName,
      },
      validatingShare: false,
      copiedField: null,
    });
  });

  it('initializes with mock settings', () => {
    const state = useSettingsStore.getState();
    expect(state.settings.connectionCode).toBe('839274');
    expect(state.settings.receivePath).toBe('/Users/alice/SyncFlow/Received');
    expect(state.settings.shareStatus).toBe('ready');
  });

  it('updateSettings replaces full settings object', () => {
    const updated: SettingsDTO = {
      deviceName: 'New Mac',
      connectionCode: '111222',
      rootPath: '/tmp',
      receivePath: '/tmp/new-path',
      personalPath: '/tmp/personal',
      sharedPath: '/tmp/shared',
      shareAddress: 'smb://10.0.0.1/Share',
      shareStatus: 'ready',
      shareName: 'NewShare',
    };
    useSettingsStore.getState().updateSettings(updated);
    expect(useSettingsStore.getState().settings).toEqual(updated);
  });

  it('setCopied tracks field name', () => {
    useSettingsStore.getState().setCopied('connectionCode');
    expect(useSettingsStore.getState().copiedField).toBe('connectionCode');
  });

  it('setCopied clears with null', () => {
    useSettingsStore.getState().setCopied('connectionCode');
    useSettingsStore.getState().setCopied(null);
    expect(useSettingsStore.getState().copiedField).toBeNull();
  });

  it('does not have regenerateCode action', () => {
    const state = useSettingsStore.getState();
    expect(state).not.toHaveProperty('regenerateCode');
  });

  it('skips settings fetch until sidecar is healthy', async () => {
    const getSettings = vi.fn();
    (window as Window & { electronAPI?: unknown }).electronAPI = {
      sidecar: {
        getSettings,
      },
    } as unknown as Window['electronAPI'];

    useSidecarRuntimeStore.setState((state) => ({
      runtime: {
        ...state.runtime,
        status: 'starting',
      },
    }));

    await useSettingsStore.getState().fetchSettings();

    expect(getSettings).not.toHaveBeenCalled();
  });

  it('fetches settings when sidecar is healthy', async () => {
    const updated: SettingsDTO = {
      deviceName: 'Studio Mac',
      connectionCode: '333444',
      rootPath: '/tmp',
      receivePath: '/tmp/studio',
      personalPath: '/tmp/personal',
      sharedPath: '/tmp/shared',
      shareAddress: '\\\\STUDIO\\SyncFlow',
      shareStatus: 'ready',
      shareName: 'SyncFlow',
    };

    (window as Window & { electronAPI?: unknown }).electronAPI = {
      sidecar: {
        getSettings: vi.fn().mockResolvedValue(updated),
      },
    } as unknown as Window['electronAPI'];

    await useSettingsStore.getState().fetchSettings();

    expect(useSettingsStore.getState().settings).toEqual(updated);
    expect(useSettingsStore.getState().shareStatusInfo).toEqual({
      enabled: true,
      smbUrl: updated.shareAddress,
      status: updated.shareStatus,
      shareName: updated.shareName,
    });
  });

  it('skips share validation until sidecar is healthy', async () => {
    const validateShare = vi.fn();
    (window as Window & { electronAPI?: unknown }).electronAPI = {
      sidecar: {
        validateShare,
      },
    } as unknown as Window['electronAPI'];

    useSidecarRuntimeStore.setState((state) => ({
      runtime: {
        ...state.runtime,
        status: 'starting',
      },
    }));

    await useSettingsStore.getState().refreshShareStatus();

    expect(validateShare).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().validatingShare).toBe(false);
  });
});
