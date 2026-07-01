import React from 'react';
import { AppState } from 'react-native';
import type { AppStateStatus, EmitterSubscription } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import { App } from '../App';
import { refreshNativeAppFeatureSettings } from '../services/app-config-service';

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

jest.mock('../services/app-config-service', () => ({
  refreshNativeAppFeatureSettings: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../stores/auth-store', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('../stores/recent-desktops-store', () => ({
  RecentDesktopsProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}));

jest.mock('../navigation/RootNavigator', () => ({
  RootNavigator: () => null,
}));

jest.mock('@react-navigation/native', () => ({
  NavigationContainer: ({ children }: { children: React.ReactNode }) =>
    children,
}));

jest.mock('react-native-gesture-handler', () => ({
  GestureHandlerRootView: ({ children }: { children: React.ReactNode }) =>
    children,
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('../i18n/language-preference', () => ({
  loadStoredLanguagePreference: jest.fn().mockResolvedValue('system'),
  resolveLanguagePreference: jest.fn().mockReturnValue('zh-Hant'),
}));

jest.mock('../i18n', () => ({
  __esModule: true,
  default: {
    language: 'zh-Hant',
    changeLanguage: jest.fn().mockResolvedValue(undefined),
  },
}));

describe('App OSS startup settings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('refreshes local feature settings on launch and foreground without public wake activation', async () => {
    let appStateListener: ((state: AppStateStatus) => void) | null = null;
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_event, listener) => {
        appStateListener = listener;
        return { remove: jest.fn() } as unknown as EmitterSubscription;
      });

    render(<App />);

    await waitFor(() => {
      expect(refreshNativeAppFeatureSettings).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      appStateListener?.('active');
    });

    await waitFor(() => {
      expect(refreshNativeAppFeatureSettings).toHaveBeenCalledTimes(2);
    });
  });
});
