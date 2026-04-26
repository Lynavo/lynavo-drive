import { app, dialog, shell } from 'electron';
import log from 'electron-log';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { networkInterfaces, release, tmpdir, type } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { sidecarClient } from './sidecar-client';
import type { SidecarManager } from './sidecar-manager';

const execFileAsync = promisify(execFile);

type AppInfo = {
  name: string;
  version: string;
  buildNumber: string;
};

type EnvironmentSnapshot = {
  os: {
    platform: NodeJS.Platform;
    type: string;
    release: string;
    arch: string;
  };
  wifi: {
    ssid: string | null;
    bssid: string | null;
    source: string;
    error?: string;
  };
  networkInterfaces: Array<{
    name: string;
    addresses: Array<{
      family: string;
      address: string;
      cidr: string | null;
      mac: string;
      internal: boolean;
    }>;
  }>;
};

type DiagnosticSnapshot = {
  generatedAt: string;
  app: AppInfo & { platform: NodeJS.Platform };
  environment: EnvironmentSnapshot;
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
    sidecarLogFiles: string[];
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
    return true;
  } catch {
    return false;
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

/**
 * Returns the current WiFi SSID/BSSID. This is the single most useful
 * piece of environment context when triaging "my sync broke" reports
 * from laptop users — operators need to see which network the machine
 * was on when the bundle was captured.
 *
 * macOS: `networksetup -getairportnetwork <iface>` (iface defaults to en0)
 * Windows: `netsh wlan show interfaces`
 * Linux / unsupported: returns { ssid: null, source: 'unsupported' }
 */
async function detectWiFiIdentity(): Promise<EnvironmentSnapshot['wifi']> {
  if (process.platform === 'darwin') {
    // networksetup only prints SSID, so we additionally inspect the BSSID
    // via `ioreg` or `wdutil info` when available. Kept best-effort to
    // avoid failing the whole diagnostic bundle on quirky systems.
    for (const iface of ['en0', 'en1']) {
      try {
        const { stdout } = await execFileAsync('/usr/sbin/networksetup', [
          '-getairportnetwork',
          iface,
        ]);
        const match = stdout.match(/Current Wi-Fi Network: (.+)/);
        if (match?.[1]) {
          return { ssid: match[1].trim(), bssid: null, source: `networksetup:${iface}` };
        }
      } catch {
        // try the next interface
      }
    }
    return { ssid: null, bssid: null, source: 'networksetup:no-match' };
  }

  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync('netsh', ['wlan', 'show', 'interfaces']);
      const ssid = stdout.match(/^\s*SSID\s*:\s*(.+)$/m)?.[1]?.trim() ?? null;
      const bssid = stdout.match(/^\s*BSSID\s*:\s*(.+)$/m)?.[1]?.trim() ?? null;
      return { ssid, bssid, source: 'netsh' };
    } catch (error) {
      return {
        ssid: null,
        bssid: null,
        source: 'netsh',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return { ssid: null, bssid: null, source: 'unsupported' };
}

function summarizeNetworkInterfaces(): EnvironmentSnapshot['networkInterfaces'] {
  const raw = networkInterfaces();
  return Object.entries(raw).map(([name, addrs]) => ({
    name,
    addresses: (addrs ?? []).map((a) => ({
      family: a.family,
      address: a.address,
      cidr: a.cidr,
      mac: a.mac,
      internal: a.internal,
    })),
  }));
}

async function captureEnvironmentSnapshot(): Promise<EnvironmentSnapshot> {
  return {
    os: {
      platform: process.platform,
      type: type(),
      release: release(),
      arch: process.arch,
    },
    wifi: await detectWiFiIdentity(),
    networkInterfaces: summarizeNetworkInterfaces(),
  };
}

/**
 * Enumerates the sidecar log files produced by the in-process rotation
 * (sidecar.log + sidecar.log.1..N). Returns absolute paths that exist on
 * disk, sorted newest-first so the primary file is first.
 */
async function listSidecarLogFiles(sidecarDataDir: string): Promise<string[]> {
  const logsDir = join(sidecarDataDir, 'logs');
  try {
    const entries = await readdir(logsDir);
    const candidates = entries
      .filter((name) => name === 'sidecar.log' || /^sidecar\.log\.\d+$/.test(name))
      .sort((a, b) => {
        // sidecar.log first, then .1, .2, ... (older)
        if (a === 'sidecar.log') return -1;
        if (b === 'sidecar.log') return 1;
        const ai = parseInt(a.split('.').pop() ?? '0', 10);
        const bi = parseInt(b.split('.').pop() ?? '0', 10);
        return ai - bi;
      })
      .map((name) => join(logsDir, name));

    const present: string[] = [];
    for (const p of candidates) {
      if (await exists(p)) present.push(p);
    }
    return present;
  } catch {
    return [];
  }
}

export function getAppInfo(): AppInfo {
  const buildNumber = resolveBuildNumber();
  return {
    name: app.getName(),
    version: app.getVersion(),
    buildNumber,
  };
}

function resolveBuildNumber(): string {
  const fallback = '';
  const packagedPackageJson = join(app.getAppPath(), 'package.json');
  const repoProject = join(
    process.cwd(),
    'apps',
    'mobile',
    'ios',
    'SyncFlowMobile.xcodeproj',
    'project.pbxproj',
  );

  try {
    const packaged = require(packagedPackageJson) as { syncflowBuildNumber?: string };
    if (packaged.syncflowBuildNumber) return packaged.syncflowBuildNumber;
  } catch {
    // Fall through to repo build settings in development.
  }

  try {
    const project = require('node:fs').readFileSync(repoProject, 'utf8') as string;
    const match = project.match(/CURRENT_PROJECT_VERSION = (\d+);/);
    return match?.[1] ?? fallback;
  } catch {
    return fallback;
  }
}

export async function exportDiagnostics(sidecarManager: SidecarManager): Promise<string | null> {
  const timestamp = diagnosticsTimestamp();
  const defaultPath = join(app.getPath('desktop'), `Vivi Drop-诊断包-${timestamp}.zip`);
  const dialogResult = await dialog.showSaveDialog({
    title: '导出诊断包',
    defaultPath,
    filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
  });
  if (dialogResult.canceled || !dialogResult.filePath) {
    return null;
  }

  const tempRoot = join(tmpdir(), `syncflow-diagnostics-${timestamp}`);
  const bundleDir = join(tempRoot, `Vivi Drop-诊断包-${timestamp}`);
  const filesDir = join(bundleDir, 'files');
  const sidecarDataDir = app.getPath('userData');
  const sidecarDbPath = join(sidecarDataDir, 'sidecar.db');
  const desktopLogPath = log.transports.file.getFile().path;

  await rm(tempRoot, { recursive: true, force: true });
  await mkdir(filesDir, { recursive: true });

  const appInfo = getAppInfo();
  const sidecarLogFiles = await listSidecarLogFiles(sidecarDataDir);
  const environment = await captureEnvironmentSnapshot();
  const snapshot: DiagnosticSnapshot = {
    generatedAt: new Date().toISOString(),
    app: {
      ...appInfo,
      platform: process.platform,
    },
    environment,
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
      sidecarLogFiles,
    },
  };

  await writeFile(join(bundleDir, 'diagnostics.json'), JSON.stringify(snapshot, null, 2), 'utf8');
  await writeFile(
    join(bundleDir, 'README.txt'),
    [
      'Vivi Drop 诊断包',
      '',
      '包含内容：',
      '- diagnostics.json：版本、运行时状态、dashboard、设置、共享状态、网络环境（WiFi SSID、网卡列表）',
      '- files/desktop-main.log：桌面端主进程日志（含 sidecar stdout/stderr）',
      '- files/sidecar.log(.N)：sidecar 进程日志（含 mDNS、连线、断线、IP 切换事件）',
      '- files/sidecar.db：sidecar 数据库快照（如存在）',
      '',
      '排障顺序建议：',
      '1. 先看 diagnostics.json 的 environment.wifi 确认当时连的是哪个 WiFi',
      '2. 再看 sidecar.log 中 "local IP changed" / "tcp client disconnected" 事件',
      '3. 若涉及 UI / 状态问题，最后看 desktop-main.log',
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
  // Copy every rotated sidecar log file so the bundle retains history
  // across size-based rotations. Names preserved so .1/.2 ordering is
  // obvious when the receiver opens the ZIP.
  for (const logPath of sidecarLogFiles) {
    const baseName = logPath.split(/[/\\]/).pop() ?? 'sidecar.log';
    await copyFile(logPath, join(filesDir, baseName));
  }

  if (process.platform === 'win32') {
    await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path '${bundleDir.replace(/'/g, "''")}\\*' -DestinationPath '${dialogResult.filePath.replace(/'/g, "''")}' -Force`,
    ]);
  } else {
    await execFileAsync('ditto', [
      '-c',
      '-k',
      '--sequesterRsrc',
      '--keepParent',
      bundleDir,
      dialogResult.filePath,
    ]);
  }
  await rm(tempRoot, { recursive: true, force: true });
  shell.showItemInFolder(dialogResult.filePath);
  return dialogResult.filePath;
}
