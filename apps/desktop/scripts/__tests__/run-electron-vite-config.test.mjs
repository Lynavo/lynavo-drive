import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  resolveDefaultAppleSignConfigDir,
  resolveDefaultGoogleClientConfigDir,
} = require('../run-electron-vite-config.cjs');

test('resolves sibling server Google Desktop config for global dev when present', () => {
  const projectRoot = path.join('/tmp/workspace/SyncFlow', 'apps', 'desktop');
  const expected = path.join(
    '/tmp/workspace',
    'vivi-drop-server',
    '.config',
    'global-google-singin',
  );

  assert.equal(
    resolveDefaultGoogleClientConfigDir({
      command: 'dev',
      env: { SYNCFLOW_MARKET: 'global' },
      existsSync: (target) => target === expected,
      projectRoot,
    }),
    expected,
  );
});

test('does not resolve default Google config outside global dev', () => {
  const projectRoot = path.join('/tmp/workspace/SyncFlow', 'apps', 'desktop');
  const existsSync = () => true;

  assert.equal(
    resolveDefaultGoogleClientConfigDir({
      command: 'preview',
      env: { SYNCFLOW_MARKET: 'global' },
      existsSync,
      projectRoot,
    }),
    '',
  );
  assert.equal(
    resolveDefaultGoogleClientConfigDir({
      command: 'dev',
      env: { SYNCFLOW_MARKET: 'cn' },
      existsSync,
      projectRoot,
    }),
    '',
  );
});

test('does not override explicit Google config environment', () => {
  const projectRoot = path.join('/tmp/workspace/SyncFlow', 'apps', 'desktop');
  const existsSync = () => true;

  assert.equal(
    resolveDefaultGoogleClientConfigDir({
      command: 'dev',
      env: {
        SYNCFLOW_MARKET: 'global',
        SYNCFLOW_GOOGLE_CLIENT_CONFIG_FILE: '/secure/google-client.json',
      },
      existsSync,
      projectRoot,
    }),
    '',
  );
  assert.equal(
    resolveDefaultGoogleClientConfigDir({
      command: 'dev',
      env: {
        GOOGLE_CLIENT_SECRET: 'already-set',
        SYNCFLOW_MARKET: 'global',
      },
      existsSync,
      projectRoot,
    }),
    '',
  );
});

test('resolves sibling server Apple sign config for global dev when present', () => {
  const projectRoot = path.join('/tmp/workspace/SyncFlow', 'apps', 'desktop');
  const expected = path.join('/tmp/workspace', 'vivi-drop-server', '.config', 'apple-sign');

  assert.equal(
    resolveDefaultAppleSignConfigDir({
      command: 'dev',
      env: { SYNCFLOW_MARKET: 'global' },
      existsSync: (target) => target === path.join(expected, 'id.txt'),
      projectRoot,
    }),
    expected,
  );
});

test('does not resolve default Apple sign config outside global dev', () => {
  const projectRoot = path.join('/tmp/workspace/SyncFlow', 'apps', 'desktop');
  const existsSync = () => true;

  assert.equal(
    resolveDefaultAppleSignConfigDir({
      command: 'preview',
      env: { SYNCFLOW_MARKET: 'global' },
      existsSync,
      projectRoot,
    }),
    '',
  );
  assert.equal(
    resolveDefaultAppleSignConfigDir({
      command: 'dev',
      env: { SYNCFLOW_MARKET: 'cn' },
      existsSync,
      projectRoot,
    }),
    '',
  );
});

test('does not override explicit Apple config environment', () => {
  const projectRoot = path.join('/tmp/workspace/SyncFlow', 'apps', 'desktop');
  const existsSync = () => true;

  assert.equal(
    resolveDefaultAppleSignConfigDir({
      command: 'dev',
      env: {
        SYNCFLOW_MARKET: 'global',
        SYNCFLOW_APPLE_SIGN_CONFIG_FILE: '/secure/apple/id.txt',
      },
      existsSync,
      projectRoot,
    }),
    '',
  );
  assert.equal(
    resolveDefaultAppleSignConfigDir({
      command: 'dev',
      env: {
        APPLE_OAUTH_CLIENT_ID: 'com.example.signin',
        SYNCFLOW_MARKET: 'global',
      },
      existsSync,
      projectRoot,
    }),
    '',
  );
});
