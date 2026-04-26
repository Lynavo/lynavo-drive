import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { Alert, NativeModules, NativeEventEmitter } from 'react-native';

// Must mock react-native-localize before i18n import
jest.mock('react-native-localize', () => ({
  getLocales: () => [
    {
      languageCode: 'en',
      countryCode: 'US',
      languageTag: 'en-US',
      isRTL: false,
    },
  ],
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../components/Icon', () => ({
  Icon: ({ name }: { name: string }) => {
    const ReactInner = require('react');
    const { Text: MockText } = require('react-native');
    return ReactInner.createElement(MockText, null, name);
  },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));

jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
  resetGenericPassword: jest.fn(),
}));

jest.mock('../../constants/features', () => ({
  FEATURES: { SUBSCRIPTION_ENFORCEMENT: true },
}));

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
}));

// Declared after jest.mock hoisting; assigned via module-level var reference.
// The `mock` prefix satisfies babel-jest's hoisting safety rule.
const mockNavigate = jest.fn();

jest.mock('../../stores/auth-store', () => {
  const actual = jest.requireActual('../../stores/auth-store');
  return {
    ...actual,
    useAuth: jest.fn(),
  };
});

// Mock NativeEventEmitter to avoid "not a native module" errors
jest.mock('react-native/Libraries/EventEmitter/NativeEventEmitter');

// Mock SyncEngineModule — browseSharedFiles returns one file so the list
// renders and the download button with testID is visible.
const mockBrowseSharedFiles = jest.fn();
const mockDownloadSharedFile = jest.fn();
const mockGetSharedFileStreamUrl = jest.fn();

jest.mock('../../services/SyncEngineModule', () => ({
  browseSharedFiles: (...args: unknown[]) => mockBrowseSharedFiles(...args),
  downloadSharedFile: (...args: unknown[]) => mockDownloadSharedFile(...args),
  getSharedFileStreamUrl: (...args: unknown[]) => mockGetSharedFileStreamUrl(...args),
}));

import i18n from '../../i18n';
import { SharedFilesScreen } from '../SharedFilesScreen';
import { useAuth } from '../../stores/auth-store';

const alertSpy = jest.spyOn(Alert, 'alert');

const FAKE_FILE = {
  name: 'photo.jpg',
  path: '/shared/photo.jpg',
  size: 1024,
  type: 'image',
  isDirectory: false,
  thumbnailUrl: null,
};

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  jest.clearAllMocks();

  // Set up NativeSyncEngine on NativeModules so checkDeviceAvailable passes.
  (NativeModules as Record<string, unknown>).NativeSyncEngine = {
    getBindingState: jest.fn().mockResolvedValue({
      deviceId: 'device-1',
      connectionState: 'connected',
    }),
    addListener: jest.fn(),
    removeListeners: jest.fn(),
  };

  // NativeEventEmitter mock needs addListener to return a removable sub.
  (NativeEventEmitter as jest.Mock).mockImplementation(() => ({
    addListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
  }));

  // Return one non-directory file so the FlatList renders the download button.
  mockBrowseSharedFiles.mockResolvedValue({ files: [FAKE_FILE] });
  mockDownloadSharedFile.mockResolvedValue({ savedToPhotos: true, localPath: null });

  alertSpy.mockImplementation((_t, _b, buttons) => {
    // Simulate tap on the first non-cancel button.
    const go = buttons?.find((b: { style?: string }) => b.style !== 'cancel');
    go?.onPress?.();
  });
});

describe('SharedFilesScreen download gate', () => {
  test('blocks download and navigates to Subscription when sub_expired', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      subscription: { status: 'sub_expired' },
      loadSubscription: jest.fn(),
    });

    const { getByTestId } = render(<SharedFilesScreen />);

    // Wait for loadFiles to complete and the FlatList to render.
    await waitFor(() => getByTestId('shared-file-download-button'));

    fireEvent.press(getByTestId('shared-file-download-button'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(mockNavigate).toHaveBeenCalledWith('Subscription');
  });

  test('allows download when trialing', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      subscription: { status: 'trialing' },
      loadSubscription: jest.fn(),
    });

    const { getByTestId } = render(<SharedFilesScreen />);

    await waitFor(() => getByTestId('shared-file-download-button'));

    await act(async () => {
      fireEvent.press(getByTestId('shared-file-download-button'));
    });

    // Gate alert must NOT have fired; download was attempted instead.
    expect(alertSpy).not.toHaveBeenCalledWith(
      expect.stringMatching(/Subscription required/),
      expect.anything(),
      expect.anything(),
    );
    expect(mockNavigate).not.toHaveBeenCalledWith('Subscription');
  });
});
