import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dialog } from 'electron';
import type { SidecarManager } from '../sidecar-manager';

const appState = vi.hoisted(() => ({
  isPackaged: false,
}));

const diagnosticsPaths = vi.hoisted(() => {
  const root = `/tmp/lynavo-drive-diagnostics-vitest-${process.pid}`;
  return {
    root,
    appPath: `${root}/app`,
    userData: `${root}/user-data`,
    desktopLog: `${root}/desktop/main.log`,
    rotatedDesktopLog: `${root}/desktop/main.log.1`,
    rendererLog: `${root}/desktop/renderer.log`,
  };
});
const legacyViviApiBaseEnv = ['VIVI', 'DROP_API_BASE_URL'].join('');
const legacySyncApiBaseEnv = ['SYNC', 'FLOW_API_BASE_URL'].join('');
const legacyViviUpdateEnv = ['VIVI', 'DROP_DESKTOP_UPDATE_URL'].join('');
const legacyViviDiagnosticsUploadEnv = ['VIVI', 'DROP_DIAGNOSTICS_UPLOAD_URL'].join('');
const desktopUpdateEnv = ['LYNAVO_DESKTOP', '_UPDATE_URL'].join('');
const diagnosticsUploadEnv = ['LYNAVO_DIAGNOSTICS', '_UPLOAD_URL'].join('');

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return appState.isPackaged;
    },
    getAppPath: () => diagnosticsPaths.appPath,
    getName: () => 'Lynavo Drive',
    getPath: () => diagnosticsPaths.userData,
    getVersion: () => '0.1.0',
  },
  dialog: {
    showSaveDialog: vi.fn(),
  },
  shell: {
    showItemInFolder: vi.fn(),
  },
}));

vi.mock('electron-log', () => ({
  default: {
    transports: {
      file: {
        getFile: () => ({ path: diagnosticsPaths.desktopLog }),
      },
    },
  },
}));

function resetDiagnosticsFs() {
  rmSync(diagnosticsPaths.root, { recursive: true, force: true });
}

function ensureDesktopLogDir() {
  mkdirSync(join(diagnosticsPaths.root, 'desktop'), { recursive: true });
}

describe('exportDiagnostics', () => {
  beforeEach(() => {
    appState.isPackaged = false;
    delete process.env.LYNAVO_SUPPORT_API_BASE_URL;
    delete process.env.LYNAVO_API_BASE_URL;
    delete process.env[desktopUpdateEnv];
    delete process.env[diagnosticsUploadEnv];
    delete process.env[legacyViviApiBaseEnv];
    delete process.env[legacySyncApiBaseEnv];
    delete process.env[legacyViviUpdateEnv];
    delete process.env[legacyViviDiagnosticsUploadEnv];
    resetDiagnosticsFs();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.LYNAVO_SUPPORT_API_BASE_URL;
    delete process.env.LYNAVO_API_BASE_URL;
    delete process.env[desktopUpdateEnv];
    delete process.env[diagnosticsUploadEnv];
    delete process.env[legacyViviApiBaseEnv];
    delete process.env[legacySyncApiBaseEnv];
    delete process.env[legacyViviUpdateEnv];
    delete process.env[legacyViviDiagnosticsUploadEnv];
    resetDiagnosticsFs();
  });

  it('writes a non-empty app build in diagnostics.json', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'lynavo-drive-diagnostics-test-'));
    const archivePath = join(tempRoot, 'diagnostics.zip');
    ensureDesktopLogDir();
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath: archivePath,
    });

    const { exportDiagnostics } = await import('../diagnostics');

    await exportDiagnostics({
      getState: () => ({ status: 'healthy' }),
    } as unknown as SidecarManager);

    const entries = execFileSync('unzip', ['-Z1', archivePath], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
    const diagnosticsEntry = entries.find((entry) => entry.endsWith('/diagnostics.json'));
    expect(diagnosticsEntry).toBeTruthy();

    const diagnosticsJson = execFileSync('unzip', ['-p', archivePath, diagnosticsEntry ?? ''], {
      encoding: 'utf8',
    });
    const diagnostics = JSON.parse(diagnosticsJson) as { app?: { build?: string } };
    expect(diagnostics.app?.build).toBeTruthy();

    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('serializes a numeric packaged build number as a string in diagnostics.json', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'lynavo-drive-diagnostics-test-'));
    const archivePath = join(tempRoot, 'diagnostics.zip');
    ensureDesktopLogDir();
    mkdirSync(diagnosticsPaths.appPath, { recursive: true });
    writeFileSync(join(diagnosticsPaths.appPath, 'package.json'), '{"lynavoDriveBuildNumber":50}');
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath: archivePath,
    });

    const { exportDiagnostics } = await import('../diagnostics');

    await exportDiagnostics({
      getState: () => ({ status: 'healthy' }),
    } as unknown as SidecarManager);

    const entries = execFileSync('unzip', ['-Z1', archivePath], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
    const diagnosticsEntry = entries.find((entry) => entry.endsWith('/diagnostics.json'));
    expect(diagnosticsEntry).toBeTruthy();

    const diagnosticsJson = execFileSync('unzip', ['-p', archivePath, diagnosticsEntry ?? ''], {
      encoding: 'utf8',
    });
    const diagnostics = JSON.parse(diagnosticsJson) as { app?: { build?: unknown } };
    expect(diagnostics.app?.build).toBe('50');

    rmSync(diagnosticsPaths.appPath, { recursive: true, force: true });
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('includes issue description, runtime context, and available log files', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'lynavo-drive-diagnostics-test-'));
    const archivePath = join(tempRoot, 'diagnostics.zip');
    ensureDesktopLogDir();
    mkdirSync(join(diagnosticsPaths.userData, 'logs'), { recursive: true });
    writeFileSync(diagnosticsPaths.desktopLog, 'main log\n');
    writeFileSync(diagnosticsPaths.rotatedDesktopLog, 'rotated main log\n');
    writeFileSync(diagnosticsPaths.rendererLog, 'renderer log\n');
    writeFileSync(join(diagnosticsPaths.userData, 'logs', 'sidecar.log'), 'sidecar log\n');
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath: archivePath,
    });

    const { exportDiagnostics } = await import('../diagnostics');

    await exportDiagnostics(
      {
        getState: () => ({ status: 'healthy' }),
      } as unknown as SidecarManager,
      'en',
      'Wi-Fi drops when the phone locks',
    );

    const entries = execFileSync('unzip', ['-Z1', archivePath], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
    expect(entries.some((entry) => entry.endsWith('/files/main.log'))).toBe(true);
    expect(entries.some((entry) => entry.endsWith('/files/main.log.1'))).toBe(true);
    expect(entries.some((entry) => entry.endsWith('/files/renderer.log'))).toBe(true);
    expect(entries.some((entry) => entry.endsWith('/files/sidecar.log'))).toBe(true);

    const diagnosticsEntry = entries.find((entry) => entry.endsWith('/diagnostics.json'));
    expect(diagnosticsEntry).toBeTruthy();
    const diagnosticsJson = execFileSync('unzip', ['-p', archivePath, diagnosticsEntry ?? ''], {
      encoding: 'utf8',
    });
    const diagnostics = JSON.parse(diagnosticsJson) as {
      issue?: { description?: string };
      process?: { electron?: string; node?: string; chrome?: string };
      paths?: { userData?: string; logs?: string[] };
    };
    expect(diagnostics.issue?.description).toBe('Wi-Fi drops when the phone locks');
    expect(diagnostics.process?.node).toBeTruthy();
    expect('supportApi' in diagnostics).toBe(false);
    expect('api' in diagnostics).toBe(false);
    expect(diagnostics.paths?.userData).toBe(diagnosticsPaths.userData);
    expect(diagnostics.paths?.logs).toContain(diagnosticsPaths.desktopLog);

    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('omits stale rotated log files from diagnostics archives', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'lynavo-drive-diagnostics-test-'));
    const archivePath = join(tempRoot, 'diagnostics.zip');
    const staleDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    ensureDesktopLogDir();
    mkdirSync(join(diagnosticsPaths.userData, 'logs'), { recursive: true });
    writeFileSync(diagnosticsPaths.desktopLog, 'fresh main log\n');
    writeFileSync(diagnosticsPaths.rotatedDesktopLog, 'stale rotated main log\n');
    writeFileSync(diagnosticsPaths.rendererLog, 'stale renderer log\n');
    writeFileSync(join(diagnosticsPaths.userData, 'logs', 'sidecar.log'), 'fresh sidecar log\n');
    writeFileSync(
      join(diagnosticsPaths.userData, 'logs', 'sidecar.log.1'),
      'stale rotated sidecar log\n',
    );
    utimesSync(diagnosticsPaths.rotatedDesktopLog, staleDate, staleDate);
    utimesSync(diagnosticsPaths.rendererLog, staleDate, staleDate);
    utimesSync(join(diagnosticsPaths.userData, 'logs', 'sidecar.log.1'), staleDate, staleDate);
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath: archivePath,
    });

    const { exportDiagnostics } = await import('../diagnostics');

    await exportDiagnostics({
      getState: () => ({ status: 'healthy' }),
    } as unknown as SidecarManager);

    const entries = execFileSync('unzip', ['-Z1', archivePath], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
    expect(entries.some((entry) => entry.endsWith('/files/main.log'))).toBe(true);
    expect(entries.some((entry) => entry.endsWith('/files/sidecar.log'))).toBe(true);
    expect(entries.some((entry) => entry.endsWith('/files/main.log.1'))).toBe(false);
    expect(entries.some((entry) => entry.endsWith('/files/renderer.log'))).toBe(false);
    expect(entries.some((entry) => entry.endsWith('/files/sidecar.log.1'))).toBe(false);

    const diagnosticsEntry = entries.find((entry) => entry.endsWith('/diagnostics.json'));
    expect(diagnosticsEntry).toBeTruthy();
    const diagnosticsJson = execFileSync('unzip', ['-p', archivePath, diagnosticsEntry ?? ''], {
      encoding: 'utf8',
    });
    const diagnostics = JSON.parse(diagnosticsJson) as {
      paths?: { logs?: string[] };
    };
    expect(diagnostics.paths?.logs).not.toContain(diagnosticsPaths.rotatedDesktopLog);
    expect(diagnostics.paths?.logs).not.toContain(diagnosticsPaths.rendererLog);
    expect(diagnostics.paths?.logs).not.toContain(
      join(diagnosticsPaths.userData, 'logs', 'sidecar.log.1'),
    );

    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('omits stale support and update URL env from diagnostics.json', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'lynavo-drive-diagnostics-test-'));
    const archivePath = join(tempRoot, 'diagnostics.zip');
    ensureDesktopLogDir();
    process.env.LYNAVO_SUPPORT_API_BASE_URL = 'https://user:secret@example.test/api?token=abc';
    process.env[desktopUpdateEnv] = 'https://user:secret@example.test/update?token=abc&keep=ok';
    process.env[diagnosticsUploadEnv] = 'https://example.test/upload?api_key=abc&keep=ok';
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath: archivePath,
    });

    const { exportDiagnostics } = await import('../diagnostics');

    await exportDiagnostics({
      getState: () => ({ status: 'healthy' }),
    } as unknown as SidecarManager);

    const entries = execFileSync('unzip', ['-Z1', archivePath], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
    const diagnosticsEntry = entries.find((entry) => entry.endsWith('/diagnostics.json'));
    expect(diagnosticsEntry).toBeTruthy();
    const diagnosticsJson = execFileSync('unzip', ['-p', archivePath, diagnosticsEntry ?? ''], {
      encoding: 'utf8',
    });
    const diagnostics = JSON.parse(diagnosticsJson) as {
      supportApi?: unknown;
      api?: unknown;
      env?: Record<string, string>;
    };
    expect('supportApi' in diagnostics).toBe(false);
    expect('api' in diagnostics).toBe(false);
    expect(diagnostics.env?.LYNAVO_SUPPORT_API_BASE_URL).toBeUndefined();
    expect(diagnostics.env?.[desktopUpdateEnv]).toBeUndefined();
    expect(diagnostics.env?.[diagnosticsUploadEnv]).toBeUndefined();

    rmSync(tempRoot, { recursive: true, force: true });
  });
});

describe('writePowerDiagnostics', () => {
  it('writes filtered macOS sleep and wake history into the diagnostics files directory', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'lynavo-drive-power-diagnostics-test-'));
    const filesDir = join(tempRoot, 'files');
    mkdirSync(filesDir, { recursive: true });
    const runCommand = vi.fn().mockResolvedValue({
      stdout: [
        '2026-06-11 09:59:58 +0800 Assertions            PID 123',
        '2026-06-11 10:00:00 +0800 Sleep                 Entering Sleep state due to Software Sleep',
        '2026-06-11 10:01:30 +0800 Wake                  Wake from Normal Sleep [CDNVA] : due to EC.LidOpen/UserActivity',
        '2026-06-11 10:01:31 +0800 Kernel Client Acks    Delays to Sleep notifications',
      ].join('\n'),
      stderr: '',
    });

    const { writePowerDiagnostics } = await import('../diagnostics');

    const result = await writePowerDiagnostics(filesDir, {
      platform: 'darwin',
      runCommand,
      now: new Date('2026-06-11T02:02:00.000Z'),
    });

    expect(result).toEqual({
      path: 'files/macos-power.log',
      source: 'pmset -g log',
    });
    expect(runCommand).toHaveBeenCalledWith(
      '/bin/sh',
      ['-c', expect.stringContaining('/usr/bin/pmset -g log')],
      {
        maxBuffer: 2 * 1024 * 1024,
        timeout: 1_500,
      },
    );
    const content = readFileSync(join(filesDir, 'macos-power.log'), 'utf8');
    expect(content).toContain('collectedAt=2026-06-11T02:02:00.000Z');
    expect(content).toContain('Entering Sleep state');
    expect(content).toContain('Wake from Normal Sleep');
    expect(content).not.toContain('Assertions');

    rmSync(tempRoot, { recursive: true, force: true });
  });
});
