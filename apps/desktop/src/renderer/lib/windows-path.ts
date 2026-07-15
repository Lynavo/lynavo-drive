export function isWindowsDriveRootPath(path: string): boolean {
  return /^[A-Za-z]:[\\/]+$/.test(path.trim());
}
