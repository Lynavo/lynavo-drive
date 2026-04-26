import * as Keychain from 'react-native-keychain';

let cachedAuthDeviceId: string | null = null;
let inflightAuthDeviceId: Promise<string> | null = null;

function generateDeviceId(): string {
  const bytes = new Uint8Array(16);
  const cryptoObj = (
    globalThis as {
      crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array };
    }
  ).crypto;

  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, byte =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

export async function getOrCreateAuthDeviceId(): Promise<string> {
  if (cachedAuthDeviceId) {
    return cachedAuthDeviceId;
  }
  if (inflightAuthDeviceId) {
    return inflightAuthDeviceId;
  }

  inflightAuthDeviceId = loadOrCreateAuthDeviceId();
  try {
    cachedAuthDeviceId = await inflightAuthDeviceId;
    return cachedAuthDeviceId;
  } finally {
    inflightAuthDeviceId = null;
  }
}

async function loadOrCreateAuthDeviceId(): Promise<string> {
  const service = 'cn.vividrop.auth-device-id';
  const account = 'auth-device-id';

  try {
    const existing = await Keychain.getGenericPassword({ service });
    if (existing !== false && existing.password) {
      return existing.password;
    }
  } catch (err) {
    console.warn('[auth-device-id] failed to read keychain device id', err);
  }

  const generated = generateDeviceId();

  try {
    await Keychain.setGenericPassword(account, generated, {
      service,
      accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  } catch (err) {
    console.warn('[auth-device-id] failed to persist keychain device id', err);
  }

  return generated;
}
