import { readdir as fsReaddir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import log from 'electron-log';

const PROTECTED_FOLDER_NAMES = ['Desktop', 'Documents', 'Downloads'] as const;

type Readdir = (path: string, options: { withFileTypes: true }) => Promise<unknown[]>;

interface StartupPermissionLogger {
  info(message: string): void;
  warn(message: string, error: unknown): void;
}

export interface MacFilesAndFoldersPermissionOptions {
  platform?: NodeJS.Platform;
  homeDirectory?: string;
  readdir?: Readdir;
  logger?: StartupPermissionLogger;
}

async function readDirectory(path: string, options: { withFileTypes: true }): Promise<unknown[]> {
  return fsReaddir(path, options);
}

export async function requestMacFilesAndFoldersPermissionsOnStartup(
  options: MacFilesAndFoldersPermissionOptions = {},
): Promise<void> {
  const platform = options.platform ?? process.platform;
  if (platform !== 'darwin') {
    return;
  }

  const homeDirectory = options.homeDirectory ?? homedir();
  const readdir = options.readdir ?? readDirectory;
  const logger = options.logger ?? log;

  for (const folderName of PROTECTED_FOLDER_NAMES) {
    const folderPath = join(homeDirectory, folderName);
    try {
      await readdir(folderPath, { withFileTypes: true });
    } catch (error) {
      logger.warn(
        `[Permissions] macOS Files and Folders access probe failed for ${folderName}`,
        error,
      );
    }
  }

  logger.info(
    '[Permissions] requested macOS Files and Folders access for Desktop, Documents, Downloads',
  );
}
