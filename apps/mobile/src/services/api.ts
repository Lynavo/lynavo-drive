import i18next from 'i18next';
import { getAccessToken, getRefreshToken } from '../stores/auth-store';
import { describeInsecureBaseUrl, getBaseUrl } from './config';

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
  TOO_MANY_CODE_ATTEMPTS: 1008,
  IAP_VERIFY_FAILED: 2001,
  RECEIPT_ALREADY_USED: 2002,
  PRODUCT_ID_MISMATCH: 2003,
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
}

function buildUrl(path: string): string {
  // Resolve and validate per-request: a misconfigured release build raises
  // a typed ApiError instead of crashing the bundle at module-load time.
  const baseUrl = getBaseUrl();
  const insecure = describeInsecureBaseUrl(baseUrl);
  if (insecure) {
    throw new ApiError(ERROR_CODE.NETWORK_ERROR, insecure);
  }
  return `${baseUrl}${API_PREFIX}${path}`;
}

function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  if (token) {
    return { Authorization: `Bearer ${token}` };
  }
  return {};
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
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  options: RequestOptions = {},
  _retried = false,
): Promise<T> {
  const { skipAuth = false, skipRefresh = false, timeoutMs } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(skipAuth ? {} : authHeaders()),
  };

  let res: Response;
  try {
    res = await fetchWithTimeout(
      buildUrl(path),
      {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      },
      timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    );
  } catch {
    // Covers AbortError (timeout) and genuine network failures alike.
    throw new ApiError(ERROR_CODE.NETWORK_ERROR, i18next.t('errors.networkCheckRetry'));
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
    throw new ApiError(ERROR_CODE.SERVER_ERROR, i18next.t('errors.responseParseError'));
  }

  if (json.code === 0) {
    return json.data;
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
        headers: { 'Content-Type': 'application/json' },
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

  // Server returned a structured error (e.g. REFRESH_TOKEN_INVALID) — the
  // refresh token itself is dead; clear local auth so the user re-authenticates.
  await clearAuthFromModule();
  return false;
}

async function clearAuthFromModule() {
  // Lazy import to break circular dependency
  const { _clearAuthFromApi } = await import('./auth-service');
  _clearAuthFromApi();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function apiGet<T>(path: string, options?: RequestOptions): Promise<T> {
  return request<T>('GET', path, undefined, options);
}

export async function apiPost<T>(
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<T> {
  return request<T>('POST', path, body, options);
}

export async function apiPostNoAuth<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('POST', path, body, { skipAuth: true });
}

export type { RequestOptions };
