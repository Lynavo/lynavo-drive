import React from 'react';

jest.mock('../../services/SyncEngineModule', () => {
  class MockPairingError extends Error {
    code: string;
    remainingAttempts?: number;
    blocked?: boolean;
    constructor(
      message: string,
      code: 'wrong_code' | 'blocked' | 'version_incompatible' | 'unknown',
      remainingAttempts?: number,
      blocked?: boolean,
    ) {
      super(message);
      this.name = 'PairingError';
      this.code = code;
      this.remainingAttempts = remainingAttempts;
      this.blocked = blocked;
    }
  }
  return {
    pairDevice: jest.fn(),
    PairingError: MockPairingError,
    getClientId: jest.fn().mockResolvedValue('mock-client-id'),
  };
});

import { fireEvent, render, act } from '@testing-library/react-native';
import { pairDevice, PairingError } from '../../services/SyncEngineModule';

const mockPairDevice = pairDevice as jest.Mock;

const mockNavigate = jest.fn();
const mockDispatch = jest.fn();
const mockGoBack = jest.fn();
const mockUseRoute = jest.fn();

const defaultRouteParams = {
  deviceId: 'device-1',
  host: '192.168.1.8',
  port: 39593,
  deviceName: 'Studio Mac',
};

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

jest.mock('@react-navigation/native', () => ({
  CommonActions: {
    reset: jest.fn(payload => ({ type: 'RESET', payload })),
  },
  useNavigation: () => ({
    canGoBack: jest.fn(() => true),
    goBack: mockGoBack,
    dispatch: mockDispatch,
    navigate: mockNavigate,
  }),
  useRoute: () => mockUseRoute(),
}));

jest.mock('@react-navigation/stack', () => ({}));
jest.mock('../../stores/recent-desktops-store', () => ({
  useRecentDesktops: () => ({
    recentDesktops: [],
    isLoading: false,
    addDesktop: jest.fn(),
    forgetDesktop: jest.fn(),
    updateAuthStatus: jest.fn(),
  }),
}));
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
import { CodeVerifyScreen } from '../CodeVerifyScreen';

function pairingNativeError(
  code: string,
  message: string,
  userInfo?: Record<string, unknown>,
) {
  return {
    code,
    message,
    userInfo,
  };
}

async function renderPrefilledPairingFailure(error: unknown) {
  mockPairDevice.mockReset();
  mockPairDevice.mockRejectedValueOnce(error);
  mockUseRoute.mockReturnValue({
    params: {
      ...defaultRouteParams,
      prefilledCode: '123456',
    },
  });

  const result = render(<CodeVerifyScreen />);

  await act(async () => {
    await new Promise<void>(resolve => setTimeout(resolve, 600));
  });

  expect(mockPairDevice).toHaveBeenCalledWith({
    deviceId: 'device-1',
    host: '192.168.1.8',
    port: 39593,
    connectionCode: '123456',
  });

  return result;
}

describe('CodeVerifyScreen', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockPairDevice.mockResolvedValue(undefined);
    mockUseRoute.mockReturnValue({
      params: defaultRouteParams,
    });
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not hardcode localized Chinese copy in the screen source', () => {
    expect(CodeVerifyScreen.toString()).not.toMatch(/[\u4e00-\u9fff]/);
  });

  it('keeps the original dev pairing-code help card', () => {
    const { getByText } = render(<CodeVerifyScreen />);

    expect(getByText('Where do I find the pairing code?')).toBeTruthy();
    expect(
      getByText(
        'Open Lynavo Drive on your computer, choose Global Settings from the sidebar, and check the 6-digit pairing code.',
      ),
    ).toBeTruthy();
    expect(
      getByText(
        'The code does not refresh automatically. Use Regenerate to update it manually.',
      ),
    ).toBeTruthy();
    expect(getByText('Example')).toBeTruthy();
    expect(getByText('View detailed tutorial >')).toBeTruthy();
  });

  it('opens the detailed connection tutorial from the original dev help card', () => {
    const { getByText } = render(<CodeVerifyScreen />);

    fireEvent.press(getByText('View detailed tutorial >'));

    expect(mockNavigate).toHaveBeenCalledWith('ConnectionTutorial');
  });

  it('shows remaining attempts when pairDevice rejects with PAIRING_CODE_INVALID metadata', async () => {
    const { getByText } = await renderPrefilledPairingFailure(
      pairingNativeError('PAIRING_CODE_INVALID', 'Pairing code invalid', {
        failedAttempts: 1,
        remainingAttempts: 2,
        maxAttempts: 3,
      }),
    );

    expect(
      getByText('Incorrect pairing code. You can try 2 more times.'),
    ).toBeTruthy();
  });

  it('keeps legacy PairingError wrong-code handling through the service wrapper', async () => {
    const { getByText } = await renderPrefilledPairingFailure(
      new PairingError('Pairing rejected', 'wrong_code', 1, false),
    );

    expect(
      getByText('Incorrect pairing code. You can try 1 more times.'),
    ).toBeTruthy();
  });

  it('shows permanent blocked guidance when pairDevice rejects with PAIRING_CLIENT_BLOCKED', async () => {
    const { getByText } = await renderPrefilledPairingFailure(
      pairingNativeError('PAIRING_CLIENT_BLOCKED', 'Client blocked', {
        failedAttempts: 3,
        remainingAttempts: 0,
        maxAttempts: 3,
      }),
    );

    expect(
      getByText(
        'This phone has been blocked by this computer. Unblock it on the computer, then try again.',
      ),
    ).toBeTruthy();
  });

  it('does not show remaining-attempt wrong-code copy for PAIR_TOKEN_INVALID', async () => {
    const { getByText, queryByText } = await renderPrefilledPairingFailure(
      pairingNativeError('PAIR_TOKEN_INVALID', 'Pairing token invalid', {
        remainingAttempts: 2,
        maxAttempts: 3,
      }),
    );

    expect(
      getByText(
        'The connection has expired. Enter the computer pairing code again.',
      ),
    ).toBeTruthy();
    expect(
      queryByText('Incorrect pairing code. You can try 2 more times.'),
    ).toBeNull();
  });

  it('triggers Alert.alert when pairDevice throws APP_VERSION_INCOMPATIBLE', async () => {
    const { Alert } = require('react-native');
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    mockPairDevice.mockReset();
    mockPairDevice.mockRejectedValueOnce(
      pairingNativeError('APP_VERSION_INCOMPATIBLE', 'version mismatch'),
    );

    mockUseRoute.mockReturnValue({
      params: {
        ...defaultRouteParams,
        prefilledCode: '123456',
      },
    });

    render(<CodeVerifyScreen />);

    // Wait for the deferred submitCode timer (500ms) to fire
    await act(async () => {
      await new Promise<void>(resolve => setTimeout(resolve, 600));
    });

    expect(mockPairDevice).toHaveBeenCalledWith({
      deviceId: 'device-1',
      host: '192.168.1.8',
      port: 39593,
      connectionCode: '123456',
    });
    expect(alertSpy).toHaveBeenCalledWith(
      'Version Incompatible',
      'The app versions on your mobile device and computer are incompatible. Please update the desktop app to the latest version and try again.',
      [{ text: 'OK' }],
    );
  });
});
