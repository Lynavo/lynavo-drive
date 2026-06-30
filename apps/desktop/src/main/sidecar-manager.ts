import { EventEmitter } from 'node:events';
import { spawn, ChildProcess, execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import { app } from 'electron';
import log from 'electron-log';
import { APP_COMPATIBILITY_VERSION, SIDECAR_HTTP_PORT } from '@lynavo-drive/contracts';
import {
  isCompatibleSidecarService,
  sidecarClient,
  supportsConnectionDeviceManagement,
} from './sidecar-client';
import type { SidecarHealth } from './sidecar-client';
import type {
  BonjourRuntimeSource,
  BonjourRuntimeState,
  RuntimeMessageArgs,
  SidecarRuntimeMessageCode,
  SidecarRuntimeState,
} from '../shared/sidecar-runtime';
import { INITIAL_SIDECAR_RUNTIME_STATE } from '../shared/sidecar-runtime';

const isDev = !app.isPackaged;
const sidecarBinaryName =
  process.platform === 'win32' ? 'lynavo-drive-sidecar.exe' : 'lynavo-drive-sidecar';
const HEALTHCHECK_INTERVAL_MS = 500;
const SIDECAR_STOP_TIMEOUT_MS = 5000;
const DEV_HEALTHCHECK_RETRIES = 120;
const PROD_HEALTHCHECK_RETRIES = 10;
const bonjourBinaryName = process.platform === 'win32' ? 'dns-sd.exe' : 'dns-sd';
const execFileAsync = promisify(execFile);

export class SidecarManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private restartCount = 0;
  private maxRestarts = 3;
  private healthInterval: ReturnType<typeof setInterval> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private stopping = false;
  private healthFailureRecoveryScheduled = false;
  private state: SidecarRuntimeState = INITIAL_SIDECAR_RUNTIME_STATE;

  constructor() {
    super();
    this.state = {
      ...INITIAL_SIDECAR_RUNTIME_STATE,
      maxRestarts: this.maxRestarts,
    };
  }

  getState(): SidecarRuntimeState {
    return { ...this.state };
  }

  private getSpawnArgs(): { command: string; args: string[] } {
    if (isDev) {
      // Dev mode: use `go run` from source
      return { command: 'go', args: ['run', './cmd/syncflow-sidecar/'] };
    }
    // Production: bundled binary in app resources
    return { command: join(process.resourcesPath, sidecarBinaryName), args: [] };
  }

  detectBonjourRuntime(): BonjourRuntimeState {
    if (process.platform !== 'win32') {
      return {
        status: 'not_applicable',
        source: 'not_applicable',
        message: null,
        messageCode: null,
        messageArgs: null,
        path: null,
        advertisedIP: null,
      };
    }

    const explicitPath = process.env.SYNCFLOW_DNSSD_PATH;
    const pathEntries = (process.env.PATH ?? process.env.Path ?? '')
      .split(delimiter)
      .map((entry) => entry.trim())
      .filter(Boolean);
    const candidates: Array<{ path: string; source: BonjourRuntimeSource }> = [];

    if (explicitPath) {
      candidates.push({ path: explicitPath, source: 'environment' });
    }

    const bundledCandidates = [
      isDev
        ? join(app.getAppPath(), 'resources', bonjourBinaryName)
        : join(process.resourcesPath, bonjourBinaryName),
      isDev ? join(app.getAppPath(), '..', 'resources', bonjourBinaryName) : undefined,
    ].filter((candidate): candidate is string => Boolean(candidate));
    for (const candidate of bundledCandidates) {
      candidates.push({ path: candidate, source: 'bundled' });
    }

    for (const entry of pathEntries) {
      candidates.push({ path: join(entry, bonjourBinaryName), source: 'system' });
    }

    for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) {
      if (!root) {
        continue;
      }
      candidates.push({ path: join(root, 'Bonjour', bonjourBinaryName), source: 'system' });
      candidates.push({
        path: join(root, 'Bonjour Print Services', bonjourBinaryName),
        source: 'system',
      });
    }

    const runtime = candidates.find((candidate) => existsSync(candidate.path));
    if (runtime) {
      log.info(`[SidecarManager] using Bonjour runtime at ${runtime.path}`);
      return {
        status: 'native',
        source: runtime.source,
        message: null,
        messageCode: 'bonjourNativeDetected',
        messageArgs: null,
        path: runtime.path,
        advertisedIP: null,
      };
    }

    log.warn(
      '[SidecarManager] Bonjour runtime not found; sidecar will fall back to built-in zeroconf',
    );
    return {
      status: 'fallback',
      source: 'fallback',
      message: null,
      messageCode: 'bonjourFallbackDetected',
      messageArgs: null,
      path: null,
      advertisedIP: null,
    };
  }

  async start(options: { reuseExisting?: boolean } = {}): Promise<void> {
    if (this.process) return;

    this.stopping = false;
    this.healthFailureRecoveryScheduled = false;
    this.clearRestartTimer();
    this.stopHealthCheck();
    const bonjour = this.detectBonjourRuntime();
    const reuseExisting = options.reuseExisting ?? !isDev;

    const existingHealth = reuseExisting ? await this.getHealthSnapshot() : null;
    if (existingHealth?.ok && this.canReuseExistingSidecar(existingHealth)) {
      this.restartCount = 0;
      this.startHealthCheck();
      this.setState({
        status: 'healthy',
        message: null,
        messageCode: null,
        messageArgs: null,
        lastExitCode: null,
        // Keep advertisedIP if it was already populated (e.g. from a previous
        // session where the sidecar stdout was captured).
        bonjour: { ...bonjour, advertisedIP: this.state.bonjour.advertisedIP },
      });
      log.info('[SidecarManager] reusing existing healthy sidecar');
      return;
    }
    if (existingHealth?.ok) {
      log.warn(
        '[SidecarManager] existing sidecar is healthy but lacks required capabilities; restarting bundled sidecar',
      );
      const killedExistingSidecar = await this.forceShutdownExistingSidecar();
      if (killedExistingSidecar) {
        await this.waitForSidecarToStop(SIDECAR_STOP_TIMEOUT_MS);
      }
    }

    if (!reuseExisting) {
      let shouldWaitForSidecarStop = await this.forceShutdownExistingSidecar();

      if (isDev) {
        const killedResidualProcesses = await this.forceShutdownResidualSidecars();
        shouldWaitForSidecarStop = shouldWaitForSidecarStop || killedResidualProcesses;
        await this.forceShutdownSyncFlowBonjourBroadcasts();
      }

      if (shouldWaitForSidecarStop) {
        await this.waitForSidecarToStop(SIDECAR_STOP_TIMEOUT_MS);
      }
    }

    const { command, args } = this.getSpawnArgs();
    const cwd = isDev ? join(app.getAppPath(), '..', '..', 'services', 'sidecar-go') : undefined;
    this.setState({
      status: 'starting',
      message: null,
      messageCode: this.restartCount > 0 ? 'retrying' : 'starting',
      messageArgs:
        this.restartCount > 0 ? { restart: this.restartCount, max: this.maxRestarts } : null,
      bonjour,
    });
    log.info(`[SidecarManager] starting: ${command} ${args.join(' ')}`);

    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        SYNCFLOW_CONFIG: '',
        CGO_ENABLED: '1',
        SYNCFLOW_DESKTOP_APP_VERSION: app.getVersion(),
        SYNCFLOW_APP_COMPATIBILITY_VERSION: String(APP_COMPATIBILITY_VERSION),
        ...(bonjour.path ? { SYNCFLOW_DNSSD_PATH: bonjour.path } : {}),
      },
    });
    this.process = child;

    child.stdout?.on('data', (data) => {
      try {
        const text = data.toString().trim();
        log.info(`[sidecar] ${text}`);
        // Extract the advertised IP from the structured log line emitted by
        // mdns.NewBroadcaster: {"msg":"bonjour broadcaster ip selected","ip":"x.x.x.x"}
        for (const line of text.split('\n')) {
          try {
            const parsed = JSON.parse(line) as Record<string, unknown>;
            if (
              parsed['msg'] === 'bonjour broadcaster ip selected' &&
              typeof parsed['ip'] === 'string'
            ) {
              this.setState({
                bonjour: { ...this.state.bonjour, advertisedIP: parsed['ip'] },
              });
            }
          } catch {
            /* non-JSON line – ignore */
          }
        }
      } catch {
        /* pipe closed */
      }
    });
    child.stderr?.on('data', (data) => {
      try {
        log.error(`[sidecar] ${data.toString().trim()}`);
      } catch {
        /* pipe closed */
      }
    });
    child.on('error', (err) => {
      if (this.process !== child) return;
      this.process = null;
      log.error(`[SidecarManager] process error: ${err.message}`);
      this.handleFailure('startFailed', null);
    });

    child.on('exit', (code) => {
      if (this.process !== child) return;
      this.process = null;
      log.warn(`[SidecarManager] process exited with code ${code}`);
      this.handleFailure('exited', code);
    });

    try {
      await this.waitForHealth(
        isDev ? DEV_HEALTHCHECK_RETRIES : PROD_HEALTHCHECK_RETRIES,
        HEALTHCHECK_INTERVAL_MS,
      );
      this.restartCount = 0;
      this.startHealthCheck();
      this.setState({
        status: 'healthy',
        message: null,
        messageCode: null,
        messageArgs: null,
        lastExitCode: null,
        // Preserve advertisedIP that may have been parsed from stdout during
        // waitForHealth — the `bonjour` snapshot captured before spawn still
        // has advertisedIP: null, so we must not overwrite the live value.
        bonjour: { ...bonjour, advertisedIP: this.state.bonjour.advertisedIP },
      });
      log.info('[SidecarManager] sidecar is healthy');
    } catch (err) {
      log.error('[SidecarManager] health wait failed', err);
      if (this.process === child && !child.killed) {
        child.kill('SIGTERM');
      }
      throw err;
    }
  }

  async retryStart(): Promise<void> {
    this.restartCount = 0;
    this.clearRestartTimer();
    await this.stop({
      killExternal: true,
      killResidualProcesses: true,
      killBonjourBroadcasts: true,
    });
    await this.start({ reuseExisting: false });
  }

  async stop(
    options: {
      killExternal?: boolean;
      killResidualProcesses?: boolean;
      killBonjourBroadcasts?: boolean;
    } = {},
  ): Promise<void> {
    this.stopping = true;
    this.clearRestartTimer();
    this.stopHealthCheck();
    if (this.process) {
      log.info('[SidecarManager] stopping sidecar');
      this.process.kill('SIGTERM');
      // Give it 5s to shutdown gracefully
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (this.process) this.process.kill('SIGKILL');
          resolve();
        }, 5000);
        this.process?.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
      this.process = null;
    }
    let shouldWaitForSidecarStop = false;
    if (options.killExternal) {
      const killedExistingSidecar = await this.forceShutdownExistingSidecar();
      shouldWaitForSidecarStop = killedExistingSidecar;
    }
    if (options.killResidualProcesses) {
      const killedResidualProcesses = await this.forceShutdownResidualSidecars();
      shouldWaitForSidecarStop = shouldWaitForSidecarStop || killedResidualProcesses;
    }
    if (options.killBonjourBroadcasts) {
      await this.forceShutdownSyncFlowBonjourBroadcasts();
    }
    if (shouldWaitForSidecarStop) {
      await this.waitForSidecarToStop(SIDECAR_STOP_TIMEOUT_MS);
    }
    this.setState({
      status: 'stopped',
      message: null,
      messageCode: null,
      messageArgs: null,
      bonjour: this.detectBonjourRuntime(),
    });
  }

  async healthCheck(): Promise<boolean> {
    const res = await this.getHealthSnapshot();
    return (
      res?.ok === true &&
      isCompatibleSidecarService(res.service) &&
      res.appCompatibilityVersion === APP_COMPATIBILITY_VERSION
    );
  }

  private async getHealthSnapshot(): Promise<SidecarHealth | null> {
    try {
      return await sidecarClient.getHealth();
    } catch {
      return null;
    }
  }

  private canReuseExistingSidecar(health: SidecarHealth): boolean {
    return supportsConnectionDeviceManagement(health);
  }

  private async isSidecarReachable(): Promise<boolean> {
    const res = await this.getHealthSnapshot();
    return res?.ok === true && isCompatibleSidecarService(res.service);
  }

  private async waitForHealth(retries: number, intervalMs: number): Promise<void> {
    for (let i = 0; i < retries; i++) {
      if (await this.healthCheck()) return;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error('Sidecar failed to become healthy');
  }

  private async waitForSidecarToStop(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!(await this.isSidecarReachable())) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error('Sidecar failed to stop');
  }

  private async forceShutdownExistingSidecar(): Promise<boolean> {
    const pids = await findListeningPIDs(SIDECAR_HTTP_PORT);
    const ownProcessPID = this.process?.pid ?? null;
    const externalPIDs = pids.filter((pid) => pid !== process.pid && pid !== ownProcessPID);

    if (externalPIDs.length === 0) {
      return false;
    }

    log.info(`[SidecarManager] force stopping existing sidecar PID(s): ${externalPIDs.join(', ')}`);
    for (const pid of externalPIDs) {
      await killProcessByPID(pid);
    }
    return true;
  }

  private async forceShutdownResidualSidecars(): Promise<boolean> {
    if (process.platform !== 'win32') {
      return false;
    }

    const ownProcessPID = this.process?.pid ?? null;
    const pids = await findProcessPIDsByName(sidecarBinaryName);
    const residualPIDs = pids.filter((pid) => pid !== process.pid && pid !== ownProcessPID);

    if (residualPIDs.length === 0) {
      return false;
    }

    log.info(
      `[SidecarManager] force stopping residual ${sidecarBinaryName} PID(s): ${residualPIDs.join(', ')}`,
    );
    for (const pid of residualPIDs) {
      await killProcessByPID(pid);
    }
    return true;
  }

  private async forceShutdownSyncFlowBonjourBroadcasts(): Promise<void> {
    const pids = await findSyncFlowBonjourBroadcastPIDs();
    if (pids.length === 0) {
      return;
    }

    log.info(
      `[SidecarManager] force stopping SyncFlow Bonjour broadcast PID(s): ${pids.join(', ')}`,
    );
    for (const pid of pids) {
      await killProcessByPID(pid);
    }
  }

  private startHealthCheck(): void {
    this.stopHealthCheck();
    this.healthInterval = setInterval(async () => {
      const ok = await this.healthCheck();
      if (!ok) {
        log.warn('[SidecarManager] health check failed');
        this.handleHealthCheckFailure();
      }
    }, 3000);
  }

  private stopHealthCheck(): void {
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }
  }

  private clearRestartTimer(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  private handleHealthCheckFailure(): void {
    if (this.stopping || this.healthFailureRecoveryScheduled) {
      return;
    }

    this.healthFailureRecoveryScheduled = true;
    this.stopHealthCheck();

    if (this.process && !this.process.killed) {
      log.warn('[SidecarManager] terminating unhealthy managed sidecar');
      this.process.kill('SIGTERM');
      return;
    }

    this.process = null;
    this.handleFailure('healthCheckFailed', null);
  }

  private handleFailure(messageCode: SidecarRuntimeMessageCode, code: number | null): void {
    this.stopHealthCheck();
    this.healthFailureRecoveryScheduled = false;

    if (this.stopping) {
      this.setState({
        status: 'stopped',
        message: null,
        messageCode: null,
        messageArgs: null,
        lastExitCode: code,
      });
      return;
    }

    if (this.restartCount < this.maxRestarts) {
      this.restartCount += 1;
      this.setState({
        status: 'starting',
        message: null,
        messageCode: 'retryingAfterFailure',
        messageArgs: this.runtimeMessageArgs(),
        lastExitCode: code,
      });
      log.info(`[SidecarManager] restarting (attempt ${this.restartCount}/${this.maxRestarts})`);
      this.clearRestartTimer();
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null;
        void this.start().catch((err) => {
          log.error('[SidecarManager] restart attempt failed', err);
        });
      }, 1000);
      return;
    }

    log.error('[SidecarManager] max restarts exceeded');
    this.setState({
      status: 'failed',
      message: null,
      messageCode: 'failedCheckExecutable',
      messageArgs: null,
      lastExitCode: code,
    });
  }

  private runtimeMessageArgs(): RuntimeMessageArgs {
    return { restart: this.restartCount, max: this.maxRestarts };
  }

  private setState(patch: Partial<SidecarRuntimeState>): void {
    this.state = {
      ...this.state,
      ...patch,
      restartCount: this.restartCount,
      maxRestarts: this.maxRestarts,
    };
    this.emit('state', this.getState());
  }
}

async function findListeningPIDs(port: number): Promise<number[]> {
  if (process.platform === 'win32') {
    try {
      const script = [
        `$connections = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess`,
        'if ($connections) { $connections | Sort-Object -Unique }',
      ].join('; ');
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script]);
      return stdout
        .split(/\r?\n/)
        .map((value) => Number(value.trim()))
        .filter((pid) => Number.isInteger(pid) && pid > 0);
    } catch {
      return [];
    }
  }

  try {
    const { stdout } = await execFileAsync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']);
    return stdout
      .split(/\r?\n/)
      .map((value) => Number(value.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

async function findProcessPIDsByName(processName: string): Promise<number[]> {
  if (process.platform !== 'win32') {
    return [];
  }

  try {
    const script = [
      `$processes = Get-CimInstance Win32_Process -Filter "Name='${processName}'" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProcessId`,
      'if ($processes) { $processes | Sort-Object -Unique }',
    ].join('; ');
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script]);
    return parsePIDList(stdout);
  } catch {
    return [];
  }
}

async function findSyncFlowBonjourBroadcastPIDs(): Promise<number[]> {
  try {
    if (process.platform === 'win32') {
      const script = [
        `$processes = Get-CimInstance Win32_Process -Filter "Name='${bonjourBinaryName}'" -ErrorAction SilentlyContinue | Where-Object {`,
        "  $_.CommandLine -match 'dns-sd(\\\\.exe)?\\s+-R' -and",
        "  $_.CommandLine -match '_syncflow\\._tcp' -and",
        "  $_.CommandLine -match 'local\\.'",
        '} | Select-Object -ExpandProperty ProcessId',
        'if ($processes) { $processes | Sort-Object -Unique }',
      ].join(' ');
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script]);
      return parsePIDList(stdout);
    }

    // macOS / Linux: use pgrep to find dns-sd processes advertising _syncflow._tcp
    const { stdout } = await execFileAsync('pgrep', ['-f', 'dns-sd.*_syncflow._tcp']);
    return parsePIDList(stdout);
  } catch {
    return [];
  }
}

function parsePIDList(stdout: string): number[] {
  return stdout
    .split(/\r?\n/)
    .map((value) => Number(value.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

async function killProcessByPID(pid: number): Promise<void> {
  if (process.platform === 'win32') {
    await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F']);
    return;
  }

  await execFileAsync('kill', ['-TERM', String(pid)]);
}
