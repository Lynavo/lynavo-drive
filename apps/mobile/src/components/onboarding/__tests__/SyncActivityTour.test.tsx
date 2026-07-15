import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import * as ReactNative from 'react-native';
import { Modal, Platform } from 'react-native';

import {
  convertWindowTargetToOverlayTarget,
  SyncActivityTour,
} from '../SyncActivityTour';

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
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses the static guide background on iOS instead of the SVG cutout overlay', () => {
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

    expect(screen.getByTestId('sync-activity-tour-background')).toBeTruthy();
    expect(
      screen.queryByTestId('sync-activity-tour-cutout-overlay'),
    ).toBeNull();
    expect(screen.queryByTestId('sync-activity-tour-highlight')).toBeNull();
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
      <SyncActivityTour
        visible
        onSkip={jest.fn()}
        onFinish={jest.fn()}
        targetFallbackMode="ratio"
      />,
    );

    const getByType = screen.UNSAFE_getByType as (type: unknown) => {
      props: Record<string, unknown>;
    };
    const modal = getByType(Modal);

    expect(modal.props.statusBarTranslucent).toBe(true);
    expect(modal.props.navigationBarTranslucent).toBe(true);
  });

  it('uses the static Android guide background without status bar heuristics', () => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'android',
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

    expect(screen.getByTestId('sync-activity-tour-background')).toBeTruthy();
    expect(
      screen.queryByTestId('sync-activity-tour-cutout-overlay'),
    ).toBeNull();
  });

  it('does not depend on Android version for the guide background', () => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'android',
    });
    Object.defineProperty(Platform, 'Version', {
      configurable: true,
      value: 35,
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

    expect(screen.getByTestId('sync-activity-tour-background')).toBeTruthy();
  });

  it('does not depend on Android window and screen height differences for the guide background', () => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'android',
    });
    Object.defineProperty(Platform, 'Version', {
      configurable: true,
      value: 35,
    });
    jest
      .spyOn(ReactNative.Dimensions, 'get')
      .mockImplementation(dimension =>
        dimension === 'window'
          ? { width: 390, height: 820, scale: 3, fontScale: 1 }
          : { width: 390, height: 844, scale: 3, fontScale: 1 },
      );

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

    expect(screen.getByTestId('sync-activity-tour-background')).toBeTruthy();
  });

  it('converts window-measured target coordinates into modal-local coordinates', () => {
    expect(
      convertWindowTargetToOverlayTarget(
        { left: 40, top: 420, width: 140, height: 90 },
        { left: 8, top: 24 },
      ),
    ).toEqual({ left: 32, top: 396, width: 140, height: 90 });
  });

  it('renders the static guide background when cold-start measurement is invalid', () => {
    const screen = render(
      <SyncActivityTour
        visible
        onSkip={jest.fn()}
        onFinish={jest.fn()}
        targetFallbackMode="ratio"
        targetLayouts={{
          album: { left: Number.NaN, top: 420, width: 140, height: 90 },
        }}
      />,
    );

    expect(screen.getByTestId('sync-activity-tour-background')).toBeTruthy();
    expect(
      screen.queryByTestId('sync-activity-tour-cutout-overlay'),
    ).toBeNull();
  });

  it('stays hidden until the active target has a live measurement when requested', () => {
    const screen = render(
      <SyncActivityTour
        visible
        onSkip={jest.fn()}
        onFinish={jest.fn()}
        targetFallbackMode="hiddenUntilMeasured"
      />,
    );

    expect(screen.queryByTestId('sync-activity-tour')).toBeNull();
  });

  it('uses the modal root layout when cold-start window dimensions are zero', () => {
    jest.spyOn(ReactNative, 'useWindowDimensions').mockReturnValue({
      width: 0,
      height: 0,
      scale: 3,
      fontScale: 1,
    });

    const screen = render(
      <SyncActivityTour
        visible
        onSkip={jest.fn()}
        onFinish={jest.fn()}
        targetFallbackMode="ratio"
      />,
    );

    fireEvent(screen.getByTestId('sync-activity-tour'), 'layout', {
      nativeEvent: {
        layout: {
          width: 390,
          height: 844,
        },
      },
    });

    const backgroundStyle = ReactNative.StyleSheet.flatten(
      screen.getByTestId('sync-activity-tour-background').props.style,
    );

    expect(backgroundStyle.width).toBe(390);
    expect(backgroundStyle.height).toBeCloseTo((390 * 1710) / 790, 3);
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
      <SyncActivityTour
        visible
        onSkip={jest.fn()}
        onFinish={jest.fn()}
        targetFallbackMode="ratio"
      />,
    );

    const backgroundStyle = ReactNative.StyleSheet.flatten(
      screen.getByTestId('sync-activity-tour-background').props.style,
    );

    expect(backgroundStyle.width).toBe(390);
    expect(backgroundStyle.height).toBeCloseTo((390 * 1710) / 790, 3);
  });
});
