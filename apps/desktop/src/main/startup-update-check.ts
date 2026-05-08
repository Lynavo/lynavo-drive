import { app, dialog, shell, type BrowserWindow, type MessageBoxOptions } from 'electron';
import log from 'electron-log';
import { checkForUpdates, type UpdateCheckResult } from './diagnostics';
import { getMainStrings } from '../shared/main-i18n';
import { resolveLocale } from '../shared/locale';

type WindowProvider = () => BrowserWindow | null;

function interpolate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => values[key] ?? '');
}

function updateDetail(result: UpdateCheckResult): string | undefined {
  const strings = getMainStrings(resolveLocale([app.getLocale()]));
  const lines: string[] = [];

  if (result.minimumRequired) {
    lines.push(strings.updates.minimumRequired);
  }
  const releaseNotes = result.releaseNotes?.trim();
  if (releaseNotes) {
    lines.push(`${strings.updates.releaseNotes}: ${releaseNotes}`);
  }

  return lines.length > 0 ? lines.join('\n\n') : undefined;
}

async function showUpdatePrompt(
  getWindow: WindowProvider,
  options: MessageBoxOptions,
): Promise<Electron.MessageBoxReturnValue> {
  const window = getWindow();
  if (window && !window.isDestroyed()) {
    return dialog.showMessageBox(window, options);
  }
  return dialog.showMessageBox(options);
}

export async function checkForUpdatesOnStartup(getWindow: WindowProvider): Promise<void> {
  try {
    const result = await checkForUpdates();
    if (!result.updateAvailable) return;

    const strings = getMainStrings(resolveLocale([app.getLocale()]));
    const hasDownload = Boolean(result.downloadUrl);
    const prompt = await showUpdatePrompt(getWindow, {
      type: result.minimumRequired ? 'warning' : 'info',
      title: strings.updates.title,
      message: interpolate(strings.updates.message, { version: result.latestVersion }),
      detail: updateDetail(result),
      buttons: hasDownload
        ? [strings.updates.openDownload, strings.updates.later]
        : [strings.updates.ok],
      defaultId: 0,
      cancelId: hasDownload ? 1 : 0,
      noLink: true,
    });

    if (hasDownload && prompt.response === 0) {
      await shell.openExternal(result.downloadUrl!);
    }
  } catch (error) {
    log.warn('Startup update check failed', error instanceof Error ? error.message : String(error));
  }
}
