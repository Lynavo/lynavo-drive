// ── 3.1 Protocol Constants ──

export const PROTOCOL_VERSION = 'LMUP/2';
export { APP_COMPATIBILITY_VERSION } from './version.generated';
export const PROTOCOL_PORT = 39593;
export const SIDECAR_HTTP_PORT = 39594;
export const BONJOUR_SERVICE_TYPE = '_lynavodrive._tcp';
export const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MiB
export const HEARTBEAT_INTERVAL_MS = 15_000;
export const HEARTBEAT_TIMEOUT_MS = 45_000;
export const LOW_DISK_THRESHOLD_BYTES = 500 * 1024 * 1024; // 500 MB
export const BACKOFF_RETRY_MS = [5_000, 15_000, 30_000] as const;

// ── 3.2 LMUP Message Types ──

export const MessageType = {
  HELLO_REQ: 0x0001,
  HELLO_RES: 0x0002,
  PAIR_REQ: 0x0003,
  PAIR_RES: 0x0004,
  SYNC_BEGIN_REQ: 0x0005,
  SYNC_BEGIN_RES: 0x0006,
  FILE_INIT_REQ: 0x0007,
  FILE_INIT_RES: 0x0008,
  FILE_DATA: 0x0009,
  FILE_ACK: 0x000a,
  FILE_END_REQ: 0x000b,
  FILE_END_RES: 0x000c,
  SYNC_END_REQ: 0x000d,
  SYNC_END_RES: 0x000e,
  PING: 0x000f,
  PONG: 0x0010,
  ERROR: 0x0011,
  AUTH_REQ: 0x0012,
  AUTH_RES: 0x0013,
  PAIRING_INVALIDATED: 0x0014,
} as const;
export type MessageType = (typeof MessageType)[keyof typeof MessageType];
