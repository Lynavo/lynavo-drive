import { shell, dialog, clipboard } from 'electron';

export async function openFolder(path: string): Promise<void> {
  const error = await shell.openPath(path);
  if (error) throw new Error(error);
}

export async function openFile(path: string): Promise<void> {
  const error = await shell.openPath(path);
  if (error) throw new Error(error);
}

export async function openExternal(target: string): Promise<void> {
  await shell.openExternal(target);
}

export async function selectFolder(): Promise<string | null> {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0] ?? null;
}

export async function selectFile(): Promise<string | null> {
  const result = await dialog.showOpenDialog({ properties: ['openFile'] });
  return result.canceled ? null : result.filePaths[0] ?? null;
}

export function copyToClipboard(text: string): void {
  clipboard.writeText(text);
}
