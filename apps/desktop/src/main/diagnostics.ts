import { app, dialog, shell } from 'electron';
import log from 'electron-log';
import { execFile, type ExecFileOptions } from 'node:child_process';
import { copyFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { hostname, networkInterfaces, release, tmpdir, type } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { getAppInfo, type AppInfo } from './app-info';
import { sidecarClient } from './sidecar-client';
import type { SidecarManager } from './sidecar-manager';
import { getMainStrings } from '../shared/main-i18n';

const execFileAsync = promisify(execFile);
const DIAGNOSTICS_LOG_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const MACOS_POWER_LOG_MAX_BUFFER_BYTES = 2 * 1024 * 1024;
const MACOS_POWER_LOG_TIMEOUT_MS = 1_500;

export { getAppInfo } from './app-info';

type EnvironmentSnapshot = {
  os: {
    platform: NodeJS.Platform;
    type: string;
    release: string;
    arch: string;
    hostname: string;
    locale: string | null;
    timeZone: string | null;
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
  issue: {
    description: string | null;
  };
  app: AppInfo & { build: string; platform: NodeJS.Platform };
  process: {
    pid: number;
    cwd: string;
    execPath: string;
    packaged: boolean;
    electron: string | null;
    chrome: string | null;
    node: string;
    v8: string | null;
  };
  device: {
    model: string;
    osVersion: string;
  };
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
    desktopLogFiles: string[];
    powerLog: PowerDiagnosticsResult | null;
    sidecarDbPath: string | null;
    sidecarDataDir: string;
    sidecarLogFiles: string[];
  };
  paths: {
    userData: string;
    logs: string[];
    sidecarDbPath: string | null;
  };
};

type CommandRunner = (
  file: string,
  args?: readonly string[],
  options?: ExecFileOptions,
) => Promise<{ stdout: string; stderr: string }>;

type PowerDiagnosticsOptions = {
  platform?: NodeJS.Platform;
  runCommand?: CommandRunner;
  now?: Date;
};

type CompressBundleOptions = {
  platform?: NodeJS.Platform;
  runCommand?: CommandRunner;
};

export type PowerDiagnosticsResult = {
  path: string;
  source: string;
  error?: string;
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

async function isRecentDiagnosticLog(path: string, now = Date.now()): Promise<boolean> {
  try {
    const info = await stat(path);
    return now - info.mtimeMs <= DIAGNOSTICS_LOG_MAX_AGE_MS;
  } catch {
    return false;
  }
}

async function copyDiagnosticLogFile(sourcePath: string, destinationPath: string): Promise<void> {
  await copyFile(sourcePath, destinationPath);
}

async function copyDiagnosticDatabase(sourcePath: string, destinationPath: string): Promise<void> {
  if (!(await exists(sourcePath))) return;
  await copyFile(sourcePath, destinationPath);
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

function filterMacosPowerLog(stdout: string): string {
  return stdout
    .split(/\r?\n/)
    .filter((line) => /\b(?:Sleep|Wake|DarkWake|Standby|Hibernate)\b|Wake reason/i.test(line))
    .join('\n');
}

function macosPowerLogCommand(): string {
  return [
    '/usr/bin/pmset -g log',
    "/usr/bin/grep -Ei 'Sleep|Wake|DarkWake|Standby|Hibernate|Wake reason'",
    '/usr/bin/tail -n 300',
  ].join(' | ');
}

export async function writePowerDiagnostics(
  filesDir: string,
  options: PowerDiagnosticsOptions = {},
): Promise<PowerDiagnosticsResult | null> {
  const platform = options.platform ?? process.platform;
  if (platform !== 'darwin') {
    return null;
  }

  const collectedAt = (options.now ?? new Date()).toISOString();
  const targetPath = join(filesDir, 'macos-power.log');
  const runCommand = options.runCommand ?? execFileAsync;

  try {
    const { stdout, stderr } = await runCommand('/bin/sh', ['-c', macosPowerLogCommand()], {
      maxBuffer: MACOS_POWER_LOG_MAX_BUFFER_BYTES,
      timeout: MACOS_POWER_LOG_TIMEOUT_MS,
    });
    const filtered = filterMacosPowerLog(stdout);
    await writeFile(
      targetPath,
      [
        'Lynavo Drive macOS power diagnostics',
        `collectedAt=${collectedAt}`,
        'source=pmset -g log',
        '',
        filtered || '(no sleep/wake records found in pmset output)',
        stderr.trim() ? `\n[stderr]\n${stderr.trim()}` : '',
        '',
      ].join('\n'),
      'utf8',
    );
    return {
      path: 'files/macos-power.log',
      source: 'pmset -g log',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeFile(
      targetPath,
      [
        'Lynavo Drive macOS power diagnostics',
        `collectedAt=${collectedAt}`,
        'source=pmset -g log',
        `error=${message}`,
        '',
      ].join('\n'),
      'utf8',
    );
    return {
      path: 'files/macos-power.log',
      source: 'pmset -g log',
      error: message,
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
      hostname: hostname(),
      locale: app.getLocale?.() ?? null,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
    },
    wifi: await detectWiFiIdentity(),
    networkInterfaces: summarizeNetworkInterfaces(),
  };
}

/**
 * Enumerates the sidecar log files produced by the in-process rotation
 * (sidecar.log + sidecar.log.1..N). Returns recent absolute paths sorted
 * newest-first so the primary file is first.
 */
async function listSidecarLogFiles(sidecarDataDir: string): Promise<string[]> {
  const logsDir = join(sidecarDataDir, 'logs');
  const now = Date.now();
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
      if (await isRecentDiagnosticLog(p, now)) present.push(p);
    }
    return present;
  } catch {
    return [];
  }
}

/**
 * Electron-log can create main, renderer, and rotated files in the same log
 * directory. Collecting recent files gives local diagnostic bundles enough
 * history to debug renderer-only failures without attaching stale multi-day logs.
 */
async function listDesktopLogFiles(activeLogPath: string): Promise<string[]> {
  const logsDir = dirname(activeLogPath);
  const activeBaseName = basename(activeLogPath);
  const present = new Set<string>();
  const now = Date.now();

  if (await isRecentDiagnosticLog(activeLogPath, now)) {
    present.add(activeLogPath);
  }

  try {
    const entries = await readdir(logsDir);
    const candidates = entries
      .filter(
        (name) =>
          name === activeBaseName ||
          name.startsWith(`${activeBaseName}.`) ||
          /\.log(?:\.\d+)?$/i.test(name),
      )
      .sort((a, b) => {
        if (a === activeBaseName) return -1;
        if (b === activeBaseName) return 1;
        return a.localeCompare(b, 'en');
      })
      .map((name) => join(logsDir, name));

    for (const candidate of candidates) {
      if (await isRecentDiagnosticLog(candidate, now)) {
        present.add(candidate);
      }
    }
  } catch {
    // Best effort: the active log path above is still included if it exists.
  }

  return Array.from(present);
}

export async function exportDiagnostics(
  sidecarManager: SidecarManager,
  locale?: string,
  description?: string,
): Promise<string | null> {
  const strings = getMainStrings(locale);
  const timestamp = diagnosticsTimestamp();
  const defaultPath = join(
    app.getPath('desktop'),
    `${strings.diagnostics.filenamePrefix}-${timestamp}.zip`,
  );
  const dialogResult = await dialog.showSaveDialog({
    title: strings.diagnostics.title,
    defaultPath,
    filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
  });
  if (dialogResult.canceled || !dialogResult.filePath) {
    return null;
  }

  const { tempRoot, bundleDir } = await createDiagnosticsBundle(
    sidecarManager,
    locale,
    timestamp,
    description,
  );

  try {
    await compressBundle(bundleDir, dialogResult.filePath, true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }

  shell.showItemInFolder(dialogResult.filePath);
  return dialogResult.filePath;
}

async function createDiagnosticsBundle(
  sidecarManager: SidecarManager,
  locale?: string,
  timestamp = diagnosticsTimestamp(),
  description?: string,
): Promise<{ tempRoot: string; bundleDir: string }> {
  const strings = getMainStrings(locale);
  const tempRoot = join(tmpdir(), `lynavo-drive-diagnostics-${timestamp}`);
  const bundleDir = join(tempRoot, `${strings.diagnostics.filenamePrefix}-${timestamp}`);
  const filesDir = join(bundleDir, 'files');
  const sidecarDataDir = app.getPath('userData');
  const sidecarDbPath = join(sidecarDataDir, 'sidecar.db');
  const desktopLogPath = log.transports.file.getFile().path;
  const issueDescription = description?.trim() || null;

  await rm(tempRoot, { recursive: true, force: true });
  await mkdir(filesDir, { recursive: true });

  const appInfo = getAppInfo();
  const desktopLogFiles = await listDesktopLogFiles(desktopLogPath);
  const sidecarLogFiles = await listSidecarLogFiles(sidecarDataDir);
  const powerLog = await writePowerDiagnostics(filesDir);
  const environment = await captureEnvironmentSnapshot();
  const snapshot: DiagnosticSnapshot = {
    generatedAt: new Date().toISOString(),
    issue: {
      description: issueDescription,
    },
    app: {
      ...appInfo,
      build: appInfo.buildNumber || 'dev',
      platform: process.platform,
    },
    process: {
      pid: process.pid,
      cwd: process.cwd(),
      execPath: process.execPath,
      packaged: app.isPackaged,
      electron: process.versions.electron ?? null,
      chrome: process.versions.chrome ?? null,
      node: process.versions.node,
      v8: process.versions.v8 ?? null,
    },
    device: {
      model: `${type()} ${process.arch}`,
      osVersion: `${type()} ${release()}`,
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
      desktopLogFiles,
      powerLog,
      sidecarDbPath: (await exists(sidecarDbPath)) ? sidecarDbPath : null,
      sidecarDataDir,
      sidecarLogFiles,
    },
    paths: {
      userData: sidecarDataDir,
      logs: [...desktopLogFiles, ...sidecarLogFiles],
      sidecarDbPath: (await exists(sidecarDbPath)) ? sidecarDbPath : null,
    },
  };

  await writeFile(join(bundleDir, 'diagnostics.json'), JSON.stringify(snapshot, null, 2), 'utf8');
  await writeFile(join(bundleDir, 'README.txt'), strings.diagnostics.readme.join('\n'), 'utf8');

  for (const desktopLogFile of desktopLogFiles) {
    await copyDiagnosticLogFile(desktopLogFile, join(filesDir, basename(desktopLogFile)));
  }
  await copyDiagnosticDatabase(sidecarDbPath, join(filesDir, 'sidecar.db'));
  // Copy every rotated sidecar log file so the bundle retains history
  // across size-based rotations. Names preserved so .1/.2 ordering is
  // obvious when the receiver opens the ZIP.
  for (const logPath of sidecarLogFiles) {
    const baseName = logPath.split(/[/\\]/).pop() ?? 'sidecar.log';
    await copyDiagnosticLogFile(logPath, join(filesDir, baseName));
  }

  return { tempRoot, bundleDir };
}

export async function compressBundle(
  bundleDir: string,
  outputPath: string,
  includeParent: boolean,
  options: CompressBundleOptions = {},
): Promise<void> {
  const platform = options.platform ?? process.platform;
  const runCommand = options.runCommand ?? execFileAsync;

  if (platform === 'win32') {
    await runCommand('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path '${bundleDir.replace(/'/g, "''")}\\*' -DestinationPath '${outputPath.replace(/'/g, "''")}' -Force`,
    ]);
    return;
  }

  if (platform === 'linux') {
    const cwd = includeParent ? dirname(bundleDir) : bundleDir;
    const source = includeParent ? basename(bundleDir) : '.';
    await rm(outputPath, { force: true });
    await runCommand('zip', ['-r', outputPath, source], { cwd });
    return;
  }

  if (includeParent) {
    await runCommand('ditto', [
      '-c',
      '-k',
      '--sequesterRsrc',
      '--keepParent',
      bundleDir,
      outputPath,
    ]);
  } else {
    await runCommand('ditto', ['-c', '-k', '--sequesterRsrc', bundleDir, outputPath]);
  }
}
