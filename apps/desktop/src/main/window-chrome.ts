import type { BrowserWindowConstructorOptions } from 'electron';
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
      titleBarOverlay: {
        color: '#f7fbff',
        symbolColor: '#4f5b68',
        height: TITLE_BAR_OVERLAY_HEIGHT,
      },
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
