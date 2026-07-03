const SENSITIVE_LYNAVO_ENV_SEGMENTS = new Set([
  'API',
  'APP',
  'AUTH',
  'CLIENT',
  'CONFIG',
  'CREDENTIAL',
  'DIAGNOSTICS',
  'GIFT',
  'GOOGLE',
  'KEY',
  'OAUTH',
  'PASSWORD',
  'REDEEM',
  'REDIRECT',
  'SECRET',
  'SUPPORT',
  'TOKEN',
  'UPDATE',
  'UPLOAD',
  'URI',
  'URL',
]);

const SENSITIVE_EXTERNAL_ENV_PATTERNS = Object.freeze([
  /^APPLE_/,
  /^ASC_/,
  /^CSC_/,
  /^ELECTRON_BUILDER_PUBLISH$/,
  /^GH_TOKEN$/,
  /^GITHUB_TOKEN$/,
  /^WIN_CSC_/,
  /^GOOGLE_(?:API|CLIENT|OAUTH|SERVICE|SIGN_IN)/,
]);

function isSensitiveReleaseEnvKey(key) {
  if (key === 'LYNAVO_RELEASE_CHANNEL') {
    return false;
  }

  if (key.startsWith('LYNAVO_')) {
    return key
      .slice('LYNAVO_'.length)
      .split('_')
      .some((segment) => SENSITIVE_LYNAVO_ENV_SEGMENTS.has(segment));
  }

  return SENSITIVE_EXTERNAL_ENV_PATTERNS.some((pattern) => pattern.test(key));
}

function removeSensitiveReleaseEnv(env) {
  for (const key of Object.keys(env)) {
    if (isSensitiveReleaseEnvKey(key)) {
      delete env[key];
    }
  }
  return env;
}

function buildReleaseChildEnv(parentEnv, profileEnv = {}) {
  const env = removeSensitiveReleaseEnv({ ...parentEnv });
  return {
    ...env,
    ...profileEnv,
  };
}

module.exports = {
  buildReleaseChildEnv,
  isSensitiveReleaseEnvKey,
  removeSensitiveReleaseEnv,
};
