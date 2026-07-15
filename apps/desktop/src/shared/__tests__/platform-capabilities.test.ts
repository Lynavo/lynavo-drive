import { describe, expect, it } from 'vitest';
import {
  isLinuxPlatform,
  shouldHideApplicationMenu,
  usesTitleBarOverlayControls,
} from '../platform-capabilities';

describe('platform capabilities', () => {
  it('detects Linux only on Linux', () => {
    expect(isLinuxPlatform('darwin')).toBe(false);
    expect(isLinuxPlatform('win32')).toBe(false);
    expect(isLinuxPlatform('linux')).toBe(true);
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
