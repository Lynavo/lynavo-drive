import i18next from 'i18next';
import { NativeModules, Platform } from 'react-native';
import { getOrCreateAuthDeviceId } from './auth-device-id';
import { describeInsecureBaseUrl, getBaseUrl } from './config';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const API_PREFIX = '/api/v1';

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

export const ERROR_CODE = {
  TOKEN_INVALID: 1006,
  SESSION_REPLACED: 1009,
  SERVER_ERROR: 9002,
  NETWORK_ERROR: 9004,
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

export class ApiError extends Error {
  code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// Default request timeout. No fetch should ever hang the UI indefinitely
// because of a black-holing captive portal or an unresponsive server.
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const AUTH_DEVICE_ID_HEADER = 'X-Auth-Device-Id';
const CLIENT_APP_HEADER = 'X-Client-App';
const CLIENT_PLATFORM_HEADER = 'X-Client-Platform';
const CLIENT_VERSION_HEADER = 'X-Client-Version';
const CLIENT_BUILD_HEADER = 'X-Client-Build';

// On iOS, the first fetch after a cold start can fail with
// NSURLErrorCannotFindHost (-1003) when the DNS resolver hasn't warmed up.
// CFNetwork then caches that "0 endpoints" result for a short TTL
// (typically ~1s), causing every subsequent request to the same host to
// fail in ~1ms from the negative cache. Waiting past the TTL before a
// single silent retry converts that first-request-after-cold-start failure
// into a success the user never sees. 1000 ms is the sweet spot: long
// enough to outlast the common negative-TTL, short enough to stay below
// the ~2s range where users start tapping again.
const NETWORK_RETRY_DELAY_MS = 1_000;

interface RequestOptions {
  /** Legacy option retained for callers; OSS requests never inject bearer auth. */
  skipAuth?: boolean;
  /** Override the default request timeout (ms). */
  timeoutMs?: number;
  /** Route this request to a specific API base URL. */
  baseUrlOverride?: string;
}

export function buildUrl(path: string, baseUrlOverride?: string): string {
  // Resolve and validate per-request: a misconfigured release build raises
  // a typed ApiError instead of crashing the bundle at module-load time.
  const baseUrl = baseUrlOverride ?? getBaseUrl();
  const insecure = describeInsecureBaseUrl(baseUrl);
  if (insecure) {
    throw new ApiError(ERROR_CODE.NETWORK_ERROR, insecure);
  }
  return `${baseUrl}${API_PREFIX}${path}`;
}

export function authHeaders(): Record<string, string> {
  // Official account bearer auth is disabled in the OSS runtime. LAN pairing
  // and sidecar HMAC access use their own local credentials.
  return {};
}

type NativeAppInfoModule = {
  getAppInfo?: () => Promise<{
    version?: unknown;
    build?: unknown;
  }>;
};

let _clientInfoHeaders: Record<string, string> | null = null;
let _clientInfoHeadersPromise: Promise<Record<string, string>> | null = null;

function normalizeHeaderValue(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value).trim();
  return normalized || null;
}

async function resolveClientInfoHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    [CLIENT_APP_HEADER]: 'lynavo-drive-mobile',
    [CLIENT_PLATFORM_HEADER]: Platform.OS,
  };

  try {
    const nativeSyncEngine = NativeModules.NativeSyncEngine as
      | NativeAppInfoModule
      | undefined;
    const appInfo = await nativeSyncEngine?.getAppInfo?.();
    const version = normalizeHeaderValue(appInfo?.version);
    const build = normalizeHeaderValue(appInfo?.build);
    if (version) headers[CLIENT_VERSION_HEADER] = version;
    if (build) headers[CLIENT_BUILD_HEADER] = build;
  } catch {
    // Keep API requests moving even if the native module is not ready yet.
  }

  return headers;
}

export function clientInfoHeaders(): Promise<Record<string, string>> {
  if (_clientInfoHeaders) return Promise.resolve(_clientInfoHeaders);
  if (!_clientInfoHeadersPromise) {
    _clientInfoHeadersPromise = resolveClientInfoHeaders()
      .then(headers => {
        if (headers[CLIENT_VERSION_HEADER] || headers[CLIENT_BUILD_HEADER]) {
          _clientInfoHeaders = headers;
        }
        return headers;
      })
      .finally(() => {
        _clientInfoHeadersPromise = null;
      });
  }
  return _clientInfoHeadersPromise;
}

async function buildRequestHeaders(): Promise<Record<string, string>> {
  return {
    'Content-Type': 'application/json',
    ...(await clientInfoHeaders()),
    [AUTH_DEVICE_ID_HEADER]: await getOrCreateAuthDeviceId(),
  };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function request<T>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
  options: RequestOptions = {},
  _retried = false,
  _networkRetried = false,
): Promise<T> {
  const { skipAuth = false, timeoutMs } = options;

  const headers = await buildRequestHeaders();

  let res: Response;
  try {
    res = await fetchWithTimeout(
      buildUrl(path, options.baseUrlOverride),
      {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      },
      timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    );
  } catch {
    // Covers AbortError (timeout) and genuine network failures alike.
    // Silent retry ONCE before surfacing: rescues cold-start DNS failures
    // on iOS where CFNetwork's negative cache would otherwise flunk the
    // next tap in ~1ms. See NETWORK_RETRY_DELAY_MS above.
    if (!_networkRetried) {
      await new Promise<void>(resolve =>
        setTimeout(() => resolve(), NETWORK_RETRY_DELAY_MS),
      );
      return request<T>(method, path, body, options, _retried, true);
    }
    throw new ApiError(
      ERROR_CODE.NETWORK_ERROR,
      i18next.t('errors.networkCheckRetry'),
    );
  }

  // Server errors / proxy interception — surface as a typed error and skip
  // the refresh path entirely so a transient 5xx never logs the user out.
  if (res.status >= 500) {
    throw new ApiError(
      ERROR_CODE.SERVER_ERROR,
      i18next.t('errors.serverErrorHttp', { status: res.status }),
    );
  }

  let json: ApiResponse<T>;
  try {
    json = await res.json();
  } catch {
    // Captive portal / non-JSON response — treat as server error so the
    // caller can decide to retry rather than wiping local auth state.
    throw new ApiError(
      ERROR_CODE.SERVER_ERROR,
      i18next.t('errors.responseParseError'),
    );
  }

  if (json.code === 0) {
    return json.data;
  }

  if (json.code === ERROR_CODE.SESSION_REPLACED && !skipAuth) {
    await clearAuthFromModule('session_replaced');
    throw new ApiError(json.code, json.message);
  }

  throw new ApiError(json.code, json.message);
}

async function clearAuthFromModule(transition?: 'session_replaced') {
  const { _clearAuthFromApi } =
    require('./auth-service') as typeof import('./auth-service');
  _clearAuthFromApi(transition);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function apiGet<T>(
  path: string,
  options?: RequestOptions,
): Promise<T> {
  return request<T>('GET', path, undefined, options);
}

export async function apiPost<T>(
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<T> {
  return request<T>('POST', path, body, options);
}

export async function apiPostNoAuth<T>(
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<T> {
  return request<T>('POST', path, body, { ...options, skipAuth: true });
}

export async function apiDelete<T>(
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<T> {
  return request<T>('DELETE', path, body, options);
}

export type { RequestOptions };
