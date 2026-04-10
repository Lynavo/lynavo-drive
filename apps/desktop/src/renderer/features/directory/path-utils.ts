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

export function toMediaUrl(absolutePath: string): string {
  const encoded = absolutePath
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  return `media://${encoded}`;
}
