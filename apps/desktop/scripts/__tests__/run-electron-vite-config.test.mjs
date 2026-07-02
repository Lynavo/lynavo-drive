import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { buildElectronViteEnv } = require('../run-electron-vite.cjs');
const token = (parts) => parts.join('');
const desktopUpdateEnv = token(['LYNAVO_DESKTOP', '_UPDATE_URL']);
const diagnosticsUploadEnv = token(['LYNAVO_DIAGNOSTICS', '_UPLOAD_URL']);

test('desktop dev bootstrap does not resolve OAuth config from sibling server files', () => {
  const script = readFileSync(new URL('../run-electron-vite.cjs', import.meta.url), 'utf8');

  assert.doesNotMatch(script, /resolveDefault(Google|Apple)/);
});

test('desktop dev bootstrap references only local release env', () => {
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
  assert.doesNotMatch(viteConfig, /LYNAVO_API_BASE_URL/);
  assert.doesNotMatch(viteConfig, /LYNAVO_SUPPORT_API_BASE_URL/);
});

test('desktop dev bootstrap strips sensitive OAuth env from the local runtime', () => {
  const projectRoot = path.join('/tmp/workspace', 'lynavo-drive', 'apps', 'desktop');
  const env = buildElectronViteEnv({
    command: 'dev',
    parentEnv: {
      LYNAVO_API_BASE_URL: 'https://api.lynavo.example',
      LYNAVO_SUPPORT_API_BASE_URL: 'https://support-api.lynavo.example',
      [desktopUpdateEnv]: 'https://updates.lynavo.example/app',
      [diagnosticsUploadEnv]: 'https://diagnostics.lynavo.example/upload',
      LYNAVO_GOOGLE_CLIENT_CONFIG_FILE: '/secure/google-client.json',
      GOOGLE_CLIENT_SECRET_FILE: '/secure/google-secret.json',
      GOOGLE_CLIENT_ID: 'google-client-id',
      GOOGLE_CLIENT_SECRET: 'google-client-secret',
      LYNAVO_APPLE_SIGN_CONFIG_FILE: '/secure/apple/id.txt',
      APPLE_OAUTH_CLIENT_ID: 'com.example.signin',
      APPLE_REDIRECT_URI: 'https://example.test/callback',
    },
    existsSyncFn: () => true,
    projectRoot,
  });

  assert.equal(Object.hasOwn(env, 'LYNAVO_GOOGLE_CLIENT_CONFIG_FILE'), false);
  assert.equal(Object.hasOwn(env, 'GOOGLE_CLIENT_SECRET_FILE'), false);
  assert.equal(Object.hasOwn(env, 'GOOGLE_CLIENT_ID'), false);
  assert.equal(Object.hasOwn(env, 'GOOGLE_CLIENT_SECRET'), false);
  assert.equal(Object.hasOwn(env, 'LYNAVO_APPLE_SIGN_CONFIG_FILE'), false);
  assert.equal(Object.hasOwn(env, 'APPLE_OAUTH_CLIENT_ID'), false);
  assert.equal(Object.hasOwn(env, 'APPLE_REDIRECT_URI'), false);
  assert.equal(Object.hasOwn(env, 'LYNAVO_SUPPORT_API_BASE_URL'), false);
  assert.equal(Object.hasOwn(env, desktopUpdateEnv), false);
  assert.equal(Object.hasOwn(env, diagnosticsUploadEnv), false);
});

test('desktop dev bootstrap bridges only release channel over external API env', () => {
  const projectRoot = path.join('/tmp/workspace', 'lynavo-drive', 'apps', 'desktop');
  const env = buildElectronViteEnv({
    command: 'dev',
    parentEnv: {
      LYNAVO_RELEASE_CHANNEL: 'prod',
      LYNAVO_API_BASE_URL: 'https://api.lynavo.example',
      LYNAVO_SUPPORT_API_BASE_URL: 'https://support-api.lynavo.example',
      [desktopUpdateEnv]: 'https://updates.lynavo.example/app',
      [diagnosticsUploadEnv]: 'https://diagnostics.lynavo.example/upload',
      LYNAVO_CLIENT_CONFIG_BASE_URL: 'https://config.lynavo.test',
      LYNAVO_GIFTCARD_REDEEM_BASE_URL: 'https://gift.lynavo.test',
    },
    existsSyncFn: () => false,
    projectRoot,
  });

  assert.equal(env.LYNAVO_RELEASE_CHANNEL, 'prod');
  assert.equal(Object.hasOwn(env, 'LYNAVO_SUPPORT_API_BASE_URL'), false);
  assert.equal(Object.hasOwn(env, desktopUpdateEnv), false);
  assert.equal(Object.hasOwn(env, diagnosticsUploadEnv), false);
  assert.equal(Object.hasOwn(env, 'LYNAVO_API_BASE_URL'), false);
  assert.equal(Object.hasOwn(env, 'LYNAVO_CLIENT_CONFIG_BASE_URL'), false);
  assert.equal(Object.hasOwn(env, 'LYNAVO_GIFTCARD_REDEEM_BASE_URL'), false);
});

test('desktop dev bootstrap removes explicit auth endpoints from the local runtime', () => {
  const projectRoot = path.join('/tmp/workspace', 'lynavo-drive', 'apps', 'desktop');
  const env = buildElectronViteEnv({
    command: 'dev',
    parentEnv: {
      LYNAVO_API_BASE_URL: 'https://api.example',
      LYNAVO_AUTH_BASE_URL: 'https://auth.example',
    },
    existsSyncFn: () => false,
    projectRoot,
  });

  assert.equal(Object.hasOwn(env, 'LYNAVO_SUPPORT_API_BASE_URL'), false);
  assert.equal(Object.hasOwn(env, desktopUpdateEnv), false);
  assert.equal(Object.hasOwn(env, diagnosticsUploadEnv), false);
  assert.equal(Object.hasOwn(env, 'LYNAVO_API_BASE_URL'), false);
  assert.equal(Object.hasOwn(env, 'LYNAVO_AUTH_BASE_URL'), false);
});
