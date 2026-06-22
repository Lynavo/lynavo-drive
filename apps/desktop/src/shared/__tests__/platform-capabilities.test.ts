import { describe, expect, it } from 'vitest';
import {
  shouldHideApplicationMenu,
  supportsAppleAuth,
  usesTitleBarOverlayControls,
} from '../platform-capabilities';

describe('platform capabilities', () => {
  it('only enables Apple auth on macOS', () => {
    expect(supportsAppleAuth('darwin')).toBe(true);
    expect(supportsAppleAuth('win32')).toBe(false);
    expect(supportsAppleAuth('linux')).toBe(false);
  });

  it('reserves title bar overlay controls on non-macOS desktop platforms', () => {
    expect(usesTitleBarOverlayControls('darwin')).toBe(false);
    expect(usesTitleBarOverlayControls('win32')).toBe(true);
    expect(usesTitleBarOverlayControls('linux')).toBe(true);
  });

  it('hides the application menu outside macOS custom chrome', () => {
    expect(shouldHideApplicationMenu('darwin')).toBe(false);
    expect(shouldHideApplicationMenu('win32')).toBe(true);
    expect(shouldHideApplicationMenu('linux')).toBe(true);
  });
});
