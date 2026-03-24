import { app, dialog, shell } from 'electron';
import log from 'electron-log';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { sidecarClient } from './sidecar-client';
import type { SidecarManager } from './sidecar-manager';

const execFileAsync = promisify(execFile);

type AppInfo = {
  name: string;
  version: string;
};

type DiagnosticSnapshot = {
  generatedAt: string;
  app: AppInfo & { platform: NodeJS.Platform };
  sidecar: {
    runtimeState: unknown;
    health: unknown;
    settings: unknown;
    dashboardSummary: unknown;
    dashboardDevices: unknown;
    shareStatus: unknown;
  };
  files: {
    desktopLogPath: string | null;
    sidecarDbPath: string | null;
    sidecarDataDir: string;
  };
};

function diagnosticsTimestamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true
  } catch {
    return false
  }
}

async function safeCall<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function getAppInfo(): AppInfo {
  return {
    name: app.getName(),
    version: app.getVersion(),
  };
}

export async function exportDiagnostics(sidecarManager: SidecarManager): Promise<string | null> {
  const timestamp = diagnosticsTimestamp();
  const defaultPath = join(app.getPath('desktop'), `SyncFlow-Diagnostics-${timestamp}.zip`);
  const dialogResult = await dialog.showSaveDialog({
    title: '导出诊断包',
    defaultPath,
    filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
  });
  if (dialogResult.canceled || !dialogResult.filePath) {
    return null;
  }

  const tempRoot = join(tmpdir(), `syncflow-diagnostics-${timestamp}`);
  const bundleDir = join(tempRoot, `SyncFlow-Diagnostics-${timestamp}`);
  const filesDir = join(bundleDir, 'files');
  const sidecarDataDir = join(homedir(), 'Library', 'Application Support', 'SyncFlow');
  const sidecarDbPath = join(sidecarDataDir, 'sidecar.db');
  const desktopLogPath = log.transports.file.getFile().path;

  await rm(tempRoot, { recursive: true, force: true });
  await mkdir(filesDir, { recursive: true });

  const appInfo = getAppInfo();
  const snapshot: DiagnosticSnapshot = {
    generatedAt: new Date().toISOString(),
    app: {
      ...appInfo,
      platform: process.platform,
    },
    sidecar: {
      runtimeState: sidecarManager.getState(),
      health: await safeCall(() => sidecarClient.getHealth()),
      settings: await safeCall(() => sidecarClient.getSettings()),
      dashboardSummary: await safeCall(() => sidecarClient.getDashboardSummary()),
      dashboardDevices: await safeCall(() => sidecarClient.getDashboardDevices()),
      shareStatus: await safeCall(() => sidecarClient.getShareStatus()),
    },
    files: {
      desktopLogPath: (await exists(desktopLogPath)) ? desktopLogPath : null,
      sidecarDbPath: (await exists(sidecarDbPath)) ? sidecarDbPath : null,
      sidecarDataDir,
    },
  };

  await writeFile(join(bundleDir, 'diagnostics.json'), JSON.stringify(snapshot, null, 2), 'utf8');
  await writeFile(
    join(bundleDir, 'README.txt'),
    [
      'SyncFlow 诊断包',
      '',
      '包含内容：',
      '- diagnostics.json：版本、运行时状态、dashboard、设置、共享状态',
      '- files/desktop-main.log：桌面端主进程日志（含 sidecar stdout/stderr）',
      '- files/sidecar.db：sidecar 数据库快照（如存在）',
      '',
      '请将整个 ZIP 提供给开发团队进行排查。',
      '',
    ].join('\n'),
    'utf8',
  );

  if (await exists(desktopLogPath)) {
    await copyFile(desktopLogPath, join(filesDir, 'desktop-main.log'));
  }
  if (await exists(sidecarDbPath)) {
    await copyFile(sidecarDbPath, join(filesDir, 'sidecar.db'));
  }

  await execFileAsync('ditto', [
    '-c',
    '-k',
    '--sequesterRsrc',
    '--keepParent',
    bundleDir,
    dialogResult.filePath,
  ]);
  await rm(tempRoot, { recursive: true, force: true });
  shell.showItemInFolder(dialogResult.filePath);
  return dialogResult.filePath;
}
