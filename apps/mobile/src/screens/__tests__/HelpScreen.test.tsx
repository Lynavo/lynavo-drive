import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

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
  useNavigation: () => ({
    goBack: jest.fn(),
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

jest.mock('../../utils/shareDiagnosticsArchive', () => ({
  isDiagnosticsExportUnavailable: jest.fn().mockReturnValue(false),
  shareDiagnosticsArchive: jest.fn().mockResolvedValue(undefined),
}));

import i18n from '../../i18n';
import { HelpScreen } from '../HelpScreen';

describe('HelpScreen', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('zh-Hant');
  });

  it('renders the v0 help-center copy and FAQ guidance', () => {
    const { getByText } = render(<HelpScreen />);

    expect(getByText('幫助中心')).toBeTruthy();
    expect(
      getByText('區域網路素材無線同步工具，手機照片和影片高速傳至電腦'),
    ).toBeTruthy();
    expect(getByText('電腦瀏覽器訪問 vividrop.cn 下載安裝')).toBeTruthy();
    expect(getByText('手機掃碼或輸入 6 位連接碼')).toBeTruthy();

    fireEvent.press(getByText('一直顯示尋找設備怎麼辦？'));

    expect(
      getByText(
        '請確認手機和電腦處於同一 Wi-Fi 網路，且 Vivi Drop PC 端正在執行。嘗試重新啟動 PC 端後，在手機端點擊重新掃描，或改用 6 位連接碼手動連接。',
      ),
    ).toBeTruthy();
  });
});
