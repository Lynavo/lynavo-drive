/**
 * DeviceNameSection — locked-while-transferring behavior.
 *
 * Covers:
 *  - Idle: input/button enabled, no locked hint.
 *  - Any device transferring: input + save button disabled, locked hint shown.
 *  - Mid-edit transfer kickoff: in-flight draft is dropped (race guard).
 *  - Empty devices list: no false lock at startup.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type {
  DashboardDeviceDTO,
  DeviceDashboardStatus,
} from '@syncflow/contracts';
import { DeviceNameSection } from '../DeviceNameSection';
import { useSettingsStore } from '@renderer/stores/settings-store';
import { useDashboardStore } from '@renderer/stores/dashboard-store';

const mockUpdateSettings = vi.fn();

function setElectronAPI() {
  (window as Window & { electronAPI?: unknown }).electronAPI = {
    sidecar: {
      updateSettings: mockUpdateSettings,
    },
  } as unknown as Window['electronAPI'];
}

function makeDevice(
  status: DeviceDashboardStatus = 'connected_idle',
  deviceId = 'mobile-1',
): DashboardDeviceDTO {
  return {
    deviceId,
    displayName: 'iPhone 15',
    clientName: 'iPhone 15',
    platform: 'ios',
    ip: '192.168.1.20',
    status,
    todayFileCount: 0,
    todayBytes: 0,
    storageLeft: '256 GB',
    storagePath: '/Users/x/Downloads/SyncFlow',
    devicePath: '/Users/x/Downloads/SyncFlow/received/mobile-1',
  };
}

function seedSettings(deviceName = 'Alice 的 MacBook Pro') {
  useSettingsStore.setState({
    settings: {
      deviceName,
      connectionCode: '',
      rootPath: '',
      receivePath: '',
      sharedPath: '',
      shareAddress: '',
      shareStatus: 'unknown',
      shareName: '',
    },
  });
}

function seedDevices(devices: DashboardDeviceDTO[]) {
  useDashboardStore.setState({ devices });
}

describe('DeviceNameSection — transfer lock', () => {
  beforeEach(() => {
    mockUpdateSettings.mockReset();
    mockUpdateSettings.mockImplementation(
      async (patch: { deviceName: string }) => ({
        deviceName: patch.deviceName,
        connectionCode: '',
        rootPath: '',
        receivePath: '',
        sharedPath: '',
        shareAddress: '',
        shareStatus: 'unknown',
        shareName: '',
      }),
    );
    setElectronAPI();
    seedSettings();
    seedDevices([]);
  });

  afterEach(() => {
    seedDevices([]);
  });

  it('idle: input enabled, save enabled after edit, no locked hint', () => {
    seedDevices([makeDevice('connected_idle')]);

    render(<DeviceNameSection />);

    const input = screen.getByTestId('device-name-input') as HTMLInputElement;
    const saveBtn = screen.getByTestId('device-name-save') as HTMLButtonElement;

    expect(input.disabled).toBe(false);
    expect(saveBtn.disabled).toBe(true); // not dirty yet
    expect(screen.queryByTestId('device-name-locked-hint')).toBeNull();

    fireEvent.change(input, { target: { value: 'New Mac Name' } });
    expect(saveBtn.disabled).toBe(false);
  });

  it('locks input + save button + shows hint while any device is transferring', () => {
    seedDevices([
      makeDevice('connected_idle', 'mobile-1'),
      makeDevice('transferring', 'mobile-2'),
    ]);

    render(<DeviceNameSection />);

    const input = screen.getByTestId('device-name-input') as HTMLInputElement;
    const saveBtn = screen.getByTestId('device-name-save') as HTMLButtonElement;

    expect(input.disabled).toBe(true);
    expect(saveBtn.disabled).toBe(true);
    expect(screen.getByTestId('device-name-locked-hint')).toBeInTheDocument();
  });

  it('drops in-flight draft when a transfer starts mid-edit (race guard)', async () => {
    seedDevices([makeDevice('connected_idle')]);

    render(<DeviceNameSection />);

    const input = screen.getByTestId('device-name-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Halfway-Typed Name' } });
    expect(input.value).toBe('Halfway-Typed Name');

    await act(async () => {
      seedDevices([makeDevice('transferring')]);
    });

    expect(input.disabled).toBe(true);
    // Draft was discarded → falls back to current settings.deviceName.
    expect(input.value).toBe('Alice 的 MacBook Pro');
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it('does NOT lock when devices list is empty (initial state)', () => {
    seedDevices([]);

    render(<DeviceNameSection />);

    expect(
      (screen.getByTestId('device-name-input') as HTMLInputElement).disabled,
    ).toBe(false);
    expect(screen.queryByTestId('device-name-locked-hint')).toBeNull();
  });
});
