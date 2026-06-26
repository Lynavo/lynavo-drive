import AsyncStorage from '@react-native-async-storage/async-storage';
import { VIVIDROP_REVIEW_API_BASE_URL } from '@syncflow/contracts';

import { marketConfig } from '../markets';
import { releaseApiBaseUrl } from '../release-profile';

// ---------------------------------------------------------------------------
// Backend configuration
// ---------------------------------------------------------------------------

// ============================================================================
// DEVELOPER NOTE — REAL-DEVICE DEBUG REQUIRES OVERRIDE
// ============================================================================
//
// The built-in default below points at production. App Review routing is handled
// by `APP_REVIEW_PHONE`, so normal debug sessions exercise the same config
// switches as production unless a developer override is set.
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

export const PROD_BASE_URL = releaseApiBaseUrl ?? marketConfig.apiBaseUrl;
export const REVIEW_API_BASE_URL = marketConfig.reviewApiBaseUrl;
export const APP_REVIEW_PHONE = marketConfig.appReviewPhone;
export const APP_REVIEW_EMAIL = marketConfig.appReviewEmail;

// Default backend for normal debug sessions. Use setDebugBaseUrlOverride() for
// temporary per-device overrides without changing this shared default.
export const DEV_API_BASE_URL: string =
  releaseApiBaseUrl ?? VIVIDROP_REVIEW_API_BASE_URL;

const DEBUG_OVERRIDE_STORAGE_KEY = '@vividrop/debug/api_base_url';
const SESSION_BASE_URL_STORAGE_KEY = '@vividrop/auth/api_base_url';

// In-memory cache of the AsyncStorage override; set by loadDebugBaseUrlOverride()
// at app startup so the very first request can see it without a sync read.
let _debugOverride: string | null = null;
let _sessionBaseUrl: string | null = null;
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
export async function setDebugBaseUrlOverride(
  url: string | null,
): Promise<void> {
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

export function resolveAuthBaseUrlForPhone(phone: string): string {
  if (_debugOverride) return _debugOverride;
  if (normalizePhoneDigits(phone) === APP_REVIEW_PHONE) {
    return REVIEW_API_BASE_URL;
  }
  return getBuiltInBaseUrl();
}

export function resolveAuthBaseUrlForEmail(email: string): string {
  if (_debugOverride) return _debugOverride;
  if (email.trim().toLowerCase() === APP_REVIEW_EMAIL.toLowerCase()) {
    return REVIEW_API_BASE_URL;
  }
  return getBuiltInBaseUrl();
}

export async function loadSessionBaseUrl(): Promise<void> {
  try {
    const v = await AsyncStorage.getItem(SESSION_BASE_URL_STORAGE_KEY);
    if (v && /^https?:\/\//.test(v) && !shouldIgnoreSessionBaseUrl(v)) {
      _sessionBaseUrl = v;
      return;
    }
    _sessionBaseUrl = null;
    if (v && shouldIgnoreSessionBaseUrl(v)) {
      await AsyncStorage.removeItem(SESSION_BASE_URL_STORAGE_KEY);
    }
  } catch {
    _sessionBaseUrl = null;
  }
}

export async function setSessionBaseUrl(url: string): Promise<void> {
  if (!/^https?:\/\//.test(url)) {
    throw new Error('session base URL must start with http:// or https://');
  }
  _sessionBaseUrl = url;
  try {
    await AsyncStorage.setItem(SESSION_BASE_URL_STORAGE_KEY, url);
  } catch (err) {
    console.warn('[config] failed to persist session API base URL', err);
  }
}

export async function clearSessionBaseUrl(): Promise<void> {
  _sessionBaseUrl = null;
  try {
    await AsyncStorage.removeItem(SESSION_BASE_URL_STORAGE_KEY);
  } catch (err) {
    console.warn('[config] failed to clear session API base URL', err);
  }
}

export function getSessionBaseUrl(): string | null {
  return _sessionBaseUrl;
}

export function getBaseUrl(): string {
  if (_debugOverride) return _debugOverride;
  if (_sessionBaseUrl && !shouldIgnoreSessionBaseUrl(_sessionBaseUrl)) {
    return _sessionBaseUrl;
  }
  return getBuiltInBaseUrl();
}

function shouldIgnoreSessionBaseUrl(url: string): boolean {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return false;
  if (DEV_API_BASE_URL === PROD_BASE_URL) return false;
  return url === PROD_BASE_URL;
}

function getBuiltInBaseUrl(): string {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    if (DEV_API_BASE_URL !== PROD_BASE_URL && !_warnedRealDeviceLoopback) {
      _warnedRealDeviceLoopback = true;
      console.warn(
        `[config] using DEV_API_BASE_URL="${DEV_API_BASE_URL}". ` +
          `Call setDebugBaseUrlOverride('http://<host>') to point this dev build at another backend.`,
      );
    }
    return DEV_API_BASE_URL;
  }
  return PROD_BASE_URL;
}

function normalizePhoneDigits(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length === 13 && digits.startsWith('86')
    ? digits.slice(2)
    : digits;
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
