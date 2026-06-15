import React from 'react';
import { render, act, fireEvent } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Text, TouchableOpacity } from 'react-native';
import {
  RecentDesktopsProvider,
  useRecentDesktops,
  loadRecentDesktopsFromStorage,
  saveRecentDesktopsToStorage,
} from '../recent-desktops-store';
import type { RecentDesktopDTO } from '@syncflow/contracts';

function TestComponent() {
  const { recentDesktops, addDesktop, forgetDesktop, updateAuthStatus } = useRecentDesktops();
  return (
    <>
      <Text testID="desktop-count">{recentDesktops.length}</Text>
      {recentDesktops.map(d => (
        <Text key={d.desktopDeviceId} testID={`device-${d.desktopDeviceId}`}>
          {`${d.desktopName} - ${d.authorizationStatus}`}
        </Text>
      ))}
      <TouchableOpacity
        testID="add-btn"
        onPress={() =>
          addDesktop({
            desktopDeviceId: 'device-new',
            desktopName: 'New PC',
            host: '192.168.1.15',
            port: 39393,
            authorizationStatus: 'requires_code',
          })
        }
      >
        <Text>Add</Text>
      </TouchableOpacity>
      <TouchableOpacity testID="forget-btn" onPress={() => forgetDesktop('device-new')}>
        <Text>Forget</Text>
      </TouchableOpacity>
      <TouchableOpacity
        testID="auth-btn"
        onPress={() => updateAuthStatus('device-new', 'authorized')}
      >
        <Text>Auth</Text>
      </TouchableOpacity>
    </>
  );
}

describe('recent-desktops-store raw logic', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  it('loads empty array when storage is empty', async () => {
    const desktops = await loadRecentDesktopsFromStorage();
    expect(desktops).toEqual([]);
  });

  it('saves and loads desktops', async () => {
    const mockDesktops: RecentDesktopDTO[] = [
      {
        desktopDeviceId: 'device-1',
        desktopName: 'My Mac',
        host: '192.168.1.10',
        port: 39393,
        lastConnectedAt: new Date().toISOString(),
        authorizationStatus: 'authorized',
      },
    ];

    await saveRecentDesktopsToStorage(mockDesktops);
    const loaded = await loadRecentDesktopsFromStorage();
    expect(loaded).toEqual(mockDesktops);
  });
});

describe('RecentDesktopsProvider and useRecentDesktops', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  it('manages state of recent desktops in provider', async () => {
    const { getByTestId, queryByTestId } = render(
      <RecentDesktopsProvider>
        <TestComponent />
      </RecentDesktopsProvider>
    );

    // Initial state after mount (AsyncStorage hydration)
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    expect(getByTestId('desktop-count').children[0]).toBe('0');

    // Add a desktop
    await act(async () => {
      fireEvent.press(getByTestId('add-btn'));
    });

    expect(getByTestId('desktop-count').children[0]).toBe('1');
    expect(getByTestId('device-device-new').children[0]).toContain('New PC - requires_code');

    // Update auth status
    await act(async () => {
      fireEvent.press(getByTestId('auth-btn'));
    });

    expect(getByTestId('device-device-new').children[0]).toContain('New PC - authorized');

    // Forget desktop
    await act(async () => {
      fireEvent.press(getByTestId('forget-btn'));
    });

    expect(getByTestId('desktop-count').children[0]).toBe('0');
    expect(queryByTestId('device-device-new')).toBeNull();
  });
});
