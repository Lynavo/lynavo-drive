import { describe, it, expect, beforeEach } from 'vitest';
import { useSettingsStore } from '../settings-store';
import { mockSettings } from '../../mocks/settings';
import type { SettingsDTO } from '@syncflow/contracts';

describe('settings-store', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      settings: mockSettings,
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
      receivePath: '/tmp/new-path',
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
});
