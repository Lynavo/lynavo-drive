import React from 'react';
import { Platform } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

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
  const React = require('react');
  const { View } = require('react-native');
  const Camera = (props: Record<string, unknown>) => <View {...props} />;
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
import { useCodeScanner } from 'react-native-vision-camera';

describe('QRScannerScreen', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('zh-Hant');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'ios',
    });
  });

  it('renders the v0-style scanner guidance card', async () => {
    const { getByText } = render(<QRScannerScreen />);

    await waitFor(() => {
      expect(getByText('如何取得二維碼？')).toBeTruthy();
      expect(
        getByText('打開電腦端 Vivi Drop，在「全域設定」中找到連接碼，用攝像頭對準二維碼即可自動連接。'),
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
      expect(getByText('如何取得二維碼？')).toBeTruthy();
    });
  });

  it('opens the full tutorial flow from the QR guide card', async () => {
    const { getByText } = render(<QRScannerScreen />);

    await waitFor(() => expect(getByText('查看詳細圖文教程 >')).toBeTruthy());

    fireEvent.press(getByText('查看詳細圖文教程 >'));

    expect(mockNavigate).toHaveBeenCalledWith('ConnectionTutorial');
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
          'vividrop://connect?ip=192.168.31.8&device=Studio%20Mac&code=A8X2K9',
      },
    ]);

    jest.advanceTimersByTime(200);

    expect(mockReplace).toHaveBeenCalledWith('CodeVerify', {
      deviceId: 'qr-192-168-31-8',
      host: '192.168.31.8',
      port: 39393,
      deviceName: 'Studio Mac',
      prefilledCode: 'A8X2K9',
    });
  });
});
