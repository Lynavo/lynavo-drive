import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ---------------------------------------------------------------------------
// Backend configuration
// ---------------------------------------------------------------------------

// ============================================================================
// DEVELOPER NOTE — REAL-DEVICE DEBUG REQUIRES OVERRIDE
// ============================================================================
//
// The defaults below ONLY work for iOS Simulator (`localhost`) and Android
// Emulator (`10.0.2.2`). On a real iPhone or Android phone these resolve to
// the device itself and your dev API will never be reached.
//
// To debug against your dev backend on a real device, do ONE of:
//
//   (a) Edit `DEV_API_BASE_URL` below to your dev machine's LAN IP
//       (e.g. 'http://192.168.1.42:8080'). Quick but easy to commit by
//       accident.
//
//   (b) Call `setDebugBaseUrlOverride('http://192.168.1.42:8080')` once
//       (e.g. from a hidden settings screen, a Metro tap, or temporarily
//       from `App.tsx`). The value persists in AsyncStorage and is loaded
//       eagerly at startup via `loadDebugBaseUrlOverride()`.
//
//   (c) Future: integrate `react-native-config` for a proper .env mechanism
//       so each developer's local override stays out of git automatically.
// ============================================================================

// iOS: LAN IP so real devices on the same WiFi can reach the Mac-hosted dev
// server. iOS Simulator still works because the simulator shares the Mac's
// network stack (LAN IP resolves to the Mac via the WiFi interface).
// Android: 10.0.2.2 is the emulator's special loopback alias for the host.
// Real Android device needs its own LAN-IP override (see option B above).
// NOTE (2026-04-18, Task 22 sandbox testing): temporarily pointing iOS at the
// Sandbox-mode CVM so physical-device IAP receipts can round-trip through the
// same backend Apple's V2 webhook hits. Revert before committing anything else.
const DEV_API_BASE_URL: string =
  Platform.OS === 'android' ? 'http://10.0.2.2:8080' : 'https://api.vividrop.cn';

// TODO: replace with the real production hostname before shipping. Wire via
// react-native-config / a build-time constant injected by CI.
const PROD_BASE_URL = 'https://api.vividrop.cn';

const DEBUG_OVERRIDE_STORAGE_KEY = '@vividrop/debug/api_base_url';

// In-memory cache of the AsyncStorage override; set by loadDebugBaseUrlOverride()
// at app startup so the very first request can see it without a sync read.
let _debugOverride: string | null = null;
let _warnedRealDeviceLoopback = false;

/**
 * Load any persisted debug override from AsyncStorage. Call once at app
 * startup BEFORE the first API request fires. No-op in release builds.
 */
export async function loadDebugBaseUrlOverride(): Promise<void> {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  try {
    const v = await AsyncStorage.getItem(DEBUG_OVERRIDE_STORAGE_KEY);
    if (v && /^https?:\/\//.test(v)) {
      _debugOverride = v;
      console.log(`[config] using debug API base URL override: ${v}`);
    }
  } catch {
    /* ignore — fall back to default */
  }
}

/**
 * Set / clear the debug override. Persists to AsyncStorage so subsequent
 * cold starts pick it up automatically. Pass `null` to revert to the
 * built-in default. Dev-builds only — silently ignored in release.
 */
export async function setDebugBaseUrlOverride(url: string | null): Promise<void> {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  if (url !== null && !/^https?:\/\//.test(url)) {
    throw new Error('debug base URL must start with http:// or https://');
  }
  _debugOverride = url;
  if (url === null) {
    await AsyncStorage.removeItem(DEBUG_OVERRIDE_STORAGE_KEY);
  } else {
    await AsyncStorage.setItem(DEBUG_OVERRIDE_STORAGE_KEY, url);
  }
}

export function getDebugBaseUrlOverride(): string | null {
  return _debugOverride;
}

export function getBaseUrl(): string {
  if (_debugOverride) return _debugOverride;
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    if (!_warnedRealDeviceLoopback) {
      _warnedRealDeviceLoopback = true;
      console.warn(
        `[config] using DEV_API_BASE_URL="${DEV_API_BASE_URL}" — this only ` +
          `reaches your dev API from the iOS Simulator / Android Emulator. ` +
          `On a real device, call setDebugBaseUrlOverride('http://<your-LAN-IP>:8080').`,
      );
    }
    return DEV_API_BASE_URL;
  }
  return PROD_BASE_URL;
}

// Returns null if the URL is acceptable, otherwise an error message describing
// why it was rejected. Designed to be invoked per-request so a misconfigured
// release build surfaces a typed API error rather than crashing at import.
export function describeInsecureBaseUrl(url: string): string | null {
  if (url.startsWith('https://')) return null;
  const isLocalLoopback =
    /^http:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)(:|\/|$)/.test(url);
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    // Dev: allow loopbacks AND any LAN address the developer set via override.
    return null;
  }
  if (isLocalLoopback) {
    return `Backend BASE_URL must use HTTPS in release builds (got "${url}")`;
  }
  return `Backend BASE_URL must use HTTPS in release builds (got "${url}")`;
}
