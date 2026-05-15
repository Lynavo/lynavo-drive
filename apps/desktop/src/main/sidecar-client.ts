import http from 'node:http';
import https from 'node:https';
import { APP_COMPATIBILITY_VERSION, SIDECAR_HTTP_PORT } from '@syncflow/contracts';
import type {
  DeviceFileLedgerPageDTO,
  DeviceFileSortField,
  SortDirection,
} from '@syncflow/contracts';
import { desktopClientHeaders } from './app-info';

const BASE = `http://127.0.0.1:${SIDECAR_HTTP_PORT}`;
const API_BASE =
  process.env.VIVIDROP_API_BASE_URL?.trim() ||
  process.env.SYNCFLOW_API_BASE_URL?.trim() ||
  'https://api.vividrop.cn';
const GIFT_CARD_REDEEM_BASE_URL =
  process.env.SYNCFLOW_GIFTCARD_REDEEM_BASE_URL?.trim() || API_BASE;
const GIFT_CARD_REDEEM_PATH =
  process.env.SYNCFLOW_GIFTCARD_REDEEM_PATH ?? '/api/v1/gift-cards/redeem';
const CLIENT_CONFIG_BASE_URL =
  process.env.SYNCFLOW_CLIENT_CONFIG_BASE_URL?.trim() || API_BASE;
const CLIENT_CONFIG_PATH =
  process.env.SYNCFLOW_CLIENT_CONFIG_PATH ?? '/api/v1/config';
const AUTH_BASE_URL =
  process.env.SYNCFLOW_AUTH_BASE_URL?.trim() || GIFT_CARD_REDEEM_BASE_URL || API_BASE;
const AUTH_SMS_SEND_PATH =
  process.env.SYNCFLOW_AUTH_SMS_SEND_PATH ?? '/api/v1/auth/sms/send';
const AUTH_SMS_LOGIN_PATH =
  process.env.SYNCFLOW_AUTH_SMS_LOGIN_PATH ?? '/api/v1/auth/sms/login';

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
};

let authSession: AuthSession | null = null;

function optionalGiftCardRedeemToken(): string | null {
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
  const data = envelope.data && typeof envelope.data === 'object'
    ? (envelope.data as Record<string, unknown>)
    : envelope;
  const features = data.features && typeof data.features === 'object'
    ? (data.features as Record<string, unknown>)
    : {};
  const giftCard = features.gift_card && typeof features.gift_card === 'object'
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
    return { ok: true };
  }

  return {
    ok: false,
    reason: mapAuthFailureReason(data.code),
    message: typeof data.message === 'string' ? data.message : undefined,
  };
}

function persistAuthSession(value: unknown): AuthResponse {
  const normalized = normalizeAuthResponse(value);
  if (!normalized.ok) {
    authSession = null;
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

  authSession = {
    accessToken: authData.access_token,
    refreshToken: authData.refresh_token,
  };
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

    const req = transport.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data) as T);
        } else {
          reject(
            new Error(
              `${method} ${url.origin}${url.pathname}${url.search}: ${res.statusCode} ${data}`,
            ),
          );
        }
      });
    });

    req.on('error', reject);
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
        GIFT_CARD_REDEEM_BASE_URL,
        apiAuthHeaders(),
      );
      return normalizeGiftCardRedeemResponse(response);
    } catch (error) {
      if (isGiftCardAuthError(error)) {
        authSession = null;
        return { ok: false, reason: 'auth_required' };
      }
      throw error;
    }
  },
  sendSMSCode: async (payload: SendSMSCodePayload) => {
    const response = await request<unknown>(
      'POST',
      AUTH_SMS_SEND_PATH,
      payload,
      AUTH_BASE_URL,
    );
    return normalizeAuthResponse(response);
  },
  loginWithSMSCode: async (payload: PhoneLoginPayload) => {
    const response = await request<unknown>(
      'POST',
      AUTH_SMS_LOGIN_PATH,
      payload,
      AUTH_BASE_URL,
    );
    return persistAuthSession(response);
  },
};
