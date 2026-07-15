import type { BrowserWindowConstructorOptions, TitleBarOverlayOptions } from 'electron';
import { usesTitleBarOverlayControls } from '../shared/platform-capabilities';

type WorkAreaSize = {
  width: number;
  height: number;
};

const DEFAULT_MAIN_WINDOW_WIDTH = 1200;
const DEFAULT_MAIN_WINDOW_HEIGHT = 800;
const MIN_MAIN_WINDOW_WIDTH = 960;
const MIN_MAIN_WINDOW_HEIGHT = 640;
const TITLE_BAR_OVERLAY_HEIGHT = 44;
const DEFAULT_TITLE_BAR_OVERLAY: TitleBarOverlayOptions = {
  color: '#f7fbff',
  symbolColor: '#4f5b68',
  height: TITLE_BAR_OVERLAY_HEIGHT,
};
const MODAL_TITLE_BAR_OVERLAY: TitleBarOverlayOptions = {
  color: '#7b7f82',
  symbolColor: '#eef4fa',
  height: TITLE_BAR_OVERLAY_HEIGHT,
};

export function getTitleBarOverlayOptions(modalActive = false): TitleBarOverlayOptions {
  return modalActive ? MODAL_TITLE_BAR_OVERLAY : DEFAULT_TITLE_BAR_OVERLAY;
}

export function getMainWindowChromeOptions(
  platform: NodeJS.Platform = process.platform,
): Pick<BrowserWindowConstructorOptions, 'autoHideMenuBar' | 'titleBarOverlay' | 'titleBarStyle'> {
  if (platform === 'darwin') {
    return {
      titleBarStyle: 'hiddenInset',
    };
  }

  if (usesTitleBarOverlayControls(platform)) {
    return {
      autoHideMenuBar: true,
      titleBarStyle: 'hidden',
      titleBarOverlay: getTitleBarOverlayOptions(false),
    };
  }

  return {};
}

export function getMainWindowSizeOptions(
  workAreaSize: WorkAreaSize,
): Pick<BrowserWindowConstructorOptions, 'height' | 'minHeight' | 'minWidth' | 'width'> {
  const minWidth = Math.min(MIN_MAIN_WINDOW_WIDTH, workAreaSize.width);
  const minHeight = Math.min(MIN_MAIN_WINDOW_HEIGHT, workAreaSize.height);

  return {
    width: Math.max(minWidth, Math.min(DEFAULT_MAIN_WINDOW_WIDTH, workAreaSize.width)),
    height: Math.max(minHeight, Math.min(DEFAULT_MAIN_WINDOW_HEIGHT, workAreaSize.height)),
    minWidth,
    minHeight,
  };
}
