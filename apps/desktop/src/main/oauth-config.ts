import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isGlobalMarket } from '../shared/market';

export type GoogleOAuthConfig = {
  clientId: string;
  redirectUri: string;
};

export type AppleOAuthConfig = {
  clientId: string;
  redirectUri: string;
};

type GoogleClientFile = {
  installed?: {
    client_id?: string;
    redirect_uris?: string[];
  };
  web?: {
    client_id?: string;
    redirect_uris?: string[];
  };
};

type GoogleIDConfig = {
  desktopClientId?: string;
  webClientId?: string;
};

type AppleSignConfig = {
  clientId?: string;
  reviewRedirectUri?: string;
  globalRedirectUri?: string;
};

const DEFAULT_GOOGLE_REDIRECT_URI = 'http://localhost';
const GLOBAL_GOOGLE_DESKTOP_CLIENT_ID =
  '318131526906-9iivkqid8imviaa3gj0i6kmer54tn5n5.apps.googleusercontent.com';
const GLOBAL_APPLE_CLIENT_ID = 'com.vividrop.global.signin';
const GLOBAL_APPLE_REDIRECT_URI = 'https://global-api.vividrop.com/auth/apple/callback';

function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return '';
}

function readGoogleClientFile(path: string): Partial<GoogleOAuthConfig> {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as GoogleClientFile;
  const client = parsed.installed ?? parsed.web;
  return {
    clientId: client?.client_id?.trim(),
    redirectUri: client?.redirect_uris?.find((uri) => uri.trim())?.trim(),
  };
}

function readGoogleIDConfigFile(path: string): GoogleIDConfig {
  const raw = readFileSync(path, 'utf8');
  const config: GoogleIDConfig = {};

  for (const line of raw.split(/\r?\n/)) {
    const { label, value } = splitLabeledLine(line);
    if (!label || !value) {
      continue;
    }
    if (!isGoogleClientIDLabel(label)) {
      continue;
    }
    if (label.includes('desktop') || label.includes('桌面')) {
      config.desktopClientId = value;
    } else if (label.includes('web') || label.includes('網頁') || label.includes('网页')) {
      config.webClientId = value;
    }
  }

  return config;
}

function isGoogleClientIDLabel(label: string): boolean {
  const lower = label.toLowerCase();
  const compact = lower.replace(/\s+/g, '');
  if (
    lower.includes('secret') ||
    lower.includes('密钥') ||
    lower.includes('密鑰') ||
    lower.includes('key')
  ) {
    return false;
  }
  return (
    lower.includes('client id') || compact.includes('客户端id') || compact.includes('客戶端id')
  );
}

function readGoogleClientDirectory(path: string): Partial<GoogleOAuthConfig> {
  const jsonFiles = readdirSync(path)
    .filter((name) => name.toLowerCase().endsWith('.json'))
    .sort();
  const candidates = jsonFiles
    .map((name) => ({ name, config: readGoogleClientFile(join(path, name)) }))
    .filter(({ config }) => config.clientId);

  const desktopCandidate = candidates.find(({ name }) => name.toLowerCase().includes('desktop'));
  if (desktopCandidate) {
    return desktopCandidate.config;
  }

  const loopbackCandidate = candidates.find(({ config }) => config.redirectUri);
  if (loopbackCandidate) {
    return loopbackCandidate.config;
  }

  const idPath = join(path, 'id.txt');
  try {
    const idConfig = readGoogleIDConfigFile(idPath);
    return {
      clientId: firstNonEmpty(idConfig.desktopClientId, idConfig.webClientId),
    };
  } catch {
    return candidates[0]?.config ?? {};
  }
}

function readGoogleClientConfig(path: string): Partial<GoogleOAuthConfig> {
  return statSync(path).isDirectory()
    ? readGoogleClientDirectory(path)
    : readGoogleClientFile(path);
}

function readAppleSignConfigFile(path: string): AppleSignConfig {
  const raw = readFileSync(path, 'utf8');
  const config: AppleSignConfig = {};

  for (const line of raw.split(/\r?\n/)) {
    const { label, value } = splitLabeledLine(line);
    if (!label || !value) {
      continue;
    }

    if (label.includes('client id') || label.includes('services id')) {
      config.clientId = value;
    } else if (label.includes('review') || label.includes('测试环境')) {
      config.reviewRedirectUri = value;
    } else if (label.includes('global') || label.includes('正式环境')) {
      config.globalRedirectUri = value;
    }
  }

  return config;
}

function splitLabeledLine(line: string): { label: string; value: string } {
  const halfWidthSeparatorIndex = line.indexOf(':');
  const fullWidthSeparatorIndex = line.indexOf('：');
  const separatorIndex =
    halfWidthSeparatorIndex >= 0 &&
    (fullWidthSeparatorIndex < 0 || halfWidthSeparatorIndex < fullWidthSeparatorIndex)
      ? halfWidthSeparatorIndex
      : fullWidthSeparatorIndex;
  if (separatorIndex < 0) {
    return { label: '', value: '' };
  }
  return {
    label: line.slice(0, separatorIndex).trim().toLowerCase(),
    value: line.slice(separatorIndex + 1).trim(),
  };
}

function firstAppleSignConfigPath(env: NodeJS.ProcessEnv): string {
  const filePath = firstNonEmpty(env.SYNCFLOW_APPLE_SIGN_CONFIG_FILE, env.APPLE_SIGN_CONFIG_FILE);
  if (filePath) {
    return filePath;
  }

  const dirPath = firstNonEmpty(env.SYNCFLOW_APPLE_SIGN_CONFIG_DIR, env.APPLE_SIGN_CONFIG_DIR);
  return dirPath ? join(dirPath, 'id.txt') : '';
}

export function shouldUseReviewOAuthTarget(env: NodeJS.ProcessEnv): boolean {
  const explicitAuthBase = firstNonEmpty(env.SYNCFLOW_AUTH_BASE_URL).toLowerCase();
  if (explicitAuthBase) {
    return explicitAuthBase.includes('review-api') || explicitAuthBase.includes('review.');
  }

  const releaseProfile = env.SYNCFLOW_RELEASE_PROFILE?.trim().toLowerCase();
  if (releaseProfile?.endsWith('-review')) {
    return true;
  }

  const authBase = firstNonEmpty(
    env.SYNCFLOW_AUTH_BASE_URL,
    env.SYNCFLOW_AUTH_REVIEW_BASE_URL,
    env.VIVIDROP_API_BASE_URL,
    env.SYNCFLOW_API_BASE_URL,
  ).toLowerCase();
  return authBase.includes('review-api') || authBase.includes('review.');
}

function resolveAppleRedirectUri(env: NodeJS.ProcessEnv, fileConfig: AppleSignConfig): string {
  const explicit = firstNonEmpty(env.SYNCFLOW_APPLE_REDIRECT_URI, env.APPLE_REDIRECT_URI);
  if (explicit) {
    return explicit;
  }
  if (shouldUseReviewOAuthTarget(env)) {
    return firstNonEmpty(fileConfig.reviewRedirectUri, fileConfig.globalRedirectUri);
  }
  return firstNonEmpty(
    fileConfig.globalRedirectUri,
    fileConfig.reviewRedirectUri,
    isGlobalMarket() ? GLOBAL_APPLE_REDIRECT_URI : undefined,
  );
}

export function resolveGoogleOAuthConfig(env: NodeJS.ProcessEnv = process.env): GoogleOAuthConfig {
  const clientFilePath = firstNonEmpty(
    env.SYNCFLOW_GOOGLE_CLIENT_CONFIG_FILE,
    env.GOOGLE_CLIENT_CONFIG_FILE,
    env.GOOGLE_CLIENT_SECRET_FILE,
    env.SYNCFLOW_GOOGLE_CLIENT_CONFIG_DIR,
    env.GOOGLE_CLIENT_CONFIG_DIR,
  );
  const fileConfig = clientFilePath ? readGoogleClientConfig(clientFilePath) : {};

  return {
    clientId: firstNonEmpty(
      env.SYNCFLOW_GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_ID,
      fileConfig.clientId,
      isGlobalMarket() ? GLOBAL_GOOGLE_DESKTOP_CLIENT_ID : undefined,
    ),
    redirectUri: firstNonEmpty(
      env.SYNCFLOW_GOOGLE_REDIRECT_URI,
      env.GOOGLE_REDIRECT_URI,
      fileConfig.redirectUri,
      DEFAULT_GOOGLE_REDIRECT_URI,
    ),
  };
}

export function resolveAppleOAuthConfig(env: NodeJS.ProcessEnv = process.env): AppleOAuthConfig {
  const signConfigPath = firstAppleSignConfigPath(env);
  const fileConfig = signConfigPath ? readAppleSignConfigFile(signConfigPath) : {};

  return {
    clientId: firstNonEmpty(
      env.SYNCFLOW_APPLE_CLIENT_ID,
      env.APPLE_OAUTH_CLIENT_ID,
      env.APPLE_CLIENT_ID,
      fileConfig.clientId,
      isGlobalMarket() ? GLOBAL_APPLE_CLIENT_ID : undefined,
    ),
    redirectUri: resolveAppleRedirectUri(env, fileConfig),
  };
}
