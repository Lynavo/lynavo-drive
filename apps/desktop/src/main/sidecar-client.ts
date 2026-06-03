import http from 'node:http';
import https from 'node:https';
import log from 'electron-log';
import { app, safeStorage } from 'electron';
import { writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { APP_COMPATIBILITY_VERSION, SIDECAR_HTTP_PORT } from '@syncflow/contracts';
import type {
  DeviceFileLedgerPageDTO,
  DeviceFileSortField,
  SortDirection,
} from '@syncflow/contracts';
import { desktopClientHeaders } from './app-info';
import { isGlobalMarket } from '../shared/market';
import { shouldUseReviewOAuthTarget } from './oauth-config';

const BASE = `http://127.0.0.1:${SIDECAR_HTTP_PORT}`;
const DEFAULT_API_BASE_URL = isGlobalMarket()
  ? 'https://global-api.vividrop.com'
  : 'https://api.vividrop.cn';
const DEFAULT_REVIEW_API_BASE_URL = isGlobalMarket()
  ? 'https://review-api.vividrop.com'
  : 'https://review-api.vividrop.cn';
const API_BASE =
  process.env.VIVIDROP_API_BASE_URL?.trim() ||
  process.env.SYNCFLOW_API_BASE_URL?.trim() ||
  DEFAULT_API_BASE_URL;
const GIFT_CARD_REDEEM_BASE_URL = process.env.SYNCFLOW_GIFTCARD_REDEEM_BASE_URL?.trim() || API_BASE;
const GIFT_CARD_REDEEM_PATH =
  process.env.SYNCFLOW_GIFTCARD_REDEEM_PATH ?? '/api/v1/gift-cards/redeem';
const CLIENT_CONFIG_BASE_URL = process.env.SYNCFLOW_CLIENT_CONFIG_BASE_URL?.trim() || API_BASE;
const CLIENT_CONFIG_PATH = process.env.SYNCFLOW_CLIENT_CONFIG_PATH ?? '/api/v1/config';
const AUTH_BASE_URL =
  process.env.SYNCFLOW_AUTH_BASE_URL?.trim() || GIFT_CARD_REDEEM_BASE_URL || API_BASE;
const AUTH_REVIEW_BASE_URL =
  process.env.SYNCFLOW_AUTH_REVIEW_BASE_URL?.trim() || DEFAULT_REVIEW_API_BASE_URL;
const APP_REVIEW_PHONE =
  process.env.SYNCFLOW_APP_REVIEW_PHONE?.trim() ||
  process.env.APP_REVIEW_PHONE?.trim() ||
  '17000000002';
const AUTH_SMS_SEND_PATH = process.env.SYNCFLOW_AUTH_SMS_SEND_PATH ?? '/api/v1/auth/sms/send';
const AUTH_SMS_LOGIN_PATH = process.env.SYNCFLOW_AUTH_SMS_LOGIN_PATH ?? '/api/v1/auth/sms/login';

type GiftCardRedeemPayload = {
  code: string;
};

type SendSMSCodePayload = {
  phone: string;
};

type PhoneLoginPayload = {
  phone: string;
  code: string;
};

type GiftCardRedeemFailureReason =
  | 'auth_required'
  | 'invalid_code'
  | 'expired'
  | 'not_available'
  | 'already_redeemed'
  | 'plan_mismatch';

type GiftCardRedeemResponse = {
  ok: boolean;
  message?: string;
  reason?: GiftCardRedeemFailureReason;
};

export type ClientConfig = {
  features: {
    giftCard: {
      enabled: boolean;
    };
  };
};

type AuthResponse = {
  ok: boolean;
  message?: string;
  reason?: AuthFailureReason;
  userId?: number;
  isNewUser?: boolean;
  merged?: boolean;
};

type AuthFailureReason =
  | 'phone_invalid'
  | 'sms_too_frequent'
  | 'sms_send_failed'
  | 'sms_code_invalid'
  | 'sms_code_expired'
  | 'token_invalid'
  | 'sms_max_attempts'
  | 'session_replaced';

type AuthSession = {
  accessToken: string;
  refreshToken: string;
  baseUrl?: string;
};

export type AuthSessionView = {
  loggedIn: true;
  phone?: string;
  email?: string;
};

let authSession: AuthSession | null = null;
let authSessionLoaded = false;
let refreshSessionInFlight: Promise<boolean> | null = null;
let preserveSidecarTunnelCredentialsAfterSessionLoss = false;
const DEFAULT_REMOTE_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_SIDECAR_REQUEST_TIMEOUT_MS = 30_000;

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const REMOTE_REQUEST_TIMEOUT_MS = parsePositiveInteger(
  process.env.SYNCFLOW_REMOTE_REQUEST_TIMEOUT_MS,
  DEFAULT_REMOTE_REQUEST_TIMEOUT_MS,
);
const SIDECAR_REQUEST_TIMEOUT_MS = parsePositiveInteger(
  process.env.SYNCFLOW_SIDECAR_REQUEST_TIMEOUT_MS,
  DEFAULT_SIDECAR_REQUEST_TIMEOUT_MS,
);

function getSessionFilePath(): string {
  return join(app.getPath('userData'), 'session.json');
}

function saveSession(session: AuthSession | null): void {
  try {
    const filePath = getSessionFilePath();
    if (!session) {
      if (existsSync(filePath)) {
        rmSync(filePath, { force: true });
      }
      return;
    }

    let accessTokenStr = session.accessToken;
    let refreshTokenStr = session.refreshToken;
    let encrypted = false;

    if (safeStorage.isEncryptionAvailable()) {
      accessTokenStr = safeStorage.encryptString(session.accessToken).toString('base64');
      refreshTokenStr = safeStorage.encryptString(session.refreshToken).toString('base64');
      encrypted = true;
    } else {
      log.warn(
        '[sidecar-client] safeStorage encryption not available, storing session in plain text',
      );
    }

    const data = {
      accessToken: accessTokenStr,
      refreshToken: refreshTokenStr,
      baseUrl: session.baseUrl,
      encrypted,
    };

    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    log.error('[sidecar-client] Failed to save auth session:', error);
  }
}

function loadSession(): AuthSession | null {
  try {
    const filePath = getSessionFilePath();
    if (!existsSync(filePath)) {
      return null;
    }

    const raw = readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (!data.accessToken || !data.refreshToken) {
      return null;
    }

    let accessToken = data.accessToken;
    let refreshToken = data.refreshToken;

    if (data.encrypted && safeStorage.isEncryptionAvailable()) {
      accessToken = safeStorage.decryptString(Buffer.from(data.accessToken, 'base64'));
      refreshToken = safeStorage.decryptString(Buffer.from(data.refreshToken, 'base64'));
    }

    const baseUrl =
      typeof data.baseUrl === 'string' && isHttpUrl(data.baseUrl) ? data.baseUrl : undefined;
    return createAuthSession(accessToken, refreshToken, baseUrl);
  } catch (error) {
    log.error('[sidecar-client] Failed to load auth session:', error);
    return null;
  }
}

function ensureSessionLoaded(): void {
  if (!authSessionLoaded) {
    authSession = loadSession();
    authSessionLoaded = true;
  }
}

function optionalGiftCardRedeemToken(): string | null {
  ensureSessionLoaded();
  // Gift-card redemption is user-scoped; generic API/diagnostics tokens are not valid user JWTs.
  if (authSession?.accessToken) {
    return authSession.accessToken;
  }
  return process.env.SYNCFLOW_GIFTCARD_REDEEM_TOKEN?.trim() || null;
}

function apiAuthHeaders(): Record<string, string> {
  const token = optionalGiftCardRedeemToken();
  if (!token) {
    return {};
  }
  return { Authorization: `Bearer ${token}` };
}

function remoteApiHeaders(baseUrl: string): Record<string, string> {
  return baseUrl === BASE ? {} : desktopClientHeaders();
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//.test(value);
}

function normalizePhoneDigits(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length === 13 && digits.startsWith('86') ? digits.slice(2) : digits;
}

function resolveAuthBaseUrlForPhone(phone: string): string {
  if (process.env.SYNCFLOW_AUTH_BASE_URL?.trim()) {
    return AUTH_BASE_URL;
  }
  if (normalizePhoneDigits(phone) === APP_REVIEW_PHONE) {
    return AUTH_REVIEW_BASE_URL;
  }
  return AUTH_BASE_URL;
}

function resolveOAuthAuthBaseUrl(): string {
  if (process.env.SYNCFLOW_AUTH_BASE_URL?.trim()) {
    return AUTH_BASE_URL;
  }
  return shouldUseReviewOAuthTarget(process.env) ? AUTH_REVIEW_BASE_URL : AUTH_BASE_URL;
}

function getSessionBaseUrl(): string {
  ensureSessionLoaded();
  return authSession?.baseUrl || AUTH_BASE_URL;
}

function getGiftCardRedeemBaseUrl(): string {
  if (process.env.SYNCFLOW_GIFTCARD_REDEEM_BASE_URL?.trim()) {
    return GIFT_CARD_REDEEM_BASE_URL;
  }
  ensureSessionLoaded();
  return authSession?.baseUrl || GIFT_CARD_REDEEM_BASE_URL;
}

function createAuthSession(
  accessToken: string,
  refreshToken: string,
  baseUrl?: string,
): AuthSession {
  return {
    accessToken,
    refreshToken,
    ...(baseUrl ? { baseUrl } : {}),
  };
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const payload = token.split('.')[1];
  if (!payload) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function createAuthSessionView(session: AuthSession | null): AuthSessionView | null {
  if (!session?.accessToken) {
    return null;
  }

  const payload = decodeJwtPayload(session.accessToken);
  return {
    loggedIn: true,
    phone: typeof payload?.phone === 'string' ? payload.phone : undefined,
    email: typeof payload?.email === 'string' ? payload.email : undefined,
  };
}

function mapGiftCardRedeemFailureReason(code: number): GiftCardRedeemFailureReason | undefined {
  switch (code) {
    case 1006:
      return 'auth_required';
    case 3001:
      return 'invalid_code';
    case 3002:
      return 'expired';
    case 3003:
      return 'not_available';
    case 3004:
      return 'already_redeemed';
    case 3005:
      return 'plan_mismatch';
    default:
      return undefined;
  }
}

function mapAuthFailureReason(code: number): AuthFailureReason | undefined {
  switch (code) {
    case 1001:
      return 'phone_invalid';
    case 1002:
      return 'sms_too_frequent';
    case 1003:
      return 'sms_send_failed';
    case 1004:
      return 'sms_code_invalid';
    case 1005:
      return 'sms_code_expired';
    case 1006:
      return 'token_invalid';
    case 1008:
      return 'sms_max_attempts';
    case 1009:
      return 'session_replaced';
    default:
      return undefined;
  }
}

function normalizeGiftCardRedeemResponse(value: unknown): GiftCardRedeemResponse {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid gift card redeem response');
  }

  const data = value as Record<string, unknown>;
  if (typeof data.ok === 'boolean') {
    return {
      ok: data.ok,
      message: typeof data.message === 'string' ? data.message : undefined,
    };
  }

  if (typeof data.code !== 'number') {
    throw new Error('Invalid gift card redeem response');
  }

  if (data.code === 0) {
    return { ok: true };
  }

  return {
    ok: false,
    reason: mapGiftCardRedeemFailureReason(data.code),
    message: typeof data.message === 'string' ? data.message : undefined,
  };
}

function normalizeClientConfig(value: unknown): ClientConfig {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid client config response');
  }

  const envelope = value as Record<string, unknown>;
  const data =
    envelope.data && typeof envelope.data === 'object'
      ? (envelope.data as Record<string, unknown>)
      : envelope;
  const features =
    data.features && typeof data.features === 'object'
      ? (data.features as Record<string, unknown>)
      : {};
  const giftCard =
    features.gift_card && typeof features.gift_card === 'object'
      ? (features.gift_card as Record<string, unknown>)
      : features.giftCard && typeof features.giftCard === 'object'
        ? (features.giftCard as Record<string, unknown>)
        : {};

  return {
    features: {
      giftCard: {
        enabled: giftCard.enabled === true,
      },
    },
  };
}

function normalizeAuthResponse(value: unknown): AuthResponse {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid auth response');
  }

  const data = value as Record<string, unknown>;
  if (typeof data.code !== 'number') {
    throw new Error('Invalid auth response');
  }

  if (data.code === 0) {
    const envelopeData = data.data;
    if (!envelopeData || typeof envelopeData !== 'object') {
      return { ok: true };
    }

    const authData = envelopeData as Record<string, unknown>;
    return {
      ok: true,
      userId: typeof authData.user_id === 'number' ? authData.user_id : undefined,
      isNewUser: typeof authData.is_new_user === 'boolean' ? authData.is_new_user : undefined,
      merged: typeof authData.merged === 'boolean' ? authData.merged : undefined,
    };
  }

  return {
    ok: false,
    reason: mapAuthFailureReason(data.code),
    message: typeof data.message === 'string' ? data.message : undefined,
  };
}

function persistAuthSession(value: unknown, baseUrl = AUTH_BASE_URL): AuthResponse {
  const normalized = normalizeAuthResponse(value);
  if (!normalized.ok) {
    authSession = null;
    authSessionLoaded = true;
    saveSession(null);
    return normalized;
  }

  const envelope = value as Record<string, unknown>;
  const envelopeData = envelope.data;
  if (!envelopeData || typeof envelopeData !== 'object') {
    throw new Error('Invalid auth response');
  }

  const authData = envelopeData as Record<string, unknown>;
  if (typeof authData.access_token !== 'string' || typeof authData.refresh_token !== 'string') {
    throw new Error('Invalid auth response');
  }

  authSession = createAuthSession(authData.access_token, authData.refresh_token, baseUrl);
  authSessionLoaded = true;
  preserveSidecarTunnelCredentialsAfterSessionLoss = false;
  saveSession(authSession);
  return normalized;
}

function isGiftCardAuthError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.message.includes(': 401 ') ||
    error.message.includes('"code":1006') ||
    error.message.includes('Token 無效或已過期') ||
    error.message.includes('Token 无效或已过期')
  );
}

function requestTimeoutMs(baseUrl: string): number {
  return baseUrl === BASE ? SIDECAR_REQUEST_TIMEOUT_MS : REMOTE_REQUEST_TIMEOUT_MS;
}

export interface SidecarHealth {
  ok: boolean;
  service: string;
  appCompatibilityVersion?: number;
  capabilities?: {
    revokesPairingsOnCodeRotation?: boolean;
  };
}

export function supportsPairingRevocationOnCodeRotation(
  health: SidecarHealth | null | undefined,
): boolean {
  return (
    health?.ok === true &&
    health.service === 'syncflow-sidecar' &&
    health.appCompatibilityVersion === APP_COMPATIBILITY_VERSION &&
    health.capabilities?.revokesPairingsOnCodeRotation === true
  );
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  baseUrl = BASE,
  headers?: Record<string, string>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const transport = url.protocol === 'https:' ? https : http;
    const options: http.RequestOptions = {
      method,
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port ? Number(url.port) : undefined,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...remoteApiHeaders(baseUrl),
        ...headers,
      },
    };

    let settled = false;
    const rejectOnce = (error: Error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };
    const resolveOnce = (value: T) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    const req = transport.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolveOnce(JSON.parse(data) as T);
        } else {
          rejectOnce(
            new Error(
              `${method} ${url.origin}${url.pathname}${url.search}: ${res.statusCode} ${data}`,
            ),
          );
        }
      });
    });

    req.on('error', (error) => rejectOnce(error));
    const timeoutMs = requestTimeoutMs(baseUrl);
    if (typeof req.setTimeout === 'function') {
      req.setTimeout(timeoutMs, () => {
        const error = new Error(
          `${method} ${url.origin}${url.pathname}${url.search}: request timed out after ${timeoutMs}ms`,
        );
        if (typeof req.destroy === 'function') {
          req.destroy(error);
        } else {
          rejectOnce(error);
        }
      });
    }
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

export const sidecarClient = {
  getHealth: () => request<SidecarHealth>('GET', '/health'),
  getDashboardSummary: () =>
    request<import('@syncflow/contracts').DashboardSummaryDTO>('GET', '/dashboard/summary'),
  getDashboardDevices: () =>
    request<import('@syncflow/contracts').DashboardDeviceDTO[]>('GET', '/dashboard/devices'),
  getDeviceFiles: (
    id: string,
    date: string,
    options?: {
      page?: number;
      pageSize?: number;
      sortField?: DeviceFileSortField;
      sortDirection?: SortDirection;
      endDate?: string;
    },
  ) => {
    const params = new URLSearchParams({ date });
    if (options?.page) params.set('page', String(options.page));
    if (options?.pageSize) params.set('pageSize', String(options.pageSize));
    if (options?.sortField) params.set('sortField', options.sortField);
    if (options?.sortDirection) params.set('sortDirection', options.sortDirection);
    if (options?.endDate) params.set('endDate', options.endDate);
    return request<DeviceFileLedgerPageDTO>('GET', `/devices/${id}/files?${params.toString()}`);
  },
  getDeviceDates: (id: string) => request<{ dates: string[] }>('GET', `/devices/${id}/dates`),
  getSettings: () => request<import('@syncflow/contracts').SettingsDTO>('GET', '/settings'),
  updateSettings: (s: Partial<import('@syncflow/contracts').SettingsDTO>) =>
    request<import('@syncflow/contracts').SettingsDTO>('PUT', '/settings', s),
  resetState: () => request<{ ok: boolean }>('POST', '/settings/reset-state', {}),
  regenerateConnectionCode: () => request<{ code: string }>('POST', '/connection-code/regenerate'),
  getShareStatus: () =>
    request<import('@syncflow/contracts').ShareStatusDTO>('GET', '/share/status'),
  validateShare: () =>
    request<import('@syncflow/contracts').ShareStatusDTO>('POST', '/share/validate'),
  getTransferActive: () => request<{ active: boolean }>('GET', '/transfer/active'),
  getSharedList: (path?: string) => {
    const endpoint = path ? `/shared/list/${path}` : '/shared/list';
    return request<import('@syncflow/contracts').SharedDirectoryDTO>('GET', endpoint);
  },
  getClientConfig: async () => {
    const response = await request<unknown>(
      'GET',
      CLIENT_CONFIG_PATH,
      undefined,
      CLIENT_CONFIG_BASE_URL,
    );
    return normalizeClientConfig(response);
  },
  redeemGiftCard: async (payload: GiftCardRedeemPayload) => {
    try {
      const response = await request<unknown>(
        'POST',
        GIFT_CARD_REDEEM_PATH,
        payload,
        getGiftCardRedeemBaseUrl(),
        apiAuthHeaders(),
      );
      return normalizeGiftCardRedeemResponse(response);
    } catch (error) {
      if (isGiftCardAuthError(error)) {
        authSession = null;
        authSessionLoaded = true;
        saveSession(null);
        return { ok: false, reason: 'auth_required' };
      }
      throw error;
    }
  },
  sendSMSCode: async (payload: SendSMSCodePayload) => {
    const authBaseUrl = resolveAuthBaseUrlForPhone(payload.phone);
    const response = await request<unknown>('POST', AUTH_SMS_SEND_PATH, payload, authBaseUrl);
    return normalizeAuthResponse(response);
  },
  loginWithSMSCode: async (payload: PhoneLoginPayload) => {
    const authBaseUrl = resolveAuthBaseUrlForPhone(payload.phone);
    const response = await request<unknown>('POST', AUTH_SMS_LOGIN_PATH, payload, authBaseUrl);
    return persistAuthSession(response, authBaseUrl);
  },
  loginWithGoogle: async (payload: { identityToken: string }) => {
    const authBaseUrl = resolveOAuthAuthBaseUrl();
    const response = await request<unknown>(
      'POST',
      '/api/v1/auth/google/login',
      { identity_token: payload.identityToken },
      authBaseUrl,
    );
    return persistAuthSession(response, authBaseUrl);
  },
  loginWithApple: async (payload: {
    identityToken: string;
    authorizationCode?: string;
    fullName?: string;
  }) => {
    const authBaseUrl = resolveOAuthAuthBaseUrl();
    const response = await request<unknown>(
      'POST',
      '/api/v1/auth/apple/login',
      {
        identity_token: payload.identityToken,
        authorization_code: payload.authorizationCode,
        full_name: payload.fullName,
      },
      authBaseUrl,
    );
    return persistAuthSession(response, authBaseUrl);
  },
  syncTunnelCredentials: async (payload: {
    signalingUrl: string;
    accessToken: string;
    iceServers: ICEServerPayload[];
  }) => {
    return request<{ ok: boolean; message: string }>('POST', '/tunnel/credentials', payload);
  },
  getAuthSession: () => {
    ensureSessionLoaded();
    return authSession;
  },
  getAuthSessionView: () => {
    ensureSessionLoaded();
    return createAuthSessionView(authSession);
  },
  fetchTurnCredentials: async () => {
    return request<{
      code: number;
      data: { username: string; credential: string; urls: string[] };
    }>('GET', '/api/v1/tunnel/turn-credentials', undefined, getSessionBaseUrl(), apiAuthHeaders());
  },
  refreshSession: async () => {
    if (refreshSessionInFlight) {
      return refreshSessionInFlight;
    }

    refreshSessionInFlight = (async () => {
      ensureSessionLoaded();
      if (!authSession || !authSession.refreshToken) {
        return false;
      }

      try {
        const response = await request<unknown>(
          'POST',
          '/api/v1/auth/refresh',
          { refresh_token: authSession.refreshToken },
          authSession.baseUrl || AUTH_BASE_URL,
        );

        if (!response || typeof response !== 'object') {
          throw new Error('Invalid refresh response');
        }
        const data = response as Record<string, unknown>;
        if (data.code !== 0) {
          log.error('[sidecar-client] Refresh session failed, clearing session. Code:', data.code);
          authSession = null;
          authSessionLoaded = true;
          preserveSidecarTunnelCredentialsAfterSessionLoss = true;
          saveSession(null);
          return false;
        }

        const envelopeData = data.data;
        if (!envelopeData || typeof envelopeData !== 'object') {
          throw new Error('Invalid refresh response data');
        }

        const authData = envelopeData as Record<string, unknown>;
        if (
          typeof authData.access_token !== 'string' ||
          typeof authData.refresh_token !== 'string'
        ) {
          throw new Error('Invalid refresh response tokens');
        }

        authSession = createAuthSession(
          authData.access_token,
          authData.refresh_token,
          authSession.baseUrl,
        );
        authSessionLoaded = true;
        preserveSidecarTunnelCredentialsAfterSessionLoss = false;
        saveSession(authSession);
        return true;
      } catch (error) {
        log.error('[sidecar-client] Error refreshing session:', error);
        return false;
      }
    })();

    try {
      return await refreshSessionInFlight;
    } finally {
      refreshSessionInFlight = null;
    }
  },
  getApiBaseUrl: () => getSessionBaseUrl(),
  logout: async () => {
    authSession = null;
    authSessionLoaded = true;
    preserveSidecarTunnelCredentialsAfterSessionLoss = false;
    saveSession(null);
    await syncCredentialsToSidecar();
    return { ok: true };
  },
};

export type ICEServerPayload = {
  urls: string[];
  username?: string;
  credential?: string;
};

export async function syncCredentialsToSidecar(): Promise<boolean> {
  try {
    let session = sidecarClient.getAuthSession();
    if (!session || !session.accessToken) {
      if (preserveSidecarTunnelCredentialsAfterSessionLoss) {
        log.warn(
          '[sidecar-client] No active session after refresh loss. Preserving existing sidecar tunnel credentials.',
        );
        return false;
      }
      await sidecarClient.syncTunnelCredentials({
        signalingUrl: '',
        accessToken: '',
        iceServers: [],
      });
      return true;
    }

    let turnRes = await sidecarClient.fetchTurnCredentials();
    if (turnRes && turnRes.code === 1006) {
      log.info(
        '[sidecar-client] Fetch TURN credentials returned 1006 (token expired). Attempting token refresh...',
      );
      const refreshed = await sidecarClient.refreshSession();
      session = sidecarClient.getAuthSession();
      if (!session || !session.accessToken) {
        log.warn(
          '[sidecar-client] Session cleared during refresh. Preserving existing sidecar tunnel credentials.',
        );
        return false;
      }
      if (refreshed) {
        log.info('[sidecar-client] Token refresh succeeded. Retrying fetch TURN credentials...');
        turnRes = await sidecarClient.fetchTurnCredentials();
      } else {
        log.warn('[sidecar-client] Token refresh failed.');
      }
    }

    if (!turnRes || turnRes.code !== 0 || !turnRes.data) {
      throw new Error(`Fetch TURN credentials failed with code: ${turnRes?.code}`);
    }

    const iceServers: ICEServerPayload[] = [
      {
        urls: turnRes.data.urls,
        username: turnRes.data.username,
        credential: turnRes.data.credential,
      },
    ];

    const signalingUrl = sidecarClient.getApiBaseUrl();
    const res = await sidecarClient.syncTunnelCredentials({
      signalingUrl,
      accessToken: session.accessToken,
      iceServers,
    });
    return res.ok;
  } catch (error) {
    log.error('Failed to sync credentials to sidecar:', error);
    return false;
  }
}
