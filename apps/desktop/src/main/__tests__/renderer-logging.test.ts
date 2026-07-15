import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import log from 'electron-log';
import type { BrowserWindow } from 'electron';
import { attachRendererLogging } from '../renderer-logging';

vi.mock('electron-log', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

class FakeWindow extends EventEmitter {
  webContents = new EventEmitter();
}

describe('attachRendererLogging', () => {
  it('forwards renderer console warnings and crashes to electron-log', () => {
    const window = new FakeWindow() as unknown as BrowserWindow;

    attachRendererLogging(window);

    window.webContents.emit('console-message', {}, 2, 'network retry failed', 17, 'app.js');
    window.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 139 });
    window.emit('unresponsive');
    window.emit('responsive');

    expect(log.warn).toHaveBeenCalledWith('[renderer:warn] network retry failed (app.js:17)');
    expect(log.error).toHaveBeenCalledWith('[renderer] render process gone', {
      reason: 'crashed',
      exitCode: 139,
    });
    expect(log.warn).toHaveBeenCalledWith('[renderer] window unresponsive');
    expect(log.info).toHaveBeenCalledWith('[renderer] window responsive');
  });
});
