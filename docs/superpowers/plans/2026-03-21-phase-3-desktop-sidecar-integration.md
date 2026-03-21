# Phase 3: Desktop ↔ Sidecar Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all mock data in the Electron desktop with real API calls to the running Go sidecar, including process lifecycle management, HTTP client, WebSocket event subscription, and live data binding.

**Architecture:** Electron main process spawns the Go sidecar binary as a child process, health-checks it, then proxies renderer IPC calls to sidecar HTTP endpoints. WebSocket connection from main process receives real-time events and forwards them to the renderer via IPC. Zustand stores fetch data on mount and update reactively from events.

**Tech Stack:** Electron 41, electron-vite 5, node:child_process, node:http, ws (WebSocket client), zustand 5

**Spec:** `docs/superpowers/specs/2026-03-21-syncflow-v2-spec.md` — Sections 5.5, 5.6, 5.7, 6.1, 6.2

**Depends on:** Phase 1 (Desktop Shell) + Phase 2 (Go Sidecar)

---

## Team Execution Strategy

```
T3.0 🔁 Sidecar HTTP client
T3.1 🔁 SidecarManager (real process lifecycle)
T3.2 🔁 IPC handlers → real HTTP calls
T3.3 🔁 WebSocket event bridge
T3.4 🔁 Stores → fetch on mount + event updates
T3.5 🔁 Integration verification + review
```

All tasks are sequential — each builds on the previous. No parallelism in this phase because they form a single integration pipeline touching overlapping files.

---

## File Structure

```
apps/desktop/src/
  main/
    sidecar-client.ts           NEW  — HTTP client wrapper for sidecar API
    sidecar-manager.ts          REWRITE — real child_process spawn/kill/health
    ipc-handlers.ts             REWRITE — mock returns → sidecar-client calls
    ws-bridge.ts                NEW  — WebSocket client → IPC event forwarding
    index.ts                    MODIFY — wire sidecar lifecycle + ws bridge
  renderer/
    stores/
      dashboard-store.ts        MODIFY — add fetch actions, remove mock init
      settings-store.ts         MODIFY — add fetch actions, remove mock init
      device-detail-store.ts    MODIFY — add fetch actions, remove mock init
    hooks/
      use-electron-api.ts       MODIFY — remove mock fallback (keep for browser dev)
    mocks/                      KEEP — still used for tests and browser dev
```

---

## Task 3.0 🔁 Sidecar HTTP Client

**Files:**
- Create: `apps/desktop/src/main/sidecar-client.ts`

- [ ] **Step 1: Create `sidecar-client.ts`**

A thin HTTP client that wraps `node:http` calls to the sidecar API at `http://127.0.0.1:39394`. Every method maps 1:1 to a sidecar endpoint.

```typescript
import http from 'node:http';
import { SIDECAR_HTTP_PORT } from '@syncflow/contracts';

const BASE = `http://127.0.0.1:${SIDECAR_HTTP_PORT}`;

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options: http.RequestOptions = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json' },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data) as T);
        } else {
          reject(new Error(`Sidecar ${method} ${path}: ${res.statusCode} ${data}`));
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

export const sidecarClient = {
  getHealth: () => request<{ ok: boolean; service: string }>('GET', '/health'),
  getDashboardSummary: () => request<import('@syncflow/contracts').DashboardSummaryDTO>('GET', '/dashboard/summary'),
  getDashboardDevices: () => request<import('@syncflow/contracts').DashboardDeviceDTO[]>('GET', '/dashboard/devices'),
  getDeviceDetail: (id: string) => request<import('@syncflow/contracts').DashboardDeviceDTO>('GET', `/devices/${id}`),
  getDeviceFiles: (id: string, date: string) => request<import('@syncflow/contracts').DeviceFileLedgerDTO[]>('GET', `/devices/${id}/files?date=${date}`),
  getDeviceDates: (id: string) => request<{ dates: string[] }>('GET', `/devices/${id}/dates`),
  getSettings: () => request<import('@syncflow/contracts').SettingsDTO>('GET', '/settings'),
  updateSettings: (s: Partial<import('@syncflow/contracts').SettingsDTO>) => request<import('@syncflow/contracts').SettingsDTO>('PUT', '/settings', s),
  regenerateConnectionCode: () => request<{ code: string }>('POST', '/connection-code/regenerate'),
  getShareStatus: () => request<import('@syncflow/contracts').ShareStatusDTO>('GET', '/share/status'),
  validateShare: () => request<import('@syncflow/contracts').ShareStatusDTO>('POST', '/share/validate'),
};
```

- [ ] **Step 2: Verify it compiles**

```bash
cd apps/desktop && npx electron-vite build
```

- [ ] **Step 3: Commit**

```
feat(desktop): add sidecar HTTP client wrapper
```

---

## Task 3.1 🔁 SidecarManager (Real Process Lifecycle)

**Files:**
- Rewrite: `apps/desktop/src/main/sidecar-manager.ts`

- [ ] **Step 1: Rewrite sidecar-manager.ts**

Replace the stub with real process management:

```typescript
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
      const sidecarDir = join(app.getAppPath(), '..', '..', 'services', 'sidecar-go');
      return { command: 'go', args: ['run', './cmd/syncflow-sidecar/'], };
    }
    // Production: bundled binary in app resources
    return { command: join(process.resourcesPath, 'syncflow-sidecar'), args: [] };
  }

  async start(): Promise<void> {
    const { command, args } = this.getSpawnArgs();
    const cwd = is.dev ? join(app.getAppPath(), '..', '..', 'services', 'sidecar-go') : undefined;
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
        log.info(`[SidecarManager] restarting (attempt ${this.restartCount}/${this.maxRestarts})`);
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
        this.process?.on('exit', () => { clearTimeout(timeout); resolve(); });
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
```

NOTE: This requires `electron-log` package. Add it to desktop dependencies.

- [ ] **Step 2: Add electron-log dependency**

```bash
cd /Volumes/workspace/work/sync-flow && pnpm --filter @syncflow/desktop add electron-log
```

- [ ] **Step 3: Verify build**

```bash
cd apps/desktop && npx electron-vite build
```

- [ ] **Step 4: Commit**

```
feat(desktop): implement real SidecarManager with process lifecycle
```

---

## Task 3.2 🔁 IPC Handlers → Real HTTP Calls

**Files:**
- Rewrite: `apps/desktop/src/main/ipc-handlers.ts`

- [ ] **Step 1: Rewrite ipc-handlers.ts**

Replace ALL mock returns with `sidecarClient` calls:

```typescript
import { ipcMain } from 'electron';
import { sidecarClient } from './sidecar-client';
import { openFolder, openFile, selectFolder, copyToClipboard } from './file-operations';

export const IPC = {
  SIDECAR_HEALTH:            'sidecar:health',
  SIDECAR_DASHBOARD_SUMMARY: 'sidecar:dashboard-summary',
  SIDECAR_DASHBOARD_DEVICES: 'sidecar:dashboard-devices',
  SIDECAR_DEVICE_DETAIL:     'sidecar:device-detail',
  SIDECAR_DEVICE_FILES:      'sidecar:device-files',
  SIDECAR_DEVICE_DATES:      'sidecar:device-dates',
  SIDECAR_SETTINGS:          'sidecar:settings',
  SIDECAR_UPDATE_SETTINGS:   'sidecar:update-settings',
  SIDECAR_REGENERATE_CODE:   'sidecar:regenerate-code',
  SIDECAR_SHARE_STATUS:      'sidecar:share-status',
  SIDECAR_VALIDATE_SHARE:    'sidecar:validate-share',
  FILES_OPEN_FOLDER:         'files:open-folder',
  FILES_OPEN_FILE:           'files:open-file',
  FILES_SELECT_FOLDER:       'files:select-folder',
  FILES_COPY_CLIPBOARD:      'files:copy-clipboard',
} as const;

export function registerIpcHandlers(): void {
  // Sidecar — real HTTP calls
  ipcMain.handle(IPC.SIDECAR_HEALTH, () => sidecarClient.getHealth());
  ipcMain.handle(IPC.SIDECAR_DASHBOARD_SUMMARY, () => sidecarClient.getDashboardSummary());
  ipcMain.handle(IPC.SIDECAR_DASHBOARD_DEVICES, () => sidecarClient.getDashboardDevices());
  ipcMain.handle(IPC.SIDECAR_DEVICE_DETAIL, (_e, deviceId: string) => sidecarClient.getDeviceDetail(deviceId));
  ipcMain.handle(IPC.SIDECAR_DEVICE_FILES, (_e, deviceId: string, date: string) => sidecarClient.getDeviceFiles(deviceId, date));
  ipcMain.handle(IPC.SIDECAR_DEVICE_DATES, (_e, deviceId: string) => sidecarClient.getDeviceDates(deviceId));
  ipcMain.handle(IPC.SIDECAR_SETTINGS, () => sidecarClient.getSettings());
  ipcMain.handle(IPC.SIDECAR_UPDATE_SETTINGS, (_e, partial) => sidecarClient.updateSettings(partial));
  ipcMain.handle(IPC.SIDECAR_REGENERATE_CODE, () => sidecarClient.regenerateConnectionCode());
  ipcMain.handle(IPC.SIDECAR_SHARE_STATUS, () => sidecarClient.getShareStatus());
  ipcMain.handle(IPC.SIDECAR_VALIDATE_SHARE, () => sidecarClient.validateShare());

  // File operations — real Electron APIs
  ipcMain.handle(IPC.FILES_OPEN_FOLDER, (_e, path: string) => openFolder(path));
  ipcMain.handle(IPC.FILES_OPEN_FILE, (_e, path: string) => openFile(path));
  ipcMain.handle(IPC.FILES_SELECT_FOLDER, () => selectFolder());
  ipcMain.handle(IPC.FILES_COPY_CLIPBOARD, (_e, text: string) => copyToClipboard(text));
}
```

- [ ] **Step 2: Verify build**

- [ ] **Step 3: Commit**

```
feat(desktop): wire IPC handlers to real sidecar HTTP calls
```

---

## Task 3.3 🔁 WebSocket Event Bridge

**Files:**
- Create: `apps/desktop/src/main/ws-bridge.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/preload/index.ts`

- [ ] **Step 1: Create ws-bridge.ts**

```typescript
import WebSocket from 'ws';
import { BrowserWindow } from 'electron';
import log from 'electron-log';
import { SIDECAR_HTTP_PORT } from '@syncflow/contracts';
import type { SidecarEvent } from '@syncflow/contracts';

export class WsBridge {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private getWindow: () => BrowserWindow | null) {}

  connect(): void {
    const url = `ws://127.0.0.1:${SIDECAR_HTTP_PORT}/events/stream`;
    log.info(`[WsBridge] connecting to ${url}`);

    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      log.info('[WsBridge] connected');
    });

    this.ws.on('message', (data) => {
      try {
        const event: SidecarEvent = JSON.parse(data.toString());
        const win = this.getWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send('sidecar:event', event);
        }
      } catch (err) {
        log.warn('[WsBridge] failed to parse event', err);
      }
    });

    this.ws.on('close', () => {
      log.info('[WsBridge] disconnected, reconnecting in 3s');
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      log.warn('[WsBridge] error', err.message);
    });
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private scheduleReconnect(): void {
    this.reconnectTimer = setTimeout(() => this.connect(), 3000);
  }
}
```

- [ ] **Step 2: Add `ws` dependency**

```bash
pnpm --filter @syncflow/desktop add ws
pnpm --filter @syncflow/desktop add -D @types/ws
```

- [ ] **Step 3: Update preload to forward sidecar events**

In `src/preload/index.ts`, update the `events.onSidecarEvent` implementation:

```typescript
// Replace the stub:
onSidecarEvent: (callback) => {
  const handler = (_event: IpcRendererEvent, data: SidecarEvent) => callback(data);
  ipcRenderer.on('sidecar:event', handler);
  return () => ipcRenderer.removeListener('sidecar:event', handler);
},
```

- [ ] **Step 4: Update main/index.ts to wire SidecarManager + WsBridge**

In `src/main/index.ts`, update the `app.whenReady()` block:

```typescript
import { SidecarManager } from './sidecar-manager';
import { WsBridge } from './ws-bridge';
import { registerIpcHandlers } from './ipc-handlers';

const sidecar = new SidecarManager();
let wsBridge: WsBridge;

app.whenReady().then(async () => {
  registerIpcHandlers();

  // Start sidecar, then connect WebSocket
  await sidecar.start();
  wsBridge = new WsBridge(() => mainWindow);
  wsBridge.connect();

  await createMainWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on('before-quit', async () => {
  wsBridge?.disconnect();
  await sidecar.stop();
});
```

- [ ] **Step 5: Verify build**

- [ ] **Step 6: Commit**

```
feat(desktop): WebSocket event bridge — sidecar events → renderer IPC
```

---

## Task 3.4 🔁 Stores → Fetch on Mount + Event Updates

**Files:**
- Modify: `apps/desktop/src/renderer/stores/dashboard-store.ts`
- Modify: `apps/desktop/src/renderer/stores/settings-store.ts`
- Modify: `apps/desktop/src/renderer/stores/device-detail-store.ts`
- Modify: `apps/desktop/src/renderer/features/layout/AppShell.tsx`

- [ ] **Step 1: Add fetch actions to dashboard-store**

```typescript
import type { DashboardSummaryDTO, DashboardDeviceDTO } from '@syncflow/contracts';

// Add to DashboardState interface:
fetchDashboard: () => Promise<void>;

// Implementation:
fetchDashboard: async () => {
  const api = window.electronAPI;
  if (!api) return;
  try {
    const [summary, devices] = await Promise.all([
      api.sidecar.getDashboardSummary(),
      api.sidecar.getDashboardDevices(),
    ]);
    set({ summary, devices: sortDevices(devices) });
  } catch (err) {
    console.error('Failed to fetch dashboard:', err);
  }
},
```

Remove mock data imports as default initializers — set empty defaults:
```typescript
summary: { todayUploadCount: 0, todayOccupiedBytes: 0, remainingBytes: 0, isDiskLow: false },
devices: [],
```

- [ ] **Step 2: Add fetch actions to settings-store**

Similar pattern: `fetchSettings: () => Promise<void>` that calls `api.sidecar.getSettings()`.

Default init with empty settings instead of mock.

- [ ] **Step 3: Add fetch actions to device-detail-store**

```typescript
fetchDeviceFiles: async (deviceId: string, date?: string) => {
  const api = window.electronAPI;
  if (!api) return;
  set({ loading: true });
  try {
    const selectedDate = date || get().selectedDate;
    const [filesRes, datesRes] = await Promise.all([
      api.sidecar.getDeviceFiles(deviceId, selectedDate),
      api.sidecar.getDeviceDates(deviceId),
    ]);
    set({
      files: filesRes,
      availableDates: datesRes.dates,
      selectedDate,
      loading: false,
    });
  } catch (err) {
    console.error('Failed to fetch device files:', err);
    set({ loading: false });
  }
},
```

Default init with empty arrays instead of mock.

- [ ] **Step 4: Add data fetching to AppShell**

In `AppShell.tsx`, add a `useEffect` that fetches on mount:

```tsx
import { useDashboardStore } from '@renderer/stores/dashboard-store';
import { useSettingsStore } from '@renderer/stores/settings-store';

// Inside AppShell component:
useEffect(() => {
  useDashboardStore.getState().fetchDashboard();
  useSettingsStore.getState().fetchSettings();
}, []);
```

- [ ] **Step 5: Add event listener for real-time updates**

In AppShell, subscribe to sidecar events:

```tsx
useEffect(() => {
  const api = window.electronAPI;
  if (!api) return;
  const unsub = api.events.onSidecarEvent((event) => {
    switch (event.type) {
      case 'dashboard.updated':
        useDashboardStore.getState().updateSummary(event.payload);
        break;
      case 'device.state.changed':
        useDashboardStore.getState().fetchDashboard(); // re-fetch full list
        break;
      case 'upload.progress':
      case 'upload.completed':
      case 'upload.failed':
        useDashboardStore.getState().fetchDashboard();
        break;
      case 'disk.low':
        useDashboardStore.getState().updateSummary({
          ...useDashboardStore.getState().summary,
          isDiskLow: true,
          remainingBytes: event.payload.remainingBytes,
        });
        break;
      case 'share.status.changed':
        useSettingsStore.getState().fetchSettings();
        break;
      case 'history.updated':
      case 'sync.summary.updated':
        // These are mobile-facing events, no desktop action needed
        break;
    }
  });
  return unsub;
}, []);
```

- [ ] **Step 6: Update DeviceDetailModal to fetch on open**

In `DeviceDetailModal.tsx`, when modal opens with a device:
```tsx
useEffect(() => {
  if (isModalOpen && selectedDevice) {
    useDeviceDetailStore.getState().fetchDeviceFiles(selectedDevice.deviceId);
  }
}, [isModalOpen, selectedDevice]);
```

- [ ] **Step 7: Update store tests**

Adjust store tests to work with the new empty defaults (instead of mock data). Tests should set data via store actions before asserting.

- [ ] **Step 8: Run tests + build**

```bash
cd /Volumes/workspace/work/sync-flow && pnpm check
```

- [ ] **Step 9: Commit**

```
feat(desktop): stores fetch from sidecar API + WebSocket event updates
```

---

## Task 3.5 🔁 Integration Verification + Review

- [ ] **Step 1: Build the Go sidecar binary**

```bash
cd services/sidecar-go && go build -o syncflow-sidecar ./cmd/syncflow-sidecar/
```

- [ ] **Step 2: Full build + test**

```bash
pnpm check
```

All tests pass, all builds succeed.

- [ ] **Step 3: Manual integration test**

```bash
# Terminal 1: Start sidecar
cd services/sidecar-go && ./syncflow-sidecar

# Terminal 2: Start desktop
pnpm dev:desktop
```

Verify:
- [ ] Electron window opens
- [ ] Dashboard shows real data from sidecar (may be empty — no paired devices yet)
- [ ] Settings page shows real connection code (auto-generated, not "839274")
- [ ] Settings page shows real receive path
- [ ] Regenerate connection code works (changes in sidecar DB)
- [ ] No console errors in DevTools

- [ ] **Step 4: Dispatch code reviewer**

Review scope: all Phase 3 changes. Criteria:
- Error handling (sidecar down, network failure, timeouts)
- No mock data leaking into production paths
- IPC channel names match between main and preload
- WebSocket reconnection logic
- Store fetch/update patterns (no race conditions)
- electron-log usage consistent

- [ ] **Step 5: Fix review findings**

- [ ] **Step 6: Commit**

```
chore: Phase 3 complete — Desktop integrated with real Go sidecar
```

---

## Verification Summary

### Phase 3 Gate

```bash
# All TS tests pass
pnpm turbo test

# All TS types check
pnpm turbo typecheck

# Desktop builds
cd apps/desktop && npx electron-vite build

# Go tests still pass
cd services/sidecar-go && go test ./...

# Integration: sidecar + desktop launch together
# (manual verification — sidecar running, desktop shows real data)
```
