import { spawn, ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { app } from 'electron';
import { is } from '@electron-toolkit/utils';
import log from 'electron-log';
import { sidecarClient } from './sidecar-client';

export class SidecarManager {
  private process: ChildProcess | null = null;
  private restartCount = 0;
  private maxRestarts = 3;
  private healthInterval: ReturnType<typeof setInterval> | null = null;

  private getSpawnArgs(): { command: string; args: string[] } {
    if (is.dev) {
      // Dev mode: use `go run` from source
      return { command: 'go', args: ['run', './cmd/syncflow-sidecar/'] };
    }
    // Production: bundled binary in app resources
    return { command: join(process.resourcesPath, 'syncflow-sidecar'), args: [] };
  }

  async start(): Promise<void> {
    const { command, args } = this.getSpawnArgs();
    const cwd = is.dev
      ? join(app.getAppPath(), '..', '..', 'services', 'sidecar-go')
      : undefined;
    log.info(`[SidecarManager] starting: ${command} ${args.join(' ')}`);

    this.process = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, SYNCFLOW_CONFIG: '', CGO_ENABLED: '1' },
    });

    this.process.stdout?.on('data', (data) => {
      log.info(`[sidecar] ${data.toString().trim()}`);
    });
    this.process.stderr?.on('data', (data) => {
      log.error(`[sidecar] ${data.toString().trim()}`);
    });

    this.process.on('exit', (code) => {
      log.warn(`[SidecarManager] process exited with code ${code}`);
      this.process = null;
      if (this.restartCount < this.maxRestarts) {
        this.restartCount++;
        log.info(
          `[SidecarManager] restarting (attempt ${this.restartCount}/${this.maxRestarts})`,
        );
        setTimeout(() => this.start(), 1000);
      } else {
        log.error('[SidecarManager] max restarts exceeded');
      }
    });

    // Wait for health
    await this.waitForHealth(10, 500);
    this.startHealthCheck();
    log.info('[SidecarManager] sidecar is healthy');
  }

  async stop(): Promise<void> {
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
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await sidecarClient.getHealth();
      return res.ok === true;
    } catch {
      return false;
    }
  }

  private async waitForHealth(retries: number, intervalMs: number): Promise<void> {
    for (let i = 0; i < retries; i++) {
      if (await this.healthCheck()) return;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error('Sidecar failed to become healthy');
  }

  private startHealthCheck(): void {
    this.healthInterval = setInterval(async () => {
      const ok = await this.healthCheck();
      if (!ok) {
        log.warn('[SidecarManager] health check failed');
      }
    }, 3000);
  }

  private stopHealthCheck(): void {
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }
  }
}
