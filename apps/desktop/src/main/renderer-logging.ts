import type { BrowserWindow } from 'electron';
import log from 'electron-log';

function rendererLogLevel(level: number): 'debug' | 'info' | 'warn' | 'error' {
  if (level >= 3) return 'error';
  if (level === 2) return 'warn';
  if (level === 1) return 'info';
  return 'debug';
}

function rendererSource(sourceId: string, line: number): string {
  if (sourceId) {
    return `${sourceId}:${line}`;
  }
  return `line ${line}`;
}

export function attachRendererLogging(window: BrowserWindow): void {
  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const target = rendererLogLevel(level);
    log[target](`[renderer:${target}] ${message} (${rendererSource(sourceId, line)})`);
  });

  window.webContents.on('render-process-gone', (_event, details) => {
    log.error('[renderer] render process gone', details);
  });

  window.on('unresponsive', () => {
    log.warn('[renderer] window unresponsive');
  });

  window.on('responsive', () => {
    log.info('[renderer] window responsive');
  });
}
