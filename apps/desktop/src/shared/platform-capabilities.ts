export function isLinuxPlatform(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'linux';
}

export function usesTitleBarOverlayControls(platform: NodeJS.Platform = process.platform): boolean {
  return platform !== 'darwin';
}

export function shouldHideApplicationMenu(platform: NodeJS.Platform = process.platform): boolean {
  return platform !== 'darwin';
}
