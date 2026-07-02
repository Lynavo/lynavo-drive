import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { buildElectronViteEnv } = require('../run-electron-vite.cjs');
const token = (parts) => parts.join('');
const legacySyncEnv = (suffix) => token(['SYN', 'CFLOW', suffix]);
const legacyViviEnv = (suffix) => token(['VIVI', 'DROP', suffix]);
const desktopUpdateEnv = token(['LYNAVO_DESKTOP', '_UPDATE_URL']);
const diagnosticsUploadEnv = token(['LYNAVO_DIAGNOSTICS', '_UPLOAD_URL']);

test('desktop dev bootstrap does not resolve official OAuth config from sibling server files', () => {
  const script = readFileSync(new URL('../run-electron-vite.cjs', import.meta.url), 'utf8');

  assert.doesNotMatch(script, /resolveDefault(Google|Apple)/);
  assert.doesNotMatch(script, /vivi-drop-server.*\.(config|secrets).*(google|apple)/i);
  assert.doesNotMatch(script, new RegExp(`${legacySyncEnv('_GOOGLE_CLIENT_CONFIG_DIR')}\\s*=`));
  assert.doesNotMatch(script, new RegExp(`${legacySyncEnv('_APPLE_SIGN_CONFIG_DIR')}\\s*=`));
});

test('desktop dev bootstrap references only OSS release env and does not default legacy market', () => {
  const script = readFileSync(new URL('../run-electron-vite.cjs', import.meta.url), 'utf8');
  const viteConfig = readFileSync(
    new URL('../../electron.vite.config.ts', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(script, /LYNAVO_SUPPORT_API_BASE_URL/);
  assert.equal(script.includes(desktopUpdateEnv), false);
  assert.equal(script.includes(diagnosticsUploadEnv), false);
  assert.doesNotMatch(script, /LYNAVO_API_BASE_URL/);
  assert.match(script, /LYNAVO_RELEASE_CHANNEL/);
  assert.doesNotMatch(script, /LYNAVO_GIFTCARD_REDEEM_BASE_URL/);
  assert.equal(script.includes(legacySyncEnv('_GIFTCARD_REDEEM_BASE_URL')), false);
  assert.doesNotMatch(script, new RegExp(`${legacySyncEnv('_MARKET')}\\s*=\\s*['"]global['"]`));
  assert.equal(viteConfig.includes(`process.env.${legacySyncEnv('_MARKET')}`), false);
  assert.equal(viteConfig.includes(legacyViviEnv('_API_BASE_URL')), false);
  assert.equal(viteConfig.includes(legacySyncEnv('_API_BASE_URL')), false);
});

test('desktop dev bootstrap strips official OAuth env from the OSS runtime', () => {
  const projectRoot = path.join('/tmp/workspace', token(['Sync', 'Flow']), 'apps', 'desktop');
  const env = buildElectronViteEnv({
    command: 'dev',
    parentEnv: {
      LYNAVO_API_BASE_URL: 'https://api.lynavo.com',
      LYNAVO_SUPPORT_API_BASE_URL: 'https://api.lynavo.com',
      [desktopUpdateEnv]: 'https://api.lynavo.com/update',
      [diagnosticsUploadEnv]: 'https://api.lynavo.com/diagnostics',
      [legacySyncEnv('_GOOGLE_CLIENT_CONFIG_FILE')]: '/secure/google-client.json',
      GOOGLE_CLIENT_SECRET_FILE: '/secure/google-secret.json',
      GOOGLE_CLIENT_ID: 'google-client-id',
      [legacySyncEnv('_GOOGLE_CLIENT_SECRET')]: 'google-client-secret',
      [legacySyncEnv('_APPLE_SIGN_CONFIG_FILE')]: '/secure/apple/id.txt',
      APPLE_OAUTH_CLIENT_ID: 'com.example.signin',
      APPLE_REDIRECT_URI: 'https://example.test/callback',
    },
    existsSyncFn: () => true,
    projectRoot,
  });

  assert.equal(Object.hasOwn(env, legacySyncEnv('_GOOGLE_CLIENT_CONFIG_FILE')), false);
  assert.equal(Object.hasOwn(env, 'GOOGLE_CLIENT_SECRET_FILE'), false);
  assert.equal(Object.hasOwn(env, 'GOOGLE_CLIENT_ID'), false);
  assert.equal(Object.hasOwn(env, legacySyncEnv('_GOOGLE_CLIENT_SECRET')), false);
  assert.equal(Object.hasOwn(env, legacySyncEnv('_APPLE_SIGN_CONFIG_FILE')), false);
  assert.equal(Object.hasOwn(env, 'APPLE_OAUTH_CLIENT_ID'), false);
  assert.equal(Object.hasOwn(env, 'APPLE_REDIRECT_URI'), false);
  assert.equal(Object.hasOwn(env, legacySyncEnv('_GOOGLE_CLIENT_CONFIG_DIR')), false);
  assert.equal(Object.hasOwn(env, legacySyncEnv('_APPLE_SIGN_CONFIG_DIR')), false);
  assert.equal(Object.hasOwn(env, 'LYNAVO_SUPPORT_API_BASE_URL'), false);
  assert.equal(Object.hasOwn(env, desktopUpdateEnv), false);
  assert.equal(Object.hasOwn(env, diagnosticsUploadEnv), false);
});

test('desktop dev bootstrap bridges only release channel over stale official and legacy API env', () => {
  const projectRoot = path.join('/tmp/workspace', token(['Sync', 'Flow']), 'apps', 'desktop');
  const env = buildElectronViteEnv({
    command: 'dev',
    parentEnv: {
      LYNAVO_RELEASE_CHANNEL: 'prod',
      LYNAVO_API_BASE_URL: 'https://api.lynavo.com',
      LYNAVO_SUPPORT_API_BASE_URL: 'https://api.lynavo.com',
      [desktopUpdateEnv]: 'https://api.lynavo.com/update',
      [diagnosticsUploadEnv]: 'https://api.lynavo.com/diagnostics',
      LYNAVO_CLIENT_CONFIG_BASE_URL: 'https://config.lynavo.com',
      LYNAVO_GIFTCARD_REDEEM_BASE_URL: 'https://gift.lynavo.com',
      [legacySyncEnv('_API_BASE_URL')]: 'https://old.example',
      [legacyViviEnv('_API_BASE_URL')]: `https://old-${token(['vivi', 'drop'])}.example`,
    },
    existsSyncFn: () => false,
    projectRoot,
  });

  assert.equal(env.LYNAVO_RELEASE_CHANNEL, 'prod');
  assert.equal(Object.hasOwn(env, 'LYNAVO_SUPPORT_API_BASE_URL'), false);
  assert.equal(Object.hasOwn(env, desktopUpdateEnv), false);
  assert.equal(Object.hasOwn(env, diagnosticsUploadEnv), false);
  assert.equal(Object.hasOwn(env, 'LYNAVO_API_BASE_URL'), false);
  assert.equal(Object.hasOwn(env, legacyViviEnv('_API_BASE_URL')), false);
  assert.equal(Object.hasOwn(env, legacySyncEnv('_API_BASE_URL')), false);
  assert.equal(Object.hasOwn(env, 'LYNAVO_CLIENT_CONFIG_BASE_URL'), false);
  assert.equal(Object.hasOwn(env, 'LYNAVO_GIFTCARD_REDEEM_BASE_URL'), false);
  assert.equal(Object.hasOwn(env, legacySyncEnv('_CLIENT_CONFIG_BASE_URL')), false);
  assert.equal(Object.hasOwn(env, legacySyncEnv('_GIFTCARD_REDEEM_BASE_URL')), false);
  assert.equal(Object.hasOwn(env, legacySyncEnv('_AUTH_BASE_URL')), false);
  assert.equal(Object.hasOwn(env, legacySyncEnv('_MARKET')), false);
});

test('desktop dev bootstrap removes explicit legacy auth in the OSS runtime', () => {
  const projectRoot = path.join('/tmp/workspace', token(['Sync', 'Flow']), 'apps', 'desktop');
  const env = buildElectronViteEnv({
    command: 'dev',
    parentEnv: {
      [legacySyncEnv('_API_BASE_URL')]: 'https://api.example',
      [legacySyncEnv('_AUTH_BASE_URL')]: 'https://auth.example',
    },
    existsSyncFn: () => false,
    projectRoot,
  });

  assert.equal(Object.hasOwn(env, legacySyncEnv('_API_BASE_URL')), false);
  assert.equal(Object.hasOwn(env, 'LYNAVO_SUPPORT_API_BASE_URL'), false);
  assert.equal(Object.hasOwn(env, desktopUpdateEnv), false);
  assert.equal(Object.hasOwn(env, diagnosticsUploadEnv), false);
  assert.equal(Object.hasOwn(env, 'LYNAVO_API_BASE_URL'), false);
  assert.equal(Object.hasOwn(env, legacySyncEnv('_AUTH_BASE_URL')), false);
});
