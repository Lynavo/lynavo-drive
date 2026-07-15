import { describe, expect, it } from 'vitest';
import {
  getMainWindowChromeOptions,
  getMainWindowSizeOptions,
  getTitleBarOverlayOptions,
} from '../window-chrome';

describe('getMainWindowChromeOptions', () => {
  it('keeps the existing macOS hidden inset title bar', () => {
    expect(getMainWindowChromeOptions('darwin')).toEqual({
      titleBarStyle: 'hiddenInset',
    });
  });

  it('hides the non-macOS menu/title bar while preserving native window buttons', () => {
    expect(getMainWindowChromeOptions('win32')).toEqual({
      autoHideMenuBar: true,
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#f7fbff',
        symbolColor: '#4f5b68',
        height: 44,
      },
    });
  });

  it('uses the same non-macOS chrome treatment on Linux', () => {
    expect(getMainWindowChromeOptions('linux')).toEqual({
      autoHideMenuBar: true,
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#f7fbff',
        symbolColor: '#4f5b68',
        height: 44,
      },
    });
  });

  it('provides a dimmed title bar overlay for modal states', () => {
    expect(getTitleBarOverlayOptions(true)).toEqual({
      color: '#7b7f82',
      symbolColor: '#eef4fa',
      height: 44,
    });
  });
});

describe('getMainWindowSizeOptions', () => {
  it('uses the full design size when the display can fit it', () => {
    expect(getMainWindowSizeOptions({ width: 1440, height: 900 })).toEqual({
      width: 1200,
      height: 800,
      minWidth: 960,
      minHeight: 640,
    });
  });

  it('fits the initial window inside a small UTM display work area', () => {
    expect(getMainWindowSizeOptions({ width: 1024, height: 728 })).toEqual({
      width: 1024,
      height: 728,
      minWidth: 960,
      minHeight: 640,
    });
  });
});
