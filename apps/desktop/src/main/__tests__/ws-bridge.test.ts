import { beforeEach, describe, expect, it, vi } from 'vitest';

type MessageHandler = (data: Buffer) => void;

const wsMockState = vi.hoisted(() => {
  let messageHandler: MessageHandler | null = null;
  const instance = {
    readyState: 0,
    on: vi.fn((event: string, handler: MessageHandler) => {
      if (event === 'message') {
        messageHandler = handler;
      }
    }),
    close: vi.fn(),
  };
  function WebSocketMock() {
    return instance;
  }
  return {
    instance,
    WebSocket: vi.fn(WebSocketMock),
    emitMessage: (payload: unknown) => {
      messageHandler?.(Buffer.from(JSON.stringify(payload)));
    },
  };
});

vi.mock('ws', () => ({
  default: Object.assign(wsMockState.WebSocket, {
    OPEN: 1,
    CONNECTING: 0,
  }),
}));

vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('WsBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('notifies main process listeners when sidecar events arrive', async () => {
    const { WsBridge } = await import('../ws-bridge');
    const onSidecarEvent = vi.fn();
    const window = {
      isDestroyed: () => false,
      webContents: {
        send: vi.fn(),
      },
    };

    const bridge = new WsBridge(() => window as never, onSidecarEvent);
    bridge.connect();
    wsMockState.emitMessage({
      type: 'transfer.active.changed',
      payload: { isActive: true },
    });

    expect(onSidecarEvent).toHaveBeenCalledWith({
      type: 'transfer.active.changed',
      payload: { isActive: true },
    });
    expect(window.webContents.send).toHaveBeenCalledWith('sidecar:event', {
      type: 'transfer.active.changed',
      payload: { isActive: true },
    });
  });

  it('still forwards sidecar events to renderer when main process listener fails', async () => {
    const { WsBridge } = await import('../ws-bridge');
    const onSidecarEvent = vi.fn(() => {
      throw new Error('listener failed');
    });
    const window = {
      isDestroyed: () => false,
      webContents: {
        send: vi.fn(),
      },
    };

    const bridge = new WsBridge(() => window as never, onSidecarEvent);
    bridge.connect();
    wsMockState.emitMessage({
      type: 'transfer.active.changed',
      payload: { isActive: true },
    });

    expect(window.webContents.send).toHaveBeenCalledWith('sidecar:event', {
      type: 'transfer.active.changed',
      payload: { isActive: true },
    });
  });
});
