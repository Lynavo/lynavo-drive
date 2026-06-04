const path = require('node:path');

const GOOGLE_OAUTH_ENV_KEYS = [
  'SYNCFLOW_GOOGLE_CLIENT_CONFIG_FILE',
  'GOOGLE_CLIENT_CONFIG_FILE',
  'GOOGLE_CLIENT_SECRET_FILE',
  'SYNCFLOW_GOOGLE_CLIENT_CONFIG_DIR',
  'GOOGLE_CLIENT_CONFIG_DIR',
  'SYNCFLOW_GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_ID',
  'SYNCFLOW_GOOGLE_CLIENT_SECRET',
  'GOOGLE_CLIENT_SECRET',
];

const APPLE_OAUTH_ENV_KEYS = [
  'SYNCFLOW_APPLE_SIGN_CONFIG_FILE',
  'APPLE_SIGN_CONFIG_FILE',
  'SYNCFLOW_APPLE_SIGN_CONFIG_DIR',
  'APPLE_SIGN_CONFIG_DIR',
  'SYNCFLOW_APPLE_CLIENT_ID',
  'APPLE_OAUTH_CLIENT_ID',
  'APPLE_CLIENT_ID',
  'SYNCFLOW_APPLE_REDIRECT_URI',
  'APPLE_REDIRECT_URI',
];

function hasExplicitGoogleOAuthEnv(env) {
  return GOOGLE_OAUTH_ENV_KEYS.some((key) => {
    const value = env[key];
    return typeof value === 'string' && value.trim().length > 0;
  });
}

function hasExplicitAppleOAuthEnv(env) {
  return APPLE_OAUTH_ENV_KEYS.some((key) => {
    const value = env[key];
    return typeof value === 'string' && value.trim().length > 0;
  });
}

function shouldResolveDefaultOAuthConfig({ command, env }) {
  return command === 'dev' && env.SYNCFLOW_MARKET?.trim().toLowerCase() === 'global';
}

function resolveDefaultGoogleClientConfigDir({ command, env, existsSync, projectRoot }) {
  if (!shouldResolveDefaultOAuthConfig({ command, env })) {
    return '';
  }
  if (hasExplicitGoogleOAuthEnv(env)) {
    return '';
  }

  const repoRoot = path.resolve(projectRoot, '..', '..');
  const workspaceRoot = path.resolve(repoRoot, '..');
  const candidates = ['global-google-singin', 'global-google-signin'].map((name) =>
    path.join(workspaceRoot, 'vivi-drop-server', '.config', name),
  );
  return candidates.find((candidate) => existsSync(candidate)) ?? '';
}

function resolveDefaultAppleSignConfigDir({ command, env, existsSync, projectRoot }) {
  if (!shouldResolveDefaultOAuthConfig({ command, env })) {
    return '';
  }
  if (hasExplicitAppleOAuthEnv(env)) {
    return '';
  }

  const repoRoot = path.resolve(projectRoot, '..', '..');
  const workspaceRoot = path.resolve(repoRoot, '..');
  const candidate = path.join(workspaceRoot, 'vivi-drop-server', '.config', 'apple-sign');
  return existsSync(path.join(candidate, 'id.txt')) ? candidate : '';
}

module.exports = {
  resolveDefaultGoogleClientConfigDir,
  resolveDefaultAppleSignConfigDir,
};
