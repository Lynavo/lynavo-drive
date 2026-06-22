export function supportsAppleAuth(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'darwin';
}

export function usesTitleBarOverlayControls(platform: NodeJS.Platform = process.platform): boolean {
  return platform !== 'darwin';
}

export function shouldHideApplicationMenu(platform: NodeJS.Platform = process.platform): boolean {
  return platform !== 'darwin';
}
