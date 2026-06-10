import { ipcMain, BrowserWindow, net } from 'electron';
import log from 'electron-log';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  sidecarClient,
  supportsPairingRevocationOnCodeRotation,
  syncCredentialsToSidecar,
} from './sidecar-client';
import { resolveAppleOAuthConfig, resolveGoogleOAuthConfig } from './oauth-config';
import {
  openFolder,
  openFile,
  openExternal,
  selectFolder,
  copyToClipboard,
} from './file-operations';
import type { SidecarManager } from './sidecar-manager';
import {
  checkForUpdates,
  exportDiagnostics,
  getAppInfo,
  uploadDiagnostics,
  type DiagnosticsUploadRequest,
} from './diagnostics';
import { installBonjourForWindows } from './bonjour-installer';

// Channel constants — shared between main and preload
export const IPC = {
  SIDECAR_HEALTH: 'sidecar:health',
  SIDECAR_DASHBOARD_SUMMARY: 'sidecar:dashboard-summary',
  SIDECAR_DASHBOARD_DEVICES: 'sidecar:dashboard-devices',
  SIDECAR_DEVICE_FILES: 'sidecar:device-files',
  SIDECAR_DEVICE_DATES: 'sidecar:device-dates',
  SIDECAR_SETTINGS: 'sidecar:settings',
  SIDECAR_UPDATE_SETTINGS: 'sidecar:update-settings',
  SIDECAR_RESET_STATE: 'sidecar:reset-state',
  SIDECAR_CONNECTION_DEVICES: 'sidecar:connection-devices',
  SIDECAR_REVOKE_CONNECTION_DEVICE: 'sidecar:revoke-connection-device',
  SIDECAR_CLEAR_BLOCKED_CLIENT: 'sidecar:clear-blocked-client',
  SIDECAR_CLIENT_CONFIG: 'sidecar:client-config',
  SIDECAR_REDEEM_GIFT_CARD: 'sidecar:redeem-gift-card',
  AUTH_SEND_SMS_CODE: 'auth:send-sms-code',
  AUTH_LOGIN_WITH_SMS_CODE: 'auth:login-with-sms-code',
  AUTH_GET_SESSION: 'auth:get-session',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_LOGIN_WITH_OAUTH: 'auth:login-with-oauth',
  SIDECAR_REGENERATE_CODE: 'sidecar:regenerate-code',
  SIDECAR_RUNTIME_STATE: 'sidecar:runtime-state',
  SIDECAR_RETRY_START: 'sidecar:retry-start',
  SIDECAR_INSTALL_BONJOUR: 'sidecar:install-bonjour',
  SIDECAR_SHARE_STATUS: 'sidecar:share-status',
  SIDECAR_VALIDATE_SHARE: 'sidecar:validate-share',
  SIDECAR_TRANSFER_ACTIVE: 'sidecar:transfer-active',
  SIDECAR_SHARED_LIST: 'sidecar:shared-list',
  SUPPORT_UPLOAD_DIAGNOSTICS: 'support:upload-diagnostics',
  SUPPORT_EXPORT_DIAGNOSTICS: 'support:export-diagnostics',
  SUPPORT_CHECK_FOR_UPDATES: 'support:check-for-updates',
  SUPPORT_APP_INFO: 'support:app-info',
  FILES_OPEN_FOLDER: 'files:open-folder',
  FILES_OPEN_FILE: 'files:open-file',
  FILES_OPEN_EXTERNAL: 'files:open-external',
  FILES_SELECT_FOLDER: 'files:select-folder',
  FILES_COPY_CLIPBOARD: 'files:copy-clipboard',
  POWER_SAVE_GET_STATE: 'power-save:get-state',
  POWER_SAVE_SET_PREVENT_SLEEP: 'power-save:set-prevent-sleep',
} as const;

type PowerSaveState = {
  preventSleepDuringTransfer: boolean;
  blockingSleep: boolean;
};

type PowerSaveController = {
  getState(): PowerSaveState;
  setPreventSleepDuringTransfer(enabled: boolean): PowerSaveState;
};

async function regenerateConnectionCodeSafely(
  sidecarManager: SidecarManager,
): Promise<{ code: string }> {
  let health = null;
  try {
    health = await sidecarClient.getHealth();
  } catch {
    // Regeneration is a foreground user action; recover the sidecar here so
    // the UI cannot report a fresh code from a stale or missing service.
  }
  if (!supportsPairingRevocationOnCodeRotation(health)) {
    await sidecarManager.retryStart();
  }
  return sidecarClient.regenerateConnectionCode();
}

type AuthIpcResult = {
  ok: boolean;
  message?: string;
  reason?: string;
  userId?: number;
  isNewUser?: boolean;
  merged?: boolean;
};

const OAUTH_TOKEN_EXCHANGE_TIMEOUT_MS = 15_000;

function createOAuthToken(): string {
  return randomBytes(32).toString('base64url');
}

function createPKCEChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
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

function idTokenHasNonce(idToken: string, expectedNonce: string): boolean {
  return decodeJwtPayload(idToken)?.nonce === expectedNonce;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorDiagnostics(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { message: String(error) };
  }
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

function createOAuthCallbackParams(targetUrl: string): URLSearchParams {
  const url = new URL(targetUrl);
  const params = new URLSearchParams(url.search);
  if (url.hash) {
    new URLSearchParams(url.hash.slice(1)).forEach((value, key) => {
      params.set(key, value);
    });
  }
  return params;
}

function createLoopbackRedirectUri(registeredRedirectUri: string, port: number): string {
  const redirectUrl = new URL(registeredRedirectUri);
  if (redirectUrl.protocol !== 'http:') {
    throw new Error('Google OAuth redirect URI must be an HTTP loopback URI');
  }
  if (!['localhost', '127.0.0.1'].includes(redirectUrl.hostname)) {
    throw new Error('Google OAuth redirect URI must use localhost or loopback IP');
  }
  redirectUrl.hostname = '127.0.0.1';
  redirectUrl.port = String(port);
  redirectUrl.hash = '';
  return redirectUrl.toString();
}

function readUploadDataBody(uploadData: Electron.UploadData[]): string {
  return Buffer.concat(uploadData.map((entry) => Buffer.from(entry.bytes))).toString();
}

type GoogleOAuthLoopback = {
  redirectUri: string;
  waitForCode: Promise<string>;
  close: () => void;
};

async function startGoogleOAuthLoopback(
  registeredRedirectUri: string,
  expectedState: string,
): Promise<GoogleOAuthLoopback> {
  const server = createServer();
  let settled = false;
  let timeout: NodeJS.Timeout;
  const close = () => {
    clearTimeout(timeout);
    server.close();
  };
  let rejectCode: (reason?: unknown) => void = () => undefined;
  timeout = setTimeout(() => {
    if (!settled) {
      settled = true;
      close();
      rejectCode(new Error('Google OAuth callback timed out'));
    }
  }, 5 * 60_000);

  const waitForCode = new Promise<string>((resolve, reject) => {
    rejectCode = reject;
    server.on('request', (req, res) => {
      if (settled) {
        res.writeHead(409, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          '<html><body>Google sign-in already handled. You can close this window.</body></html>',
        );
        return;
      }

      const host = req.headers.host;
      const targetUrl = new URL(req.url ?? '/', `http://${host}`);
      const params = targetUrl.searchParams;
      const error = params.get('error');
      if (error) {
        settled = true;
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<html><body>Google sign-in failed. You can close this window.</body></html>');
        close();
        reject(new Error(error));
        return;
      }

      const state = params.get('state');
      const code = params.get('code');
      if (state !== expectedState || !code) {
        settled = true;
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          '<html><body>Invalid Google sign-in response. You can close this window.</body></html>',
        );
        close();
        reject(new Error(state !== expectedState ? 'OAuth state mismatch' : 'No code in redirect'));
        return;
      }

      settled = true;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body>Google sign-in complete. You can close this window.</body></html>');
      close();
      resolve(code);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  return {
    redirectUri: createLoopbackRedirectUri(registeredRedirectUri, address.port),
    waitForCode,
    close,
  };
}

async function exchangeGoogleAuthorizationCode(payload: {
  clientId: string;
  clientSecret?: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OAUTH_TOKEN_EXCHANGE_TIMEOUT_MS);
  let response: Response;
  const tokenRequestBody = new URLSearchParams({
    client_id: payload.clientId,
    code: payload.code,
    code_verifier: payload.codeVerifier,
    grant_type: 'authorization_code',
    redirect_uri: payload.redirectUri,
  });
  if (payload.clientSecret) {
    tokenRequestBody.set('client_secret', payload.clientSecret);
  }
  try {
    response = await net.fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: controller.signal,
      body: tokenRequestBody,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('Google token exchange timed out');
    }
    log.error('[auth] Google token exchange request failed.', errorDiagnostics(error));
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const body = (await response.json()) as {
    id_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !body.id_token) {
    throw new Error(
      body.error_description || body.error || `Google token exchange failed (${response.status})`,
    );
  }
  return body.id_token;
}

function syncLoginCredentialsAfterSuccess(
  sidecarManager: SidecarManager,
  source: string,
): Promise<void> {
  return syncCredentialsToSidecar()
    .then((success) => {
      if (success) {
        sidecarManager.startCredentialsSyncInterval();
      }
    })
    .catch((err) => {
      log.error(`Failed to sync credentials after ${source} login:`, err);
    });
}

export function registerIpcHandlers(
  sidecarManager: SidecarManager,
  powerSave?: PowerSaveController,
): void {
  // Sidecar — real HTTP calls
  ipcMain.handle(IPC.SIDECAR_HEALTH, () => sidecarClient.getHealth());
  ipcMain.handle(IPC.SIDECAR_DASHBOARD_SUMMARY, () => sidecarClient.getDashboardSummary());
  ipcMain.handle(IPC.SIDECAR_DASHBOARD_DEVICES, () => sidecarClient.getDashboardDevices());
  ipcMain.handle(
    IPC.SIDECAR_DEVICE_FILES,
    (
      _e,
      deviceId: string,
      date: string,
      options?: {
        page?: number;
        pageSize?: number;
        sortField?: import('@syncflow/contracts').DeviceFileSortField;
        sortDirection?: import('@syncflow/contracts').SortDirection;
      },
    ) => sidecarClient.getDeviceFiles(deviceId, date, options),
  );
  ipcMain.handle(IPC.SIDECAR_DEVICE_DATES, (_e, deviceId: string) =>
    sidecarClient.getDeviceDates(deviceId),
  );
  ipcMain.handle(IPC.SIDECAR_SETTINGS, () => sidecarClient.getSettings());
  ipcMain.handle(IPC.SIDECAR_UPDATE_SETTINGS, (_e, partial) =>
    sidecarClient.updateSettings(partial),
  );
  ipcMain.handle(IPC.SIDECAR_RESET_STATE, () => sidecarClient.resetState());
  ipcMain.handle(IPC.SIDECAR_CONNECTION_DEVICES, () => sidecarClient.getConnectionDevices());
  ipcMain.handle(IPC.SIDECAR_REVOKE_CONNECTION_DEVICE, (_e, clientId: string) =>
    sidecarClient.revokeConnectionDevice(clientId),
  );
  ipcMain.handle(IPC.SIDECAR_CLEAR_BLOCKED_CLIENT, (_e, clientId: string) =>
    sidecarClient.clearBlockedClient(clientId),
  );
  ipcMain.handle(IPC.SIDECAR_CLIENT_CONFIG, () => sidecarClient.getClientConfig());
  ipcMain.handle(IPC.SIDECAR_REDEEM_GIFT_CARD, (_e, payload: { code: string }) =>
    sidecarClient.redeemGiftCard(payload),
  );
  ipcMain.handle(IPC.AUTH_SEND_SMS_CODE, (_e, payload: { phone: string }) =>
    sidecarClient.sendSMSCode(payload),
  );
  ipcMain.handle(
    IPC.AUTH_LOGIN_WITH_SMS_CODE,
    async (_e, payload: { phone: string; code: string }) => {
      const res = await sidecarClient.loginWithSMSCode(payload);
      if (res.ok) {
        void syncLoginCredentialsAfterSuccess(sidecarManager, 'SMS');
      }
      return res;
    },
  );
  ipcMain.handle(IPC.AUTH_GET_SESSION, () => sidecarClient.getAuthSessionView());
  ipcMain.handle(IPC.AUTH_LOGOUT, () => sidecarClient.logout());
  ipcMain.handle(
    IPC.AUTH_LOGIN_WITH_OAUTH,
    async (_e, payload: { provider: 'google' | 'apple' }) => {
      return new Promise<AuthIpcResult>((resolve) => {
        let resolved = false;
        let closingForCallback = false;
        const safeResolve = (val: AuthIpcResult) => {
          if (!resolved) {
            resolved = true;
            resolve(val);
          }
        };

        void (async () => {
          if (payload.provider === 'google') {
            let googleConfig;
            try {
              googleConfig = resolveGoogleOAuthConfig();
            } catch (err) {
              safeResolve({ ok: false, message: errorMessage(err) });
              return;
            }

            if (!googleConfig.clientId) {
              safeResolve({
                ok: false,
                message:
                  'Google OAuth config missing (SYNCFLOW_GOOGLE_CLIENT_ID / GOOGLE_CLIENT_ID / SYNCFLOW_GOOGLE_CLIENT_CONFIG_FILE)',
              });
              return;
            }

            const state = createOAuthToken();
            const nonce = createOAuthToken();
            const codeVerifier = createOAuthToken();
            const codeChallenge = createPKCEChallenge(codeVerifier);
            let loopback: GoogleOAuthLoopback;
            try {
              loopback = await startGoogleOAuthLoopback(googleConfig.redirectUri, state);
            } catch (err) {
              safeResolve({ ok: false, message: errorMessage(err) });
              return;
            }
            const googleUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
            googleUrl.search = new URLSearchParams({
              client_id: googleConfig.clientId,
              redirect_uri: loopback.redirectUri,
              response_type: 'code',
              scope: 'openid email profile',
              state,
              nonce,
              code_challenge: codeChallenge,
              code_challenge_method: 'S256',
            }).toString();

            try {
              await openExternal(googleUrl.toString());
              const code = await loopback.waitForCode;
              const idToken = await exchangeGoogleAuthorizationCode({
                clientId: googleConfig.clientId,
                clientSecret: googleConfig.clientSecret,
                code,
                codeVerifier,
                redirectUri: loopback.redirectUri,
              });
              if (!idTokenHasNonce(idToken, nonce)) {
                throw new Error('OAuth nonce mismatch');
              }
              const res = await sidecarClient.loginWithGoogle({ identityToken: idToken });
              if (res.ok) {
                await syncLoginCredentialsAfterSuccess(sidecarManager, 'Google');
              }
              safeResolve(res);
            } catch (err) {
              loopback.close();
              safeResolve({ ok: false, message: errorMessage(err) });
            }
          } else if (payload.provider === 'apple') {
            const win = new BrowserWindow({
              width: 500,
              height: 600,
              show: false,
              webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
              },
            });

            win.once('ready-to-show', () => win.show());

            win.on('closed', () => {
              if (!closingForCallback) {
                safeResolve({ ok: false, message: 'Login window closed by user' });
              }
            });

            let appleConfig;
            try {
              appleConfig = resolveAppleOAuthConfig();
            } catch (err) {
              closingForCallback = true;
              win.destroy();
              safeResolve({ ok: false, message: errorMessage(err) });
              return;
            }

            if (!appleConfig.clientId || !appleConfig.redirectUri) {
              closingForCallback = true;
              win.destroy();
              safeResolve({
                ok: false,
                message:
                  'Apple OAuth config missing (SYNCFLOW_APPLE_CLIENT_ID / APPLE_OAUTH_CLIENT_ID / SYNCFLOW_APPLE_REDIRECT_URI / SYNCFLOW_APPLE_SIGN_CONFIG_DIR)',
              });
              return;
            }

            const state = createOAuthToken();
            const nonce = createOAuthToken();
            const appleUrl = new URL('https://appleid.apple.com/auth/authorize');
            appleUrl.search = new URLSearchParams({
              client_id: appleConfig.clientId,
              redirect_uri: appleConfig.redirectUri,
              response_type: 'code id_token',
              response_mode: 'form_post',
              scope: 'name email',
              state,
              nonce,
            }).toString();

            // 攔截 POST 到 redirectUri 的請求
            const session = win.webContents.session;
            session.webRequest.onBeforeRequest(
              { urls: [appleConfig.redirectUri + '*'] },
              (details, callback) => {
                if (
                  details.method === 'POST' &&
                  details.uploadData &&
                  details.uploadData.length > 0
                ) {
                  closingForCallback = true;
                  const rawBody = readUploadDataBody(details.uploadData);
                  callback({ cancel: true });
                  win.destroy();

                  void (async () => {
                    try {
                      const params = new URLSearchParams(rawBody);
                      if (params.get('state') !== state) {
                        throw new Error('OAuth state mismatch');
                      }
                      const idToken = params.get('id_token');
                      const code = params.get('code') || undefined;
                      const userStr = params.get('user');
                      let fullName = '';
                      if (userStr) {
                        const parsedUser = JSON.parse(userStr);
                        if (parsedUser.name) {
                          fullName =
                            `${parsedUser.name.firstName || ''} ${parsedUser.name.lastName || ''}`.trim();
                        }
                      }

                      if (!idToken) throw new Error('No id_token returned from Apple');
                      if (!idTokenHasNonce(idToken, nonce)) {
                        throw new Error('OAuth nonce mismatch');
                      }
                      const res = await sidecarClient.loginWithApple({
                        identityToken: idToken,
                        authorizationCode: code,
                        fullName: fullName || undefined,
                      });
                      if (res.ok) {
                        await syncLoginCredentialsAfterSuccess(sidecarManager, 'Apple');
                      }
                      safeResolve(res);
                    } catch (err) {
                      safeResolve({ ok: false, message: errorMessage(err) });
                    }
                  })();
                } else {
                  callback({});
                }
              },
            );

            await win.loadURL(appleUrl.toString());
          }
        })().catch((err) => {
          safeResolve({ ok: false, message: errorMessage(err) });
        });
      });
    },
  );
  ipcMain.handle(IPC.SIDECAR_REGENERATE_CODE, () => regenerateConnectionCodeSafely(sidecarManager));
  ipcMain.handle(IPC.SIDECAR_RUNTIME_STATE, () => sidecarManager.getState());
  ipcMain.handle(IPC.SIDECAR_RETRY_START, () => sidecarManager.retryStart());
  ipcMain.handle(IPC.SIDECAR_INSTALL_BONJOUR, () => installBonjourForWindows(sidecarManager));
  ipcMain.handle(IPC.SIDECAR_SHARE_STATUS, () => sidecarClient.getShareStatus());
  ipcMain.handle(IPC.SIDECAR_VALIDATE_SHARE, () => sidecarClient.validateShare());
  ipcMain.handle(IPC.SIDECAR_TRANSFER_ACTIVE, () => sidecarClient.getTransferActive());
  ipcMain.handle(IPC.SIDECAR_SHARED_LIST, (_e, path?: string) => sidecarClient.getSharedList(path));
  if (powerSave) {
    ipcMain.handle(IPC.POWER_SAVE_GET_STATE, async () => powerSave.getState());
    ipcMain.handle(IPC.POWER_SAVE_SET_PREVENT_SLEEP, async (_e, enabled: boolean) =>
      powerSave.setPreventSleepDuringTransfer(enabled),
    );
  }
  ipcMain.handle(IPC.SUPPORT_UPLOAD_DIAGNOSTICS, (_e, request: DiagnosticsUploadRequest) =>
    uploadDiagnostics(sidecarManager, request),
  );
  ipcMain.handle(IPC.SUPPORT_EXPORT_DIAGNOSTICS, (_e, locale?: string, description?: string) =>
    exportDiagnostics(sidecarManager, locale, description),
  );
  ipcMain.handle(IPC.SUPPORT_CHECK_FOR_UPDATES, () => checkForUpdates());
  ipcMain.handle(IPC.SUPPORT_APP_INFO, () => getAppInfo());

  // File operations — real Electron APIs
  ipcMain.handle(IPC.FILES_OPEN_FOLDER, (_e, path: string) => openFolder(path));
  ipcMain.handle(IPC.FILES_OPEN_FILE, (_e, path: string) => openFile(path));
  ipcMain.handle(IPC.FILES_OPEN_EXTERNAL, (_e, target: string) => openExternal(target));
  ipcMain.handle(IPC.FILES_SELECT_FOLDER, () => selectFolder());
  ipcMain.handle(IPC.FILES_COPY_CLIPBOARD, (_e, text: string) => copyToClipboard(text));
}
