import i18next from 'i18next';
import { NativeModules, Platform } from 'react-native';
import { getAccessToken, getRefreshToken } from '../stores/auth-store';
import { describeInsecureBaseUrl, getBaseUrl } from './config';
import { maskPhone } from '../utils/phone-validation';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const API_PREFIX = '/api/v1';

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

export const ERROR_CODE = {
  PHONE_FORMAT_INVALID: 1001,
  SMS_TOO_FREQUENT: 1002,
  SMS_SEND_FAILED: 1003,
  CODE_WRONG: 1004,
  CODE_EXPIRED: 1005,
  TOKEN_INVALID: 1006,
  REFRESH_TOKEN_INVALID: 1007,
  SESSION_REPLACED: 1009,
  TOO_MANY_CODE_ATTEMPTS: 1008,
  EMAIL_FORMAT_INVALID: 1101,
  APPLE_TOKEN_INVALID: 1102,
  GOOGLE_TOKEN_INVALID: 1103,
  EMAIL_CODE_WRONG: 1104,
  EMAIL_CODE_EXPIRED: 1105,
  IDENTITY_CONFLICT: 1106,
  ACCOUNT_DELETED: 1107,
  DELETE_CONFIRM_INVALID: 1108,
  DELETE_BLOCKED_ACTIVE_SUBSCRIPTION: 1109,
  IAP_VERIFY_FAILED: 2001,
  RECEIPT_ALREADY_USED: 2002,
  PRODUCT_ID_MISMATCH: 2003,
  RECEIPT_BOUND_TO_OTHER_USER: 2005,
  MAINLAND_PAYMENT_PROVIDER_NOT_CONFIGURED: 2006,
  MAINLAND_PAYMENT_ORDER_NOT_FOUND: 2007,
  MAINLAND_PAYMENT_ORDER_MISMATCH: 2008,
  MAINLAND_PAYMENT_VERIFY_FAILED: 2009,
  GIFT_CARD_CODE_INVALID: 3001,
  GIFT_CARD_CODE_EXPIRED: 3002,
  GIFT_CARD_NOT_AVAILABLE: 3003,
  GIFT_CARD_REDEEMED: 3004,
  GIFT_CARD_PLAN_MISMATCH: 3005,
  GIFT_CARD_OPERATION_INVALID: 3006,
  GIFT_CARD_ACTIVE_SUBSCRIPTION: 3007,
  PARAM_ERROR: 9001,
  SERVER_ERROR: 9002,
  RATE_LIMITED: 9003,
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
  /** Skip Authorization header injection. */
  skipAuth?: boolean;
  /**
   * Skip the silent refresh-on-TOKEN_INVALID retry loop. Use this for the
   * logout endpoint to avoid a mid-logout token rotation that leaves the
   * freshly-minted refresh token un-revoked server-side.
   */
  skipRefresh?: boolean;
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
  const token = getAccessToken();
  if (token) {
    return { Authorization: `Bearer ${token}` };
  }
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
    [CLIENT_APP_HEADER]: 'vividrop-mobile',
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

async function buildRequestHeaders(
  skipAuth: boolean,
): Promise<Record<string, string>> {
  const { getOrCreateAuthDeviceId } = await import('./auth-device-id');
  return {
    'Content-Type': 'application/json',
    ...(await clientInfoHeaders()),
    [AUTH_DEVICE_ID_HEADER]: await getOrCreateAuthDeviceId(),
    ...(skipAuth ? {} : authHeaders()),
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
  const { skipAuth = false, skipRefresh = false, timeoutMs } = options;

  // Dev Sandbox Mock Interceptor: when using mock credentials in dev mode,
  // return mock responses locally to prevent 401 token refresh loops or network failures.
  const accessToken = getAccessToken();
  if (
    typeof __DEV__ !== 'undefined' &&
    __DEV__ &&
    accessToken &&
    accessToken.startsWith('mock-sandbox-access-token')
  ) {
    console.log(`[Sandbox Mock API] Intercepting path="${path}" method=${method}`);
    if (path === '/user/profile') {
      const parts = accessToken.split(':');
      let display = '133****5678';
      let type = 'phone_cn';
      if (parts.length > 1) {
        const rawVal = parts[1];
        if (rawVal.includes('@')) {
          type = 'email';
          display = rawVal;
        } else {
          // Format phone display: mask middle digits using the unified utility
          type = rawVal.startsWith('+86') || /^\d{11}$/.test(rawVal) ? 'phone_cn' : 'phone';
          display = maskPhone(rawVal);
        }
      }
      return {
        id: 99999,
        primary_identity: {
          type,
          display,
        },
        identities: [
          {
            type,
            display,
          },
        ],
        status: 'subscribed',
        plan: 'yearly',
        expire_at: '2030-12-31T23:59:59Z',
        trial_end: null,
      } as unknown as T;
    }
    if (path === '/subscription/status') {
      return {
        status: 'subscribed',
        plan: 'yearly',
        expire_at: '2030-12-31T23:59:59Z',
        trial_end: null,
        auto_renewing: true,
        source: 'gift_card',
        payment_provider: 'gift_card',
        renewal_state: 'prepaid',
      } as unknown as T;
    }
    if (path === '/auth/refresh') {
      return {
        access_token: accessToken,
        refresh_token: 'mock-sandbox-refresh-token',
      } as unknown as T;
    }
    if (path === '/auth/logout') {
      return {} as unknown as T;
    }
  }

  const headers = await buildRequestHeaders(skipAuth);

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

  // Token expired — attempt silent refresh ONCE, single-flight across callers.
  // _retried prevents an infinite loop if the refresh succeeds but the
  // immediate retry still gets TOKEN_INVALID (e.g. clock skew on the server).
  // skipRefresh lets endpoints that revoke tokens (logout) bypass this so
  // they never trigger a rotation that out-races their own revocation.
  if (
    json.code === ERROR_CODE.TOKEN_INVALID &&
    !_retried &&
    !skipAuth &&
    !skipRefresh
  ) {
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      return request<T>(method, path, body, options, true);
    }
  }

  throw new ApiError(json.code, json.message);
}

// Single-flight refresh: concurrent 401s coalesce onto one in-flight refresh
// promise. Without this, the second concurrent caller would see a stale
// _isRefreshing flag and either throw prematurely or fire a duplicate refresh
// that invalidates the rotated token issued to the first caller.
let _refreshPromise: Promise<boolean> | null = null;

function tryRefreshToken(): Promise<boolean> {
  if (_refreshPromise) return _refreshPromise;
  _refreshPromise = doRefreshToken().finally(() => {
    _refreshPromise = null;
  });
  return _refreshPromise;
}

async function doRefreshToken(): Promise<boolean> {
  const refresh = getRefreshToken();
  if (!refresh) {
    await clearAuthFromModule();
    return false;
  }

  let res: Response;
  try {
    res = await fetchWithTimeout(
      buildUrl('/auth/refresh'),
      {
        method: 'POST',
        headers: await buildRequestHeaders(true),
        body: JSON.stringify({ refresh_token: refresh }),
      },
      DEFAULT_REQUEST_TIMEOUT_MS,
    );
  } catch {
    // Network failure / timeout during refresh is recoverable — keep tokens
    // so the user is not logged out by a flaky connection / captive portal.
    return false;
  }

  if (res.status >= 500) {
    // Transient server error — preserve tokens.
    return false;
  }

  let json: ApiResponse<{ access_token: string; refresh_token: string }>;
  try {
    json = await res.json();
  } catch {
    // Non-JSON response (captive portal HTML, etc.) — preserve tokens.
    return false;
  }

  if (json.code === 0) {
    const { _setTokensFromApi } = await import('./auth-service');
    _setTokensFromApi(json.data.access_token, json.data.refresh_token);
    return true;
  }

  if (json.code === ERROR_CODE.SESSION_REPLACED) {
    await clearAuthFromModule('session_replaced');
    return false;
  }

  // Server returned a structured error (e.g. REFRESH_TOKEN_INVALID) — the
  // refresh token itself is dead; clear local auth so the user re-authenticates.
  await clearAuthFromModule();
  return false;
}

async function clearAuthFromModule(transition?: 'session_replaced') {
  // Lazy import to break circular dependency
  const { _clearAuthFromApi } = await import('./auth-service');
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
