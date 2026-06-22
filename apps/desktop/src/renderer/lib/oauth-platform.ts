export function shouldShowAppleOAuth(
  platform: Window['electronAPI']['platform'] | undefined,
): boolean {
  return platform?.supportsAppleAuth?.() ?? platform?.isMac?.() ?? false;
}
