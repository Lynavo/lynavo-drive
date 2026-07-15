function isAbsolutePath(path: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(path);
}

export function resolveAbsolutePath(basePath: string, targetPath: string): string {
  if (!targetPath) {
    return '';
  }
  if (!basePath || isAbsolutePath(targetPath)) {
    return targetPath;
  }

  const separator = basePath.includes('\\') ? '\\' : '/';
  const normalizedBase = basePath.replace(/[\\/]+$/, '');
  const normalizedTarget = targetPath
    .replace(/[\\/]+/g, separator)
    .replace(separator === '\\' ? /^\\+/ : /^\/+/, '');

  return `${normalizedBase}${separator}${normalizedTarget}`;
}
