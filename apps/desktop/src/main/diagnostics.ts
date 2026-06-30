import { app, dialog, shell } from 'electron';
import log from 'electron-log';
import { execFile, type ExecFileOptions } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { hostname, networkInterfaces, release, tmpdir, type } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { LYNAVO_API_BASE_URL, LYNAVO_REVIEW_API_BASE_URL } from '@lynavo-drive/contracts';
import { desktopClientHeaders, getAppInfo, type AppInfo } from './app-info';
import { sidecarClient } from './sidecar-client';
import type { SidecarManager } from './sidecar-manager';
import { getMainStrings } from '../shared/main-i18n';

const execFileAsync = promisify(execFile);
const DIAGNOSTICS_LOG_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const DIAGNOSTICS_UPLOAD_LOG_TAIL_BYTES = 256 * 1024;
const DIAGNOSTICS_UPLOAD_DB_MAX_BYTES = 128 * 1024;
const DIAGNOSTICS_UPLOAD_ARCHIVE_MAX_BYTES = 900 * 1024;
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
  api: {
    diagnosticsUploadUrl: string;
    updateCheckUrl: string;
    baseUrl: string;
    baseUrlSource: string;
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

type DiagnosticsBundleMode = 'export' | 'upload';

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

export type PowerDiagnosticsResult = {
  path: string;
  source: string;
  error?: string;
};

export type DiagnosticsUploadRequest = {
  description: string;
  locale?: string;
};

export type DiagnosticsUploadResult = {
  refId: string;
  uploadedAt: string;
};

export type UpdateCheckResult = {
  updateAvailable: boolean;
  latestVersion: string;
  latestBuildNumber?: string;
  minimumRequired?: boolean;
  downloadUrl?: string;
  releaseNotes?: string;
  checkedAt: string;
};

export class DiagnosticsUploadError extends Error {
  constructor(
    public readonly code:
      | 'NETWORK_UNREACHABLE'
      | 'BUNDLE_TOO_LARGE'
      | 'SERVER_ERROR'
      | 'INVALID_RESPONSE',
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'DiagnosticsUploadError';
  }
}

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

async function copyDiagnosticLogFile(
  sourcePath: string,
  destinationPath: string,
  mode: DiagnosticsBundleMode,
): Promise<void> {
  if (mode === 'export') {
    await copyFile(sourcePath, destinationPath);
    return;
  }

  const info = await stat(sourcePath);
  if (info.size <= DIAGNOSTICS_UPLOAD_LOG_TAIL_BYTES) {
    await copyFile(sourcePath, destinationPath);
    return;
  }

  const content = await readFile(sourcePath);
  const tail = content.subarray(content.byteLength - DIAGNOSTICS_UPLOAD_LOG_TAIL_BYTES);
  const notice = Buffer.from(
    `[Vivi Drop diagnostics] This log was truncated for upload. Original size: ${info.size} bytes. Included tail bytes: ${tail.byteLength}.\n\n`,
    'utf8',
  );
  await writeFile(destinationPath, Buffer.concat([notice, tail]));
}

async function copyDiagnosticDatabase(
  sourcePath: string,
  destinationPath: string,
  omittedMarkerPath: string,
  mode: DiagnosticsBundleMode,
): Promise<void> {
  if (!(await exists(sourcePath))) return;

  if (mode === 'upload') {
    const info = await stat(sourcePath);
    if (info.size > DIAGNOSTICS_UPLOAD_DB_MAX_BYTES) {
      await writeFile(
        omittedMarkerPath,
        [
          'sidecar.db was omitted from the uploaded diagnostics bundle.',
          `Original size: ${info.size} bytes.`,
          `Upload limit for database snapshots: ${DIAGNOSTICS_UPLOAD_DB_MAX_BYTES} bytes.`,
          'Use Export diagnostics locally if a full database snapshot is required.',
          '',
        ].join('\n'),
        'utf8',
      );
      return;
    }
  }

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
        'Vivi Drop macOS power diagnostics',
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
        'Vivi Drop macOS power diagnostics',
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
 * directory. Collecting recent files gives support enough history to debug
 * renderer-only failures without attaching stale multi-day logs to uploads.
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

function defaultApiBaseUrl(): string {
  return app.isPackaged ? LYNAVO_API_BASE_URL : LYNAVO_REVIEW_API_BASE_URL;
}

function configuredApiBase(): { baseUrl: string; source: string } {
  const lynavoBase = process.env.LYNAVO_API_BASE_URL?.trim();
  if (lynavoBase) return { baseUrl: lynavoBase, source: 'LYNAVO_API_BASE_URL' };

  return {
    baseUrl: defaultApiBaseUrl(),
    source: app.isPackaged ? 'packaged-default' : 'dev-default',
  };
}

function configuredUrl(envNames: readonly string[], fallbackPath: string): string {
  for (const envName of envNames) {
    const explicit = process.env[envName]?.trim();
    if (explicit) return explicit;
  }
  const { baseUrl: base } = configuredApiBase();
  return new URL(fallbackPath, base.endsWith('/') ? base : `${base}/`).toString();
}

function redactUrlForDiagnostics(value: string): string {
  try {
    const url = new URL(value);
    if (url.username) url.username = 'redacted';
    if (url.password) url.password = 'redacted';
    for (const key of ['token', 'access_token', 'api_key', 'apikey', 'key', 'secret']) {
      if (url.searchParams.has(key)) {
        url.searchParams.set(key, 'redacted');
      }
    }
    return url.toString();
  } catch {
    return value;
  }
}

function diagnosticsUploadUrl(): string {
  return configuredUrl(['LYNAVO_DIAGNOSTICS_UPLOAD_URL'], '/api/v1/diagnostics/upload');
}

function updateCheckUrl(): string {
  return configuredUrl(['LYNAVO_DESKTOP_UPDATE_URL'], '/api/v1/desktop/update-check');
}

function optionalApiToken(): string | null {
  return (
    process.env.LYNAVO_DIAGNOSTICS_TOKEN?.trim() ||
    process.env.LYNAVO_API_TOKEN?.trim() ||
    null
  );
}

function desktopClientId(): string {
  const source = `${app.getPath('userData')}|${hostname()}`;
  const digest = createHash('sha256').update(source).digest('hex').slice(0, 16);
  return `desktop-${digest}`;
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
  mode: DiagnosticsBundleMode = 'export',
): Promise<{ tempRoot: string; bundleDir: string }> {
  const strings = getMainStrings(locale);
  const tempRoot = join(tmpdir(), `syncflow-diagnostics-${timestamp}`);
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
  const apiBase = configuredApiBase();
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
    api: {
      diagnosticsUploadUrl: redactUrlForDiagnostics(diagnosticsUploadUrl()),
      updateCheckUrl: redactUrlForDiagnostics(updateCheckUrl()),
      baseUrl: redactUrlForDiagnostics(apiBase.baseUrl),
      baseUrlSource: apiBase.source,
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
    await copyDiagnosticLogFile(desktopLogFile, join(filesDir, basename(desktopLogFile)), mode);
  }
  await copyDiagnosticDatabase(
    sidecarDbPath,
    join(filesDir, 'sidecar.db'),
    join(filesDir, 'sidecar.db.omitted.txt'),
    mode,
  );
  // Copy every rotated sidecar log file so the bundle retains history
  // across size-based rotations. Names preserved so .1/.2 ordering is
  // obvious when the receiver opens the ZIP.
  for (const logPath of sidecarLogFiles) {
    const baseName = logPath.split(/[/\\]/).pop() ?? 'sidecar.log';
    await copyDiagnosticLogFile(logPath, join(filesDir, baseName), mode);
  }

  return { tempRoot, bundleDir };
}

async function compressBundle(
  bundleDir: string,
  outputPath: string,
  includeParent: boolean,
): Promise<void> {
  if (process.platform === 'win32') {
    await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path '${bundleDir.replace(/'/g, "''")}\\*' -DestinationPath '${outputPath.replace(/'/g, "''")}' -Force`,
    ]);
    return;
  }

  if (includeParent) {
    await execFileAsync('ditto', [
      '-c',
      '-k',
      '--sequesterRsrc',
      '--keepParent',
      bundleDir,
      outputPath,
    ]);
  } else {
    await execFileAsync('ditto', ['-c', '-k', '--sequesterRsrc', bundleDir, outputPath]);
  }
}

function parseDiagnosticsUploadResponse(value: unknown): DiagnosticsUploadResult {
  if (!value || typeof value !== 'object') {
    throw new DiagnosticsUploadError('INVALID_RESPONSE', 'upload response is not an object');
  }
  const data = value as Record<string, unknown>;
  const refId = data.ref_id ?? data.refId;
  const uploadedAt = data.uploaded_at ?? data.uploadedAt;
  if (typeof refId !== 'string' || typeof uploadedAt !== 'string') {
    throw new DiagnosticsUploadError('INVALID_RESPONSE', 'upload response missing ref_id');
  }
  return { refId, uploadedAt };
}

export async function uploadDiagnostics(
  sidecarManager: SidecarManager,
  request: DiagnosticsUploadRequest,
): Promise<DiagnosticsUploadResult> {
  const description = request.description.trim();
  const timestamp = diagnosticsTimestamp();
  const { tempRoot, bundleDir } = await createDiagnosticsBundle(
    sidecarManager,
    request.locale,
    timestamp,
    description,
    'upload',
  );
  const archivePath = join(tempRoot, `upload-${timestamp}.zip`);

  try {
    await compressBundle(bundleDir, archivePath, false);

    const form = new FormData();
    form.append('client_id', desktopClientId());
    if (description) {
      form.append('note', description);
    }
    const zipBytes = await readFile(archivePath);
    if (zipBytes.byteLength > DIAGNOSTICS_UPLOAD_ARCHIVE_MAX_BYTES) {
      throw new DiagnosticsUploadError(
        'BUNDLE_TOO_LARGE',
        `diagnostics bundle is ${zipBytes.byteLength} bytes after compaction`,
      );
    }
    form.append(
      'bundle',
      new Blob([new Uint8Array(zipBytes)], { type: 'application/zip' }),
      'diagnostics.zip',
    );

    const headers: Record<string, string> = desktopClientHeaders();
    const token = optionalApiToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    let response: Response;
    try {
      response = await fetch(diagnosticsUploadUrl(), {
        method: 'POST',
        headers,
        body: form,
      });
    } catch (error) {
      throw new DiagnosticsUploadError(
        'NETWORK_UNREACHABLE',
        error instanceof Error ? error.message : String(error),
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      if (response.status === 413) {
        throw new DiagnosticsUploadError('BUNDLE_TOO_LARGE', body || 'bundle too large');
      }
      throw new DiagnosticsUploadError('SERVER_ERROR', body || `HTTP ${response.status}`);
    }

    return parseDiagnosticsUploadResponse(await response.json());
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function numericVersionParts(version: string): number[] {
  return version
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

function compareVersions(left: string, right: string): number {
  const a = numericVersionParts(left);
  const b = numericVersionParts(right);
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function parseUpdateCheckResponse(value: unknown, current: AppInfo): UpdateCheckResult {
  if (!value || typeof value !== 'object') {
    throw new Error('update check response is not an object');
  }
  const data = value as Record<string, unknown>;
  const latestVersion = data.latest_version ?? data.latestVersion;
  if (typeof latestVersion !== 'string' || !latestVersion) {
    throw new Error('update check response missing latest version');
  }

  const explicitUpdate = data.update_available ?? data.updateAvailable;
  const updateAvailable =
    typeof explicitUpdate === 'boolean'
      ? explicitUpdate
      : compareVersions(latestVersion, current.version) > 0;
  const latestBuildNumber = data.latest_build_number ?? data.latestBuildNumber;
  const minimumRequired = data.minimum_required ?? data.minimumRequired;
  const downloadUrl = data.download_url ?? data.downloadUrl;
  const releaseNotes = data.release_notes ?? data.releaseNotes;
  const checkedAt = data.checked_at ?? data.checkedAt;

  return {
    updateAvailable,
    latestVersion,
    latestBuildNumber: typeof latestBuildNumber === 'string' ? latestBuildNumber : undefined,
    minimumRequired: typeof minimumRequired === 'boolean' ? minimumRequired : undefined,
    downloadUrl: typeof downloadUrl === 'string' ? downloadUrl : undefined,
    releaseNotes: typeof releaseNotes === 'string' ? releaseNotes : undefined,
    checkedAt: typeof checkedAt === 'string' ? checkedAt : new Date().toISOString(),
  };
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const appInfo = getAppInfo();
  const url = new URL(updateCheckUrl());
  url.searchParams.set('platform', process.platform);
  url.searchParams.set('arch', process.arch);
  url.searchParams.set('version', appInfo.version);
  if (appInfo.buildNumber) {
    url.searchParams.set('build', appInfo.buildNumber);
  }

  const response = await fetch(url.toString(), {
    headers: desktopClientHeaders(),
  });
  if (!response.ok) {
    throw new Error(`update check failed: HTTP ${response.status}`);
  }

  return parseUpdateCheckResponse(await response.json(), appInfo);
}
