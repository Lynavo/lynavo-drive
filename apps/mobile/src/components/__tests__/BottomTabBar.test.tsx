import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { BottomTabBar } from '../BottomTabBar';

const mockDispatch = jest.fn();
const mockReset = jest.fn((payload: unknown) => ({
  type: 'RESET',
  payload,
}));
let mockInsets = { top: 0, bottom: 34, left: 0, right: 0 };

jest.mock('@react-navigation/native', () => ({
  CommonActions: {
    reset: (payload: unknown) => mockReset(payload),
  },
  useNavigation: () => ({
    dispatch: mockDispatch,
  }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

jest.mock('lucide-react-native', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');
  const createIcon =
    (fallbackTestID: string) =>
    ({ testID, ...props }: { testID?: string }) =>
      ReactModule.createElement(View, {
        testID: testID ?? fallbackTestID,
        ...props,
      });
  return {
    FolderOpen: createIcon('mock-folder-open-icon'),
    Home: createIcon('mock-home-icon'),
    User: createIcon('mock-user-icon'),
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => mockInsets,
}));

describe('BottomTabBar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInsets = { top: 0, bottom: 34, left: 0, right: 0 };
  });

  test('uses the reference in-flow bottom spacing without a filled strip', () => {
    const { getByTestId } = render(<BottomTabBar activeTab="home" />);

    const outerStyle = StyleSheet.flatten(
      getByTestId('bottom-tab-bar-outer').props.style,
    );
    const containerStyle = StyleSheet.flatten(
      getByTestId('bottom-tab-bar-container').props.style,
    );

    expect(outerStyle.position).toBeUndefined();
    expect(outerStyle.left).toBeUndefined();
    expect(outerStyle.right).toBeUndefined();
    expect(outerStyle.bottom).toBeUndefined();
    expect(outerStyle.marginHorizontal).toBe(16);
    expect(outerStyle.marginBottom).toBe(16);
    expect(outerStyle.flexShrink).toBe(0);
    expect(outerStyle.paddingTop).toBeUndefined();
    expect(outerStyle.paddingBottom).toBeUndefined();
    expect(outerStyle.backgroundColor).toBe('transparent');
    expect(containerStyle.borderRadius).toBe(22);
    expect(containerStyle.backgroundColor).toBe('#F7FBFF');
    expect(containerStyle.borderColor).toBe('#FFFFFF');
  });

  test('matches the reference active pill styling', () => {
    const { getByTestId } = render(<BottomTabBar activeTab="home" />);

    const activeTabStyle = StyleSheet.flatten(
      getByTestId('bottom-tab-home').props.style,
    );
    const inactiveTabStyle = StyleSheet.flatten(
      getByTestId('bottom-tab-files').props.style,
    );

    expect(activeTabStyle.minHeight).toBe(54);
    expect(activeTabStyle.borderRadius).toBe(17);
    expect(activeTabStyle.backgroundColor).toBe('#FFFFFF');
    expect(activeTabStyle.shadowOpacity).toBeGreaterThan(0);
    expect(inactiveTabStyle.backgroundColor).toBeUndefined();
  });

  test('uses lucide icons that match the reference tab bar', () => {
    const { getByTestId } = render(<BottomTabBar activeTab="home" />);

    expect(getByTestId('bottom-tab-home-icon')).toBeTruthy();
    expect(getByTestId('bottom-tab-files-icon')).toBeTruthy();
    expect(getByTestId('bottom-tab-settings-icon')).toBeTruthy();
    expect(getByTestId('bottom-tab-home-icon').props.strokeWidth).toBe(2.2);
    expect(getByTestId('bottom-tab-files-icon').props.strokeWidth).toBe(1.9);
  });

  test('switches tabs inside the main tab shell without resetting navigation', () => {
    const onTabPress = jest.fn();
    const { getByTestId } = render(
      <BottomTabBar activeTab="home" onTabPress={onTabPress} />,
    );

    fireEvent.press(getByTestId('bottom-tab-files'));

    expect(onTabPress).toHaveBeenCalledWith('files');
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});
