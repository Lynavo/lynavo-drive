import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import * as ReactNative from 'react-native';
import { Modal, Platform, StatusBar } from 'react-native';
import { Path, Rect } from 'react-native-svg';

import { SyncActivityTour } from '../SyncActivityTour';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      key === 'syncActivity.onboarding.next'
        ? `next ${values?.step}/${values?.total}`
        : key,
  }),
}));

jest.mock('../../Icon', () => ({
  Icon: ({ name }: { name: string }) => {
    const ReactInner = require('react');
    const { Text } = require('react-native');
    return ReactInner.createElement(Text, null, name);
  },
}));

describe('SyncActivityTour', () => {
  beforeEach(() => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'ios',
    });
    Object.defineProperty(StatusBar, 'currentHeight', {
      configurable: true,
      value: undefined,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders the dim overlay as an even-odd path with the active target cut out', () => {
    const screen = render(
      <SyncActivityTour
        visible
        onSkip={jest.fn()}
        onFinish={jest.fn()}
        targetLayouts={{
          album: { left: 40, top: 420, width: 140, height: 90 },
        }}
      />,
    );

    const overlayPath = screen
      .UNSAFE_getAllByType(Path)
      .find(node => node.props.testID === 'sync-activity-tour-cutout-overlay');
    const highlight = screen
      .UNSAFE_getAllByType(Rect)
      .find(node => node.props.testID === 'sync-activity-tour-highlight');

    expect(overlayPath).toBeTruthy();
    expect(overlayPath?.props.fillRule).toBe('evenodd');
    expect(overlayPath?.props.d).toContain('M0 0');
    expect(overlayPath?.props.d).toContain('Q28 408');
    expect(overlayPath?.props.d).toContain('Q192 408');
    expect(overlayPath?.props.d).toContain('Q192 522');
    expect(highlight?.props.x).toBe(26.5);
    expect(highlight?.props.y).toBe(406.5);
  });

  it('does not render native dim corner patches inside the cutout', () => {
    const screen = render(
      <SyncActivityTour
        visible
        onSkip={jest.fn()}
        onFinish={jest.fn()}
        targetLayouts={{
          album: { left: 40, top: 420, width: 140, height: 90 },
        }}
      />,
    );

    expect(
      screen.queryByTestId('sync-activity-tour-dim-corner-top-left'),
    ).toBeNull();
    expect(
      screen.queryByTestId('sync-activity-tour-dim-corner-top-right'),
    ).toBeNull();
    expect(
      screen.queryByTestId('sync-activity-tour-dim-corner-bottom-left'),
    ).toBeNull();
    expect(
      screen.queryByTestId('sync-activity-tour-dim-corner-bottom-right'),
    ).toBeNull();
  });

  it('allows the modal to draw under Android system navigation bars', () => {
    const screen = render(
      <SyncActivityTour visible onSkip={jest.fn()} onFinish={jest.fn()} />,
    );

    const modal = screen.UNSAFE_getByType(Modal);

    expect(modal.props.statusBarTranslucent).toBe(true);
    expect(modal.props.navigationBarTranslucent).toBe(true);
  });

  it('aligns measured Android targets to the translucent modal coordinate space', () => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'android',
    });
    Object.defineProperty(StatusBar, 'currentHeight', {
      configurable: true,
      value: 24,
    });

    const screen = render(
      <SyncActivityTour
        visible
        onSkip={jest.fn()}
        onFinish={jest.fn()}
        targetLayouts={{
          album: { left: 40, top: 420, width: 140, height: 90 },
        }}
      />,
    );

    const overlayPath = screen
      .UNSAFE_getAllByType(Path)
      .find(node => node.props.testID === 'sync-activity-tour-cutout-overlay');

    expect(overlayPath?.props.d).toContain('Q28 432');
    expect(overlayPath?.props.d).toContain('Q192 432');
    expect(overlayPath?.props.d).toContain('Q192 546');
  });

  it('falls back to ratio positioning when cold-start measurement is invalid', () => {
    const screen = render(
      <SyncActivityTour
        visible
        onSkip={jest.fn()}
        onFinish={jest.fn()}
        targetLayouts={{
          album: { left: Number.NaN, top: 420, width: 140, height: 90 },
        }}
      />,
    );

    const highlight = screen
      .UNSAFE_getAllByType(Rect)
      .find(node => node.props.testID === 'sync-activity-tour-highlight');

    expect(Number.isFinite(highlight?.props.x)).toBe(true);
    expect(Number.isFinite(highlight?.props.y)).toBe(true);
    expect(Number.isFinite(highlight?.props.width)).toBe(true);
    expect(Number.isFinite(highlight?.props.height)).toBe(true);
  });

  it('uses the modal root layout when cold-start window dimensions are zero', () => {
    jest.spyOn(ReactNative, 'useWindowDimensions').mockReturnValue({
      width: 0,
      height: 0,
      scale: 3,
      fontScale: 1,
    });

    const screen = render(
      <SyncActivityTour visible onSkip={jest.fn()} onFinish={jest.fn()} />,
    );

    fireEvent(screen.getByTestId('sync-activity-tour'), 'layout', {
      nativeEvent: {
        layout: {
          width: 390,
          height: 844,
        },
      },
    });

    const overlayPath = screen
      .UNSAFE_getAllByType(Path)
      .find(node => node.props.testID === 'sync-activity-tour-cutout-overlay');

    expect(overlayPath?.props.d).toContain('H390');
    expect(overlayPath?.props.d).toContain('V844');
  });

  it('falls back to screen dimensions before the modal root layout is ready', () => {
    jest.spyOn(ReactNative, 'useWindowDimensions').mockReturnValue({
      width: 0,
      height: 0,
      scale: 3,
      fontScale: 1,
    });
    jest
      .spyOn(ReactNative.Dimensions, 'get')
      .mockImplementation(dimension =>
        dimension === 'window'
          ? { width: 0, height: 0, scale: 3, fontScale: 1 }
          : { width: 390, height: 844, scale: 3, fontScale: 1 },
      );

    const screen = render(
      <SyncActivityTour visible onSkip={jest.fn()} onFinish={jest.fn()} />,
    );

    const overlayPath = screen
      .UNSAFE_getAllByType(Path)
      .find(node => node.props.testID === 'sync-activity-tour-cutout-overlay');

    expect(overlayPath?.props.d).toContain('H390');
    expect(overlayPath?.props.d).toContain('V844');
  });
});
