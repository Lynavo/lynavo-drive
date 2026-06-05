import http from 'node:http';
import https from 'node:https';
import log from 'electron-log';
import { app, safeStorage } from 'electron';
import { writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  APP_COMPATIBILITY_VERSION,
  SIDECAR_HTTP_PORT,
  VIVIDROP_API_BASE_URL,
  VIVIDROP_GLOBAL_API_BASE_URL,
  VIVIDROP_REVIEW_API_BASE_URL,
} from '@syncflow/contracts';
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
  ? VIVIDROP_GLOBAL_API_BASE_URL
  : VIVIDROP_API_BASE_URL;
const DEFAULT_REVIEW_API_BASE_URL = VIVIDROP_REVIEW_API_BASE_URL;
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
const USER_PROFILE_PATH = process.env.SYNCFLOW_USER_PROFILE_PATH ?? '/api/v1/user/profile';

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
  phone?: string;
  email?: string;
  accountLabel?: string;
};

export type AuthSessionView = {
  loggedIn: true;
  phone?: string;
  email?: string;
  accountLabel?: string;
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
      phone: session.phone,
      email: session.email,
      accountLabel: session.accountLabel,
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
    return createAuthSession(accessToken, refreshToken, {
      baseUrl,
      phone: typeof data.phone === 'string' ? data.phone : undefined,
      email: typeof data.email === 'string' ? data.email : undefined,
      accountLabel: typeof data.accountLabel === 'string' ? data.accountLabel : undefined,
    });
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
  metadata: { baseUrl?: string; phone?: string; email?: string; accountLabel?: string } = {},
): AuthSession {
  return {
    accessToken,
    refreshToken,
    ...(metadata.baseUrl ? { baseUrl: metadata.baseUrl } : {}),
    ...(metadata.phone ? { phone: metadata.phone } : {}),
    ...(metadata.email ? { email: metadata.email } : {}),
    ...(metadata.accountLabel ? { accountLabel: metadata.accountLabel } : {}),
  };
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const payload = token.split('.')[1];
  if (!payload) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

function firstStringPayloadValue(
  payload: Record<string, unknown> | null,
  keys: readonly string[],
): string | undefined {
  if (!payload) {
    return undefined;
  }
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function identityLabelFromValue(value: string | undefined): {
  phone?: string;
  email?: string;
  accountLabel?: string;
} {
  const normalized = value?.trim();
  if (!normalized) {
    return {};
  }
  if (normalized.includes('@')) {
    return { email: normalized, accountLabel: normalized };
  }
  if (/^\+?[\d\s().-]{6,}$/.test(normalized)) {
    return { phone: normalized, accountLabel: normalized };
  }
  return { accountLabel: normalized };
}

function valueAsRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeProfileIdentity(value: unknown): {
  phone?: string;
  email?: string;
  accountLabel?: string;
} {
  const identity = valueAsRecord(value);
  if (!identity) {
    return {};
  }

  const type = typeof identity.type === 'string' ? identity.type.toLowerCase() : '';
  const identifier =
    typeof identity.identifier === 'string' && identity.identifier.trim()
      ? identity.identifier.trim()
      : undefined;
  const display =
    typeof identity.display === 'string' && identity.display.trim()
      ? identity.display.trim()
      : undefined;
  const label = identifier || display;
  if (!label) {
    return {};
  }
  if (type.includes('email') || label.includes('@')) {
    return { email: label, accountLabel: label };
  }
  if (type.includes('phone')) {
    return { phone: label, accountLabel: label };
  }
  return identityLabelFromValue(label);
}

function normalizeProfileAccountLabel(value: unknown): {
  phone?: string;
  email?: string;
  accountLabel?: string;
} {
  const envelope = valueAsRecord(value);
  const data = valueAsRecord(envelope?.data) || envelope;
  if (!data) {
    return {};
  }

  const primaryIdentity = normalizeProfileIdentity(data.primary_identity);
  if (primaryIdentity.accountLabel) {
    return primaryIdentity;
  }

  const identities = data.identities;
  if (Array.isArray(identities)) {
    for (const identity of identities) {
      const normalized = normalizeProfileIdentity(identity);
      if (normalized.accountLabel) {
        return normalized;
      }
    }
  }

  return {};
}

function createAuthSessionView(session: AuthSession | null): AuthSessionView | null {
  if (!session?.accessToken) {
    return null;
  }

  const payload = decodeJwtPayload(session.accessToken);
  const phone =
    session.phone ||
    firstStringPayloadValue(payload, [
      'phone',
      'phone_number',
      'mobile',
      'mobile_phone',
      'phoneNumber',
    ]);
  const email = session.email || firstStringPayloadValue(payload, ['email']);
  const payloadLabel = identityLabelFromValue(
    firstStringPayloadValue(payload, ['preferred_username', 'username', 'name']),
  );
  const accountLabel = session.accountLabel || phone || email || payloadLabel.accountLabel;
  return {
    loggedIn: true,
    phone: phone || payloadLabel.phone,
    email: email || payloadLabel.email,
    accountLabel,
  };
}

async function createAuthSessionViewWithProfile(
  session: AuthSession | null,
): Promise<AuthSessionView | null> {
  const view = createAuthSessionView(session);
  if (!session || !view || view.accountLabel) {
    return view;
  }

  try {
    const response = await request<unknown>(
      'GET',
      USER_PROFILE_PATH,
      undefined,
      getSessionBaseUrl(),
      apiAuthHeaders(),
    );
    const profileIdentity = normalizeProfileAccountLabel(response);
    if (!profileIdentity.accountLabel) {
      return view;
    }

    authSession = {
      ...session,
      phone: session.phone || profileIdentity.phone,
      email: session.email || profileIdentity.email,
      accountLabel: profileIdentity.accountLabel,
    };
    authSessionLoaded = true;
    saveSession(authSession);
    return {
      ...view,
      phone: view.phone || profileIdentity.phone,
      email: view.email || profileIdentity.email,
      accountLabel: profileIdentity.accountLabel,
    };
  } catch (error) {
    log.warn('[sidecar-client] Failed to load auth profile for session view:', error);
    return view;
  }
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

function decodeBase64URL(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  return Buffer.from(padded, 'base64').toString('utf8');
}

function accountIDFromAccessToken(accessToken: string): string | undefined {
  const parts = accessToken.split('.');
  if (parts.length < 2 || !parts[1]) {
    return undefined;
  }

  try {
    const claims = JSON.parse(decodeBase64URL(parts[1])) as Record<string, unknown>;
    const value = claims.uid ?? claims.user_id ?? claims.account_id ?? claims.sub;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed ? trimmed : undefined;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  } catch (error) {
    log.warn('[sidecar-client] Failed to parse account id from access token:', error);
  }

  return undefined;
}

function persistAuthSession(
  value: unknown,
  metadata: { baseUrl?: string; phone?: string; email?: string; accountLabel?: string } = {},
): AuthResponse {
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

  authSession = createAuthSession(authData.access_token, authData.refresh_token, {
    baseUrl: metadata.baseUrl || AUTH_BASE_URL,
    phone: metadata.phone,
    email: metadata.email,
    accountLabel: metadata.accountLabel,
  });
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

function errorDiagnostics(error: Error): Record<string, unknown> {
  const diagnostics: Record<string, unknown> = {
    name: error.name,
    message: error.message,
  };
  const record = error as Error & {
    code?: unknown;
    cause?: unknown;
  };
  if (record.code) {
    diagnostics.code = record.code;
  }
  if (record.cause instanceof Error) {
    diagnostics.cause = {
      name: record.cause.name,
      message: record.cause.message,
    };
  } else if (record.cause) {
    diagnostics.cause = String(record.cause);
  }
  return diagnostics;
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
        if (baseUrl !== BASE) {
          log.error('[sidecar-client] Remote API request failed.', {
            method,
            url: `${url.origin}${url.pathname}${url.search}`,
            ...errorDiagnostics(error),
          });
        }
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
    return persistAuthSession(response, { baseUrl: authBaseUrl, phone: payload.phone });
  },
  loginWithGoogle: async (payload: { identityToken: string }) => {
    const authBaseUrl = resolveOAuthAuthBaseUrl();
    log.info('[sidecar-client] Starting Google auth login.', {
      baseUrl: authBaseUrl,
      path: '/api/v1/auth/google/login',
    });
    const response = await request<unknown>(
      'POST',
      '/api/v1/auth/google/login',
      { identity_token: payload.identityToken },
      authBaseUrl,
    );
    return persistAuthSession(response, { baseUrl: authBaseUrl });
  },
  loginWithApple: async (payload: {
    identityToken: string;
    authorizationCode?: string;
    fullName?: string;
  }) => {
    const authBaseUrl = resolveOAuthAuthBaseUrl();
    log.info('[sidecar-client] Starting Apple auth login.', {
      baseUrl: authBaseUrl,
      path: '/api/v1/auth/apple/login',
    });
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
    return persistAuthSession(response, { baseUrl: authBaseUrl });
  },
  syncTunnelCredentials: async (payload: {
    signalingUrl: string;
    accessToken: string;
    accountId?: string;
    iceServers: ICEServerPayload[];
  }) => {
    return request<{ ok: boolean; message: string }>('POST', '/tunnel/credentials', payload);
  },
  syncAccountContext: async (payload: {
    authBaseUrl: string;
    accessToken: string;
    accountId?: string;
  }) => {
    return request<{ ok: boolean; message: string }>('POST', '/account/context', payload);
  },
  getAuthSession: () => {
    ensureSessionLoaded();
    return authSession;
  },
  getAuthSessionView: async () => {
    ensureSessionLoaded();
    return createAuthSessionViewWithProfile(authSession);
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
          {
            baseUrl: authSession.baseUrl,
            phone: authSession.phone,
            email: authSession.email,
            accountLabel: authSession.accountLabel,
          },
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
      log.warn(
        '[sidecar-client] Clearing sidecar account context and tunnel credentials: no active auth session or access token.',
        {
          hasSession: Boolean(session),
          hasAccessToken: Boolean(session?.accessToken),
        },
      );
      const contextRes = await sidecarClient.syncAccountContext({
        authBaseUrl: '',
        accessToken: '',
      });
      log.info('[sidecar-client] Sidecar account context clear request completed.', {
        ok: contextRes.ok,
        message: contextRes.message,
      });
      const res = await sidecarClient.syncTunnelCredentials({
        signalingUrl: '',
        accessToken: '',
        iceServers: [],
      });
      log.info('[sidecar-client] Sidecar tunnel credentials clear request completed.', {
        ok: res.ok,
        message: res.message,
      });
      return true;
    }

    const syncActiveAccountContext = async () => {
      const activeSession = sidecarClient.getAuthSession();
      if (!activeSession || !activeSession.accessToken) {
        return false;
      }
      const accountBaseUrl = sidecarClient.getApiBaseUrl();
      const accountId = accountIDFromAccessToken(activeSession.accessToken);
      const accountRes = await sidecarClient.syncAccountContext({
        authBaseUrl: accountBaseUrl,
        accessToken: activeSession.accessToken,
        accountId,
      });
      log.info('[sidecar-client] Sidecar account context sync request completed.', {
        ok: accountRes.ok,
        message: accountRes.message,
        baseUrl: accountBaseUrl,
        hasAccountId: Boolean(accountId),
      });
      return accountRes.ok;
    };

    const turnBaseUrl = sidecarClient.getApiBaseUrl();
    log.info('[sidecar-client] Fetching TURN credentials for sidecar tunnel.', {
      baseUrl: turnBaseUrl,
    });
    let turnRes: Awaited<ReturnType<typeof sidecarClient.fetchTurnCredentials>>;
    try {
      turnRes = await sidecarClient.fetchTurnCredentials();
    } catch (error) {
      await syncActiveAccountContext();
      throw error;
    }
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
        try {
          turnRes = await sidecarClient.fetchTurnCredentials();
        } catch (error) {
          await syncActiveAccountContext();
          throw error;
        }
      } else {
        log.warn('[sidecar-client] Token refresh failed.');
      }
    }

    if (!turnRes || turnRes.code !== 0 || !turnRes.data) {
      await syncActiveAccountContext();
      throw new Error(`Fetch TURN credentials failed with code: ${turnRes?.code}`);
    }
    await syncActiveAccountContext();
    log.info('[sidecar-client] TURN credentials fetched for sidecar tunnel.', {
      baseUrl: sidecarClient.getApiBaseUrl(),
      urlsCount: turnRes.data.urls.length,
      hasUsername: Boolean(turnRes.data.username),
      hasCredential: Boolean(turnRes.data.credential),
    });

    const iceServers: ICEServerPayload[] = [
      {
        urls: turnRes.data.urls,
        username: turnRes.data.username,
        credential: turnRes.data.credential,
      },
    ];

    const signalingUrl = sidecarClient.getApiBaseUrl();
    log.info('[sidecar-client] Applying sidecar tunnel credentials.', {
      signalingUrl,
      iceServerCount: iceServers.length,
    });
    const res = await sidecarClient.syncTunnelCredentials({
      signalingUrl,
      accessToken: session.accessToken,
      accountId: accountIDFromAccessToken(session.accessToken),
      iceServers,
    });
    log.info('[sidecar-client] Sidecar tunnel credentials apply request completed.', {
      ok: res.ok,
      message: res.message,
    });
    return res.ok;
  } catch (error) {
    log.error('Failed to sync credentials to sidecar:', error);
    return false;
  }
}
