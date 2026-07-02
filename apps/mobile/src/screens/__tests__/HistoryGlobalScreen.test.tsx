import React from 'react';
import { StyleSheet } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';

jest.mock('react-native-localize', () => ({
  getLocales: () => [
    {
      languageCode: 'zh',
      scriptCode: 'Hans',
      countryCode: 'CN',
      languageTag: 'zh-Hans-CN',
      isRTL: false,
    },
  ],
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'common.back': 'Back',
        'history.title': 'History',
      };
      return map[key] || key;
    },
  }),
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    canGoBack: jest.fn(() => false),
    goBack: jest.fn(),
    reset: jest.fn(),
  }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const ReactInner = require('react');
    ReactInner.useEffect(effect, [effect]);
  },
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

jest.mock('../../components/GlobalGradientBackground', () => ({
  GlobalGradientBackground: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

jest.mock('../../services/desktop-local-service', () => ({
  listHistory: jest.fn(),
}));

jest.mock('../../services/SyncEngineModule', () => ({
  getBindingState: jest.fn(),
}));

import { listHistory } from '../../services/desktop-local-service';
import { getBindingState } from '../../services/SyncEngineModule';
import { HistoryGlobalScreen } from '../HistoryGlobalScreen';
import type { DesktopSyncRecordDTO } from '@lynavo-drive/contracts';

const mockedListHistory = listHistory as jest.MockedFunction<
  typeof listHistory
>;
const mockedGetBindingState = getBindingState as jest.MockedFunction<
  typeof getBindingState
>;

describe('HistoryGlobalScreen', () => {
  let warnSpy: jest.SpyInstance<void, Parameters<typeof console.warn>>;

  beforeEach(() => {
    jest.clearAllMocks();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockedGetBindingState.mockResolvedValue({ host: '127.0.0.1' } as Awaited<
      ReturnType<typeof getBindingState>
    >);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('keeps a real empty history response empty instead of using preview records', async () => {
    mockedListHistory.mockResolvedValueOnce([]);

    const { getByText, queryByText } = render(<HistoryGlobalScreen />);

    await waitFor(() => {
      expect(mockedListHistory).toHaveBeenCalledWith({
        host: '127.0.0.1',
        port: 39394,
      });
    });

    await waitFor(() => {
      expect(getByText('No sync history yet')).toBeTruthy();
    });
    expect(queryByText('openimdeMac-mini')).toBeNull();
  });

  it('top-aligns the empty history prompt below the header', async () => {
    mockedListHistory.mockResolvedValueOnce([]);

    const { getByTestId } = render(<HistoryGlobalScreen />);

    await waitFor(() => {
      expect(mockedListHistory).toHaveBeenCalled();
    });

    const emptySectionStyle = StyleSheet.flatten(
      getByTestId('history-empty-state-section').props.style,
    );
    expect(emptySectionStyle.justifyContent).toBe('flex-start');
    expect(emptySectionStyle.paddingTop).toBeLessThanOrEqual(120);
  });

  it('shows an error state when the real history request fails', async () => {
    mockedListHistory.mockRejectedValueOnce(new Error('offline'));

    const { getByText, queryByText } = render(<HistoryGlobalScreen />);

    await waitFor(() => {
      expect(mockedListHistory).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(getByText('History load failed')).toBeTruthy();
    });
    expect(
      getByText('Unable to load sync history. Please try again later'),
    ).toBeTruthy();
    expect(queryByText('openimdeMac-mini')).toBeNull();
  });

  it('shows the empty state when the binding wrapper returns no binding', async () => {
    mockedGetBindingState.mockResolvedValueOnce(null);

    const { getByText, queryByText } = render(<HistoryGlobalScreen />);

    await waitFor(() => {
      expect(getByText('No sync history yet')).toBeTruthy();
    });
    expect(mockedListHistory).not.toHaveBeenCalled();
    expect(queryByText('openimdeMac-mini')).toBeNull();
  });

  it('uses a neutral duration for real history rows without duration data', async () => {
    mockedGetBindingState.mockResolvedValueOnce({
      deviceId: 'Mini4',
      deviceName: 'Studio Mini',
      host: '192.168.10.30',
    } as Awaited<ReturnType<typeof getBindingState>>);
    mockedListHistory.mockResolvedValueOnce([
      {
        recordId: 'completed-mini',
        desktopDeviceId: 'Mini4',
        clientId: 'mobile-client-1',
        displayName: 'Alice iPhone',
        fileKey: '2026/01/02/img-0001.heic',
        filename: 'IMG_0001.HEIC',
        mediaType: 'image/heic',
        fileSize: 1024,
        status: 'completed',
        completedAt: '2026-01-02T12:00:00.000Z',
      },
    ]);

    const { getByText, queryByText } = render(<HistoryGlobalScreen />);

    await waitFor(() => {
      expect(getByText('--')).toBeTruthy();
    });
    expect(queryByText('34m 14s')).toBeNull();
  });

  it('groups real completed history by desktop completion day and uses the bound desktop name', async () => {
    mockedGetBindingState.mockResolvedValueOnce({
      deviceId: 'desktop-bound-1',
      deviceName: 'Studio Mac',
      deviceAlias: 'Edit Bay Mac',
      host: '192.168.10.20',
    } as Awaited<ReturnType<typeof getBindingState>>);
    const realHistory: DesktopSyncRecordDTO[] = [
      {
        recordId: 'completed-1',
        desktopDeviceId: 'desktop-sidecar-1',
        clientId: 'mobile-client-1',
        displayName: 'Alice iPhone',
        fileKey: '2026/01/02/img-0001.heic',
        filename: 'IMG_0001.HEIC',
        mediaType: 'image/heic',
        fileSize: 1024,
        status: 'completed',
        completedAt: '2026-01-02T12:00:00.000Z',
      },
      {
        recordId: 'completed-2',
        desktopDeviceId: 'desktop-sidecar-1',
        clientId: 'mobile-client-1',
        displayName: 'Alice iPhone',
        fileKey: '2026/01/02/img-0002.heic',
        filename: 'IMG_0002.HEIC',
        mediaType: 'image/heic',
        fileSize: 2048,
        status: 'completed',
        completedAt: '2026-01-02T13:00:00.000Z',
      },
      {
        recordId: 'completed-3',
        desktopDeviceId: 'desktop-sidecar-1',
        clientId: 'mobile-client-1',
        displayName: 'Alice iPhone',
        fileKey: '2026/01/01/clip.mov',
        filename: 'CLIP.MOV',
        mediaType: 'video/quicktime',
        fileSize: 1048576,
        status: 'completed',
        completedAt: '2026-01-01T12:00:00.000Z',
      },
      {
        recordId: 'failed-1',
        desktopDeviceId: 'desktop-sidecar-1',
        clientId: 'mobile-client-1',
        displayName: 'Failed Phone',
        fileKey: '2026/01/02/failed.mov',
        filename: 'FAILED.MOV',
        mediaType: 'video/quicktime',
        fileSize: 3072,
        status: 'failed',
        failedAt: '2026-01-02T14:00:00.000Z',
      },
    ];
    mockedListHistory.mockResolvedValueOnce(realHistory);

    const { getAllByText, getByText, queryByText } = render(
      <HistoryGlobalScreen />,
    );

    await waitFor(() => {
      expect(mockedListHistory).toHaveBeenCalledWith({
        host: '192.168.10.20',
        port: 39394,
      });
    });

    await waitFor(() => {
      expect(getAllByText('Edit Bay Mac')).toHaveLength(2);
    });
    expect(getAllByText('192.168.10.20')).toHaveLength(2);
    expect(getByText('2026-01-02')).toBeTruthy();
    expect(getByText('2026-01-01')).toBeTruthy();
    expect(getAllByText('2').length).toBeGreaterThanOrEqual(1);
    expect(getByText('3 KB')).toBeTruthy();
    expect(getByText('1')).toBeTruthy();
    expect(getByText('1.0 MB')).toBeTruthy();
    expect(queryByText('Alice iPhone')).toBeNull();
    expect(queryByText('Failed Phone')).toBeNull();
    expect(queryByText('3')).toBeNull();
    expect(queryByText('6 KB')).toBeNull();
  });
});
