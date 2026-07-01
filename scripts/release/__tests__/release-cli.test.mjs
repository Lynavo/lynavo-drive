import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

function runReleaseDryRun(profile, targets = 'ios,android,win,linux') {
  return spawnSync(
    process.execPath,
    ['scripts/release/release.mjs', '--profile', profile, '--targets', targets, '--dry-run'],
    {
      cwd: new URL('../../..', import.meta.url),
      encoding: 'utf8',
    },
  );
}

function runReleaseHelp() {
  return spawnSync(process.execPath, ['scripts/release/release.mjs', '--help'], {
    cwd: new URL('../../..', import.meta.url),
    encoding: 'utf8',
  });
}

test('prints linux in release target help', () => {
  const result = runReleaseHelp();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--targets ios,android,mac,win,linux/);
});

test('prints the review release plan without running build commands in dry-run mode', () => {
  const result = runReleaseDryRun('review');

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Profile:\s+review/);
  assert.match(result.stdout, /Channel:\s+review/);
  assert.doesNotMatch(result.stdout, /Market:/);
  assert.doesNotMatch(result.stdout, /market/i);
  assert.match(result.stdout, /DRY RUN/);
  assert.match(result.stdout, /LYNAVO_RELEASE_CHANNEL=review/);
  assert.doesNotMatch(result.stdout, /Support API URL:/);
  assert.doesNotMatch(result.stdout, /LYNAVO_SUPPORT_API_BASE_URL=/);
  assert.doesNotMatch(result.stdout, /LYNAVO_DESKTOP_UPDATE_URL=/);
  assert.doesNotMatch(result.stdout, /LYNAVO_DIAGNOSTICS_UPLOAD_URL=/);
  assert.doesNotMatch(result.stdout, /LYNAVO_API_BASE_URL=/);
  assert.doesNotMatch(result.stdout, /LYNAVO_CLIENT_CONFIG_BASE_URL=/);
  assert.doesNotMatch(result.stdout, /LYNAVO_GIFTCARD_REDEEM_BASE_URL=/);
  assert.doesNotMatch(result.stdout, /SYNCFLOW_MARKET=/);
  assert.doesNotMatch(result.stdout, /SYNCFLOW_API_BASE_URL=/);
  assert.doesNotMatch(result.stdout, /VIVIDROP_API_BASE_URL=/);
  assert.match(result.stdout, /ELECTRON_BUILDER_CONFIG=electron-builder\.yml/);
  assert.match(
    result.stdout,
    /bash apps\/mobile\/ios\/scripts\/testflight-release\.sh archive-upload/,
  );
  assert.match(
    result.stdout,
    /bash -lc cd apps\/mobile\/android && \.\/gradlew assembleRelease bundleRelease -PreactNativeArchitectures=arm64-v8a,x86_64/,
  );
  assert.match(result.stdout, /pnpm --filter @lynavo-drive\/desktop package:win/);
  assert.match(result.stdout, /pnpm --filter @lynavo-drive\/desktop package:linux/);
});

test('prints the prod release plan without market or legacy API env in dry-run mode', () => {
  const result = runReleaseDryRun('prod', 'mac,win,linux');

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Profile:\s+prod/);
  assert.match(result.stdout, /Channel:\s+prod/);
  assert.doesNotMatch(result.stdout, /Market:/);
  assert.doesNotMatch(result.stdout, /market/i);
  assert.match(result.stdout, /DRY RUN/);
  assert.match(result.stdout, /LYNAVO_RELEASE_CHANNEL=prod/);
  assert.doesNotMatch(result.stdout, /Support API URL:/);
  assert.doesNotMatch(result.stdout, /LYNAVO_SUPPORT_API_BASE_URL=/);
  assert.doesNotMatch(result.stdout, /LYNAVO_DESKTOP_UPDATE_URL=/);
  assert.doesNotMatch(result.stdout, /LYNAVO_DIAGNOSTICS_UPLOAD_URL=/);
  assert.doesNotMatch(result.stdout, /LYNAVO_API_BASE_URL=/);
  assert.doesNotMatch(result.stdout, /SYNCFLOW_MARKET=/);
  assert.doesNotMatch(result.stdout, /SYNCFLOW_API_BASE_URL=/);
  assert.doesNotMatch(result.stdout, /VIVIDROP_API_BASE_URL=/);
  assert.match(result.stdout, /ELECTRON_BUILDER_CONFIG=electron-builder\.yml/);
  assert.match(result.stdout, /pnpm package:desktop:signed/);
  assert.match(result.stdout, /pnpm --filter @lynavo-drive\/desktop package:win/);
  assert.match(result.stdout, /pnpm --filter @lynavo-drive\/desktop package:linux/);
});

test('release execution scrubs stale commercial and legacy parent env before spawning children', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'syncflow-release-env-'));
  const capturePath = join(tempDir, 'child-env.json');
  const fakePnpmPath = join(tempDir, 'pnpm');
  writeFileSync(
    fakePnpmPath,
    [
      '#!/usr/bin/env node',
      "require('node:fs').writeFileSync(process.env.CAPTURE_ENV_PATH, JSON.stringify(process.env, null, 2));",
    ].join('\n'),
  );
  chmodSync(fakePnpmPath, 0o755);

  try {
    const result = spawnSync(
      process.execPath,
      ['scripts/release/release.mjs', '--profile', 'review', '--targets', 'mac'],
      {
        cwd: new URL('../../..', import.meta.url),
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${tempDir}:${process.env.PATH ?? ''}`,
          CAPTURE_ENV_PATH: capturePath,
          SYNCFLOW_MARKET: 'cn',
          SYNCFLOW_API_BASE_URL: 'https://legacy-syncflow.example',
          VIVIDROP_API_BASE_URL: 'https://legacy-vividrop.example',
          LYNAVO_CLIENT_CONFIG_BASE_URL: 'https://commercial-config.example',
          LYNAVO_GIFTCARD_REDEEM_BASE_URL: 'https://gift.example',
          SYNCFLOW_GOOGLE_CLIENT_CONFIG_FILE: '/secure/google-client.json',
          GOOGLE_CLIENT_ID: 'google-client-id',
          APPLE_OAUTH_CLIENT_ID: 'com.example.signin',
        },
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const childEnv = JSON.parse(readFileSync(capturePath, 'utf8'));

    assert.equal(childEnv.LYNAVO_RELEASE_CHANNEL, 'review');
    assert.equal(Object.hasOwn(childEnv, 'LYNAVO_SUPPORT_API_BASE_URL'), false);
    assert.equal(Object.hasOwn(childEnv, 'LYNAVO_DESKTOP_UPDATE_URL'), false);
    assert.equal(Object.hasOwn(childEnv, 'LYNAVO_DIAGNOSTICS_UPLOAD_URL'), false);
    assert.equal(Object.hasOwn(childEnv, 'LYNAVO_API_BASE_URL'), false);
    assert.equal(childEnv.ELECTRON_BUILDER_CONFIG, 'electron-builder.yml');
    assert.equal(Object.hasOwn(childEnv, 'SYNCFLOW_MARKET'), false);
    assert.equal(Object.hasOwn(childEnv, 'SYNCFLOW_API_BASE_URL'), false);
    assert.equal(Object.hasOwn(childEnv, 'VIVIDROP_API_BASE_URL'), false);
    assert.equal(Object.hasOwn(childEnv, 'LYNAVO_CLIENT_CONFIG_BASE_URL'), false);
    assert.equal(Object.hasOwn(childEnv, 'LYNAVO_GIFTCARD_REDEEM_BASE_URL'), false);
    assert.equal(Object.hasOwn(childEnv, 'SYNCFLOW_GOOGLE_CLIENT_CONFIG_FILE'), false);
    assert.equal(Object.hasOwn(childEnv, 'GOOGLE_CLIENT_ID'), false);
    assert.equal(Object.hasOwn(childEnv, 'APPLE_OAUTH_CLIENT_ID'), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('rejects missing profile', () => {
  const result = spawnSync(process.execPath, ['scripts/release/release.mjs', '--dry-run'], {
    cwd: new URL('../../..', import.meta.url),
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--profile is required/);
});
