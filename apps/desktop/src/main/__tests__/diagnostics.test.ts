import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dialog } from 'electron';
import type { SidecarManager } from '../sidecar-manager';

const appState = vi.hoisted(() => ({
  isPackaged: false,
}));

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return appState.isPackaged;
    },
    getAppPath: () => '/tmp/vividrop-app',
    getName: () => 'Vivi Drop',
    getPath: () => '/tmp/vividrop-user-data',
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
        getFile: () => ({ path: '/tmp/vividrop-main.log' }),
      },
    },
  },
}));

describe('checkForUpdates', () => {
  const updateCheckQuery = `platform=${process.platform}&arch=${process.arch}&version=0.1.0`;

  beforeEach(() => {
    appState.isPackaged = false;
    delete process.env.VIVIDROP_API_BASE_URL;
    delete process.env.SYNCFLOW_API_BASE_URL;
    delete process.env.VIVIDROP_DESKTOP_UPDATE_URL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the local Docker API by default in development mode', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        update_available: false,
        latest_version: '0.1.0',
        checked_at: '2026-05-08T08:00:00Z',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { checkForUpdates } = await import('../diagnostics');

    await checkForUpdates();

    const requestUrl = fetchMock.mock.calls[0]?.[0];
    expect(requestUrl).toEqual(
      `http://127.0.0.1:8080/api/v1/desktop/update-check?${updateCheckQuery}`,
    );
  });

  it('uses the production API by default in packaged builds', async () => {
    appState.isPackaged = true;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        update_available: false,
        latest_version: '0.1.0',
        checked_at: '2026-05-08T08:00:00Z',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { checkForUpdates } = await import('../diagnostics');

    await checkForUpdates();

    const requestUrl = fetchMock.mock.calls[0]?.[0];
    expect(requestUrl).toEqual(
      `https://api.vividrop.cn/api/v1/desktop/update-check?${updateCheckQuery}`,
    );
  });

  it('prefers an explicit API base URL over the development default', async () => {
    process.env.VIVIDROP_API_BASE_URL = 'http://localhost:9090';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        update_available: false,
        latest_version: '0.1.0',
        checked_at: '2026-05-08T08:00:00Z',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { checkForUpdates } = await import('../diagnostics');

    await checkForUpdates();

    const requestUrl = fetchMock.mock.calls[0]?.[0];
    expect(requestUrl).toEqual(
      `http://localhost:9090/api/v1/desktop/update-check?${updateCheckQuery}`,
    );
  });
});

describe('exportDiagnostics', () => {
  beforeEach(() => {
    appState.isPackaged = false;
    delete process.env.VIVIDROP_API_BASE_URL;
    delete process.env.SYNCFLOW_API_BASE_URL;
    delete process.env.VIVIDROP_DESKTOP_UPDATE_URL;
    delete process.env.VIVIDROP_DIAGNOSTICS_UPLOAD_URL;
    rmSync('/tmp/vividrop-user-data', { recursive: true, force: true });
    rmSync('/tmp/vividrop-main.log', { force: true });
    rmSync('/tmp/vividrop-main.log.1', { force: true });
    rmSync('/tmp/vividrop-renderer.log', { force: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.VIVIDROP_API_BASE_URL;
    delete process.env.SYNCFLOW_API_BASE_URL;
    delete process.env.VIVIDROP_DESKTOP_UPDATE_URL;
    delete process.env.VIVIDROP_DIAGNOSTICS_UPLOAD_URL;
    rmSync('/tmp/vividrop-user-data', { recursive: true, force: true });
    rmSync('/tmp/vividrop-main.log', { force: true });
    rmSync('/tmp/vividrop-main.log.1', { force: true });
    rmSync('/tmp/vividrop-renderer.log', { force: true });
  });

  it('writes a non-empty app build in diagnostics.json', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'syncflow-diagnostics-test-'));
    const archivePath = join(tempRoot, 'diagnostics.zip');
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

  it('includes issue description, runtime context, and available log files', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'syncflow-diagnostics-test-'));
    const archivePath = join(tempRoot, 'diagnostics.zip');
    mkdirSync('/tmp/vividrop-user-data/logs', { recursive: true });
    writeFileSync('/tmp/vividrop-main.log', 'main log\n');
    writeFileSync('/tmp/vividrop-main.log.1', 'rotated main log\n');
    writeFileSync('/tmp/vividrop-renderer.log', 'renderer log\n');
    writeFileSync('/tmp/vividrop-user-data/logs/sidecar.log', 'sidecar log\n');
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
    expect(entries.some((entry) => entry.endsWith('/files/vividrop-main.log'))).toBe(true);
    expect(entries.some((entry) => entry.endsWith('/files/vividrop-main.log.1'))).toBe(true);
    expect(entries.some((entry) => entry.endsWith('/files/vividrop-renderer.log'))).toBe(true);
    expect(entries.some((entry) => entry.endsWith('/files/sidecar.log'))).toBe(true);

    const diagnosticsEntry = entries.find((entry) => entry.endsWith('/diagnostics.json'));
    expect(diagnosticsEntry).toBeTruthy();
    const diagnosticsJson = execFileSync('unzip', ['-p', archivePath, diagnosticsEntry ?? ''], {
      encoding: 'utf8',
    });
    const diagnostics = JSON.parse(diagnosticsJson) as {
      issue?: { description?: string };
      process?: { electron?: string; node?: string; chrome?: string };
      api?: { updateCheckUrl?: string; diagnosticsUploadUrl?: string };
      paths?: { userData?: string; logs?: string[] };
    };
    expect(diagnostics.issue?.description).toBe('Wi-Fi drops when the phone locks');
    expect(diagnostics.process?.node).toBeTruthy();
    expect(diagnostics.api?.updateCheckUrl).toContain('/api/v1/desktop/update-check');
    expect(diagnostics.api?.diagnosticsUploadUrl).toContain('/api/v1/diagnostics/upload');
    expect(diagnostics.paths?.userData).toBe('/tmp/vividrop-user-data');
    expect(diagnostics.paths?.logs).toContain('/tmp/vividrop-main.log');

    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('redacts credentials in API URLs written to diagnostics.json', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'syncflow-diagnostics-test-'));
    const archivePath = join(tempRoot, 'diagnostics.zip');
    process.env.VIVIDROP_DESKTOP_UPDATE_URL =
      'https://user:secret@example.test/update?token=abc&keep=ok';
    process.env.VIVIDROP_DIAGNOSTICS_UPLOAD_URL = 'https://example.test/upload?api_key=abc&keep=ok';
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
      api?: { updateCheckUrl?: string; diagnosticsUploadUrl?: string };
    };
    expect(diagnostics.api?.updateCheckUrl).toBe(
      'https://redacted:redacted@example.test/update?token=redacted&keep=ok',
    );
    expect(diagnostics.api?.diagnosticsUploadUrl).toBe(
      'https://example.test/upload?api_key=redacted&keep=ok',
    );

    rmSync(tempRoot, { recursive: true, force: true });
  });
});
