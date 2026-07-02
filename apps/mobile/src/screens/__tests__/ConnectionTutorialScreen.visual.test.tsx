import React from 'react';
import { Dimensions, StyleSheet, ViewStyle } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

const mockGoBack = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    goBack: mockGoBack,
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'common.back': '返回',
        'connectionTutorial.title': '連接教程',
        'connectionTutorial.prerequisite':
          '前提：請確保電腦已安裝並打開 Lynavo Drive 客戶端',
        'connectionTutorial.tabs.lan': '搜尋',
        'connectionTutorial.tabs.qr': '掃碼',
        'connectionTutorial.tabs.code': '連接碼',
        'connectionTutorial.tabs.ip': 'IP 直連',
        'connectionTutorial.cards.lan.steps.0':
          '確保手機與電腦接入同一個 Wi-Fi 或區域網路',
        'connectionTutorial.cards.lan.steps.1':
          '在電腦打開 Lynavo Drive 客戶端並保持執行',
        'connectionTutorial.cards.lan.steps.2':
          '手機端進入搜尋設備，稍等片刻即可發現電腦',
        'connectionTutorial.cards.lan.warning':
          '還沒有電腦端？請在電腦瀏覽器訪問 {{host}} 安裝。',
        'connectionTutorial.cards.qr.steps.0':
          '在電腦端 Lynavo Drive「全域設定」中顯示二維碼',
        'connectionTutorial.cards.qr.steps.1':
          '手機端點擊「掃碼配對」打開攝像頭',
        'connectionTutorial.cards.qr.steps.2':
          '對準螢幕上的二維碼，識別後自動進入配對流程',
        'connectionTutorial.cards.code.steps.0':
          '在電腦端「全域設定」中查看 6 位數字連接碼',
        'connectionTutorial.cards.code.steps.1':
          '連接碼不會自動刷新，需手動點擊「重新產生」才會變更',
        'connectionTutorial.cards.code.steps.2':
          '在手機端輸入連接碼，驗證通過後完成配對',
        'connectionTutorial.cards.ip.steps.0':
          '在電腦端左側導覽列打開「全域設定」',
        'connectionTutorial.cards.ip.steps.1':
          '找到「廣播 IP（iPhone 連接地址）」',
        'connectionTutorial.cards.ip.steps.2':
          '在手機端「手動配對」中輸入該地址並繼續',
        'connectionTutorial.troubleshoot.entry': '一直搜不到設備？',
        'connectionTutorial.troubleshoot.cta': '查看排障指南 >',
        'connectionTutorial.troubleshoot.title': '連接排障指南',
        'connectionTutorial.troubleshoot.items.0':
          '確認手機與電腦在同一個 Wi-Fi 下。',
        'connectionTutorial.troubleshoot.items.1':
          '檢查手機或電腦是否開啟 VPN / 代理。',
        'connectionTutorial.troubleshoot.items.2':
          '仍然無法連接時，改用手動方式完成配對。',
        'connectionTutorial.troubleshoot.supportTitle': '仍然無法解決？',
        'connectionTutorial.troubleshoot.supportBody':
          '請匯出診斷包並開 GitHub issue。',
        'connectionTutorial.troubleshoot.supportIssue': 'GitHub Issues',
      })[key] ?? key,
  }),
}));

jest.mock('../../components/Icon', () => ({
  Icon: ({ name }: { name: string }) => {
    const ReactInner = require('react');
    const { Text } = require('react-native');
    return ReactInner.createElement(Text, null, name);
  },
}));

import { ConnectionTutorialScreen } from '../ConnectionTutorialScreen';

describe('ConnectionTutorialScreen visuals', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('switches between dedicated tutorial visuals for each pairing method', () => {
    const screen = render(<ConnectionTutorialScreen />);

    expect(screen.getByTestId('connection-tutorial-visual-lan')).toBeTruthy();

    fireEvent.press(screen.getByText('掃碼'));
    expect(screen.getByTestId('connection-tutorial-visual-qr')).toBeTruthy();

    fireEvent.press(screen.getByText('連接碼'));
    expect(screen.getByTestId('connection-tutorial-visual-code')).toBeTruthy();

    fireEvent.press(screen.getByText('IP 直連'));
    expect(screen.getByTestId('connection-tutorial-visual-ip')).toBeTruthy();
  });

  it('switches tabs when the tutorial pages are swiped horizontally', () => {
    const screen = render(<ConnectionTutorialScreen />);
    const pages = screen.getByTestId('connection-tutorial-pages');

    fireEvent(pages, 'momentumScrollEnd', {
      nativeEvent: {
        contentOffset: { x: 343 },
        layoutMeasurement: { width: 343 },
      },
    });

    expect(screen.getByText('掃碼').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ color: '#ffffff' })]),
    );

    fireEvent(pages, 'momentumScrollEnd', {
      nativeEvent: {
        contentOffset: { x: 0 },
        layoutMeasurement: { width: 343 },
      },
    });

    expect(screen.getByText('搜尋').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ color: '#ffffff' })]),
    );
  });

  it('keeps each tutorial page the same width as the horizontal paging viewport', () => {
    Dimensions.set({
      window: { width: 375, height: 812, scale: 2, fontScale: 1 },
      screen: { width: 375, height: 812, scale: 2, fontScale: 1 },
    });

    const screen = render(<ConnectionTutorialScreen />);
    const firstPage = screen.getByTestId(
      'connection-tutorial-page-lan',
    ) as unknown as {
      props: { style: ViewStyle };
    };
    const firstPageStyle = StyleSheet.flatten(firstPage.props.style);

    expect(firstPageStyle.width).toBe(375);
  });
});
