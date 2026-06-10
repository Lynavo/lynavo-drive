import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionDevicesSettingsDTO } from '@syncflow/contracts';
import { useConnectionDevicesStore } from '../connection-devices-store';

const fixture: ConnectionDevicesSettingsDTO = {
  authorizedDevices: [
    {
      clientId: 'phone-a',
      displayName: 'Nick iPhone',
      clientName: 'Nick iPhone',
      platform: 'ios',
      status: 'authorized',
      authorizedAt: '2026-06-10T01:00:00Z',
      lastSeenAt: '2026-06-10T01:10:00Z',
    },
  ],
  blockedClients: [
    {
      clientId: 'phone-b',
      displayName: 'Blocked Phone',
      failedAttempts: 5,
      blockedAt: '2026-06-10T01:15:00Z',
      lastAttemptAt: '2026-06-10T01:15:00Z',
      reason: 'wrong_connection_code_limit',
    },
  ],
  recentAttempts: [
    {
      id: 1,
      clientId: 'phone-b',
      displayName: 'Blocked Phone',
      result: 'wrong_code',
      failureReason: 'PAIRING_CODE_INVALID',
      createdAt: '2026-06-10T01:14:00Z',
    },
  ],
};

describe('connection devices store', () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, 'electronAPI');
    useConnectionDevicesStore.setState({
      data: { authorizedDevices: [], blockedClients: [], recentAttempts: [] },
      loading: false,
      error: null,
      busyClientId: null,
    });
    (window as Window & { electronAPI?: unknown }).electronAPI = {
      sidecar: {
        getConnectionDevices: vi.fn().mockResolvedValue(fixture),
        revokeConnectionDevice: vi.fn().mockResolvedValue({ ok: true }),
        clearBlockedClient: vi.fn().mockResolvedValue({ ok: true }),
      },
    } as unknown as Window['electronAPI'];
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'electronAPI');
    useConnectionDevicesStore.setState(useConnectionDevicesStore.getInitialState());
    vi.restoreAllMocks();
  });

  it('loads connection devices from preload API', async () => {
    await useConnectionDevicesStore.getState().fetchConnectionDevices();

    expect(window.electronAPI.sidecar.getConnectionDevices).toHaveBeenCalledOnce();
    expect(useConnectionDevicesStore.getState().data).toEqual(fixture);
    expect(useConnectionDevicesStore.getState().loading).toBe(false);
  });

  it('revokes a device then refreshes data', async () => {
    await useConnectionDevicesStore.getState().revokeDevice('phone-a');

    expect(window.electronAPI.sidecar.revokeConnectionDevice).toHaveBeenCalledWith('phone-a');
    expect(window.electronAPI.sidecar.getConnectionDevices).toHaveBeenCalled();
    expect(useConnectionDevicesStore.getState().busyClientId).toBeNull();
  });

  it('clears a blocked client then refreshes data', async () => {
    await useConnectionDevicesStore.getState().clearBlock('phone-b');

    expect(window.electronAPI.sidecar.clearBlockedClient).toHaveBeenCalledWith('phone-b');
    expect(window.electronAPI.sidecar.getConnectionDevices).toHaveBeenCalled();
    expect(useConnectionDevicesStore.getState().busyClientId).toBeNull();
  });
});
