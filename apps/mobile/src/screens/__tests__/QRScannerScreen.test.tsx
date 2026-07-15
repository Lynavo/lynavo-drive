import React from 'react';
import { AppState, Linking, Platform } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('react-native-localize', () => ({
  getLocales: () => [
    {
      languageCode: 'zh',
      scriptCode: 'Hant',
      countryCode: 'TW',
      languageTag: 'zh-Hant-TW',
      isRTL: false,
    },
  ],
}));

jest.mock('react-native-vision-camera', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');
  const Camera = (props: Record<string, unknown>) =>
    ReactModule.createElement(View, props);
  Camera.getCameraPermissionStatus = jest
    .fn()
    .mockReturnValue('not-determined');
  Camera.requestCameraPermission = jest.fn().mockResolvedValue('granted');

  return {
    Camera,
    useCameraDevice: jest.fn(() => ({ id: 'back-camera' })),
    useCodeScanner: jest.fn(config => config),
  };
});

const mockNavigate = jest.fn();
const mockReplace = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    goBack: jest.fn(),
    navigate: mockNavigate,
    replace: mockReplace,
  }),
}));

jest.mock('@react-navigation/stack', () => ({}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('../../components/Icon', () => ({
  Icon: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));

import i18n from '../../i18n';
import { QRScannerScreen } from '../QRScannerScreen';
import { Camera, useCodeScanner } from 'react-native-vision-camera';

describe('QRScannerScreen', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'ios',
    });
    (Camera.getCameraPermissionStatus as jest.Mock).mockReturnValue(
      'not-determined',
    );
    (Camera.requestCameraPermission as jest.Mock).mockResolvedValue('granted');
  });

  it('does not request camera permission again when it is already granted', async () => {
    (Camera.getCameraPermissionStatus as jest.Mock).mockReturnValue('granted');

    const { getByText } = render(<QRScannerScreen />);

    await waitFor(() => {
      expect(getByText('How do I get the QR code?')).toBeTruthy();
    });

    expect(Camera.getCameraPermissionStatus).toHaveBeenCalledTimes(1);
    expect(Camera.requestCameraPermission).not.toHaveBeenCalled();
  });

  it('renders the v0-style scanner guidance card', async () => {
    const { getByText } = render(<QRScannerScreen />);

    await waitFor(() => {
      expect(getByText('How do I get the QR code?')).toBeTruthy();
      expect(
        getByText(
          'Open Lynavo Drive on your computer, find the pairing code in Global Settings, then aim the camera at the QR code to connect automatically.',
        ),
      ).toBeTruthy();
    });
  });

  it('uses the camera scanner guidance on Android', async () => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'android',
    });

    const { getByText } = render(<QRScannerScreen />);

    await waitFor(() => {
      expect(getByText('How do I get the QR code?')).toBeTruthy();
    });
  });

  it('opens the full tutorial flow from the QR guide card', async () => {
    const { getByText } = render(<QRScannerScreen />);

    await waitFor(() =>
      expect(getByText('View full illustrated tutorial >')).toBeTruthy(),
    );

    fireEvent.press(getByText('View full illustrated tutorial >'));

    expect(mockNavigate).toHaveBeenCalledWith('ConnectionTutorial');
  });

  it('does not show the denied permission copy while the permission request is pending', async () => {
    let resolvePermission: (status: string) => void = () => {};
    (Camera.getCameraPermissionStatus as jest.Mock).mockReturnValue(
      'not-determined',
    );
    (Camera.requestCameraPermission as jest.Mock).mockImplementation(
      () =>
        new Promise(resolve => {
          resolvePermission = resolve;
        }),
    );

    const { queryByText, getByText } = render(<QRScannerScreen />);

    expect(
      queryByText('Camera access is required to scan the QR code.'),
    ).toBeNull();

    resolvePermission('denied');

    await waitFor(() => {
      expect(
        getByText('Camera access is required to scan the QR code.'),
      ).toBeTruthy();
    });
  });

  it('uses the refreshed camera permission status after the Android permission prompt resolves', async () => {
    (Camera.getCameraPermissionStatus as jest.Mock)
      .mockReturnValueOnce('not-determined')
      .mockReturnValueOnce('granted');
    (Camera.requestCameraPermission as jest.Mock).mockResolvedValue('denied');

    const { getByText, queryByText } = render(<QRScannerScreen />);

    await waitFor(() => {
      expect(getByText('How do I get the QR code?')).toBeTruthy();
    });
    expect(
      queryByText('Camera access is required to scan the QR code.'),
    ).toBeNull();
  });

  it('opens system settings when camera permission has been denied', async () => {
    (Camera.getCameraPermissionStatus as jest.Mock).mockReturnValue('denied');

    const { getByText } = render(<QRScannerScreen />);

    await waitFor(() => {
      expect(
        getByText('Camera access is required to scan the QR code.'),
      ).toBeTruthy();
    });

    fireEvent.press(getByText('Open Settings'));

    expect(Linking.openSettings).toHaveBeenCalledTimes(1);
  });

  it('refreshes camera permission after returning from system settings', async () => {
    let appStateHandler: ((state: string) => void) | null = null;
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_event, handler) => {
        appStateHandler = handler as (state: string) => void;
        return { remove: jest.fn() };
      });
    (Camera.getCameraPermissionStatus as jest.Mock)
      .mockReturnValueOnce('denied')
      .mockReturnValueOnce('granted');

    const { getByText, queryByText } = render(<QRScannerScreen />);

    await waitFor(() => {
      expect(
        getByText('Camera access is required to scan the QR code.'),
      ).toBeTruthy();
    });

    act(() => {
      appStateHandler?.('active');
    });

    await waitFor(() => {
      expect(getByText('How do I get the QR code?')).toBeTruthy();
    });
    expect(
      queryByText('Camera access is required to scan the QR code.'),
    ).toBeNull();
  });

  it('navigates to code verification after scanning a desktop connection QR', async () => {
    jest.useFakeTimers();

    render(<QRScannerScreen />);

    await waitFor(() => {
      expect(useCodeScanner).toHaveBeenCalled();
    });

    const scannerConfig = (useCodeScanner as jest.Mock).mock.results.at(-1)
      ?.value as {
      onCodeScanned: (codes: Array<{ value?: string | null }>) => void;
    };

    scannerConfig.onCodeScanned([
      {
        value:
          'lynavodrive://connect?ip=192.168.31.8&device=Studio%20Mac&code=A8X2K9',
      },
    ]);

    jest.advanceTimersByTime(200);

    expect(mockReplace).toHaveBeenCalledWith('CodeVerify', {
      deviceId: 'qr-192-168-31-8',
      host: '192.168.31.8',
      port: 39593,
      deviceName: 'Studio Mac',
      prefilledCode: 'A8X2K9',
    });
  });
});
