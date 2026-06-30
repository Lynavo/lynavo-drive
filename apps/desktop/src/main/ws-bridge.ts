import WebSocket from 'ws';
import { BrowserWindow } from 'electron';
import log from 'electron-log';
import { SIDECAR_HTTP_PORT, type SidecarEvent } from '@lynavo-drive/contracts';

export class WsBridge {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manualDisconnect = false;

  constructor(
    private getWindow: () => BrowserWindow | null,
    private onSidecarEvent: (event: SidecarEvent) => void = () => undefined,
  ) {}

  connect(): void {
    this.manualDisconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const url = `ws://127.0.0.1:${SIDECAR_HTTP_PORT}/events/stream`;
    log.info(`[WsBridge] connecting to ${url}`);

    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on('open', () => {
      if (this.ws !== ws) {
        return;
      }
      log.info('[WsBridge] connected');
    });

    ws.on('message', (data) => {
      if (this.ws !== ws) {
        return;
      }
      let event: SidecarEvent;
      try {
        event = JSON.parse(data.toString()) as SidecarEvent;
      } catch (err) {
        log.warn('[WsBridge] failed to parse event', err);
        return;
      }

      try {
        this.onSidecarEvent(event);
      } catch (err) {
        log.warn('[WsBridge] sidecar event listener failed', err);
      }

      const win = this.getWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('sidecar:event', event);
      }
    });

    ws.on('close', (code, reason) => {
      const wasManualDisconnect = this.manualDisconnect;
      if (this.ws === ws) {
        this.ws = null;
      }

      const reasonText = reason?.toString('utf8') || '';

      if (wasManualDisconnect) {
        log.info(`[WsBridge] disconnected code=${code} reason=${reasonText}`);
        return;
      }

      log.info(`[WsBridge] disconnected, reconnecting in 3s code=${code} reason=${reasonText}`);
      this.scheduleReconnect();
    });

    ws.on('error', (err) => {
      if (this.ws !== ws) {
        return;
      }
      log.warn('[WsBridge] error', err.message, '; readyState=', ws.readyState);
    });
  }

  disconnect(): void {
    this.manualDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.close();
    }
  }

  private scheduleReconnect(): void {
    if (this.manualDisconnect || this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.manualDisconnect) {
        return;
      }
      this.connect();
    }, 3000);
  }
}
